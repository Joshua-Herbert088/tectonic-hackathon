import crypto from "node:crypto";
import { HttpError } from "./http";
import type { Conflict, ConflictCheck, Db, Doc, Person } from "./types";

/**
 * Who may see a document. The drive is the company's: everyone sees the documents that aren't
 * confidential. A confidential one (a salary register, a personal review) only its owner, its
 * collaborators and the readers it was shared with. Every route and list goes through canSee.
 */
export function canSee(doc: Pick<Doc, "confidential" | "ownerId" | "collaboratorIds" | "readerIds">, person: Pick<Person, "id">) {
  return !doc.confidential || doc.ownerId === person.id || doc.collaboratorIds.includes(person.id) || doc.readerIds.includes(person.id);
}

/** The document, when the viewer may see it; otherwise a 404, as if it didn't exist. */
export function visibleDoc(db: Db, id: string, viewer: Person): Doc {
  const doc = db.docs.find((d) => d.id === id);
  if (!doc || !canSee(doc, viewer)) throw new HttpError(404, "Not found");
  return doc;
}

export const HIDDEN_TITLE = "a confidential document";

/**
 * Conflicts as `viewer` may see them. One with a document they can't see still counts – the save is
 * still blocked, and its owner still hears about an override – but without its title, text, owner or id.
 */
export function redactConflicts(db: Db, check: ConflictCheck, viewer: Person): ConflictCheck {
  const redact = (c: Conflict): Conflict => {
    const doc = db.docs.find((d) => d.id === c.existing.docId);
    if (!doc || canSee(doc, viewer)) return c;
    // A random key: the real one is a hash of the hidden line, which would let someone confirm a guess.
    return { ...c, key: crypto.randomUUID().slice(0, 12), existing: { docId: "", title: HIDDEN_TITLE, lineNo: 0, lineText: "", locations: [], teamId: "", status: c.existing.status, updatedAt: "", ownerId: null } };
  };
  return { ...check, hard: check.hard.map(redact), possible: check.possible.map(redact) };
}
