import { isInternal } from "./answerDoc";
import { overlaps } from "./appliesTo";
import { checkConflicts, extractFacts } from "./conflicts";
import { answerProgress, insertAnswers, insertNotifications, loadAnswers, loadConversations, loadWorld, setAnswersThrough, type NewAnswer } from "./db";
import { redact, ruleKind, statementsOf } from "./handoverDraft";
import { fold } from "./lexicon";
import { log } from "./log";
import { suggestTags } from "./tagging";
import { GLOBAL, taxonomyOf, type Taxonomy } from "./taxonomy";
import { daysSince } from "./time";
import type { Answer, Conversation, Db, Doc, Message, Person } from "./types";

/**
 * Questions colleagues ask each other by email or Teams, and the answers they get, captured in the
 * background so the next person with the same question finds the answer (and who gave it).
 * - Only conversations among colleagues: client conversations have their own handover documents.
 * - A question is a message ending in "?"; the answer is the next reply by another colleague that says
 *   something (not "let me check", not a question back). Answers are quoted, never rewritten.
 * - Left out: conversations marked "Don't keep for others", and exchanges with personal data, health
 *   information or a colleague's full name in them.
 * - Each answer gets topics (Jev or the keyword rules) and goes through the conflict check against the
 *   drive. When it contradicts a document, the document's owner is told.
 * - Someone who answered the same topic three times is offered to write it up as an FAQ.
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
    const all = [questionText, ...answerLines].join("\n");
    const folded = fold(all);
    const skipped = redact(all).sensitive
      ? "personal data or health information"
      : people.some((p) => folded.includes(fold(p.name)))
        ? "about a colleague by name"
        : undefined;
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

async function toAnswer(db: Db, c: Conversation, x: Exchange): Promise<NewAnswer> {
  const answerer = db.people.find((p) => p.id === x.answererId);
  const tax = taxonomyOf(db.terms);
  const question = redact(x.questionText).text;
  const content = redact(x.answerLines.join("\n")).text;
  const tags = await suggestTags(db, { title: question, content, defaultTeamId: answerer?.teamId });
  const own = answerer && answerer.location !== GLOBAL ? [answerer.location] : [GLOBAL];
  const locations = tags.location.value !== GLOBAL && tags.location.confidence >= 0.5 ? [tags.location.value] : own;
  const check = await checkConflicts(db, { title: question, content, locations, teamId: answerer?.teamId ?? db.teams[0].id });
  // Only clear contradictions: a short chat answer next to a document is "possibly" in conflict too often to be useful.
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
    topics: answerTopics(tax, tags.topics),
    locations,
    clientId: tags.client?.value ?? null,
    conflict: worst
      ? { docId: worst.existing.docId, title: worst.existing.title, lineNo: worst.existing.lineNo, lineText: worst.existing.lineText, answerLine: worst.lineText, probability: worst.probability, severity: worst.severity, ownerId: worst.existing.ownerId }
      : null,
    method: tags.method === "jev" && check.method === "jev" ? "jev" : "rules",
  };
}

/** The owner of a document a new answer contradicts hears about it, unless they gave the answer themselves. */
async function notifyContradictions(db: Db, c: Conversation, rows: NewAnswer[]) {
  const active = (id: string | null | undefined) => !!id && db.people.some((p) => p.id === id && p.active);
  await insertNotifications(
    rows
      .filter((r) => r.conflict?.severity === "hard" && r.conflict.ownerId !== r.answererId && active(r.conflict.ownerId))
      .map((r) => ({
        recipientId: r.conflict!.ownerId!,
        actorId: r.answererId,
        kind: "answer" as const,
        docId: r.conflict!.docId,
        docTitle: r.conflict!.title,
        otherDocId: c.id,
        otherDocTitle: c.title,
        changes: [{ lineNo: r.conflict!.lineNo, before: r.conflict!.lineText, after: r.conflict!.answerLine }],
        reason: r.question,
      })),
  );
}

async function run() {
  try {
    const [progress, conversations] = await Promise.all([answerProgress(), loadConversations()]);
    const lastId = (c: Conversation) => Math.max(...c.messages.map((m) => m.id));
    const todo = conversations.filter((c) => isInternal(c) && !c.keepPrivate && c.messages.length && (progress.get(c.id)?.through ?? 0) < lastId(c));
    if (!todo.length) return;
    const [db, existing] = await Promise.all([loadWorld(), loadAnswers()]);
    const known = new Set(existing.map((a) => a.questionMessageId));
    for (const c of todo) {
      const fresh = findExchanges(c, db.people).filter((x) => !x.skipped && !known.has(x.question.id));
      const rows = await Promise.all(fresh.map((x) => toAnswer(db, c, x)));
      const inserted = new Set((await insertAnswers(rows)).map((r) => r.questionMessageId));
      await notifyContradictions(db, c, rows.filter((r) => inserted.has(r.questionMessageId)));
      await setAnswersThrough(c.id, lastId(c));
      if (rows.length) log.info("answers captured", { conversationId: c.id, answers: inserted.size });
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
 * Captures answers from conversations with messages that weren't looked at yet. Cheap when there's
 * nothing new, so pages that show answers call it first; sending a message calls it in the background.
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

/** The answer's contradiction, if the document still says what it contradicted (someone may have fixed it). */
export function liveConflict(db: Db, a: Answer) {
  const doc = a.conflict && db.docs.find((d) => d.id === a.conflict!.docId);
  return doc && extractFacts(doc.content).some((f) => f.text === a.conflict!.lineText) ? a.conflict : undefined;
}

/** Answers with only their current contradictions. */
export const withLiveConflicts = (db: Db, answers: Answer[]) => answers.map((a) => ({ ...a, conflict: liveConflict(db, a) }));

/** Answers relevant to a document: ones that contradict it first, then ones on its sub-topics for its countries. */
export function answersForDoc(db: Db, doc: Doc, answers: Answer[], limit = 4) {
  const tax = taxonomyOf(db.terms);
  const topics = new Set(doc.tags.filter((t) => tax.topic.get(t)?.parent));
  const against = (a: Answer) => liveConflict(db, a)?.docId === doc.id;
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

/** The answers someone gave on a topic that aren't written up yet, oldest first, for the FAQ page. */
export function faqAnswers(db: Db, answers: Answer[], personId: string, topic: string) {
  const tax = taxonomyOf(db.terms);
  return withLiveConflicts(
    db,
    answers.filter((a) => a.answererId === personId && !a.faqDocId && tax.mostSpecific(a.topics).includes(topic)).sort((a, b) => a.answeredAt.localeCompare(b.answeredAt)),
  );
}
