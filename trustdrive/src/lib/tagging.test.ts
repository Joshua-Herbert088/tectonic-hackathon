import { describe, expect, test } from "vitest";
import { buildSeed } from "./seed";
import { goldOf, scoreSuggestions } from "./tagEval";
import { suggestedTags } from "@/components/Tags";
import { suggestTags, suggestTagsByRules } from "./tagging";
import { DEFAULT_TAXONOMY, keywordHits } from "./taxonomy";

const { topics: TOPICS, withParents } = DEFAULT_TAXONOMY;

const db = buildSeed();
const doc = (id: string) => db.docs.find((d) => d.id === id)!;
const rules = (id: string) => suggestTagsByRules(db, { title: doc(id).title, content: doc(id).content });

describe("taxonomy", () => {
  test("every sub-topic has an existing parent, and ids are unique", () => {
    const ids = new Set(TOPICS.map((t) => t.id));
    expect(ids.size).toBe(TOPICS.length);
    for (const t of TOPICS) if (t.parent) expect(ids.has(t.parent)).toBe(true);
  });
  test("a sub-topic implies its parent", () => {
    expect([...withParents(["salary"])].sort()).toEqual(["compensation", "salary"]);
  });
  test("keywords match stems inside compound words, short words only on their own", () => {
    expect(keywordHits("Het bruto maandloon", ["maandloon"])).toBe(1);
    expect(keywordHits("Eindejaarspremie", ["premie"])).toBe(1);
    expect(keywordHits("dsnFlow", ["dsn"])).toBe(0);
    expect(keywordHits("Calendrier DSN 2026", ["dsn"])).toBe(1);
  });
});

describe("rule-based suggestions", () => {
  test("a Belgian declaration checklist", () => {
    const s = rules("dmfa-checklist");
    expect(s).toMatchObject({ location: { value: "Belgium" }, team: { value: "pay-be" }, docType: { value: "checklist" }, method: "rules" });
    expect(suggestedTags(s)).toEqual(expect.arrayContaining(["declarations", "payroll-processing", "checklist"]));
  });
  test("a German sick-pay policy, in German", () => {
    const s = rules("entgeltfortzahlung-de");
    expect(s.location.value).toBe("Germany");
    expect(s.topics.map((t) => t.value)).toContain("absence");
  });
  test("a policy comparing four countries applies globally", () => {
    expect(rules("remote-work").location.value).toBe("Global");
  });
  test("a client is recognised by name", () => {
    expect(rules("client-noordkaai").client?.value).toBe("noordkaai");
  });
});

// Measured on the demo company's own labels. The keywords were written knowing these documents, so this
// guards against regressions rather than proving accuracy on new documents.
test("rules keep their scores on the labelled demo documents", () => {
  const scores = scoreSuggestions(db.docs.map((d) => ({ gold: goldOf(d), suggestion: suggestTagsByRules(db, { title: d.title, content: d.content }) })));
  expect(scores.location).toBeGreaterThanOrEqual(0.8);
  expect(scores.team).toBeGreaterThanOrEqual(0.7);
  expect(scores.docType).toBeGreaterThanOrEqual(0.75);
  expect(scores.topicF1).toBeGreaterThanOrEqual(0.75);
  expect(scores.atLeastOneTopic).toBeGreaterThanOrEqual(0.95);
});

test("without Jev, suggestions fall back to the rules", async () => {
  // Jev is disabled in tests (vitest.config.ts).
  const s = await suggestTags(db, { title: doc("overtime-be").title, content: doc("overtime-be").content });
  expect(s.method).toBe("rules");
  expect(s.topics.map((t) => t.value)).toContain("overtime");
});
