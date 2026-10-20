import { describe, expect, test } from "vitest";
import { buildSeed } from "./seed";
import { consistency, goldOf, percent, scoreSuggestions } from "./tagEval";
import type { TagSuggestion } from "./tagging";

/**
 * Tag suggestions by Jev against the rules on the labelled demo documents, plus consistency: each
 * document is tagged RUNS times and counted consistent when every run gives the same suggestion.
 * Calls the paid Jev API (~12 questions per document per run), so it only runs on request:
 *   JEV_EVAL=1 npm test -- tagging.jev
 */
const enabled = process.env.JEV_EVAL === "1";
const RUNS = 5;
if (enabled) {
  process.env.JEV_DISABLED = "";
  process.loadEnvFile(".env.local");
}
// Imported after the environment is set: configuration is read once, on first import.
const { suggestTags, suggestTagsByRules } = await import("./tagging");

describe.skipIf(!enabled)("Jev tagging evaluation", () => {
  test("accuracy and consistency", { timeout: 600_000 }, async () => {
    const db = buildSeed();
    const runs: TagSuggestion[][] = [];
    for (const d of db.docs) {
      const input = { title: d.title, content: d.content };
      runs.push(await Promise.all(Array.from({ length: RUNS }, () => suggestTags(db, input))));
    }
    expect(runs.flat().every((s) => s.method === "jev")).toBe(true);
    const gold = db.docs.map(goldOf);
    const jev = scoreSuggestions(runs.map((r, i) => ({ gold: gold[i], suggestion: r[0] })));
    const rules = scoreSuggestions(db.docs.map((d, i) => ({ gold: gold[i], suggestion: suggestTagsByRules(db, { title: d.title, content: d.content }) })));
    const row = (k: keyof typeof jev) => ({ measure: k, jev: percent(jev[k] as number), rules: percent(rules[k] as number) });
    console.table((["location", "team", "client", "docType", "topicPrecision", "topicRecall", "topicF1", "atLeastOneTopic"] as const).map(row));
    console.log(`Consistency over ${RUNS} runs: ${percent(consistency(runs))} of ${runs.length} documents identical every time (rules: 100% by construction)`);
  });
});
