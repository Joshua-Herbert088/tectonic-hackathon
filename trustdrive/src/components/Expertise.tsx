"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "./AppContext";
import { Avatar } from "./TopBar";
import type { Evidence, WhoKnows } from "@/lib/expertise";
import { timeAgo } from "@/lib/time";

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
            {e.conversation && <Link href={`/conversations?c=${e.conversation.id}`} className="text-slate-800 hover:underline">{e.conversation.title}</Link>}
            {e.at && <span className="text-slate-400"> · {timeAgo(e.at)}</span>}
            {e.detail && <span className="mt-0.5 block line-clamp-2 italic text-slate-500">{e.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Next to document search results: the colleagues who know most about what's being searched for. */
export function ExpertsStrip({ query }: { query: string }) {
  const { person, viewerId } = useApp();
  const [found, setFound] = useState<{ query: string; viewerId: string; experts: WhoKnows["experts"] } | null>(null);
  const q = query.trim();

  useEffect(() => {
    if (q.length < 3) return;
    let cancelled = false;
    // Wait until typing pauses.
    const t = setTimeout(() => {
      fetch(`/api/people?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: WhoKnows | null) => !cancelled && j?.experts && setFound({ query: q, viewerId, experts: j.experts.slice(0, 3) }))
        .catch(() => {});
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, viewerId]);

  if (q.length < 3 || !found || found.query !== q || found.viewerId !== viewerId || !found.experts.length) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-[#f0f4f9] px-3 py-2 text-xs text-slate-600">
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
  );
}
