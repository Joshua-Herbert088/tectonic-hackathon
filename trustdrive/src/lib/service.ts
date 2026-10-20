import { buildBriefing } from "./briefing";
import { checkConflicts, type Draft } from "./conflicts";
import { relevantPeople } from "./contacts";
import { buildGovernanceSnapshot } from "./governance";
import { lineDoubts } from "./doubts";
import { findRedundant, substance, type SimilarDoc } from "./similarity";
import { answersForDoc, captureAnswers, faqAnswers, faqSuggestions, sharedOnly, viewOf, withLiveConflicts } from "./answers";
import type { z } from "zod";
import { notifyEdit, notifyOverrides } from "./notify";
import type { documentPatch } from "./schemas";
import { dismissFaq, documentSources, insertScore, recordOverrides, updateDocument, latestScore, latestScoresForViewer, loadActivity, loadAnswers, loadConversations, loadHistory, loadWorld, scoreHistory } from "./db";
import { menteeView } from "./mentoring";
import { buildLedger, profileOf, suggestions, whoKnows } from "./expertise";
import { handoverFor } from "./handover";
import { GLOBAL, taxonomyOf } from "./taxonomy";
import { ruleKind, statementsOf } from "./handoverDraft";
import { buildJevState, buildSignals, fallbackScore, hashState, relatedDocs, scoreWithJev } from "./trust";
import { isGlobal } from "./appliesTo";
import { myClients } from "./clients";
import { HttpError } from "./http";
import { daysSince, timeAgo } from "./time";
import type { ConflictCheck, Conversation, Db, Doc, Person, TrustScore } from "./types";

/** A stored score only counts if Jev's inputs haven't changed since it was computed. */
function freshOrNull(db: Db, doc: Doc, viewer: Person, stored: TrustScore | null | undefined) {
  return stored && stored.inputHash === hashState(buildJevState(db, doc, viewer)) ? stored : null;
}

// Coalesce concurrent requests for the same doc/viewer.
// Per instance: across server instances a duplicate score is only an extra history row.
const inflight = new Map<string, Promise<TrustScore | null>>();

/** Scores a document for a viewer with Jev (or the rules when Jev is unavailable); null when it doesn't exist. */
export function computeScore(docId: string, viewer: Person): Promise<TrustScore | null> {
  const key = `${docId}:${viewer.id}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    const db = await loadWorld();
    const doc = db.docs.find((d) => d.id === docId);
    if (!doc) return null;
    const state = buildJevState(db, doc, viewer);
    const inputHash = hashState(state);
    // Confidential content never goes to Jev; rule scores aren't stored, like any other fallback.
    if (doc.confidential) return { ...fallbackScore(db, doc, viewer, "confidential document", Date.now(), { confidential: true }), inputHash };
    let jev: Awaited<ReturnType<typeof scoreWithJev>>;
    try {
      jev = await scoreWithJev(state);
    } catch (e) {
      // Not stored, so the next request asks Jev again.
      return { ...fallbackScore(db, doc, viewer, (e as Error).message), inputHash };
    }
    const result = { ...jev, inputHash };
    await insertScore(doc.id, viewer.id, result);
    return result;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function summary(db: Db, doc: Doc, viewer: Person, stored: TrustScore | null | undefined) {
  const { content: _content, ...meta } = doc;
  // The strongest reason each way, so a list can say why next to the score.
  const signals = buildSignals(db, doc, viewer);
  const issue = signals.find((x) => x.tone === "bad") ?? signals.find((x) => x.tone === "warn");
  const goods = signals.filter((x) => x.tone === "good");
  const strength = goods.find((x) => x.text.startsWith("Verified")) ?? goods.find((x) => x.text.startsWith("Edited")) ?? goods[0];
  return {
    ...meta,
    excerpt: doc.content.replace(/[#*|>-]/g, " ").slice(0, 160),
    trust: freshOrNull(db, doc, viewer, stored),
    issue: issue?.text ?? null,
    strength: strength?.text ?? null,
  };
}

export async function listDocs(viewer: Person) {
  const [db, scores] = await Promise.all([loadWorld(), latestScoresForViewer(viewer.id)]);
  const docs = [...db.docs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((d) => summary(db, d, viewer, scores.get(d.id)));
  return { viewer, docs, folders: db.folders };
}

export async function docDetail(docId: string, viewer: Person) {
  const db = await loadWorld();
  const doc = db.docs.find((d) => d.id === docId);
  if (!doc) return null;
  // Answers from messages sent since the last capture show up on the next visit; the page doesn't wait for Jev.
  void captureAnswers();
  const [scores, latest, history, people, sources, governance, answers] = await Promise.all([
    latestScoresForViewer(viewer.id),
    latestScore(doc.id, viewer.id),
    scoreHistory(doc.id, viewer.id),
    relevantPeople(db, doc, viewer),
    documentSources(doc.id),
    buildGovernanceSnapshot(db, doc),
    loadAnswers(),
  ]);
  const shared = sharedOnly(answers).map((a) => viewOf(a, viewer));
  return {
    doc,
    trust: freshOrNull(db, doc, viewer, latest),
    history,
    signals: buildSignals(db, doc, viewer),
    doubts: lineDoubts(db, doc, Date.now(), shared),
    answers: answersForDoc(db, doc, shared),
    related: relatedDocs(db, doc).map((r) => summary(db, r, viewer, scores.get(r.id))),
    jevInput: buildJevState(db, doc, viewer),
    people,
    client: db.clients.find((c) => c.id === doc.clientId) ?? null,
    folders: db.folders,
    sources,
    governance,
    conflictDecisions: {
      made: db.overrides.filter((o) => o.docId === doc.id),
      against: db.overrides.filter((o) => o.existingDocId === doc.id).map((o) => ({ ...o, docTitle: db.docs.find((d) => d.id === o.docId)?.title ?? o.docId })),
    },
  };
}

/** What `viewer` inherits from `predecessorId`, with each document's trust for the viewer (null = needs scoring). */
export async function handoverBriefing(predecessorId: string, viewer: Person) {
  const db = await loadWorld();
  const predecessor = db.people.find((p) => p.id === predecessorId);
  if (!predecessor) return null;
  const [scores, briefing] = await Promise.all([latestScoresForViewer(viewer.id), buildBriefing(db, predecessor, viewer)]);
  return {
    ...briefing,
    docs: briefing.docs.map((d) => ({ ...d, doc: { ...d.doc, trust: freshOrNull(db, db.docs.find((x) => x.id === d.doc.id)!, viewer, scores.get(d.doc.id)) } })),
  };
}

/** Everything expertise is worked out from, with answers in new messages captured first. Only shared answers count. */
export async function expertiseInputs() {
  await captureAnswers();
  const [db, history, conversations, answers] = await Promise.all([loadWorld(), loadHistory(), loadConversations(), loadAnswers()]);
  return { db, conversations, answers, shared: sharedOnly(answers), ledger: buildLedger(db, history, conversations, sharedOnly(answers)) };
}

/**
 * A mentee as their mentor sees them: what they asked, searched for and opened since the mentorship
 * started, by department. Trust is the mentee's own (stored, or the rule estimate when they haven't
 * been scored yet), so "low trust" means what they could rely on.
 */
export async function menteeFor(db: Db, mentee: Person, conversations: Conversation[]) {
  const since = mentee.mentorSince ?? new Date(0).toISOString();
  const [events, scores] = await Promise.all([loadActivity(mentee.id, since), latestScoresForViewer(mentee.id)]);
  const scoreOf = (docId: string) => {
    const doc = db.docs.find((d) => d.id === docId);
    if (!doc) return undefined;
    return scores.get(docId)?.score ?? fallbackScore(db, doc, mentee, "estimate for the mentor").score;
  };
  return menteeView(db, mentee, events, conversations, scoreOf, since);
}

/** The viewer's mentees (each with what stands out) and their own mentor. */
export async function mentoringFor(viewer: Person) {
  const [db, conversations] = await Promise.all([loadWorld(), loadConversations()]);
  const me = db.people.find((p) => p.id === viewer.id) ?? viewer;
  const mentees = db.people.filter((p) => p.mentorId === viewer.id && p.active);
  return {
    mentor: me.mentorId ? { personId: me.mentorId, since: me.mentorSince ?? null } : null,
    mentees: await Promise.all(
      mentees.map(async (p) => {
        const view = await menteeFor(db, p, conversations);
        return { personId: p.id, since: view.since, counts: view.counts, struggling: view.areas.filter((a) => a.struggling).map((a) => ({ teamId: a.teamId!, reasons: a.reasons })), lastAt: view.areas.map((a) => a.lastAt).sort().at(-1) ?? null };
      }),
    ),
  };
}

/** Everything about one mentee, for their mentor only. */
export async function menteeDetail(menteeId: string, viewer: Person) {
  const [db, conversations] = await Promise.all([loadWorld(), loadConversations()]);
  const mentee = db.people.find((p) => p.id === menteeId);
  if (!mentee) throw new HttpError(404, "Not found");
  if (mentee.mentorId !== viewer.id) throw new HttpError(403, `Only ${mentee.name.split(" ")[0]}'s mentor can see this.`);
  return { personId: mentee.id, ...(await menteeFor(db, mentee, conversations)) };
}

/**
 * "Who knows X?": colleagues ranked by the evidence on what the question is about, answers given before,
 * and the documents it's about (with the viewer's trust). An empty question gets starting points.
 */
export async function whoKnowsFor(query: string, viewer: Person) {
  if (!query.trim()) {
    const db = await loadWorld();
    return { suggestions: suggestions(db, myClients(viewer, db.clients)) };
  }
  const [{ db, ledger, conversations, shared }, scores] = await Promise.all([expertiseInputs(), latestScoresForViewer(viewer.id)]);
  const { documentIds, ...result } = whoKnows(db, ledger, conversations, shared, query, viewer);
  return { ...result, documents: documentIds.map((id) => db.docs.find((d) => d.id === id)!).map((d) => summary(db, d, viewer, scores.get(d.id))) };
}

/** A shared answer on its own page (or the viewer's own, waiting one); null when there's none they may see. */
export async function answerPage(id: number, viewer: Person) {
  await captureAnswers();
  const [db, answers] = await Promise.all([loadWorld(), loadAnswers()]);
  const a = answers.find((x) => x.id === id && (x.sharing === "shared" || x.answererId === viewer.id));
  return a ? withLiveConflicts(db, [viewOf(a, viewer)])[0] : null;
}

/** Someone's expertise profile, built from their work; null when there's no such person. */
export async function personProfile(personId: string, viewer: Person) {
  const { db, ledger, conversations, answers } = await expertiseInputs();
  const person = db.people.find((p) => p.id === personId);
  if (!person) return null;
  return profileOf(db, ledger, conversations, answers, person, viewer);
}

/** The viewer's answers on a topic that aren't written up yet, for turning them into an FAQ. */
export async function faqDraft(topic: string, viewer: Person) {
  await captureAnswers();
  const [db, answers] = await Promise.all([loadWorld(), loadAnswers()]);
  const tax = taxonomyOf(db.terms);
  if (!tax.topic.has(topic)) return null;
  return { topic, label: tax.tagLabel(topic), parent: tax.topic.get(topic)!.parent ?? null, answers: faqAnswers(db, answers, viewer, topic) };
}

/** "Not now": the viewer's answers on this topic stop counting towards an FAQ suggestion. */
export async function dismissFaqSuggestion(topic: string, viewer: Person) {
  const [db, answers] = await Promise.all([loadWorld(), loadAnswers()]);
  const ids = faqAnswers(db, answers, viewer, topic).map((a) => a.id);
  await dismissFaq(ids, viewer.id);
  return { dismissed: ids.length };
}

/** What the client asks in the last message of a conversation, when that message is theirs and asks something. */
function clientAsk(c: Conversation) {
  const last = c.messages.at(-1);
  if (!last || last.personId) return null;
  const asks = statementsOf(last.body).statements.filter((x) => ruleKind(x) === "open");
  return asks.find((x) => x.trim().endsWith("?")) ?? asks[0] ?? null;
}
const isWaiting = (c: Conversation) => !!clientAsk(c);

/**
 * Everything about one client, for someone taking it over or preparing a meeting:
 * - documents about the client, and general documents for its country that share a topic with them
 * - known exceptions: conflicts saved on purpose on those documents
 * - the client's conversations (the page drafts agreements and open items from them)
 * - colleagues who handled the client, with former ones flagged
 * Trust is filled in by the page.
 */
export async function clientOverview(clientId: string, viewer: Person) {
  const [db, scores, allConversations] = await Promise.all([loadWorld(), latestScoresForViewer(viewer.id), loadConversations()]);
  const client = db.clients.find((c) => c.id === clientId);
  if (!client) return null;
  const live = db.docs.filter((d) => !d.supersededById);
  const row = (d: Doc) => summary(db, d, viewer, scores.get(d.id));

  const about = live.filter((d) => d.clientId === client.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  // General documents that apply: same country (or global), ranked by how many topics they share with the client's documents.
  const tax = taxonomyOf(db.terms);
  const clientTopics = new Set(about.flatMap((d) => d.tags).filter((t) => tax.topic.has(t) && t !== "client" && t !== "client-service"));
  // Documents a client exception deliberately differs from come first: they apply, except on that line.
  const contradicted = new Set(db.overrides.filter((o) => about.some((d) => d.id === o.docId)).map((o) => o.existingDocId));
  const applies = live
    .filter((d) => !d.clientId && (d.locations.includes(client.location) || isGlobal(d.locations)))
    .map((d) => ({ d, shared: d.tags.filter((t) => clientTopics.has(t)).length + (d.locations.includes(client.location) && d.teamId === client.teamId ? 1 : 0) + (contradicted.has(d.id) ? 10 : 0) }))
    .filter((x) => x.shared > 0)
    .sort((a, b) => b.shared - a.shared || b.d.updatedAt.localeCompare(a.d.updatedAt))
    .slice(0, 12)
    .map((x) => x.d);

  const inScope = new Set(about.map((d) => d.id));
  const exceptions = db.overrides
    .filter((o) => inScope.has(o.docId) || inScope.has(o.existingDocId))
    .map((o) => ({ override: o, docTitle: db.docs.find((d) => d.id === o.docId)?.title ?? o.docId }))
    .sort((a, b) => b.override.at.localeCompare(a.override.at));

  const conversations = allConversations
    .filter((c) => c.clientId === client.id)
    .map((c) => ({ id: c.id, title: c.title, source: c.source, messages: c.messages.length, last: c.messages.at(-1)?.sentAt ?? c.createdAt, waiting: isWaiting(c) }))
    .sort((a, b) => b.last.localeCompare(a.last));

  // Colleagues who handled the client: wrote to them, own or work on their documents, or verified them.
  const tally = new Map<string, { convs: number; lastMessage: string | null; owns: number; worked: number; verified: number }>();
  const get = (id: string) => tally.get(id) ?? (tally.set(id, { convs: 0, lastMessage: null, owns: 0, worked: 0, verified: 0 }), tally.get(id)!);
  for (const c of allConversations.filter((x) => x.clientId === client.id)) {
    for (const id of new Set(c.messages.map((m) => m.personId).filter((x): x is string => !!x))) {
      const t = get(id);
      t.convs++;
      const last = c.messages.filter((m) => m.personId === id).at(-1)!.sentAt;
      if (!t.lastMessage || last > t.lastMessage) t.lastMessage = last;
    }
  }
  for (const d of about) {
    if (d.ownerId) get(d.ownerId).owns++;
    for (const id of d.collaboratorIds) get(id).worked++;
    for (const id of new Set(d.verifications.map((v) => v.personId))) get(id).verified++;
  }
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const people = [...tally]
    .filter(([id]) => db.people.some((p) => p.id === id))
    .map(([personId, t]) => {
      const p = db.people.find((x) => x.id === personId)!;
      const why = [
        t.convs && `Wrote in ${plural(t.convs, "conversation")} with ${client.name}${t.lastMessage ? `, last ${timeAgo(t.lastMessage)}` : ""}`,
        t.owns && `Owns ${plural(t.owns, "client document")}`,
        t.worked && `Works on ${plural(t.worked, "client document")}`,
        t.verified && `Verified ${plural(t.verified, "client document")}`,
      ].filter((x): x is string => !!x);
      const status = !p.active ? `Left the company ${timeAgo(p.leftAt ?? p.joinedAt)}` : p.previousTeamId ? "Moved to another team" : null;
      const score = t.convs * 3 + t.owns * 3 + t.verified * 2 + t.worked + (t.lastMessage && daysSince(t.lastMessage) < 90 ? 3 : 0);
      return { personId, why, status, score };
    })
    .sort((a, b) => Number(!!a.status) - Number(!!b.status) || b.score - a.score)
    .map(({ score: _score, ...c }) => c);

  return { client, about: about.map(row), applies: applies.map(row), exceptions, conversations, people };
}

/**
 * The "For you" page: documents the viewer is responsible for, client messages waiting for an answer,
 * handovers they're suggested for, their team's least trusted documents, how their work is used and
 * recently updated documents for them. Trust is filled in by the page.
 */
export async function homeFor(viewer: Person) {
  await captureAnswers();
  const [db, scores, conversations, answers] = await Promise.all([loadWorld(), latestScoresForViewer(viewer.id), loadConversations(), loadAnswers()]);
  const live = db.docs.filter((d) => !d.supersededById);
  const row = (d: Doc) => {
    const last = [...d.verifications].sort((a, b) => b.at.localeCompare(a.at))[0];
    return { ...summary(db, d, viewer, scores.get(d.id)), role: d.ownerId === viewer.id ? "owner" : "collaborator", lastVerifiedAt: last?.at ?? null };
  };

  const mine = live.filter((d) => d.ownerId === viewer.id || d.collaboratorIds.includes(viewer.id)).map(row);
  const team = live.filter((d) => d.teamId === viewer.teamId && d.ownerId !== viewer.id && !d.collaboratorIds.includes(viewer.id)).map(row);

  // Client conversations whose last message is the client asking for something.
  // The clients this person chose to see (or their team's), as in their sidebar.
  const myClientIds = new Set(myClients(viewer, db.clients).map((c) => c.id));
  const waiting = conversations.flatMap((c) => {
    const last = c.messages.at(-1);
    if (!last || !(c.clientId && myClientIds.has(c.clientId)) && !c.messages.some((m) => m.personId === viewer.id)) return [];
    const ask = clientAsk(c);
    return ask ? [{ conversationId: c.id, title: c.title, source: c.source, clientId: c.clientId ?? null, authorName: last.authorName, authorEmail: last.authorEmail ?? null, sentAt: last.sentAt, ask }] : [];
  });

  // Documents that need a new owner where the viewer is a suggested successor, grouped by former owner.
  const handovers = new Map<string, { formerOwnerId: string | null; reason: string; docs: { id: string; title: string }[] }>();
  for (const d of live) {
    const h = handoverFor(d, db.people, db.teams);
    if (!h?.successors.some((x) => x.personId === viewer.id)) continue;
    const key = d.ownerId ?? "none";
    const entry = handovers.get(key) ?? { formerOwnerId: d.ownerId, reason: h.reasons[0].text, docs: [] };
    entry.docs.push({ id: d.id, title: d.title });
    handovers.set(key, entry);
  }

  // The good news: how the viewer's work is used, and what's new for them.
  const since = Date.now() - 30 * 86_400_000;
  const recent = (iso: string) => Date.parse(iso) >= since;
  const mineDocs = live.filter((d) => d.ownerId === viewer.id || d.collaboratorIds.includes(viewer.id));
  const opens = mineDocs.flatMap((d) => d.views.filter((v) => v.personId !== viewer.id && recent(v.at)).map((v) => ({ ...v, docId: d.id, title: d.title })));
  const latestOpen = opens.filter((v) => db.people.find((p) => p.id === v.personId)?.active).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  const tax = taxonomyOf(db.terms);
  const topicCounts = new Map<string, number>();
  for (const d of mineDocs) for (const t of d.tags) if (tax.topic.get(t)?.parent) topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
  const impact = {
    opens: opens.length,
    readers: new Set(opens.map((v) => v.personId)).size,
    latestOpen,
    verified: live.reduce((n, d) => n + d.verifications.filter((v) => v.personId === viewer.id && recent(v.at)).length, 0),
    topics: [...topicCounts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => tax.tagLabel(id)),
  };

  // Recently updated documents that apply to the viewer and that they don't maintain; the page keeps the trusted ones.
  const fresh = live
    .filter((d) => !mineDocs.includes(d) && substance(d.content) && recent(d.updatedAt) && (d.locations.includes(viewer.location) || isGlobal(d.locations)) && (!d.audienceTeamIds.length || d.audienceTeamIds.includes(viewer.teamId)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8)
    .map(row);

  // Questions the viewer keeps answering: worth writing up once instead of answering again.
  const faqs = faqSuggestions(db, answers.filter((a) => a.answererId === viewer.id), viewer.id);
  // Answers they gave in chats that could help others, waiting for them to say so.
  const toShare = withLiveConflicts(db, answers.filter((a) => a.answererId === viewer.id && a.sharing === "pending").map((a) => viewOf(a, viewer)));

  return { viewer, mine, team, waiting, handovers: [...handovers.values()], impact, fresh, faqs, toShare };
}

/**
 * Who a document applies to, checked and tidied: countries must be in the taxonomy (Global on its own
 * replaces any others), and teams must exist. Undefined parts stay undefined (= unchanged).
 */
export function checkAppliesTo(db: Db, locations: string[] | undefined, audienceTeamIds: string[] | undefined) {
  const tax = taxonomyOf(db.terms);
  const unknown = locations?.find((l) => !tax.locations.includes(l));
  if (unknown) throw new HttpError(400, `“${unknown}” isn't a country in the taxonomy. Add it on the Company & tags page first.`);
  const badTeam = audienceTeamIds?.find((id) => !db.teams.some((t) => t.id === id));
  if (badTeam) throw new HttpError(400, `Unknown team “${badTeam}”.`);
  return {
    locations: locations && (isGlobal(locations) ? [GLOBAL] : [...new Set(locations)]),
    audienceTeamIds: audienceTeamIds && [...new Set(audienceTeamIds)],
  };
}

/**
 * A document needs a document type and a topic as soon as it has content: an upload when it's added, a
 * blank document when it's first saved, and an older untagged document on its next save.
 */
export function requireTags(db: Db, content: string, tags: string[]) {
  if (!substance(content)) return;
  const missing = taxonomyOf(db.terms).missingTags(tags);
  if (missing.length) throw new HttpError(400, `Tag the document before saving it: add ${missing.join(" and ")}.`);
}

/**
 * Saves changes to a document, as the document editor does. Content edits go through the conflict gate
 * (409 on hard conflicts unless overridden); metadata edits don't. Filling a still-empty document is
 * treated like an upload and also gets the redundancy warning. Authors of lines that were changed – or
 * contradicted by an override – are notified. Returns the status and body to respond with.
 */
export async function editDocument(viewer: Person, id: string, body: z.infer<typeof documentPatch>): Promise<{ status: number; body: Record<string, unknown> }> {
  const world = await loadWorld();
  const doc = world.docs.find((d) => d.id === id);
  if (!doc) throw new HttpError(404, "Not found");
  if (body.title !== undefined && !body.title.trim()) throw new HttpError(400, "A document needs a name.");
  const patch = {
    title: body.title?.trim(),
    content: body.content,
    status: body.status,
    ...checkAppliesTo(world, body.locations, body.audienceTeamIds),
    tags: body.tags ? [...new Set(body.tags)] : undefined,
    clientId: body.clientId === null || world.clients.some((c) => c.id === body.clientId) ? body.clientId : undefined,
    confidential: body.confidential,
  };
  const confidential = patch.confidential ?? !!doc.confidential;
  const title = patch.title ?? doc.title;
  const content = patch.content ?? doc.content;

  const contentChanged = content !== doc.content || title !== doc.title;
  // Saving content (a new document's first save, or any edit of one that was never tagged) needs tags.
  if (contentChanged) requireTags(world, content, patch.tags ?? doc.tags);
  let gate: GateResult | null = null;
  if (contentChanged) {
    const [g, similar] = await Promise.all([
      gateDraft(world, { title, content, locations: patch.locations ?? doc.locations, teamId: doc.teamId, docId: doc.id, previousContent: doc.content, confidential }, body.override),
      substance(doc.content) ? Promise.resolve([]) : redundancyCheck(world, { title, content, confidential }, { excludeDocId: doc.id, acknowledged: body.acknowledgeSimilar }),
    ]);
    if (!g.ok) return { status: g.status, body: { ...g.body, similar } };
    if (similar.length) return { status: 409, body: { error: "similar", similar, check: g.check } };
    gate = g;
  }

  if (contentChanged) await notifyEdit(world, doc, title, content, viewer.id);
  await updateDocument(id, viewer.id, patch);
  if (gate?.ok) {
    const reason = body.override?.reason ?? "";
    await recordOverrides(id, viewer.id, reason, gate.overridden);
    await notifyOverrides(world, { id, title }, gate.overridden, viewer.id, reason);
  }
  return { status: 200, body: { ...(await docDetail(id, viewer)), conflictCheck: gate?.ok ? gate.check : null } };
}

export type GateResult =
  | { ok: true; check: ConflictCheck; overridden: ConflictCheck["hard"] }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Hard conflicts block a save unless the person explicitly overrides them with a reason.
 * The caller records `overridden` against the saved document.
 */
export async function gateDraft(db: Db, draft: Draft, override: unknown): Promise<GateResult> {
  let check: ConflictCheck;
  try {
    check = await checkConflicts(db, draft);
  } catch (e) {
    return { ok: false, status: 502, body: { error: `Conflict check failed: ${(e as Error).message}` } };
  }
  if (!check.hard.length) return { ok: true, check, overridden: [] };
  const reason = typeof (override as { reason?: unknown })?.reason === "string" ? (override as { reason: string }).reason.trim() : "";
  if (!reason) return { ok: false, status: 409, body: { error: "conflicts", check } };
  return { ok: true, check, overridden: check.hard };
}

/**
 * Warn-only redundancy check for content being added. Returns [] when there's nothing to add yet,
 * the user already acknowledged the warning, or Jev is unavailable (it must never block saving).
 */
export async function redundancyCheck(db: Db, text: { title: string; content: string; confidential?: boolean }, opts: { excludeDocId?: string; acknowledged?: unknown }): Promise<SimilarDoc[]> {
  if (opts.acknowledged === true || !substance(text.content)) return [];
  try {
    return await findRedundant(db, text, opts.excludeDocId);
  } catch {
    return [];
  }
}
