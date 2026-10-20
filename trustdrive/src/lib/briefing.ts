import { extractFacts } from "./conflicts";
import { loadConversations, loadHistory } from "./db";
import { blame } from "./diff";
import { daysSince, timeAgo } from "./time";
import { buildSignals } from "./trust";
import type { ConflictOverride, Db, Doc, Person } from "./types";

/**
 * Handover briefing: everything a successor inherits from a colleague who left or moved team.
 * - the documents the predecessor owned, wrote, edited or verified, with what's good and what to watch
 * - known exceptions: conflicts someone saved on purpose, with the written reason
 * - what the predecessor knew: figures they wrote that are still in use, documents only they verified
 * - who else to ask
 * Trust scores are added by the caller (they're per viewer and may still need Jev).
 */

export interface BriefingDoc {
  doc: Omit<Doc, "content">;
  /** How the predecessor was involved, strongest first. */
  involvement: string[];
  good: string[];
  watch: string[];
  /** Lines with figures or dates the predecessor wrote that are still in the current text. */
  facts: { lineNo: number; text: string }[];
  linesWritten: number;
  /** Nobody but the predecessor ever verified it. */
  onlyTheyVerified: boolean;
}

export interface BriefingException {
  override: ConflictOverride;
  docTitle: string;
  madeByPredecessor: boolean;
}

export interface BriefingContact {
  personId: string;
  why: string[];
}

/** A conversation the predecessor wrote in – knowledge that may never have made it into a document. */
export interface BriefingConversation {
  id: string;
  title: string;
  source: "email" | "teams";
  clientId?: string;
  messages: number;
  last: string;
}

export interface Briefing {
  predecessorId: string;
  docs: BriefingDoc[];
  exceptions: BriefingException[];
  contacts: BriefingContact[];
  conversations: BriefingConversation[];
}

const MAX_FACTS_PER_DOC = 4;
const MAX_CONTACTS = 5;

function involvementIn(db: Db, doc: Doc, p: Person, authors: (string | null)[], lines: string[], editors: Set<string>) {
  const out: string[] = [];
  const nonBlank = lines.filter((l) => l.trim()).length || 1;
  const written = lines.filter((l, i) => l.trim() && authors[i] === p.id).length;
  const verifs = doc.verifications.filter((v) => v.personId === p.id).sort((a, b) => b.at.localeCompare(a.at));
  if (doc.ownerId === p.id) out.push("Owner");
  if (written) out.push(`Wrote ${Math.round((written / nonBlank) * 100)}% of the current text`);
  if (doc.lastEditedById === p.id) out.push(`Made the latest edit, ${timeAgo(doc.updatedAt)}`);
  else if (!written && editors.has(p.id)) out.push("Edited it");
  if (doc.collaboratorIds.includes(p.id) && !written) out.push("Collaborator");
  if (verifs.length) out.push(`Verified it ${timeAgo(verifs[0].at)}`);
  if (db.overrides.some((o) => o.docId === doc.id && o.personId === p.id)) out.push("Saved it despite a conflict");
  return { out, written };
}

export async function buildBriefing(db: Db, predecessor: Person, viewer: Person): Promise<Briefing> {
  const [history, allConversations] = await Promise.all([loadHistory(), loadConversations()]);
  const docs: BriefingDoc[] = [];

  for (const doc of db.docs) {
    const snaps = [...(history.get(doc.id) ?? [])];
    if (snaps.length && snaps.at(-1)!.content !== doc.content) snaps.push({ ...snaps.at(-1)!, personId: doc.lastEditedById, content: doc.content });
    const { lines, authors } = snaps.length ? blame(snaps) : { lines: doc.content.split("\n"), authors: doc.content.split("\n").map(() => doc.ownerId) };
    const editors = new Set(snaps.map((s) => s.personId).filter((x): x is string => !!x));
    const { out: involvement, written } = involvementIn(db, doc, predecessor, authors, lines, editors);
    if (!involvement.length) continue;

    // Fact lines are numbered like the document, so blame tells us who wrote each one.
    const facts = extractFacts(doc.content)
      .filter((f) => authors[f.lineNo - 1] === predecessor.id)
      .slice(0, MAX_FACTS_PER_DOC)
      .map((f) => ({ lineNo: f.lineNo, text: f.text }));
    const signals = buildSignals(db, doc, viewer);
    const { content: _content, ...meta } = doc;
    docs.push({
      doc: meta,
      involvement,
      good: signals.filter((s) => s.tone === "good").map((s) => s.text).slice(0, 2),
      watch: signals.filter((s) => s.tone === "bad" || s.tone === "warn").map((s) => s.text).slice(0, 3),
      facts,
      linesWritten: written,
      onlyTheyVerified: doc.verifications.length > 0 && doc.verifications.every((v) => v.personId === predecessor.id),
    });
  }

  const inScope = new Set(docs.map((d) => d.doc.id));
  const exceptions = db.overrides
    .filter((o) => o.personId === predecessor.id || inScope.has(o.docId) || inScope.has(o.existingDocId))
    .map((o) => ({ override: o, docTitle: db.docs.find((d) => d.id === o.docId)?.title ?? o.docId, madeByPredecessor: o.personId === predecessor.id }))
    .sort((a, b) => Number(b.madeByPredecessor) - Number(a.madeByPredecessor) || b.override.at.localeCompare(a.override.at));

  const conversations = allConversations
    .filter((c) => c.messages.some((m) => m.personId === predecessor.id))
    .map((c) => ({ id: c.id, title: c.title, source: c.source, clientId: c.clientId, messages: c.messages.length, last: c.messages.at(-1)?.sentAt ?? c.createdAt }));

  return { predecessorId: predecessor.id, docs, exceptions, contacts: whoElseKnows(db, docs, history, predecessor, viewer), conversations };
}

/** Active colleagues who own, verified or worked on the inherited documents. */
function whoElseKnows(db: Db, docs: BriefingDoc[], history: Awaited<ReturnType<typeof loadHistory>>, predecessor: Person, viewer: Person): BriefingContact[] {
  const tally = new Map<string, { owns: string[]; verified: string[]; worked: string[] }>();
  const get = (id: string) => tally.get(id) ?? (tally.set(id, { owns: [], verified: [], worked: [] }), tally.get(id)!);
  for (const { doc } of docs) {
    if (doc.supersededById) continue;
    if (doc.ownerId) get(doc.ownerId).owns.push(doc.title);
    for (const v of doc.verifications) if (daysSince(v.at) <= 365) get(v.personId).verified.push(doc.title);
    const workers = new Set([...doc.collaboratorIds, ...(history.get(doc.id) ?? []).map((s) => s.personId).filter((x): x is string => !!x)]);
    for (const id of workers) if (id !== doc.ownerId) get(id).worked.push(doc.title);
  }
  const list = (titles: string[]) => {
    const unique = [...new Set(titles)];
    return unique.length === 1 ? `“${unique[0]}”` : `${unique.length} of these documents`;
  };
  return [...tally]
    .filter(([id]) => id !== predecessor.id && id !== viewer.id && db.people.find((p) => p.id === id)?.active)
    .map(([personId, t]) => {
      const why = [
        t.owns.length && `Owns ${list(t.owns)}`,
        t.verified.length && `Verified ${list(t.verified)} in the last year`,
        t.worked.length && `Worked on ${list(t.worked)}`,
      ].filter((x): x is string => !!x);
      const p = db.people.find((x) => x.id === personId)!;
      const score = new Set(t.owns).size * 3 + new Set(t.verified).size * 2 + new Set(t.worked).size + (p.teamId === viewer.teamId ? 1 : 0);
      return { personId, why, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CONTACTS)
    .map(({ personId, why }) => ({ personId, why }));
}
