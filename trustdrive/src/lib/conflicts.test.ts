import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { cases, type Side } from "./conflict-cases";
import { checkConflicts, extractFacts, HARD_THRESHOLD, POSSIBLE_THRESHOLD, ruleProbability } from "./conflicts";
import { buildSeed } from "./seed";
import type { Location } from "./types";

/** Rule verdict for the last fact line of `a` against the last fact line of `b`. */
function verdict(a: Side, b: Side) {
  const fa = extractFacts(a.text).at(-1);
  const fb = extractFacts(b.text).at(-1);
  if (!fa || !fb) throw new Error("fixture has no fact line");
  const p = ruleProbability({ title: a.title ?? "", locations: [a.location ?? "Belgium"] }, fa, { title: b.title ?? "", locations: [b.location ?? "Belgium"], status: b.status ?? "Completed" }, fb);
  return p >= HARD_THRESHOLD ? "hard" : p >= POSSIBLE_THRESHOLD ? "possible" : "none";
}

describe("rule-based conflict verdicts", () => {
  test.each(cases)("$name → $expected", ({ a, b, expected }) => {
    expect(verdict(a, b)).toBe(expected);
  });
});

describe("demo uploads against the demo company (rules only)", () => {
  const db = buildSeed();
  const upload = (file: string, location: Location = "Belgium") => {
    const content = fs.readFileSync(path.join(__dirname, "../../samples", file), "utf8");
    return checkConflicts(db, { title: content.split("\n")[0].replace(/^#\s*/, ""), content, locations: [location], teamId: "pay-be" }, { rulesOnly: true });
  };
  const hardWith = async (file: string, location?: Location) => (await upload(file, location)).hard.map((c) => `${c.existing.docId}:${c.existing.lineNo}`);

  test("salary review is blocked by Jonas's row in the salary register", async () => {
    expect(await hardWith("salary-review-jonas-maes.md")).toEqual(["salary-register-be:8"]);
  });
  test("French and English December plans are blocked by the input deadline", async () => {
    expect(await hardWith("multilingual/planning-paie-decembre-fr.md")).toEqual(["input-deadlines:7"]);
    expect(await hardWith("december-payroll-plan.md")).toEqual(["input-deadlines:7"]);
  });
  test("uploads that agree with the drive are not blocked", async () => {
    expect(await hardWith("multilingual/gehaltsuebersicht-de.md")).toEqual([]);
    expect(await hardWith("multilingual/maladie-salaire-garanti-fr.md")).toEqual([]);
    expect(await hardWith("multilingual/overuren-nl.md", "Netherlands")).toEqual([]);
  });
  test("rule checks say so", async () => {
    expect((await upload("salary-review-jonas-maes.md")).method).toBe("rules");
  });
});
