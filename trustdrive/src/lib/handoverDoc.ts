import type { Client, Conversation } from "./types";

/**
 * A client handover document drafted from email threads and Teams chats. Every item is a sentence
 * someone actually wrote (redacted where needed), with its source, so nothing in the document is
 * invented and every line can be checked. Pure, so the review page composes the same markdown.
 */

export type ItemKind = "agreement" | "fact" | "open" | "contact" | "noise";

export const ITEM_KINDS: Record<ItemKind, { title: (client: string) => string; criterion: string }> = {
  agreement: { title: (c) => `Agreements with ${c}`, criterion: "A client-specific arrangement, exception or decision that payroll must keep applying" },
  fact: { title: () => "Client setup", criterion: "A fact about the client's setup or way of working (joint committee, headcount, pay frequency, systems, practices)" },
  open: { title: () => "Open items", criterion: "A question, request or promised action that someone still has to follow up on" },
  contact: { title: (c) => `Contacts at ${c}`, criterion: "Who to contact at the client, or how they prefer to be contacted" },
  noise: { title: () => "Other", criterion: "A greeting, thanks, small talk or scheduling with no lasting information" },
};

export interface DraftItem {
  key: string;
  kind: ItemKind;
  /** The sentence as written, with personal data removed. */
  text: string;
  conversationId: string;
  messageId: number;
  authorName: string;
  personId?: string;
  /** Written by someone at the client rather than a colleague. */
  external: boolean;
  sentAt: string;
  /** Jev's confidence in the kind, or 0.5 for the rules. */
  confidence: number;
  /** Open items: dealt with later in the selected conversations. */
  resolved?: { authorName: string; sentAt: string; text: string };
  /** Agreements and facts already written down in the drive. */
  documentedIn?: { docId: string; title: string; line: string };
  /** Kinds of personal data removed from the text. */
  redactions: string[];
  /** Why it's left out unless someone ticks it. */
  sensitive?: string;
  include: boolean;
}

export interface DraftConversation {
  id: string;
  source: Conversation["source"];
  title: string;
  /** Letter used to cite it in the document. */
  ref: string;
  first: string;
  last: string;
  authors: string[];
}

export interface HandoverDraft {
  client: Client | null;
  conversations: DraftConversation[];
  items: DraftItem[];
  /** People at the client, from the senders and their signatures. */
  contacts: { name: string; email?: string; role?: string }[];
  /** Colleagues who wrote in these conversations. */
  colleagues: { personId: string; refs: string[] }[];
  method: "jev" | "rules";
}

const month = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const QUOTE_WORDS = 12;

/** Encodes a URL part so it can't end a markdown link: encodeURIComponent leaves ( ) ' ! * alone. */
const urlPart = (s: string) => encodeURIComponent(s).replace(/[()'!*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Where a quoted line came from: the conversation, scrolled to the message, with the quote (its first
 * words) highlighted. Used by the document's citations and the review page.
 */
export function citationHref(conversationId: string, messageId?: number, quote?: string) {
  const words = quote?.split(/\s+/).slice(0, QUOTE_WORDS).join(" ");
  return `/conversations?c=${urlPart(conversationId)}${messageId !== undefined ? `&m=${messageId}` : ""}${words ? `&q=${urlPart(words)}` : ""}`;
}

/** A markdown link title: no straight double quotes, which would end it. */
const linkTitle = (s: string) => s.replace(/"/g, "”");
/** Link text: no square brackets, which would end it. */
const linkText = (s: string) => s.replace(/[[\]]/g, "");

/** Markdown for the selected items. `nameOf` resolves colleagues (and whether they left). */
export function composeHandoverMarkdown(draft: HandoverDraft, title: string, included: Set<string>, nameOf: (personId: string) => string) {
  const client = draft.client?.name ?? "the client";
  const conv = new Map(draft.conversations.map((c) => [c.id, c]));
  const items = draft.items.filter((i) => included.has(i.key));
  const emails = draft.conversations.filter((c) => c.source === "email").length;
  const chats = draft.conversations.length - emails;
  const from = draft.conversations.length ? month(draft.conversations.map((c) => c.first).sort()[0]) : "";
  const to = draft.conversations.length ? month(draft.conversations.map((c) => c.last).sort().at(-1)!) : "";
  const span = from === to ? from : `${from} – ${to}`;
  const parts = [
    [emails && `${emails} email thread${emails === 1 ? "" : "s"}`, chats && `${chats} Teams chat${chats === 1 ? "" : "s"}`].filter(Boolean).join(" and "),
  ];
  const kindOf = (c: DraftConversation) => (c.source === "email" ? "Email" : "Teams chat");
  // Each line links to the message it's quoted from; hovering shows where and when it was said.
  const cite = (i: DraftItem) => {
    const c = conv.get(i.conversationId)!;
    return `([${c.ref}](${citationHref(c.id, i.messageId, i.text)} "${linkTitle(`${kindOf(c)} “${c.title}” – ${i.authorName}, ${day(i.sentAt)}`)}"))`;
  };
  const convLink = (c: DraftConversation, text = c.ref) => `[${linkText(text)}](${citationHref(c.id)} "${linkTitle(`${kindOf(c)} “${c.title}”`)}")`;

  const out = [
    `# ${title}`,
    "",
    `Written from ${parts[0] || "no conversations"}${span ? ` (${span})` : ""} about ${client}. Every line is quoted from a message: its letter links to that message, and hovering shows who said it and when.`,
  ];
  for (const kind of ["agreement", "fact", "open", "contact"] as const) {
    const lines = items.filter((i) => i.kind === kind).map((i) => {
      const who = kind === "open" ? ` – ${i.external ? "asked by" : "from"} ${i.authorName}` : "";
      return `- ${i.text}${who} ${cite(i)}`;
    });
    if (kind === "contact") lines.unshift(...draft.contacts.map((c) => `- ${[c.name, c.role, c.email].filter(Boolean).join(" – ")}`));
    if (!lines.length) continue;
    out.push("", `## ${ITEM_KINDS[kind].title(client)}`, ...lines);
  }
  if (draft.colleagues.length) {
    out.push("", `## Colleagues who handled ${client}`, ...draft.colleagues.map((c) => `- ${nameOf(c.personId)} (${c.refs.map((r) => convLink(draft.conversations.find((x) => x.ref === r)!)).join(", ")})`));
  }
  out.push(
    "",
    "## Sources",
    ...draft.conversations.map((c) => `- ${c.ref}: ${convLink(c, `${kindOf(c)} “${c.title}”`)} – ${c.authors.join(", ")}, ${month(c.first)}${month(c.last) !== month(c.first) ? ` – ${month(c.last)}` : ""}`),
  );
  return out.join("\n") + "\n";
}
