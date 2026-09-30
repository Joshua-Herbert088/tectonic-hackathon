"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "./AppContext";
import { Avatar } from "./TopBar";
import type { NotificationRow } from "@/lib/db";
import { timeAgo } from "@/lib/time";

const POLL_MS = 10_000;

/** Bell with unread count; lists changes other people made to information the viewer wrote. */
export function NotificationBell() {
  const router = useRouter();
  const { viewerId, person } = useApp();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const j = await (await fetch(`/api/notifications?viewer=${viewerId}`)).json();
      setItems(j.items);
      setUnread(j.unread);
    } catch {}
  }, [viewerId]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, POLL_MS);
    window.addEventListener("focus", load);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  const markRead = async (ids?: number[]) => {
    await fetch("/api/notifications/read", { method: "POST", body: JSON.stringify({ viewerId, ids }) });
    load();
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="relative grid h-10 w-10 place-items-center rounded-full hover:bg-slate-200/60" aria-label={`Notifications (${unread} unread)`}>
        <svg width="22" height="22" viewBox="0 0 24 24"><path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2Zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2Z" fill="#444746" /></svg>
        {unread > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#c5221f] px-1 text-[10px] font-semibold text-white">{unread}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 flex max-h-[75vh] w-[420px] flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-black/5">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-slate-900">Notifications</div>
                <div className="text-[11px] text-slate-500">Changes to your documents and to information you wrote</div>
              </div>
              {unread > 0 && <button onClick={() => markRead()} className="text-xs text-blue-700 hover:underline">Mark all as read</button>}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {items.length === 0 && <div className="px-4 py-10 text-center text-sm text-slate-500">Nothing yet</div>}
              {items.map((n) => {
                const actor = person(n.actorId);
                return (
                  <div key={n.id} className={`border-b border-slate-100 px-4 py-3 ${n.readAt ? "" : "bg-[#f3f7fe]"}`}>
                    <div className="flex items-start gap-3">
                      <Avatar person={actor} size={28} />
                      <div className="min-w-0 flex-1 text-sm text-slate-700">
                        {n.kind === "edit" ? (
                          <>
                            <span className="font-medium text-slate-900">{actor?.name ?? n.actorId}</span> changed {n.changes.length} line{n.changes.length === 1 ? "" : "s"} you wrote in <span className="font-medium text-slate-900">{n.docTitle}</span>
                          </>
                        ) : n.kind === "doc_edit" ? (
                          <>
                            <span className="font-medium text-slate-900">{actor?.name ?? n.actorId}</span> changed {n.changes.length} line{n.changes.length === 1 ? "" : "s"} in your document <span className="font-medium text-slate-900">{n.docTitle}</span>
                          </>
                        ) : (
                          <>
                            <span className="font-medium text-slate-900">{actor?.name ?? n.actorId}</span> saved <span className="font-medium text-slate-900">{n.otherDocTitle}</span>, which contradicts what you wrote in{" "}
                            <span className="font-medium text-slate-900">{n.docTitle}</span> – they overrode the conflict
                          </>
                        )}
                        <div className="text-[11px] text-slate-500">{timeAgo(n.createdAt)}</div>
                        <div className="mt-2 space-y-1.5">
                          {n.changes.map((c, i) => (
                            <div key={i} className="rounded-lg bg-slate-50 p-2 font-mono text-[11px] leading-4">
                              <div className="mb-0.5 font-sans text-[10px] uppercase tracking-wide text-slate-400">{c.lineNo === 0 ? "title" : `line ${c.lineNo}`}</div>
                              {c.before !== null && <div className="text-[#a50e0e] line-through decoration-[#a50e0e]/40">− {c.before}</div>}
                              {c.after !== null && <div className="text-[#137333]">+ {c.after}</div>}
                            </div>
                          ))}
                        </div>
                        {n.reason && <div className="mt-1.5 text-xs italic text-slate-600">Reason: {n.reason}</div>}
                        <div className="mt-2 flex gap-3 text-xs">
                          <button
                            onClick={() => {
                              markRead([n.id]);
                              setOpen(false);
                              router.push(`/doc/${n.docId}`);
                            }}
                            className="font-medium text-blue-700 hover:underline"
                          >
                            Open {n.kind === "override" ? "your document" : "document"}
                          </button>
                          {n.otherDocId && (
                            <button
                              onClick={() => {
                                markRead([n.id]);
                                setOpen(false);
                                router.push(`/doc/${n.otherDocId}`);
                              }}
                              className="text-blue-700 hover:underline"
                            >
                              Open their document
                            </button>
                          )}
                          {!n.readAt && <button onClick={() => markRead([n.id])} className="text-slate-500 hover:underline">Mark as read</button>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
