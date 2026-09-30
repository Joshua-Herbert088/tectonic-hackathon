import { checkConflicts, extractFacts } from "./conflicts";
import { timeAgo } from "./time";
import type { Db, Doc, Doubt } from "./types";

/** A markdown line as the reader sees it. */
function plain(line: string) {
  const t = line.trim();
  if (t.startsWith("|")) return t.split("|").slice(1, -1).map((c) => c.trim()).filter(Boolean).join(" · ").replace(/\*\*/g, "");
  return t.replace(/^#+\s*/, "").replace(/^(?:[-*>]|\d+\.)\s+/, "").replace(/\*\*/g, "");
}

/**
 * Doubts that need no Jev call: lines that only mention past years, and lines involved in a conflict
 * someone overrode. Stored overrides are matched on the line's text, since the document may have been
 * edited since; if the line is gone, so is the doubt.
 */
export function lineDoubts(db: Db, doc: Doc, now = Date.now()): Doubt[] {
  const lines = doc.content.split("\n");
  const name = (id: string) => db.people.find((p) => p.id === id)?.name ?? "someone";
  const lineOf = (factText: string) => extractFacts(doc.content).find((f) => f.text === factText)?.lineNo;
  const out: Doubt[] = [];

  const year = new Date(now).getFullYear();
  lines.forEach((line, i) => {
    const years = [...new Set(line.match(/\b20[12]\d\b/g) ?? [])].map(Number).sort();
    if (years.length && years.every((y) => y < year - 1)) {
      out.push({ key: `y${i + 1}`, lineNo: i + 1, lineText: plain(line), tone: "warn", kind: "outdated", text: `Refers to ${years.join(", ")} – check it still applies in ${year}` });
    }
  });

  for (const o of db.overrides.filter((o) => o.docId === doc.id)) {
    const lineNo = lineOf(o.lineText);
    const other = db.docs.find((d) => d.id === o.existingDocId);
    if (!lineNo) continue;
    out.push({
      key: `o${o.id}`,
      lineNo,
      lineText: plain(lines[lineNo - 1]),
      tone: "warn",
      kind: "override",
      text: `Saved despite contradicting “${o.existingTitle}” – ${name(o.personId)} overrode it ${timeAgo(o.at, now)}: “${o.reason}”`,
      source: other && { ...sourceOf(other), lineNo: o.existingLineNo, lineText: o.existingLineText },
    });
  }
  for (const o of db.overrides.filter((o) => o.existingDocId === doc.id)) {
    const lineNo = lineOf(o.existingLineText);
    const other = db.docs.find((d) => d.id === o.docId);
    if (!lineNo || !other) continue;
    out.push({
      key: `a${o.id}`,
      lineNo,
      lineText: plain(lines[lineNo - 1]),
      tone: "bad",
      kind: "override",
      text: `“${other.title}” says otherwise – ${name(o.personId)} saved it anyway ${timeAgo(o.at, now)}`,
      source: { ...sourceOf(other), lineNo: o.lineNo, lineText: o.lineText },
    });
  }
  return out;
}

/** Lines Jev finds contradicting other documents. Slow (Jev calls), so fetched separately from the page. */
export async function contradictionDoubts(db: Db, doc: Doc): Promise<Doubt[]> {
  const check = await checkConflicts(db, { title: doc.title, content: doc.content, location: doc.location, teamId: doc.teamId, docId: doc.id });
  // Conflicts already overridden against this document are shown by lineDoubts.
  const known = new Set(db.overrides.filter((o) => o.existingDocId === doc.id).map((o) => `${o.docId}|${o.lineText}`));
  const lines = doc.content.split("\n");
  return [...check.hard, ...check.possible]
    .filter((c) => !known.has(`${c.existing.docId}|${c.existing.lineText}`))
    .map((c) => ({
      key: `c${c.key}`,
      lineNo: c.lineNo,
      lineText: plain(lines[c.lineNo - 1] ?? c.lineText),
      tone: c.severity === "hard" ? ("bad" as const) : ("warn" as const),
      kind: "contradiction" as const,
      text: `${c.severity === "hard" ? "Contradicts" : "May contradict"} “${c.existing.title}” (${Math.round(c.probability * 100)}% sure)`,
      source: c.existing,
    }));
}

function sourceOf(d: Doc) {
  return { docId: d.id, title: d.title, location: d.location, teamId: d.teamId, status: d.status, updatedAt: d.updatedAt, ownerId: d.ownerId };
}
