import { publicHref } from "./answerDoc";
import { overlaps } from "./appliesTo";
import { extractFacts } from "./conflicts";
import { answersToCheckForEdits, insertNotifications, insertSuggestedEdits, loadAnswers, loadSuggestedEdits, loadWorld, markEditsChecked, updateSuggestedEdit, type NewSuggestedEdit } from "./db";
import { documentedIn } from "./handoverDraft";
import { HttpError } from "./http";
import { fold } from "./lexicon";
import { taxonomyOf } from "./taxonomy";
import type { Answer, Db, Doc, Person, SuggestedEdit } from "./types";

/**
 * Keeping documents up to date from the answers people give. When a shared answer (answers.ts) says
 * something a document doesn't, TrustDrive drafts the change:
 * - replace: the answer contradicts a line. Where it's clear which figure changed ("100 hours" →
 *   "120 hours"), only that figure is swapped; otherwise the line becomes the answer's sentence.
 * - add: the answer isn't written down anywhere yet, so it's added to the document on its topic and
 *   country, quoted, with a link to where it was said.
 * Nothing changes by itself. The person who answered proposes it (they can reword it first), and the
 * document's owner accepts or rejects it; when they're the same person, one click does it. Accepting
 * saves through the usual checks (conflicts, duplicates, edit history, notifications), so the trust
 * score updates like after any edit. With nobody owning the document, the person who answered applies it.
 * Drafting needs no Jev: Jev answers with scores and yes/no, not text, so changes are exact swaps and quotes.
 */

/** A figure with what it counts ("120 hours", "€0.45/km", "+50%"); years aren't figures that get swapped. */
const FIGURE = /(\d+(?:[.,]\d+)?)\s*(%|€|\/?\s?[a-zà-ÿ]+)?/gi;
const YEAR = /^(19|20)\d\d$/;
const unitOf = (u: string | undefined) => fold(u ?? "").replace(/^\/\s?/, "").replace(/s$/, "");
const wordsNear = (text: string, at: number, length: number) =>
  new Set(fold(`${text.slice(Math.max(0, at - 30), at)} ${text.slice(at + length, at + length + 30)}`).split(/[^a-z0-9]+/).filter((w) => w.length > 2));

function figures(text: string) {
  return [...text.matchAll(FIGURE)].filter((m) => !YEAR.test(m[1])).map((m) => ({ n: m[1], unit: unitOf(m[2]), at: m.index!, length: m[0].length }));
}

/**
 * The document's line with the one figure the answer changed swapped for the answer's, or null when it
 * isn't clear which one: the same kind of figure ("hours"), and of several, the one whose surrounding
 * words match the answer's ("max … per calendar year").
 */
export function swapFigure(line: string, answerLine: string): string | null {
  const mine = figures(line);
  const theirs = figures(answerLine).filter((a) => !mine.some((m) => m.n === a.n && m.unit === a.unit));
  if (theirs.length !== 1) return null;
  const a = theirs[0];
  const candidates = mine.filter((m) => m.unit === a.unit && m.n !== a.n);
  if (!candidates.length) return null;
  const near = wordsNear(answerLine, a.at, a.length);
  const scored = candidates.map((m) => ({ m, s: [...wordsNear(line, m.at, m.length)].filter((w) => near.has(w)).length })).sort((x, y) => y.s - x.s);
  if (scored.length > 1 && scored[0].s === scored[1].s) return null;
  const { m } = scored[0];
  const start = m.at + line.slice(m.at).indexOf(m.n);
  return line.slice(0, start) + a.n + line.slice(start + m.n.length);
}

const isTableRow = (line: string) => line.trim().startsWith("|");
/** "- ", "1. ", "> " in front of a line, kept when the line is rewritten. */
const prefixOf = (line: string) => line.match(/^\s*(?:[-*>]|\d+\.)\s+/)?.[0] ?? "";
const source = (a: Answer) => ` ([source](${publicHref(a)} "${a.source === "board" ? "Answered on the board" : "Answered in a chat"}"))`;
const oneLine = (text: string) => text.split("\n").join(" ");

/** The document an answer adds to: same sub-topic and country, not a table, not replaced. */
function targetFor(db: Db, a: Answer): Doc | undefined {
  const tax = taxonomyOf(db.terms);
  const leaves = tax.mostSpecific(a.topics).filter((t) => tax.topic.get(t)?.parent);
  if (!leaves.length) return undefined;
  const active = (id: string | null) => !!id && db.people.some((p) => p.id === id && p.active);
  const words = new Set(fold(a.question).split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  return db.docs
    .filter((d) => !d.supersededById && d.kind === "doc" && overlaps(a.locations, d.locations) && d.tags.some((t) => leaves.includes(t)))
    .map((d) => ({ d, s: d.tags.filter((t) => leaves.includes(t)).length * 3 + (active(d.ownerId) ? 1 : 0) + fold(d.title).split(/[^a-z0-9]+/).filter((w) => words.has(w)).length }))
    .sort((x, y) => y.s - x.s)[0]?.d;
}

/** What an answer suggests to the drive, if anything. */
export function draftFor(db: Db, a: Answer): Omit<NewSuggestedEdit, "status"> | null {
  if (a.conflict?.severity === "hard") {
    const doc = db.docs.find((d) => d.id === a.conflict!.docId);
    const lineNo = doc && extractFacts(doc.content).find((f) => f.text === a.conflict!.lineText)?.lineNo;
    const line = doc && lineNo ? doc.content.split("\n")[lineNo - 1] : undefined;
    if (!doc || !line) return null;
    const swapped = swapFigure(line, a.conflict.answerLine);
    // A table row only gets a figure swapped: a sentence (or a link) would break the table.
    if (isTableRow(line)) return swapped ? { answerId: a.id, docId: doc.id, kind: "replace", oldLine: line, newLine: swapped } : null;
    return { answerId: a.id, docId: doc.id, kind: "replace", oldLine: line, newLine: `${swapped ?? `${prefixOf(line)}${a.conflict.answerLine}`}${source(a)}` };
  }
  // Something to add: a figure or a real explanation, not yet written down anywhere.
  const text = oneLine(a.answer);
  if (!/\d/.test(text) && text.split(/\s+/).length < 8) return null;
  if (documentedIn(db, text, { name: a.question, location: a.locations[0] ?? "Global" }, a.clientId)) return null;
  const doc = targetFor(db, a);
  if (!doc) return null;
  const qa = /\*\*Q:/.test(doc.content);
  return { answerId: a.id, docId: doc.id, kind: "add", newLine: qa ? `**Q: ${a.question}**\nA: ${text}${source(a)}` : `- ${text}${source(a)}` };
}

/** Who decides on a change to a document: its owner while they're at the company, else the person who answered. */
function deciderOf(db: Db, doc: Doc | undefined, a: Answer) {
  const owner = doc?.ownerId && db.people.find((p) => p.id === doc.ownerId && p.active);
  return owner ? owner.id : a.answererId;
}

/** The document with the change made, or null when the line it changes isn't there any more. */
export function applyEdit(content: string, e: Pick<SuggestedEdit, "kind" | "oldLine" | "newLine">) {
  if (e.kind === "add") return `${content.trimEnd()}\n\n${e.newLine}\n`;
  const lines = content.split("\n");
  const i = lines.indexOf(e.oldLine ?? "");
  if (i < 0) return null;
  lines[i] = e.newLine;
  return lines.join("\n");
}

/**
 * Drafts changes for shared answers that weren't looked at yet. Cheap when there's nothing new, so it
 * runs after every capture (answers.ts). The person who answered hears about a draft; when they own the
 * document themselves, it goes straight to them to apply.
 */
export async function draftEdits() {
  const ids = await answersToCheckForEdits();
  if (!ids.length) return;
  const [db, answers, existing] = await Promise.all([loadWorld(), loadAnswers(), loadSuggestedEdits()]);
  const drafts = answers
    .filter((a) => ids.includes(a.id) && !existing.some((e) => e.answerId === a.id))
    .flatMap((a) => {
      const d = draftFor(db, a);
      if (!d) return [];
      const doc = db.docs.find((x) => x.id === d.docId);
      return [{ ...d, status: deciderOf(db, doc, a) === a.answererId ? ("proposed" as const) : ("draft" as const), answer: a, title: doc?.title ?? d.docId }];
    });
  await insertSuggestedEdits(drafts.map(({ answer: _a, title: _t, ...d }) => d));
  await insertNotifications(
    drafts.map((d) => ({ recipientId: d.answer.answererId, actorId: d.answer.answererId, kind: "suggestion_draft" as const, docId: d.docId, docTitle: d.title, changes: [{ lineNo: 0, before: d.oldLine ?? null, after: d.newLine }], reason: d.answer.question })),
  );
  await markEditsChecked(ids);
}

/** A suggested edit with what the viewer needs to see and decide on it. */
export interface EditView extends SuggestedEdit {
  docTitle: string;
  ownerId: string | null;
  /** Who accepts it: the owner, or (no active owner) the person who answered. */
  deciderId: string;
  answererId: string;
  question: string;
  answerHref: string;
  /** For a replacement, the line isn't in the document any more. */
  outdated: boolean;
}

function viewOfEdit(db: Db, e: SuggestedEdit, a: Answer): EditView {
  const doc = db.docs.find((d) => d.id === e.docId);
  return {
    ...e,
    docTitle: doc?.title ?? e.docId,
    ownerId: doc?.ownerId ?? null,
    deciderId: deciderOf(db, doc, a),
    answererId: a.answererId,
    question: a.question,
    answerHref: publicHref(a),
    outdated: e.kind === "replace" && !!doc && !doc.content.split("\n").includes(e.oldLine ?? ""),
  };
}

async function editViews(by: Parameters<typeof loadSuggestedEdits>[0] = {}) {
  const [db, edits, answers] = await Promise.all([loadWorld(), loadSuggestedEdits(by), loadAnswers()]);
  return edits.flatMap((e) => {
    const a = answers.find((x) => x.id === e.answerId);
    return a ? [viewOfEdit(db, e, a)] : [];
  });
}

/** What's waiting for the viewer: drafts of their answers to propose, and proposals for documents they decide on. */
export async function editsFor(viewer: Person) {
  const views = await editViews();
  return {
    toPropose: views.filter((e) => e.status === "draft" && e.answererId === viewer.id && !e.outdated),
    toReview: views.filter((e) => e.status === "proposed" && e.deciderId === viewer.id && !e.outdated),
  };
}

/** Changes waiting on a document, for its page. */
export async function editsForDoc(docId: string) {
  return (await editViews({ docId })).filter((e) => (e.status === "draft" || e.status === "proposed") && !e.outdated);
}

const clean = (text: string | undefined, fallback: string) => {
  const t = text?.replace(/\r\n/g, "\n").trim();
  return t ? t : fallback;
};

/**
 * Decides on a suggested edit:
 * - propose / dismiss: the person who answered, on a draft (propose may reword it)
 * - accept / reject: whoever decides on the document (accept may reword it, and is saved like any edit:
 *   a hard conflict or a duplicate comes back as a 409 for the usual dialogs)
 */
export async function decideEdit(
  viewer: Person,
  id: number,
  input: { action: "propose" | "dismiss" | "accept" | "reject"; text?: string; reason?: string; override?: { reason: string }; acknowledgeSimilar?: boolean },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const [e] = await editViews({ ids: [id] });
  if (!e) throw new HttpError(404, "Not found");
  const now = new Date().toISOString();
  const tell = (recipientId: string, kind: "suggestion" | "suggestion_decided", reason: string, newLine = e.newLine) =>
    recipientId === viewer.id
      ? Promise.resolve()
      : insertNotifications([{ recipientId, actorId: viewer.id, kind, docId: e.docId, docTitle: e.docTitle, changes: [{ lineNo: 0, before: e.oldLine ?? null, after: newLine }], reason }]);

  if (input.action === "propose" || input.action === "dismiss") {
    if (e.answererId !== viewer.id) throw new HttpError(403, "Only the person who answered can propose this.");
    if (e.status !== "draft") throw new HttpError(409, "This was already decided.");
    if (input.action === "dismiss") {
      await updateSuggestedEdit(id, { status: "dismissed", decidedById: viewer.id, decidedAt: now });
      return { status: 200, body: { status: "dismissed" } };
    }
    const newLine = clean(input.text, e.newLine);
    await updateSuggestedEdit(id, { status: "proposed", newLine });
    await tell(e.deciderId, "suggestion", e.question, newLine);
    return { status: 200, body: { status: "proposed" } };
  }

  if (e.deciderId !== viewer.id) throw new HttpError(403, "Only the document's owner can decide on this.");
  if (e.status !== "proposed") throw new HttpError(409, "This was already decided.");
  if (input.action === "reject") {
    const reason = input.reason?.trim() || undefined;
    await updateSuggestedEdit(id, { status: "rejected", decidedById: viewer.id, decidedAt: now, reason });
    await tell(e.answererId, "suggestion_decided", reason ? `Not changed: ${reason}` : "Not changed");
    return { status: 200, body: { status: "rejected" } };
  }

  const newLine = clean(input.text, e.newLine);
  const doc = (await loadWorld()).docs.find((d) => d.id === e.docId);
  const content = doc && applyEdit(doc.content, { ...e, newLine });
  if (!content) throw new HttpError(409, "The line this changes isn't in the document any more. Open the document to update it by hand.");
  // Loaded here: the service captures answers, which drafts edits, so a top-level import would be circular.
  const { editDocument } = await import("./service");
  const saved = await editDocument(viewer, e.docId, { content, override: input.override, acknowledgeSimilar: input.acknowledgeSimilar });
  if (saved.status !== 200) return saved;
  await updateSuggestedEdit(id, { status: "accepted", newLine, decidedById: viewer.id, decidedAt: now });
  await tell(e.answererId, "suggestion_decided", "Changed", newLine);
  return { status: 200, body: { status: "accepted", docId: e.docId } };
}
