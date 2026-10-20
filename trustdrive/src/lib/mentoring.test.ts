import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, findPerson, loadActivity, loadWorld, migrateAndSeed, recordActivity, setMentor } from "./db";
import { menteeFor } from "./service";
import { menteeView, mentorProblem, questionsIn } from "./mentoring";
import { buildSeed, seedActivity } from "./seed";
import type { ActivityEvent, Conversation } from "./types";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const world = buildSeed(NOW);
const jonas = world.people.find((p) => p.id === "jonas")!;
const events: ActivityEvent[] = seedActivity(NOW).map((e, i) => ({ id: i + 1, kind: e.kind, at: e.at, query: e.query ?? undefined, docId: e.docId ?? undefined, results: e.results ?? undefined }));
const since = new Date(NOW - 30 * 86_400_000).toISOString();

describe("what a mentor sees", () => {
  test("the demo mentee is struggling with Legal & Compliance, not with his own payroll work", () => {
    const view = menteeView(world, jonas, events, [], () => 80, since);
    const legal = view.areas.find((a) => a.teamId === "legal")!;
    expect(view.areas[0].teamId).toBe("legal");
    expect(legal.struggling).toBe(true);
    expect(legal.failedSearches).toBeGreaterThanOrEqual(2);
    expect(legal.repeated.map((r) => r.docId)).toEqual(expect.arrayContaining(["gdpr-retention", "sar-procedure"]));
    expect(legal.reasons.some((r) => r.includes("found nothing"))).toBe(true);
    expect(view.areas.find((a) => a.teamId === "pay-be")?.struggling ?? false).toBe(false);
  });

  test("lists questions, searches and documents newest first, with how often each was opened", () => {
    const view = menteeView(world, jonas, events, [], () => 80, since);
    expect(view.questions.map((q) => q.text)[0]).toBe("Who knows the GDPR rules for ex-employees?");
    expect(view.searches.every((s, i, xs) => i === 0 || xs[i - 1].at >= s.at)).toBe(true);
    expect(view.reads.find((r) => r.docId === "gdpr-retention")?.opens).toBe(4);
    expect(view.counts).toMatchObject({ questions: 3, searches: 3, failedSearches: 3 });
  });

  test("nothing from before the mentorship started is shown", () => {
    const later = new Date(NOW - 3 * 86_400_000).toISOString();
    const view = menteeView(world, jonas, events, [], () => 80, later);
    expect(view.counts.questions).toBe(1);
    expect(view.reads.every((r) => r.lastAt >= later)).toBe(true);
  });

  test("documents the mentee can't rely on are flagged, and trusted unopened ones suggested", () => {
    const view = menteeView(world, jonas, events, [], (id) => (id === "gdpr-retention" ? 30 : 90), since);
    const legal = view.areas.find((a) => a.teamId === "legal")!;
    expect(legal.lowTrust).toEqual([expect.objectContaining({ docId: "gdpr-retention", score: 30 })]);
    expect(legal.startingPoints.every((d) => !view.reads.some((r) => r.docId === d.docId))).toBe(true);
  });

  test("questions written to colleagues count; client conversations and other people's messages don't", () => {
    const conv = (id: string, clientId: string | undefined, personId: string, body: string): Conversation => ({
      id,
      source: "teams",
      title: "Quick question",
      clientId,
      createdAt: since,
      participants: [{ personId: "jonas", name: "Jonas Maes" }, { personId: "tom", name: "Tom Hermans" }],
      messages: [{ id: 1, personId, authorName: "x", sentAt: new Date(NOW - 86_400_000).toISOString(), body }],
    });
    const view = menteeView(world, jonas, [], [conv("c1", undefined, "jonas", "Hi Tom. Can we delete a former employee's file after a year?"), conv("c2", "noordkaai", "jonas", "Is the invoice ready?"), conv("c3", undefined, "tom", "Did you check it?")], () => 80, since);
    expect(view.questions).toHaveLength(1);
    expect(view.questions[0]).toMatchObject({ kind: "message", text: "Can we delete a former employee's file after a year?", to: ["Tom Hermans"], teamId: "legal" });
  });

  test("questionsIn keeps only the sentences that ask something", () => {
    expect(questionsIn("Thanks! Where is the SAR template? And who signs it?\nCheers")).toEqual(["Where is the SAR template?", "And who signs it?"]);
  });

  test("a mentor must be someone else who is still at the company, and not their own mentee", () => {
    const lotte = { ...world.people.find((p) => p.id === "lotte")!, mentorId: "jonas" };
    const db = { ...world, people: world.people.map((p) => (p.id === "lotte" ? lotte : p)) };
    expect(mentorProblem(db, jonas, "jonas")).toMatch(/themselves/);
    expect(mentorProblem(db, jonas, "pieter")).toMatch(/left/);
    expect(mentorProblem(db, jonas, "lotte")).toMatch(/already mentors/);
    expect(mentorProblem(world, jonas, "tom")).toBeNull();
  });
});

describe("recording", () => {
  beforeAll(async () => {
    await migrateAndSeed();
  }, 60_000);
  afterAll(async () => {
    await closeDb();
  });

  test("the demo mentorship and its history are seeded", async () => {
    expect(await findPerson({ id: "jonas" })).toMatchObject({ mentorId: "lotte" });
    const view = await menteeFor(await loadWorld(), (await findPerson({ id: "jonas" }))!, []);
    expect(view.areas.find((a) => a.struggling)?.teamId).toBe("legal");
  });

  test("only people with a mentor are recorded", async () => {
    expect(await recordActivity("tom", { kind: "ask", query: "Who knows payroll?" })).toBe(false);
    expect(await loadActivity("tom", new Date(0).toISOString())).toEqual([]);
  });

  test("reopening, asking again and refining a search are one event each", async () => {
    await setMentor("an", "lotte");
    const t = Date.now();
    expect(await recordActivity("an", { kind: "open", docId: "overtime-be" }, t)).toBe(true);
    expect(await recordActivity("an", { kind: "open", docId: "overtime-be" }, t + 60_000)).toBe(false);
    expect(await recordActivity("an", { kind: "ask", query: "Who knows DmfA?" }, t)).toBe(true);
    expect(await recordActivity("an", { kind: "ask", query: "who knows dmfa? " }, t + 1000)).toBe(false);
    await recordActivity("an", { kind: "search", query: "leg", results: 9 }, t);
    await recordActivity("an", { kind: "search", query: "legal hold", results: 0 }, t + 2000);
    const rows = await loadActivity("an", new Date(0).toISOString());
    expect(rows.filter((r) => r.kind === "open")).toHaveLength(1);
    expect(rows.filter((r) => r.kind === "ask")).toHaveLength(1);
    expect(rows.filter((r) => r.kind === "search")).toEqual([expect.objectContaining({ query: "legal hold", results: 0 })]);
  });

  test("a new mentor starts from now; removing the mentor stops recording", async () => {
    await setMentor("an", "tom");
    const an = (await findPerson({ id: "an" }))!;
    expect(an.mentorId).toBe("tom");
    expect(Date.now() - Date.parse(an.mentorSince!)).toBeLessThan(5000);
    await setMentor("an", null);
    expect(await findPerson({ id: "an" })).toMatchObject({ mentorId: undefined, mentorSince: undefined });
    expect(await recordActivity("an", { kind: "open", docId: "sick-leave-be" })).toBe(false);
  });
});
