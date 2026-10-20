import crypto from "node:crypto";
import { captureAnswers, sharedOnly, topicsAndPlace, viewOf, withLiveConflicts } from "./answers";
import { addMessages, createBoardThread, insertNotifications, loadAnswers, loadBoard, loadWorld, setAsked, setSolved } from "./db";
import { whoKnows, type Expert } from "./expertise";
import { HttpError } from "./http";
import { expertiseInputs, whoKnowsFor } from "./service";
import { daysSince } from "./time";
import type { BoardThread, Person } from "./types";

/**
 * The message board: questions everyone can see, so answers stop living only in private chats.
 * - While someone types a question, it's answered from what's already there: answers given before, the
 *   documents it's about and who knows (the page asks Who knows as they type). Often that's enough.
 * - A posted question goes to the few colleagues who know most about it, not to everyone. If nobody has
 *   answered after two days, the next ones are asked.
 * - Answers are public and captured like any other (answers.ts); the asker marks the one that solved it,
 *   which counts more for whoever gave it.
 */

const ASK_FIRST = 3;
const ASK_MORE = 2;
const NUDGE_DAYS = 2;
const MAX_ASKED = 7;

/** Why someone was asked: their strongest evidence on it. */
function why(e: Expert) {
  const top = e.evidence[0];
  return top ? `${top.action} ${top.doc?.title ?? top.answer?.question ?? top.conversation?.title ?? ""}`.trim() : "Knows this topic";
}

/** Posts a question and asks the colleagues who know most about it. */
export async function askQuestion(viewer: Person, input: { title: string; details?: string }) {
  const title = input.title.trim();
  const details = input.details?.trim() ?? "";
  if (!title) throw new HttpError(400, "Write your question.");
  const { db, ledger, conversations, shared } = await expertiseInputs();
  const place = await topicsAndPlace(db, title, details, viewer);
  const experts = whoKnows(db, ledger, conversations, shared, `${title} ${details}`, viewer).experts.slice(0, ASK_FIRST);
  const id = `board-${crypto.randomUUID()}`;
  const at = new Date().toISOString();
  await createBoardThread({ id, title, askerId: viewer.id, askerName: viewer.name, askerEmail: viewer.email, body: details || title, at, topics: place.topics, locations: place.locations, askedIds: experts.map((e) => e.personId) });
  await insertNotifications(experts.map((e) => ({ recipientId: e.personId, actorId: viewer.id, kind: "question" as const, docId: id, docTitle: title, changes: [], reason: why(e) })));
  return { id, asked: experts.map((e) => e.personId) };
}

/** An answer on the board; the asker hears about it. Capturing it (answers.ts) happens after. */
export async function reply(viewer: Person, threadId: string, body: string) {
  const [t] = await loadBoard([threadId]);
  if (!t) throw new HttpError(404, "Question not found");
  const text = body.trim();
  if (!text) throw new HttpError(400, "Write an answer.");
  const me = { personId: viewer.id, name: viewer.name, email: viewer.email };
  await addMessages(t.id, [{ personId: viewer.id, authorName: viewer.name, authorEmail: viewer.email, sentAt: new Date().toISOString(), body: text }], [me]);
  if (viewer.id !== t.askerId) {
    await insertNotifications([{ recipientId: t.askerId, actorId: viewer.id, kind: "board_answer" as const, docId: t.id, docTitle: t.title, changes: [], reason: text.replace(/\s+/g, " ").slice(0, 140) }]);
  }
}

/** The asker marks the answer that solved it (or none). */
export async function markSolved(viewer: Person, threadId: string, messageId: number | null) {
  const [t] = await loadBoard([threadId]);
  if (!t) throw new HttpError(404, "Question not found");
  if (t.askerId !== viewer.id) throw new HttpError(403, "Only the person who asked can mark what solved it.");
  if (messageId !== null && !t.replies.some((m) => m.id === messageId && m.personId && m.personId !== t.askerId)) throw new HttpError(400, "That isn't an answer to this question.");
  await setSolved(t.id, messageId);
}

const answered = (t: BoardThread) => t.replies.some((m) => m.personId && m.personId !== t.askerId);

/** Questions nobody answered for NUDGE_DAYS go to the next colleagues who know about them. */
export async function askNextWhenUnanswered(now = Date.now()) {
  const stale = (await loadBoard()).filter((t) => !t.solvedMessageId && !answered(t) && daysSince(t.lastAskedAt, now) >= NUDGE_DAYS && t.askedIds.length < MAX_ASKED);
  if (!stale.length) return;
  const { db, ledger, conversations, shared } = await expertiseInputs();
  const at = new Date(now).toISOString();
  for (const t of stale) {
    const asker = db.people.find((p) => p.id === t.askerId);
    if (!asker) continue;
    const next = whoKnows(db, ledger, conversations, shared, t.title, asker).experts.filter((e) => !t.askedIds.includes(e.personId)).slice(0, ASK_MORE);
    // Asked again later either way, so a question nobody else knows about isn't looked at on every visit.
    await setAsked(t.id, [...t.askedIds, ...next.map((e) => e.personId)], at);
    await insertNotifications(next.map((e) => ({ recipientId: e.personId, actorId: t.askerId, kind: "question" as const, docId: t.id, docTitle: t.title, changes: [], reason: `Nobody has answered yet. ${why(e)}` })));
  }
}

export interface ThreadSummary {
  id: string;
  title: string;
  askerId: string;
  askedAt: string;
  lastActivity: string;
  answers: number;
  solved: boolean;
  topics: string[];
  askedIds: string[];
}

/** The board: its questions, and answers from chats that the people who gave them shared. */
export async function boardList(viewer: Person) {
  await askNextWhenUnanswered();
  await captureAnswers();
  const [db, threads, answers] = await Promise.all([loadWorld(), loadBoard(), loadAnswers()]);
  const questions: ThreadSummary[] = threads.map((t) => ({
    id: t.id,
    title: t.title,
    askerId: t.askerId,
    askedAt: t.askedAt,
    lastActivity: t.replies.at(-1)?.sentAt ?? t.askedAt,
    answers: t.replies.filter((m) => m.personId !== t.askerId).length,
    solved: !!t.solvedMessageId,
    topics: t.topics,
    askedIds: t.askedIds,
  }));
  const fromChats = withLiveConflicts(db, sharedOnly(answers).filter((a) => a.source !== "board").map((a) => viewOf(a, viewer)));
  return { questions, fromChats };
}

/** One question with its answers (as captured: conflicts, solved), and what else is known about it. */
export async function boardThread(id: string, viewer: Person) {
  await captureAnswers();
  const [[t], answers, db] = await Promise.all([loadBoard([id]), loadAnswers(), loadWorld()]);
  if (!t) return null;
  const captured = withLiveConflicts(db, answers.filter((a) => a.conversationId === t.id).map((a) => viewOf(a, viewer)));
  const known = await whoKnowsFor(t.title, viewer);
  const related = "experts" in known ? { ...known, answers: known.answers.filter((a) => a.conversationId !== t.id) } : null;
  return { thread: t, captured, related };
}
