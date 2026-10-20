import { conceptsIn, fold } from "./lexicon";
import type { Message, Person } from "./types";

/**
 * Turns pasted or uploaded conversations into messages:
 * - email chains pasted from Outlook or Gmail (reply headers in English, Dutch, French or German)
 * - Teams chats copied from the app or exported ("[date time] Name: text" or "Name 14:02" + text)
 * - .eml files (the latest message, plus the chain quoted inside it)
 * Authors are matched to colleagues by email address or name. Pure functions, so they can be tested.
 */

export type ParsedMessage = Omit<Message, "id">;

const FROM = /^\s*(?:from|van|de|von)\s?:\s*(.+)$/i;
const DATE = /^\s*(?:sent|date|verzonden|datum|envoy[ée]|gesendet)\s?:\s*(.+)$/i;
const OTHER_HEADER = /^\s*(?:to|cc|bcc|aan|à|a|an|subject|onderwerp|objet|betreff)\s?:/i;
// "On Mon, 3 Mar 2025 at 16:30, Els Vermeiren <els@…> wrote:" – the date has commas too, so the sender follows the last one.
const GMAIL_QUOTE = /^\s*(?:on|op|le|am)\s+(.+),\s*([^,]+?)\s+(?:wrote|schreef|a écrit|schrieb)\s*:\s*$/i;

/** "Els Vermeiren <els@x.example>" → name and address. */
function splitAddress(s: string) {
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim().toLowerCase() };
  const email = s.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0]?.toLowerCase();
  return { name: s.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/, "").replace(/[<>"()]/g, "").trim() || email || "Unknown sender", email };
}

/** Dates as mail clients write them, in any of the four languages; null when there's none. */
export function parseLooseDate(s: string): Date | null {
  const direct = Date.parse(s.replace(/\s+at\s+/i, " "));
  if (!Number.isNaN(direct)) return new Date(direct);
  const numeric = s.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\D+(\d{1,2}):(\d{2}))?/);
  if (numeric) {
    const [, d, mo, y, h = "12", mi = "0"] = numeric;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    return new Date(year, Number(mo) - 1, Number(d), Number(h), Number(mi));
  }
  const day = s.match(/\b(\d{1,2})(?:st|nd|rd|th|e|er)?\b/)?.[1];
  const year = s.match(/\b(20\d{2})\b/)?.[1];
  const month = [...conceptsIn(s)].find((c) => /^c:m\d\d$/.test(c));
  if (day && year && month) {
    const time = s.match(/\b(\d{1,2}):(\d{2})\b/);
    return new Date(Number(year), Number(month.slice(3)) - 1, Number(day), time ? Number(time[1]) : 12, time ? Number(time[2]) : 0);
  }
  return null;
}

/** Splits a pasted email chain into messages, oldest first. Text above the first header is the newest reply. */
export function parseEmailChain(text: string, fallback: { authorName: string; authorEmail?: string; sentAt: string }): ParsedMessage[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: { from?: string; date?: string; body: string[] }[] = [{ body: [] }];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const gmail = line.match(GMAIL_QUOTE);
    const from = line.match(FROM);
    if (gmail) {
      blocks.push({ from: gmail[2], date: gmail[1], body: [] });
      continue;
    }
    if (from && (lines.slice(i + 1, i + 5).some((l) => DATE.test(l) || OTHER_HEADER.test(l)) || blocks.length === 1 && !blocks[0].body.join("").trim())) {
      const block: (typeof blocks)[number] = { from: from[1], body: [] };
      // Header lines continue until the first blank line.
      while (i + 1 < lines.length && lines[i + 1].trim()) {
        const next = lines[++i];
        const date = next.match(DATE);
        if (date) block.date = date[1];
        else if (!OTHER_HEADER.test(next)) {
          block.body.push(next);
          break;
        }
      }
      blocks.push(block);
      continue;
    }
    blocks.at(-1)!.body.push(line.replace(/^\s*>+\s?/, ""));
  }

  const out: ParsedMessage[] = [];
  const base = Date.parse(fallback.sentAt);
  blocks.forEach((b, i) => {
    const body = b.body.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!body) return;
    const who = b.from ? splitAddress(b.from) : { name: fallback.authorName, email: fallback.authorEmail };
    const when = (b.date && parseLooseDate(b.date)) || new Date(base - i * 60_000);
    out.push({ authorName: who.name, authorEmail: who.email, sentAt: when.toISOString(), body });
  });
  return out.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

const TEAMS_EXPORT = /^\s*\[([^\]]+)\]\s*([^:]{2,60}):\s*(.*)$/;
const TEAMS_HEADER = /^\s*([\p{L}][\p{L}'’ .-]{1,60}?),?\s+((?:\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?,?\s+)?\d{1,2}:\d{2}(?:\s?[AP]M)?)\s*$/iu;

/** Splits a copied or exported Teams chat into messages, oldest first. */
export function parseTeamsChat(text: string, fallback: { authorName: string; sentAt: string }): ParsedMessage[] {
  const out: (ParsedMessage & { lines: string[] })[] = [];
  const day = new Date(fallback.sentAt);
  const timeOn = (s: string) => {
    const full = parseLooseDate(s);
    if (full && /\d{4}|\d[/.-]\d/.test(s)) return full;
    const t = s.match(/(\d{1,2}):(\d{2})\s?([AP]M)?/i);
    const d = new Date(day);
    if (t) d.setHours((Number(t[1]) % 12) + (t[3]?.toUpperCase() === "PM" ? 12 : t[3] ? 0 : Number(t[1]) >= 12 ? 12 : 0), Number(t[2]), 0, 0);
    return d;
  };
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const exp = line.match(TEAMS_EXPORT);
    const head = !exp && line.match(TEAMS_HEADER);
    if (exp) out.push({ authorName: exp[2].trim(), sentAt: timeOn(exp[1]).toISOString(), body: "", lines: [exp[3]] });
    else if (head) out.push({ authorName: head[1].trim(), sentAt: timeOn(head[2]).toISOString(), body: "", lines: [] });
    else if (out.length) out.at(-1)!.lines.push(line);
    else if (line.trim()) out.push({ authorName: fallback.authorName, sentAt: fallback.sentAt, body: "", lines: [line] });
  }
  return out
    .map(({ lines, ...m }) => ({ ...m, body: lines.join("\n").trim() }))
    .filter((m) => m.body)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

function decodeQuotedPrintable(s: string) {
  const bytes: number[] = [];
  const text = s.replace(/=\r?\n/g, "");
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "=" && /^[0-9A-F]{2}$/i.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(...Buffer.from(text[i], "utf8"));
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Headers of a MIME part, unfolded and lower-cased. */
function mimeHeaders(raw: string) {
  const [head] = raw.split(/\r?\n\r?\n/);
  const out: Record<string, string> = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

/** "=?utf-8?Q?Caf=C3=A9?=" → "Café". */
function decodeWords(s: string) {
  return s.replace(/=\?([^?]+)\?([QB])\?([^?]*)\?=/gi, (_, _charset, enc, data) =>
    enc.toUpperCase() === "B" ? Buffer.from(data, "base64").toString("utf8") : decodeQuotedPrintable(data.replace(/_/g, " ")),
  );
}

/** The text/plain body of a MIME message or part. */
function plainBody(raw: string): string {
  const headers = mimeHeaders(raw);
  const body = raw.slice(raw.search(/\r?\n\r?\n/) + 1).replace(/^\r?\n/, "");
  const type = headers["content-type"] ?? "text/plain";
  const boundary = type.match(/boundary="?([^";]+)"?/i)?.[1];
  if (boundary) {
    const parts = body.split(`--${boundary}`).slice(1).filter((p) => !p.startsWith("--"));
    const plain = parts.find((p) => /content-type:\s*text\/plain/i.test(p)) ?? parts.find((p) => /content-type:\s*multipart/i.test(p));
    if (plain) return plainBody(plain.replace(/^\r?\n/, ""));
    const html = parts.find((p) => /content-type:\s*text\/html/i.test(p));
    return html ? plainBody(html.replace(/^\r?\n/, "")).replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ") : "";
  }
  const encoding = (headers["content-transfer-encoding"] ?? "").toLowerCase();
  if (encoding === "base64") return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  if (encoding === "quoted-printable") return decodeQuotedPrintable(body);
  return body;
}

/** An .eml file: its own message plus any chain quoted below it. */
export function parseEml(raw: string): { subject: string; messages: ParsedMessage[] } {
  const headers = mimeHeaders(raw);
  const from = splitAddress(decodeWords(headers.from ?? "Unknown sender"));
  const sentAt = (headers.date && parseLooseDate(headers.date)?.toISOString()) || new Date().toISOString();
  return {
    subject: decodeWords(headers.subject ?? "").replace(/^\s*((re|fw|fwd|aw|tr|antw)\s*:\s*)+/i, "") || "Imported email",
    messages: parseEmailChain(plainBody(raw), { authorName: from.name, authorEmail: from.email, sentAt }),
  };
}

/** Links authors to colleagues (by address, then by name), so their messages show who they are. */
export function matchAuthors(messages: ParsedMessage[], people: Person[]): ParsedMessage[] {
  return messages.map((m) => {
    const p = people.find((x) => (m.authorEmail && x.email?.toLowerCase() === m.authorEmail) || fold(x.name) === fold(m.authorName));
    return p ? { ...m, personId: p.id, authorName: p.name, authorEmail: m.authorEmail ?? p.email } : m;
  });
}
