import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { buildSeed } from "./seed";
import { findRedundant, findSameInformation } from "./similarity";

// Jev is disabled in tests (vitest.config.ts), so these run the rule-based estimate.
const db = buildSeed();
const sample = (file: string) => {
  const content = fs.readFileSync(path.join(__dirname, "../../samples", file), "utf8");
  return { title: content.split("\n")[0].replace(/^#\s*/, ""), content };
};
const doc = (id: string) => db.docs.find((d) => d.id === id)!;

describe("same information without Jev", () => {
  test("a French translation of an existing document is a duplicate", async () => {
    const hits = await findRedundant(db, sample("multilingual/maladie-salaire-garanti-fr.md"));
    expect(hits.map((h) => h.docId)).toContain("sick-leave-be");
    expect(hits[0].method).toBe("rules");
  });
  test("a copy with reworded steps is a duplicate", async () => {
    const hits = await findSameInformation(doc("clocking-cs-copy"), [doc("clocking-terminals")]);
    expect(hits.map((h) => h.docId)).toEqual(["clocking-terminals"]);
  });
  test("a document on the same topic with different facts is not", async () => {
    expect(await findRedundant(db, sample("salary-review-jonas-maes.md"))).toEqual([]);
    expect(await findSameInformation(doc("be-yearend-2026"), [doc("input-deadlines"), doc("payroll-calendar-2027-be")])).toEqual([]);
  });
});
