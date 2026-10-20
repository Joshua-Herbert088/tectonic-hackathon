import type { Answer, AnswerView, Conversation } from "./types";

/** The parts of answers.ts that pages need too; pure, so they run in the browser as well. */

/** The page where anyone can read a shared answer: its board thread, or its own page for a private chat. */
export const publicHref = (a: Pick<Answer, "id" | "source" | "conversationId" | "answerMessageId">) => (a.source === "board" ? `/board/${a.conversationId}#m${a.answerMessageId}` : `/board/answers/${a.id}`);

/** Only conversations among colleagues have their answers kept: client conversations have their own handover documents. */
export const isInternal = (c: Pick<Conversation, "clientId" | "participants">) => !c.clientId && c.participants.length > 1 && c.participants.every((p) => !!p.personId);

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** A markdown link title: no straight double quotes, which would end it. */
const linkTitle = (s: string) => s.replace(/"/g, "”");

/**
 * An FAQ written from answers someone gave colleagues. Every answer is quoted as written and links to
 * where anyone can read it: the board question, or the answer's own page (never into a private chat), and
 * who asked from a chat isn't named. The review page shows the same markdown that's saved.
 */
export function composeFaqMarkdown(title: string, answers: AnswerView[], answererName: string) {
  const out = [`# ${title}`, "", `Questions colleagues asked ${answererName}, with the answers as written. Each answer links to where it was given.`];
  for (const a of answers) {
    const lines = a.answer.split("\n");
    const where = `${a.source === "board" ? "Answered on the board" : a.source === "email" ? "Answered by email" : "Answered in a Teams chat"}, ${day(a.answeredAt)}`;
    const href = a.source === "board" ? a.href : `/board/answers/${a.id}`;
    out.push("", `**Q: ${a.question}**`, `A: ${lines.join(" ")} ([source](${href} "${linkTitle(where)}"))`);
  }
  return out.join("\n") + "\n";
}
