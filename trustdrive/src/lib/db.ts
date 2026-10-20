import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { config } from "./config";
import { log } from "./log";
import { buildBoard, buildConversations, buildSeed, seedActivity, seedHistory, seedVerificationSources } from "./seed";
import { DEFAULT_TERMS, type Term, type TermKind } from "./taxonomy";
import { formatLocations } from "./appliesTo";
import type { ActivityEvent, Answer, BoardThread, SuggestedEdit, Client, Conflict, Conversation, Db, Doc, DocStatus, Folder, Location, Message, Participant, TrustScore } from "./types";

/**
 * Database access. Postgres everywhere: any Postgres server when DATABASE_URL is set, otherwise
 * PGlite – Postgres compiled to WebAssembly, stored in data/pglite – so local development needs no setup.
 * The same schema and migrations serve both.
 */

type Orm = PgDatabase<PgQueryResultHKT, typeof schema>;
type Tx = Parameters<Parameters<Orm["transaction"]>[0]>[0];

const MIGRATIONS = path.join(process.cwd(), "drizzle");
/** Any fixed number: every instance takes this Postgres advisory lock around migrations and seeding. */
const SETUP_LOCK = 724_583;

interface Connection {
  orm: Orm;
  migrate: () => Promise<void>;
  close: () => Promise<void>;
}

function connect(): Connection {
  if (config.databaseUrl) {
    const pool = new Pool({ connectionString: config.databaseUrl, max: config.poolSize });
    pool.on("error", (e) => log.error("postgres pool error", { error: e.message }));
    const orm = drizzlePg(pool, { schema });
    return { orm, migrate: () => migratePg(orm, { migrationsFolder: MIGRATIONS }), close: () => pool.end() };
  }
  // A production server needs a real database: refuse rather than keep data in a local folder by accident.
  if (config.production && !process.env.PGLITE_DIR) throw new Error("DATABASE_URL is required in production (set PGLITE_DIR to use an embedded database anyway)");
  // PGlite creates its own folder but not the ones above it (data/ on a fresh checkout).
  if (!config.pgliteDir.includes("://")) fs.mkdirSync(path.dirname(config.pgliteDir), { recursive: true });
  const client = new PGlite(config.pgliteDir);
  const orm = drizzlePglite(client, { schema });
  return { orm, migrate: () => migratePglite(orm, { migrationsFolder: MIGRATIONS }), close: () => client.close() };
}

// The connection survives dev hot reloads; setup runs again when this module reloads, so new migrations
// apply without a restart.
const g = globalThis as unknown as { __trustdriveDb?: Connection };
let ready: Promise<Orm> | undefined;

/** The database, migrated and seeded. */
export function db(): Promise<Orm> {
  ready ??= setUp().catch((e) => {
    ready = undefined; // try again on the next request
    throw e;
  });
  return ready;
}

async function setUp(): Promise<Orm> {
  g.__trustdriveDb ??= connect();
  const conn = g.__trustdriveDb;
  // One instance at a time: several server instances may start together.
  await conn.orm.execute(sql`select pg_advisory_lock(${SETUP_LOCK})`);
  try {
    if (config.migrateOnStart) await conn.migrate();
    if (config.seedDemoData) await syncSeed(conn.orm);
  } finally {
    await conn.orm.execute(sql`select pg_advisory_unlock(${SETUP_LOCK})`);
  }
  return conn.orm;
}

/** For scripts and tests. */
export async function migrateAndSeed() {
  await db();
}

export async function closeDb() {
  await g.__trustdriveDb?.close();
  g.__trustdriveDb = undefined;
  ready = undefined;
}

// ---------------------------------------------------------------------------------------------
// Demo data

async function insertDocs(tx: Tx, docs: Doc[]) {
  for (const d of docs) {
    await tx.insert(schema.documents).values(d);
    const members = [
      ...d.collaboratorIds.map((personId) => ({ docId: d.id, personId, role: "collaborator" as const })),
      ...d.readerIds.map((personId) => ({ docId: d.id, personId, role: "reader" as const })),
    ];
    if (members.length) await tx.insert(schema.documentMembers).values(members);
    if (d.verifications.length) await tx.insert(schema.verifications).values(d.verifications.map((v) => ({ docId: d.id, ...v })));
    if (d.views.length) await tx.insert(schema.views).values(d.views.map((v) => ({ docId: d.id, ...v })));
    await tx.insert(schema.edits).values(
      seedHistory(d).map((h) => ({ docId: d.id, personId: h.personId, at: h.at, title: d.title, content: h.content, status: d.status, location: formatLocations(d.locations), teamId: d.teamId })),
    );
  }
}

async function insertConversations(tx: Tx, conversations: ReturnType<typeof buildConversations>) {
  for (const { messages, ...c } of conversations) {
    await tx.insert(schema.conversations).values(c);
    if (messages.length) await tx.insert(schema.messages).values(messages.map((m) => ({ ...m, conversationId: c.id })));
  }
}

/** Demo validations given in an email: point them at that message once the conversation is there. */
async function linkVerificationSources(tx: Tx) {
  for (const l of seedVerificationSources) {
    const msgs = await tx.select({ id: schema.messages.id }).from(schema.messages).where(eq(schema.messages.conversationId, l.conversationId)).orderBy(asc(schema.messages.sentAt), asc(schema.messages.id));
    const message = msgs[l.messageIndex];
    if (!message) continue;
    await tx
      .update(schema.verifications)
      .set({ conversationId: l.conversationId, messageId: message.id })
      .where(and(eq(schema.verifications.docId, l.docId), eq(schema.verifications.personId, l.personId), isNull(schema.verifications.conversationId)));
  }
}

async function insertBoard(tx: Tx, threads: ReturnType<typeof buildBoard>, people: { id: string; name: string; email?: string }[]) {
  const who = (id: string) => {
    const p = people.find((x) => x.id === id)!;
    return { personId: p.id, authorName: p.name, authorEmail: p.email };
  };
  for (const t of threads) {
    const authors = [t.askerId, ...t.replies.map((r) => r.personId)];
    const participants = [...new Set(authors)].map((id) => ({ personId: id, name: who(id).authorName, email: who(id).authorEmail }));
    await tx.insert(schema.conversations).values({ id: t.id, source: "board", title: t.title, createdAt: t.askedAt, participants });
    const ids = await tx
      .insert(schema.messages)
      .values([{ ...who(t.askerId), conversationId: t.id, sentAt: t.askedAt, body: t.title }, ...t.replies.map((r) => ({ ...who(r.personId), conversationId: t.id, sentAt: r.sentAt, body: r.body }))])
      .returning({ id: schema.messages.id });
    const solved = t.solvedReply !== undefined ? ids[t.solvedReply + 1].id : null;
    await tx.insert(schema.boardThreads).values({ conversationId: t.id, topics: t.topics, locations: t.locations, askedIds: t.askedIds, askedAt: t.askedAt, solvedMessageId: solved });
  }
}

/**
 * Adds whatever part of the demo company isn't in the database yet – everything on first start, and
 * demo data added to seed.ts later – without touching existing rows.
 */
async function syncSeed(orm: Orm) {
  const seed = buildSeed();
  const ids = async <T extends { id: unknown }>(rows: Promise<T[]>) => new Set((await rows).map((r) => r.id as string));
  const teamIds = await ids(orm.select({ id: schema.teams.id }).from(schema.teams));
  const personIds = await ids(orm.select({ id: schema.people.id }).from(schema.people));
  const clientIds = await ids(orm.select({ id: schema.clients.id }).from(schema.clients));
  const docIds = await ids(orm.select({ id: schema.documents.id }).from(schema.documents));
  const convIds = await ids(orm.select({ id: schema.conversations.id }).from(schema.conversations));
  const folderIds = await ids(orm.select({ id: schema.folders.id }).from(schema.folders));
  // Like the folders: the default taxonomy goes into a database that has none, and is people's to change after that.
  const [{ n: termCount }] = await orm.select({ n: count() }).from(schema.taxonomyTerms);
  const terms = termCount ? [] : DEFAULT_TERMS;

  const teams = seed.teams.filter((t) => !teamIds.has(t.id));
  const people = seed.people.filter((p) => !personIds.has(p.id));
  const clients = seed.clients.filter((c) => !clientIds.has(c.id));
  const conversations = buildConversations().filter((c) => !convIds.has(c.id));
  const board = buildBoard().filter((t) => !convIds.has(t.id));
  // The example folders are only added to a drive that has no folders at all, so a single folder someone
  // deleted doesn't come back on the next start.
  // Parents come first in the seed, so inserting in order satisfies the parent reference.
  const folders = folderIds.size ? [] : seed.folders;
  const filed = new Set([...folderIds, ...folders.map((f) => f.id)]);
  const docs = seed.docs.filter((d) => !docIds.has(d.id)).map((d) => ({ ...d, folderId: d.folderId && filed.has(d.folderId) ? d.folderId : undefined }));
  if (!teams.length && !people.length && !clients.length && !docs.length && !conversations.length && !board.length && !folders.length && !terms.length) return;

  await orm.transaction(async (tx) => {
    if (teams.length) await tx.insert(schema.teams).values(teams);
    if (people.length) await tx.insert(schema.people).values(people);
    if (clients.length) await tx.insert(schema.clients).values(clients);
    for (const f of folders) await tx.insert(schema.folders).values(f);
    // A millisecond apart, so they come back in the order they're written in.
    const start = Date.now();
    if (terms.length) await tx.insert(schema.taxonomyTerms).values(terms.map((t, i) => ({ ...toTermRow(t), createdAt: new Date(start + i).toISOString() })));
    await insertDocs(tx, docs);
    // Databases from before folders existed: file the demo documents that are still at the top level.
    const newFolders = new Set(folders.map((f) => f.id));
    for (const d of seed.docs) {
      if (docIds.has(d.id) && d.folderId && newFolders.has(d.folderId)) {
        await tx.update(schema.documents).set({ folderId: d.folderId }).where(and(eq(schema.documents.id, d.id), isNull(schema.documents.folderId)));
      }
    }
    await insertConversations(tx, conversations);
    await linkVerificationSources(tx);
    await insertBoard(tx, board, [...seed.people]);
    const newDocs = new Set(docs.map((d) => d.id));
    const overrides = seed.overrides.filter((o) => newDocs.has(o.docId)).map(({ id: _id, ...o }) => o);
    if (overrides.length) await tx.insert(schema.conflictOverrides).values(overrides);
    // The demo mentee's recent questions and reading, added with the person.
    const newPeople = new Set(people.map((p) => p.id));
    const activity = seedActivity().filter((a) => newPeople.has(a.personId) && (!a.docId || newDocs.has(a.docId)));
    if (activity.length) await tx.insert(schema.activity).values(activity);
  });
  log.info("demo data added", { teams: teams.length, people: people.length, clients: clients.length, docs: docs.length, conversations: conversations.length, board: board.length, folders: folders.length, terms: terms.length });
}

/** Wipes everything and loads the demo company again. Only offered in demo mode. */
export async function resetDb() {
  const orm = await db();
  await orm.transaction(async (tx) => {
    for (const t of [schema.documentOpens, schema.activity, schema.notifications, schema.suggestedEdits, schema.answers, schema.boardThreads, schema.documentSources, schema.messages, schema.conversations, schema.conflictOverrides, schema.trustScores, schema.edits, schema.views, schema.verifications, schema.documentMembers, schema.documents, schema.folders, schema.taxonomyTerms, schema.clients, schema.people, schema.teams]) {
      await tx.delete(t);
    }
  });
  await syncSeed(orm);
}

// ---------------------------------------------------------------------------------------------
// Reads

/** Groups rows by a key, so assembling documents is one pass instead of a scan per document. */
function groupBy<T, K>(rows: T[], key: (r: T) => K) {
  const out = new Map<K, T[]>();
  for (const r of rows) out.set(key(r), [...(out.get(key(r)) ?? []), r]);
  return out;
}

/** Loads teams, people, clients and fully assembled documents – the shape the trust logic works on. */
export async function loadWorld(): Promise<Db> {
  const orm = await db();
  const [teams, peopleRows, clientRows, docRows, members, verifs, views, overrides, folderRows, terms] = await Promise.all([
    orm.select().from(schema.teams),
    orm.select().from(schema.people),
    orm.select().from(schema.clients),
    // Documents in the trash are left out of everything except the trash itself.
    orm.select().from(schema.documents).where(isNull(schema.documents.trashedAt)),
    orm.select().from(schema.documentMembers),
    orm.select().from(schema.verifications).orderBy(schema.verifications.at),
    orm.select().from(schema.views).orderBy(schema.views.at),
    orm.select().from(schema.conflictOverrides).orderBy(schema.conflictOverrides.at),
    orm.select().from(schema.folders),
    loadTerms(),
  ]);
  const membersOf = groupBy(members, (m) => m.docId);
  const verifsOf = groupBy(verifs, (v) => v.docId);
  const viewsOf = groupBy(views, (v) => v.docId);
  const docs: Doc[] = docRows.map(({ trashedAt: _t, trashedById: _b, ...d }) => ({
    ...d,
    supersededById: d.supersededById ?? undefined,
    clientId: d.clientId ?? undefined,
    confidential: d.confidential || undefined,
    folderId: d.folderId ?? undefined,
    collaboratorIds: (membersOf.get(d.id) ?? []).filter((m) => m.role === "collaborator").map((m) => m.personId),
    readerIds: (membersOf.get(d.id) ?? []).filter((m) => m.role === "reader").map((m) => m.personId),
    verifications: (verifsOf.get(d.id) ?? []).map(({ personId, at, conversationId, messageId }) => ({ personId, at, ...(conversationId && messageId ? { source: { conversationId, messageId } } : {}) })),
    views: (viewsOf.get(d.id) ?? []).map(({ personId, at }) => ({ personId, at })),
  }));
  return { teams, people: peopleRows.map(toPerson), docs, overrides, clients: clientRows.map(toClient), folders: folderRows.map(toFolder), terms };
}

const toPerson = (p: typeof schema.people.$inferSelect) => ({
  ...p,
  leftAt: p.leftAt ?? undefined,
  previousTeamId: p.previousTeamId ?? undefined,
  movedTeamAt: p.movedTeamAt ?? undefined,
  email: p.email ?? undefined,
  phone: p.phone ?? undefined,
  clientIds: p.clientIds ?? undefined,
  hiddenExpertise: p.hiddenExpertise ?? undefined,
  mentorId: p.mentorId ?? undefined,
  mentorSince: p.mentorSince ?? undefined,
});
const toClient = (c: typeof schema.clients.$inferSelect) => ({ ...c, domain: c.domain ?? undefined });

/** Teams, people, clients and the taxonomy – what every page needs – without loading any document. */
export async function loadDirectory() {
  const orm = await db();
  const [teams, peopleRows, clientRows, terms] = await Promise.all([orm.select().from(schema.teams), orm.select().from(schema.people), orm.select().from(schema.clients), loadTerms()]);
  return { teams, people: peopleRows.map(toPerson), clients: clientRows.map(toClient), terms };
}

/** Characters of text stored: live documents (trash included) and their edit history. For the storage quota. */
export async function storedChars() {
  const orm = await db();
  const [[docs], [history]] = await Promise.all([
    orm.select({ n: sql<number>`coalesce(sum(length(${schema.documents.content})), 0)::int` }).from(schema.documents),
    orm.select({ n: sql<number>`coalesce(sum(length(${schema.edits.content})), 0)::int` }).from(schema.edits),
  ]);
  return { documents: Number(docs.n), history: Number(history.n) };
}

/**
 * For the per-person quotas, counted in the database so they hold across restarts and server instances:
 * characters `personId` saved (history versions) since `since`, and characters in the documents they own.
 */
export async function charsWrittenBy(personId: string, since: string) {
  const orm = await db();
  const [[written], [owned]] = await Promise.all([
    orm.select({ n: sql<number>`coalesce(sum(length(${schema.edits.content})), 0)::int` }).from(schema.edits).where(and(eq(schema.edits.personId, personId), gte(schema.edits.at, since))),
    orm.select({ n: sql<number>`coalesce(sum(length(${schema.documents.content})), 0)::int` }).from(schema.documents).where(eq(schema.documents.ownerId, personId)),
  ]);
  return { written: Number(written.n), owned: Number(owned.n) };
}

function toTermRow(t: Term) {
  return { kind: t.kind, id: t.id, label: t.label, description: t.description, keywords: t.keywords, parentId: t.parent ?? null, createdAt: new Date().toISOString() };
}

/** The taxonomy in the order it was created (the defaults first, in their written order). */
export async function loadTerms(): Promise<Term[]> {
  const rows = await (await db()).select().from(schema.taxonomyTerms).orderBy(asc(schema.taxonomyTerms.createdAt), asc(schema.taxonomyTerms.id));
  return rows.map((r) => ({ kind: r.kind, id: r.id, label: r.label, description: r.description, keywords: r.keywords, parent: r.parentId ?? undefined }));
}

export async function createTerm(term: Term) {
  await (await db()).insert(schema.taxonomyTerms).values(toTermRow(term));
}

export async function updateTerm(kind: TermKind, id: string, patch: { label: string; description: string; keywords: string[]; parent?: string | null }) {
  await (await db())
    .update(schema.taxonomyTerms)
    .set({ label: patch.label, description: patch.description, keywords: patch.keywords, ...(patch.parent !== undefined ? { parentId: patch.parent } : {}) })
    .where(and(eq(schema.taxonomyTerms.kind, kind), eq(schema.taxonomyTerms.id, id)));
}

/** Removes a term. Documents keep a removed tag (it shows as untracked) until someone retags them. */
export async function deleteTerm(kind: TermKind, id: string) {
  await (await db()).delete(schema.taxonomyTerms).where(and(eq(schema.taxonomyTerms.kind, kind), eq(schema.taxonomyTerms.id, id)));
}

function toFolder(f: typeof schema.folders.$inferSelect): Folder {
  return { id: f.id, name: f.name, parentId: f.parentId ?? undefined, createdById: f.createdById ?? undefined, createdAt: f.createdAt };
}

export async function loadFolders(): Promise<Folder[]> {
  return (await (await db()).select().from(schema.folders)).map(toFolder);
}

function toTrust(row: typeof schema.trustScores.$inferSelect): TrustScore {
  const { id: _id, docId: _docId, viewerId: _viewerId, ...rest } = row;
  return rest;
}

export async function latestScore(docId: string, viewerId: string): Promise<TrustScore | null> {
  const [row] = await (await db())
    .select()
    .from(schema.trustScores)
    .where(and(eq(schema.trustScores.docId, docId), eq(schema.trustScores.viewerId, viewerId)))
    .orderBy(desc(schema.trustScores.id))
    .limit(1);
  return row ? toTrust(row) : null;
}

/** Latest score per document for one viewer. */
export async function latestScoresForViewer(viewerId: string): Promise<Map<string, TrustScore>> {
  const rows = await (await db())
    .selectDistinctOn([schema.trustScores.docId])
    .from(schema.trustScores)
    .where(eq(schema.trustScores.viewerId, viewerId))
    .orderBy(schema.trustScores.docId, desc(schema.trustScores.id));
  return new Map(rows.map((r) => [r.docId, toTrust(r)]));
}

/** Score history for a document as seen by one viewer, oldest first. */
export async function scoreHistory(docId: string, viewerId: string, limit = 20) {
  const rows = await (await db())
    .select({ score: schema.trustScores.score, computedAt: schema.trustScores.computedAt })
    .from(schema.trustScores)
    .where(and(eq(schema.trustScores.docId, docId), eq(schema.trustScores.viewerId, viewerId)))
    .orderBy(desc(schema.trustScores.id))
    .limit(limit);
  return rows.reverse();
}

export async function insertScore(docId: string, viewerId: string, t: TrustScore) {
  const { fallback: _fallback, ...row } = t;
  await (await db()).insert(schema.trustScores).values({ docId, viewerId, ...row });
}

export async function addVerification(docId: string, personId: string) {
  await (await db()).insert(schema.verifications).values({ docId, personId, at: new Date().toISOString() });
}

export async function documentExists(id: string) {
  const [row] = await (await db()).select({ id: schema.documents.id }).from(schema.documents).where(and(eq(schema.documents.id, id), isNull(schema.documents.trashedAt))).limit(1);
  return !!row;
}

/** Documents in the trash, newest first, with who put them there. */
export async function loadTrash() {
  const rows = await (await db())
    .select({ id: schema.documents.id, title: schema.documents.title, kind: schema.documents.kind, ownerId: schema.documents.ownerId, folderId: schema.documents.folderId, trashedAt: schema.documents.trashedAt, trashedById: schema.documents.trashedById })
    .from(schema.documents)
    .where(isNotNull(schema.documents.trashedAt))
    .orderBy(desc(schema.documents.trashedAt));
  return rows.map((r) => ({ ...r, trashedAt: r.trashedAt! }));
}

export async function trashDocument(docId: string, personId: string) {
  await (await db()).update(schema.documents).set({ trashedAt: new Date().toISOString(), trashedById: personId }).where(eq(schema.documents.id, docId));
}

/** Out of the trash, back where it was (its folder, if that still exists). */
export async function restoreDocument(docId: string) {
  await (await db()).update(schema.documents).set({ trashedAt: null, trashedById: null }).where(eq(schema.documents.id, docId));
}

/** Deletes a document for good; its history, scores, members and other rows go with it (cascade). */
export async function deleteDocumentForever(docId: string) {
  await (await db()).delete(schema.documents).where(and(eq(schema.documents.id, docId), isNotNull(schema.documents.trashedAt)));
}

/** The clients a person chose to see; null goes back to their team's clients. */
export async function setPersonClients(personId: string, clientIds: string[] | null) {
  await (await db()).update(schema.people).set({ clientIds }).where(eq(schema.people.id, personId));
}

/**
 * Makes `mentorId` the person's mentor, or removes their mentor (null). A new mentor only sees what
 * happens from now on, so `mentorSince` restarts; assigning the same mentor again changes nothing.
 */
export async function setMentor(personId: string, mentorId: string | null) {
  const orm = await db();
  const [p] = await orm.select({ mentorId: schema.people.mentorId }).from(schema.people).where(eq(schema.people.id, personId));
  if (!p || (p.mentorId ?? null) === mentorId) return;
  await orm.update(schema.people).set({ mentorId, mentorSince: mentorId ? new Date().toISOString() : null }).where(eq(schema.people.id, personId));
}

/** Repeats within this window are one event: reopening a document, or asking the same thing again. */
const ACTIVITY_DEDUPE_MS = 10 * 60_000;
/** A search typed further within this window replaces the shorter one ("leg" → "legal" → "legal hold"). */
const SEARCH_REFINE_MS = 2 * 60_000;

/**
 * Records what someone asked, searched for or opened – only while they have a mentor, who is the only
 * one shown it. Returns whether anything was stored.
 */
export async function recordActivity(personId: string, ev: { kind: ActivityEvent["kind"]; query?: string; docId?: string; results?: number }, now = Date.now()) {
  const orm = await db();
  const [p] = await orm.select({ mentorId: schema.people.mentorId }).from(schema.people).where(eq(schema.people.id, personId));
  if (!p?.mentorId) return false;
  const query = ev.query?.trim().slice(0, 300) || null;
  const [last] = await orm
    .select()
    .from(schema.activity)
    .where(and(eq(schema.activity.personId, personId), eq(schema.activity.kind, ev.kind)))
    .orderBy(desc(schema.activity.at), desc(schema.activity.id))
    .limit(1);
  const age = last ? now - Date.parse(last.at) : Infinity;
  const at = new Date(now).toISOString();
  if (ev.kind === "open" && last?.docId === ev.docId && age < ACTIVITY_DEDUPE_MS) return false;
  if (ev.kind === "ask" && last && fold(last.query) === fold(query) && age < ACTIVITY_DEDUPE_MS) return false;
  if (ev.kind === "search" && last && query && age < SEARCH_REFINE_MS) {
    const [a, b] = [fold(last.query), fold(query)];
    if (a === b || b.startsWith(a) || a.startsWith(b)) {
      await orm.update(schema.activity).set({ query, results: ev.results ?? null, at }).where(eq(schema.activity.id, last.id));
      return true;
    }
  }
  await orm.insert(schema.activity).values({ personId, kind: ev.kind, at, query, docId: ev.docId ?? null, results: ev.results ?? null });
  return true;
}
const fold = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Opening the same document again within this window is the same visit. */
const SAME_VISIT_MS = 12 * 3600_000;

/**
 * Records that someone opened a document, and returns the open before this visit (null if none was
 * recorded). Reopening it within the same visit keeps the earlier answer, so the page doesn't change
 * its mind on a reload.
 */
export async function recordOpen(docId: string, personId: string, now = Date.now()): Promise<{ at: string; personId: string | null } | null> {
  const orm = await db();
  const at = new Date(now).toISOString();
  const [row] = await orm.select().from(schema.documentOpens).where(eq(schema.documentOpens.docId, docId));
  if (!row) {
    await orm.insert(schema.documentOpens).values({ docId, at, personId }).onConflictDoNothing();
    return null;
  }
  if (row.personId === personId && now - Date.parse(row.at) < SAME_VISIT_MS) {
    return row.previousAt ? { at: row.previousAt, personId: row.previousPersonId } : null;
  }
  await orm.update(schema.documentOpens).set({ at, personId, previousAt: row.at, previousPersonId: row.personId }).where(eq(schema.documentOpens.docId, docId));
  return { at: row.at, personId: row.personId };
}

/** Someone's recorded activity since a moment, newest first. */
export async function loadActivity(personId: string, since: string, limit = 500): Promise<ActivityEvent[]> {
  const rows = await (await db())
    .select()
    .from(schema.activity)
    .where(and(eq(schema.activity.personId, personId), sql`${schema.activity.at} >= ${since}`))
    .orderBy(desc(schema.activity.at), desc(schema.activity.id))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, kind: r.kind, at: r.at, query: r.query ?? undefined, docId: r.docId ?? undefined, results: r.results ?? undefined }));
}

/** The topics and clients a person took off their expertise profile; an empty list shows everything again. */
export async function setHiddenExpertise(personId: string, subjects: string[]) {
  await (await db()).update(schema.people).set({ hiddenExpertise: subjects.length ? subjects : null }).where(eq(schema.people.id, personId));
}

export interface DocPatch {
  title?: string;
  content?: string;
  status?: DocStatus;
  locations?: Location[];
  audienceTeamIds?: string[];
  teamId?: string;
  tags?: string[];
  clientId?: string | null;
  confidential?: boolean;
}

/**
 * Applies a patch and records a snapshot in `edits`. Only title/content changes count as an
 * "edit" for recency (updatedAt / lastEditedBy); metadata changes are still recorded in history.
 */
export async function updateDocument(docId: string, personId: string, patch: DocPatch) {
  await (await db()).transaction(async (tx) => {
    // Lock the row: two people saving at once must not lose each other's snapshot.
    const [doc] = await tx.select().from(schema.documents).where(eq(schema.documents.id, docId)).for("update");
    if (!doc) return;
    const next = { ...doc, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    const changed =
      (["title", "content", "status", "teamId", "clientId", "confidential"] as const).some((k) => next[k] !== doc[k]) ||
      (["tags", "locations", "audienceTeamIds"] as const).some((k) => JSON.stringify(next[k]) !== JSON.stringify(doc[k]));
    if (!changed) return;
    const now = new Date().toISOString();
    const contentChanged = next.title !== doc.title || next.content !== doc.content;
    if (contentChanged) {
      next.updatedAt = now;
      next.lastEditedById = personId;
    }
    await tx.update(schema.documents).set(next).where(eq(schema.documents.id, docId));
    await addSnapshot(tx, { docId, personId, at: now, title: next.title, content: next.content, status: next.status, location: formatLocations(next.locations), teamId: next.teamId });
    // Anyone who edits content becomes a collaborator.
    if (contentChanged && doc.ownerId !== personId) {
      await tx
        .insert(schema.documentMembers)
        .values({ docId, personId, role: "collaborator" })
        .onConflictDoUpdate({ target: [schema.documentMembers.docId, schema.documentMembers.personId], set: { role: "collaborator" } });
    }
  });
}

/** Saving again within this long replaces the same person's last snapshot instead of adding one. */
export const EDIT_COALESCE_MS = 10 * 60_000;
/** A document keeps at most this many snapshots: the first (who wrote it) and the latest. */
export const MAX_VERSIONS = 100;

/**
 * Adds a snapshot to a document's history, bounded: a quick series of saves by one person is one
 * version (never the first, which records who created it), and beyond MAX_VERSIONS the oldest ones after
 * the first are dropped. Blame then credits a dropped version's lines to the next one kept.
 */
async function addSnapshot(tx: Tx, snap: typeof schema.edits.$inferInsert) {
  const versions = await tx.select({ id: schema.edits.id, personId: schema.edits.personId, at: schema.edits.at }).from(schema.edits).where(eq(schema.edits.docId, snap.docId)).orderBy(asc(schema.edits.at), asc(schema.edits.id));
  const last = versions.at(-1);
  if (versions.length > 1 && last && last.personId === snap.personId && Date.parse(snap.at) - Date.parse(last.at) < EDIT_COALESCE_MS) {
    await tx.update(schema.edits).set(snap).where(eq(schema.edits.id, last.id));
    return;
  }
  await tx.insert(schema.edits).values(snap);
  const excess = versions.length + 1 - MAX_VERSIONS;
  if (excess > 0) await tx.delete(schema.edits).where(inArray(schema.edits.id, versions.slice(1, 1 + excess).map((v) => v.id)));
}

/** Hands a document to a new owner. A previous owner who is still at the company stays on as collaborator. */
export async function transferOwnership(docId: string, newOwnerId: string) {
  await (await db()).transaction(async (tx) => {
    const [doc] = await tx.select().from(schema.documents).where(eq(schema.documents.id, docId)).for("update");
    if (!doc || doc.ownerId === newOwnerId) return;
    await tx.update(schema.documents).set({ ownerId: newOwnerId }).where(eq(schema.documents.id, docId));
    await tx.delete(schema.documentMembers).where(and(eq(schema.documentMembers.docId, docId), eq(schema.documentMembers.personId, newOwnerId)));
    const [previous] = doc.ownerId ? await tx.select().from(schema.people).where(eq(schema.people.id, doc.ownerId)) : [];
    if (previous?.active) {
      await tx
        .insert(schema.documentMembers)
        .values({ docId, personId: previous.id, role: "collaborator" })
        .onConflictDoUpdate({ target: [schema.documentMembers.docId, schema.documentMembers.personId], set: { role: "collaborator" } });
    }
  });
}

export async function createDocument(doc: Omit<Doc, "collaboratorIds" | "readerIds" | "verifications" | "views">, sourceConversationIds: string[] = []) {
  await (await db()).transaction(async (tx) => {
    await tx.insert(schema.documents).values(doc);
    if (sourceConversationIds.length) await tx.insert(schema.documentSources).values(sourceConversationIds.map((conversationId) => ({ docId: doc.id, conversationId })));
    await tx.insert(schema.edits).values({ docId: doc.id, personId: doc.lastEditedById, at: doc.createdAt, title: doc.title, content: doc.content, status: doc.status, location: formatLocations(doc.locations), teamId: doc.teamId });
  });
}

export async function createClient(client: Client) {
  await (await db()).insert(schema.clients).values({ ...client, domain: client.domain ?? null });
}

export async function updateClient(id: string, patch: Omit<Client, "id">) {
  await (await db()).update(schema.clients).set({ ...patch, domain: patch.domain ?? null }).where(eq(schema.clients.id, id));
}

export async function deleteClient(id: string) {
  await (await db()).delete(schema.clients).where(eq(schema.clients.id, id));
}

export async function createFolder(folder: Folder) {
  await (await db()).insert(schema.folders).values(folder);
}

export async function updateFolder(id: string, patch: { name?: string; parentId?: string | null }) {
  await (await db()).update(schema.folders).set(patch).where(eq(schema.folders.id, id));
}

/** Removes a folder; its documents and subfolders move up to where the folder was, so nothing is lost. */
export async function deleteFolder(id: string) {
  await (await db()).transaction(async (tx) => {
    const [folder] = await tx.select().from(schema.folders).where(eq(schema.folders.id, id)).for("update");
    if (!folder) return;
    await tx.update(schema.documents).set({ folderId: folder.parentId }).where(eq(schema.documents.folderId, id));
    await tx.update(schema.folders).set({ parentId: folder.parentId }).where(eq(schema.folders.parentId, id));
    await tx.delete(schema.folders).where(eq(schema.folders.id, id));
  });
}

/** Files a document in a folder (null = top of the drive). Not an edit: it's not in the history and doesn't change the score. */
export async function moveDocument(docId: string, folderId: string | null) {
  await (await db()).update(schema.documents).set({ folderId }).where(eq(schema.documents.id, docId));
}

/** Permanently attaches "I saved this despite these conflicts" to a document. */
export async function recordOverrides(docId: string, personId: string, reason: string, conflicts: Conflict[]) {
  if (!conflicts.length) return;
  const at = new Date().toISOString();
  await (await db()).insert(schema.conflictOverrides).values(
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
  );
}

/** Content snapshots per document, oldest first – input for blame / contribution analysis. */
export async function loadHistory(docIds?: string[]) {
  const orm = await db();
  const q = orm
    .select({
      docId: schema.edits.docId,
      personId: schema.edits.personId,
      at: schema.edits.at,
      title: schema.edits.title,
      content: schema.edits.content,
      status: schema.edits.status,
      location: schema.edits.location,
      teamId: schema.edits.teamId,
    })
    .from(schema.edits);
  const rows = await (docIds ? q.where(inArray(schema.edits.docId, docIds.length ? docIds : [""])) : q).orderBy(asc(schema.edits.at), asc(schema.edits.id));
  return groupBy(rows, (r) => r.docId);
}

export type NotificationRow = typeof schema.notifications.$inferSelect;
export type NewNotification = Omit<typeof schema.notifications.$inferInsert, "id" | "createdAt" | "readAt">;

export async function insertNotifications(items: NewNotification[]) {
  if (!items.length) return;
  const createdAt = new Date().toISOString();
  await (await db()).insert(schema.notifications).values(items.map((n) => ({ ...n, createdAt })));
}

export async function listNotifications(recipientId: string, limit = 30) {
  const orm = await db();
  const mine = eq(schema.notifications.recipientId, recipientId);
  const [items, [{ unread }]] = await Promise.all([
    orm.select().from(schema.notifications).where(mine).orderBy(desc(schema.notifications.id)).limit(limit),
    orm
      .select({ unread: count() })
      .from(schema.notifications)
      .where(and(mine, isNull(schema.notifications.readAt))),
  ]);
  return { items, unread };
}

export async function markNotificationsRead(recipientId: string, ids?: number[]) {
  const where = and(eq(schema.notifications.recipientId, recipientId), isNull(schema.notifications.readAt), ids ? inArray(schema.notifications.id, ids.length ? ids : [-1]) : undefined);
  await (await db()).update(schema.notifications).set({ readAt: new Date().toISOString() }).where(where);
}

function toMessage(m: typeof schema.messages.$inferSelect): Message {
  return { id: m.id, personId: m.personId ?? undefined, authorName: m.authorName, authorEmail: m.authorEmail ?? undefined, sentAt: m.sentAt, body: m.body };
}

/** Email threads and Teams chats with their messages (oldest first), newest conversation activity first. Board threads: loadBoard. */
export async function loadConversations(ids?: string[]): Promise<Conversation[]> {
  const orm = await db();
  const notBoard = ne(schema.conversations.source, "board");
  const convs = (await orm
    .select()
    .from(schema.conversations)
    .where(ids ? and(notBoard, inArray(schema.conversations.id, ids.length ? ids : [""])) : notBoard)) as (typeof schema.conversations.$inferSelect & { source: Conversation["source"] })[];
  if (!convs.length) return [];
  const msgs = await orm
    .select()
    .from(schema.messages)
    .where(inArray(schema.messages.conversationId, convs.map((c) => c.id)))
    .orderBy(asc(schema.messages.sentAt), asc(schema.messages.id));
  const byConversation = groupBy(msgs, (m) => m.conversationId);
  const last = (c: Conversation) => c.messages.at(-1)?.sentAt ?? c.createdAt;
  return convs
    .map(({ answersThroughId: _through, keepPrivate, ...c }) => ({
      ...c,
      clientId: c.clientId ?? undefined,
      importedById: c.importedById ?? undefined,
      keepPrivate: keepPrivate || undefined,
      messages: (byConversation.get(c.id) ?? []).map(toMessage),
    }))
    .sort((a, b) => last(b).localeCompare(last(a)));
}

export async function createConversation(c: Omit<Conversation, "messages">, messages: Omit<Message, "id">[]) {
  await (await db()).transaction(async (tx) => {
    await tx.insert(schema.conversations).values(c);
    if (messages.length) await tx.insert(schema.messages).values(messages.map((m) => ({ ...m, conversationId: c.id })));
  });
}

/** Adds messages to a conversation and makes sure everyone involved is a participant. */
export async function addMessages(conversationId: string, messages: Omit<Message, "id">[], participants: Participant[]) {
  await (await db()).transaction(async (tx) => {
    const [conv] = await tx.select({ participants: schema.conversations.participants }).from(schema.conversations).where(eq(schema.conversations.id, conversationId)).for("update");
    if (!conv) return;
    const all = new Map(conv.participants.map((p) => [p.personId ?? p.email ?? p.name, p]));
    for (const p of participants) all.set(p.personId ?? p.email ?? p.name, p);
    await tx.update(schema.conversations).set({ participants: [...all.values()] }).where(eq(schema.conversations.id, conversationId));
    if (messages.length) await tx.insert(schema.messages).values(messages.map((m) => ({ ...m, conversationId })));
  });
}

/**
 * "Don't keep for others" on or off. Making a conversation private deletes the answers captured from it;
 * either way it's looked at again from the start on the next capture.
 */
export async function setConversationPrivate(conversationId: string, keepPrivate: boolean) {
  await (await db()).transaction(async (tx) => {
    await tx.update(schema.conversations).set({ keepPrivate, answersThroughId: null }).where(eq(schema.conversations.id, conversationId));
    if (keepPrivate) await tx.delete(schema.answers).where(eq(schema.answers.conversationId, conversationId));
  });
}

/** For each conversation: whether it's private, and the last message already looked at for answers. */
export async function answerProgress() {
  const rows = await (await db()).select({ id: schema.conversations.id, keepPrivate: schema.conversations.keepPrivate, through: schema.conversations.answersThroughId }).from(schema.conversations);
  return new Map(rows.map((r) => [r.id, { keepPrivate: r.keepPrivate, through: r.through }]));
}

export async function setAnswersThrough(conversationId: string, messageId: number) {
  await (await db()).update(schema.conversations).set({ answersThroughId: messageId }).where(eq(schema.conversations.id, conversationId));
}

export type NewAnswer = Omit<typeof schema.answers.$inferInsert, "id" | "createdAt">;

/** Stores captured answers; an answer that's already stored is skipped. Returns the new ones. */
export async function insertAnswers(rows: NewAnswer[]) {
  if (!rows.length) return [];
  const now = new Date().toISOString();
  return (await db())
    .insert(schema.answers)
    .values(rows.map((r) => ({ ...r, createdAt: now })))
    .onConflictDoNothing({ target: schema.answers.answerMessageId })
    .returning({ id: schema.answers.id, answerMessageId: schema.answers.answerMessageId });
}

/** Every captured answer, shared or not, newest first, with its conversation's title, kind and colleagues. */
export async function loadAnswers(): Promise<Answer[]> {
  const rows = await (await db())
    .select({ a: schema.answers, title: schema.conversations.title, source: schema.conversations.source, participants: schema.conversations.participants, solved: schema.boardThreads.solvedMessageId })
    .from(schema.answers)
    .innerJoin(schema.conversations, eq(schema.answers.conversationId, schema.conversations.id))
    .leftJoin(schema.boardThreads, eq(schema.boardThreads.conversationId, schema.answers.conversationId))
    .orderBy(desc(schema.answers.answeredAt));
  return rows.map(({ a: { createdAt: _created, editsCheckedAt: _checked, ...a }, title, source, participants, solved }) => ({
    ...a,
    conversationTitle: title,
    source,
    participantIds: participants.flatMap((p) => (p.personId ? [p.personId] : [])),
    confirmed: solved === a.answerMessageId,
    clientId: a.clientId ?? undefined,
    conflict: a.conflict ?? undefined,
    faqDocId: a.faqDocId ?? undefined,
    faqDismissedAt: a.faqDismissedAt ?? undefined,
  }));
}

/** Shared answers not yet checked for changes they suggest to documents. */
export async function answersToCheckForEdits() {
  const rows = await (await db()).select({ id: schema.answers.id }).from(schema.answers).where(and(eq(schema.answers.sharing, "shared"), isNull(schema.answers.editsCheckedAt)));
  return rows.map((r) => r.id);
}

export async function markEditsChecked(answerIds: number[]) {
  if (!answerIds.length) return;
  await (await db()).update(schema.answers).set({ editsCheckedAt: new Date().toISOString() }).where(inArray(schema.answers.id, answerIds));
}

export type NewSuggestedEdit = Omit<typeof schema.suggestedEdits.$inferInsert, "id" | "createdAt">;

export async function insertSuggestedEdits(rows: NewSuggestedEdit[]) {
  if (!rows.length) return [];
  const now = new Date().toISOString();
  return (await db()).insert(schema.suggestedEdits).values(rows.map((r) => ({ ...r, createdAt: now }))).returning({ id: schema.suggestedEdits.id, answerId: schema.suggestedEdits.answerId });
}

/** Suggested edits, newest first; all of them, or only some. */
export async function loadSuggestedEdits(by: { ids?: number[]; docId?: string } = {}): Promise<SuggestedEdit[]> {
  const q = (await db()).select().from(schema.suggestedEdits);
  const where = by.ids ? inArray(schema.suggestedEdits.id, by.ids.length ? by.ids : [-1]) : by.docId ? eq(schema.suggestedEdits.docId, by.docId) : undefined;
  const rows = await (where ? q.where(where) : q).orderBy(desc(schema.suggestedEdits.createdAt), desc(schema.suggestedEdits.id));
  return rows.map((r) => ({ ...r, oldLine: r.oldLine ?? undefined, decidedAt: r.decidedAt ?? undefined, decidedById: r.decidedById ?? undefined, reason: r.reason ?? undefined }));
}

export async function updateSuggestedEdit(id: number, patch: Partial<Pick<SuggestedEdit, "status" | "newLine" | "reason" | "decidedById" | "decidedAt">>) {
  await (await db()).update(schema.suggestedEdits).set(patch).where(eq(schema.suggestedEdits.id, id));
}

/** Answers someone gave that are now written up in a document. Only their own answers are changed. */
export async function markAnswersInFaq(answerIds: number[], answererId: string, docId: string) {
  if (!answerIds.length) return;
  await (await db()).update(schema.answers).set({ faqDocId: docId }).where(and(inArray(schema.answers.id, answerIds), eq(schema.answers.answererId, answererId)));
}

/** The person who answered shares their answers (or keeps them to themselves). Only their own answers are changed. */
export async function setAnswerSharing(answerIds: number[], answererId: string, sharing: Answer["sharing"]) {
  if (!answerIds.length) return;
  await (await db()).update(schema.answers).set({ sharing }).where(and(inArray(schema.answers.id, answerIds), eq(schema.answers.answererId, answererId)));
}

/** Deletes answers someone chose to keep to themselves. Only their own answers. */
export async function deleteAnswers(answerIds: number[], answererId: string) {
  if (!answerIds.length) return;
  await (await db()).delete(schema.answers).where(and(inArray(schema.answers.id, answerIds), eq(schema.answers.answererId, answererId)));
}

/** Ask me, always share, or never keep the answers someone gives in private chats. */
export async function setPersonSharing(personId: string, answerSharing: "ask" | "always" | "never") {
  await (await db()).update(schema.people).set({ answerSharing }).where(eq(schema.people.id, personId));
}

/** "Not now" on writing these answers up. Only their own answers are changed. */
export async function dismissFaq(answerIds: number[], answererId: string) {
  if (!answerIds.length) return;
  await (await db()).update(schema.answers).set({ faqDismissedAt: new Date().toISOString() }).where(and(inArray(schema.answers.id, answerIds), eq(schema.answers.answererId, answererId)));
}

/** Posts a question on the board: a conversation (source "board") whose first message is the question. */
export async function createBoardThread(t: { id: string; title: string; askerId: string; askerName: string; askerEmail?: string; body: string; at: string; topics: string[]; locations: Location[]; askedIds: string[] }) {
  await (await db()).transaction(async (tx) => {
    await tx.insert(schema.conversations).values({ id: t.id, source: "board", title: t.title, createdAt: t.at, participants: [{ personId: t.askerId, name: t.askerName, email: t.askerEmail }] });
    await tx.insert(schema.messages).values({ conversationId: t.id, personId: t.askerId, authorName: t.askerName, authorEmail: t.askerEmail, sentAt: t.at, body: t.body });
    await tx.insert(schema.boardThreads).values({ conversationId: t.id, topics: t.topics, locations: t.locations, askedIds: t.askedIds, askedAt: t.at });
  });
}

/** Board questions with their replies, newest activity first. */
export async function loadBoard(ids?: string[]): Promise<BoardThread[]> {
  const orm = await db();
  const q = orm.select({ c: schema.conversations, b: schema.boardThreads }).from(schema.boardThreads).innerJoin(schema.conversations, eq(schema.boardThreads.conversationId, schema.conversations.id));
  const rows = await (ids ? q.where(inArray(schema.boardThreads.conversationId, ids.length ? ids : [""])) : q);
  if (!rows.length) return [];
  const msgs = await orm
    .select()
    .from(schema.messages)
    .where(inArray(schema.messages.conversationId, rows.map((r) => r.c.id)))
    .orderBy(asc(schema.messages.sentAt), asc(schema.messages.id));
  const byThread = groupBy(msgs.map((m) => ({ ...toMessage(m), conversationId: m.conversationId })), (m) => m.conversationId);
  return rows
    .flatMap(({ c, b }) => {
      const [question, ...replies] = (byThread.get(c.id) ?? []).map(({ conversationId: _c, ...m }) => m);
      if (!question?.personId) return [];
      return [{ id: c.id, title: c.title, askerId: question.personId, askedAt: question.sentAt, question, replies, topics: b.topics, locations: b.locations, askedIds: b.askedIds, lastAskedAt: b.askedAt, solvedMessageId: b.solvedMessageId ?? undefined }];
    })
    .sort((a, b) => (b.replies.at(-1)?.sentAt ?? b.askedAt).localeCompare(a.replies.at(-1)?.sentAt ?? a.askedAt));
}

/** The answer that solved it (or none). */
export async function setSolved(threadId: string, messageId: number | null) {
  await (await db()).update(schema.boardThreads).set({ solvedMessageId: messageId }).where(eq(schema.boardThreads.conversationId, threadId));
}

/** More colleagues asked to answer. */
export async function setAsked(threadId: string, askedIds: string[], at: string) {
  await (await db()).update(schema.boardThreads).set({ askedIds, askedAt: at }).where(eq(schema.boardThreads.conversationId, threadId));
}

/** Conversations a document was written from. */
export async function documentSources(docId: string) {
  const rows = await (await db()).select({ id: schema.documentSources.conversationId }).from(schema.documentSources).where(eq(schema.documentSources.docId, docId));
  return rows.length ? loadConversations(rows.map((r) => r.id)) : [];
}

/** A person by id or (case-insensitive) email, for identifying who's signed in. */
export async function findPerson(by: { id: string } | { email: string }) {
  const where = "id" in by ? eq(schema.people.id, by.id) : sql`lower(${schema.people.email}) = ${by.email.toLowerCase()}`;
  const [p] = await (await db()).select().from(schema.people).where(where).limit(1);
  return p ? { ...p, leftAt: p.leftAt ?? undefined, previousTeamId: p.previousTeamId ?? undefined, movedTeamAt: p.movedTeamAt ?? undefined, email: p.email ?? undefined, phone: p.phone ?? undefined, clientIds: p.clientIds ?? undefined, hiddenExpertise: p.hiddenExpertise ?? undefined, mentorId: p.mentorId ?? undefined, mentorSince: p.mentorSince ?? undefined } : null;
}

/** Liveness of the database, for the health check. */
export async function pingDb() {
  await (await db()).execute(sql`select 1`);
}
