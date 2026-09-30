import type { NotificationChange } from "@/db/schema";
import { insertNotifications, loadHistory, type NewNotification } from "./db";
import { blame, hunks, lineDiff } from "./diff";
import type { Conflict, Db, Doc } from "./types";

/**
 * Who wrote each line of a document's current content. When the original author has left the
 * company, the owner (if still active) is responsible for the information instead.
 */
function lineAuthors(db: Db, doc: Doc, content = doc.content): (string | null)[] {
  const snaps = [...(loadHistory([doc.id]).get(doc.id) ?? [])];
  if (!snaps.length || snaps[snaps.length - 1].content !== content) snaps.push({ personId: doc.lastEditedById ?? doc.ownerId, at: "", content });
  const active = (id: string | null) => !!id && !!db.people.find((p) => p.id === id && p.active);
  const fallback = active(doc.ownerId) ? doc.ownerId : null;
  return blame(snaps).authors.map((a) => (active(a) ? a : fallback));
}

const isActive = (db: Db, id: string | null | undefined) => !!id && db.people.some((p) => p.id === id && p.active);

/**
 * Someone edited `doc`:
 * - authors of lines that were changed or removed hear what happened to *their* lines ("edit")
 * - the owner hears about every change to their document ("doc_edit"), whoever wrote those lines
 */
export function notifyEdit(db: Db, doc: Doc, newTitle: string, newContent: string, actorId: string) {
  const before = doc.content.split("\n");
  const after = newContent.split("\n");
  if (doc.content === newContent && doc.title === newTitle) return;
  const authors = lineAuthors(db, doc);
  const byRecipient = new Map<string, NotificationChange[]>();
  const all: NotificationChange[] = [];
  if (doc.title !== newTitle) all.push({ lineNo: 0, before: doc.title, after: newTitle });

  for (const h of hunks(lineDiff(before, after))) {
    h.removed.forEach((oldIdx, k) => {
      if (!before[oldIdx].trim() && (h.added[k] === undefined || !after[h.added[k]].trim())) return;
      const newIdx = h.added[k];
      all.push({ lineNo: (newIdx ?? oldIdx) + 1, before: before[oldIdx], after: newIdx !== undefined ? after[newIdx] : null });
    });
    for (const newIdx of h.added.slice(h.removed.length)) if (after[newIdx].trim()) all.push({ lineNo: newIdx + 1, before: null, after: after[newIdx] });

    const touched = h.removed.filter((i) => before[i].trim() && authors[i] && authors[i] !== actorId);
    if (!touched.length) continue;
    h.removed.forEach((oldIdx, k) => {
      const author = authors[oldIdx];
      if (!author || author === actorId || !before[oldIdx].trim()) return;
      const newIdx = h.added[k];
      const change = { lineNo: (newIdx ?? oldIdx) + 1, before: before[oldIdx], after: newIdx !== undefined ? after[newIdx] : null };
      byRecipient.set(author, [...(byRecipient.get(author) ?? []), change]);
    });
    // Lines added on top of a replacement belong with the first affected author.
    const first = authors[touched[0]]!;
    for (const newIdx of h.added.slice(h.removed.length)) {
      if (after[newIdx].trim()) byRecipient.get(first)!.push({ lineNo: newIdx + 1, before: null, after: after[newIdx] });
    }
  }

  const items: NewNotification[] = [];
  const owner = doc.ownerId;
  if (owner && owner !== actorId && isActive(db, owner) && all.length) {
    // One notification for the owner with every change (covers the lines they wrote too).
    items.push({ recipientId: owner, actorId, kind: "doc_edit", docId: doc.id, docTitle: newTitle, changes: all });
    byRecipient.delete(owner);
  }
  for (const [recipientId, changes] of byRecipient) items.push({ recipientId, actorId, kind: "edit", docId: doc.id, docTitle: newTitle, changes });
  insertNotifications(items);
}

/**
 * Someone saved `saved` despite contradicting other documents: tell whoever wrote each contradicted
 * line, and the owner of the contradicted document.
 */
export function notifyOverrides(db: Db, saved: { id: string; title: string }, conflicts: Conflict[], actorId: string, reason: string) {
  const grouped = new Map<string, NewNotification>();
  for (const c of conflicts) {
    const existing = db.docs.find((d) => d.id === c.existing.docId);
    if (!existing) continue;
    const author = lineAuthors(db, existing)[c.existing.lineNo - 1] ?? null;
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
  insertNotifications([...grouped.values()]);
}
