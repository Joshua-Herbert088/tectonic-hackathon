"use client";

import { useState } from "react";
import { useApp } from "./AppContext";
import { Avatar } from "./TopBar";
import type { Contact, FormerContributor } from "@/lib/contacts";
import { timeAgo } from "@/lib/time";

/** Ranked people to ask about this document, with the reasons behind each ranking. */
export function WhoToContact({ contacts, former }: { contacts: Contact[]; former: FormerContributor[] }) {
  const { person, teamName } = useApp();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section className="border-b border-slate-100 p-5">
      <h3 className="text-sm font-medium text-slate-800">Who to contact</h3>
      <p className="mb-3 text-[11px] text-slate-500">Ranked by contribution, topic knowledge, conflict decisions and team.</p>
      {contacts.length === 0 && <p className="text-sm text-slate-500">Nobody active has worked on this or related documents.</p>}
      <ul className="space-y-1">
        {contacts.map((c, i) => {
          const p = person(c.personId);
          const expanded = open === c.personId;
          return (
            <li key={c.personId}>
              <button onClick={() => setOpen(expanded ? null : c.personId)} className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-xl px-2 py-2 text-left hover:bg-slate-50">
                <Avatar person={p} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-900">{p?.name ?? c.personId}</span>
                    {i === 0 && <span className="rounded-full bg-[#e8f0fe] px-2 py-0.5 text-[10px] font-medium text-[#0b57d0]">Best contact</span>}
                  </div>
                  <div className="truncate text-[11px] text-slate-500">
                    {p?.role} · {p ? teamName(p.teamId) : ""}
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-[#0b57d0]" style={{ width: `${Math.max(8, c.relevance * 100)}%` }} />
                  </div>
                  <ul className="mt-1.5 space-y-0.5 text-xs text-slate-600">
                    {(expanded ? c.reasons : c.reasons.slice(0, 2)).map((r, k) => (
                      <li key={k} className="flex gap-1.5">
                        <span className="text-slate-400">•</span>
                        <span>{r.text}</span>
                      </li>
                    ))}
                    {!expanded && c.reasons.length > 2 && <li className="text-[11px] text-blue-700">+{c.reasons.length - 2} more reasons</li>}
                  </ul>
                  {c.caveat && <div className="mt-1 text-[11px] text-[#b06000]">{c.caveat}</div>}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {former.length > 0 && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          <span className="font-medium text-slate-600">Former contributors (left the company): </span>
          {former.map((f, i) => (
            <span key={f.personId}>
              {i > 0 && "; "}
              {person(f.personId)?.name ?? f.personId} – {f.role.charAt(0).toLowerCase() + f.role.slice(1)}, left {timeAgo(f.leftAt)}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
