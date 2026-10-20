import crypto from "node:crypto";
import { textFeatures } from "./conflicts";
import { callJev } from "./trust";
import type { Db, Doc, DocStatus, Location } from "./types";

/**
 * Redundancy detection: does a document contain basically the same information as another one?
 * A cheap feature overlap (words, multilingual concepts, names, numbers) picks a few candidates,
 * then Jev scores how much information they share – across languages and wording.
 * When Jev can't be reached, `ruleOverlap` estimates it from shared numbers, concepts and names.
 */

export const OVERLAP_LEVELS = [
  "Different topics – they share no information",
  "Same general topic, but they contain different information",
  "Partially overlapping – some of the same facts, but each has substantial information the other lacks",
  "Mostly the same information – one adds little beyond the other",
  "Essentially the same information – a duplicate, translation, or copy with minor changes",
];
/** On the 0–4 scale above: "mostly the same" or more. */
export const SAME_INFO_THRESHOLD = 2.75;
const MIN_FEATURES = 8;
const MIN_PREFILTER = 0.15;
const MAX_CANDIDATES = 3;
const MAX_CHARS = 3000;

export interface SimilarDoc {
  docId: string;
  title: string;
  locations: Location[];
  status: DocStatus;
  teamId: string;
  ownerId: string | null;
  updatedAt: string;
  /** Position on OVERLAP_LEVELS (0–4), from Jev or estimated by rules. */
  overlap: number;
  label: string;
  method: "jev" | "rules";
}

interface Text {
  title: string;
  content: string;
  /** Never sent to Jev: compared by the rules only. */
  confidential?: boolean;
}

function prefilter(a: Set<string>, b: Set<string>) {
  let shared = 0;
  for (const f of a) if (b.has(f)) shared++;
  return shared / Math.max(1, Math.min(a.size, b.size));
}

const jaccard = (a: Set<string>, b: Set<string>) => [...a].filter((x) => b.has(x)).length / Math.max(1, new Set([...a, ...b]).size);
/** Numbers, concepts and names read the same in every language, so a translation shares them. */
const languageFree = (features: Set<string>) => new Set([...features].filter((f) => f.startsWith("n:") || f.startsWith("c:")));
const MIN_LANGUAGE_FREE = 5;

/**
 * Estimated position on OVERLAP_LEVELS without Jev: how many numbers and concepts the texts share
 * (catches translations), or how many features overall (catches copies with few numbers).
 * Calibrated on the demo company: duplicates and translations land at 2.8–4, related documents below 2.7.
 */
export function ruleOverlap(a: Set<string>, b: Set<string>) {
  const la = languageFree(a);
  const lb = languageFree(b);
  const byFacts = Math.min(la.size, lb.size) >= MIN_LANGUAGE_FREE ? jaccard(la, lb) * 4.5 : 0;
  return Math.min(4, Math.max(byFacts, jaccard(a, b) * 5.5));
}

const cache = new Map<string, number>();
const hash = (s: string) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);

async function jevOverlap(text: Text, candidates: Doc[]): Promise<number[]> {
  const textKey = hash(text.title + "\n" + text.content);
  const keys = candidates.map((c) => `${textKey}|${c.id}@${c.updatedAt}`);
  const missing = candidates.filter((_, i) => !cache.has(keys[i]));
  if (missing.length) {
    const json = await callJev({
      state: { task: "Compare company documents for redundant information" },
      questions: Object.fromEntries(
        missing.map((c, i) => [
          `d${i}`,
          {
            type: "score",
            instructions:
              "How much of the information in these two documents is the same? Judge the facts, rules and figures they contain, not their wording or language (a translation of the same content counts as the same information).\n\n" +
              `Document A – '${text.title}':\n${text.content.slice(0, MAX_CHARS)}\n\nDocument B – '${c.title}':\n${c.content.slice(0, MAX_CHARS)}`,
            criteria: OVERLAP_LEVELS,
          },
        ]),
      ),
    });
    missing.forEach((c, i) => cache.set(`${textKey}|${c.id}@${c.updatedAt}`, json.answers[`d${i}`].score));
    if (cache.size > 500) cache.clear();
  }
  return keys.map((k) => cache.get(k) ?? 0);
}

/**
 * Documents among `pool` that contain basically the same information as `text`.
 * Only the strongest few prefilter matches are sent to Jev.
 */
export async function findSameInformation(text: Text, pool: Doc[]): Promise<SimilarDoc[]> {
  const features = textFeatures(`${text.title}\n${text.content}`);
  if (features.size < MIN_FEATURES) return [];
  const candidates = pool
    .map((d) => ({ d, s: prefilter(features, textFeatures(`${d.title}\n${d.content}`)) }))
    .filter((x) => x.s >= MIN_PREFILTER)
    .sort((a, b) => b.s - a.s)
    .slice(0, MAX_CANDIDATES)
    .map((x) => x.d);
  // Without Jev, estimate over the whole pool: the word-based prefilter ranks translations too low.
  const byRules = () =>
    pool
      .map((d) => similar(d, ruleOverlap(features, textFeatures(`${d.title}\n${d.content}`)), "rules"))
      .filter((x) => x.overlap >= SAME_INFO_THRESHOLD)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, MAX_CANDIDATES);
  // A confidential text is never sent to Jev, and neither is a confidential candidate.
  if (text.confidential) return byRules();
  if (!candidates.length) return [];
  const shareable = candidates.filter((d) => !d.confidential);
  let scores: number[];
  try {
    scores = shareable.length ? await jevOverlap(text, shareable) : [];
  } catch {
    return byRules();
  }
  return candidates
    .map((d) => (d.confidential ? similar(d, ruleOverlap(features, textFeatures(`${d.title}\n${d.content}`)), "rules") : similar(d, scores[shareable.indexOf(d)], "jev")))
    .filter((x) => x.overlap >= SAME_INFO_THRESHOLD)
    .sort((a, b) => b.overlap - a.overlap);
}

function similar(d: Doc, overlap: number, method: SimilarDoc["method"]): SimilarDoc {
  return {
    docId: d.id,
    title: d.title,
    locations: d.locations,
    status: d.status,
    teamId: d.teamId,
    ownerId: d.ownerId,
    updatedAt: d.updatedAt,
    overlap,
    label: OVERLAP_LEVELS[Math.round(overlap)].split(" – ")[0],
    method,
  };
}

/** For uploads: existing documents (not superseded) that the new one would duplicate. */
export function findRedundant(db: Db, text: Text, excludeDocId?: string) {
  return findSameInformation(
    text,
    db.docs.filter((d) => d.id !== excludeDocId && !d.supersededById),
  );
}

// Lives in lexicon.ts so the browser can use it too (this module needs Node's crypto).
export { substance } from "./lexicon";
