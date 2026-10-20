import { z } from "zod";
import { STATUSES } from "./types";

/** Request bodies shared by several routes. */

/** A country from the taxonomy or "Global"; routes check it against the stored countries. */
export const location = z.string().trim().min(1).max(60);
/** Who a document applies to: countries (or Global), and optionally teams within them. */
const locations = z.array(location).min(1, "Pick at least one country, or Global.").max(20);
const audienceTeamIds = z.array(z.string()).max(30);
export const status = z.enum(STATUSES as [string, ...string[]]).transform((s) => s as (typeof STATUSES)[number]);
/** Shortest reason accepted for saving over a hard conflict: a sentence, not a keystroke. */
export const MIN_OVERRIDE_REASON = 10;
/** "Save anyway" for hard conflicts: needs a written reason (see gateDraft). */
export const override = z.object({ reason: z.string().trim().max(2000) }).optional();
const text = (max: number) => z.string().max(max);

export const newDocument = z.object({
  title: text(300).optional(),
  content: text(200_000).default(""),
  kind: z.enum(["doc", "sheet", "pdf"]).default("doc"),
  locations: locations.optional(),
  audienceTeamIds: audienceTeamIds.optional(),
  status: status.optional(),
  tags: z.array(text(60)).max(30).default([]),
  clientId: z.string().optional(),
  sourceConversationIds: z.array(z.string()).max(30).default([]),
  /** Answers the creator gave in chat that this document writes up (an FAQ); see answers.ts. */
  answerIds: z.array(z.number().int()).max(100).default([]),
  /** The folder it's created in; unknown or missing = the top of the drive. */
  folderId: z.string().optional(),
  /** Never sent to Jev. */
  confidential: z.boolean().default(false),
  override,
  acknowledgeSimilar: z.boolean().optional(),
});

export const newFolder = z.object({
  name: z.string(),
  /** null or missing = the top of the drive. */
  parentId: z.string().nullable().optional(),
});

export const folderPatch = z.object({
  name: z.string().optional(),
  /** null moves the folder to the top of the drive. */
  parentId: z.string().nullable().optional(),
});

/** Files a document in a folder; null = the top of the drive. */
export const documentFolder = z.object({ folderId: z.string().nullable() });

export const documentPatch = z.object({
  title: text(300).optional(),
  content: text(200_000).optional(),
  status: status.optional(),
  locations: locations.optional(),
  audienceTeamIds: audienceTeamIds.optional(),
  tags: z.array(text(60)).max(30).optional(),
  /** null removes the client. */
  clientId: z.string().nullable().optional(),
  confidential: z.boolean().optional(),
  override,
  acknowledgeSimilar: z.boolean().optional(),
});

export const conflictDraft = z.object({
  docId: z.string().optional(),
  title: text(300).optional(),
  content: text(200_000).default(""),
  locations: locations.optional(),
  teamId: z.string().optional(),
  confidential: z.boolean().optional(),
});

export const conversationImport = z
  .object({
    source: z.enum(["email", "teams"]).default("email"),
    clientId: z.string().optional(),
    title: text(300).optional(),
    text: text(500_000).optional(),
    eml: text(5_000_000).optional(),
  })
  .refine((b) => b.text?.trim() || b.eml?.trim(), { message: "Paste a conversation or choose an .eml file." });

/** A topic, document type or country as edited on the Company & tags page. */
export const termInput = z.object({
  label: z.string(),
  description: z.string().trim().max(300).default(""),
  /** Words in any language that point at it; used by the suggestion rules and as evidence for Jev. */
  keywords: z.array(z.string().trim().toLowerCase().max(60)).max(80).default([]),
  /** Topics only: the main topic a sub-topic belongs to; null makes it a main topic. */
  parent: z.string().nullable().optional(),
});

export const termKind = z.enum(["topic", "docType", "country"]);

export const clientInput = z.object({
  name: z.string().max(200),
  domain: z.string().max(200).nullish(),
  teamId: z.string().max(60),
  location,
});
