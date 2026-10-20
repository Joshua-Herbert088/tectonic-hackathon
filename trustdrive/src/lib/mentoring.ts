import { interpret } from "./expertise";
import { fold } from "./lexicon";
import { taxonomyOf } from "./taxonomy";
import type { ActivityEvent, Conversation, Db, Doc, Person } from "./types";

/**
 * Buddy system: a mentor sees what their mentee asked, searched for and opened since they became
 * their mentor, grouped by the department it's about, so they can step in where the newcomer is
 * struggling without anyone being notified. Everything here is computed from what was recorded:
 * Questions in Ask, drive searches, documents opened, and questions the mentee wrote to
 * colleagues in email or Teams.
 */

/** Opening the same document this often suggests it isn't giving them the answer. */
export const REPEAT_OPENS = 3;
/** Below this, the mentee can't rely on what they read (their own trust score). */
const LOW_TRUST = 50;
/** An area is highlighted when it adds up to this much and has at least two questions or failed searches. */
const STRUGGLE_WEIGHT = 6;

const WEIGHT = { question: 3, failedSearch: 2, search: 1, open: 1, repeatedDoc: 2, lowTrustDoc: 1 };

export interface MenteeQuestion {
  kind: "ask" | "message";
  at: string;
  text: string;
  /** Team the question is about, when it could be told. */
  teamId?: string;
  /** Topics and clients recognised in it. */
  about: string[];
  /** For messages: the conversation and the colleagues it went to. */
  conversationId?: string;
  to?: string[];
}

export interface MenteeSearch {
  at: string;
  query: string;
  results: number;
  teamId?: string;
}

export interface MenteeRead {
  docId: string;
  title: string;
  teamId: string;
  opens: number;
  lastAt: string;
  /** The mentee's own trust score for it, when they have one. */
  score?: number;
}

export interface StruggleArea {
  /** The department (team) the activity is about; null when it couldn't be told. */
  teamId: string | null;
  questions: number;
  searches: number;
  failedSearches: number;
  opens: number;
  /** Documents opened at least REPEAT_OPENS times. */
  repeated: { docId: string; title: string; opens: number }[];
  /** Documents they opened that score below 50 for them. */
  lowTrust: { docId: string; title: string; score: number }[];
  weight: number;
  struggling: boolean;
  /** Plain reasons, for the mentor ("2 searches found nothing"). */
  reasons: string[];
  /** The topic that comes up most, to look up in Ask. */
  topTopic?: { id: string; label: string };
  /** Trusted documents in this area they haven't opened yet: something to point them to. */
  startingPoints: { docId: string; title: string; score: number }[];
  lastAt: string;
}

export interface MenteeView {
  since: string;
  areas: StruggleArea[];
  questions: MenteeQuestion[];
  searches: MenteeSearch[];
  reads: MenteeRead[];
  counts: { questions: number; searches: number; failedSearches: number; opens: number; documents: number };
}

/** The sentences of a message that ask something. */
export function questionsIn(body: string) {
  return body
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3 && s.endsWith("?"));
}

/**
 * Which team a piece of text is about. Each topic or client it names votes for the teams that maintain
 * its documents, as a share (so a topic only one team writes about counts fully, however few documents
 * it has). Without a topic or client, its plain words vote by how rare they are across documents.
 */
function areaOfText(db: Db, docs: Doc[], text: string) {
  const it = interpret(db, text);
  const tax = taxonomyOf(db.terms);
  const votes = new Map<string, number>();
  const share = (teams: string[], weight = 1) => {
    for (const t of teams) votes.set(t, (votes.get(t) ?? 0) + weight / teams.length);
  };
  for (const t of it.topics) share(docs.filter((d) => d.tags.includes(t.id) || d.tags.some((tag) => tax.topic.get(tag)?.parent === t.id)).map((d) => d.teamId));
  for (const c of it.clients) {
    const client = db.clients.find((x) => x.id === c.id);
    if (client) share([client.teamId], 2);
  }
  const structured = votes.size > 0;
  if (!structured) {
    const texts = docs.map((d) => ({ teamId: d.teamId, text: fold(`${d.title} ${d.tags.join(" ")} ${d.content}`) }));
    for (const w of it.words) {
      const hits = texts.filter((t) => t.text.includes(w));
      // A word in most documents says nothing about where the question belongs.
      if (hits.length && hits.length <= docs.length / 4) share(hits.map((h) => h.teamId), 1 / hits.length);
    }
  }
  const teamId = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { teamId, structured, topics: it.topics, about: [...it.topics.map((t) => t.label), ...it.clients.map((c) => c.name)] };
}

/** Everything a mentor sees about one mentee, from what was recorded since `since`. */
export function menteeView(
  db: Db,
  mentee: Person,
  events: ActivityEvent[],
  conversations: Conversation[],
  scoreOf: (docId: string) => number | undefined,
  since: string,
): MenteeView {
  const docs = db.docs;
  const tax = taxonomyOf(db.terms);
  const docById = new Map(docs.map((d) => [d.id, d]));
  const recent = events.filter((e) => e.at >= since);
  const topicVotes = new Map<string, Map<string, { label: string; n: number }>>();
  const voteTopic = (teamId: string | undefined, t: { id: string; label: string }) => {
    if (!teamId) return;
    const m = topicVotes.get(teamId) ?? new Map();
    m.set(t.id, { label: t.label, n: (m.get(t.id)?.n ?? 0) + 1 });
    topicVotes.set(teamId, m);
  };

  const questions: MenteeQuestion[] = [];
  const searches: MenteeSearch[] = [];
  for (const e of recent) {
    if (e.kind === "ask" && e.query) {
      const a = areaOfText(db, docs, e.query);
      a.topics.forEach((t) => voteTopic(a.teamId, t));
      questions.push({ kind: "ask", at: e.at, text: e.query, teamId: a.teamId, about: a.about });
    }
    if (e.kind === "search" && e.query) {
      const a = areaOfText(db, docs, e.query);
      a.topics.forEach((t) => voteTopic(a.teamId, t));
      searches.push({ at: e.at, query: e.query, results: e.results ?? 0, teamId: a.teamId });
    }
  }

  // Questions they wrote to colleagues (not client conversations).
  for (const c of conversations) {
    if (c.clientId) continue;
    for (const m of c.messages) {
      if (m.personId !== mentee.id || m.sentAt < since) continue;
      const asked = questionsIn(m.body);
      if (!asked.length) continue;
      const text = asked.join(" ");
      const colleagues = c.participants.filter((p) => p.personId && p.personId !== mentee.id).map((p) => db.people.find((x) => x.id === p.personId)).filter((p): p is Person => !!p);
      const a = areaOfText(db, docs, `${c.title} ${text}`);
      a.topics.forEach((t) => voteTopic(a.teamId, t));
      // Asking someone from another department is about that department, unless it names a topic or client.
      const otherDepartment = colleagues.find((p) => p.teamId !== mentee.teamId)?.teamId;
      const teamId = (a.structured ? a.teamId : (otherDepartment ?? a.teamId)) ?? colleagues[0]?.teamId;
      questions.push({ kind: "message", at: m.sentAt, text, teamId, about: a.about, conversationId: c.id, to: colleagues.map((p) => p.name) });
    }
  }
  questions.sort((a, b) => b.at.localeCompare(a.at));

  const readMap = new Map<string, MenteeRead>();
  for (const e of recent) {
    if (e.kind !== "open" || !e.docId) continue;
    const d = docById.get(e.docId);
    if (!d) continue;
    const r = readMap.get(d.id) ?? { docId: d.id, title: d.title, teamId: d.teamId, opens: 0, lastAt: e.at, score: scoreOf(d.id) };
    r.opens += 1;
    if (e.at > r.lastAt) r.lastAt = e.at;
    readMap.set(d.id, r);
    for (const t of d.tags) {
      const term = tax.topic.get(t);
      if (term) voteTopic(d.teamId, { id: term.id, label: term.label });
    }
  }
  const reads = [...readMap.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));

  const keys = new Set<string | null>([...questions.map((q) => q.teamId ?? null), ...searches.map((s) => s.teamId ?? null), ...reads.map((r) => r.teamId)]);
  const areas: StruggleArea[] = [...keys].map((teamId) => {
    const inArea = <T extends { teamId?: string }>(xs: T[]) => xs.filter((x) => (x.teamId ?? null) === teamId);
    const q = inArea(questions);
    const s = inArea(searches);
    const failed = s.filter((x) => x.results === 0);
    const r = reads.filter((x) => (teamId === null ? false : x.teamId === teamId));
    const opens = r.reduce((n, x) => n + x.opens, 0);
    const repeated = r.filter((x) => x.opens >= REPEAT_OPENS).map((x) => ({ docId: x.docId, title: x.title, opens: x.opens }));
    const lowTrust = r.filter((x) => x.score !== undefined && x.score < LOW_TRUST).map((x) => ({ docId: x.docId, title: x.title, score: x.score! }));
    const weight =
      q.length * WEIGHT.question + failed.length * WEIGHT.failedSearch + (s.length - failed.length) * WEIGHT.search + opens * WEIGHT.open + repeated.length * WEIGHT.repeatedDoc + lowTrust.length * WEIGHT.lowTrustDoc;
    const struggling = teamId !== null && weight >= STRUGGLE_WEIGHT && q.length + failed.length >= 2;
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const reasons = [
      q.length > 0 && plural(q.length, "question", "questions"),
      failed.length > 0 && `${plural(failed.length, "search", "searches")} found nothing`,
      ...repeated.map((x) => `opened “${x.title}” ${x.opens} times`),
      ...lowTrust.map((x) => `read “${x.title}”, which scores ${x.score} for them`),
    ].filter((x): x is string => !!x);
    const topTopic = teamId ? [...(topicVotes.get(teamId) ?? new Map()).entries()].sort((a, b) => b[1].n - a[1].n).map(([id, v]) => ({ id, label: v.label }))[0] : undefined;
    const opened = new Set(r.map((x) => x.docId));
    const startingPoints = teamId
      ? docs
          .filter((d) => d.teamId === teamId && !opened.has(d.id) && !d.supersededById)
          .map((d) => ({ docId: d.id, title: d.title, score: scoreOf(d.id) ?? -1 }))
          .filter((d) => d.score >= 75)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
      : [];
    const lastAt = [...q.map((x) => x.at), ...s.map((x) => x.at), ...r.map((x) => x.lastAt)].sort().at(-1) ?? since;
    return { teamId, questions: q.length, searches: s.length, failedSearches: failed.length, opens, repeated, lowTrust, weight, struggling, reasons, topTopic, startingPoints, lastAt };
  });
  areas.sort((a, b) => Number(b.struggling) - Number(a.struggling) || b.weight - a.weight);

  return {
    since,
    areas,
    questions,
    searches: searches.sort((a, b) => b.at.localeCompare(a.at)),
    reads,
    counts: {
      questions: questions.length,
      searches: searches.length,
      failedSearches: searches.filter((s) => s.results === 0).length,
      opens: reads.reduce((n, r) => n + r.opens, 0),
      documents: reads.length,
    },
  };
}

/** Why `mentorId` can't mentor `person`, or null when they can. */
export function mentorProblem(db: Db, person: Person | undefined, mentorId: string): string | null {
  const mentor = db.people.find((p) => p.id === mentorId);
  if (!person) return "There's no such colleague.";
  if (!mentor) return "There's no such colleague to be the mentor.";
  if (mentor.id === person.id) return "Someone can't mentor themselves.";
  if (!mentor.active) return `${mentor.name} has left the company.`;
  if (!person.active) return `${person.name} has left the company.`;
  if (mentor.mentorId === person.id) return `${person.name} already mentors ${mentor.name}.`;
  return null;
}
