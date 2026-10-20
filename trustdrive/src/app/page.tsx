"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AppContext";
import { FileIcon } from "@/components/FileIcon";
import { exposure, HandoverRadar } from "@/components/HandoverRadar";
import { Avatar } from "@/components/TopBar";
import { TrustBadge, trustBand } from "@/components/TrustBadge";
import { useScores } from "@/components/useScores";
import { StatusPill } from "@/components/StatusPill";
import { handoverFor } from "@/lib/handover";
import { timeAgo } from "@/lib/time";
import { LOCATIONS, STATUSES, type Doc, type TrustScore } from "@/lib/types";

type DocRow = Omit<Doc, "content"> & { excerpt: string; trust: TrustScore | null };

const VIEWS = [
  { id: null, label: "My Drive" },
  { id: "mine", label: "Owned by me" },
  { id: "shared", label: "Shared with me" },
  { id: "attention", label: "Needs attention" },
  { id: "radar", label: "Handover radar" },
] as const;

export default function Home() {
  return (
    <AppShell>
      <Suspense fallback={<main className="flex-1 rounded-2xl bg-white" />}>
        <Drive />
      </Suspense>
    </AppShell>
  );
}

function Drive() {
  const router = useRouter();
  const params = useSearchParams();
  const view = params.get("view");
  const { viewerId, teams, people, search, person, teamName } = useApp();
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [sort, setSort] = useState<"modified" | "trust">("modified");
  const [team, setTeam] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("");
  const { trustOf, failed } = useScores(docs, viewerId);

  useEffect(() => {
    setDocs(null);
    fetch(`/api/docs?viewer=${viewerId}`)
      .then((r) => r.json())
      .then((j) => setDocs(j.docs));
  }, [viewerId]);

  /** The view lives in the URL, so the sidebar and the back button work. */
  const setView = (id: string | null) => router.replace(id ? `/?view=${id}` : "/");

  const handovers = useMemo(() => {
    if (!docs || !people.length) return [];
    return docs.flatMap((doc) => {
      const handover = handoverFor(doc, people, teams);
      return handover ? [{ doc, handover }] : [];
    });
  }, [docs, people, teams]);

  const matches = useCallback(
    (d: DocRow) => {
      const q = search.toLowerCase().trim();
      if (q && !(d.title.toLowerCase().includes(q) || d.excerpt.toLowerCase().includes(q) || d.tags.some((t) => t.includes(q)))) return false;
      return (!team || d.teamId === team) && (!location || d.location === location) && (!status || d.status === status);
    },
    [search, team, location, status],
  );
  const radarRows = useMemo(
    () => handovers.filter((h) => matches(h.doc)).sort((a, b) => exposure(b.doc, trustOf(b.doc)) - exposure(a.doc, trustOf(a.doc))),
    [handovers, matches, trustOf],
  );

  const shown = useMemo(() => {
    if (!docs) return [];
    return docs
      .filter((d) => {
        if (view === "mine") return d.ownerId === viewerId;
        if (view === "shared") return d.ownerId !== viewerId && (d.collaboratorIds.includes(viewerId) || d.readerIds.includes(viewerId));
        if (view === "attention") {
          const t = trustOf(d);
          return t ? t.score < 50 : false;
        }
        return true;
      })
      .filter(matches)
      .sort((a, b) => (sort === "trust" ? (trustOf(b)?.score ?? -1) - (trustOf(a)?.score ?? -1) : b.updatedAt.localeCompare(a.updatedAt)));
  }, [docs, view, matches, sort, viewerId, trustOf]);

  const filtered = !!(team || location || status || search);
  const select = "rounded-full border border-slate-300 bg-white py-1 pl-3 pr-2 text-sm text-slate-700 hover:bg-slate-50";

  return (
    <main className="flex min-h-0 flex-1 flex-col rounded-2xl bg-white">
      <div className="px-4 pt-5 sm:px-6">
        <h1 className="text-2xl text-slate-800">Drive</h1>
        <div className="mt-3 flex items-center gap-1 overflow-x-auto border-b border-slate-200 [&>button]:shrink-0">
          {VIEWS.map((v) => {
            const active = (view ?? null) === v.id;
            const count = v.id === "radar" ? handovers.length : 0;
            return (
              <button
                key={v.label}
                onClick={() => setView(v.id)}
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${active ? "border-[#0b57d0] font-medium text-[#0b57d0]" : "border-transparent text-slate-600 hover:text-slate-900"}`}
              >
                {v.label}
                {count > 0 && <span className="rounded-full bg-[#fce8e6] px-1.5 text-[11px] font-medium text-[#c5221f]">{count}</span>}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 py-3">
          <select value={team} onChange={(e) => setTeam(e.target.value)} className={select} aria-label="Team">
            <option value="">All teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={location} onChange={(e) => setLocation(e.target.value)} className={select} aria-label="Location">
            <option value="">All locations</option>
            {LOCATIONS.map((l) => <option key={l}>{l}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={select} aria-label="Status">
            <option value="">Any status</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          {filtered && (
            <span className="text-xs text-slate-500">
              {search && <>Matching “{search}” · </>}
              <button onClick={() => { setTeam(""); setLocation(""); setStatus(""); }} className="text-blue-700 hover:underline">Clear filters</button>
            </span>
          )}
          {view !== "radar" && (
            <div className="ml-auto flex items-center gap-1 rounded-full border border-slate-300 p-0.5 text-sm">
              {(["modified", "trust"] as const).map((s) => (
                <button key={s} onClick={() => setSort(s)} className={`rounded-full px-3 py-0.5 ${sort === s ? "bg-[#c2e7ff]" : "hover:bg-slate-100"}`}>
                  {s === "modified" ? "Last modified" : "Trust score"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 sm:px-4">
        {view === "radar" && docs ? (
          <HandoverRadar rows={radarRows} trustOf={trustOf} failed={failed} />
        ) : (
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 z-10 bg-white text-left text-slate-600">
              <tr className="border-b border-slate-200">
                <th className="px-2 py-3 font-medium">Name</th>
                {/* Narrower screens drop owner, then last modified, so the name stays readable. */}
                <th className="hidden w-44 px-2 font-medium lg:table-cell">Owner</th>
                <th className="hidden w-40 px-2 font-medium xl:table-cell">Last modified</th>
                <th className="w-40 px-2 font-medium sm:w-48">Trust for you</th>
              </tr>
            </thead>
            <tbody>
              {!docs &&
                Array.from({ length: 8 }, (_, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td colSpan={4} className="px-2 py-4"><div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" /></td>
                  </tr>
                ))}
              {docs && shown.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-16 text-center text-slate-500">
                    {view === "attention" ? "Nothing here – every document scores at least 50 for you." : "No documents match."}
                  </td>
                </tr>
              )}
              {shown.map((d) => {
                const owner = person(d.ownerId);
                const trust = trustOf(d);
                const band = trust ? trustBand(trust.score) : null;
                return (
                  <tr key={d.id} className="group cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => router.push(`/doc/${d.id}`)}>
                    <td className="px-2 py-2.5">
                      <Link href={`/doc/${d.id}`} className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                        <FileIcon kind={d.kind} />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-800">{d.title}</div>
                          <div className="flex items-center gap-1.5 truncate text-xs text-slate-500">
                            {d.status !== "Completed" && <StatusPill status={d.status} />}
                            <span className="truncate">{teamName(d.teamId)} · {d.location}</span>
                          </div>
                        </div>
                      </Link>
                    </td>
                    <td className="hidden px-2 lg:table-cell">
                      <div className="flex items-center gap-2">
                        <Avatar person={owner} size={24} />
                        <span className={`truncate ${owner && !owner.active ? "text-slate-400 line-through" : ""}`}>
                          {owner ? (owner.id === viewerId ? "me" : owner.name) : "No owner"}
                        </span>
                      </div>
                    </td>
                    <td className="hidden px-2 text-slate-600 xl:table-cell">
                      {timeAgo(d.updatedAt)} <span className="text-slate-400">· {d.lastEditedById === viewerId ? "me" : person(d.lastEditedById)?.name.split(" ")[0]}</span>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2.5">
                        <TrustBadge trust={trust} loading={!trust && !failed(d.id)} error={failed(d.id)} size={34} />
                        {band && <span className="text-xs font-medium" style={{ color: band.color }}>{band.label}</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
