import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/db/schema";
import { buildSeed, seedHistory } from "./seed";
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
  else {
    insertMissingSeedDocs(db);
    backfillSeedHistory(db);
  }
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
    insertHistory(tx, d, 0);
  }
}

function insertHistory(tx: Tx, d: Doc, shiftMs: number) {
  const history = seedHistory(d);
  tx.insert(schema.edits)
    .values(
      history.map((h) => ({
        docId: d.id,
        personId: h.personId,
        at: new Date(new Date(h.at).getTime() + shiftMs).toISOString(),
        title: d.title,
        content: h.content,
        status: d.status,
        location: d.location,
        teamId: d.teamId,
      })),
    )
    .run();
}

/**
 * Databases seeded before edit history existed have no snapshots for the demo docs. Add the seeded
 * history (shifted to that database's timestamps) wherever a doc's history doesn't start at creation.
 */
function backfillSeedHistory(db: Orm) {
  const seedDocs = new Map(buildSeed().docs.map((d) => [d.id, d]));
  const rows = db.select({ id: schema.documents.id, createdAt: schema.documents.createdAt }).from(schema.documents).all();
  const firstEdit = new Map(
    db
      .select({ docId: schema.edits.docId, first: sql<string>`min(${schema.edits.at})` })
      .from(schema.edits)
      .groupBy(schema.edits.docId)
      .all()
      .map((r) => [r.docId, r.first]),
  );
  const todo = rows.filter((r) => seedDocs.has(r.id) && (!firstEdit.has(r.id) || firstEdit.get(r.id)! > r.createdAt));
  if (!todo.length) return;
  db.transaction((tx) => {
    for (const r of todo) {
      const seed = seedDocs.get(r.id)!;
      insertHistory(tx, seed, new Date(r.createdAt).getTime() - new Date(seed.createdAt).getTime());
    }
  });
}

function insertSeed(db: Orm) {
  const seed = buildSeed();
  db.transaction((tx) => {
    tx.insert(schema.teams).values(seed.teams).run();
    tx.insert(schema.people).values(seed.people).run();
    insertDocs(tx, seed.docs);
  });
}

/**
 * Adds demo teams, people and documents introduced after this database was first seeded, without
 * touching existing data.
 */
function insertMissingSeedDocs(db: Orm) {
  const seed = buildSeed();
  const teamIds = new Set(db.select({ id: schema.teams.id }).from(schema.teams).all().map((t) => t.id));
  const newTeams = seed.teams.filter((t) => !teamIds.has(t.id));
  const personIds = new Set(db.select({ id: schema.people.id }).from(schema.people).all().map((p) => p.id));
  const newPeople = seed.people.filter((p) => !personIds.has(p.id));
  if (newTeams.length || newPeople.length) {
    db.transaction((tx) => {
      if (newTeams.length) tx.insert(schema.teams).values(newTeams).run();
      if (newPeople.length) tx.insert(schema.people).values(newPeople).run();
    });
  }

  const existing = new Set(db.select({ id: schema.documents.id }).from(schema.documents).all().map((d) => d.id));
  const people = new Set(db.select({ id: schema.people.id }).from(schema.people).all().map((p) => p.id));
  const missing = seed.docs.filter(
    (d) => !existing.has(d.id) && [d.ownerId, d.lastEditedById, ...d.collaboratorIds, ...d.readerIds].every((id) => !id || people.has(id)),
  );
  if (missing.length) db.transaction((tx) => insertDocs(tx, missing));
}

export function resetDb() {
  const db = orm();
  db.transaction((tx) => {
    for (const t of [schema.notifications, schema.conflictOverrides, schema.trustScores, schema.edits, schema.views, schema.verifications, schema.documentMembers, schema.documents, schema.people, schema.teams]) {
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

/** Hands a document to a new owner. A previous owner who is still at the company stays on as collaborator. */
export function transferOwnership(docId: string, newOwnerId: string) {
  const db = orm();
  db.transaction((tx) => {
    const doc = tx.select().from(schema.documents).where(eq(schema.documents.id, docId)).get();
    if (!doc || doc.ownerId === newOwnerId) return;
    tx.update(schema.documents).set({ ownerId: newOwnerId }).where(eq(schema.documents.id, docId)).run();
    tx.delete(schema.documentMembers).where(and(eq(schema.documentMembers.docId, docId), eq(schema.documentMembers.personId, newOwnerId))).run();
    const previous = doc.ownerId ? tx.select().from(schema.people).where(eq(schema.people.id, doc.ownerId)).get() : undefined;
    if (previous?.active) {
      tx.insert(schema.documentMembers)
        .values({ docId, personId: previous.id, role: "collaborator" })
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

/** Content snapshots per document, oldest first – input for blame / contribution analysis. */
export function loadHistory(docIds?: string[]) {
  const q = orm()
    .select({ docId: schema.edits.docId, personId: schema.edits.personId, at: schema.edits.at, content: schema.edits.content })
    .from(schema.edits);
  const rows = (docIds ? q.where(inArray(schema.edits.docId, docIds)) : q).orderBy(asc(schema.edits.at), asc(schema.edits.id)).all();
  const out = new Map<string, { personId: string | null; at: string; content: string }[]>();
  for (const r of rows) out.set(r.docId, [...(out.get(r.docId) ?? []), r]);
  return out;
}

export type NotificationRow = typeof schema.notifications.$inferSelect;
export type NewNotification = Omit<typeof schema.notifications.$inferInsert, "id" | "createdAt" | "readAt">;

export function insertNotifications(items: NewNotification[]) {
  if (!items.length) return;
  const createdAt = new Date().toISOString();
  orm()
    .insert(schema.notifications)
    .values(items.map((n) => ({ ...n, createdAt })))
    .run();
}

export function listNotifications(recipientId: string, limit = 30) {
  const db = orm();
  const items = db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.recipientId, recipientId))
    .orderBy(desc(schema.notifications.id))
    .limit(limit)
    .all();
  const unread = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.recipientId, recipientId), isNull(schema.notifications.readAt)))
    .get()!.n;
  return { items, unread };
}

export function markNotificationsRead(recipientId: string, ids?: number[]) {
  const where = and(eq(schema.notifications.recipientId, recipientId), isNull(schema.notifications.readAt), ids ? inArray(schema.notifications.id, ids) : undefined);
  orm().update(schema.notifications).set({ readAt: new Date().toISOString() }).where(where).run();
}
