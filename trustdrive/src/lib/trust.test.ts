import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, loadWorld, migrateAndSeed } from "./db";
import { buildJevState, buildSignals, currentVerifications, fallbackScore, hashState, limitToRead, mayVerify, PARTIAL_MAX_SCORE, relatedDocs } from "./trust";
import type { Db, Doc, Person } from "./types";

// A throwaway in-memory Postgres (PGLITE_DIR=memory:// in vitest.config.ts), migrated and seeded.
let world: Db;
beforeAll(async () => {
  await migrateAndSeed();
  world = await loadWorld();
}, 60_000);
afterAll(async () => {
  await closeDb();
});

const doc = (id: string) => world.docs.find((d) => d.id === id)!;
const person = (id: string) => world.people.find((p) => p.id === id)!;
const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
/** The world with one document replaced (or added). */
const withDoc = (d: Doc): Db => ({ ...world, docs: [...world.docs.filter((x) => x.id !== d.id), d] });

describe("verification after an edit", () => {
  test("a verification from before the last edit doesn't vouch for the current text", () => {
    const d = { ...doc("overtime-be"), updatedAt: days(5), verifications: [{ personId: doc("overtime-be").ownerId!, at: days(10) }] };
    const db = withDoc(d);
    const jonas = person("jonas");
    expect(currentVerifications(d)).toEqual([]);
    const state = buildJevState(db, d, jonas);
    expect(state.document.lastVerifiedCorrect).toBe("NOT SINCE THE LAST EDIT");
    expect(state.document.earlierVersionVerified).toMatchObject({ daysAgo: 10 });
    expect(state.document.timesVerified).toBe(0);
    expect(buildSignals(db, d, jonas).find((s) => s.text.startsWith("Verified correct"))).toMatchObject({ tone: "warn", text: expect.stringContaining("edited since") });

    const verifiedAgain = { ...d, verifications: [...d.verifications, { personId: d.ownerId!, at: days(1) }] };
    expect(buildJevState(withDoc(verifiedAgain), verifiedAgain, jonas).document.lastVerifiedCorrect).toMatchObject({ daysAgo: 1 });
    // The rules count it too: verified a day ago is fresher than verified ten days ago and edited since.
    expect(fallbackScore(withDoc(verifiedAgain), verifiedAgain, jonas, "test").score).toBeGreaterThanOrEqual(fallbackScore(db, d, jonas, "test").score);
  });
});

describe("who may verify", () => {
  test("the people accountable for a document and Legal, not anyone", () => {
    const d = doc("overtime-be");
    const owner = person(d.ownerId!);
    const teammate = world.people.find((p) => p.active && p.teamId === d.teamId && p.id !== d.ownerId)!;
    const legal = world.people.find((p) => p.active && p.teamId === "legal")!;
    const outsider = world.people.find((p) => p.active && p.teamId !== d.teamId && p.teamId !== "legal" && p.id !== d.ownerId && !d.collaboratorIds.includes(p.id))!;
    expect(mayVerify(d, owner)).toBe(true);
    expect(mayVerify(d, teammate)).toBe(true);
    expect(mayVerify(d, legal)).toBe(true);
    expect(mayVerify(d, outsider)).toBe(false);
    expect(mayVerify(d, { ...teammate, active: false } as Person)).toBe(false);
  });
});

describe("related documents are in the same scope", () => {
  test("another country's or another client's document with the same tags and title isn't related", () => {
    const be = doc("overtime-be");
    const elsewhere = { ...be, id: "lookalike-fr", locations: ["France"], status: "Completed" as const, updatedAt: days(0), supersededById: undefined };
    const otherClient = { ...be, id: "lookalike-client", clientId: world.clients[0].id, status: "WIP" as const, updatedAt: days(0), supersededById: undefined };
    const db = withDoc(otherClient);
    db.docs.push(elsewhere);
    const related = relatedDocs(db, be, 10).map((d) => d.id);
    expect(related).not.toContain("lookalike-fr");
    expect(related).not.toContain("lookalike-client");
    expect(related).not.toContain("overtime-nl");
    const signals = buildSignals(db, be, person("jonas")).map((s) => s.text);
    expect(signals.some((t) => t.includes("lookalike") || /more recent|being drafted/.test(t))).toBe(false);
  });

  test("copied tags from someone outside the team plant nothing, even in the same country or Global", () => {
    const be = doc("overtime-be");
    const outsider = world.people.find((p) => p.active && p.teamId !== be.teamId && p.id !== be.ownerId && !be.collaboratorIds.includes(p.id))!;
    const planted = (id: string, status: Doc["status"], locations: string[]): Doc => ({
      ...be,
      id,
      title: `${be.title} – update`,
      status,
      locations,
      ownerId: outsider.id,
      teamId: outsider.teamId,
      collaboratorIds: [],
      readerIds: [],
      createdAt: days(0),
      updatedAt: days(0),
      supersededById: undefined,
    });
    const db = withDoc(planted("planted-completed", "Completed", ["Belgium"]));
    db.docs.push(planted("planted-draft", "WIP", ["Global"]));
    const stale = { ...be, updatedAt: days(400) };
    const dbStale = { ...db, docs: db.docs.map((d) => (d.id === be.id ? stale : d)) };
    const related = relatedDocs(dbStale, stale, 10).map((d) => d.id);
    expect(related).not.toContain("planted-completed");
    expect(related).not.toContain("planted-draft");
    expect(JSON.stringify(buildJevState(dbStale, stale, person("jonas")).relatedDocuments)).not.toContain("update");
    const signals = buildSignals(dbStale, { ...stale, status: "Completed" }, person("jonas")).map((s) => s.text);
    expect(signals.filter((t) => t.includes("update"))).toEqual([]);
  });

  test("the maintaining team, or the document's own owner and collaborators, still relate", () => {
    const be = doc("overtime-be");
    const collaborator = world.people.find((p) => p.active && p.teamId !== be.teamId)!;
    const target = { ...be, collaboratorIds: [...be.collaboratorIds, collaborator.id] };
    const fromCollaborator = { ...be, id: "by-collaborator", title: `${be.title} 2027`, ownerId: collaborator.id, teamId: collaborator.teamId, updatedAt: days(0), supersededById: undefined };
    const fromTeam = { ...be, id: "by-team", title: `${be.title} 2028`, ownerId: null, updatedAt: days(0), supersededById: undefined };
    const db = { ...world, docs: [...world.docs.filter((d) => d.id !== be.id), target, fromCollaborator, fromTeam] };
    expect(relatedDocs(db, target, 10).map((d) => d.id)).toEqual(expect.arrayContaining(["by-collaborator", "by-team"]));
  });

  test("a document in the same country still is", () => {
    const be = doc("overtime-be");
    const sameCountry = { ...be, id: "overtime-be-2027", title: `${be.title} 2027`, updatedAt: days(0), supersededById: undefined };
    expect(relatedDocs(withDoc(sameCountry), be, 10).map((d) => d.id)).toContain("overtime-be-2027");
  });
});

describe("long content", () => {
  test("Jev is told about content past the limit, and an edit there changes the hash", () => {
    const base = doc("overtime-be");
    const long = (tail: string) => ({ ...base, content: `${base.content}\n\n${"Filler line about overtime.\n".repeat(300)}${tail}` });
    const jonas = person("jonas");
    const a = long("Overtime is max 100 hours (2019 rule).");
    const b = long("Overtime is max 999 hours (2019 rule).");
    const stateA = buildJevState(withDoc(a), a, jonas);
    expect(stateA.document.content.length).toBe(6000);
    expect(stateA.document.contentNotShown).toMatchObject({ characters: expect.any(Number), yearsMentioned: ["2019"] });
    expect(hashState(stateA)).not.toBe(hashState(buildJevState(withDoc(b), b, jonas)));
    // Short documents send everything and say nothing extra.
    expect(buildJevState(world, base, jonas).document.contentNotShown).toBeUndefined();
  });

  test("a document Jev couldn't read in full scores at most 'probably reliable', and says why", () => {
    const jonas = person("jonas");
    // Everything right: Jonas's own, current, completed, verified today, for his country and team.
    const ideal: Doc = {
      ...doc("overtime-be"),
      id: "ideal",
      content: "# Procedure\n\nSteps that are fine.",
      ownerId: jonas.id,
      teamId: jonas.teamId,
      locations: [jonas.location],
      audienceTeamIds: [],
      status: "Completed",
      collaboratorIds: [],
      updatedAt: days(1),
      verifications: [{ personId: jonas.id, at: days(0) }],
      supersededById: undefined,
    };
    const long = { ...ideal, content: `${ideal.content}\n${"More steps that look fine.\n".repeat(400)}` };
    expect(fallbackScore(withDoc(ideal), ideal, jonas, "test").score).toBeGreaterThan(PARTIAL_MAX_SCORE);
    expect(fallbackScore(withDoc(long), long, jonas, "test").score).toBe(PARTIAL_MAX_SCORE);
    // A score Jev gave (or one stored before the cap) is capped too when it's shown.
    expect(limitToRead(long, { score: 95 }).score).toBe(PARTIAL_MAX_SCORE);
    expect(limitToRead(ideal, { score: 95 }).score).toBe(95);
    const warning = (d: Doc) => buildSignals(withDoc(d), d, jonas).find((x) => x.text.startsWith("Long document"));
    expect(warning(long)).toMatchObject({ tone: "warn" });
    expect(warning(ideal)).toBeUndefined();
  });
});
