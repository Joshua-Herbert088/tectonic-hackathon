import crypto from "node:crypto";
import { conceptsIn, fold, isConceptWord } from "./lexicon";
import { callJev } from "./trust";
import { timeAgo } from "./time";
import type { Conflict, ConflictCheck, Db, Doc, Location } from "./types";

/**
 * Conflict detection for a draft (new upload or edited document):
 * 1. Pull out "fact lines" – lines with numbers, amounts or dates; table rows become "Header: value; …".
 * 2. Pair each draft fact with existing facts on the same subject whose values differ, ranking pairs
 *    from the same location / team first but checking every document. "Same subject" is language
 *    independent: shared words, shared multilingual concepts (salary = loon = salaire = Gehalt), or a
 *    shared name plus the same kind of value in a compatible year.
 * 3. Ask Jev a yes/no question per pair: do these statements directly contradict each other?
 */

export const HARD_THRESHOLD = 0.75;
export const POSSIBLE_THRESHOLD = 0.4;
const MAX_PAIRS = 60;
const MAX_PAIRS_PER_LINE = 6;
const QUESTIONS_PER_CALL = 20;

export interface Draft {
  title: string;
  content: string;
  location: Location;
  teamId: string;
  /** When editing, the document being edited (never compared with itself). */
  docId?: string;
  /** When editing, the saved version – only new or changed lines are checked. */
  previousContent?: string;
}

interface Fact {
  lineNo: number;
  text: string;
  section?: string;
  /** Words plus language-independent concepts ("c:salary", "c:m12", …). */
  keywords: Set<string>;
  /** Capitalised words that aren't vocabulary – usually names of people, clients, places. */
  anchors: Set<string>;
  years: Set<string>;
  valueTypes: Set<string>;
  numbers: string;
}

const STOPWORDS = new Set(
  "the and for with from that this are was were will per not all any can must may has have been into only than then also each after before when what which who their there they them our your you its via but out off upon about over under between within without".split(" "),
);

function normalizeWords(s: string) {
  return fold(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

function anchorsIn(text: string) {
  const out = new Set<string>();
  for (const m of text.matchAll(/\p{Lu}[\p{L}'-]{2,}/gu)) {
    if (!isConceptWord(m[0]) && !STOPWORDS.has(fold(m[0]))) out.add(fold(m[0]));
  }
  return out;
}

function valueTypesIn(text: string, concepts: Set<string>) {
  const out = new Set<string>();
  if (/€|\beur\b|\beuro/i.test(text)) out.add("money");
  if (/%/.test(text)) out.add("percent");
  if (concepts.has("c:mileage")) out.add("distance");
  if (concepts.has("c:hour")) out.add("hours");
  if ([...concepts].some((c) => /^c:m\d\d$/.test(c)) || /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/.test(text)) out.add("date");
  return out;
}

export function extractFacts(content: string): Fact[] {
  const facts: Fact[] = [];
  let section: string | undefined;
  let header: string[] | null = null;

  content.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line.startsWith("|")) header = null;
    if (line.startsWith("#")) {
      section = line.replace(/^#+\s*/, "");
      return;
    }
    let text = line;
    if (line.startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^:?-+:?$/.test(c))) return;
      if (!header) {
        header = cells;
        return;
      }
      const h = header;
      text = cells.map((c, j) => (h[j] ? `${h[j]}: ${c}` : c)).join("; ");
    } else {
      text = line.replace(/^(?:[-*>]|\d+\.)\s+/, "").replace(/\*\*/g, "");
    }
    if (!/\d/.test(text)) return;
    const concepts = conceptsIn(text);
    const keywords = new Set([...normalizeWords(text), ...concepts]);
    if (keywords.size < 2) return;
    // "3 900", "3.900" and "3,900" are the same number; thin/no-break spaces are common in French.
    const digits = text.replace(/(\d)[\s\u00a0\u202f](?=\d{3}\b)/g, "$1");
    const numbers = [...(digits.match(/\d+(?:[.,]\d+)*/g) ?? [])].map((n) => n.replace(/[.,]/g, "")).sort().join(",");
    const years = new Set(digits.match(/\b(?:19|20)\d{2}\b/g) ?? []);
    facts.push({ lineNo: i + 1, text, section, keywords, anchors: anchorsIn(text), years, valueTypes: valueTypesIn(text, concepts), numbers });
  });
  return facts;
}

interface Pair {
  fact: Fact;
  doc: Doc;
  other: Fact;
  priority: number;
}

function candidatePairs(db: Db, draft: Draft, facts: Fact[]) {
  const docs = db.docs.filter((d) => d.id !== draft.docId && !d.supersededById);
  const pairs: Pair[] = [];
  for (const doc of docs) {
    const scopeBoost =
      (doc.location === draft.location ? 0.4 : doc.location === "Global" || draft.location === "Global" ? 0.2 : 0) + (doc.teamId === draft.teamId ? 0.3 : 0);
    for (const other of extractFacts(doc.content)) {
      for (const fact of facts) {
        if (fact.numbers === other.numbers) continue; // same values → cannot be a data conflict
        let shared = 0;
        for (const w of fact.keywords) if (other.keywords.has(w)) shared++;
        const ratio = shared / Math.min(fact.keywords.size, other.keywords.size);
        if (shared >= 2 && ratio >= 0.3) {
          pairs.push({ fact, doc, other, priority: ratio + scopeBoost });
          continue;
        }
        // Fallback for vocabulary the concept list doesn't know: same name or subject, same kind of
        // value (amount, %, date…) and no clash of years.
        const sharedAnchor = [...fact.anchors].some((a) => other.anchors.has(a));
        const sharedConcept = [...fact.keywords].some((k) => k.startsWith("c:") && !/^c:(m\d\d|day|week|month|year|hour|maximum)$/.test(k) && other.keywords.has(k));
        const sameValueType = [...fact.valueTypes].some((t) => other.valueTypes.has(t));
        const yearsCompatible = !fact.years.size || !other.years.size || [...fact.years].some((y) => other.years.has(y));
        if ((sharedAnchor || sharedConcept) && sameValueType && yearsCompatible) {
          pairs.push({ fact, doc, other, priority: 0.25 + scopeBoost });
        }
      }
    }
  }
  // Best pairs first, but don't let one line hog the whole budget.
  pairs.sort((a, b) => b.priority - a.priority);
  const perLine = new Map<number, number>();
  const chosen: Pair[] = [];
  for (const p of pairs) {
    const n = perLine.get(p.fact.lineNo) ?? 0;
    if (n >= MAX_PAIRS_PER_LINE) continue;
    perLine.set(p.fact.lineNo, n + 1);
    chosen.push(p);
    if (chosen.length >= MAX_PAIRS) break;
  }
  return { pairs: chosen, docsChecked: docs.length };
}

function question(db: Db, draft: Draft, p: Pair) {
  const team = (id: string) => db.teams.find((t) => t.id === id)?.name ?? id;
  const a = `New document '${draft.title}' (applies to ${draft.location}, team ${team(draft.teamId)}${p.fact.section ? `, section '${p.fact.section}'` : ""}), line ${p.fact.lineNo}: ${p.fact.text}`;
  const b = `Existing document '${p.doc.title}' (applies to ${p.doc.location}, team ${team(p.doc.teamId)}, status ${p.doc.status}, edited ${timeAgo(p.doc.updatedAt)}${p.other.section ? `, section '${p.other.section}'` : ""}), line ${p.other.lineNo}: ${p.other.text}`;
  return {
    type: "noul",
    instructions:
      "Do these two statements directly contradict each other? A hard conflict means they state the SAME fact (same person or item, same country, same period/year) with incompatible values, so both cannot be true at the same time. Different years, different countries, a draft proposal versus a current rule, or merely different topics are NOT conflicts. The statements may be written in different languages (English, Dutch, French, German) and use different number and date formats (3.900 = 3,900 = 3 900); compare their meaning, not their wording.\n\n" +
      `Statement A – ${a}\n\nStatement B – ${b}`,
  };
}

// Save requests re-run the check; caching keeps that instant and consistent with what the user saw.
const cache = new Map<string, ConflictCheck>();

export async function checkConflicts(db: Db, draft: Draft): Promise<ConflictCheck> {
  const docsVersion = db.docs.map((d) => `${d.id}@${d.updatedAt}@${d.location}@${d.status}`).join("|");
  const key = crypto.createHash("sha1").update(JSON.stringify([draft, docsVersion])).digest("hex");
  const hit = cache.get(key);
  if (hit) return hit;

  const unchanged = new Set(draft.previousContent ? extractFacts(draft.previousContent).map((f) => f.text) : []);
  const facts = extractFacts(draft.content).filter((f) => !unchanged.has(f.text));
  // Conflicts someone already overrode for this document don't need to be decided again.
  const overridden = new Set(db.overrides.filter((o) => o.docId === draft.docId).map((o) => `${o.lineText}|${o.existingDocId}|${o.existingLineText}`));
  const { pairs: all, docsChecked } = candidatePairs(db, draft, facts);
  const pairs = all.filter((p) => !overridden.has(`${p.fact.text}|${p.doc.id}|${p.other.text}`));
  const chunks: Pair[][] = [];
  for (let i = 0; i < pairs.length; i += QUESTIONS_PER_CALL) chunks.push(pairs.slice(i, i + QUESTIONS_PER_CALL));
  const answers = await Promise.all(
    chunks.map((chunk) =>
      callJev({
        state: { task: "Detect hard factual conflicts between a new or edited document and existing company documents", today: new Date().toISOString().slice(0, 10) },
        questions: Object.fromEntries(chunk.map((p, j) => [`c${j}`, question(db, draft, p)])),
      }).then((r) => chunk.map((_, j) => r.answers[`c${j}`].noul)),
    ),
  );
  const flat = answers.flat();

  const conflicts: Conflict[] = pairs
    .map((p, i) => ({ p, prob: flat[i] }))
    .filter(({ prob }) => prob >= POSSIBLE_THRESHOLD)
    .map(({ p, prob }) => ({
      key: crypto.createHash("sha1").update(`${p.fact.text}|${p.doc.id}|${p.other.lineNo}|${p.other.text}`).digest("hex").slice(0, 12),
      probability: prob,
      severity: prob >= HARD_THRESHOLD ? ("hard" as const) : ("possible" as const),
      lineNo: p.fact.lineNo,
      lineText: p.fact.text,
      existing: {
        docId: p.doc.id,
        title: p.doc.title,
        lineNo: p.other.lineNo,
        lineText: p.other.text,
        location: p.doc.location,
        teamId: p.doc.teamId,
        status: p.doc.status,
        updatedAt: p.doc.updatedAt,
        ownerId: p.doc.ownerId,
      },
    }))
    .sort((a, b) => a.lineNo - b.lineNo || b.probability - a.probability);

  const result: ConflictCheck = {
    hard: conflicts.filter((c) => c.severity === "hard"),
    possible: conflicts.filter((c) => c.severity === "possible"),
    pairsChecked: pairs.length,
    docsChecked,
  };
  if (cache.size > 200) cache.clear();
  cache.set(key, result);
  return result;
}

/** Language-independent bag of features for a whole text: words, concepts, names and numbers. */
export function textFeatures(text: string): Set<string> {
  const out = new Set<string>([...normalizeWords(text), ...conceptsIn(text), ...anchorsIn(text)]);
  const digits = text.replace(/(\d)[\s  ](?=\d{3}\b)/g, "$1");
  for (const n of digits.match(/\d+(?:[.,]\d+)*/g) ?? []) {
    const v = n.replace(/[.,]/g, "");
    if (v.length >= 2) out.add(`n:${v}`);
  }
  return out;
}
