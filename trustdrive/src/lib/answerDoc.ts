import { citationHref } from "./handoverDoc";
import type { Answer, Conversation } from "./types";

/** The parts of answers.ts that pages need too; pure, so they run in the browser as well. */

/** Only conversations among colleagues have their answers kept: client conversations have their own handover documents. */
export const isInternal = (c: Pick<Conversation, "clientId" | "participants">) => !c.clientId && c.participants.length > 1 && c.participants.every((p) => !!p.personId);

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** A markdown link title: no straight double quotes, which would end it. */
const linkTitle = (s: string) => s.replace(/"/g, "”");

/**
 * An FAQ written from answers someone gave colleagues in chat. Every answer is quoted as written and
 * links to the message it comes from, like a client handover document. The review page shows the same
 * markdown that's saved.
 */
export function composeFaqMarkdown(title: string, answers: Answer[], answererName: string, nameOf: (personId: string) => string) {
  const out = [`# ${title}`, "", `Questions colleagues asked ${answererName} by email and Teams, with the answers as written. Each answer links to the message it's quoted from.`];
  for (const a of answers) {
    const lines = a.answer.split("\n");
    const where = `${a.source === "email" ? "Email" : "Teams chat"} “${a.conversationTitle}” – asked by ${nameOf(a.askerId)}, ${day(a.answeredAt)}`;
    out.push("", `**Q: ${a.question}**`, `A: ${lines.join(" ")} ([chat](${citationHref(a.conversationId, a.answerMessageId, lines[0])} "${linkTitle(where)}"))`);
  }
  return out.join("\n") + "\n";
}
