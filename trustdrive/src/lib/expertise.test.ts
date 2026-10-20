import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, findPerson, loadConversations, loadHistory, loadWorld, migrateAndSeed, setHiddenExpertise } from "./db";
import { buildLedger, fade, interpret } from "./expertise";
import { personProfile, whoKnowsFor } from "./service";
import type { Person } from "./types";

// In-memory Postgres (vitest.config.ts), migrated and seeded with the demo company.
let jonas: Person;
let sofie: Person;
let lotte: Person;
beforeAll(async () => {
  await migrateAndSeed();
  jonas = (await findPerson({ id: "jonas" }))!;
  sofie = (await findPerson({ id: "sofie" }))!;
  lotte = (await findPerson({ id: "lotte" }))!;
}, 60_000);
afterAll(async () => {
  await closeDb();
});

const DAY = 86_400_000;
const experts = async (q: string, viewer: Person) => {
  const r = await whoKnowsFor(q, viewer);
  if (!("experts" in r)) throw new Error("expected an answer");
  return r;
};

describe("who knows", () => {
  test("reads a question as topics, clients and countries, in any of the four languages", async () => {
    const world = await loadWorld();
    expect(interpret(world, "Who knows how overtime works in Belgium?")).toEqual({ topics: [{ id: "overtime", label: "Overtime" }], clients: [], countries: ["Belgium"], words: [], ignored: [] });
    expect(interpret(world, "Wie kent de overuren?").topics.map((t) => t.id)).toEqual(["overtime"]);
    expect(interpret(world, "noordkaai").clients.map((c) => c.id)).toEqual(["noordkaai"]);
    // Nothing recognised: the words are searched for in the text instead.
    expect(interpret(world, "who knows the headcount")).toMatchObject({ topics: [], clients: [], countries: [], words: ["headcount"] });
  });

  test("ranks by evidence on the subject, with the country narrowing it down", async () => {
    const r = await experts("overtime in Belgium", jonas);
    // Lotte answered colleagues' overtime questions; the Belgian policy's owner moved team; the Dutch policy's author still shows, lower down.
    expect(r.experts.map((e) => e.personId)).toEqual(["lotte", "marc", "sanne"]);
    expect(r.experts[0].relevance).toBe(1);
    const marc = r.experts[1];
    expect(marc.caveat).toMatch(/^Moved to HR Operations .* hasn't worked on this since$/);
    expect(marc.evidence.map((e) => e.doc?.id)).toContain("overtime-be");
    // Someone who left is never suggested as a contact, only pointed at.
    expect(r.former.map((f) => f.personId)).toEqual(["pieter"]);
  });

  test("a client brings in its documents and the people who wrote in its conversations, never the viewer", async () => {
    const r = await experts("Noordkaai", jonas);
    expect(r.experts.map((e) => e.personId)).toEqual(expect.arrayContaining(["sofie", "an"]));
    expect(r.experts.find((e) => e.personId === "sofie")!.evidence.some((e) => e.conversation)).toBe(true);
    expect((await experts("Noordkaai", sofie)).experts.map((e) => e.personId)).not.toContain("sofie");
  });

  test("an empty question gets starting points; an unknown one finds nobody", async () => {
    expect(await whoKnowsFor("  ", jonas)).toMatchObject({ suggestions: expect.arrayContaining(["Clocking terminals"]) });
    expect((await experts("xyzzy", jonas)).experts).toEqual([]);
  });

  test("evidence fades after three months, halving every year; ongoing roles don't fade", () => {
    const now = Date.now();
    expect(fade({ action: "Verified", weight: 8, at: new Date(now - 30 * DAY).toISOString() }, now)).toBe(1);
    expect(fade({ action: "Verified", weight: 8, at: new Date(now - (90 + 365) * DAY).toISOString() }, now)).toBeCloseTo(0.5);
    expect(fade({ action: "Owns", weight: 10 }, now)).toBe(1);
  });

  test("reading a document never counts as knowing it", async () => {
    const [world, history, conversations] = await Promise.all([loadWorld(), loadHistory(), loadConversations()]);
    const ledger = buildLedger(world, history, conversations);
    const readOnly = world.docs.flatMap((d) => d.views.filter((v) => !ledger.docs.get(d.id)!.has(v.personId)));
    expect(readOnly.length).toBeGreaterThan(0);
  });
});

describe("person profile", () => {
  test("lists what someone knows with the evidence, what they own and who they work with", async () => {
    const p = (await personProfile("lotte", jonas))!;
    expect(p.topics.map((t) => t.key)).toContain("topic:declarations");
    expect(p.topics[0].relevance).toBe(1);
    expect(p.topics.every((t) => t.evidence.length > 0 && !t.hidden)).toBe(true);
    expect(p.inCharge.length).toBeGreaterThan(0);
    expect(p.worksWith.map((w) => w.personId)).toContain("an");
    expect(await personProfile("nobody", jonas)).toBeNull();
  });

  test("someone who left: everything fades, and the exceptions they explained are kept", async () => {
    const p = (await personProfile("pieter", jonas))!;
    expect(p.topics.length).toBeGreaterThan(0);
    expect([...p.topics, ...p.clients].every((a) => a.fading)).toBe(true);
    expect(p.decisions.length).toBe(1);
    expect(p.decisions[0].reason).toBeTruthy();
  });

  test("“not me any more” takes a topic off someone's profile and out of the answers; only they still see it", async () => {
    expect((await experts("DmfA", jonas)).experts.map((e) => e.personId)).toContain("lotte");
    await setHiddenExpertise("lotte", ["topic:declarations"]);
    lotte = (await findPerson({ id: "lotte" }))!;
    try {
      expect((await experts("DmfA", jonas)).experts.map((e) => e.personId)).not.toContain("lotte");
      expect((await personProfile("lotte", jonas))!.topics.map((t) => t.key)).not.toContain("topic:declarations");
      const own = (await personProfile("lotte", lotte))!.topics.find((t) => t.key === "topic:declarations")!;
      expect(own).toMatchObject({ hidden: true, relevance: 0 });
    } finally {
      await setHiddenExpertise("lotte", []);
    }
    expect((await findPerson({ id: "lotte" }))!.hiddenExpertise).toBeUndefined();
  });
});
