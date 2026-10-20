import { describe, expect, test } from "vitest";
import { buildSeed } from "./seed";
import { suggestTagsByRules } from "./tagging";
import { DEFAULT_TERMS, GLOBAL, newTermId, taxonomyOf, validateTerm, type Term } from "./taxonomy";

const tax = taxonomyOf(DEFAULT_TERMS);

describe("editable taxonomy", () => {
  test("the countries are the defaults plus Global", () => {
    expect(tax.locations).toEqual(["Belgium", "France", "Germany", "Netherlands", GLOBAL]);
  });

  test("a document needs a document type and a topic", () => {
    expect(tax.missingTags([])).toEqual(["a document type", "a topic"]);
    expect(tax.missingTags(["salary"])).toEqual(["a document type"]);
    expect(tax.missingTags(["policy", "not-a-tag"])).toEqual(["a topic"]);
    expect(tax.missingTags(["policy", "salary"])).toEqual([]);
  });

  test("names are required and unique per kind; Global isn't a country to add", () => {
    expect(validateTerm(tax, "topic", { label: " " })).toMatch(/name/);
    expect(validateTerm(tax, "topic", { label: "salary", parent: "compensation" })).toMatch(/already/);
    expect(validateTerm(tax, "country", { label: "global" })).toMatch(/always available/);
    expect(validateTerm(tax, "country", { label: "Luxembourg" })).toBeNull();
    // Editing keeps its own name.
    expect(validateTerm(tax, "docType", { label: "Policy" }, tax.docType.get("policy"))).toBeNull();
  });

  test("topics stay two levels deep", () => {
    expect(validateTerm(tax, "topic", { label: "Pensions", parent: "salary" })).toMatch(/main topic/);
    expect(validateTerm(tax, "topic", { label: "Compensation & benefits", parent: "time" }, tax.topic.get("compensation"))).toMatch(/sub-topics/);
    expect(validateTerm(tax, "topic", { label: "Pensions", parent: "compensation" })).toBeNull();
  });

  test("new tags get a unique slug; countries keep their name", () => {
    expect(newTermId(tax, "topic", "Pensions & Retirement")).toBe("pensions-retirement");
    expect(newTermId(tax, "docType", "Salary")).toBe("salary-2");
    expect(newTermId(tax, "country", " Luxembourg ")).toBe("Luxembourg");
  });

  test("a country added later is suggested from its keywords", () => {
    const luxembourg: Term = { kind: "country", id: "Luxembourg", label: "Luxembourg", description: "", keywords: ["luxembourg", "luxemburg", "ccss"] };
    const db = { ...buildSeed(), terms: [...DEFAULT_TERMS, luxembourg] };
    const s = suggestTagsByRules(db, { title: "Affiliation CCSS – Luxembourg", content: "New employees in Luxembourg are registered with the CCSS before their first day." });
    expect(s.location.value).toBe("Luxembourg");
  });

  test("suggestions only use tags that still exist", () => {
    const db = { ...buildSeed(), terms: DEFAULT_TERMS.filter((t) => t.id !== "guide") };
    const s = suggestTagsByRules(db, { title: "Expense claims – FAQ", content: "**Q:** Can I claim a taxi?\n**A:** Yes.\n\n**Q:** Hotel cap?\n**A:** €150." });
    expect(s.docType?.value).not.toBe("guide");
  });
});
