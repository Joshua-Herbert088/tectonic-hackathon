import { sql } from "drizzle-orm";
import { boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, serial, text, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { DocStatus, Location, Participant } from "../lib/types";

// Timestamps are ISO-8601 strings (text): the app compares and sorts them as strings.

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const people = pgTable(
  "people",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    teamId: text("team_id").notNull().references(() => teams.id),
    location: text("location").$type<Location>().notNull(),
    active: boolean("active").notNull(),
    joinedAt: text("joined_at").notNull(),
    leftAt: text("left_at"),
    previousTeamId: text("previous_team_id").references(() => teams.id),
    movedTeamAt: text("moved_team_at"),
    color: text("color").notNull(),
    email: text("email"),
    phone: text("phone"),
    /** The clients this person chose to see. Null: their team's clients (the default). */
    clientIds: jsonb("client_ids").$type<string[]>(),
    /** Topics and clients ("topic:salary", "client:noordkaai") the person took off their own expertise profile. */
    hiddenExpertise: jsonb("hidden_expertise").$type<string[]>(),
  },
  // People are looked up by email.
  (t) => [uniqueIndex("people_email_idx").on(t.email)],
);

/** A customer whose payroll the company runs. `domain` recognises the client's people in imported mail. */
export const clients = pgTable("clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain"),
  teamId: text("team_id").notNull().references(() => teams.id),
  location: text("location").$type<Location>().notNull(),
});

/** The editable taxonomy: topics (two levels), document types and countries. See taxonomy.ts. */
export const taxonomyTerms = pgTable(
  "taxonomy_terms",
  {
    kind: text("kind").$type<"topic" | "docType" | "country">().notNull(),
    id: text("id").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull().default(""),
    keywords: jsonb("keywords").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    parentId: text("parent_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.id] })],
);

/** A folder in the drive. Folders nest through `parentId`; null is the top of the drive. */
export const folders = pgTable(
  "folders",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    parentId: text("parent_id").references((): AnyPgColumn => folders.id),
    createdById: text("created_by_id").references(() => people.id),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("folders_parent_idx").on(t.parentId)],
);

export const documents = pgTable("documents", {
  id: text("id").primaryKey(),
  /** Null: at the top of the drive. Not something Jev sees, so moving a document never changes its score. */
  folderId: text("folder_id").references(() => folders.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  kind: text("kind").$type<"doc" | "sheet" | "pdf">().notNull(),
  content: text("content").notNull(),
  ownerId: text("owner_id").references(() => people.id),
  /** Countries it applies to (or ["Global"]), and the teams within them; no teams = all of them. */
  locations: jsonb("locations").$type<Location[]>().notNull(),
  audienceTeamIds: jsonb("audience_team_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  status: text("status").$type<DocStatus>().notNull(),
  /** The team that maintains it: the creator's team. */
  teamId: text("team_id").notNull().references(() => teams.id),
  tags: jsonb("tags").$type<string[]>().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastEditedById: text("last_edited_by_id").references(() => people.id),
  supersededById: text("superseded_by_id"),
  clientId: text("client_id").references(() => clients.id),
  /** Confidential documents are never sent to Jev: their scores and checks use the rules. */
  confidential: boolean("confidential").notNull().default(false),
  /** Set while the document is in the trash: hidden everywhere until it's restored or deleted for good. */
  trashedAt: text("trashed_at"),
  trashedById: text("trashed_by_id").references(() => people.id),
});

/** Collaborators and readers. The owner lives on the document itself. */
export const documentMembers = pgTable(
  "document_members",
  {
    docId: text("doc_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    personId: text("person_id").notNull().references(() => people.id),
    role: text("role").$type<"collaborator" | "reader">().notNull(),
  },
  (t) => [primaryKey({ columns: [t.docId, t.personId] })],
);

export const verifications = pgTable(
  "verifications",
  {
    id: serial("id").primaryKey(),
    docId: text("doc_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    personId: text("person_id").notNull().references(() => people.id),
    at: text("at").notNull(),
  },
  (t) => [index("verifications_doc_idx").on(t.docId)],
);

export const views = pgTable(
  "views",
  {
    id: serial("id").primaryKey(),
    docId: text("doc_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    personId: text("person_id").notNull().references(() => people.id),
    at: text("at").notNull(),
  },
  (t) => [index("views_doc_idx").on(t.docId)],
);

/** Snapshot of the document after every edit (title/content/metadata). */
export const edits = pgTable(
  "edits",
  {
    id: serial("id").primaryKey(),
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
export const trustScores = pgTable(
  "trust_scores",
  {
    id: serial("id").primaryKey(),
    docId: text("doc_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    viewerId: text("viewer_id").notNull().references(() => people.id),
    score: integer("score").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    levelProbabilities: jsonb("level_probabilities").$type<Record<string, number>>().notNull(),
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
export const conflictOverrides = pgTable(
  "conflict_overrides",
  {
    id: serial("id").primaryKey(),
    docId: text("doc_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    personId: text("person_id").notNull().references(() => people.id),
    at: text("at").notNull(),
    reason: text("reason").notNull(),
    probability: doublePrecision("probability").notNull(),
    lineNo: integer("line_no").notNull(),
    lineText: text("line_text").notNull(),
    existingDocId: text("existing_doc_id").notNull(),
    existingTitle: text("existing_title").notNull(),
    existingLineNo: integer("existing_line_no").notNull(),
    existingLineText: text("existing_line_text").notNull(),
  },
  (t) => [index("conflict_overrides_doc_idx").on(t.docId), index("conflict_overrides_existing_idx").on(t.existingDocId)],
);

export interface NotificationChange {
  /** Line in the document the change happened in (current numbering for edits). */
  lineNo: number;
  before: string | null;
  after: string | null;
}

/**
 * Tells the author of a piece of information that someone changed it (an edit to lines they wrote)
 * or saved a document that contradicts it (a conflict override).
 */
export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    recipientId: text("recipient_id").notNull().references(() => people.id),
    actorId: text("actor_id").notNull().references(() => people.id),
    /**
     * edit: lines you wrote changed · doc_edit: your document changed · override: a save contradicts your
     * document · message: someone wrote to you (docId/docTitle are then the conversation, reason a preview)
     */
    kind: text("kind").$type<"edit" | "doc_edit" | "override" | "message">().notNull(),
    /** The document the recipient's information lives in (for messages: the conversation). */
    docId: text("doc_id").notNull(),
    docTitle: text("doc_title").notNull(),
    /** For overrides: the document that was saved despite contradicting the recipient's line. */
    otherDocId: text("other_doc_id"),
    otherDocTitle: text("other_doc_title"),
    changes: jsonb("changes").$type<NotificationChange[]>().notNull(),
    reason: text("reason"),
    createdAt: text("created_at").notNull(),
    readAt: text("read_at"),
  },
  (t) => [index("notifications_recipient_idx").on(t.recipientId, t.id)],
);

/** An email thread or Teams chat, from the demo mailbox or imported by someone. */
export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    source: text("source").$type<"email" | "teams">().notNull(),
    title: text("title").notNull(),
    clientId: text("client_id").references(() => clients.id),
    importedById: text("imported_by_id").references(() => people.id),
    createdAt: text("created_at").notNull(),
    /** Everyone on the thread: colleagues (personId) and client contacts (name and address only). */
    participants: jsonb("participants").$type<Participant[]>().notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [index("conversations_client_idx").on(t.clientId)],
);

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    /** Set when the author is a colleague; client contacts only have a name and address. */
    personId: text("person_id").references(() => people.id),
    authorName: text("author_name").notNull(),
    authorEmail: text("author_email"),
    sentAt: text("sent_at").notNull(),
    body: text("body").notNull(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId)],
);

/** Conversations a document was written from, so every line can be traced back. */
export const documentSources = pgTable(
  "document_sources",
  {
    docId: text("doc_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.docId, t.conversationId] })],
);
