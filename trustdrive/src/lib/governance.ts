import { loadHistory } from "./db";
import { extractFacts } from "./conflicts";
import type { Db, Doc, FactRecord, GovernanceSnapshot, VersionEvent } from "./types";

function inferUnit(text: string) {
  if (/€/i.test(text)) return "EUR";
  if (/\$/i.test(text)) return "USD";
  if (/%/.test(text)) return "%";
  if (/km/i.test(text)) return "km";
  if (/hour|hrs|hours/i.test(text)) return "hours";
  if (/day|days/i.test(text)) return "days";
  if (/month|months/i.test(text)) return "months";
  if (/year|years/i.test(text)) return "years";
  if (/badge|employee|people|count/i.test(text)) return "count";
  return undefined;
}

function inferValue(text: string) {
  const match = text.match(/\d+(?:[.,]\d+)?/);
  return match ? match[0].replace(",", ".") : undefined;
}

function inferDateRange(text: string) {
  const years = [...new Set((text.match(/\b(?:19|20)\d{2}\b/g) ?? []).map((n) => n.slice(0, 4)))];
  if (!years.length) return { validFrom: undefined, validTo: undefined };
  return { validFrom: years[0], validTo: years[years.length - 1] };
}

function inferSubject(doc: Doc, text: string) {
  const section = text.split(":")[0]?.trim();
  if (section && /[A-Za-z]/.test(section) && section.length > 2) return section.replace(/^[-*\d.\s]+/, "");
  if (doc.title) return doc.title;
  return "Policy fact";
}

export function extractFactGraph(doc: Doc): FactRecord[] {
  return extractFacts(doc.content).slice(0, 12).map((fact) => {
    const value = inferValue(fact.text);
    const dates = inferDateRange(fact.text);
    const status = doc.status === "Completed" ? "active" : doc.status === "To be reviewed" ? "review" : "draft";
    return {
      subject: inferSubject(doc, fact.text),
      value: value ?? fact.text,
      unit: inferUnit(fact.text),
      country: doc.location,
      office: doc.location,
      teamId: doc.teamId,
      validFrom: dates.validFrom,
      validTo: dates.validTo,
      sourceDocId: doc.id,
      sourceDocTitle: doc.title,
      approvalStatus: status,
      confidence: status === "active" ? 0.9 : status === "review" ? 0.65 : 0.45,
      lineNo: fact.lineNo,
      rawText: fact.text,
    };
  });
}

export function extractVersionHistory(doc: Doc): VersionEvent[] {
  const rows = loadHistory([doc.id]).get(doc.id) ?? [];
  return rows.map((entry) => ({
    at: entry.at,
    personId: entry.personId,
    summary: entry.content.slice(0, 120) || "Version snapshot",
    contentPreview: entry.content.slice(0, 160) || "No content snapshot available",
  }));
}

export function buildGovernanceSnapshot(db: Db, doc: Doc): GovernanceSnapshot {
  const overridesMade = db.overrides.filter((o) => o.docId === doc.id);
  const overridesAgainst = db.overrides.filter((o) => o.existingDocId === doc.id);
  const history = extractVersionHistory(doc);
  const factGraph = extractFactGraph(doc);

  const governanceScore = Math.max(
    0,
    Math.min(
      100,
      50 + (doc.status === "Completed" ? 25 : doc.status === "To be reviewed" ? 10 : 0) + (doc.verifications.length ? 10 : 0) + (history.length > 1 ? 10 : 0) - overridesMade.length * 10 - overridesAgainst.length * 12,
    ),
  );

  return {
    score: governanceScore,
    facts: factGraph,
    versionHistory: history,
    overrideSummary: {
      made: overridesMade.length,
      against: overridesAgainst.length,
      latestReason: overridesMade[overridesMade.length - 1]?.reason ?? null,
    },
    signals: [
      ...(doc.status === "Completed" ? ["Approved for active use"] : ["Still in review"]),
      ...(doc.verifications.length ? [`Verified ${doc.verifications.length} time${doc.verifications.length === 1 ? "" : "s"}`] : ["No verification recorded"]),
      ...(history.length > 1 ? [`${history.length} version snapshots tracked`] : ["No historical versioning yet"]),
      ...(overridesMade.length ? [`Saved despite ${overridesMade.length} conflict override${overridesMade.length === 1 ? "" : "s"}`] : ["No overrides recorded"]),
    ],
  };
}
