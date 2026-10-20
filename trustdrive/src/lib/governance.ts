import { formatLocations } from "./appliesTo";
import { extractFacts } from "./conflicts";
import { loadHistory } from "./db";
import { lineDiff } from "./diff";
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

/** The fact's value: the number next to a unit (€, %, km) if any, else the first number that isn't a year. */
function inferValue(text: string) {
  const tokens = [...text.matchAll(/\d+(?:[.,\s\u00a0\u202f]\d{3})*(?:[.,]\d+)?/g)].map((m) => ({ v: m[0], start: m.index, end: m.index + m[0].length }));
  const nextToUnit = (t: (typeof tokens)[number]) => /€\s?$/.test(text.slice(Math.max(0, t.start - 2), t.start)) || /^\s?(?:€|%|km\b)/i.test(text.slice(t.end, t.end + 3));
  const isYear = (v: string) => /^(?:19|20)\d{2}$/.test(v);
  return (tokens.find(nextToUnit) ?? tokens.find((t) => !isYear(t.v)) ?? tokens[0])?.v;
}

function inferDateRange(text: string) {
  const years = [...new Set((text.match(/\b(?:19|20)\d{2}\b/g) ?? []).map((n) => n.slice(0, 4)))];
  if (!years.length) return { validFrom: undefined, validTo: undefined };
  return { validFrom: years[0], validTo: years[years.length - 1] };
}

function inferSubject(doc: Doc, text: string) {
  // Table rows arrive as "Header: value; Header: value" – the row is named by its first cell.
  if (text.includes("; ")) return text.split("; ")[0].split(": ").slice(1).join(": ") || doc.title;
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
      country: formatLocations(doc.locations),
      office: formatLocations(doc.locations),
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

const MAX_VERSION_CHANGES = 40;

/** Every saved version, newest first, with what changed compared to the version before it. */
export async function extractVersionHistory(db: Db, doc: Doc): Promise<VersionEvent[]> {
  const rows = (await loadHistory([doc.id])).get(doc.id) ?? [];
  const teamName = (id: string) => db.teams.find((t) => t.id === id)?.name ?? id;
  return rows
    .map((entry, i) => {
      const before = rows[i - 1];
      const prev = before ? before.content.split("\n") : [];
      const next = entry.content.split("\n");
      const changes: VersionEvent["changes"] = [];
      for (const o of lineDiff(prev, next)) {
        if (o.op === "delete" && prev[o.a].trim()) changes.push({ kind: "removed", text: prev[o.a] });
        if (o.op === "insert" && next[o.b].trim()) changes.push({ kind: "added", text: next[o.b] });
      }
      const added = changes.filter((c) => c.kind === "added");
      const removed = changes.length - added.length;
      const metaChanges = before
        ? [
            before.title !== entry.title && `Renamed from “${before.title}”`,
            before.status !== entry.status && `Status ${before.status} → ${entry.status}`,
            before.location !== entry.location && `Location ${before.location} → ${entry.location}`,
            before.teamId !== entry.teamId && `Team ${teamName(before.teamId)} → ${teamName(entry.teamId)}`,
          ].filter((m): m is string => !!m)
        : [];
      const summary = !before ? `Created with ${added.length} lines` : changes.length ? `+${added.length} −${removed} lines` : metaChanges.join(" · ") || "Saved without changes";
      return {
        at: entry.at,
        personId: entry.personId,
        summary,
        contentPreview: added[0]?.text.replace(/^[#\s\-*>|]+|[\s|]+$/g, "").replace(/\s*\|\s*/g, " · ").slice(0, 160) ?? "",
        // The first version is the whole document, so there's nothing to compare it with.
        changes: before ? changes.slice(0, MAX_VERSION_CHANGES) : [],
        changeCount: before ? changes.length : 0,
        metaChanges,
      };
    })
    .reverse();
}

export async function buildGovernanceSnapshot(db: Db, doc: Doc): Promise<GovernanceSnapshot> {
  const overridesMade = db.overrides.filter((o) => o.docId === doc.id);
  const overridesAgainst = db.overrides.filter((o) => o.existingDocId === doc.id);
  const history = await extractVersionHistory(db, doc);
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
