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

export interface Db {
  teams: Team[];
  people: Person[];
  docs: Doc[];
  /** key: `${docId}:${viewerId}` */
  scores: Record<string, TrustScore>;
}
