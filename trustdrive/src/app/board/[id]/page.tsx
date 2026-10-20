"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AlreadyKnown, knowsSomething, type Known } from "@/components/AlreadyKnown";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AppContext";
import { Avatar } from "@/components/TopBar";
import { timeAgo } from "@/lib/time";
import type { AnswerView, BoardThread, Message } from "@/lib/types";

interface Data {
  thread: BoardThread;
  /** Its answers as captured: topics, contradictions. */
  captured: AnswerView[];
  related: Known | null;
}

export default function QuestionPage() {
  const { id } = useParams<{ id: string }>();
  const { viewerId } = useApp();
  return <Question key={`${id}:${viewerId}`} id={id} />;
}

function Question({ id }: { id: string }) {
  const { viewerId, person, taxonomy } = useApp();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/board/${id}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(r.status === 404 ? "This question doesn't exist (any more)." : (json.error ?? "Could not load the question."));
        if (!cancelled) setData(json);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id, reload]);

  // Arriving at a specific answer (#m123): scroll to it.
  useEffect(() => {
    if (data && window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "center" });
  }, [data]);

  /** Runs a request, then reloads (an answer is captured in the background, so reload once more shortly after). */
  const act = async (url: string, init: RequestInit) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(url, init);
      if (!res.ok) throw new Error((await res.json()).error ?? `Request failed (${res.status})`);
      setReload((n) => n + 1);
      setTimeout(() => setReload((n) => n + 1), 2500);
      return true;
    } catch (e) {
      setActionError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <AppShell>
        <div className="grid flex-1 place-items-center rounded-2xl bg-white text-sm text-slate-500">
          {error ? (
            <div className="text-center">
              <p>{error}</p>
              <Link href="/ask" className="mt-2 inline-block text-blue-700 hover:underline">All questions</Link>
            </div>
          ) : (
            "Loading the question…"
          )}
        </div>
      </AppShell>
    );
  }

  const { thread: t, captured, related } = data;
  const asker = person(t.askerId);
  const mine = t.askerId === viewerId;
  const answers = t.replies.filter((m) => m.personId !== t.askerId);
  const capturedFor = (m: Message) => captured.find((a) => a.answerMessageId === m.id);
  const ordered = [...t.replies].sort((a, b) => Number(b.id === t.solvedMessageId) - Number(a.id === t.solvedMessageId));
  const topics = taxonomy.mostSpecific(t.topics);

  return (
    <AppShell>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-4">
            <section className="rounded-2xl bg-white p-6">
              <Link href="/ask" className="text-sm text-blue-700 hover:underline">← Ask</Link>
              <h1 className="mt-3 text-2xl text-slate-900">{t.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <Avatar person={asker} size={22} />
                <span>
                  {mine ? "You" : <Link href={`/person/${t.askerId}`} className="hover:underline">{asker?.name}</Link>} asked {timeAgo(t.askedAt)}
                </span>
                {topics.map((x) => (
                  <Link key={x} href={`/ask?q=${encodeURIComponent(taxonomy.tagLabel(x))}`} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 hover:bg-[#e8f0fe]">
                    {taxonomy.tagLabel(x)}
                  </Link>
                ))}
                {t.solvedMessageId && <span className="rounded-full bg-[#e6f4ea] px-2 py-0.5 font-medium text-[#137333]">Solved</span>}
              </div>
              {t.question.body !== t.title && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{t.question.body}</p>}
              {t.askedIds.length > 0 && (
                <p className="mt-3 text-[11px] text-slate-500">
                  Asked for {mine ? "you" : asker?.name.split(" ")[0]}: {t.askedIds.map((p) => person(p)?.name ?? p).join(", ")}, who know most about this.
                  {!answers.length && " If nobody answers within two days, the next colleagues are asked."}
                </p>
              )}
            </section>

            <section className="rounded-2xl bg-white p-6">
              <h2 className="text-lg text-slate-900">{answers.length ? `${answers.length} answer${answers.length === 1 ? "" : "s"}` : "No answers yet"}</h2>
              {actionError && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>}
              <ul className="mt-3 space-y-3">
                {ordered.map((m) => {
                  const author = person(m.personId);
                  const solved = m.id === t.solvedMessageId;
                  const c = capturedFor(m);
                  const byAsker = m.personId === t.askerId;
                  return (
                    <li key={m.id} id={`m${m.id}`} className={`rounded-xl border p-4 ${solved ? "border-[#81c995] bg-[#f3faf5]" : "border-slate-200"}`}>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Avatar person={author} size={24} />
                        <Link href={`/person/${m.personId}`} className="font-medium text-slate-800 hover:underline">{m.personId === viewerId ? "You" : author?.name}</Link>
                        <span>· {timeAgo(m.sentAt)}</span>
                        {byAsker && <span className="rounded-full bg-slate-100 px-2 py-0.5">asker</span>}
                        {solved && <span className="rounded-full bg-[#e6f4ea] px-2 py-0.5 font-medium text-[#137333]">Solved it</span>}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{m.body}</p>
                      {c?.conflict && (
                        <div className="mt-2 rounded-lg bg-[#fce8e6] px-2.5 py-1.5 text-xs text-[#a50e0e]">
                          Contradicts <Link href={`/doc/${c.conflict.docId}`} className="font-medium underline">{c.conflict.title}</Link>, line {c.conflict.lineNo}: “{c.conflict.lineText}”. Its owner has been told.
                        </div>
                      )}
                      {mine && !byAsker && (
                        <button
                          disabled={busy}
                          onClick={() => act(`/api/board/${t.id}`, { method: "PATCH", body: JSON.stringify({ solvedMessageId: solved ? null : m.id }) })}
                          className={`mt-2 rounded-full px-3 py-1 text-xs font-medium disabled:opacity-60 ${solved ? "text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50" : "bg-[#e6f4ea] text-[#137333] hover:bg-[#ceead6]"}`}
                        >
                          {solved ? "Undo: not solved" : "✓ This solved it"}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await act(`/api/board/${t.id}/answers`, { method: "POST", body: JSON.stringify({ body }) })) setBody("");
                }}
                className="mt-4"
              >
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={3}
                  placeholder={mine ? "Add details or reply" : "Write your answer"}
                  aria-label="Your answer"
                  className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
                <div className="mt-2 flex items-center justify-end gap-3">
                  <span className="text-[11px] text-slate-500">Answers are public and checked against the drive.</span>
                  <button type="submit" disabled={busy || !body.trim()} className="rounded-full bg-[#0b57d0] px-5 py-2 text-sm font-medium text-white hover:bg-[#0842a0] disabled:opacity-50">
                    {mine ? "Reply" : "Answer"}
                  </button>
                </div>
              </form>
            </section>
          </div>

          {related && knowsSomething(related) && (
            <aside className="h-fit rounded-2xl bg-[#f0f4f9] p-5">
              <h2 className="mb-3 text-sm font-medium text-slate-800">Also known about this</h2>
              <AlreadyKnown known={related} />
            </aside>
          )}
        </div>
      </div>
    </AppShell>
  );
}
