import { loadHistory } from "./db";
import { blame } from "./diff";
import { daysSince, timeAgo } from "./time";
import { relatedScored } from "./trust";
import type { Db, Doc, Person } from "./types";

/**
 * Who to contact about a document, ranked by:
 *  - contribution to this document (ownership, share of the current text they wrote, edits, verifications)
 *  - conflict decisions involving this document (overrides made on it or against it)
 *  - familiarity with the topic (their work on related documents, weighted by how related they are)
 *  - team relevance (the document's team and the reader's team)
 * People who left the company are listed separately as former contributors, never as contacts.
 */

export interface ContactReason {
  text: string;
  weight: number;
}

export interface Contact {
  personId: string;
  score: number;
  /** 0–1, relative to the top contact. */
  relevance: number;
  reasons: ContactReason[];
  caveat?: string;
}

export interface FormerContributor {
  personId: string;
  leftAt: string;
  role: string;
}

const MAX_CONTACTS = 5;
const MIN_SCORE = 6;

type History = Map<string, { personId: string | null; at: string; content: string }[]>;

function contribution(doc: Doc, history: History) {
  const snaps = history.get(doc.id) ?? [];
  const { lines, authors } = snaps.length ? blame(snaps) : { lines: doc.content.split("\n"), authors: doc.content.split("\n").map(() => doc.ownerId) };
  const share = new Map<string, number>();
  const nonBlank = lines.filter((l) => l.trim()).length || 1;
  lines.forEach((l, i) => {
    const a = authors[i];
    if (a && l.trim()) share.set(a, (share.get(a) ?? 0) + 1 / nonBlank);
  });
  const edits = new Map<string, number>();
  for (const s of snaps) if (s.personId) edits.set(s.personId, (edits.get(s.personId) ?? 0) + 1);
  return { share, edits };
}

export function relevantPeople(db: Db, doc: Doc, viewer: Person, now = Date.now()): { contacts: Contact[]; former: FormerContributor[] } {
  const related = relatedScored(db, doc, 6);
  const history = loadHistory([doc.id, ...related.map((r) => r.d.id)]);
  const here = contribution(doc, history);
  const teamName = (id: string) => db.teams.find((t) => t.id === id)?.name ?? id;

  const reasons = new Map<string, ContactReason[]>();
  const add = (personId: string | null | undefined, weight: number, text: string) => {
    if (!personId || weight <= 0) return;
    reasons.set(personId, [...(reasons.get(personId) ?? []), { text, weight }]);
  };

  // 1. Contribution to this document
  add(doc.ownerId, 30, "Owner of this document");
  for (const [pid, share] of here.share) {
    const n = here.edits.get(pid) ?? 0;
    add(pid, 40 * share, `Wrote ${Math.round(share * 100)}% of the current text${n > 1 ? ` (${n} edits)` : ""}`);
  }
  for (const [pid, n] of here.edits) if (!here.share.has(pid)) add(pid, Math.min(n, 5) * 2, `Edited it ${n} time${n === 1 ? "" : "s"}`);
  for (const c of doc.collaboratorIds) if (!here.share.has(c) && !here.edits.has(c)) add(c, 6, "Collaborator on this document");
  if (doc.lastEditedById) add(doc.lastEditedById, 5, `Made the latest edit, ${timeAgo(doc.updatedAt, now)}`);
  const lastVerification = new Map<string, string>();
  for (const v of doc.verifications) if (!lastVerification.has(v.personId) || v.at > lastVerification.get(v.personId)!) lastVerification.set(v.personId, v.at);
  for (const [pid, at] of lastVerification) add(pid, daysSince(at, now) <= 180 ? 12 : 5, `Verified it correct ${timeAgo(at, now)}`);
  const recentViews = new Map<string, number>();
  for (const v of doc.views) if (daysSince(v.at, now) <= 30) recentViews.set(v.personId, (recentViews.get(v.personId) ?? 0) + 1);
  for (const [pid, n] of recentViews) if (n >= 2) add(pid, Math.min(n, 4), `Opened it ${n} times in the last month`);

  // 2. Conflict decisions involving this document
  for (const o of db.overrides.filter((o) => o.docId === doc.id)) add(o.personId, 8, `Decided to keep this despite a conflict with “${o.existingTitle}” (${timeAgo(o.at, now)})`);
  for (const o of db.overrides.filter((o) => o.existingDocId === doc.id)) {
    const other = db.docs.find((d) => d.id === o.docId)?.title ?? "another document";
    add(o.personId, 8, `Overrode this document's line ${o.existingLineNo} with “${other}” (${timeAgo(o.at, now)})`);
  }

  // 3. Familiarity with the topic, via related documents
  const topical = new Map<string, { weight: number; titles: string[] }>();
  for (const { d: r, s } of related) {
    const w = Math.min(s, 10) / 10;
    const c = contribution(r, history);
    const involved = new Map<string, number>();
    const bump = (pid: string | null | undefined, pts: number) => pid && involved.set(pid, (involved.get(pid) ?? 0) + pts);
    bump(r.ownerId, 14);
    for (const [pid, share] of c.share) bump(pid, 10 * share);
    for (const v of r.verifications) if (daysSince(v.at, now) <= 365) bump(v.personId, 5);
    for (const pid of r.collaboratorIds) bump(pid, 4);
    for (const [pid, pts] of involved) {
      const t = topical.get(pid) ?? { weight: 0, titles: [] };
      t.weight += pts * w;
      t.titles.push(r.title);
      topical.set(pid, t);
    }
  }
  for (const [pid, t] of topical) {
    const shown = t.titles.slice(0, 2).map((x) => `“${x}”`).join(", ");
    const more = t.titles.length > 2 ? ` +${t.titles.length - 2} more` : "";
    add(pid, Math.min(t.weight, 25), `Knows the topic: worked on ${shown}${more}`);
  }

  // 4. Team relevance (only boosts people who are already involved somehow)
  for (const pid of reasons.keys()) {
    const p = db.people.find((x) => x.id === pid);
    if (!p) continue;
    if (p.teamId === doc.teamId && p.teamId === viewer.teamId) add(pid, 9, `In your team (${teamName(p.teamId)}), which maintains this document`);
    else if (p.teamId === doc.teamId) add(pid, 6, `In ${teamName(p.teamId)}, the team that maintains this document`);
    else if (p.teamId === viewer.teamId) add(pid, 5, `In your team (${teamName(p.teamId)})`);
  }

  const contacts: Contact[] = [];
  const former: FormerContributor[] = [];
  for (const [pid, rs] of reasons) {
    const p = db.people.find((x) => x.id === pid);
    if (!p || pid === viewer.id) continue;
    let score = rs.reduce((n, r) => n + r.weight, 0);
    if (!p.active) {
      const direct = [...rs].sort((x, y) => y.weight - x.weight).find((r) => !r.text.startsWith("Knows the topic") && !r.text.startsWith("In "));
      if (direct && p.leftAt) former.push({ personId: pid, leftAt: p.leftAt, role: direct.text });
      continue;
    }
    let caveat: string | undefined;
    if (p.previousTeamId && p.movedTeamAt && p.teamId !== doc.teamId && p.previousTeamId === doc.teamId) {
      caveat = `Moved to ${teamName(p.teamId)} ${timeAgo(p.movedTeamAt, now)} – may be less up to date`;
      score *= 0.7;
    }
    if (score < MIN_SCORE) continue;
    contacts.push({ personId: pid, score, relevance: 0, reasons: [...rs].sort((a, b) => b.weight - a.weight), caveat });
  }
  contacts.sort((a, b) => b.score - a.score);
  const top = contacts.slice(0, MAX_CONTACTS);
  const max = top[0]?.score ?? 1;
  for (const c of top) c.relevance = c.score / max;
  return { contacts: top, former };
}
