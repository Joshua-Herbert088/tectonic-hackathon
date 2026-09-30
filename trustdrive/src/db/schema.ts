import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { DocStatus, Location } from "../lib/types";

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const people = sqliteTable("people", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  teamId: text("team_id").notNull().references(() => teams.id),
  location: text("location").$type<Location>().notNull(),
  active: integer("active", { mode: "boolean" }).notNull(),
  joinedAt: text("joined_at").notNull(),
  leftAt: text("left_at"),
  previousTeamId: text("previous_team_id").references(() => teams.id),
  movedTeamAt: text("moved_team_at"),
  color: text("color").notNull(),
});

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  kind: text("kind").$type<"doc" | "sheet" | "pdf">().notNull(),
  content: text("content").notNull(),
  ownerId: text("owner_id").references(() => people.id),
  location: text("location").$type<Location>().notNull(),
  status: text("status").$type<DocStatus>().notNull(),
  teamId: text("team_id").notNull().references(() => teams.id),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastEditedById: text("last_edited_by_id").references(() => people.id),
  supersededById: text("superseded_by_id"),
});

/** Collaborators and readers. The owner lives on the document itself. */
export const documentMembers = sqliteTable(
  "document_members",
  {
    docId: text("doc_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    personId: text("person_id").notNull().references(() => people.id),
    role: text("role").$type<"collaborator" | "reader">().notNull(),
  },
  (t) => [primaryKey({ columns: [t.docId, t.personId] })],
);

export const verifications = sqliteTable(
  "verifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    docId: text("doc_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    personId: text("person_id").notNull().references(() => people.id),
    at: text("at").notNull(),
  },
  (t) => [index("verifications_doc_idx").on(t.docId)],
);

export const views = sqliteTable(
  "views",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    docId: text("doc_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    personId: text("person_id").notNull().references(() => people.id),
    at: text("at").notNull(),
  },
  (t) => [index("views_doc_idx").on(t.docId)],
);

/** Snapshot of the document after every edit (title/content/metadata). */
export const edits = sqliteTable(
  "edits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    docId: text("doc_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    personId: text("person_id").references(() => people.id),
    at: text("at").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    status: text("status").$type<DocStatus>().notNull(),
    location: text("location").$type<Location>().notNull(),
    teamId: text("team_id").notNull(),
  },
  (t) => [index("edits_doc_idx").on(t.docId)],
);

/** Every Jev result is kept; the latest row per (doc, viewer) is the current score. */
export const trustScores = sqliteTable(
  "trust_scores",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    docId: text("doc_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    viewerId: text("viewer_id").notNull().references(() => people.id),
    score: integer("score").notNull(),
    confidence: real("confidence").notNull(),
    levelProbabilities: text("level_probabilities", { mode: "json" }).$type<Record<string, number>>().notNull(),
    model: text("model").notNull(),
    inputHash: text("input_hash").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    computedAt: text("computed_at").notNull(),
  },
  (t) => [index("trust_scores_doc_viewer_idx").on(t.docId, t.viewerId, t.id)],
);

/**
 * A person saved a document even though Jev found a hard conflict with another document.
 * Snapshots both lines so the decision stays auditable even if either document changes later.
 */
export const conflictOverrides = sqliteTable(
  "conflict_overrides",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    docId: text("doc_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    personId: text("person_id").notNull().references(() => people.id),
    at: text("at").notNull(),
    reason: text("reason").notNull(),
    probability: real("probability").notNull(),
    lineNo: integer("line_no").notNull(),
    lineText: text("line_text").notNull(),
    existingDocId: text("existing_doc_id").notNull(),
    existingTitle: text("existing_title").notNull(),
    existingLineNo: integer("existing_line_no").notNull(),
    existingLineText: text("existing_line_text").notNull(),
  },
  (t) => [index("conflict_overrides_doc_idx").on(t.docId), index("conflict_overrides_existing_idx").on(t.existingDocId)],
);
