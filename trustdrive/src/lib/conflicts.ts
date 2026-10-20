import crypto from "node:crypto";
import { conceptsIn, fold, isConceptWord, stripLinks } from "./lexicon";
import { callJev } from "./trust";
import { timeAgo } from "./time";
import { formatLocations, isGlobal, overlaps } from "./appliesTo";
import type { Conflict, ConflictCheck, Db, Doc, Location } from "./types";

/**
 * Conflict detection for a draft (new upload or edited document):
 * 1. Pull out "fact lines" – lines with numbers, amounts or dates; table rows become "Header: value; …".
 * 2. Pair each draft fact with existing facts on the same subject whose values differ, ranking pairs
 *    from the same location / team first but checking every document. "Same subject" is language
 *    independent: shared words, shared multilingual concepts (salary = loon = salaire = Gehalt), or a
 *    shared name plus the same kind of value in a compatible year.
 * 3. Ask Jev a yes/no question per pair: do these statements directly contradict each other?
 *    When Jev can't be reached, fixed rules decide instead (`ruleProbability`).
 */

export const HARD_THRESHOLD = 0.75;
export const POSSIBLE_THRESHOLD = 0.4;
const MAX_PAIRS = 60;
const MAX_PAIRS_PER_LINE = 6;
const QUESTIONS_PER_CALL = 20;
/** Lines of a draft checked at most: a huge upload can't make a check take ages. */
export const MAX_DRAFT_FACTS = 400;
/** Line comparisons per check at most, once the keyword index has narrowed them down. */
export const MAX_COMPARISONS = 200_000;

export interface Draft {
  title: string;
  content: string;
  /** The countries it applies to, or ["Global"]. */
  locations: Location[];
  teamId: string;
  /** When editing, the document being edited (never compared with itself). */
  docId?: string;
  /** When editing, the saved version – only new or changed lines are checked. */
  previousContent?: string;
  /** Confidential: its lines are never sent to Jev, so the rules decide every pair. */
  confidential?: boolean;
}

export interface Fact {
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

/**
 * Numbers in a text, formatting removed: "3 900", "3.900" and "3,900" all become "3900".
 * Thin and no-break spaces as thousands separators are common in French.
 */
function numbersIn(text: string): string[] {
  const joined = text.replace(/(\d)[\s\u00a0\u202f](?=\d{3}\b)/g, "$1");
  return (joined.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, ""));
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
    const line = stripLinks(raw).trim();
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
    const values = numbersIn(text);
    const numbers = [...values].sort().join(",");
    const years = new Set(text.match(/\b(?:19|20)\d{2}\b/g) ?? []);
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

// Facts of stored documents, extracted once per version instead of on every check.
const factsCache = new Map<string, { version: string; facts: Fact[] }>();
function factsOf(doc: Doc) {
  const version = `${doc.updatedAt}|${doc.content.length}`;
  const hit = factsCache.get(doc.id);
  if (hit?.version === version) return hit.facts;
  const facts = extractFacts(doc.content);
  factsCache.set(doc.id, { version, facts });
  return facts;
}

/**
 * Pairs of a draft line and a stored line worth deciding. Every pair that can qualify shares a keyword or
 * an anchor, so an index on those finds them without comparing every line with every line; the order is
 * the same as comparing them all (document, its line, draft line), so ties are broken the same way.
 */
function candidatePairs(db: Db, draft: Draft, allFacts: Fact[]) {
  const facts = allFacts.slice(0, MAX_DRAFT_FACTS);
  const docs = db.docs.filter((d) => d.id !== draft.docId && !d.supersededById);
  for (const id of factsCache.keys()) if (!db.docs.some((d) => d.id === id)) factsCache.delete(id);
  const byTerm = new Map<string, number[]>();
  facts.forEach((f, i) => {
    for (const t of [...f.keywords, ...[...f.anchors].map((a) => `a:${a}`)]) (byTerm.get(t) ?? byTerm.set(t, []).get(t)!).push(i);
  });
  const pairs: (Pair & { order: [number, number, number] })[] = [];
  let comparisons = 0;
  docs.forEach((doc, docIndex) => {
    if (comparisons >= MAX_COMPARISONS) return;
    const scopeBoost =
      (doc.locations.some((l) => draft.locations.includes(l)) ? 0.4 : overlaps(doc.locations, draft.locations) ? 0.2 : 0) + (doc.teamId === draft.teamId ? 0.3 : 0);
    factsOf(doc).forEach((other, otherIndex) => {
      const near = new Set<number>();
      for (const t of [...other.keywords, ...[...other.anchors].map((a) => `a:${a}`)]) for (const i of byTerm.get(t) ?? []) near.add(i);
      for (const factIndex of [...near].sort((a, b) => a - b)) {
        if (++comparisons > MAX_COMPARISONS) return;
        const fact = facts[factIndex];
        const add = (priority: number) => pairs.push({ fact, doc, other, priority, order: [docIndex, otherIndex, factIndex] });
        if (fact.numbers === other.numbers) continue; // same values → cannot be a data conflict
        let shared = 0;
        for (const w of fact.keywords) if (other.keywords.has(w)) shared++;
        const ratio = shared / Math.min(fact.keywords.size, other.keywords.size);
        if (shared >= 2 && ratio >= 0.3) {
          add(ratio + scopeBoost);
          continue;
        }
        // Fallback for vocabulary the concept list doesn't know: same name or subject, same kind of
        // value (amount, %, date…) and no clash of years.
        const sharedAnchor = [...fact.anchors].some((a) => other.anchors.has(a));
        const sharedConcept = [...fact.keywords].some((k) => k.startsWith("c:") && !/^c:(m\d\d|day|week|month|year|hour|maximum)$/.test(k) && other.keywords.has(k));
        const sameValueType = [...fact.valueTypes].some((t) => other.valueTypes.has(t));
        const yearsCompatible = !fact.years.size || !other.years.size || [...fact.years].some((y) => other.years.has(y));
        if ((sharedAnchor || sharedConcept) && sameValueType && yearsCompatible) add(0.25 + scopeBoost);
      }
    });
  });
  // Best pairs first, but don't let one line hog the whole budget.
  pairs.sort((a, b) => b.priority - a.priority || a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.order[2] - b.order[2]);
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
  const a = `New document '${draft.title}' (applies to ${formatLocations(draft.locations)}, team ${team(draft.teamId)}${p.fact.section ? `, section '${p.fact.section}'` : ""}), line ${p.fact.lineNo}: ${p.fact.text}`;
  const b = `Existing document '${p.doc.title}' (applies to ${formatLocations(p.doc.locations)}, team ${team(p.doc.teamId)}, status ${p.doc.status}, edited ${timeAgo(p.doc.updatedAt)}${p.other.section ? `, section '${p.other.section}'` : ""}), line ${p.other.lineNo}: ${p.other.text}`;
  return {
    type: "noul",
    instructions:
      "Do these two statements directly contradict each other? A hard conflict means they state the SAME fact (same person or item, same country, same period/year) with incompatible values, so both cannot be true at the same time. Different years, different countries, a draft proposal versus a current rule, or merely different topics are NOT conflicts. The statements may be written in different languages (English, Dutch, French, German) and use different number and date formats (3.900 = 3,900 = 3 900); compare their meaning, not their wording.\n\n" +
      `Statement A – ${a}\n\nStatement B – ${b}`,
  };
}

/*
 * Rule-based verdict, used when Jev is unavailable and as a tested baseline. Deliberately conservative:
 * it only calls something a hard conflict when both lines are clearly about the same thing (same
 * person or client, or several shared subject words), in the same country, year and month, and the
 * values that answer it differ. Wording contradictions are left to Jev.
 */

/** Concepts that say when or how much, not what – sharing them doesn't make two lines about the same thing. */
const GENERIC_CONCEPT = /^c:(m\d\d|day|week|month|year|hour|maximum)$/;
/** Lines that announce a change or a proposal rather than state the current value. */
const CHANGE_OR_PROPOSAL = /\b(from|as of|vanaf|a partir|ab|depuis|to be confirmed|proposal|proposed|voorstel|projet|entwurf|draft)\b/;
const CODE = /\b[A-Z]{1,3}\d{1,3}\b/g;
const HAS_CODE = /\b[A-Z]{1,3}\d{1,3}\b/;
/** Subjects specific enough that two lines about different ones can't contradict each other. */
const TOPIC_CONCEPT = /^c:(overtime|mileage|holidaypay|bonus|sick|leave|indexation|car|hotel|perdiem|retention|remote|tax|contribution|declaration)$/;
const COUNTRY_WORDS = new Set(["belgium", "belgie", "belgique", "belgien", "netherlands", "nederland", "pays-bas", "niederlande", "france", "frankrijk", "frankreich", "germany", "duitsland", "allemagne", "deutschland"]);

/** Multi-word names ("Jonas Maes", "Noordkaai Logistics"): consecutive capitalised words that aren't vocabulary. */
export function namesIn(text: string) {
  const out = new Set<string>();
  for (const m of text.matchAll(/\p{Lu}[\p{L}'-]+(?:\s+(?:(?:de|van|der|el|le|la)\s+)?\p{Lu}[\p{L}'-]+)+/gu)) {
    // German nouns are capitalised too ("Bruttomonatsgehalt Jonas Maes"): keep the runs of non-vocabulary words.
    let run: string[] = [];
    const flush = () => (run.filter((w) => /^\p{Lu}/u.test(w)).length >= 2 && out.add(fold(run.join(" "))), (run = []));
    for (const w of m[0].split(/\s+/)) {
      if (/^\p{Lu}/u.test(w) && (isConceptWord(w) || COUNTRY_WORDS.has(fold(w)) || STOPWORDS.has(fold(w)))) flush();
      else run.push(w);
    }
    flush();
  }
  return out;
}

interface Cell {
  value: string;
  concepts: Set<string>;
  stems: Set<string>;
}

/** Plain words (not covered by a concept), cut to a stem so "expenses" matches "expense". */
export function stemsOf(text: string) {
  return new Set(normalizeWords(text).filter((w) => !isConceptWord(w)).map((w) => w.slice(0, 5)));
}

/** A table row states one fact per column; a plain line is one "subject: value" cell. */
function cellsOf(f: Fact): Cell[] {
  return f.text.split("; ").map((part) => {
    const i = part.lastIndexOf(": ");
    // The value is usually after the colon, but not in "10 December: deadline for …".
    const value = i < 0 ? part : valueTokens(part.slice(i + 2)).size || !valueTokens(part.slice(0, i)).size ? part.slice(i + 2) : part.slice(0, i);
    return { value, concepts: conceptsIn(part), stems: stemsOf(part) };
  });
}

/** The values a cell states: codes like P1, and numbers other than years and ordinals ("13th month"), formatting removed. */
function valueTokens(text: string) {
  const out = new Set<string>(text.match(CODE) ?? []);
  const rest = text.replace(CODE, " ").replace(/\b\d+(?:st|nd|rd|th|de|ste)\b/gi, " ");
  for (const n of numbersIn(rest)) if (!/^(?:19|20)\d\d$/.test(n)) out.add(n);
  return out;
}

const overlap = <T,>(a: Set<T>, b: Set<T>) => [...a].filter((x) => b.has(x));

/** Probability-like score (0–1) that draft fact `a` and fact `b` of `doc` directly contradict each other. */
export function ruleProbability(draft: Pick<Draft, "title" | "locations">, a: Fact, doc: Pick<Doc, "title" | "locations" | "status">, b: Fact): number {
  return compareFacts(draft, a, doc, b).p;
}

/**
 * Rule comparison of two fact lines: `p` as in ruleProbability, and `agrees` when they clearly state
 * the same fact with the same value (used to tell whether something is already written down).
 */
export function compareFacts(draft: Pick<Draft, "title" | "locations">, a: Fact, doc: Pick<Doc, "title" | "locations" | "status">, b: Fact): { p: number; agrees: boolean } {
  const no = (p: number) => ({ p, agrees: false });
  // Different countries have different rules; different years or months are different facts.
  if (!overlaps(draft.locations, doc.locations)) return no(0.05);
  // Different people or clients, or different topics (sick pay vs holiday pay), are different facts.
  // Lines without a name or topic of their own borrow the document title's.
  const na = namesIn(a.text).size ? namesIn(a.text) : namesIn(draft.title);
  const nb = namesIn(b.text).size ? namesIn(b.text) : namesIn(doc.title);
  if (na.size && nb.size && !overlap(na, nb).length) return no(0.1);
  const topics = (f: Fact, title: string) => new Set([...f.keywords, ...conceptsIn(title)].filter((k) => TOPIC_CONCEPT.test(k)));
  const topicsA = topics(a, draft.title);
  const topicsB = topics(b, doc.title);
  if (topicsA.size && topicsB.size && !overlap(topicsA, topicsB).length) return no(0.1);
  if (a.years.size && b.years.size && !overlap(a.years, b.years).length) return no(0.05);
  const months = (f: Fact) => new Set([...f.keywords].filter((k) => /^c:m\d\d$/.test(k)));
  if (months(a).size && months(b).size && !overlap(months(a), months(b)).length) return no(0.05);

  // Compare the cells that are about the same thing (shared concepts count double), among cells that state a value.
  let best: { shared: number; ca: Cell; cb: Cell } | null = null;
  for (const ca of cellsOf(a).filter((c) => valueTokens(c.value).size)) {
    for (const cb of cellsOf(b).filter((c) => valueTokens(c.value).size)) {
      const concepts = overlap(ca.concepts, cb.concepts).filter((c) => !GENERIC_CONCEPT.test(c)).length;
      const shared = concepts * 2 + overlap(ca.stems, cb.stems).length;
      if (!best || shared > best.shared) best = { shared, ca, cb };
    }
  }
  if (!best || !best.shared) return no(0.1);
  const va = valueTokens(best.ca.value);
  const vb = valueTokens(best.cb.value);
  if (!va.size || !vb.size) return no(0.1); // nothing to compare
  if (overlap(va, vb).length) return { p: 0.1, agrees: best.shared >= 3 || (best.shared >= 2 && overlap(na, nb).length > 0) };
  const ta = valueTypesIn(best.ca.value, best.ca.concepts);
  const tb = valueTypesIn(best.cb.value, best.cb.concepts);
  if ((ta.size || tb.size) && !overlap(ta, tb).length && !(HAS_CODE.test(best.ca.value) && HAS_CODE.test(best.cb.value))) return no(0.15);

  const sameName = overlap(na, nb).length > 0;
  // Subject words of each whole line: specific concepts plus plain-word stems.
  const subjectOf = (f: Fact) => new Set([...[...f.keywords].filter((k) => k.startsWith("c:") && !GENERIC_CONCEPT.test(k)), ...stemsOf(f.text)]);
  const sa = subjectOf(a);
  const sb = subjectOf(b);
  const subject = overlap(sa, sb).length;
  // Short lines ("Mileage allowance: €0.40/km") can't share many words, so also accept near-complete overlap.
  const coverage = subject / Math.max(1, Math.min(sa.size, sb.size));

  const p = sameName ? 0.9 : best.shared >= 4 && (subject >= 3 || coverage >= 0.8) ? 0.85 : best.shared >= 3 ? 0.55 : 0.3;
  // One side is about a specific topic the other doesn't mention: probably not the same fact.
  if (!topicsA.size !== !topicsB.size) return no(Math.min(p, 0.3));
  // Not a clear contradiction: a draft or proposal, a change from a date, or a country rule next to a global one.
  const hedged = doc.status === "WIP" || CHANGE_OR_PROPOSAL.test(fold(a.text)) || CHANGE_OR_PROPOSAL.test(fold(b.text)) || isGlobal(draft.locations) !== isGlobal(doc.locations);
  return no(hedged ? Math.min(p, 0.55) : p);
}

// Save requests re-run the check; caching keeps that instant and consistent with what the user saw.
const cache = new Map<string, ConflictCheck>();

export async function checkConflicts(db: Db, draft: Draft, opts: { rulesOnly?: boolean } = {}): Promise<ConflictCheck> {
  const docsVersion = db.docs.map((d) => `${d.id}@${d.updatedAt}@${d.locations}@${d.status}${d.confidential ? "@c" : ""}`).join("|");
  const key = crypto.createHash("sha1").update(JSON.stringify([draft, docsVersion])).digest("hex");
  const hit = !opts.rulesOnly && cache.get(key);
  if (hit) return hit;

  const unchanged = new Set(draft.previousContent ? extractFacts(draft.previousContent).map((f) => f.text) : []);
  const facts = extractFacts(draft.content).filter((f) => !unchanged.has(f.text));
  // Conflicts someone already overrode for this document don't need to be decided again.
  const overridden = new Set(db.overrides.filter((o) => o.docId === draft.docId).map((o) => `${o.lineText}|${o.existingDocId}|${o.existingLineText}`));
  const { pairs: all, docsChecked } = candidatePairs(db, draft, facts);
  const pairs = all.filter((p) => !overridden.has(`${p.fact.text}|${p.doc.id}|${p.other.text}`));
  // Pairs with a confidential side are never sent to Jev; the rules decide those.
  const shareable = pairs.filter((p) => !draft.confidential && !p.doc.confidential);
  const chunks: Pair[][] = [];
  for (let i = 0; i < shareable.length; i += QUESTIONS_PER_CALL) chunks.push(shareable.slice(i, i + QUESTIONS_PER_CALL));
  let method: ConflictCheck["method"] = shareable.length ? "jev" : "rules";
  const fromJev = new Map<Pair, number>();
  try {
    if (opts.rulesOnly) throw new Error("rules requested");
    const answers = await Promise.all(
      chunks.map((chunk) =>
        callJev({
          state: { task: "Detect hard factual conflicts between a new or edited document and existing company documents", today: new Date().toISOString().slice(0, 10) },
          questions: Object.fromEntries(chunk.map((p, j) => [`c${j}`, question(db, draft, p)])),
        }).then((r) => chunk.map((_, j) => r.answers[`c${j}`].noul)),
      ),
    );
    answers.flat().forEach((prob, i) => fromJev.set(shareable[i], prob));
  } catch {
    method = "rules";
    fromJev.clear();
  }
  const flat = pairs.map((p) => fromJev.get(p) ?? ruleProbability(draft, p.fact, p.doc, p.other));

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
        locations: p.doc.locations,
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
    method,
  };
  // Rule results aren't cached, so Jev decides again as soon as it's back.
  if (method === "jev") {
    if (cache.size > 200) cache.clear();
    cache.set(key, result);
  }
  return result;
}

/** Language-independent bag of features for a whole text: words, concepts, names and numbers. */
export function textFeatures(raw: string): Set<string> {
  const text = stripLinks(raw);
  const out = new Set<string>([...normalizeWords(text), ...conceptsIn(text), ...anchorsIn(text)]);
  for (const n of numbersIn(text)) if (n.length >= 2) out.add(`n:${n}`);
  return out;
}
