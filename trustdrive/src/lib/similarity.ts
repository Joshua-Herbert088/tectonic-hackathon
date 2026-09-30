import crypto from "node:crypto";
import { textFeatures } from "./conflicts";
import { callJev } from "./trust";
import type { Db, Doc, DocStatus, Location } from "./types";

/**
 * Redundancy detection: does a document contain basically the same information as another one?
 * A cheap feature overlap (words, multilingual concepts, names, numbers) picks a few candidates,
 * then Jev scores how much information they share – across languages and wording.
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
  location: Location;
  status: DocStatus;
  teamId: string;
  ownerId: string | null;
  updatedAt: string;
  /** Jev's position on OVERLAP_LEVELS (0–4). */
  overlap: number;
  label: string;
}

interface Text {
  title: string;
  content: string;
}

function prefilter(a: Set<string>, b: Set<string>) {
  let shared = 0;
  for (const f of a) if (b.has(f)) shared++;
  return shared / Math.max(1, Math.min(a.size, b.size));
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
  if (!candidates.length) return [];
  const scores = await jevOverlap(text, candidates);
  return candidates
    .map((d, i) => ({
      docId: d.id,
      title: d.title,
      location: d.location,
      status: d.status,
      teamId: d.teamId,
      ownerId: d.ownerId,
      updatedAt: d.updatedAt,
      overlap: scores[i],
      label: OVERLAP_LEVELS[Math.round(scores[i])].split(" – ")[0],
    }))
    .filter((x) => x.overlap >= SAME_INFO_THRESHOLD)
    .sort((a, b) => b.overlap - a.overlap);
}

/** For uploads: existing documents (not superseded) that the new one would duplicate. */
export function findRedundant(db: Db, text: Text, excludeDocId?: string) {
  return findSameInformation(
    text,
    db.docs.filter((d) => d.id !== excludeDocId && !d.supersededById),
  );
}

/** Text with headings and blank lines removed – used to tell an empty new doc from a real one. */
export function substance(content: string) {
  return content
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .join("\n")
    .trim();
}
