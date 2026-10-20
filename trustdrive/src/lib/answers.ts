import { isInternal } from "./answerDoc";
import { overlaps } from "./appliesTo";
import { checkConflicts, extractFacts } from "./conflicts";
import { answerProgress, deleteAnswers, insertAnswers, insertNotifications, loadAnswers, loadBoard, loadConversations, loadWorld, setAnswersThrough, setAnswerSharing, setPersonSharing, type NewAnswer } from "./db";
import { citationHref } from "./handoverDoc";
import { redact, ruleKind, statementsOf } from "./handoverDraft";
import { fold } from "./lexicon";
import { log } from "./log";
import { suggestTags } from "./tagging";
import { GLOBAL, taxonomyOf, type Taxonomy } from "./taxonomy";
import { daysSince } from "./time";
import type { Answer, AnswerConflict, AnswerView, BoardThread, Conversation, Db, Doc, Message, Person } from "./types";

/**
 * Questions colleagues ask each other, and the answers they get, captured in the background so the next
 * person with the same question finds the answer (and who gave it). They come from two places:
 * - Private email and Teams chats among colleagues (not client conversations: those have their own
 *   handover documents). A question is a message ending in "?"; the answer is the next reply by another
 *   colleague that says something (not "let me check", not a question back). The person who answered
 *   decides whether others see it: they're asked quietly afterwards (never in the chat itself), unless
 *   they chose to always share, or never to keep their answers. Others see it without the asker's name
 *   and can't open the chat; the answer gets a page of its own.
 * - The message board (board.ts): every reply by another colleague is an answer, public from the start,
 *   and the asker can mark the one that solved it.
 * Answers are quoted, never rewritten. Left out: conversations marked "Don't keep for others", and
 * exchanges with personal data, health information or a colleague's full name in them. Each answer gets
 * topics (Jev or the keyword rules) and goes through the conflict check against the drive; once it's
 * shared, a contradiction shows on the document and its owner is told. Someone who answered the same
 * topic three times is offered to write it up as an FAQ.
 */

/** Ends with a question mark (an emoji after it is fine). */
const QUESTION = /\?\s*\S{0,3}$/;
/** Not an answer yet: "Let me check and come back to you." */
const DEFER = /\b(i'll|i will|let me|ik zal|ik kijk|laat me|je vais|je regarde|ich werde|ich schaue)\b.*\b(check|look|ask|come back|get back|find out|kijk|vraag|navraag|regarde|demande|schaue|frage|nach)/i;
/** Topic suggestions below this aren't kept, nor sub-topics clearly weaker than the best one. */
const MIN_TOPIC = 0.45;
const NEAR_BEST = 0.9;
/** Answers on one topic before an FAQ is suggested. */
export const FAQ_AFTER = 3;

const substantive = (body: string) => statementsOf(body).statements.filter((s) => !QUESTION.test(s) && !DEFER.test(s) && ruleKind(s) !== "noise");

export interface Exchange {
  question: Message;
  /** The answering colleague's consecutive messages. */
  answers: Message[];
  askerId: string;
  answererId: string;
  questionText: string;
  answerLines: string[];
  /** Why it isn't kept, if it isn't. */
  skipped?: string;
}

/** Questions in a conversation and the answers they got. */
export function findExchanges(c: Conversation, people: Person[]): Exchange[] {
  const out: Exchange[] = [];
  const msgs = c.messages;
  for (let i = 0; i < msgs.length; i++) {
    const q = msgs[i];
    if (!q.personId) continue;
    const statements = statementsOf(q.body).statements;
    let last = -1;
    statements.forEach((s, k) => QUESTION.test(s) && (last = k));
    if (last < 0) continue;

    // The answer: the first reply by another colleague that says something, unless the asker asks something new first.
    let k = i + 1;
    for (; k < msgs.length; k++) {
      const m = msgs[k];
      if (m.personId === q.personId && statementsOf(m.body).statements.some((s) => QUESTION.test(s))) k = msgs.length;
      else if (m.personId && m.personId !== q.personId && substantive(m.body).length) break;
    }
    if (k >= msgs.length) continue;
    const answererId = msgs[k].personId!;
    const answers: Message[] = [];
    for (let n = k; n < msgs.length && msgs[n].personId === answererId; n++) answers.push(msgs[n]);

    const questionText = statements.slice(Math.max(0, last - 2), last + 1).join(" ");
    const answerLines = answers.flatMap((m) => substantive(m.body));
    const skipped = skipReason([questionText, ...answerLines].join("\n"), people);
    out.push({ question: q, answers, askerId: q.personId, answererId, questionText, answerLines, skipped });
    i = k + answers.length - 1;
  }
  return out;
}

/**
 * A short question mentions side topics ("per calendar year" isn't about calendars): keep the strongest
 * sub-topics and their main topics, or the main topics when no sub-topic fits.
 */
function answerTopics(tax: Taxonomy, suggested: { value: string; confidence: number }[]) {
  const known = suggested.filter((t) => t.confidence >= MIN_TOPIC && tax.topic.has(t.value));
  const leaves = known.filter((t) => tax.topic.get(t.value)!.parent);
  const best = Math.max(0, ...leaves.map((t) => t.confidence));
  const kept = leaves.filter((t) => t.confidence >= best * NEAR_BEST).map((t) => t.value);
  return kept.length ? [...tax.withParents(kept)] : known.map((t) => t.value);
}

/** On the board, every reply by another colleague that says something answers the question. */
export function boardExchanges(t: BoardThread, people: Person[]): Exchange[] {
  return t.replies
    .filter((m) => m.personId && m.personId !== t.askerId && substantive(m.body).length)
    .map((m) => {
      const answerLines = substantive(m.body);
      return { question: t.question, answers: [m], askerId: t.askerId, answererId: m.personId!, questionText: t.title, answerLines, skipped: skipReason([t.title, ...answerLines].join("\n"), people) };
    });
}

function skipReason(text: string, people: Person[]) {
  const folded = fold(text);
  if (redact(text).sensitive) return "personal data or health information";
  if (people.some((p) => folded.includes(fold(p.name)))) return "about a colleague by name";
  return undefined;
}

/** Topics, country and client of a question (and answer): the country it names, or else the person's own. */
export async function topicsAndPlace(db: Db, question: string, content: string, person: Person | undefined) {
  const tags = await suggestTags(db, { title: question, content, defaultTeamId: person?.teamId });
  const own = person && person.location !== GLOBAL ? [person.location] : [GLOBAL];
  return {
    topics: answerTopics(taxonomyOf(db.terms), tags.topics),
    locations: tags.location.value !== GLOBAL && tags.location.confidence >= 0.5 ? [tags.location.value] : own,
    clientId: tags.client?.value ?? null,
    method: tags.method,
  };
}

async function toAnswer(db: Db, c: { id: string }, x: Exchange, sharing: Answer["sharing"]): Promise<NewAnswer> {
  const answerer = db.people.find((p) => p.id === x.answererId);
  const question = redact(x.questionText).text;
  const content = redact(x.answerLines.join("\n")).text;
  const { topics, locations, clientId, method } = await topicsAndPlace(db, question, content, answerer);
  const check = await checkConflicts(db, { title: question, content, locations, teamId: answerer?.teamId ?? db.teams[0].id });
  // Only clear contradictions: a short answer next to a document is "possibly" in conflict too often to be useful.
  const worst = check.hard[0];
  return {
    conversationId: c.id,
    questionMessageId: x.question.id,
    answerMessageId: x.answers[0].id,
    askerId: x.askerId,
    answererId: x.answererId,
    question,
    answer: content,
    askedAt: x.question.sentAt,
    answeredAt: x.answers.at(-1)!.sentAt,
    topics,
    locations,
    clientId,
    conflict: worst
      ? { docId: worst.existing.docId, title: worst.existing.title, lineNo: worst.existing.lineNo, lineText: worst.existing.lineText, answerLine: worst.lineText, probability: worst.probability, severity: worst.severity, ownerId: worst.existing.ownerId }
      : null,
    method: method === "jev" && check.method === "jev" ? "jev" : "rules",
    sharing,
  };
}

/** The owner of a document a shared answer contradicts hears about it, unless they gave the answer themselves. */
async function notifyContradictions(db: Db, answers: { id: number; answererId: string; question: string; conflict?: AnswerConflict | null }[]) {
  const active = (id: string | null | undefined) => !!id && db.people.some((p) => p.id === id && p.active);
  await insertNotifications(
    answers
      .filter((a) => a.conflict?.severity === "hard" && a.conflict.ownerId !== a.answererId && active(a.conflict.ownerId))
      .map((a) => ({
        recipientId: a.conflict!.ownerId!,
        actorId: a.answererId,
        kind: "answer" as const,
        docId: a.conflict!.docId,
        docTitle: a.conflict!.title,
        otherDocId: String(a.id),
        otherDocTitle: a.question,
        changes: [{ lineNo: a.conflict!.lineNo, before: a.conflict!.lineText, after: a.conflict!.answerLine }],
        reason: a.question,
      })),
  );
}

/** Quietly, in the bell: an answer someone gave in a chat could help others, if they share it. */
async function askToShare(rows: (NewAnswer & { id: number })[]) {
  await insertNotifications(
    rows.map((r) => ({ recipientId: r.answererId, actorId: r.askerId, kind: "share" as const, docId: r.conversationId, docTitle: r.question, otherDocId: String(r.id), changes: [], reason: r.answer.split("\n")[0] })),
  );
}

async function run() {
  try {
    const [progress, conversations, board] = await Promise.all([answerProgress(), loadConversations(), loadBoard()]);
    const lastId = (msgs: Message[]) => Math.max(...msgs.map((m) => m.id));
    const isNew = (id: string, msgs: Message[]) => msgs.length > 0 && (progress.get(id)?.through ?? 0) < lastId(msgs);
    const chats = conversations.filter((c) => isInternal(c) && !c.keepPrivate && isNew(c.id, c.messages));
    const threads = board.filter((t) => isNew(t.id, [t.question, ...t.replies]));
    if (!chats.length && !threads.length) return;
    const [db, existing] = await Promise.all([loadWorld(), loadAnswers()]);
    const askedBefore = new Set(existing.map((a) => a.questionMessageId));
    const answeredBefore = new Set(existing.map((a) => a.answerMessageId));
    const sharingOf = (id: string) => db.people.find((p) => p.id === id)?.answerSharing ?? "ask";

    const store = async (id: string, rows: NewAnswer[], through: number) => {
      const inserted = new Map((await insertAnswers(rows)).map((r) => [r.answerMessageId, r.id]));
      const kept = rows.flatMap((r) => (inserted.has(r.answerMessageId) ? [{ ...r, id: inserted.get(r.answerMessageId)! }] : []));
      await notifyContradictions(db, kept.filter((r) => r.sharing === "shared"));
      await askToShare(kept.filter((r) => r.sharing === "pending"));
      await setAnswersThrough(id, through);
      if (kept.length) log.info("answers captured", { conversationId: id, answers: kept.length });
    };

    for (const c of chats) {
      // One answer per question in a chat; someone who never wants their answers kept isn't stored at all.
      const fresh = findExchanges(c, db.people).filter((x) => !x.skipped && !askedBefore.has(x.question.id) && sharingOf(x.answererId) !== "never");
      await store(c.id, await Promise.all(fresh.map((x) => toAnswer(db, c, x, sharingOf(x.answererId) === "always" ? "shared" : "pending"))), lastId(c.messages));
    }
    for (const t of threads) {
      const fresh = boardExchanges(t, db.people).filter((x) => !x.skipped && !answeredBefore.has(x.answers[0].id));
      await store(t.id, await Promise.all(fresh.map((x) => toAnswer(db, t, x, "shared"))), lastId([t.question, ...t.replies]));
    }
  } catch (e) {
    // Background work: a failure is retried on the next call, since nothing was marked as done.
    log.error("capturing answers failed", { error: (e as Error).message });
  }
}

// One run at a time; a call during a run gets one more run after it, shared by everyone who asks meanwhile.
let current: Promise<void> | null = null;
let next: Promise<void> | null = null;

/**
 * Captures answers from conversations and board threads with messages that weren't looked at yet. Cheap
 * when there's nothing new, so pages that show answers call it first; sending a message calls it in the
 * background.
 */
export function captureAnswers(): Promise<void> {
  if (!current) {
    current = run().finally(() => (current = null));
    return current;
  }
  next ??= current.then(() => {
    next = null;
    return captureAnswers();
  });
  return next;
}

/**
 * The person who answered decides about answers waiting for them: share them, or keep them to themselves
 * (they're deleted). `always` also sets what happens from now on ("always share" / "never keep").
 */
export async function decideSharing(viewer: Person, answerIds: number[], share: boolean, always = false) {
  const [db, answers] = await Promise.all([loadWorld(), loadAnswers()]);
  const pending = answers.filter((a) => a.answererId === viewer.id && a.sharing === "pending");
  const chosen = always ? pending : pending.filter((a) => answerIds.includes(a.id));
  if (always) await setPersonSharing(viewer.id, share ? "always" : "never");
  if (share) {
    await setAnswerSharing(chosen.map((a) => a.id), viewer.id, "shared");
    await notifyContradictions(db, chosen);
  } else await deleteAnswers(chosen.map((a) => a.id), viewer.id);
  return { decided: chosen.length };
}

/** Changing the setting on one's profile also decides the answers still waiting. */
export async function setSharingPreference(viewer: Person, preference: "ask" | "always" | "never") {
  if (preference === "ask") return setPersonSharing(viewer.id, "ask");
  await decideSharing(viewer, [], preference === "always", true);
}

/** Only shared answers count anywhere; waiting ones are only for the person who gave them. */
export const sharedOnly = (answers: Answer[]) => answers.filter((a) => a.sharing === "shared");

/** The page where anyone can read a shared answer: its board thread, or its own page for a private chat. */
export const publicHref = (a: Pick<Answer, "id" | "source" | "conversationId" | "answerMessageId">) => (a.source === "board" ? `/board/${a.conversationId}#m${a.answerMessageId}` : `/board/answers/${a.id}`);

/**
 * An answer as `viewer` may see it. From a private chat, only the people on it see who asked and can open
 * it; for everyone else the asker is "a colleague" and the chat's title (its people's names) is hidden.
 */
export function viewOf(a: Answer, viewer: Person): AnswerView {
  const board = a.source === "board";
  const onIt = board || a.participantIds.includes(viewer.id) || a.answererId === viewer.id || a.askerId === viewer.id;
  const { askerId, participantIds: _p, ...rest } = a;
  return {
    ...rest,
    askerId: onIt ? askerId : undefined,
    conversationTitle: onIt ? a.conversationTitle : a.source === "email" ? "an email" : "a Teams chat",
    canOpen: onIt,
    href: board ? publicHref(a) : onIt ? citationHref(a.conversationId, a.answerMessageId, a.answer.split("\n")[0]) : publicHref(a),
  };
}

/** The answer's contradiction, if the document still says what it contradicted (someone may have fixed it). */
export function liveConflict(db: Db, a: { conflict?: AnswerConflict }) {
  const doc = a.conflict && db.docs.find((d) => d.id === a.conflict!.docId);
  return doc && extractFacts(doc.content).some((f) => f.text === a.conflict!.lineText) ? a.conflict : undefined;
}

/** Answers with only their current contradictions. */
export const withLiveConflicts = <T extends { conflict?: AnswerConflict }>(db: Db, answers: T[]) => answers.map((a) => ({ ...a, conflict: liveConflict(db, a) }));

/** Answers relevant to a document: ones that contradict it first, then ones on its sub-topics for its countries. */
export function answersForDoc(db: Db, doc: Doc, answers: AnswerView[], limit = 4) {
  const tax = taxonomyOf(db.terms);
  const topics = new Set(doc.tags.filter((t) => tax.topic.get(t)?.parent));
  const against = (a: AnswerView) => liveConflict(db, a)?.docId === doc.id;
  return withLiveConflicts(
    db,
    answers
      .filter((a) => against(a) || (overlaps(a.locations, doc.locations) && a.topics.some((t) => topics.has(t))))
      .sort((a, b) => Number(against(b)) - Number(against(a)) || b.answeredAt.localeCompare(a.answeredAt))
      .slice(0, limit),
  );
}

export interface FaqSuggestion {
  topic: string;
  label: string;
  answerIds: number[];
  askers: number;
}

/** Topics someone answered at least FAQ_AFTER times in the last year that aren't written up yet. */
export function faqSuggestions(db: Db, answers: Answer[], personId: string, now = Date.now()): FaqSuggestion[] {
  const tax = taxonomyOf(db.terms);
  const byTopic = new Map<string, Answer[]>();
  for (const a of answers) {
    if (a.answererId !== personId || a.faqDocId || a.faqDismissedAt || daysSince(a.answeredAt, now) > 365) continue;
    for (const t of tax.mostSpecific(a.topics)) byTopic.set(t, [...(byTopic.get(t) ?? []), a]);
  }
  return [...byTopic]
    .filter(([, as]) => as.length >= FAQ_AFTER)
    .map(([topic, as]) => ({ topic, label: tax.tagLabel(topic), answerIds: as.map((a) => a.id), askers: new Set(as.map((a) => a.askerId)).size }))
    .sort((a, b) => b.answerIds.length - a.answerIds.length);
}

/** The answers someone gave on a topic that aren't written up yet (shared or still waiting), oldest first, for the FAQ page. */
export function faqAnswers(db: Db, answers: Answer[], person: Person, topic: string) {
  const tax = taxonomyOf(db.terms);
  return withLiveConflicts(
    db,
    answers
      .filter((a) => a.answererId === person.id && !a.faqDocId && tax.mostSpecific(a.topics).includes(topic))
      .sort((a, b) => a.answeredAt.localeCompare(b.answeredAt))
      .map((a) => viewOf(a, person)),
  );
}
