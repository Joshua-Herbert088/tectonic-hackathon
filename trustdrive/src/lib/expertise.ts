import { isInternal } from "./answerDoc";
import { faqSuggestions, withLiveConflicts } from "./answers";
import { isGlobal } from "./appliesTo";
import { blame } from "./diff";
import { fold } from "./lexicon";
import { keywordHits, taxonomyOf, type Taxonomy } from "./taxonomy";
import { daysSince, timeAgo } from "./time";
import type { Answer, Client, Conversation, Db, Doc, Location, Person } from "./types";

/**
 * Who knows what, worked out from work people already do in TrustDrive. Nobody fills in a profile.
 * - Evidence is only what someone produced: owning a document, the share of its current text they wrote,
 *   edits, verifications, deliberate exceptions to a conflict (with their reason), messages in client
 *   conversations, and answers to colleagues' questions (answers.ts). Reading a document or asking a
 *   question never counts.
 * - Every claim comes with the evidence behind it, so anyone can check it.
 * - Evidence fades: full strength for three months, then half as strong for every year after that.
 *   Ownership and collaboration are ongoing, so they don't fade.
 * - People can take a topic or client off their own profile ("not me any more"); it then no longer
 *   puts them forward for it.
 */

export interface Evidence {
  /** What they did, e.g. "Wrote 64% of"; the document or conversation follows. */
  action: string;
  doc?: { id: string; title: string };
  /** With `messageId`, the message it's about. */
  conversation?: { id: string; title: string; messageId?: number };
  /** More context, such as the reason given for an exception. */
  detail?: string;
  /** When it happened; unset for ongoing roles (owner, collaborator). */
  at?: string;
  weight: number;
}

type History = Map<string, { personId: string | null; at: string; content: string }[]>;

/** Everyone's evidence, per document and per client conversation (personId → evidence), and per answer (the answerer's). */
export interface Ledger {
  docs: Map<string, Map<string, Evidence[]>>;
  conversations: Map<string, Map<string, Evidence[]>>;
  answers: Map<number, Evidence>;
}

const FRESH_DAYS = 90;
const HALF_LIFE_DAYS = 365;
const MIN_SCORE = 3;
const MAX_EXPERTS = 8;
const MAX_EVIDENCE = 6;
const MAX_ANSWERS = 4;
/** Documents for another country than the one asked about still count, but much less. */
const OTHER_COUNTRY = 0.15;
/** A conversation that only mentions a topic says less than a document tagged with it. */
const MENTIONED = 0.6;
/** Answering a colleague's question: about as strong as verifying a document. */
const ANSWER_WEIGHT = 8;
/** Moved team and hasn't worked on it since. */
const MOVED_AWAY = 0.8;

/** How much of an evidence item's weight is left after time: 1 while fresh or ongoing, halving yearly. */
export function fade(e: Evidence, now = Date.now()) {
  return e.at ? 0.5 ** (Math.max(0, daysSince(e.at, now) - FRESH_DAYS) / HALF_LIFE_DAYS) : 1;
}
const strength = (e: Evidence, now: number) => e.weight * fade(e, now);

function docEvidence(db: Db, doc: Doc, history: History) {
  const out = new Map<string, Evidence[]>();
  const ref = { id: doc.id, title: doc.title };
  const add = (personId: string | null | undefined, e: Omit<Evidence, "doc">) => {
    if (!personId) return;
    // A replaced document still shows what someone knew, but less about what they know now.
    out.set(personId, [...(out.get(personId) ?? []), { ...e, doc: ref, weight: doc.supersededById ? e.weight / 2 : e.weight }]);
  };

  const snaps = [...(history.get(doc.id) ?? [])];
  if (snaps.length && snaps.at(-1)!.content !== doc.content) snaps.push({ personId: doc.lastEditedById, at: doc.updatedAt, content: doc.content });
  const { lines, authors } = snaps.length ? blame(snaps) : { lines: doc.content.split("\n"), authors: doc.content.split("\n").map(() => doc.ownerId) };
  const edits = new Map<string, { n: number; last: string }>();
  for (const s of snaps) if (s.personId) edits.set(s.personId, { n: (edits.get(s.personId)?.n ?? 0) + 1, last: s.at });
  if (!snaps.length && doc.ownerId) edits.set(doc.ownerId, { n: 1, last: doc.updatedAt });
  const nonBlank = lines.filter((l) => l.trim()).length || 1;
  const written = new Map<string, number>();
  lines.forEach((l, i) => {
    const a = authors[i];
    if (a && l.trim()) written.set(a, (written.get(a) ?? 0) + 1);
  });

  add(doc.ownerId, { action: "Owns", weight: 10 });
  for (const [pid, n] of written) {
    const share = n / nonBlank;
    add(pid, { action: `Wrote ${Math.max(1, Math.round(share * 100))}% of`, weight: 4 + 16 * share, at: edits.get(pid)?.last });
  }
  for (const [pid, e] of edits) if (!written.has(pid)) add(pid, { action: e.n === 1 ? "Edited" : `Edited ${e.n} times`, weight: Math.min(e.n, 4), at: e.last });
  for (const pid of doc.collaboratorIds) if (!written.has(pid) && !edits.has(pid)) add(pid, { action: "Collaborator on", weight: 3 });
  const verified = new Map<string, string>();
  for (const v of doc.verifications) if (!verified.has(v.personId) || v.at > verified.get(v.personId)!) verified.set(v.personId, v.at);
  for (const [pid, at] of verified) add(pid, { action: "Verified", weight: 8, at });
  // Knowing why a line deliberately differs is the knowledge that's hardest to find anywhere else.
  for (const o of db.overrides) if (o.docId === doc.id) add(o.personId, { action: "Kept a deliberate exception in", detail: `“${o.reason}”`, weight: 10, at: o.at });
  return out;
}

function conversationEvidence(c: Conversation) {
  const mine = new Map<string, { n: number; last: string }>();
  for (const m of c.messages) {
    if (!m.personId) continue;
    const prev = mine.get(m.personId);
    mine.set(m.personId, { n: (prev?.n ?? 0) + 1, last: prev && prev.last > m.sentAt ? prev.last : m.sentAt });
  }
  const ref = { id: c.id, title: c.title };
  return new Map([...mine].map(([pid, { n, last }]) => [pid, [{ action: n === 1 ? "Wrote in" : `Wrote ${n} messages in`, conversation: ref, weight: 2 + 1.5 * Math.min(n, 4), at: last }]]));
}

/** Answering a colleague's question counts; asking one doesn't. */
function answerEvidence(db: Db, a: Answer): Evidence {
  const asker = db.people.find((p) => p.id === a.askerId)?.name.split(" ")[0];
  return {
    action: `Answered ${asker ? `${asker}'s` : "a"} question in`,
    conversation: { id: a.conversationId, title: a.conversationTitle, messageId: a.answerMessageId },
    detail: `“${a.question}”`,
    at: a.answeredAt,
    weight: ANSWER_WEIGHT,
  };
}

/**
 * Chats among colleagues only count through the answers captured from them: being in the thread, or
 * asking, says nothing about what someone knows.
 */
export function buildLedger(db: Db, history: History, conversations: Conversation[], answers: Answer[] = []): Ledger {
  return {
    docs: new Map(db.docs.map((d) => [d.id, docEvidence(db, d, history)])),
    conversations: new Map(conversations.filter((c) => !isInternal(c)).map((c) => [c.id, conversationEvidence(c)])),
    answers: new Map(answers.map((a) => [a.id, answerEvidence(db, a)])),
  };
}

// ---------------------------------------------------------------------------------------------
// "Who knows X?"

/** Question words and filler in English, Dutch, French and German, so "Who knows how overtime works here?" is about overtime. */
const STOPWORDS = new Set(
  (
    "who whom knows know knew about what which how does work works worked here there this that these those with for from and the has have had " +
    "can could should would anyone someone somebody everything things thing best person people ask expert rules rule policy document documents process done before " +
    "wie weet kent over wat welke hoe werkt hier daar met voor van het een die dat iemand alles regels " +
    "qui sait connait quoi quel quelle comment marche ici avec pour les des une est quelqu " +
    "wer weiss kennt uber was welche wie funktioniert hier mit fur der die das und ein eine jemand"
  ).split(" "),
);

export interface Interpretation {
  topics: { id: string; label: string }[];
  clients: { id: string; name: string }[];
  countries: string[];
  /** Free-text words, used only when no topic, client or country was recognised. */
  words: string[];
  /** Words that weren't recognised and weren't used (a topic, client or country was found instead). */
  ignored: string[];
}

const clientNames = (c: Client) => {
  const first = c.name.split(/\s+/)[0];
  return [c.name, ...(first.length >= 5 ? [first] : []), ...(c.domain ? [c.domain] : [])];
};

/** What a question is about: topics and clients by their names and keywords (four languages), countries, or else plain words. */
export function interpret(db: Db, query: string): Interpretation {
  const tax = taxonomyOf(db.terms);
  const matched = tax.topics.filter((t) => keywordHits(query, [t.label, ...t.keywords]) > 0);
  // A sub-topic is more precise than its main topic.
  const topics = matched.filter((t) => !matched.some((c) => c.parent === t.id));
  const clients = db.clients.filter((c) => keywordHits(query, clientNames(c)) > 0);
  const countries = tax.countries.filter((c) => keywordHits(query, [c.label, ...c.keywords]) > 0);
  const recognised = [...topics.flatMap((t) => [t.label, ...t.keywords]), ...clients.flatMap(clientNames), ...countries.flatMap((c) => [c.label, ...c.keywords])];
  const words = [...new Set(fold(query).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w)))].filter(
    (w) => !recognised.some((r) => fold(r).includes(w) || keywordHits(w, [r]) > 0),
  );
  const structured = topics.length + clients.length + countries.length > 0;
  return {
    topics: topics.map((t) => ({ id: t.id, label: t.label })),
    clients: clients.map((c) => ({ id: c.id, name: c.name })),
    countries: countries.map((c) => c.id),
    words: structured ? [] : words,
    ignored: structured ? words : [],
  };
}

/** One reason a document, conversation or answer is relevant; `key` is what a person can hide ("topic:salary"). */
interface Hit {
  key: string;
  score: number;
}

const countryOnly = (q: Interpretation) => !q.topics.length && !q.clients.length && !q.words.length;

/** What a document or a captured answer is about (an answer's question is its title). */
interface Subject {
  tags: string[];
  clientId?: string;
  title: string;
  content: string;
  locations: Location[];
}

function hitsFor(tax: Taxonomy, doc: Subject, q: Interpretation): Hit[] {
  const hits: Hit[] = [];
  for (const t of q.topics) if (doc.tags.includes(t.id) || doc.tags.some((x) => tax.topic.get(x)?.parent === t.id)) hits.push({ key: `topic:${t.id}`, score: 1 });
  for (const c of q.clients) if (doc.clientId === c.id) hits.push({ key: `client:${c.id}`, score: 1 });
  if (q.words.length) {
    const s = Math.min(1, (keywordHits(doc.title, q.words) + 0.5 * keywordHits(doc.content, q.words)) / q.words.length);
    if (s > 0) hits.push({ key: "text", score: s });
  }
  if (!q.countries.length) return hits;
  // Only a country: what applies to it. With a topic or client, the country narrows the results down.
  if (countryOnly(q)) return q.countries.some((c) => doc.locations.includes(c)) ? [{ key: "country", score: 0.5 }] : [];
  const here = isGlobal(doc.locations) || q.countries.some((c) => doc.locations.includes(c));
  return here ? hits : hits.map((h) => ({ ...h, score: h.score * OTHER_COUNTRY }));
}

const answerSubject = (a: Answer): Subject => ({ tags: a.topics, clientId: a.clientId, title: a.question, content: a.answer, locations: a.locations });

function conversationHits(db: Db, tax: Taxonomy, c: Conversation, q: Interpretation): Hit[] {
  const text = `${c.title}\n${c.messages.map((m) => m.body).join("\n")}`;
  const hits: Hit[] = [];
  for (const t of q.topics) {
    const term = tax.topic.get(t.id)!;
    if (keywordHits(text, [term.label, ...term.keywords]) > 0) hits.push({ key: `topic:${t.id}`, score: MENTIONED });
  }
  for (const cl of q.clients) if (c.clientId === cl.id) hits.push({ key: `client:${cl.id}`, score: 1 });
  if (q.words.length) {
    const s = Math.min(1, keywordHits(text, q.words) / q.words.length) * MENTIONED;
    if (s > 0) hits.push({ key: "text", score: s });
  }
  const location = db.clients.find((x) => x.id === c.clientId)?.location;
  if (!q.countries.length) return hits;
  if (countryOnly(q)) return location && q.countries.includes(location) ? [{ key: "country", score: 0.5 * MENTIONED }] : [];
  return !location || q.countries.includes(location) ? hits : hits.map((h) => ({ ...h, score: h.score * OTHER_COUNTRY }));
}

export interface Expert {
  personId: string;
  score: number;
  /** 0–1, relative to the top expert. */
  relevance: number;
  /** The strongest evidence first (capped); `evidenceCount` is the total. */
  evidence: Evidence[];
  evidenceCount: number;
  documents: number;
  conversations: number;
  /** Colleagues' questions on this they answered. */
  answers: number;
  lastActive: string | null;
  caveat?: string;
}

export interface FormerExpert {
  personId: string;
  leftAt: string;
  evidence: Evidence[];
}

const latest = (evidence: Evidence[]) => evidence.reduce<string | null>((m, e) => (e.at && (!m || e.at > m) ? e.at : m), null);

/**
 * Colleagues ranked by evidence on the documents, client conversations and answers a question is about.
 * Each item's relevance multiplies the (faded) evidence on it; a topic or client someone hid doesn't
 * count for them. People who left are listed separately: their handover briefing holds what they knew.
 * Also returns the answers themselves: someone may have asked this before.
 */
export function whoKnows(db: Db, ledger: Ledger, conversations: Conversation[], answers: Answer[], query: string, viewer: Person, now = Date.now()) {
  const tax = taxonomyOf(db.terms);
  const q = interpret(db, query);
  const answerHits = new Map(answers.map((a) => [a.id, hitsFor(tax, answerSubject(a), q)]));
  const items = [
    ...db.docs.map((d) => ({ hits: hitsFor(tax, d, q), people: ledger.docs.get(d.id), kind: "doc" as const })),
    ...conversations.map((c) => ({ hits: conversationHits(db, tax, c, q), people: ledger.conversations.get(c.id), kind: "conversation" as const })),
    ...answers.map((a) => ({ hits: answerHits.get(a.id)!, people: new Map([[a.answererId, [ledger.answers.get(a.id)!]]]), kind: "answer" as const })),
  ].filter((x) => x.hits.length && x.people);

  const tally = new Map<string, { score: number; evidence: { e: Evidence; s: number }[]; docs: number; conversations: number; answers: number }>();
  for (const item of items) {
    for (const [pid, evidence] of item.people!) {
      const hidden = new Set(db.people.find((p) => p.id === pid)?.hiddenExpertise ?? []);
      const relevance = Math.max(0, ...item.hits.filter((h) => !hidden.has(h.key)).map((h) => h.score));
      if (!relevance) continue;
      const t = tally.get(pid) ?? { score: 0, evidence: [], docs: 0, conversations: 0, answers: 0 };
      for (const e of evidence) {
        const s = relevance * strength(e, now);
        t.score += s;
        t.evidence.push({ e, s });
      }
      if (item.kind === "doc") t.docs++;
      else if (item.kind === "answer") t.answers++;
      else t.conversations++;
      tally.set(pid, t);
    }
  }

  const experts: Expert[] = [];
  const former: FormerExpert[] = [];
  for (const [pid, t] of tally) {
    const p = db.people.find((x) => x.id === pid);
    if (!p || pid === viewer.id || t.score < MIN_SCORE) continue;
    const evidence = t.evidence.sort((a, b) => b.s - a.s).map((x) => x.e);
    if (!p.active) {
      if (p.leftAt) former.push({ personId: pid, leftAt: p.leftAt, evidence: evidence.slice(0, 2) });
      continue;
    }
    const lastActive = latest(evidence);
    let score = t.score;
    let caveat: string | undefined;
    if (p.previousTeamId && p.movedTeamAt) {
      const teamName = db.teams.find((x) => x.id === p.teamId)?.name ?? p.teamId;
      caveat = `Moved to ${teamName} ${timeAgo(p.movedTeamAt, now)}`;
      if (!lastActive || lastActive < p.movedTeamAt) {
        caveat += " and hasn't worked on this since";
        score *= MOVED_AWAY;
      }
    }
    experts.push({ personId: pid, score, relevance: 0, evidence: evidence.slice(0, MAX_EVIDENCE), evidenceCount: evidence.length, documents: t.docs, conversations: t.conversations, answers: t.answers, lastActive, caveat });
  }
  experts.sort((a, b) => b.score - a.score);
  const top = experts.slice(0, MAX_EXPERTS);
  for (const e of top) e.relevance = e.score / (top[0]?.score || 1);
  former.sort((a, b) => (tally.get(b.personId)?.score ?? 0) - (tally.get(a.personId)?.score ?? 0));

  // Asked before: the most relevant answers, recent ones first among equals.
  const asked = answers
    .map((a) => ({ a, s: Math.max(0, ...answerHits.get(a.id)!.map((h) => h.score)) * fade({ action: "", weight: 1, at: a.answeredAt }, now) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s)
    .slice(0, MAX_ANSWERS)
    .map((x) => x.a);
  return {
    query: q,
    experts: top,
    former: former.slice(0, 4),
    answers: withLiveConflicts(db, asked),
    considered: {
      documents: items.filter((i) => i.kind === "doc").length,
      conversations: items.filter((i) => i.kind === "conversation").length,
      answers: items.filter((i) => i.kind === "answer").length,
    },
  };
}

/** Starting points for an empty search: the topics with the most documents for the viewer's country, and their clients. */
export function suggestions(db: Db, myClients: Client[]) {
  const tax = taxonomyOf(db.terms);
  const counts = new Map<string, number>();
  for (const d of db.docs) for (const t of d.tags) if (tax.topic.get(t)?.parent) counts.set(t, (counts.get(t) ?? 0) + 1);
  const topics = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => tax.tagLabel(id));
  return [...topics, ...myClients.slice(0, 4).map((c) => c.name)];
}

// ---------------------------------------------------------------------------------------------
// Person profile

export interface Area {
  /** "topic:salary" or "client:noordkaai": what the person can hide. */
  key: string;
  label: string;
  /** For a sub-topic, its main topic. */
  parentLabel?: string;
  /** 0–1, relative to their strongest area. */
  relevance: number;
  documents: number;
  conversations: number;
  answers: number;
  lastActive: string | null;
  /** No ongoing role and nothing in the last year. */
  fading: boolean;
  hidden: boolean;
  evidence: Evidence[];
}

const RECENT_ANSWERS = 5;

/**
 * Someone's profile, from their evidence: the topics and clients they know (strongest first, each with
 * its evidence), what they're in charge of, the decisions they explained, the questions they answered
 * and who they work with most. Hidden areas, and suggestions to write answers up, are only for the person
 * themselves.
 */
export function profileOf(db: Db, ledger: Ledger, conversations: Conversation[], answers: Answer[], person: Person, viewer: Person, now = Date.now()) {
  const tax = taxonomyOf(db.terms);
  const hidden = new Set(person.hiddenExpertise ?? []);
  const own = viewer.id === person.id;

  const areas = new Map<string, { label: string; parentLabel?: string; s: number; docs: Set<string>; convs: Set<string>; answers: Set<number>; evidence: { e: Evidence; s: number }[] }>();
  const area = (key: string, label: string, parentLabel?: string) =>
    areas.get(key) ?? (areas.set(key, { label, parentLabel, s: 0, docs: new Set(), convs: new Set(), answers: new Set(), evidence: [] }), areas.get(key)!);
  const topicArea = (t: string) => {
    const term = tax.topic.get(t)!;
    return area(`topic:${t}`, term.label, term.parent ? tax.tagLabel(term.parent) : undefined);
  };
  const credit = (a: ReturnType<typeof area>, evidence: Evidence[], ref: { doc?: string; conv?: string; answer?: number }) => {
    for (const e of evidence) {
      const s = strength(e, now);
      a.s += s;
      a.evidence.push({ e, s });
    }
    if (ref.doc) a.docs.add(ref.doc);
    if (ref.conv) a.convs.add(ref.conv);
    if (ref.answer) a.answers.add(ref.answer);
  };

  const worksWith = new Map<string, { s: number; shared: { kind: "doc" | "conversation"; id: string; title: string }[] }>();
  const together = (others: Map<string, Evidence[]>, mine: Evidence[], item: { kind: "doc" | "conversation"; id: string; title: string }) => {
    const myStrength = mine.reduce((n, e) => n + strength(e, now), 0);
    for (const [pid, theirs] of others) {
      if (pid === person.id) continue;
      const w = worksWith.get(pid) ?? { s: 0, shared: [] };
      w.s += Math.min(myStrength, theirs.reduce((n, e) => n + strength(e, now), 0));
      w.shared.push(item);
      worksWith.set(pid, w);
    }
  };

  let documents = 0;
  for (const doc of db.docs) {
    const people = ledger.docs.get(doc.id);
    const mine = people?.get(person.id);
    if (!people || !mine) continue;
    documents++;
    for (const t of tax.mostSpecific(doc.tags)) credit(topicArea(t), mine, { doc: doc.id });
    const client = db.clients.find((c) => c.id === doc.clientId);
    if (client) credit(area(`client:${client.id}`, client.name), mine, { doc: doc.id });
    together(people, mine, { kind: "doc", id: doc.id, title: doc.title });
  }
  let conversationCount = 0;
  for (const c of conversations) {
    const people = ledger.conversations.get(c.id);
    const mine = people?.get(person.id);
    if (!people || !mine) continue;
    conversationCount++;
    const client = db.clients.find((x) => x.id === c.clientId);
    if (client) credit(area(`client:${client.id}`, client.name), mine, { conv: c.id });
    together(people, mine, { kind: "conversation", id: c.id, title: c.title });
  }
  const answered = answers.filter((a) => a.answererId === person.id);
  for (const a of answered) {
    const e = ledger.answers.get(a.id);
    if (!e) continue;
    for (const t of tax.mostSpecific(a.topics)) credit(topicArea(t), [e], { answer: a.id });
    const client = db.clients.find((c) => c.id === a.clientId);
    if (client) credit(area(`client:${client.id}`, client.name), [e], { answer: a.id });
  }

  const listed = [...areas].filter(([key]) => own || !hidden.has(key));
  const max = Math.max(1, ...listed.filter(([key]) => !hidden.has(key)).map(([, a]) => a.s));
  const toArea = ([key, a]: (typeof listed)[number]): Area & { s: number } => {
    const evidence = a.evidence.sort((x, y) => y.s - x.s).map((x) => x.e);
    const lastActive = latest(evidence);
    // Someone who left has no ongoing roles, even on documents still waiting for a new owner.
    const ongoing = person.active && evidence.some((e) => !e.at);
    return {
      key,
      label: a.label,
      parentLabel: a.parentLabel,
      s: a.s,
      relevance: hidden.has(key) ? 0 : a.s / max,
      documents: a.docs.size,
      conversations: a.convs.size,
      answers: a.answers.size,
      lastActive,
      fading: !ongoing && (!lastActive || daysSince(lastActive, now) > 365),
      hidden: hidden.has(key),
      evidence: evidence.slice(0, MAX_EVIDENCE),
    };
  };
  const byStrength = (a: { s: number; hidden: boolean }, b: { s: number; hidden: boolean }) => Number(a.hidden) - Number(b.hidden) || b.s - a.s;
  const strip = ({ s: _s, ...a }: Area & { s: number }): Area => a;
  const all = listed.map(toArea).filter((a) => a.s >= 1);
  const topics = all.filter((a) => a.key.startsWith("topic:")).sort(byStrength).map(strip);
  const clients = all.filter((a) => a.key.startsWith("client:")).sort(byStrength).map(strip);

  const decisions = db.overrides
    .filter((o) => o.personId === person.id)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((o) => ({ ...o, docTitle: db.docs.find((d) => d.id === o.docId)?.title ?? o.docId }));

  const inCharge = db.docs
    .filter((d) => d.ownerId === person.id && !d.supersededById)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((d) => {
      const lastVerification = [...d.verifications].sort((a, b) => b.at.localeCompare(a.at))[0];
      return { id: d.id, title: d.title, status: d.status, updatedAt: d.updatedAt, lastVerifiedAt: lastVerification?.at ?? null, confidential: !!d.confidential };
    });

  const colleagues = [...worksWith]
    .map(([personId, w]) => ({ personId, s: w.s, shared: w.shared, active: !!db.people.find((p) => p.id === personId)?.active }))
    .filter((w) => w.s >= 2)
    .sort((a, b) => Number(b.active) - Number(a.active) || b.s - a.s)
    .slice(0, 6)
    .map(({ s: _s, active: _a, ...w }) => w);

  const verifiedLastYear = db.docs.filter((d) => d.verifications.some((v) => v.personId === person.id && daysSince(v.at, now) <= 365)).length;
  return {
    personId: person.id,
    topics,
    clients,
    decisions,
    inCharge,
    worksWith: colleagues,
    // Newest first, like everything else; only the ones about topics they didn't hide, for anyone else.
    answers: withLiveConflicts(db, answered.filter((a) => own || !tax.mostSpecific(a.topics).some((t) => hidden.has(`topic:${t}`))).slice(0, RECENT_ANSWERS)),
    faqs: own ? faqSuggestions(db, answers, person.id, now) : [],
    stats: {
      documents,
      conversations: conversationCount,
      verifiedLastYear,
      decisions: decisions.length,
      answeredLastYear: answered.filter((a) => daysSince(a.answeredAt, now) <= 365).length,
    },
  };
}

export type Profile = ReturnType<typeof profileOf>;
export type WhoKnows = ReturnType<typeof whoKnows>;
