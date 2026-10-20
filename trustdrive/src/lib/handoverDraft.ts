import { compareFacts, extractFacts, stemsOf } from "./conflicts";
import { ITEM_KINDS, type DraftItem, type HandoverDraft, type ItemKind } from "./handoverDoc";
import { conceptsIn, fold, stripLinks } from "./lexicon";
import { callJev } from "./trust";
import type { Conversation, Db, Message } from "./types";

/**
 * Drafts a client handover document from conversations:
 * 1. Split each message into statements (greetings, sign-offs, signatures and quoted replies removed).
 * 2. Classify each statement (agreement, setup fact, open item, contact, noise) – Jev `choice`
 *    questions, or keyword rules in four languages when Jev is unavailable.
 * 3. Open items: was it dealt with later in the selected conversations? (Jev yes/no, or rules)
 * 4. Agreements and facts: is it already written down in the drive? (the conflict rules' fact match)
 * 5. Remove personal data (IBANs, national numbers) and leave health information out by default.
 *    Redaction happens before anything is sent to Jev.
 */

const SIGNOFF = /^(kind regards|best regards|warm regards|regards|best|thanks|thank you|many thanks|cheers|groet(en)?|met vriendelijke groet(en)?|vriendelijke groet(en)?|cordialement|bien (à vous|cordialement)|mit freundlichen grü(ß|ss)en|viele grü(ß|ss)e|liebe grü(ß|ss)e|mvg)\b[\s,.!]*$/i;
const GREETING = /^(hi|hello|hey|dear|beste|hoi|dag|goedemorgen|bonjour|madame|monsieur|hallo|liebe[r]?|sehr geehrte[r]?|guten tag)\b[^.!?]{0,40}[,!:]?\s*$/i;
const QUOTED = /^\s*(>|on .+ wrote:|-----\s*original message|(from|van|von)\s?:|de\s:)/i;

const AGREEMENT = /\b(agreed|confirmed|as agreed|as discussed|we keep|keep applying|exception|don'?t change|do not change|every year|afgesproken|bevestigd|zoals besproken|convenu|confirmé|comme convenu|vereinbart|bestätigt|wie besprochen)\b/i;
const REQUEST = /\?\s*\S{0,3}$|^(could|can|would|will) you\b|^please\b|\bplease (send|make|plan|check|let|pay|include)|\b(kun|kunt|kunnen) (je|jij|u|jullie)\b|\bpourriez|\bpouvez-vous|\bkönnten sie|\bkönnen sie|\bbitte\b/i;
const PROMISE = /\b(i'll|i will|we'll|we will|i promised|promised|ik zal|we zullen|ik stuur|je vais|nous allons|ich werde|wir werden)\b/i;
const CONTACT = /[\w.+-]+@[\w-]+\.[\w.-]+|\b(contact|prefers?|reach (him|her|them)|phone call|call (him|her|them)|bellen|telefonisch|appeler|téléphone|anrufen)\b/i;
const NOISE = /\b(thanks|thank you|bedankt|dank je|merci|danke|perfect|great|good to know|see you|tot later|à bientôt|👍)\b/i;
/** Questions asking for information, which any reply answers (unlike requests, which need doing). */
const INFO_QUESTION = /^(?:\w+:\s*)?(who|what|when|where|which|how|wie|wat|wanneer|waar|welke|hoe|qui|que|quand|où|quel|quelle|comment|wer|was|wann|wo|welche|wie)\b.*\?\s*$/i;
const DONE = /\b(attached|here is|here's|sent|done|included|paid|completed|in bijlage|bijgevoegd|verstuurd|ci-joint|envoyé|anbei|gesendet|agreed|confirmed|afgesproken|bevestigd)\b/i;

const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g;
const NATIONAL_NUMBER = /\b\d{2}[.\s]?\d{2}[.\s]?\d{2}[-.\s]\d{3}[.\s]?\d{2}\b|\b\d{9}\b|\b[12]\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{3}\s?\d{3}(?:\s?\d{2})?\b/g;
const HEALTH = /\b(sick note|medical|doctor|diagnos\w*|illness|ziektebriefje|doktersbriefje|medisch|huisarts|certificat médical|médecin|krankmeldung|arzt|attest)\b/i;

const MAX_LATER_CHARS = 2500;
const QUESTIONS_PER_CALL = 20;

interface Statement {
  key: string;
  text: string;
  conversation: Conversation;
  message: Message;
  external: boolean;
}

/** Statements of a message, plus the signature lines below the sign-off. */
export function statementsOf(body: string): { statements: string[]; signature: string[] } {
  const kept: string[] = [];
  let signature: string[] = [];
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (QUOTED.test(line)) break;
    if (SIGNOFF.test(line)) {
      signature = lines.slice(i + 1, i + 5).map((l) => l.trim()).filter(Boolean);
      break;
    }
    if (GREETING.test(line)) continue;
    kept.push(line);
  }
  const statements = kept
    .join("\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .flatMap((p) => p.split(/(?<=[.!?])\s+(?=[\p{Lu}€\d"“(])/u))
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 3);
  return { statements, signature };
}

/** The kind of a statement by keyword rules (any of the four languages). */
export function ruleKind(text: string): ItemKind {
  const isQuestion = REQUEST.test(text);
  if (AGREEMENT.test(text) && !/\?\s*$/.test(text)) return "agreement";
  if (isQuestion || PROMISE.test(text)) return "open";
  if (CONTACT.test(text)) return "contact";
  if (NOISE.test(text) && text.split(/\s+/).length < 8) return "noise";
  return /\d/.test(text) || text.split(/\s+/).length >= 8 ? "fact" : "noise";
}

/** Removes IBANs and national numbers; reports what was removed and whether to leave it out. */
export function redact(text: string) {
  const redactions: string[] = [];
  let out = text.replace(IBAN, () => (redactions.push("bank account"), "[bank account removed]"));
  out = out.replace(NATIONAL_NUMBER, () => (redactions.push("national number"), "[national number removed]"));
  const sensitive = HEALTH.test(text) ? "Health information" : redactions.length ? "Personal data about an employee" : undefined;
  return { text: out, redactions: [...new Set(redactions)], sensitive };
}

async function classify(statements: Statement[], clientName: string, rulesOnly: boolean) {
  if (!rulesOnly) {
    try {
      const criteria = Object.fromEntries(Object.entries(ITEM_KINDS).map(([k, v]) => [k, v.criterion]));
      const chunks: Statement[][] = [];
      for (let i = 0; i < statements.length; i += QUESTIONS_PER_CALL) chunks.push(statements.slice(i, i + QUESTIONS_PER_CALL));
      const answers = await Promise.all(
        chunks.map((chunk) =>
          callJev({
            state: { task: `Sort statements from client conversations into a handover document for ${clientName}` },
            questions: Object.fromEntries(
              chunk.map((s, j) => [
                `s${j}`,
                {
                  type: "choice",
                  instructions: `What kind of statement is this, for someone taking over the client ${clientName}? ${s.conversation.source === "email" ? "Email" : "Teams chat"} '${s.conversation.title}'. ${s.message.authorName} (${s.external ? "works at the client" : "colleague"}) wrote: "${redact(s.text).text}"`,
                  criteria,
                },
              ]),
            ),
          }).then((r) =>
            chunk.map((s, j) => {
              const a = r.answers[`s${j}`] as unknown as { choice?: string; confidence: number };
              return a.choice && a.choice in ITEM_KINDS ? { kind: a.choice as ItemKind, confidence: a.confidence } : { kind: ruleKind(s.text), confidence: 0.5 };
            }),
          ),
        ),
      );
      return { method: "jev" as const, kinds: answers.flat() };
    } catch {
      // Fall through to the rules.
    }
  }
  return { method: "rules" as const, kinds: statements.map((s) => ({ kind: ruleKind(s.text), confidence: 0.5 })) };
}

/** Later messages (in the same conversation, or in all selected ones), as context for "was this dealt with?". */
function laterMessages(s: Statement, all: Statement["conversation"][], sameConversation = false) {
  const later = all
    .filter((c) => !sameConversation || c.id === s.conversation.id)
    .flatMap((c) => c.messages.map((m) => ({ c, m })))
    .filter(({ m }) => m.sentAt > s.message.sentAt || (m.sentAt === s.message.sentAt && m.id > s.message.id))
    .sort((a, b) => a.m.sentAt.localeCompare(b.m.sentAt));
  return later;
}

async function resolveOpenItems(open: Statement[], all: Conversation[], method: "jev" | "rules"): Promise<(DraftItem["resolved"] | undefined)[]> {
  const ruleCheck = (s: Statement) => {
    const promise = PROMISE.test(s.text) && !REQUEST.test(s.text);
    const answer = laterMessages(s, all).find(({ c, m }) => {
      const reply = c.id === s.conversation.id && m.authorName !== s.message.authorName;
      return INFO_QUESTION.test(s.text) ? reply : DONE.test(m.body) && (promise || reply);
    });
    return answer ? { authorName: answer.m.authorName, sentAt: answer.m.sentAt, text: statementsOf(answer.m.body).statements.find((x) => DONE.test(x)) ?? answer.m.body.slice(0, 160) } : undefined;
  };
  if (method === "rules" || !open.length) return open.map(ruleCheck);
  try {
    const questions = Object.fromEntries(
      open.map((s, i) => {
        // Only the same conversation: replies elsewhere in a long history make Jev see everything as open.
        let context = "";
        for (const { m } of laterMessages(s, all, true)) {
          const line = `[${m.sentAt.slice(0, 10)}] ${m.authorName}: ${redact(m.body.replace(/\s+/g, " ")).text}\n`;
          if (context.length + line.length > MAX_LATER_CHARS) break;
          context += line;
        }
        return [
          `o${i}`,
          {
            type: "noul",
            instructions: `Is this still an open loop that the person taking over must follow up on? Yes if it's a one-off task that was only accepted or promised, or a question nobody answered. No if it was answered, delivered, or settled as a standing arrangement. Item by ${s.message.authorName} on ${s.message.sentAt.slice(0, 10)}: "${redact(s.text).text}"\n\nLater messages in the same conversation:\n${context || "(none)"}`,
          },
        ];
      }),
    );
    const r = await callJev({ state: { task: "Find open loops in client conversations" }, questions });
    return open.map((s, i) => {
      // Any reply answers a question asking for information; Jev decides requests and promises.
      if (INFO_QUESTION.test(s.text)) return ruleCheck(s);
      if (r.answers[`o${i}`].noul >= 0.5) return undefined;
      // Jev says it's no longer open; point to the most likely reply.
      const later = laterMessages(s, all, true);
      const reply = later.find(({ m }) => DONE.test(m.body)) ?? later[0];
      return reply ? { authorName: reply.m.authorName, sentAt: reply.m.sentAt, text: statementsOf(reply.m.body).statements[0] ?? reply.m.body.slice(0, 160) } : undefined;
    });
  } catch {
    return open.map(ruleCheck);
  }
}

/** Where the drive already states this: the same fact and value, or (without figures) most of the same words on one line. */
export function documentedIn(db: Db, text: string, client: { name: string; location: string }, clientId?: string): DraftItem["documentedIn"] {
  const docs = db.docs.filter((d) => !d.supersededById).sort((a, b) => Number(b.clientId === clientId) - Number(a.clientId === clientId));
  const facts = extractFacts(text);
  for (const doc of docs) {
    for (const b of extractFacts(doc.content)) {
      if (facts.some((a) => compareFacts({ title: client.name, locations: [client.location] }, a, doc, b).agrees)) return { docId: doc.id, title: doc.title, line: b.text };
    }
  }
  const subject = (t: string) => new Set([...[...conceptsIn(t)].filter((c) => !/^c:(m\d\d|day|week|month|year|hour|maximum)$/.test(c)), ...stemsOf(t)]);
  const mine = subject(text);
  if (facts.length || mine.size < 3) return undefined;
  for (const doc of docs) {
    for (const line of stripLinks(doc.content).split("\n")) {
      if (!line.trim() || line.startsWith("#")) continue;
      const theirs = subject(line);
      const shared = [...mine].filter((x) => theirs.has(x)).length;
      // Chat sentences carry extra words ("Heads-up before I leave: …"), so compare with the shorter side.
      if (shared >= 3 && shared / Math.min(mine.size, theirs.size) >= 0.75) return { docId: doc.id, title: doc.title, line: line.replace(/^[-*>\s]+/, "").trim() };
    }
  }
  return undefined;
}

export async function buildHandoverDraft(db: Db, conversations: Conversation[], clientId: string | undefined, opts: { rulesOnly?: boolean } = {}): Promise<HandoverDraft> {
  const client = db.clients.find((c) => c.id === clientId) ?? null;
  const clientName = client?.name ?? "the client";
  // Colleagues are matched to a person on import; everyone else wrote from the client's side.
  const isExternal = (m: Message) => !m.personId;
  const ordered = [...conversations].sort((a, b) => (a.messages[0]?.sentAt ?? a.createdAt).localeCompare(b.messages[0]?.sentAt ?? b.createdAt));

  const statements: Statement[] = [];
  const contacts = new Map<string, { name: string; email?: string; role?: string }>();
  for (const c of ordered) {
    for (const m of c.messages) {
      const { statements: texts, signature } = statementsOf(m.body);
      texts.forEach((text, i) => statements.push({ key: `${c.id}:${m.id}:${i}`, text, conversation: c, message: m, external: isExternal(m) }));
      if (isExternal(m)) {
        const key = m.authorEmail ?? fold(m.authorName);
        // A signature line right after the name is usually the job title ("HR Manager, Noordkaai Logistics").
        const nameAt = signature.findIndex((l) => fold(l) === fold(m.authorName) || fold(m.authorName).startsWith(fold(l)));
        const role = nameAt >= 0 ? signature[nameAt + 1]?.split(",")[0].trim() : undefined;
        const known = contacts.get(key);
        contacts.set(key, { name: m.authorName, email: m.authorEmail ?? known?.email, role: role ?? known?.role });
      }
    }
  }

  const { method, kinds } = await classify(statements, clientName, !!opts.rulesOnly);
  const openIdx = kinds.flatMap((k, i) => (k.kind === "open" ? [i] : []));
  const resolutions = await resolveOpenItems(openIdx.map((i) => statements[i]), ordered, method);
  const resolvedAt = new Map(openIdx.map((i, j) => [i, resolutions[j]]));

  const items: DraftItem[] = statements.map((s, i) => {
    const { kind, confidence } = kinds[i];
    const red = redact(s.text);
    const resolved = resolvedAt.get(i);
    const documented = kind === "agreement" || kind === "fact" ? documentedIn(db, s.text, { name: clientName, location: client?.location ?? "Global" }, clientId) : undefined;
    return {
      key: s.key,
      kind,
      text: red.text,
      conversationId: s.conversation.id,
      messageId: s.message.id,
      authorName: s.message.authorName,
      personId: s.message.personId,
      external: s.external,
      sentAt: s.message.sentAt,
      confidence,
      resolved,
      documentedIn: documented,
      redactions: red.redactions,
      sensitive: red.sensitive,
      // A contact line that only repeats a sender's address adds nothing to the contacts list.
      include: kind !== "noise" && !red.sensitive && !(kind === "open" && resolved) && !(kind === "contact" && [...contacts.values()].some((c) => c.email && s.text.toLowerCase().includes(c.email))),
    };
  });

  const refs = "abcdefghijklmnopqrstuvwxyz";
  const draftConversations = ordered.map((c, i) => ({
    id: c.id,
    source: c.source,
    title: c.title,
    ref: refs[i % 26].repeat(Math.floor(i / 26) + 1),
    first: c.messages[0]?.sentAt ?? c.createdAt,
    last: c.messages.at(-1)?.sentAt ?? c.createdAt,
    authors: [...new Set(c.messages.map((m) => m.authorName))],
  }));
  const colleagues = new Map<string, string[]>();
  for (const c of draftConversations) {
    for (const m of ordered.find((x) => x.id === c.id)!.messages) {
      if (m.personId && !colleagues.get(m.personId)?.includes(c.ref)) colleagues.set(m.personId, [...(colleagues.get(m.personId) ?? []), c.ref]);
    }
  }

  return {
    client,
    conversations: draftConversations,
    items,
    contacts: [...contacts.values()],
    colleagues: [...colleagues].map(([personId, r]) => ({ personId, refs: r })),
    method,
  };
}
