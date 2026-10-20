"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "./AppContext";
import { Avatar } from "./TopBar";
import type { Evidence, WhoKnows } from "@/lib/expertise";
import { citationHref } from "@/lib/handoverDoc";
import { timeAgo } from "@/lib/time";
import type { Answer } from "@/lib/types";

/** What someone did, linked to the document or conversation it happened in, and when. */
export function EvidenceList({ evidence, className = "" }: { evidence: Evidence[]; className?: string }) {
  return (
    <ul className={`space-y-0.5 text-xs text-slate-600 ${className}`}>
      {evidence.map((e, i) => (
        <li key={i} className="flex gap-1.5">
          <span className="text-slate-400">•</span>
          <span className="min-w-0">
            {e.action}{" "}
            {e.doc && <Link href={`/doc/${e.doc.id}`} className="text-slate-800 hover:underline">{e.doc.title}</Link>}
            {e.conversation && <Link href={citationHref(e.conversation.id, e.conversation.messageId)} className="text-slate-800 hover:underline">{e.conversation.title}</Link>}
            {e.at && <span className="text-slate-400"> · {timeAgo(e.at)}</span>}
            {e.detail && <span className="mt-0.5 block line-clamp-2 italic text-slate-500">{e.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A question a colleague asked in chat and the answer they got, quoted as written, with a link to the
 * exact message. Marked as unverified, and warns when a document says otherwise.
 */
export function AnswerCard({ a, className = "" }: { a: Answer; className?: string }) {
  const { person } = useApp();
  const asker = person(a.askerId);
  const answerer = person(a.answererId);
  const lines = a.answer.split("\n");
  return (
    <div className={`rounded-xl border border-slate-200 p-3 text-sm ${className}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
        <Avatar person={answerer} size={20} />
        <span>
          <Link href={`/person/${a.answererId}`} className="font-medium text-slate-700 hover:underline">{answerer?.name ?? a.answererId}</Link> answered {asker?.name.split(" ")[0] ?? "a colleague"} in {a.source === "email" ? "an email" : "a Teams chat"} · {timeAgo(a.answeredAt)}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600" title="Answers in chat aren't checked like documents: confirm before relying on it">From chat, not verified</span>
      </div>
      <div className="mt-1.5 font-medium text-slate-900">“{a.question}”</div>
      <blockquote className="mt-1 space-y-0.5 border-l-2 border-[#5b5fc7] pl-3 text-slate-700">
        {lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </blockquote>
      {a.conflict && (
        <div className="mt-2 rounded-lg bg-[#fce8e6] px-2.5 py-1.5 text-xs text-[#a50e0e]">
          Contradicts <Link href={`/doc/${a.conflict.docId}`} className="font-medium underline">{a.conflict.title}</Link>, line {a.conflict.lineNo}: “{a.conflict.lineText}”. One of them is out of date.
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-3 text-xs">
        <Link href={citationHref(a.conversationId, a.answerMessageId, lines[0])} className="text-blue-700 hover:underline">Read it in the chat</Link>
        {a.faqDocId && <Link href={`/doc/${a.faqDocId}`} className="text-blue-700 hover:underline">Written up in an FAQ</Link>}
      </div>
    </div>
  );
}

/** Next to document search results: the colleagues who know most about what's being searched for. */
export function ExpertsStrip({ query }: { query: string }) {
  const { person, viewerId } = useApp();
  const [found, setFound] = useState<{ query: string; viewerId: string; experts: WhoKnows["experts"]; answer?: Answer } | null>(null);
  const q = query.trim();

  useEffect(() => {
    if (q.length < 3) return;
    let cancelled = false;
    // Wait until typing pauses.
    const t = setTimeout(() => {
      fetch(`/api/people?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: WhoKnows | null) => !cancelled && j?.experts && setFound({ query: q, viewerId, experts: j.experts.slice(0, 3), answer: j.answers[0] }))
        .catch(() => {});
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, viewerId]);

  if (q.length < 3 || !found || found.query !== q || found.viewerId !== viewerId || (!found.experts.length && !found.answer)) return null;
  const a = found.answer;
  return (
    <div className="mb-2 space-y-1.5 rounded-xl bg-[#f0f4f9] px-3 py-2 text-xs text-slate-600">
      {a && (
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-medium text-slate-700">Asked before:</span>
          <Link href={citationHref(a.conversationId, a.answerMessageId, a.answer.split("\n")[0])} className="min-w-0 truncate text-slate-800 hover:underline" title={a.answer}>
            “{a.question}” – {person(a.answererId)?.name.split(" ")[0] ?? "a colleague"} answered {timeAgo(a.answeredAt)}
          </Link>
          {a.conflict && <span className="shrink-0 rounded-full bg-[#fce8e6] px-2 py-0.5 text-[10px] text-[#a50e0e]">a document says otherwise</span>}
        </div>
      )}
      {found.experts.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="font-medium text-slate-700">Who knows about “{q}”:</span>
          {found.experts.map((e) => {
            const p = person(e.personId);
            return (
              <Link key={e.personId} href={`/person/${e.personId}`} className="flex items-center gap-1.5 rounded-full bg-white py-0.5 pl-0.5 pr-2.5 ring-1 ring-slate-200 hover:ring-[#0b57d0]" title={e.evidence[0] ? `${e.evidence[0].action} ${e.evidence[0].doc?.title ?? e.evidence[0].conversation?.title ?? ""}` : undefined}>
                <Avatar person={p} size={20} />
                <span className="text-slate-800">{p?.name ?? e.personId}</span>
              </Link>
            );
          })}
          <Link href={`/people?q=${encodeURIComponent(q)}`} className="text-blue-700 hover:underline">Why them? →</Link>
        </div>
      )}
    </div>
  );
}
