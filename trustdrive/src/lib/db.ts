import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/db/schema";
import { buildSeed } from "./seed";
import type { Conflict, Db, Doc, DocStatus, Location, TrustScore } from "./types";

type Orm = BetterSQLite3Database<typeof schema>;

const DB_PATH = path.join(process.cwd(), "data", "trustdrive.db");

// Survive Next.js dev hot reloads without opening a new connection each time.
const g = globalThis as unknown as { __trustdriveDb?: Orm };

export function orm(): Orm {
  if (g.__trustdriveDb) return g.__trustdriveDb;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  if (!db.select({ n: sql<number>`count(*)` }).from(schema.teams).get()!.n) insertSeed(db);
  else insertMissingSeedDocs(db);
  g.__trustdriveDb = db;
  return db;
}

type Tx = Parameters<Parameters<Orm["transaction"]>[0]>[0];

function insertDocs(tx: Tx, docs: Doc[]) {
  for (const d of docs) {
    tx.insert(schema.documents).values(d).run();
    const members = [
      ...d.collaboratorIds.map((personId) => ({ docId: d.id, personId, role: "collaborator" as const })),
      ...d.readerIds.map((personId) => ({ docId: d.id, personId, role: "reader" as const })),
    ];
    if (members.length) tx.insert(schema.documentMembers).values(members).run();
    if (d.verifications.length) tx.insert(schema.verifications).values(d.verifications.map((v) => ({ docId: d.id, ...v }))).run();
    if (d.views.length) tx.insert(schema.views).values(d.views.map((v) => ({ docId: d.id, ...v }))).run();
  }
}

function insertSeed(db: Orm) {
  const seed = buildSeed();
  db.transaction((tx) => {
    tx.insert(schema.teams).values(seed.teams).run();
    tx.insert(schema.people).values(seed.people).run();
    insertDocs(tx, seed.docs);
  });
}

/** Adds demo documents introduced after this database was first seeded, without touching existing data. */
function insertMissingSeedDocs(db: Orm) {
  const existing = new Set(db.select({ id: schema.documents.id }).from(schema.documents).all().map((d) => d.id));
  const people = new Set(db.select({ id: schema.people.id }).from(schema.people).all().map((p) => p.id));
  const missing = buildSeed().docs.filter(
    (d) => !existing.has(d.id) && [d.ownerId, d.lastEditedById, ...d.collaboratorIds, ...d.readerIds].every((id) => !id || people.has(id)),
  );
  if (missing.length) db.transaction((tx) => insertDocs(tx, missing));
}

export function resetDb() {
  const db = orm();
  db.transaction((tx) => {
    for (const t of [schema.conflictOverrides, schema.trustScores, schema.edits, schema.views, schema.verifications, schema.documentMembers, schema.documents, schema.people, schema.teams]) {
      tx.delete(t).run();
    }
  });
  insertSeed(db);
}

/** Loads teams, people and fully assembled documents – the shape the trust logic works on. */
export function loadWorld(): Db {
  const db = orm();
  const members = db.select().from(schema.documentMembers).all();
  const verifs = db.select().from(schema.verifications).orderBy(schema.verifications.at).all();
  const views = db.select().from(schema.views).orderBy(schema.views.at).all();
  const docs: Doc[] = db
    .select()
    .from(schema.documents)
    .all()
    .map((d) => ({
      ...d,
      supersededById: d.supersededById ?? undefined,
      collaboratorIds: members.filter((m) => m.docId === d.id && m.role === "collaborator").map((m) => m.personId),
      readerIds: members.filter((m) => m.docId === d.id && m.role === "reader").map((m) => m.personId),
      verifications: verifs.filter((v) => v.docId === d.id).map(({ personId, at }) => ({ personId, at })),
      views: views.filter((v) => v.docId === d.id).map(({ personId, at }) => ({ personId, at })),
    }));
  const people = db
    .select()
    .from(schema.people)
    .all()
    .map((p) => ({ ...p, leftAt: p.leftAt ?? undefined, previousTeamId: p.previousTeamId ?? undefined, movedTeamAt: p.movedTeamAt ?? undefined }));
  const overrides = db.select().from(schema.conflictOverrides).orderBy(schema.conflictOverrides.at).all();
  return { teams: db.select().from(schema.teams).all(), people, docs, overrides };
}

function toTrust(row: typeof schema.trustScores.$inferSelect): TrustScore {
  const { id: _id, docId: _docId, viewerId: _viewerId, ...rest } = row;
  return rest;
}

export function latestScore(docId: string, viewerId: string): TrustScore | null {
  const row = orm()
    .select()
    .from(schema.trustScores)
    .where(and(eq(schema.trustScores.docId, docId), eq(schema.trustScores.viewerId, viewerId)))
    .orderBy(desc(schema.trustScores.id))
    .limit(1)
    .get();
  return row ? toTrust(row) : null;
}

/** Latest score per document for one viewer. */
export function latestScoresForViewer(viewerId: string): Map<string, TrustScore> {
  const rows = orm()
    .select()
    .from(schema.trustScores)
    .where(
      and(
        eq(schema.trustScores.viewerId, viewerId),
        sql`${schema.trustScores.id} = (select max(id) from trust_scores t2 where t2.doc_id = ${schema.trustScores.docId} and t2.viewer_id = ${viewerId})`,
      ),
    )
    .all();
  return new Map(rows.map((r) => [r.docId, toTrust(r)]));
}

/** Score history for a document as seen by one viewer, oldest first. */
export function scoreHistory(docId: string, viewerId: string, limit = 20) {
  return orm()
    .select({ score: schema.trustScores.score, computedAt: schema.trustScores.computedAt })
    .from(schema.trustScores)
    .where(and(eq(schema.trustScores.docId, docId), eq(schema.trustScores.viewerId, viewerId)))
    .orderBy(desc(schema.trustScores.id))
    .limit(limit)
    .all()
    .reverse();
}

export function insertScore(docId: string, viewerId: string, t: TrustScore) {
  orm().insert(schema.trustScores).values({ docId, viewerId, ...t }).run();
}

export function addVerification(docId: string, personId: string) {
  orm().insert(schema.verifications).values({ docId, personId, at: new Date().toISOString() }).run();
}

export function documentExists(id: string) {
  return !!orm().select({ id: schema.documents.id }).from(schema.documents).where(eq(schema.documents.id, id)).get();
}

export interface DocPatch {
  title?: string;
  content?: string;
  status?: DocStatus;
  location?: Location;
  teamId?: string;
}

/**
 * Applies a patch and records a snapshot in `edits`. Only title/content changes count as an
 * "edit" for recency (updatedAt / lastEditedBy); metadata changes are still recorded in history.
 */
export function updateDocument(docId: string, personId: string, patch: DocPatch) {
  const db = orm();
  db.transaction((tx) => {
    const doc = tx.select().from(schema.documents).where(eq(schema.documents.id, docId)).get();
    if (!doc) return;
    const next = { ...doc, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    const changed = (["title", "content", "status", "location", "teamId"] as const).some((k) => next[k] !== doc[k]);
    if (!changed) return;
    const now = new Date().toISOString();
    const contentChanged = next.title !== doc.title || next.content !== doc.content;
    if (contentChanged) {
      next.updatedAt = now;
      next.lastEditedById = personId;
    }
    tx.update(schema.documents).set(next).where(eq(schema.documents.id, docId)).run();
    tx.insert(schema.edits).values({ docId, personId, at: now, title: next.title, content: next.content, status: next.status, location: next.location, teamId: next.teamId }).run();
    // Anyone who edits content becomes a collaborator.
    if (contentChanged && doc.ownerId !== personId) {
      tx.insert(schema.documentMembers)
        .values({ docId, personId, role: "collaborator" })
        .onConflictDoUpdate({ target: [schema.documentMembers.docId, schema.documentMembers.personId], set: { role: "collaborator" } })
        .run();
    }
  });
}

export function createDocument(doc: Omit<Doc, "collaboratorIds" | "readerIds" | "verifications" | "views">) {
  const db = orm();
  db.transaction((tx) => {
    tx.insert(schema.documents).values(doc).run();
    tx.insert(schema.edits)
      .values({ docId: doc.id, personId: doc.lastEditedById, at: doc.createdAt, title: doc.title, content: doc.content, status: doc.status, location: doc.location, teamId: doc.teamId })
      .run();
  });
}

/** Permanently attaches "I saved this despite these conflicts" to a document. */
export function recordOverrides(docId: string, personId: string, reason: string, conflicts: Conflict[]) {
  if (!conflicts.length) return;
  const at = new Date().toISOString();
  orm()
    .insert(schema.conflictOverrides)
    .values(
      conflicts.map((c) => ({
        docId,
        personId,
        at,
        reason,
        probability: c.probability,
        lineNo: c.lineNo,
        lineText: c.lineText,
        existingDocId: c.existing.docId,
        existingTitle: c.existing.title,
        existingLineNo: c.existing.lineNo,
        existingLineText: c.existing.lineText,
      })),
    )
    .run();
}
