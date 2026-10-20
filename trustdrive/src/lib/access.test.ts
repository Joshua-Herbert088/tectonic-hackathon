import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { canSee, HIDDEN_TITLE, redactConflicts } from "./access";
import { closeDb, loadWorld, migrateAndSeed } from "./db";
import { contradictionDoubts } from "./doubts";
import { computeScore, docDetail, editDocument, gateDraft, homeFor, listDocs } from "./service";
import type { ConflictCheck, Db, Person } from "./types";

// A throwaway in-memory Postgres (PGLITE_DIR=memory:// in vitest.config.ts), migrated and seeded.
let world: Db;
beforeAll(async () => {
  await migrateAndSeed();
  world = await loadWorld();
}, 60_000);
afterAll(async () => {
  await closeDb();
});

const person = (id: string) => world.people.find((p) => p.id === id)!;
const REGISTER = "salary-register-be";

describe("confidential documents", () => {
  test("the salary register is seen by its owner, collaborators and readers only", () => {
    const register = world.docs.find((d) => d.id === REGISTER)!;
    expect(register.confidential).toBe(true);
    for (const id of ["an", "lotte", "eva"]) expect(canSee(register, person(id))).toBe(true);
    // Jonas is in the team it's about, but it lists his colleagues' salaries.
    expect(canSee(register, person("jonas"))).toBe(false);
    // Everything else is the company's drive.
    expect(world.docs.filter((d) => !d.confidential).every((d) => canSee(d, person("jonas")))).toBe(true);
  });

  test("it's left out of lists, related documents and the home page for anyone else", async () => {
    const jonas: Person = person("jonas");
    expect((await listDocs(jonas)).docs.map((d) => d.id)).not.toContain(REGISTER);
    expect((await listDocs(person("lotte"))).docs.map((d) => d.id)).toContain(REGISTER);
    const home = await homeFor(jonas);
    expect(JSON.stringify(home)).not.toContain(REGISTER);
    for (const d of world.docs.filter((x) => x.id !== REGISTER).slice(0, 15)) {
      const detail = await docDetail(d.id, jonas);
      expect(detail!.related.map((r) => r.id)).not.toContain(REGISTER);
      expect(JSON.stringify(detail!.jevInput)).not.toContain("Salary register");
    }
  });

  test("opening, scoring or editing it is a 404 for anyone else", async () => {
    const jonas = person("jonas");
    expect(await docDetail(REGISTER, jonas)).toBeNull();
    expect(await computeScore(REGISTER, jonas)).toBeNull();
    await expect(editDocument(jonas, REGISTER, { content: "x" })).rejects.toMatchObject({ status: 404 });
    expect(await docDetail(REGISTER, person("eva"))).not.toBeNull();
  });

  test("a conflict with it still blocks, but without its title, line or owner", async () => {
    // The demo upload: blocked because it contradicts the salary register (README, demo step 3).
    const sample = fs.readFileSync(path.join(__dirname, "../../samples/salary-review-jonas-maes.md"), "utf8");
    const gate = await gateDraft(world, { title: "Salary review – Jonas Maes", content: sample, locations: ["Belgium"], teamId: "pay-be" }, undefined, person("jonas"));
    if (gate.ok) throw new Error("the demo upload should be blocked");
    const check = gate.body.check as ConflictCheck;
    expect(check.hard.some((c) => c.existing.docId === REGISTER)).toBe(true);
    const seen = redactConflicts(world, check, person("jonas"));
    const hidden = [...seen.hard, ...seen.possible].filter((c) => c.existing.title === HIDDEN_TITLE);
    expect(hidden.length).toBeGreaterThan(0);
    expect(JSON.stringify(seen)).not.toContain(REGISTER);
    for (const c of hidden) expect(c.existing).toMatchObject({ docId: "", lineText: "", ownerId: null });
    // Its owner still sees what it is.
    expect(JSON.stringify(redactConflicts(world, check, person("an")))).toContain(REGISTER);
  });

  test("a contradiction doubt never names a document the viewer can't see", async () => {
    const doc = world.docs.find((d) => d.id === "overtime-be")!;
    const doubts = await contradictionDoubts(world, doc, person("jonas"));
    expect(JSON.stringify(doubts)).not.toContain(REGISTER);
  });
});
