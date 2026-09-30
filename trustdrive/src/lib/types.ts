export type Location = "Belgium" | "Netherlands" | "France" | "Germany" | "Global";
export const LOCATIONS: Location[] = ["Belgium", "Netherlands", "France", "Germany", "Global"];

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
  /** Set when the person moved to a different team; teamId is the current one. */
  previousTeamId?: string;
  movedTeamAt?: string;
  color: string;
}

export interface Verification {
  personId: string;
  at: string;
}

export interface View {
  personId: string;
  at: string;
}

export interface Doc {
  id: string;
  title: string;
  kind: "doc" | "sheet" | "pdf";
  content: string;
  ownerId: string | null;
  collaboratorIds: string[];
  readerIds: string[];
  location: Location;
  status: DocStatus;
  teamId: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastEditedById: string | null;
  verifications: Verification[];
  views: View[];
  supersededById?: string;
}

export interface TrustScore {
  score: number; // 0-100
  confidence: number; // 0-1
  levelProbabilities: Record<string, number>;
  model: string;
  computedAt: string;
  inputHash: string;
  latencyMs: number;
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
    location: Location;
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
}

/** A specific line that gives a reader reason to doubt the document. */
export interface Doubt {
  key: string;
  lineNo: number;
  /** The line as a reader sees it (markdown stripped). */
  lineText: string;
  tone: "bad" | "warn";
  kind: "contradiction" | "override" | "outdated";
  text: string;
  /** The other document's line, for contradictions. */
  source?: Conflict["existing"];
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
}
