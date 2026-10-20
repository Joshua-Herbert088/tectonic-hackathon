import { canSee, HIDDEN_TITLE, redactConflicts } from "./access";
import { checkConflicts, extractFacts } from "./conflicts";
import { stripLinks } from "./lexicon";
import { timeAgo } from "./time";
import type { AnswerView, Db, Doc, Doubt, Person } from "./types";

/** A markdown line as the reader sees it. */
function plain(line: string) {
  const t = line.trim();
  if (t.startsWith("|")) return t.split("|").slice(1, -1).map((c) => c.trim()).filter(Boolean).join(" · ").replace(/\*\*/g, "");
  return t.replace(/^#+\s*/, "").replace(/^(?:[-*>]|\d+\.)\s+/, "").replace(/\*\*/g, "");
}

/**
 * Doubts that need no Jev call: lines that only mention past years, lines involved in a conflict
 * someone overrode, and lines a colleague contradicted when answering a question (answers.ts).
 * Stored overrides and answers are matched on the line's text, since the document may have been edited
 * since; if the line is gone, so is the doubt.
 */
export function lineDoubts(db: Db, doc: Doc, now = Date.now(), answers: AnswerView[] = [], viewer?: Person): Doubt[] {
  // The other side of an override is named only when the viewer may see it.
  const hidden = (d: Doc | undefined) => !!d && !!viewer && !canSee(d, viewer);
  // Link addresses (source citations) aren't text: their ids must not look like years.
  const lines = stripLinks(doc.content).split("\n");
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
      text: `Saved despite contradicting “${hidden(other) ? HIDDEN_TITLE : o.existingTitle}” – ${name(o.personId)} overrode it ${timeAgo(o.at, now)}: “${o.reason}”`,
      source: other && !hidden(other) ? { ...sourceOf(other), lineNo: o.existingLineNo, lineText: o.existingLineText } : undefined,
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
      text: `“${hidden(other) ? HIDDEN_TITLE : other.title}” says otherwise – ${name(o.personId)} saved it anyway ${timeAgo(o.at, now)}`,
      source: hidden(other) ? undefined : { ...sourceOf(other), lineNo: o.lineNo, lineText: o.lineText },
    });
  }
  for (const a of answers.filter((a) => a.conflict?.docId === doc.id)) {
    const lineNo = lineOf(a.conflict!.lineText);
    if (!lineNo) continue;
    out.push({
      key: `q${a.id}`,
      lineNo,
      lineText: plain(lines[lineNo - 1]),
      tone: "bad",
      kind: "answer",
      text: `${name(a.answererId)} answered ${a.askerId ? name(a.askerId) : "a colleague"} differently ${a.source === "board" ? "on the board" : "in chat"} ${timeAgo(a.answeredAt, now)} – one of them is out of date`,
      answer: { href: a.href, line: a.conflict!.answerLine },
    });
  }
  return out;
}

/** Lines Jev (or the conflict rules, without Jev) finds contradicting other documents. Slow (Jev calls), so fetched separately from the page. */
export async function contradictionDoubts(db: Db, doc: Doc, viewer: Person): Promise<Doubt[]> {
  // Contradictions with documents the viewer may not see still show, without what they say.
  const check = redactConflicts(db, await checkConflicts(db, { title: doc.title, content: doc.content, locations: doc.locations, teamId: doc.teamId, docId: doc.id, confidential: doc.confidential }), viewer);
  // Conflicts already overridden against this document are shown by lineDoubts.
  const known = new Set(db.overrides.filter((o) => o.existingDocId === doc.id).map((o) => `${o.docId}|${o.lineText}`));
  // Shown as the reader sees it: source citations without their link addresses.
  const lines = stripLinks(doc.content).split("\n");
  return [...check.hard, ...check.possible]
    .filter((c) => !known.has(`${c.existing.docId}|${c.existing.lineText}`))
    .map((c) => ({
      key: `c${c.key}`,
      lineNo: c.lineNo,
      lineText: plain(lines[c.lineNo - 1] ?? c.lineText),
      tone: c.severity === "hard" ? ("bad" as const) : ("warn" as const),
      kind: "contradiction" as const,
      text: `${c.severity === "hard" ? "Contradicts" : "May contradict"} “${c.existing.title}” (${check.method === "rules" ? "conflict rules" : `${Math.round(c.probability * 100)}% sure`})`,
      // No source for a document the viewer may not see (redacted: no id).
      source: c.existing.docId ? c.existing : undefined,
    }));
}

function sourceOf(d: Doc) {
  return { docId: d.id, title: d.title, locations: d.locations, teamId: d.teamId, status: d.status, updatedAt: d.updatedAt, ownerId: d.ownerId };
}
