import { daysSince, timeAgo } from "./time";
import type { Doc, Handover, Person, Signal, Team } from "./types";

// Pure functions over document metadata, so the drive and the document page can both use them.

type DocMeta = Omit<Doc, "content">;

/** How much colleagues currently rely on a document. */
export function reliance(doc: DocMeta, now = Date.now()) {
  const views30 = doc.views.filter((v) => daysSince(v.at, now) <= 30);
  return { readers30: new Set(views30.map((v) => v.personId)).size, views30: views30.length, readers: doc.readerIds.length };
}

/** Why a document needs a new owner, or null when its ownership is fine. Superseded documents need no handover. */
export function handoverFor(doc: DocMeta, people: Person[], teams: Team[], now = Date.now()): Handover | null {
  if (doc.supersededById) return null;
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? id;
  const owner = people.find((p) => p.id === doc.ownerId);
  const reasons: Signal[] = [];
  let formerOwnerId: string | undefined;

  if (!owner) reasons.push({ tone: "bad", text: "No owner" });
  else if (!owner.active) reasons.push({ tone: "bad", text: `Owner ${owner.name} left${owner.leftAt ? ` ${timeAgo(owner.leftAt, now)}` : ""}` });
  else if (owner.previousTeamId && owner.teamId !== doc.teamId) {
    reasons.push({ tone: "warn", text: `Owner ${owner.name} moved to ${teamName(owner.teamId)}${owner.movedTeamAt ? ` ${timeAgo(owner.movedTeamAt, now)}` : ""}` });
    formerOwnerId = owner.id;
  }
  if (!reasons.length) return null;

  const lastVerification = [...doc.verifications].sort((a, b) => b.at.localeCompare(a.at))[0];
  const verifier = people.find((p) => p.id === lastVerification?.personId);
  if (!lastVerification) reasons.push({ tone: "warn", text: "Never verified" });
  else if (verifier && !verifier.active && verifier.id !== owner?.id) reasons.push({ tone: "warn", text: `Last verified by ${verifier.name}, who also left` });

  return { reasons, successors: suggestSuccessors(doc, people, teamName, now), formerOwnerId };
}

/** Active colleagues who already know the document or its subject, best first. */
function suggestSuccessors(doc: DocMeta, people: Person[], teamName: (id: string) => string, now: number) {
  return people
    .filter((p) => p.active && p.id !== doc.ownerId)
    .map((p) => {
      let score = 0;
      const why: string[] = [];
      const verified = doc.verifications.filter((v) => v.personId === p.id).sort((a, b) => b.at.localeCompare(a.at))[0];
      if (verified) {
        score += 3;
        why.push(`verified it ${timeAgo(verified.at, now)}`);
      }
      if (doc.lastEditedById === p.id) {
        score += 3;
        why.push("last edited it");
      }
      if (doc.collaboratorIds.includes(p.id)) {
        score += 2;
        why.push("collaborator");
      }
      if (p.teamId === doc.teamId) {
        score += 2;
        why.push(teamName(p.teamId));
      }
      if (doc.location !== "Global" && p.location === doc.location) score += 1;
      const reads = doc.views.filter((v) => v.personId === p.id && daysSince(v.at, now) <= 30).length;
      if (reads) {
        score += 1;
        why.push(`opened it ${reads}× this month`);
      }
      return { personId: p.id, why, score, joinedAt: p.joinedAt };
    })
    .filter((c) => c.score >= 2)
    .sort((a, b) => b.score - a.score || a.joinedAt.localeCompare(b.joinedAt))
    .slice(0, 3)
    .map(({ personId, why }) => ({ personId, why }));
}
