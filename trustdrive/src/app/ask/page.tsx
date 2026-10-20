"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AlreadyKnown, type Known } from "@/components/AlreadyKnown";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AppContext";
import { AnswerCard, EvidenceList } from "@/components/Expertise";
import { Avatar } from "@/components/TopBar";
import { ContactLinks } from "@/components/WhoToContact";
import type { ThreadSummary } from "@/lib/board";
import type { Expert } from "@/lib/expertise";
import { fold } from "@/lib/lexicon";
import { timeAgo } from "@/lib/time";
import type { AnswerView } from "@/lib/types";

type Result = Known | { suggestions: string[] };
type Board = { questions: ThreadSummary[]; fromChats: AnswerView[] };
type Tab = "asked" | "open" | "all" | "mine" | "chats";

/**
 * Ask: one place for a question. While it's typed, it's answered from what's already there, cheapest
 * first: answers given before, the documents it's about, and who knows (to ask one person directly).
 * Only if that isn't enough is it posted to the board, where the people who know most are asked for you.
 * Looking things up is private; posting is the only step others see. With nothing typed, it shows the
 * board: questions asked to you first.
 */
export default function AskPage() {
  return (
    <AppShell>
      <Suspense fallback={<main className="flex-1 rounded-2xl bg-white" />}>
        <AskView />
      </Suspense>
    </AppShell>
  );
}

function AskView() {
  const router = useRouter();
  const params = useSearchParams();
  const { viewerId } = useApp();
  const q = (params.get("q") ?? "").trim();
  const [draft, setDraft] = useState(q);
  // The box follows the link when it changes from elsewhere (back button), not while it's being typed in.
  const [sent, setSent] = useState(q);
  const [seen, setSeen] = useState(q);
  if (q !== seen) {
    setSeen(q);
    if (q !== sent) {
      setSent(q);
      setDraft(q);
    }
  }
  // Keyed by question and viewer: an answer for something else is never shown, even if it arrives late.
  const [result, setResult] = useState<{ key: string; data: Result } | null>(null);
  const [board, setBoard] = useState<{ viewerId: string; data: Board } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${viewerId}:${q}`;

  const send = (text: string) => {
    setSent(text.trim());
    router.replace(text.trim() ? `/ask?q=${encodeURIComponent(text.trim())}` : "/ask", { scroll: false });
  };
  const go = (text: string) => {
    setDraft(text);
    send(text);
  };

  // Typing updates the results once it pauses; Enter does it straight away.
  useEffect(() => {
    if (draft.trim() === q) return;
    const t = setTimeout(() => {
      setSent(draft.trim());
      router.replace(draft.trim() ? `/ask?q=${encodeURIComponent(draft.trim())}` : "/ask", { scroll: false });
    }, 600);
    return () => clearTimeout(t);
  }, [draft, q, router]);

  // The question, for the viewer's mentor (kept only if they have one). Results follow typing, so only a
  // question left standing for a moment counts, not every half-typed version of it.
  useEffect(() => {
    if (!q) return;
    const t = setTimeout(() => fetch("/api/activity", { method: "POST", body: JSON.stringify({ kind: "ask", query: q }) }).catch(() => {}), 3000);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/people?q=${encodeURIComponent(q)}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Could not search.");
        if (!cancelled) {
          setResult({ key, data: json });
          setError(null);
        }
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [q, key]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/board")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Board | null) => !cancelled && j && setBoard({ viewerId, data: j }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [viewerId]);

  const data = result?.key === key ? result.data : null;
  const boardData = board?.viewerId === viewerId ? board.data : null;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-4">
        <section className="rounded-2xl bg-white p-6">
          <h1 className="text-2xl text-slate-900">Ask</h1>
          <p className="mt-1 text-sm text-slate-600">
            Ask anything about how things work here, a client, or who to talk to. You get what&apos;s already known first: answers colleagues gave before, the documents it&apos;s about
            and who knows. Still stuck? Post it, and the people who know most are asked for you.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
            className="mt-4 flex gap-2"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. How do we pay overtime for part-timers in Belgium?"
              aria-label="What do you want to know?"
              autoFocus
              className="h-12 min-w-0 flex-1 rounded-full bg-[#e9eef6] px-5 text-base outline-none placeholder:text-slate-500 focus:bg-white focus:shadow-md"
            />
            <button type="submit" className="rounded-full bg-[#0b57d0] px-5 text-sm font-medium text-white hover:bg-[#0842a0]">Ask</button>
          </form>
          {data && "suggestions" in data && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {data.suggestions.map((s) => (
                <button key={s} onClick={() => go(s)} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 hover:bg-[#e8f0fe] hover:text-[#0b57d0]">{s}</button>
              ))}
            </div>
          )}
          {q && data && "query" in data && <Understood data={data} />}
        </section>

        {error && <section className="rounded-2xl bg-white p-6 text-sm text-red-700">{error}</section>}
        {q && !data && !error && <section className="rounded-2xl bg-white p-6 text-sm text-slate-500">Looking through answers, documents and who knows…</section>}
        {q && data && "query" in data && <Results data={data} q={q} board={boardData} />}
        {!q && <BoardFeed board={boardData} />}

        <p className="px-2 pb-4 text-[11px] leading-4 text-slate-500">
          Who knows is worked out from work people already do: owning a document, the part of its current text someone wrote, edits, verifications, exceptions they kept on purpose
          (with their reason), answers to colleagues&apos; questions and messages in client conversations. Reading a document or asking a question never counts. Evidence fades after
          three months: half as strong for every year after that. Answers from private chats are only used once the person who answered shares them, without who asked.
        </p>
      </div>
    </main>
  );
}

/** How the question was read, so a surprising answer can be traced back to it. */
function Understood({ data }: { data: Known }) {
  const { query: u, considered } = data;
  const chips = [
    ...u.topics.map((t) => ({ kind: "Topic", label: t.label })),
    ...u.clients.map((c) => ({ kind: "Client", label: c.name })),
    ...u.countries.map((c) => ({ kind: "Country", label: c })),
  ];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
      {chips.length > 0 ? (
        <>
          <span>Looking for</span>
          {chips.map((c) => (
            <span key={`${c.kind}:${c.label}`} className="rounded-full bg-[#e8f0fe] px-2.5 py-0.5 text-[#0b57d0]">
              {c.kind}: <span className="font-medium">{c.label}</span>
            </span>
          ))}
        </>
      ) : (
        <span>No topic, client or country recognised. Searched the text for {u.words.map((w) => `“${w}”`).join(", ") || "nothing"}</span>
      )}
      <span className="text-slate-500">
        · in {considered.documents} document{considered.documents === 1 ? "" : "s"}, {considered.answers} answer{considered.answers === 1 ? "" : "s"} and {considered.conversations} client conversation
        {considered.conversations === 1 ? "" : "s"}
      </span>
      {u.ignored.length > 0 && <span className="text-slate-400">· not used: {u.ignored.join(", ")}</span>}
      <a href="#post" className="ml-auto text-blue-700 hover:underline">Ask everyone ↓</a>
    </div>
  );
}

/** Board questions on the same topic or with the same words: maybe someone already asked. */
function similarQuestions(board: Board | null, data: Known) {
  if (!board) return [];
  const topics = new Set(data.query.topics.map((t) => t.id));
  const words = data.query.words.map(fold);
  return board.questions
    .filter((t) => t.topics.some((x) => topics.has(x)) || (words.length > 0 && words.every((w) => fold(t.title).includes(w))))
    .slice(0, 3);
}

function Results({ data, q, board }: { data: Known; q: string; board: Board | null }) {
  const { person } = useApp();
  const similar = similarQuestions(board, data);
  const nothing = !data.experts.length && !data.former.length && !data.answers.length && !data.documents.length;
  return (
    <>
      {nothing && (
        <section className="rounded-2xl bg-white p-6 text-sm text-slate-600">
          Nothing in TrustDrive answers this yet: no earlier answers, documents or colleagues who worked on it. Try a broader topic or the client&apos;s name, or ask everyone below.
        </section>
      )}

      {data.answers.length > 0 && (
        <section className="rounded-2xl bg-white p-6">
          <h2 className="text-sm font-medium text-slate-800">Asked before</h2>
          <p className="mb-3 text-[11px] text-slate-500">Answers colleagues gave on the board, or in chats they chose to share. Quoted as written.</p>
          <div className="space-y-3">
            {data.answers.map((a) => (
              <AnswerCard key={a.id} a={a} />
            ))}
          </div>
        </section>
      )}

      {data.documents.length > 0 && (
        <section className="rounded-2xl bg-white p-6">
          <AlreadyKnown known={{ ...data, answers: [], experts: [] }} />
        </section>
      )}

      {data.experts.length > 0 && (
        <section className="rounded-2xl bg-white p-6">
          <h2 className="text-sm font-medium text-slate-800">Who knows</h2>
          <p className="mb-3 text-[11px] text-slate-500">To ask one person directly. Ranked by what they did, with the evidence; nobody sees that you looked.</p>
          <ul className="divide-y divide-slate-100">
            {data.experts.map((e, i) => (
              <ExpertRow key={e.personId} e={e} best={i === 0} subject={`Question about ${q}`} />
            ))}
          </ul>
        </section>
      )}
      {!data.experts.length && data.former.length > 0 && (
        <section className="rounded-2xl bg-[#fef7e0] p-6 text-sm text-[#7a4a00]">
          Nobody still at the company has worked on this. The people below did; their handover briefing shows what they left behind.
        </section>
      )}
      {data.former.length > 0 && (
        <section className="rounded-2xl bg-white p-6">
          <h2 className="text-sm font-medium text-slate-800">Knew about this, but left the company</h2>
          <p className="mb-2 text-[11px] text-slate-500">What they knew may only be in their documents now. Their handover briefing shows what they left and who took over.</p>
          <ul className="space-y-3">
            {data.former.map((f) => {
              const p = person(f.personId);
              return (
                <li key={f.personId} className="flex items-start gap-3">
                  <Avatar person={p} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-800">
                      <Link href={`/person/${f.personId}`} className="font-medium hover:underline">{p?.name ?? f.personId}</Link>
                      <span className="text-xs text-slate-500"> · left {timeAgo(f.leftAt)}</span>
                    </div>
                    <EvidenceList evidence={f.evidence} className="mt-0.5" />
                    <Link href={`/handover/${f.personId}`} className="mt-1 inline-block text-xs font-medium text-blue-700 hover:underline">Handover briefing →</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {similar.length > 0 && (
        <section className="rounded-2xl bg-white p-6">
          <h2 className="text-sm font-medium text-slate-800">Already asked on the board</h2>
          <p className="mb-2 text-[11px] text-slate-500">Maybe the same question: follow it instead of asking again.</p>
          <ThreadList questions={similar} />
        </section>
      )}

      <PostQuestion q={q} experts={data.experts} />
    </>
  );
}

/** The last step: post it to the board, and the people who know most are asked. */
function PostQuestion({ q, experts }: { q: string; experts: Expert[] }) {
  const router = useRouter();
  const { person } = useApp();
  const [details, setDetails] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = experts.slice(0, 3).map((e) => person(e.personId)?.name.split(" ")[0] ?? e.personId);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];

  const post = async () => {
    setPosting(true);
    setError(null);
    try {
      const res = await fetch("/api/board", { method: "POST", body: JSON.stringify({ title: q, details: details || undefined }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not post the question.");
      router.push(`/board/${json.id}`);
    } catch (e) {
      setError((e as Error).message);
      setPosting(false);
    }
  };

  return (
    <section id="post" className="scroll-mt-4 rounded-2xl bg-white p-6 ring-2 ring-[#c2e7ff]">
      <h2 className="text-sm font-medium text-slate-900">Still stuck? Ask everyone</h2>
      <p className="mt-0.5 text-xs text-slate-600">
        Your question goes on the board, where everyone can see it{list ? <>, and <span className="font-medium">{list}</span> are asked for you</> : ""}. If nobody answers within two days,
        the next colleagues who know are asked. The answer stays findable for the next person.
      </p>
      <div className="mt-3 text-sm font-medium text-slate-900">“{q}”</div>
      <textarea
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        rows={2}
        placeholder="Details (optional): the client, the country, what you tried"
        aria-label="Details"
        className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
      />
      {error && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="mt-2 flex justify-end">
        <button onClick={post} disabled={posting || q.length < 5} className="rounded-full bg-[#0b57d0] px-5 py-2 text-sm font-medium text-white hover:bg-[#0842a0] disabled:opacity-50">
          {posting ? "Posting…" : "Post question"}
        </button>
      </div>
    </section>
  );
}

/** With nothing typed: the board, questions asked to the viewer first. */
function BoardFeed({ board }: { board: Board | null }) {
  const { viewerId } = useApp();
  const [chosen, setChosen] = useState<Tab | null>(null);
  if (!board) return <section className="rounded-2xl bg-white p-6 text-sm text-slate-500">Loading the board…</section>;
  const askedToYou = (t: ThreadSummary) => t.askedIds.includes(viewerId) && t.askerId !== viewerId && !t.solved;
  const unanswered = (t: ThreadSummary) => !t.solved && t.answers === 0;
  const tab: Tab = chosen ?? (board.questions.some(askedToYou) ? "asked" : "all");
  const tabs: { id: Tab; label: string; n?: number }[] = [
    { id: "asked", label: "Asked to you", n: board.questions.filter(askedToYou).length },
    { id: "open", label: "Not answered yet", n: board.questions.filter(unanswered).length },
    { id: "all", label: "All questions" },
    { id: "mine", label: "Yours" },
    { id: "chats", label: "Shared from chats", n: board.fromChats.length },
  ];
  const questions = board.questions.filter((t) => (tab === "asked" ? askedToYou(t) : tab === "open" ? unanswered(t) : tab === "mine" ? t.askerId === viewerId : true));

  return (
    <section className="rounded-2xl bg-white p-6">
      <h2 className="text-lg text-slate-900">The board</h2>
      <p className="text-[11px] text-slate-500">Questions colleagues asked everyone. Answer what you know: it&apos;s how others find out you know it.</p>
      <div role="tablist" className="mb-3 mt-3 flex gap-1 overflow-x-auto border-b border-slate-200 [&>button]:shrink-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setChosen(t.id)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${tab === t.id ? "border-[#0b57d0] font-medium text-[#0b57d0]" : "border-transparent text-slate-600 hover:text-slate-900"}`}
          >
            {t.label}
            {!!t.n && <span className={`rounded-full px-1.5 text-[11px] ${t.id === "asked" ? "bg-[#0b57d0] text-white" : "bg-slate-100 text-slate-600"}`}>{t.n}</span>}
          </button>
        ))}
      </div>
      {tab === "chats" ? (
        <>
          <p className="mb-3 text-[11px] text-slate-500">Answers colleagues gave in email and Teams and chose to share. Who asked isn&apos;t shown, and the chats stay private.</p>
          {board.fromChats.length === 0 && <p className="text-sm text-slate-500">Nothing shared from chats yet.</p>}
          <div className="space-y-3">
            {board.fromChats.map((a) => (
              <AnswerCard key={a.id} a={a} />
            ))}
          </div>
        </>
      ) : questions.length ? (
        <ThreadList questions={questions} />
      ) : (
        <p className="py-3 text-sm text-slate-500">{tab === "asked" ? "Nobody is waiting for you to answer." : "No questions here."}</p>
      )}
    </section>
  );
}

function ThreadList({ questions }: { questions: ThreadSummary[] }) {
  const { person, viewerId, taxonomy } = useApp();
  return (
    <ul className="divide-y divide-slate-100">
      {questions.map((t) => {
        const asker = person(t.askerId);
        const topic = taxonomy.mostSpecific(t.topics)[0];
        return (
          <li key={t.id} className="flex items-start gap-3 py-3">
            <Avatar person={asker} size={32} />
            <div className="min-w-0 flex-1">
              <Link href={`/board/${t.id}`} className="text-sm font-medium text-slate-900 hover:underline">{t.title}</Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                <span>{t.askerId === viewerId ? "You" : asker?.name} asked {timeAgo(t.askedAt)}</span>
                {topic && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{taxonomy.tagLabel(topic)}</span>}
                {t.askedIds.includes(viewerId) && t.askerId !== viewerId && !t.solved && <span className="rounded-full bg-[#e8f0fe] px-2 py-0.5 font-medium text-[#0b57d0]">Asked to you</span>}
              </div>
            </div>
            <div className="shrink-0 text-right text-xs">
              {t.solved ? (
                <span className="rounded-full bg-[#e6f4ea] px-2.5 py-1 font-medium text-[#137333]">Solved</span>
              ) : t.answers ? (
                <span className="text-slate-600">{t.answers} answer{t.answers === 1 ? "" : "s"}</span>
              ) : (
                <span className="text-[#b06000]">No answer yet</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ExpertRow({ e, best, subject }: { e: Expert; best: boolean; subject: string }) {
  const { person, teamName } = useApp();
  const [open, setOpen] = useState(false);
  const p = person(e.personId);
  const shown = open ? e.evidence : e.evidence.slice(0, 3);
  const counts = [
    e.documents && `${e.documents} document${e.documents === 1 ? "" : "s"}`,
    e.answers && `answered ${e.answers} question${e.answers === 1 ? "" : "s"}`,
    e.conversations && `${e.conversations} client conversation${e.conversations === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex gap-3 py-4 first:pt-0 last:pb-0">
      <Avatar person={p} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/person/${e.personId}`} className="text-sm font-medium text-slate-900 hover:underline">{p?.name ?? e.personId}</Link>
          {best && <span className="rounded-full bg-[#e8f0fe] px-2 py-0.5 text-[10px] font-medium text-[#0b57d0]">Best match</span>}
        </div>
        <div className="text-[11px] text-slate-500">
          {p?.role} · {p ? teamName(p.teamId) : ""} · {counts}
          {e.lastActive && <> · last active {timeAgo(e.lastActive)}</>}
        </div>
        <div className="mt-1 h-1 max-w-xs overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-[#0b57d0]" style={{ width: `${Math.max(8, e.relevance * 100)}%` }} />
        </div>
        <EvidenceList evidence={shown} className="mt-1.5" />
        {e.evidence.length > 3 && (
          <button onClick={() => setOpen(!open)} className="mt-0.5 text-[11px] text-blue-700 hover:underline">
            {open ? "Show less" : `+${e.evidence.length - 3} more`}
          </button>
        )}
        {open && e.evidenceCount > e.evidence.length && (
          <Link href={`/person/${e.personId}`} className="ml-2 text-[11px] text-blue-700 hover:underline">All {e.evidenceCount} on their profile</Link>
        )}
        {e.caveat && <div className="mt-1 text-[11px] text-[#b06000]">{e.caveat}</div>}
        {p && <ContactLinks person={p} subject={subject} profile={false} className="mt-1.5" />}
      </div>
    </li>
  );
}
