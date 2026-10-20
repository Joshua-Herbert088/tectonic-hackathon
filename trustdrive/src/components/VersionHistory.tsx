"use client";

import { useState } from "react";
import { useApp } from "./AppContext";
import { Avatar } from "./TopBar";
import { timeAgo } from "@/lib/time";
import type { VersionEvent } from "@/lib/types";

const COLLAPSED_COUNT = 5;

/** Every saved version of the document, newest first; click one to see what changed in it. */
export function VersionHistory({ versions }: { versions: VersionEvent[] }) {
  const { person } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  if (!versions.length) return null;
  const shown = showAll ? versions : versions.slice(0, COLLAPSED_COUNT);

  return (
    <section className="border-b border-slate-100 p-5">
      <h3 className="text-sm font-medium text-slate-800">
        Version history<span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{versions.length}</span>
      </h3>
      <p className="mb-3 text-[11px] text-slate-500">Every save is kept. Click a version to see what changed.</p>
      <ol className="space-y-1">
        {shown.map((v, i) => {
          const p = person(v.personId);
          const expanded = open === v.at;
          const created = i === versions.length - 1;
          return (
            <li key={`${v.at}-${i}`}>
              <button onClick={() => setOpen(expanded ? null : v.at)} className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-slate-50">
                <Avatar person={p} size={24} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="truncate font-medium text-slate-800">{p?.name ?? "Unknown"}</span>
                    <span className="shrink-0 text-slate-500" title={new Date(v.at).toLocaleString()}>{timeAgo(v.at)}</span>
                    {i === 0 && <span className="rounded-full bg-[#e8f0fe] px-1.5 text-[10px] font-medium text-[#0b57d0]">Current</span>}
                  </div>
                  <div className="text-xs text-slate-600">{v.summary}</div>
                  {!expanded && v.contentPreview && <div className="line-clamp-1 text-[11px] italic text-slate-500">“{v.contentPreview}”</div>}
                </div>
              </button>
              {expanded && (
                <div className="mb-2 ml-[34px] mt-1 space-y-1.5">
                  {v.metaChanges.map((m) => (
                    <div key={m} className="text-[11px] text-slate-600">• {m}</div>
                  ))}
                  {created && <div className="text-[11px] text-slate-500">First version of the document.</div>}
                  {v.changes.length > 0 && (
                    <div className="overflow-hidden rounded-lg border border-slate-200 font-mono text-[10.5px] leading-4">
                      {v.changes.map((c, k) => (
                        <div key={k} className={`whitespace-pre-wrap break-words px-2 py-0.5 ${c.kind === "added" ? "bg-[#e6f4ea] text-[#0d652d]" : "bg-[#fce8e6] text-[#a50e0e]"}`}>
                          {c.kind === "added" ? "+ " : "− "}
                          {c.text}
                        </div>
                      ))}
                    </div>
                  )}
                  {v.changeCount > v.changes.length && <div className="text-[11px] text-slate-500">+{v.changeCount - v.changes.length} more changed lines</div>}
                </div>
              )}
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
