import { describe, expect, test } from "vitest";
import { cases, type Side } from "./conflict-cases";
import type { Db, Doc } from "./types";

/**
 * Measures Jev and the conflict rules on the same hand-labelled cases, through the full pipeline
 * (fact extraction → pairing → verdict). Calls the paid Jev API, so it only runs on request:
 *   JEV_EVAL=1 npm test -- conflicts.jev
 */
const enabled = process.env.JEV_EVAL === "1";
if (enabled) {
  process.env.JEV_DISABLED = "";
  process.loadEnvFile(".env.local");
}
// Imported after the environment is set: configuration is read once, on first import.
const { checkConflicts } = await import("./conflicts");

const now = new Date().toISOString();
function existing(side: Side): Doc {
  return {
    id: "existing",
    title: side.title ?? "Existing document",
    kind: "doc",
    content: side.text,
    ownerId: null,
    collaboratorIds: [],
    readerIds: [],
    locations: [side.location ?? "Belgium"],
    audienceTeamIds: [],
    status: side.status ?? "Completed",
    teamId: "pay-be",
    tags: [],
    createdAt: now,
    updatedAt: now,
    lastEditedById: null,
    verifications: [],
    views: [],
  };
}

async function severity(a: Side, b: Side, rulesOnly: boolean) {
  const db: Db = { teams: [{ id: "pay-be", name: "Payroll Belgium" }], people: [], docs: [existing(b)], overrides: [], clients: [], folders: [], terms: [] };
  const check = await checkConflicts(db, { title: a.title ?? "New document", content: a.text, locations: [a.location ?? "Belgium"], teamId: "pay-be" }, { rulesOnly });
  return { verdict: check.hard.length ? "hard" : check.possible.length ? "possible" : "none", method: check.method };
}

describe.skipIf(!enabled)("Jev vs rules on the labelled cases", () => {
  test("agreement with the labels", { timeout: 120_000 }, async () => {
    const rows = await Promise.all(
      cases.map(async (c) => ({ name: c.name, expected: c.expected, jev: await severity(c.a, c.b, false), rules: await severity(c.a, c.b, true) })),
    );
    console.table(rows.map((r) => ({ case: r.name, expected: r.expected, jev: r.jev.verdict, rules: r.rules.verdict })));
    // "Blocks the save" is what matters most: hard vs not hard.
    const blocks = (v: string) => v === "hard";
    const score = (pick: (r: (typeof rows)[number]) => string) => ({
      exact: rows.filter((r) => pick(r) === r.expected).length,
      blocking: rows.filter((r) => blocks(pick(r)) === blocks(r.expected)).length,
    });
    console.log("of", rows.length, "cases – Jev:", score((r) => r.jev.verdict), "rules:", score((r) => r.rules.verdict));

    // Consistency: the same pairs four more times; a case counts when all five verdicts agree.
    const repeats = await Promise.all(cases.map(async (c) => [rows.find((r) => r.name === c.name)!.jev.verdict, ...(await Promise.all(Array.from({ length: 4 }, async () => (await severity(c.a, c.b, false)).verdict)))]));
    console.log(`Jev consistency over 5 runs: ${repeats.filter((v) => new Set(v).size === 1).length} of ${cases.length} cases identical every time`);
    expect(rows.every((r) => r.jev.method === "jev")).toBe(true);
  });
});
