import { GLOBAL, keywordHits, taxonomyOf, type Taxonomy } from "./taxonomy";
import { stripLinks } from "./lexicon";
import { callJev } from "./trust";
import type { Client, Db, Location, Team } from "./types";

/**
 * Suggests a document's country, team, client, document type and topics.
 * - Jev: one call per document with typed `choice` questions, walking the topic tree level by level
 *   (top-level topic, then a sub-topic within each). A sub-topic's confidence is P(top) × P(sub | top).
 * - Like a relevance filter, a suggested topic needs supporting words in the text unless Jev is very
 *   sure – this keeps confident-sounding but unsupported tags out.
 * - Without Jev, keyword rules in four languages decide.
 * People confirm or remove each suggestion; nothing is applied automatically.
 */

export interface Suggested<T> {
  value: T;
  confidence: number;
}

export interface TagSuggestion {
  location: Suggested<Location>;
  team: Suggested<string> | null;
  client: Suggested<string> | null;
  docType: Suggested<string> | null;
  /** Leaves and their parents, strongest first. */
  topics: Suggested<string>[];
  method: "jev" | "rules";
}

export interface TagInput {
  title: string;
  content: string;
  /** Used when nothing in the text points at a team (usually the uploader's). */
  defaultTeamId?: string;
}

const MAX_TOPICS = 3;
const MIN_TOPIC = 0.2;
const SURE = 0.5;
const MAX_CONTENT = 4000;
const NONE = "none";

// ---------------------------------------------------------------------------------------------
// Rules

/** The words in a text that point at each country ("DmfA" is Belgian), also given to Jev as evidence. */
function countryEvidence(tax: Taxonomy, text: string) {
  return Object.fromEntries(
    Object.entries(tax.countryEvidence).map(([country, words]) => [country, words.filter((w) => keywordHits(text, [w]) > 0)]).filter(([, found]) => found.length),
  ) as Record<string, string[]>;
}

function ruleLocation(tax: Taxonomy, text: string): Suggested<Location> {
  const hits = Object.entries(tax.countryEvidence)
    .map(([country, words]) => ({ country, n: keywordHits(text, words) }))
    .filter((c) => c.n > 0)
    .sort((a, b) => b.n - a.n);
  // One country clearly dominating; several (a comparison table) or none means it applies globally.
  if (hits.length === 1 || (hits.length > 1 && hits[0].n >= 3 * hits[1].n)) return { value: hits[0].country, confidence: Math.min(0.9, 0.5 + 0.1 * hits[0].n) };
  return { value: GLOBAL, confidence: hits.length > 1 ? 0.7 : 0.4 };
}

function ruleTopics(tax: Taxonomy, title: string, content: string): Suggested<string>[] {
  const score = (keywords: string[]) => keywordHits(title, keywords) * 2 + keywordHits(content, keywords);
  const leaves = tax.topics
    .filter((t) => t.parent)
    .map((t) => ({ id: t.id, s: score(t.keywords) }))
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s)
    .slice(0, MAX_TOPICS);
  const out = new Map(leaves.map((l) => [l.id, Math.min(0.9, 0.4 + 0.1 * l.s)]));
  for (const top of tax.topTopics) {
    const childBest = Math.max(0, ...leaves.filter((l) => tax.topic.get(l.id)!.parent === top.id).map((l) => out.get(l.id)!));
    const own = score(top.keywords);
    if (childBest || own >= 2) out.set(top.id, Math.max(childBest, Math.min(0.9, 0.4 + 0.1 * own)));
  }
  return [...out].map(([value, confidence]) => ({ value, confidence })).sort((a, b) => b.confidence - a.confidence);
}

function ruleDocType(tax: Taxonomy, title: string, content: string): Suggested<string> | null {
  const head = content.slice(0, 800);
  const scored = tax.docTypes.map((t) => ({ id: t.id, s: keywordHits(title, t.keywords) * 3 + keywordHits(head, t.keywords) }));
  const qa = (content.match(/^\s*(\*\*)?(q|vraag|question|frage)\s*:/gim) ?? []).length;
  const tableRows = (content.match(/^\s*\|/gm) ?? []).length;
  const steps = (content.match(/^\s*\d+\.\s/gm) ?? []).length;
  const checks = (content.match(/^\s*[-*]\s*\[[ x]\]/gim) ?? []).length;
  // The shapes below point at default document types; ones people have removed are skipped.
  const bump = (id: string, n: number) => {
    const x = scored.find((t) => t.id === id);
    if (x) x.s += n;
  };
  if (qa >= 2) bump("guide", 4);
  if (checks >= 2) bump("checklist", 3);
  if (steps >= 3) bump("procedure", 2);
  if (tableRows >= 4 && steps < 3) bump("reference", 2);
  const best = scored.sort((a, b) => b.s - a.s)[0];
  return best && best.s > 0 ? { value: best.id, confidence: Math.min(0.9, 0.4 + 0.1 * best.s) } : null;
}

/** Which team maintains documents like this: payroll topics go to the country's payroll team. */
function ruleTeam(db: Db, location: Location, topics: Set<string>, defaultTeamId?: string): Suggested<string> | null {
  const team = (name: RegExp) => db.teams.find((t) => name.test(t.name));
  const pick = (t: Team | undefined, confidence: number) => (t ? { value: t.id, confidence } : null);
  if (topics.has("support")) return pick(team(/customer success/i), 0.6);
  if (topics.has("clocking")) return pick(team(/time/i), 0.7);
  if (topics.has("compliance")) return pick(team(/legal/i), 0.7);
  if (location !== GLOBAL && (topics.has("payroll-processing") || topics.has("compensation") || topics.has("absence") || topics.has("overtime"))) {
    return pick(team(new RegExp(`payroll ${location}`, "i")), 0.7);
  }
  if (topics.has("expenses") || topics.has("allowance") || topics.has("onboarding")) return pick(team(/hr operations/i), 0.5);
  if (location !== GLOBAL) return pick(team(new RegExp(`payroll ${location}`, "i")), 0.4);
  return defaultTeamId ? { value: defaultTeamId, confidence: 0.3 } : null;
}

function ruleClient(clients: Client[], text: string): Suggested<string> | null {
  const c = clients.find((x) => keywordHits(text, [x.name, ...(x.domain ? [x.domain] : [])]) > 0);
  return c ? { value: c.id, confidence: 0.8 } : null;
}

export function suggestTagsByRules(db: Db, raw: TagInput): TagSuggestion {
  const tax = taxonomyOf(db.terms);
  const input = { ...raw, content: stripLinks(raw.content) };
  const text = `${input.title}\n${input.content}`;
  const location = ruleLocation(tax, text);
  const topics = ruleTopics(tax, input.title, input.content);
  return {
    location,
    team: ruleTeam(db, location.value, new Set(topics.map((t) => t.value)), input.defaultTeamId),
    client: ruleClient(db.clients, text),
    docType: ruleDocType(tax, input.title, input.content),
    topics,
    method: "rules",
  };
}

// ---------------------------------------------------------------------------------------------
// Jev

interface Choice {
  choice?: string;
  confidence: number;
  probabilities: Record<string, number>;
}

const describe = (t: { label: string; description: string }) => `${t.label}: ${t.description}`;

export async function suggestTags(db: Db, raw: TagInput, opts: { rulesOnly?: boolean } = {}): Promise<TagSuggestion> {
  const input = { ...raw, content: stripLinks(raw.content) };
  if (opts.rulesOnly) return suggestTagsByRules(db, input);
  const tax = taxonomyOf(db.terms);
  const questions: Record<string, object> = {
    topic: { type: "choice", instructions: "Which area is this document mainly about?", criteria: Object.fromEntries(tax.topTopics.map((t) => [t.id, describe(t)])) },
    docType: { type: "choice", instructions: "What kind of document is this?", criteria: Object.fromEntries(tax.docTypes.map((t) => [t.id, describe(t)])) },
    location: {
      type: "choice",
      instructions:
        "Which country's rules or work does this document apply to? `countryEvidence` lists words in the text that are specific to a country (for example DmfA and joint committees are Belgian); a document comparing several countries applies globally.",
      criteria: Object.fromEntries(tax.locations.map((l) => [l, l === GLOBAL ? "Several countries, or no country in particular" : `${l} only`])),
    },
    team: { type: "choice", instructions: "Which team would maintain this document?", criteria: Object.fromEntries(db.teams.map((t) => [t.id, t.name])) },
  };
  for (const top of tax.topTopics) {
    questions[`topic:${top.id}`] = {
      type: "choice",
      instructions: `Within "${top.label}", which sub-topic fits this document best?`,
      criteria: { ...Object.fromEntries(tax.childrenOf(top.id).map((t) => [t.id, describe(t)])), [NONE]: "None of these" },
    };
  }
  if (db.clients.length) {
    questions.client = {
      type: "choice",
      instructions: "Is this document about one specific client?",
      criteria: { ...Object.fromEntries(db.clients.map((c) => [c.id, `About the client ${c.name}`])), [NONE]: "Not about one specific client" },
    };
  }

  let answers: Record<string, Choice>;
  try {
    const r = await callJev({
      state: {
        task: "Tag a payroll company's internal document with its topic, type, country, team and client",
        document: { title: input.title, content: input.content.slice(0, MAX_CONTENT) },
        countryEvidence: countryEvidence(tax, `${input.title}\n${input.content}`),
      },
      questions,
    });
    answers = r.answers as unknown as Record<string, Choice>;
  } catch {
    return suggestTagsByRules(db, input);
  }

  const text = `${input.title}\n${input.content}`;
  const p = (q: string, id: string) => answers[q]?.probabilities?.[id] ?? 0;
  const best = (q: string) => Object.entries(answers[q]?.probabilities ?? {}).sort((a, b) => b[1] - a[1])[0] as [string, number] | undefined;

  // Topic tree: P(sub) = P(top) × P(sub | top); keep supported or very confident ones.
  const supported = (id: string, confidence: number) => confidence >= SURE || keywordHits(text, tax.topic.get(id)!.keywords) > 0;
  const leaves = tax.topics
    .filter((t) => t.parent)
    .map((t) => ({ value: t.id, confidence: p("topic", t.parent!) * p(`topic:${t.parent}`, t.id) }))
    .filter((l) => l.confidence >= MIN_TOPIC && supported(l.value, l.confidence))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_TOPICS);
  const topics = new Map(leaves.map((l) => [l.value, l.confidence]));
  for (const top of tax.topTopics) {
    const childBest = Math.max(0, ...leaves.filter((l) => tax.topic.get(l.value)!.parent === top.id).map((l) => l.confidence));
    const own = p("topic", top.id);
    if (childBest || (own >= SURE && supported(top.id, own))) topics.set(top.id, Math.max(childBest, own));
  }

  const loc = best("location");
  const team = best("team");
  const doc = best("docType");
  const client = best("client");
  return {
    location: loc && tax.locations.includes(loc[0]) ? { value: loc[0], confidence: loc[1] } : suggestTagsByRules(db, input).location,
    team: team && db.teams.some((t) => t.id === team[0]) ? { value: team[0], confidence: team[1] } : null,
    client: client && client[0] !== NONE && client[1] >= SURE ? { value: client[0], confidence: client[1] } : null,
    docType: doc && tax.docTypes.some((t) => t.id === doc[0]) ? { value: doc[0], confidence: doc[1] } : null,
    topics: [...topics].map(([value, confidence]) => ({ value, confidence })).sort((a, b) => b.confidence - a.confidence),
    method: "jev",
  };
}

