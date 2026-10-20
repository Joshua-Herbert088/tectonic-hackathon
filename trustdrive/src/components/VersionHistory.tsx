"use client";

import { useState } from "react";
import { useApp } from "./AppContext";
import { Avatar } from "./TopBar";
import { timeAgo } from "@/lib/time";
import type { VersionEvent } from "@/lib/types";

const COLLAPSED_COUNT = 5;

/** Every saved version of the document, newest first. */
export function VersionHistory({ versions }: { versions: VersionEvent[] }) {
  const { person } = useApp();
  const [showAll, setShowAll] = useState(false);
  if (!versions.length) return null;
  const shown = showAll ? versions : versions.slice(0, COLLAPSED_COUNT);

  return (
    <section className="border-b border-slate-100 p-5">
      <h3 className="text-sm font-medium text-slate-800">
        Version history<span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{versions.length}</span>
      </h3>
      <p className="mb-3 text-[11px] text-slate-500">Every save is kept.</p>
      <ol className="space-y-1">
        {shown.map((v, i) => {
          const p = person(v.personId);
          return (
            <li key={`${v.at}-${i}`} className="-mx-2 flex items-start gap-2.5 rounded-xl px-2 py-1.5">
              <Avatar person={p} size={24} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="truncate font-medium text-slate-800">{p?.name ?? "Unknown"}</span>
                  <span className="shrink-0 text-slate-500" title={new Date(v.at).toLocaleString()}>{timeAgo(v.at)}</span>
                  {i === 0 && <span className="rounded-full bg-[#e8f0fe] px-1.5 text-[10px] font-medium text-[#0b57d0]">Current</span>}
                </div>
                <div className="text-xs text-slate-600">{v.summary}</div>
                {v.contentPreview && <div className="line-clamp-1 text-[11px] italic text-slate-500">“{v.contentPreview}”</div>}
              </div>
            </li>
          );
        })}
      </ol>
      {versions.length > COLLAPSED_COUNT && (
        <button onClick={() => setShowAll(!showAll)} className="mt-2 text-xs text-blue-700 hover:underline">
          {showAll ? "Show fewer" : `Show all ${versions.length} versions`}
        </button>
      )}
    </section>
  );
}
