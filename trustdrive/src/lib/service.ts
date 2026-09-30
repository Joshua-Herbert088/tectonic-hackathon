import { checkConflicts, type Draft } from "./conflicts";
import { relevantPeople } from "./contacts";
import { buildGovernanceSnapshot } from "./governance";
import { lineDoubts } from "./doubts";
import { findRedundant, substance, type SimilarDoc } from "./similarity";
import { insertScore, latestScore, latestScoresForViewer, loadWorld, scoreHistory } from "./db";
import { buildJevState, buildSignals, hashState, relatedDocs, scoreWithJev } from "./trust";
import type { ConflictCheck, Db, Doc, Person, TrustScore } from "./types";

export const DEFAULT_VIEWER = "jonas";

export function getViewer(db: Db, id: string | null): Person {
  return db.people.find((p) => p.id === id) ?? db.people.find((p) => p.id === DEFAULT_VIEWER)!;
}

/** A stored score only counts if Jev's inputs haven't changed since it was computed. */
function freshOrNull(db: Db, doc: Doc, viewer: Person, stored: TrustScore | null | undefined) {
  return stored && stored.inputHash === hashState(buildJevState(db, doc, viewer)) ? stored : null;
}

// Coalesce concurrent requests for the same doc/viewer.
const inflight = new Map<string, Promise<TrustScore>>();

export function computeScore(docId: string, viewerId: string): Promise<TrustScore> {
  const key = `${docId}:${viewerId}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    const db = loadWorld();
    const doc = db.docs.find((d) => d.id === docId);
    if (!doc) throw new Error("Document not found");
    const viewer = getViewer(db, viewerId);
    const state = buildJevState(db, doc, viewer);
    const result = { ...(await scoreWithJev(state)), inputHash: hashState(state) };
    insertScore(doc.id, viewer.id, result);
    return result;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function summary(db: Db, doc: Doc, viewer: Person, stored: TrustScore | null | undefined) {
  const { content: _content, ...meta } = doc;
  return { ...meta, excerpt: doc.content.replace(/[#*|>-]/g, " ").slice(0, 160), trust: freshOrNull(db, doc, viewer, stored) };
}

export function listDocs(viewerId: string | null) {
  const db = loadWorld();
  const viewer = getViewer(db, viewerId);
  const scores = latestScoresForViewer(viewer.id);
  const docs = [...db.docs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((d) => summary(db, d, viewer, scores.get(d.id)));
  return { viewer, docs };
}

export function docDetail(docId: string, viewerId: string | null) {
  const db = loadWorld();
  const doc = db.docs.find((d) => d.id === docId);
  if (!doc) return null;
  const viewer = getViewer(db, viewerId);
  const scores = latestScoresForViewer(viewer.id);
  return {
    doc,
    trust: freshOrNull(db, doc, viewer, latestScore(doc.id, viewer.id)),
    history: scoreHistory(doc.id, viewer.id),
    signals: buildSignals(db, doc, viewer),
    doubts: lineDoubts(db, doc),
    related: relatedDocs(db, doc).map((r) => summary(db, r, viewer, scores.get(r.id))),
    jevInput: buildJevState(db, doc, viewer),
    people: relevantPeople(db, doc, viewer),
    governance: buildGovernanceSnapshot(db, doc),
    conflictDecisions: {
      made: db.overrides.filter((o) => o.docId === doc.id),
      against: db.overrides.filter((o) => o.existingDocId === doc.id).map((o) => ({ ...o, docTitle: db.docs.find((d) => d.id === o.docId)?.title ?? o.docId })),
    },
  };
}

export type GateResult =
  | { ok: true; check: ConflictCheck; overridden: ConflictCheck["hard"] }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Hard conflicts block a save unless the person explicitly overrides them with a reason.
 * The caller records `overridden` against the saved document.
 */
export async function gateDraft(db: Db, draft: Draft, override: unknown): Promise<GateResult> {
  let check: ConflictCheck;
  try {
    check = await checkConflicts(db, draft);
  } catch (e) {
    return { ok: false, status: 502, body: { error: `Conflict check failed: ${(e as Error).message}` } };
  }
  if (!check.hard.length) return { ok: true, check, overridden: [] };
  const reason = typeof (override as { reason?: unknown })?.reason === "string" ? (override as { reason: string }).reason.trim() : "";
  if (!reason) return { ok: false, status: 409, body: { error: "conflicts", check } };
  return { ok: true, check, overridden: check.hard };
}

/**
 * Warn-only redundancy check for content being added. Returns [] when there's nothing to add yet,
 * the user already acknowledged the warning, or Jev is unavailable (it must never block saving).
 */
export async function redundancyCheck(db: Db, text: { title: string; content: string }, opts: { excludeDocId?: string; acknowledged?: unknown }): Promise<SimilarDoc[]> {
  if (opts.acknowledged === true || !substance(text.content)) return [];
  try {
    return await findRedundant(db, text, opts.excludeDocId);
  } catch {
    return [];
  }
}
