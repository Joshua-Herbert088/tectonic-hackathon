"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApp } from "./AppContext";
import { FileIcon } from "./FileIcon";
import { Avatar } from "./TopBar";
import { TrustBadge } from "./TrustBadge";
import { reliance } from "@/lib/handover";
import type { Doc, Handover, TrustScore } from "@/lib/types";

type Row = Omit<Doc, "content"> & { trust: TrustScore | null };

/** How exposed the organisation is: many readers relying on a document that can't be trusted. */
export function exposure(d: Row, trust: TrustScore | null) {
  const r = reliance(d);
  return (r.readers30 * 2 + r.readers + 1) * (1 - (trust?.score ?? 50) / 100);
}

export function HandoverRadar({
  rows,
  trustOf,
  failed,
}: {
  rows: { doc: Row; handover: Handover }[];
  trustOf: (d: Row) => TrustScore | null;
  failed: (id: string) => boolean;
}) {
  const router = useRouter();
  const { viewerId, person, teamName } = useApp();
  const [busy, setBusy] = useState<string | null>(null);

  const assign = async (doc: Row, ownerId: string) => {
    setBusy(doc.id);
    const before = trustOf(doc)?.score;
    const res = await fetch(`/api/docs/${doc.id}/owner`, { method: "POST", body: JSON.stringify({ viewerId, ownerId }) });
    if (!res.ok) return setBusy(null);
    router.push(`/doc/${doc.id}${before !== undefined ? `?from=${before}` : ""}`);
  };

  return (
    <>
      <p className="px-2 pb-3 text-sm text-slate-600">
        Documents that lost their owner, ranked by how many colleagues still rely on them and how little they can be trusted. Hand each one to someone who knows it.
      </p>
      <table className="w-full table-fixed text-sm">
        <thead className="sticky top-0 z-10 bg-white text-left text-slate-600">
          <tr className="border-b border-slate-200">
            <th className="px-2 py-3 font-medium">Name</th>
            <th className="w-36 px-2 font-medium">Relied on by</th>
            <th className="w-20 px-2 font-medium">Trust</th>
            <th className="w-72 px-2 font-medium">Suggested new owner</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="py-16 text-center text-slate-500">Every document has an active owner</td>
            </tr>
          )}
          {rows.map(({ doc, handover }) => {
            const r = reliance(doc);
            const next = handover.successors[0];
            const nextPerson = person(next?.personId);
            return (
              <tr key={doc.id} className="cursor-pointer border-b border-slate-100 align-top hover:bg-slate-50" onClick={() => router.push(`/doc/${doc.id}`)}>
                <td className="px-2 py-3">
                  <Link href={`/doc/${doc.id}`} className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                    <FileIcon kind={doc.kind} />
                    <span className="truncate font-medium text-slate-800">{doc.title}</span>
                  </Link>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 pl-8">
                    {handover.reasons.map((s, i) => (
                      <span key={i} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.tone === "bad" ? "bg-[#fce8e6] text-[#c5221f]" : "bg-[#fef7e0] text-[#b06000]"}`}>
                        {s.text}
                      </span>
                    ))}
                    <span className="px-1 py-0.5 text-[11px] text-slate-500">{teamName(doc.teamId)} · {doc.location}</span>
                  </div>
                </td>
                <td className="px-2 py-3 text-slate-700">
                  <div className="font-medium">{r.readers30} reader{r.readers30 === 1 ? "" : "s"} this month</div>
                  <div className="text-xs text-slate-500">{r.views30} opens · {r.readers} with access</div>
                </td>
                <td className="px-2 py-2">
                  <TrustBadge trust={trustOf(doc)} loading={!trustOf(doc) && !failed(doc.id)} error={failed(doc.id)} size={34} />
                </td>
                <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                  {next ? (
                    <div className="flex items-center gap-2">
                      <Avatar person={nextPerson} size={28} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-slate-800">{next.personId === viewerId ? "You" : nextPerson?.name}</div>
                        <div className="truncate text-[11px] text-slate-500">{next.why.join(" · ")}</div>
                      </div>
                      <button
                        disabled={busy === doc.id}
                        onClick={() => assign(doc, next.personId)}
                        className="shrink-0 rounded-full bg-[#c2e7ff] px-3 py-1 text-xs font-medium text-slate-900 hover:bg-[#b3dcf7] disabled:opacity-60"
                      >
                        {next.personId === viewerId ? "Take over" : "Assign"}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      No obvious successor
                      <button disabled={busy === doc.id} onClick={() => assign(doc, viewerId)} className="shrink-0 rounded-full bg-[#c2e7ff] px-3 py-1 font-medium text-slate-900 hover:bg-[#b3dcf7] disabled:opacity-60">
                        Take over
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
