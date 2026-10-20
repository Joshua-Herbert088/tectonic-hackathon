import type { NotificationChange } from "@/db/schema";
import { insertNotifications, loadHistory, type NewNotification } from "./db";
import { blame, hunks, lineDiff } from "./diff";
import type { Conflict, Db, Doc } from "./types";

const isActive = (db: Db, id: string | null | undefined) => !!id && db.people.some((p) => p.id === id && p.active);

/**
 * Who wrote each line of a document's current content. When the original author has left the
 * company, the owner (if still active) is responsible for the information instead.
 */
async function lineAuthors(db: Db, doc: Doc): Promise<(string | null)[]> {
  const snaps: { personId: string | null; at: string; content: string }[] = [...((await loadHistory([doc.id])).get(doc.id) ?? [])];
  if (snaps.at(-1)?.content !== doc.content) snaps.push({ personId: doc.lastEditedById ?? doc.ownerId, at: "", content: doc.content });
  const fallback = isActive(db, doc.ownerId) ? doc.ownerId : null;
  return blame(snaps).authors.map((a) => (isActive(db, a) ? a : fallback));
}

/**
 * Someone edited `doc`:
 * - authors of lines that were changed or removed hear what happened to *their* lines ("edit")
 * - the owner hears about every change to their document ("doc_edit"), whoever wrote those lines
 */
export async function notifyEdit(db: Db, doc: Doc, newTitle: string, newContent: string, actorId: string) {
  if (doc.content === newContent && doc.title === newTitle) return;
  const before = doc.content.split("\n");
  const after = newContent.split("\n");
  const authors = await lineAuthors(db, doc);
  const all: NotificationChange[] = [];
  const byAuthor = new Map<string, NotificationChange[]>();
  const give = (author: string, change: NotificationChange) => byAuthor.set(author, [...(byAuthor.get(author) ?? []), change]);
  if (doc.title !== newTitle) all.push({ lineNo: 0, before: doc.title, after: newTitle });

  for (const h of hunks(lineDiff(before, after))) {
    // Someone else's line in this hunk, if any: extra added lines are reported to them.
    const hunkAuthor = h.removed.map((i) => (before[i].trim() ? authors[i] : null)).find((a) => a && a !== actorId) ?? null;
    h.removed.forEach((oldIdx, k) => {
      const newIdx = h.added[k];
      const change = { lineNo: (newIdx ?? oldIdx) + 1, before: before[oldIdx], after: newIdx !== undefined ? after[newIdx] : null };
      if (!before[oldIdx].trim() && !change.after?.trim()) return;
      all.push(change);
      const author = authors[oldIdx];
      if (before[oldIdx].trim() && author && author !== actorId) give(author, change);
    });
    for (const newIdx of h.added.slice(h.removed.length)) {
      if (!after[newIdx].trim()) continue;
      const change = { lineNo: newIdx + 1, before: null, after: after[newIdx] };
      all.push(change);
      if (hunkAuthor) give(hunkAuthor, change);
    }
  }

  const items: NewNotification[] = [];
  const owner = doc.ownerId;
  if (owner && owner !== actorId && isActive(db, owner) && all.length) {
    // One notification for the owner with every change (covers the lines they wrote too).
    items.push({ recipientId: owner, actorId, kind: "doc_edit", docId: doc.id, docTitle: newTitle, changes: all });
    byAuthor.delete(owner);
  }
  for (const [recipientId, changes] of byAuthor) items.push({ recipientId, actorId, kind: "edit", docId: doc.id, docTitle: newTitle, changes });
  await insertNotifications(items);
}

/**
 * Someone saved `saved` despite contradicting other documents: tell whoever wrote each contradicted
 * line, and the owner of the contradicted document.
 */
export async function notifyOverrides(db: Db, saved: { id: string; title: string }, conflicts: Conflict[], actorId: string, reason: string) {
  const grouped = new Map<string, NewNotification>();
  for (const c of conflicts) {
    const existing = db.docs.find((d) => d.id === c.existing.docId);
    if (!existing) continue;
    const author = (await lineAuthors(db, existing))[c.existing.lineNo - 1] ?? null;
    const owner = isActive(db, existing.ownerId) ? existing.ownerId : null;
    for (const recipient of new Set([author, owner])) {
      if (!recipient || recipient === actorId) continue;
      const key = `${recipient}|${existing.id}`;
      const n = grouped.get(key) ?? {
        recipientId: recipient,
        actorId,
        kind: "override" as const,
        docId: existing.id,
        docTitle: existing.title,
        otherDocId: saved.id,
        otherDocTitle: saved.title,
        changes: [],
        reason,
      };
      n.changes.push({ lineNo: c.existing.lineNo, before: c.existing.lineText, after: c.lineText });
      grouped.set(key, n);
    }
  }
  await insertNotifications([...grouped.values()]);
}
