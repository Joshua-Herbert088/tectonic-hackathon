"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AppContext";
import { EvidenceList } from "@/components/Expertise";
import { Avatar } from "@/components/TopBar";
import { ContactLinks } from "@/components/WhoToContact";
import type { Expert, WhoKnows } from "@/lib/expertise";
import { timeAgo } from "@/lib/time";

type Result = WhoKnows | { suggestions: string[] };

/**
 * "Who knows X?": ask about a topic, a client or a country and get the colleagues who know it, each with
 * the evidence from their work. Nothing here is maintained by hand.
 */
export default function PeoplePage() {
  return (
    <AppShell>
      <Suspense fallback={<main className="flex-1 rounded-2xl bg-white" />}>
        <WhoKnowsView />
      </Suspense>
    </AppShell>
  );
}

function WhoKnowsView() {
  const router = useRouter();
  const params = useSearchParams();
  const { viewerId } = useApp();
  const q = params.get("q") ?? "";
  const [draft, setDraft] = useState(q);
  // Keyed by question and viewer: an answer for something else is never shown, even if it arrives late.
  const [result, setResult] = useState<{ key: string; data: Result } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${viewerId}:${q}`;

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

  const ask = (text: string) => {
    setDraft(text);
    router.replace(text.trim() ? `/people?q=${encodeURIComponent(text.trim())}` : "/people");
  };
  const data = result?.key === key ? result.data : null;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-4">
        <section className="rounded-2xl bg-white p-6">
          <h1 className="text-2xl text-slate-900">Who knows…?</h1>
          <p className="mt-1 text-sm text-slate-600">
            Ask about a topic, a client or a country. The answer comes from who wrote, verified and decided things in the drive, and who handled the client&apos;s mail and
            chats. Nobody has to keep a profile up to date.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(draft);
            }}
            className="mt-4 flex gap-2"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. overtime in Belgium, Noordkaai, year-end closing"
              aria-label="What do you need someone for?"
              className="h-11 min-w-0 flex-1 rounded-full bg-[#e9eef6] px-5 text-base outline-none placeholder:text-slate-500 focus:bg-white focus:shadow-md"
            />
            <button type="submit" className="rounded-full bg-[#0b57d0] px-5 text-sm font-medium text-white hover:bg-[#0842a0]">Ask</button>
          </form>
          {data && "suggestions" in data && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {data.suggestions.map((s) => (
                <button key={s} onClick={() => ask(s)} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 hover:bg-[#e8f0fe] hover:text-[#0b57d0]">{s}</button>
              ))}
            </div>
          )}
          {data && "query" in data && <Understood data={data} />}
        </section>

        {error && <section className="rounded-2xl bg-white p-6 text-sm text-red-700">{error}</section>}
        {q && !data && !error && <section className="rounded-2xl bg-white p-6 text-sm text-slate-500">Looking through the drive and conversations…</section>}
        {data && "query" in data && <Answer data={data} q={q} />}

        <p className="px-2 pb-4 text-[11px] leading-4 text-slate-500">
          What counts: owning a document, the part of its current text someone wrote, edits, verifications, exceptions they kept on purpose (with their reason) and messages in
          client conversations. Reading a document never counts. Evidence fades after three months: half as strong for every year after that. Anyone can take a topic or client
          off their own profile.
        </p>
      </div>
    </main>
  );
}

/** How the question was read, so a surprising answer can be traced back to it. */
function Understood({ data }: { data: WhoKnows }) {
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
        · in {considered.documents} document{considered.documents === 1 ? "" : "s"} and {considered.conversations} conversation{considered.conversations === 1 ? "" : "s"}
      </span>
      {u.ignored.length > 0 && <span className="text-slate-400">· not used: {u.ignored.join(", ")}</span>}
    </div>
  );
}

function Answer({ data, q }: { data: WhoKnows; q: string }) {
  const { person } = useApp();
  if (!data.experts.length && !data.former.length) {
    return (
      <section className="rounded-2xl bg-white p-6 text-sm text-slate-600">
        Nobody has worked on this in TrustDrive yet. Try a broader topic, or the name of the client.
      </section>
    );
  }
  return (
    <>
      {data.experts.length > 0 ? (
        <section className="rounded-2xl bg-white p-6">
          <ul className="divide-y divide-slate-100">
            {data.experts.map((e, i) => (
              <ExpertRow key={e.personId} e={e} best={i === 0} subject={`Question about ${q}`} />
            ))}
          </ul>
        </section>
      ) : (
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
    </>
  );
}

function ExpertRow({ e, best, subject }: { e: Expert; best: boolean; subject: string }) {
  const { person, teamName } = useApp();
  const [open, setOpen] = useState(false);
  const p = person(e.personId);
  const shown = open ? e.evidence : e.evidence.slice(0, 3);
  const counts = [e.documents && `${e.documents} document${e.documents === 1 ? "" : "s"}`, e.conversations && `${e.conversations} conversation${e.conversations === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
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
