import { describe, expect, test } from "vitest";
import { coversCountry, formatLocations, overlaps, teamCountries, teamsFor } from "./appliesTo";
import { compareFacts, extractFacts } from "./conflicts";
import { buildSeed } from "./seed";
import { buildSignals } from "./trust";

const seed = buildSeed();
const countryOf = teamCountries(seed.teams, seed.people);

describe("applies to", () => {
  test("Global overlaps everything; countries overlap when they share one", () => {
    expect(overlaps(["Belgium", "France"], ["France"])).toBe(true);
    expect(overlaps(["Belgium"], ["Germany"])).toBe(false);
    expect(overlaps(["Global"], ["Germany"])).toBe(true);
    expect(coversCountry(["Belgium", "Netherlands"], "Netherlands")).toBe(true);
    expect(coversCountry(["Belgium"], "France")).toBe(false);
  });

  test("labels read naturally", () => {
    expect(formatLocations(["Belgium"])).toBe("Belgium");
    expect(formatLocations(["Belgium", "France", "Germany"])).toBe("Belgium, France and Germany");
  });

  test("teams are offered under the countries they're based in", () => {
    expect(countryOf.get("pay-nl")).toBe("Netherlands");
    const ids = (locations: string[]) => teamsFor(locations, seed.teams, countryOf).map((t) => t.id);
    expect(ids(["Netherlands"])).toContain("pay-nl");
    expect(ids(["Netherlands"])).not.toContain("pay-be");
    expect(ids(["Netherlands", "Belgium"])).toEqual(expect.arrayContaining(["pay-nl", "pay-be"]));
    expect(ids(["Global"])).toHaveLength(seed.teams.length);
  });

  test("a document for two countries can contradict either, but not a third", () => {
    const [a] = extractFacts("- Overtime premium: +50% on weekdays");
    const [b] = extractFacts("- Overtime premium: +75% on weekdays");
    const doc = (locations: string[]) => ({ title: "Overtime policy", locations, status: "Completed" as const });
    expect(compareFacts({ title: "Overtime", locations: ["Belgium", "Netherlands"] }, a, doc(["Netherlands"]), b).p).toBeGreaterThan(0.5);
    expect(compareFacts({ title: "Overtime", locations: ["Belgium", "Netherlands"] }, a, doc(["Germany"]), b).p).toBeLessThan(0.1);
  });

  test("the trust panel says when a document is meant for other teams", () => {
    const viewer = seed.people.find((p) => p.id === "jonas")!;
    const doc = { ...seed.docs.find((d) => d.id === "overtime-nl")!, locations: ["Belgium", "Netherlands"], audienceTeamIds: ["pay-nl"] };
    const texts = buildSignals(seed, doc, viewer).map((s) => s.text);
    expect(texts).toContain("Applies to Belgium and Netherlands – including your location");
    expect(texts).toContain("Meant for Payroll Netherlands, not your team");
  });
});
