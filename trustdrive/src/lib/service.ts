import { readDb, writeDb } from "./db";
import { buildJevState, buildSignals, hashState, relatedDocs, scoreWithJev } from "./trust";
import type { Db, Doc, Person, TrustScore } from "./types";

export const DEFAULT_VIEWER = "jonas";

export function getViewer(db: Db, id: string | null): Person {
  return db.people.find((p) => p.id === id) ?? db.people.find((p) => p.id === DEFAULT_VIEWER)!;
}

/** Returns the cached score if Jev's inputs haven't changed since it was computed. */
export function cachedScore(db: Db, doc: Doc, viewer: Person): TrustScore | null {
  const cached = db.scores[`${doc.id}:${viewer.id}`];
  if (!cached) return null;
  return cached.inputHash === hashState(buildJevState(db, doc, viewer)) ? cached : null;
}

// Coalesce concurrent requests for the same doc/viewer.
const inflight = new Map<string, Promise<TrustScore>>();

export function computeScore(docId: string, viewerId: string): Promise<TrustScore> {
  const key = `${docId}:${viewerId}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    const db = readDb();
    const doc = db.docs.find((d) => d.id === docId);
    if (!doc) throw new Error("Document not found");
    const viewer = getViewer(db, viewerId);
    const state = buildJevState(db, doc, viewer);
    const result = { ...(await scoreWithJev(state)), inputHash: hashState(state) };
    const fresh = readDb();
    fresh.scores[`${doc.id}:${viewer.id}`] = result;
    writeDb(fresh);
    return result;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function docSummary(db: Db, doc: Doc, viewer: Person) {
  const { content: _content, ...meta } = doc;
  return { ...meta, excerpt: doc.content.replace(/[#*|>-]/g, " ").slice(0, 160), trust: cachedScore(db, doc, viewer) };
}

export function docDetail(db: Db, doc: Doc, viewer: Person) {
  return {
    doc,
    trust: cachedScore(db, doc, viewer),
    signals: buildSignals(db, doc, viewer),
    related: relatedDocs(db, doc).map((r) => docSummary(db, r, viewer)),
    jevInput: buildJevState(db, doc, viewer),
  };
}
