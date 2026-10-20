import type { Term } from "./taxonomy";

/** A country's name, or "Global". Countries are part of the editable taxonomy (see taxonomy.ts). */
export type Location = string;

export type DocStatus = "WIP" | "To be reviewed" | "Completed";
export const STATUSES: DocStatus[] = ["WIP", "To be reviewed", "Completed"];

export interface Team {
  id: string;
  name: string;
}

export interface Person {
  id: string;
  name: string;
  role: string;
  teamId: string;
  location: Location;
  active: boolean;
  joinedAt: string;
  leftAt?: string;
  /** The clients they chose to see; unset = their team's clients. */
  clientIds?: string[];
  /** Topics and clients they took off their expertise profile ("topic:salary", "client:noordkaai"). */
  hiddenExpertise?: string[];
  /** Their mentor (buddy), who can see what they ask, search and open since `mentorSince`. */
  mentorId?: string;
  mentorSince?: string;
  /** Set when the person moved to a different team; teamId is the current one. */
  previousTeamId?: string;
  movedTeamAt?: string;
  color: string;
  email?: string;
  phone?: string;
}

/** Something a mentee asked, searched for or opened, recorded for their mentor. */
export interface ActivityEvent {
  id: number;
  kind: "ask" | "search" | "open";
  at: string;
  query?: string;
  docId?: string;
  /** For searches: how many documents matched. */
  results?: number;
}

export interface Client {
  id: string;
  name: string;
  domain?: string;
  teamId: string;
  location: Location;
}

export interface Message {
  id: number;
  personId?: string;
  authorName: string;
  authorEmail?: string;
  sentAt: string;
  body: string;
}

/** Someone on a conversation: a colleague (personId) or a client contact. */
export interface Participant {
  personId?: string;
  name: string;
  email?: string;
}

/** An email thread or Teams chat. */
export interface Conversation {
  id: string;
  source: "email" | "teams";
  title: string;
  clientId?: string;
  importedById?: string;
  createdAt: string;
  participants: Participant[];
  messages: Message[];
  /** "Don't keep for others": its answers are never captured. */
  keepPrivate?: boolean;
}

/** A captured answer that says something else than a document. */
export interface AnswerConflict {
  docId: string;
  title: string;
  lineNo: number;
  lineText: string;
  /** The line of the answer that disagrees. */
  answerLine: string;
  probability: number;
  severity: "hard" | "possible";
  ownerId: string | null;
}

/** A question asked in an internal email or Teams chat, and the answer a colleague gave (see answers.ts). */
export interface Answer {
  id: number;
  conversationId: string;
  conversationTitle: string;
  source: "email" | "teams";
  questionMessageId: number;
  answerMessageId: number;
  askerId: string;
  answererId: string;
  question: string;
  /** One statement per line. */
  answer: string;
  askedAt: string;
  answeredAt: string;
  topics: string[];
  locations: Location[];
  clientId?: string;
  conflict?: AnswerConflict;
  method: "jev" | "rules";
  faqDocId?: string;
  faqDismissedAt?: string;
}

export interface Verification {
  personId: string;
  at: string;
}

export interface View {
  personId: string;
  at: string;
}

export interface FactRecord {
  subject: string;
  value: string;
  unit?: string;
  country?: string;
  office?: string;
  teamId?: string;
  validFrom?: string;
  validTo?: string;
  sourceDocId: string;
  sourceDocTitle: string;
  approvalStatus: "draft" | "review" | "active";
  confidence: number;
  lineNo: number;
  rawText: string;
}

export interface VersionEvent {
  at: string;
  personId: string | null;
  summary: string;
  contentPreview: string;
  /** Lines removed and added compared with the previous version, in document order (capped). */
  changes: { kind: "added" | "removed"; text: string }[];
  /** Total number of changed lines, including any left out of `changes`. */
  changeCount: number;
  /** Title, status, location or team changes compared with the previous version. */
  metaChanges: string[];
}

export interface GovernanceSnapshot {
  score: number;
  facts: FactRecord[];
  versionHistory: VersionEvent[];
  overrideSummary: {
    made: number;
    against: number;
    latestReason: string | null;
  };
  signals: string[];
}

export interface Doc {
  id: string;
  title: string;
  kind: "doc" | "sheet" | "pdf";
  content: string;
  ownerId: string | null;
  collaboratorIds: string[];
  readerIds: string[];
  /** The countries it applies to, or ["Global"]. See appliesTo.ts. */
  locations: Location[];
  /** Teams within those countries it applies to; empty = every team there. */
  audienceTeamIds: string[];
  status: DocStatus;
  /** The team that maintains it: the team of whoever created it. */
  teamId: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastEditedById: string | null;
  verifications: Verification[];
  views: View[];
  supersededById?: string;
  clientId?: string;
  /** Never sent to Jev: scores and checks for it use the rules. Unset = false. */
  confidential?: boolean;
  /** Unset: at the top of the drive. */
  folderId?: string;
}

/** A folder in the drive; folders nest through `parentId` (unset = top level). */
export interface Folder {
  id: string;
  name: string;
  parentId?: string;
  createdById?: string;
  createdAt: string;
}

export interface TrustScore {
  score: number; // 0-100
  confidence: number; // 0-1
  levelProbabilities: Record<string, number>;
  model: string;
  computedAt: string;
  inputHash: string;
  latencyMs: number;
  /** Set when the score was estimated from rules instead: Jev couldn't be reached, or the document is confidential. Never stored. */
  fallback?: { reason: string; confidential?: boolean };
}

export interface Signal {
  tone: "good" | "bad" | "warn" | "neutral";
  text: string;
}

/** One side-by-side contradiction Jev found between a draft and an existing document. */
export interface Conflict {
  key: string;
  probability: number;
  severity: "hard" | "possible";
  lineNo: number;
  lineText: string;
  existing: {
    docId: string;
    title: string;
    lineNo: number;
    lineText: string;
    locations: Location[];
    teamId: string;
    status: DocStatus;
    updatedAt: string;
    ownerId: string | null;
  };
}

export interface ConflictCheck {
  hard: Conflict[];
  possible: Conflict[];
  pairsChecked: number;
  docsChecked: number;
  /** Who decided: Jev, or the fixed rules when Jev was unavailable. */
  method: "jev" | "rules";
}

/** A specific line that gives a reader reason to doubt the document. */
export interface Doubt {
  key: string;
  lineNo: number;
  /** The line as a reader sees it (markdown stripped). */
  lineText: string;
  tone: "bad" | "warn";
  kind: "contradiction" | "override" | "outdated" | "answer";
  text: string;
  /** The other document's line, for contradictions. */
  source?: Conflict["existing"];
  /** The answer in chat that says otherwise. */
  chat?: { conversationId: string; messageId: number; title: string; answerLine: string };
}

/** Why a document needs a new owner and who could take it over. */
export interface Handover {
  reasons: Signal[];
  successors: { personId: string; why: string[] }[];
  /** Set when the owner moved teams: they're still around to ask. */
  formerOwnerId?: string;
}

/** A recorded decision to save a document despite a hard conflict. */
export interface ConflictOverride {
  id: number;
  docId: string;
  personId: string;
  at: string;
  reason: string;
  probability: number;
  lineNo: number;
  lineText: string;
  existingDocId: string;
  existingTitle: string;
  existingLineNo: number;
  existingLineText: string;
}

export interface Db {
  teams: Team[];
  people: Person[];
  docs: Doc[];
  overrides: ConflictOverride[];
  clients: Client[];
  folders: Folder[];
  /** The taxonomy as stored: topics, document types and countries. */
  terms: Term[];
}
