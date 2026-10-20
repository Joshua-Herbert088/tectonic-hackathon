import type { Doc, Person } from "./types";

/**
 * The Legal & Compliance badge: documents that come from Legal (the team that maintains them), or
 * that someone from Legal validated with "I confirm this document is correct". The badge says who
 * validated it and when, so a reader knows whose word it is and how recent.
 */

export const LEGAL_TEAM_ID = "legal";
/** A Legal validation older than this is shown as due for another look. */
export const LEGAL_REVALIDATE_DAYS = 365;
const DAY = 86_400_000;

export interface LegalStamp {
  /** Maintained by Legal & Compliance. */
  fromLegal: boolean;
  /** The latest validation by someone in Legal, if any. */
  validation: { personId: string; at: string; days: number; /** Where the validator is now. */ now: "legal" | "moved" | "left"; due: boolean } | null;
}

/** Null when the document has nothing to do with Legal. */
export function legalStamp(doc: Pick<Doc, "teamId" | "verifications">, people: Person[], now = Date.now()): LegalStamp | null {
  const byId = new Map(people.map((p) => [p.id, p]));
  // Someone counts as Legal for a validation if they're in Legal now, or were before moving team.
  const wasLegal = (p: Person | undefined) => !!p && (p.teamId === LEGAL_TEAM_ID || p.previousTeamId === LEGAL_TEAM_ID);
  const latest = doc.verifications.filter((v) => wasLegal(byId.get(v.personId))).reduce<(typeof doc.verifications)[number] | null>((a, v) => (!a || v.at > a.at ? v : a), null);
  const fromLegal = doc.teamId === LEGAL_TEAM_ID;
  if (!fromLegal && !latest) return null;
  if (!latest) return { fromLegal, validation: null };
  const p = byId.get(latest.personId)!;
  const days = Math.floor((now - Date.parse(latest.at)) / DAY);
  return { fromLegal, validation: { personId: p.id, at: latest.at, days, now: !p.active ? "left" : p.teamId === LEGAL_TEAM_ID ? "legal" : "moved", due: days >= LEGAL_REVALIDATE_DAYS } };
}
