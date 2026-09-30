"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppContext";
import { FileIcon } from "@/components/FileIcon";
import { Avatar, TopBar } from "@/components/TopBar";
import { TrustBadge, trustBand } from "@/components/TrustBadge";
import { useScores } from "@/components/useScores";
import { StatusPill } from "@/components/StatusPill";
import { UploadDialog } from "@/components/UploadDialog";
import { timeAgo } from "@/lib/time";
import { LOCATIONS, type Doc, type Location, type TrustScore } from "@/lib/types";

type DocRow = Omit<Doc, "content"> & { excerpt: string; trust: TrustScore | null };

type View = { kind: "all" } | { kind: "mine" } | { kind: "shared" } | { kind: "attention" } | { kind: "team"; id: string } | { kind: "location"; id: Location };

export default function Home() {
  const router = useRouter();
  const { viewerId, teams, search, person, teamName } = useApp();
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [view, setView] = useState<View>({ kind: "all" });
  const [sort, setSort] = useState<"modified" | "trust">("modified");
  const [newMenu, setNewMenu] = useState(false);
  const [uploading, setUploading] = useState(false);
  const { trustOf, failed } = useScores(docs, viewerId);

  useEffect(() => {
    setDocs(null);
    fetch(`/api/docs?viewer=${viewerId}`)
      .then((r) => r.json())
      .then((j) => setDocs(j.docs));
  }, [viewerId]);

  const shown = useMemo(() => {
    if (!docs) return [];
    const q = search.toLowerCase().trim();
    return docs
      .filter((d) => {
        if (view.kind === "mine") return d.ownerId === viewerId;
        if (view.kind === "shared") return d.ownerId !== viewerId && (d.collaboratorIds.includes(viewerId) || d.readerIds.includes(viewerId));
        if (view.kind === "attention") {
          const t = trustOf(d);
          return t ? t.score < 50 : false;
        }
        if (view.kind === "team") return d.teamId === view.id;
        if (view.kind === "location") return d.location === view.id;
        return true;
      })
      .filter((d) => !q || d.title.toLowerCase().includes(q) || d.excerpt.toLowerCase().includes(q) || d.tags.some((t) => t.includes(q)))
      .sort((a, b) => (sort === "trust" ? (trustOf(b)?.score ?? -1) - (trustOf(a)?.score ?? -1) : b.updatedAt.localeCompare(a.updatedAt)));
  }, [docs, view, search, sort, viewerId, trustOf]);

  const heading =
    view.kind === "all" ? "My Drive" : view.kind === "mine" ? "Owned by me" : view.kind === "shared" ? "Shared with me" : view.kind === "attention" ? "Needs attention" : view.kind === "team" ? teamName(view.id) : view.id;

  const createDoc = async () => {
    const res = await fetch("/api/docs", { method: "POST", body: JSON.stringify({ viewerId, title: "Untitled document", content: "# Untitled document\n\n" }) });
    const { id } = await res.json();
    router.push(`/doc/${id}?edit=1`);
  };

  const navItem = (v: View, label: string, icon: React.ReactNode) => {
    const active = JSON.stringify(v) === JSON.stringify(view);
    return (
      <button
        key={label}
        onClick={() => setView(v)}
        className={`flex h-8 w-full items-center gap-4 rounded-full pl-4 pr-3 text-left text-sm ${active ? "bg-[#c2e7ff] font-medium text-slate-900" : "text-slate-700 hover:bg-slate-200/70"}`}
      >
        <span className="w-5 text-center">{icon}</span>
        <span className="truncate">{label}</span>
      </button>
    );
  };

  return (
    <div className="flex h-screen flex-col">
      {uploading && <UploadDialog onClose={() => setUploading(false)} />}
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <aside className="w-64 shrink-0 overflow-y-auto px-3 pb-6">
          <div className="relative mb-4 ml-1">
            <button onClick={() => setNewMenu(!newMenu)} className="flex h-14 items-center gap-3 rounded-2xl bg-white px-5 text-sm font-medium shadow-md hover:bg-[#edf2fa]">
              <svg width="24" height="24" viewBox="0 0 24 24"><path d="M20 13h-7v7h-2v-7H4v-2h7V4h2v7h7v2Z" fill="#1f1f1f" /></svg>
              New
            </button>
            {newMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setNewMenu(false)} />
                <div className="absolute left-0 top-0 z-20 w-60 rounded-xl bg-white py-2 shadow-xl ring-1 ring-black/5">
                  <button onClick={createDoc} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-slate-100">
                    <FileIcon kind="doc" /> Blank document
                  </button>
                  <button
                    onClick={() => {
                      setNewMenu(false);
                      setUploading(true);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-slate-100"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24"><path d="M9 16h6v-6h4l-7-7-7 7h4v6Zm-4 2h14v2H5v-2Z" fill="#444746" /></svg>
                    File upload
                  </button>
                </div>
              </>
            )}
          </div>
          <nav className="space-y-0.5">
            {navItem({ kind: "all" }, "My Drive", "🗂")}
            {navItem({ kind: "mine" }, "Owned by me", "👤")}
            {navItem({ kind: "shared" }, "Shared with me", "👥")}
            {navItem({ kind: "attention" }, "Needs attention", "⚠️")}
          </nav>
          <div className="mb-1 mt-5 px-4 text-xs font-medium uppercase tracking-wide text-slate-500">Teams</div>
          <nav className="space-y-0.5">{teams.map((t) => navItem({ kind: "team", id: t.id }, t.name, "▪"))}</nav>
          <div className="mb-1 mt-5 px-4 text-xs font-medium uppercase tracking-wide text-slate-500">Locations</div>
          <nav className="space-y-0.5">{LOCATIONS.map((l) => navItem({ kind: "location", id: l }, l, "📍"))}</nav>
          <div className="mt-6 px-4 text-[11px] leading-4 text-slate-500">
            Trust scores by <span className="font-medium">Jev</span> (TypeSafe AI).
            <button
              className="mt-2 block text-blue-700 hover:underline"
              onClick={async () => {
                if (!confirm("Reset all demo data? Your edits and verifications will be lost.")) return;
                await fetch("/api/reset", { method: "POST" });
                location.reload();
              }}
            >
              Reset demo data
            </button>
          </div>
        </aside>

        <main className="mb-4 mr-4 flex min-w-0 flex-1 flex-col rounded-2xl bg-white">
          <div className="flex items-center justify-between px-6 pb-2 pt-5">
            <h1 className="text-2xl text-slate-800">{heading}</h1>
            <div className="flex items-center gap-1 rounded-full border border-slate-300 p-0.5 text-sm">
              {(["modified", "trust"] as const).map((s) => (
                <button key={s} onClick={() => setSort(s)} className={`rounded-full px-3 py-1 ${sort === s ? "bg-[#c2e7ff]" : "hover:bg-slate-100"}`}>
                  {s === "modified" ? "Last modified" : "Trust score"}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4">
            <table className="w-full table-fixed text-sm">
              <thead className="sticky top-0 z-10 bg-white text-left text-slate-600">
                <tr className="border-b border-slate-200">
                  <th className="px-2 py-3 font-medium">Name</th>
                  <th className="w-44 px-2 font-medium">Owner</th>
                  <th className="w-40 px-2 font-medium">Last modified</th>
                  <th className="w-32 px-2 font-medium">Status</th>
                  <th className="w-28 px-2 font-medium">Location</th>
                  <th className="w-36 px-2 font-medium">Trust</th>
                </tr>
              </thead>
              <tbody>
                {!docs &&
                  Array.from({ length: 8 }, (_, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td colSpan={6} className="px-2 py-4"><div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" /></td>
                    </tr>
                  ))}
                {docs && shown.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-16 text-center text-slate-500">No files here</td>
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
                          <span className="truncate font-medium text-slate-800">{d.title}</span>
                        </Link>
                      </td>
                      <td className="px-2">
                        <div className="flex items-center gap-2">
                          <Avatar person={owner} size={24} />
                          <span className={`truncate ${owner && !owner.active ? "text-slate-400 line-through" : ""}`}>
                            {owner ? (owner.id === viewerId ? "me" : owner.name) : "No owner"}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 text-slate-600">
                        {timeAgo(d.updatedAt)} <span className="text-slate-400">· {d.lastEditedById === viewerId ? "me" : person(d.lastEditedById)?.name.split(" ")[0]}</span>
                      </td>
                      <td className="px-2"><StatusPill status={d.status} /></td>
                      <td className="px-2 text-slate-600">{d.location}</td>
                      <td className="px-2">
                        <div className="flex items-center gap-2">
                          <TrustBadge trust={trust} loading={!trust && !failed(d.id)} error={failed(d.id)} size={34} />
                          {band && <span className="text-xs font-medium" style={{ color: band.color }}>{band.label}</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </div>
  );
}
