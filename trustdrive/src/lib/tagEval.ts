import { DEFAULT_TAXONOMY as TAX } from "./taxonomy";
import type { TagSuggestion } from "./tagging";
import type { Doc } from "./types";

/**
 * Measuring tag suggestions against hand-labelled documents (the demo company's own tags, country,
 * team and client), in the spirit of the MIT/McKinsey poster: accuracy per field, precision/recall for
 * topics, and how often repeated runs give the same answer.
 */

export interface Gold {
  location: string;
  teamId: string;
  clientId: string | null;
  docType: string | null;
  /** Topics with their parents. */
  topics: Set<string>;
}

export function goldOf(doc: Pick<Doc, "locations" | "teamId" | "clientId" | "tags">): Gold {
  return {
    location: doc.locations[0],
    teamId: doc.teamId,
    clientId: doc.clientId ?? null,
    docType: doc.tags.find((t) => TAX.docType.has(t)) ?? null,
    topics: TAX.withParents(doc.tags.filter((t) => TAX.topic.has(t))),
  };
}

const ratio = (hit: number, total: number) => (total ? hit / total : 0);

export interface TagScores {
  documents: number;
  location: number;
  team: number;
  client: number;
  /** Over documents whose labels include a document type. */
  docType: number;
  docTypeLabelled: number;
  topicPrecision: number;
  topicRecall: number;
  topicF1: number;
  /** Documents with at least one correct topic (the poster's headline measure). */
  atLeastOneTopic: number;
}

export function scoreSuggestions(results: { gold: Gold; suggestion: TagSuggestion }[]): TagScores {
  let loc = 0, team = 0, client = 0, docType = 0, docTypeN = 0, tp = 0, predicted = 0, actual = 0, oneRight = 0;
  for (const { gold, suggestion: s } of results) {
    if (s.location.value === gold.location) loc++;
    if (s.team?.value === gold.teamId) team++;
    if ((s.client?.value ?? null) === gold.clientId) client++;
    if (gold.docType) {
      docTypeN++;
      if (s.docType?.value === gold.docType) docType++;
    }
    const topics = TAX.withParents(s.topics.map((t) => t.value));
    const hits = [...topics].filter((t) => gold.topics.has(t)).length;
    tp += hits;
    predicted += topics.size;
    actual += gold.topics.size;
    if (hits > 0) oneRight++;
  }
  const precision = ratio(tp, predicted);
  const recall = ratio(tp, actual);
  const n = results.length;
  return {
    documents: n,
    location: ratio(loc, n),
    team: ratio(team, n),
    client: ratio(client, n),
    docType: ratio(docType, docTypeN),
    docTypeLabelled: docTypeN,
    topicPrecision: precision,
    topicRecall: recall,
    topicF1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    atLeastOneTopic: ratio(oneRight, n),
  };
}

/** Everything a person would see, so two runs can be compared. */
export function signature(s: TagSuggestion) {
  return JSON.stringify([s.location.value, s.team?.value ?? null, s.client?.value ?? null, s.docType?.value ?? null, s.topics.map((t) => t.value).sort()]);
}

/** Share of documents whose repeated runs all produced the same suggestion. */
export function consistency(runs: TagSuggestion[][]) {
  return ratio(runs.filter((r) => new Set(r.map(signature)).size === 1).length, runs.length);
}

export const percent = (x: number) => `${Math.round(x * 1000) / 10}%`;
