import crypto from "node:crypto";
import type { Db, Doc, Person, Signal, TrustScore } from "./types";
import { coversCountry, formatLocations, isGlobal } from "./appliesTo";
import { config } from "./config";
import { LEGAL_TEAM_ID } from "./legal";
import { stripLinks } from "./lexicon";
import { daysSince, timeAgo } from "./time";

/** Ordered low → high. Jev returns a fractional position on this scale, which we map to 0–100. */
export const TRUST_LEVELS = [
  "Should not be relied on: no owner or the owner has left, not verified in years or never, superseded or contradicted by a newer related document, or the content refers to rules and figures that are clearly outdated",
  "Likely outdated: not edited or verified in over a year, references past years as current, or maintained only by people who left or moved teams",
  "Uncertain: a draft or awaiting review, applies to a different country than the reader, or has partial signs of being outdated",
  "Probably reliable: completed, active owner, edited or verified within the past year, only minor concerns",
  "Reliable: completed, active owner, verified in the last few months, consistent with related documents and relevant to the reader's country",
  "Authoritative and current: verified in the last weeks by an active owner or expert, completed, current figures, no newer conflicting document, and it applies to the reader's country and team",
];

const MAX_CONTENT_CHARS = 6000;
const MAX_RELATED_EXCERPT = 700;

/**
 * Verifications of the document as it reads now. One given before the last edit confirmed other text,
 * so it doesn't vouch for this version.
 */
export function currentVerifications(doc: Pick<Doc, "verifications" | "updatedAt">) {
  return doc.verifications.filter((v) => v.at >= doc.updatedAt);
}

const latest = <T extends { at: string }>(xs: T[]) => [...xs].sort((a, b) => b.at.localeCompare(a.at))[0];

/**
 * Who may confirm a document is correct: the people accountable for it (owner, collaborators, the team
 * that maintains it) and Legal & Compliance. Anyone else's word would raise its trust for everybody.
 */
export function mayVerify(doc: Pick<Doc, "ownerId" | "collaboratorIds" | "teamId">, person: Person) {
  return person.active && (doc.ownerId === person.id || doc.collaboratorIds.includes(person.id) || person.teamId === doc.teamId || person.teamId === LEGAL_TEAM_ID);
}

/** Whether two documents can be about the same rules: a country in common (or Global), and no other client's file. */
function sameScope(doc: Doc, d: Doc) {
  const countries = isGlobal(doc.locations) || isGlobal(d.locations) || d.locations.some((l) => doc.locations.includes(l));
  return countries && (!d.clientId || d.clientId === doc.clientId);
}

/** Related documents with their relatedness score (≥ 3), strongest first. Only ones in the same scope (sameScope). */
export function relatedScored(db: Db, doc: Doc, limit = 4): { d: Doc; s: number }[] {
  const words = (t: string) => new Set(t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  const titleWords = words(doc.title);
  return db.docs
    .filter((d) => d.id !== doc.id && (sameScope(doc, d) || d.supersededById === doc.id || doc.supersededById === d.id))
    .map((d) => {
      let s = d.tags.filter((t) => doc.tags.includes(t)).length * 2;
      if (d.teamId === doc.teamId) s += 1;
      for (const w of words(d.title)) if (titleWords.has(w)) s += 1;
      if (d.supersededById === doc.id || doc.supersededById === d.id) s += 10;
      return { d, s };
    })
    .filter((x) => x.s >= 3)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit);
}

export function relatedDocs(db: Db, doc: Doc, limit = 4): Doc[] {
  return relatedScored(db, doc, limit).map((x) => x.d);
}

function personSummary(db: Db, id: string | null | undefined, now: number) {
  if (!id) return null;
  const p = db.people.find((x) => x.id === id);
  if (!p) return null;
  const team = db.teams.find((t) => t.id === p.teamId)?.name;
  return {
    name: p.name,
    role: p.role,
    team,
    location: p.location,
    stillAtCompany: p.active,
    leftCompanyDaysAgo: p.leftAt ? daysSince(p.leftAt, now) : undefined,
    movedFromTeam: p.previousTeamId ? db.teams.find((t) => t.id === p.previousTeamId)?.name : undefined,
    movedTeamDaysAgo: p.movedTeamAt ? daysSince(p.movedTeamAt, now) : undefined,
  };
}

function viewerRelation(doc: Doc, viewerId: string) {
  if (doc.ownerId === viewerId) return "owner";
  if (doc.collaboratorIds.includes(viewerId)) return "collaborator";
  if (doc.readerIds.includes(viewerId)) return "reader";
  return "no explicit access";
}

/** Everything Jev sees. Kept as a plain object so we can show it in the UI and hash it for caching. */
export function buildJevState(db: Db, doc: Doc, viewer: Person, now = Date.now()) {
  const verified = currentVerifications(doc);
  const lastVerification = latest(verified);
  const earlierVerification = lastVerification ? undefined : latest(doc.verifications);
  const content = stripLinks(doc.content);
  const unseen = content.slice(MAX_CONTENT_CHARS);
  const views30 = doc.views.filter((v) => daysSince(v.at, now) <= 30);
  const team = db.teams.find((t) => t.id === doc.teamId)?.name;
  const superseding = doc.supersededById ? db.docs.find((d) => d.id === doc.supersededById) : undefined;
  const overridesMade = db.overrides.filter((o) => o.docId === doc.id);
  const overridesAgainst = db.overrides.filter((o) => o.existingDocId === doc.id);
  // Lines and excerpts of confidential documents never go to Jev, even as context for another document.
  const secret = (docId: string) => !!db.docs.find((d) => d.id === docId)?.confidential;
  const HIDDEN = "(confidential – not shared)";

  return {
    today: new Date(now).toISOString().slice(0, 10),
    reader: {
      ...personSummary(db, viewer.id, now),
      relationToDocument: viewerRelation(doc, viewer.id),
    },
    document: {
      title: doc.title,
      type: doc.kind,
      status: doc.status,
      appliesTo: { countries: doc.locations, teams: doc.audienceTeamIds.length ? doc.audienceTeamIds.map((id) => db.teams.find((t) => t.id === id)?.name ?? id) : "all teams there" },
      maintainedByTeam: team,
      tags: doc.tags,
      createdDaysAgo: daysSince(doc.createdAt, now),
      lastEditedDaysAgo: daysSince(doc.updatedAt, now),
      lastEditedBy: personSummary(db, doc.lastEditedById, now),
      owner: personSummary(db, doc.ownerId, now) ?? "NO OWNER",
      collaborators: doc.collaboratorIds.map((id) => personSummary(db, id, now)),
      readerCount: doc.readerIds.length,
      lastVerifiedCorrect: lastVerification
        ? { daysAgo: daysSince(lastVerification.at, now), by: personSummary(db, lastVerification.personId, now) }
        : earlierVerification
          ? "NOT SINCE THE LAST EDIT"
          : "NEVER VERIFIED",
      // Verified before the content last changed: that confirmed different text.
      earlierVersionVerified: earlierVerification ? { daysAgo: daysSince(earlierVerification.at, now), by: personSummary(db, earlierVerification.personId, now) } : undefined,
      timesVerified: verified.length,
      viewsLast30Days: views30.length,
      distinctViewersLast30Days: new Set(views30.map((v) => v.personId)).size,
      supersededBy: superseding ? { title: superseding.title, lastEditedDaysAgo: daysSince(superseding.updatedAt, now) } : undefined,
      savedDespiteConflicts: overridesMade.length
        ? overridesMade.map((o) => ({
            conflictsWith: o.existingTitle,
            thisLine: o.lineText,
            theirLine: secret(o.existingDocId) ? HIDDEN : o.existingLineText,
            overriddenBy: personSummary(db, o.personId, now),
            daysAgo: daysSince(o.at, now),
            reason: o.reason,
          }))
        : undefined,
      contradictedByOverriddenDocuments: overridesAgainst.length
        ? overridesAgainst.map((o) => ({
            document: db.docs.find((d) => d.id === o.docId)?.title,
            thisLine: o.existingLineText,
            theirLine: secret(o.docId) ? HIDDEN : o.lineText,
            overriddenBy: personSummary(db, o.personId, now),
            daysAgo: daysSince(o.at, now),
          }))
        : undefined,
      content: content.slice(0, MAX_CONTENT_CHARS),
      // Content past the limit isn't sent, but it mustn't go unnoticed: Jev is told it's there and which
      // years it mentions, and the fingerprint makes an edit there change the hash, so it's scored again.
      contentNotShown: unseen
        ? {
            characters: unseen.length,
            yearsMentioned: [...new Set(unseen.match(/\b20\d\d\b/g) ?? [])].sort(),
            fingerprint: crypto.createHash("sha1").update(unseen).digest("hex").slice(0, 16),
          }
        : undefined,
    },
    relatedDocuments: relatedDocs(db, doc).map((r) => {
      const v = latest(currentVerifications(r));
      const owner = db.people.find((p) => p.id === r.ownerId);
      return {
        title: r.title,
        status: r.status,
        appliesTo: r.locations,
        lastEditedDaysAgo: daysSince(r.updatedAt, now),
        lastVerifiedDaysAgo: v ? daysSince(v.at, now) : "never",
        ownerStillAtCompany: owner ? owner.active : "no owner",
        supersedesThisDocument: doc.supersededById === r.id,
        excerpt: r.confidential ? HIDDEN : r.content.slice(0, MAX_RELATED_EXCERPT),
      };
    }),
  };
}

export type JevState = ReturnType<typeof buildJevState>;

export function hashState(state: JevState) {
  // `today` is excluded so a score stays cached within the day it was computed for.
  const { today: _today, ...rest } = state;
  return crypto.createHash("sha1").update(JSON.stringify(rest)).digest("hex").slice(0, 16);
}

interface JevAnswer {
  type: "score" | "noul" | "choice";
  score: number;
  noul: number;
  confidence: number;
  probabilities: Record<string, number>;
}

const JEV_TIMEOUT_MS = 20_000;
/** After Jev is unreachable or overloaded, fail fast for this long instead of waiting on every request. */
const JEV_COOLDOWN_MS = 30_000;
let jevDownUntil = 0;
// The last outcome of a Jev call, so the UI can say once that it's showing estimates.
let lastJev: { ok: boolean; at: number; reason?: string } | null = null;

/** Whether Jev answered the last time it was asked (unknown until the first call). */
export function jevStatus() {
  if (config.jev.disabled) return { available: false, reason: "turned off (JEV_DISABLED=1)" };
  // Without a key every call falls back to the rules, so the banner has to say so from the start.
  if (!config.jev.apiKey) return { available: false, reason: "has no API key (JEV_API_KEY isn't set)" };
  return lastJev ? { available: lastJev.ok, reason: lastJev.reason } : { available: true };
}

/** POSTs a decide request to Jev, retrying on rate limits / overload. */
export async function callJev(body: object): Promise<{ model: string; answers: Record<string, JevAnswer> }> {
  // JEV_DISABLED=1 runs everything on the rule-based fallbacks (offline demos, tests).
  if (config.jev.disabled) throw new Error("Jev is turned off (JEV_DISABLED=1)");
  const key = config.jev.apiKey;
  if (!key) throw new Error("JEV_API_KEY is not set");
  if (Date.now() < jevDownUntil) throw new Error("Jev is unavailable, trying again shortly");
  const url = config.jev.url;

  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "jev-latest", ...body }),
        signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
      });
    } catch (e) {
      // Network error or timeout.
      jevDownUntil = Date.now() + JEV_COOLDOWN_MS;
      lastJev = { ok: false, at: Date.now(), reason: "can't be reached from this network" };
      throw new Error(`Jev is unreachable: ${(e as Error).message}`);
    }
    if (res.ok) {
      lastJev = { ok: true, at: Date.now() };
      return res.json();
    }
    lastError = `${res.status} ${await res.text()}`;
    if (![429, 502, 529].includes(res.status)) break;
    await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
  }
  if (/^(429|5\d\d) /.test(lastError)) {
    jevDownUntil = Date.now() + JEV_COOLDOWN_MS;
    lastJev = { ok: false, at: Date.now(), reason: lastError.startsWith("429") ? "is rate-limiting requests" : "is having problems" };
  }
  throw new Error(`Jev request failed: ${lastError}`);
}

export async function scoreWithJev(state: JevState): Promise<Omit<TrustScore, "inputHash">> {
  const started = Date.now();
  const json = await callJev({
    state,
    questions: {
      trust: {
        type: "score",
        instructions:
          "How much can the reader trust that this document is accurate and up to date for their situation? Consider who owns and maintains it and whether they are still at the company, when it was last edited and verified correct, its status, whether it applies to the reader's country and team, whether its content looks current as of today, whether related documents are newer or contradict it, and whether anyone saved it despite a known conflict with another document. Content that wasn't shown (contentNotShown) can't be confirmed as current.",
        criteria: TRUST_LEVELS,
      },
    },
  });
  const a = json.answers.trust;
  return {
    score: Math.round((a.score / (TRUST_LEVELS.length - 1)) * 100),
    confidence: a.confidence,
    levelProbabilities: a.probabilities,
    model: json.model,
    computedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
  };
}

/**
 * Used when Jev can't be reached: picks a level on the same rubric (TRUST_LEVELS) with fixed rules
 * over the metadata, so the drive keeps working. Coarser than Jev – it doesn't read the content
 * beyond outdated years – and it's never stored, so Jev is asked again next time.
 */
export function fallbackScore(db: Db, doc: Doc, viewer: Person, reason: string, now = Date.now(), opts: { confidential?: boolean } = {}): Omit<TrustScore, "inputHash"> {
  const started = Date.now();
  const owner = db.people.find((p) => p.id === doc.ownerId);
  const lastVerified = Math.min(...currentVerifications(doc).map((v) => daysSince(v.at, now)), Infinity);
  const freshest = Math.min(lastVerified, daysSince(doc.updatedAt, now));
  const otherCountry = !coversCountry(doc.locations, viewer.location);
  const year = new Date(now).getFullYear();
  const outdatedYears = (doc.content.match(/\b20[12]\d\b/g) ?? []).map(Number).some((y) => y < year - 1);
  const overridden = db.overrides.some((o) => o.docId === doc.id || o.existingDocId === doc.id);

  let level: number;
  if (!owner?.active || doc.supersededById || freshest > 730) level = 0;
  else if (freshest > 365 || outdatedYears) level = 1;
  else if (doc.status !== "Completed" || otherCountry || overridden) level = 2;
  else if (lastVerified > 90) level = 3;
  else if (lastVerified > 30 || viewer.teamId !== doc.teamId) level = 4;
  else level = 5;

  return {
    score: Math.round((level / (TRUST_LEVELS.length - 1)) * 100),
    confidence: 0.5,
    levelProbabilities: Object.fromEntries(TRUST_LEVELS.map((_, i) => [String(i), i === level ? 1 : 0])),
    model: opts.confidential ? "rules (confidential, not sent to Jev)" : "rules (Jev unavailable)",
    computedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
    fallback: opts.confidential ? { reason, confidential: true } : { reason },
  };
}

/** Human-readable good/bad facts, derived directly from metadata (independent of Jev's score). */
export function buildSignals(db: Db, doc: Doc, viewer: Person, now = Date.now()): Signal[] {
  const out: Signal[] = [];
  const person = (id: string | null | undefined) => db.people.find((p) => p.id === id);
  const teamName = (id?: string) => db.teams.find((t) => t.id === id)?.name ?? "another team";
  const owner = person(doc.ownerId);
  const related = relatedDocs(db, doc);

  // Ownership
  if (!owner) out.push({ tone: "bad", text: "No owner – nobody is accountable for keeping this document correct" });
  else if (!owner.active && owner.leftAt)
    out.push({ tone: "bad", text: `Owner ${owner.name} left the company ${timeAgo(owner.leftAt, now)}` });
  else if (owner.previousTeamId && owner.teamId !== doc.teamId)
    out.push({ tone: "warn", text: `Owner ${owner.name} moved from ${teamName(owner.previousTeamId)} to ${teamName(owner.teamId)} ${timeAgo(owner.movedTeamAt!, now)}` });
  else out.push({ tone: "good", text: `Owner ${owner.name} is active in ${teamName(owner.teamId)}` });

  // Last edit
  const editor = person(doc.lastEditedById);
  const editDays = daysSince(doc.updatedAt, now);
  const editorLabel = !editor ? "someone" : editor.id === doc.ownerId ? `owner ${editor.name}` : editor.name;
  const editText = `Edited by ${editorLabel} ${timeAgo(doc.updatedAt, now)}`;
  if (editor && !editor.active) out.push({ tone: "bad", text: `${editText} – they have since left the company` });
  else if (editDays <= 90) out.push({ tone: "good", text: editText });
  else if (editDays <= 365) out.push({ tone: "neutral", text: editText });
  else out.push({ tone: "bad", text: `Not edited in ${timeAgo(doc.updatedAt, now).replace(" ago", "")}` });

  // Verification
  const last = latest(currentVerifications(doc));
  const earlier = latest(doc.verifications);
  if (!last && earlier) {
    const v = person(earlier.personId);
    const who = v ? (v.id === doc.ownerId ? `owner ${v.name}` : v.name) : "someone";
    out.push({ tone: "warn", text: `Verified correct by ${who} ${timeAgo(earlier.at, now)}, but edited since – this version isn't verified` });
  } else if (!last) out.push({ tone: "bad", text: "Never verified as correct" });
  else {
    const v = person(last.personId);
    const d = daysSince(last.at, now);
    const who = v ? (v.id === doc.ownerId ? `owner ${v.name}` : v.name) : "someone";
    const text = `Verified correct by ${who} ${timeAgo(last.at, now)}`;
    if (v && !v.active) out.push({ tone: "warn", text: `${text} – verifier has left the company` });
    else out.push({ tone: d <= 90 ? "good" : d <= 365 ? "warn" : "bad", text });
  }

  // Status
  if (doc.status === "Completed") out.push({ tone: "good", text: "Marked as completed" });
  else if (doc.status === "WIP") out.push({ tone: "warn", text: "Still a work in progress" });
  else out.push({ tone: "warn", text: "Flagged as needing review" });

  // Who it applies to: countries, then teams within them
  const where = formatLocations(doc.locations);
  if (isGlobal(doc.locations)) out.push({ tone: "neutral", text: "Applies to all countries" });
  else if (coversCountry(doc.locations, viewer.location))
    out.push({ tone: "good", text: `Applies to ${where}${doc.locations.includes(viewer.location) ? " – including your location" : ""}` });
  else out.push({ tone: "bad", text: `Applies to ${where}, but you are in ${viewer.location}` });
  if (doc.audienceTeamIds.length) {
    const names = doc.audienceTeamIds.map((id) => db.teams.find((t) => t.id === id)?.name ?? id).join(", ");
    if (doc.audienceTeamIds.includes(viewer.teamId)) out.push({ tone: "good", text: `Meant for your team (${names})` });
    else out.push({ tone: "warn", text: `Meant for ${names}, not your team` });
  }

  // Superseded / newer related
  if (doc.supersededById) {
    const s = db.docs.find((d) => d.id === doc.supersededById);
    if (s) out.push({ tone: "bad", text: `Superseded by “${s.title}” (edited ${timeAgo(s.updatedAt, now)})` });
  } else {
    const newer = related.find(
      (r) => r.status !== "WIP" && new Date(r.updatedAt) > new Date(doc.updatedAt) && daysSince(doc.updatedAt, now) > 180 && r.tags.some((t) => doc.tags.includes(t) && t !== "policy"),
    );
    if (newer) out.push({ tone: "warn", text: `A related document is more recent: “${newer.title}”` });
  }
  const draft = related.slice(0, 3).find((d) => d.status === "WIP" && d.tags.filter((t) => doc.tags.includes(t)).length >= 2);
  if (draft && doc.status === "Completed") out.push({ tone: "warn", text: `A new version is being drafted: “${draft.title}”` });

  // Conflicts someone chose to override
  for (const o of db.overrides.filter((o) => o.docId === doc.id)) {
    out.push({ tone: "warn", text: `Saved despite a conflict with “${o.existingTitle}” (line ${o.existingLineNo}) – overridden by ${person(o.personId)?.name ?? "someone"} ${timeAgo(o.at, now)}` });
  }
  for (const o of db.overrides.filter((o) => o.existingDocId === doc.id)) {
    const other = db.docs.find((d) => d.id === o.docId);
    out.push({ tone: "warn", text: `“${other?.title ?? "Another document"}” contradicts line ${o.existingLineNo} – conflict overridden by ${person(o.personId)?.name ?? "someone"} ${timeAgo(o.at, now)}` });
  }

  // Old years mentioned as current
  const year = new Date(now).getFullYear();
  const years = [...new Set(stripLinks(doc.content).match(/\b20[12]\d\b/g) ?? [])].map(Number).filter((y) => y < year - 1);
  if (years.length) out.push({ tone: "warn", text: `Content refers to ${years.sort().join(", ")}` });

  // Collaborators
  const gone = doc.collaboratorIds.map(person).filter((p) => p && !p.active) as Person[];
  if (gone.length) out.push({ tone: "warn", text: `${gone.map((p) => p.name).join(", ")} (collaborator) left the company` });

  // Usage
  const views30 = doc.views.filter((v) => daysSince(v.at, now) <= 30);
  const distinct = new Set(views30.map((v) => v.personId)).size;
  if (distinct >= 3) out.push({ tone: "good", text: `Used by ${distinct} colleagues in the last 30 days` });
  else if (views30.length === 0) out.push({ tone: "neutral", text: "Nobody opened this in the last 30 days" });

  // Team fit
  if (viewer.teamId === doc.teamId) out.push({ tone: "good", text: `Maintained by your team (${teamName(doc.teamId)})` });

  return out;
}
