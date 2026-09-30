"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SimilarDoc } from "@/lib/similarity";
import { timeAgo } from "@/lib/time";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_RECENT = 8;

interface Recent {
  id: string;
  at: string;
}

function readRecent(viewerId: string): Recent[] {
  try {
    return JSON.parse(localStorage.getItem(`recentDocs:${viewerId}`) ?? "[]");
  } catch {
    return [];
  }
}

function remember(viewerId: string, id: string) {
  try {
    const list = [{ id, at: new Date().toISOString() }, ...readRecent(viewerId).filter((r) => r.id !== id)].slice(0, MAX_RECENT);
    localStorage.setItem(`recentDocs:${viewerId}`, JSON.stringify(list));
  } catch {}
}

/**
 * Info-only banner: "this is basically the same information you just saw in …".
 * Compares the open document with what this viewer opened in the last hour.
 */
export function RecentOverlap({ docId, viewerId }: { docId: string; viewerId: string }) {
  const [matches, setMatches] = useState<(SimilarDoc & { seenAt: string })[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const recent = readRecent(viewerId).filter((r) => r.id !== docId && Date.now() - new Date(r.at).getTime() < WINDOW_MS);
    remember(viewerId, docId);
    if (!recent.length) return;
    fetch(`/api/docs/${docId}/overlap`, { method: "POST", body: JSON.stringify({ ids: recent.map((r) => r.id) }) })
      .then((r) => r.json())
      .then((j: { matches: SimilarDoc[] }) => {
        if (cancelled) return;
        setMatches(j.matches.map((m) => ({ ...m, seenAt: recent.find((r) => r.id === m.docId)!.at })));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [docId, viewerId]);

  if (!matches.length || dismissed) return null;
  const m = matches[0];
  return (
    <div className="flex items-start gap-3 border-b border-[#d3e3fd] bg-[#e8f0fe] px-5 py-2.5 text-sm text-[#0842a0]">
      <svg width="18" height="18" viewBox="0 0 24 24" className="mt-0.5 shrink-0"><path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8Z" fill="currentColor" /></svg>
      <div className="flex-1">
        This is basically the same information as <Link href={`/doc/${m.docId}`} className="font-medium underline">{m.title}</Link>, which you opened {timeAgo(m.seenAt)}.
        {matches.length > 1 && <> Also overlaps with {matches.slice(1).map((x) => `“${x.title}”`).join(", ")}.</>}
      </div>
      <button onClick={() => setDismissed(true)} className="shrink-0 text-xs hover:underline">Dismiss</button>
    </div>
  );
}
