"use client";

import { formatLocations, isGlobal } from "@/lib/appliesTo";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AppContext";
import { FileIcon } from "@/components/FileIcon";
import { exposure, HandoverRadar } from "@/components/HandoverRadar";
import { Icon } from "@/components/Icons";
import { Avatar } from "@/components/TopBar";
import { TrustBadge, trustBand } from "@/components/TrustBadge";
import { useEscape } from "@/components/useEscape";
import { useScores } from "@/components/useScores";
import { NameDialog } from "@/components/NameDialog";
import { ConfidentialPill, StatusPill } from "@/components/StatusPill";
import { canMoveFolder, childFolders, folderLabel, folderPath, subtree, validateFolderName } from "@/lib/folders";
import { handoverFor } from "@/lib/handover";
import { timeAgo } from "@/lib/time";
import { STATUSES, type Doc, type Folder, type TrustScore } from "@/lib/types";

type DocRow = Omit<Doc, "content"> & { excerpt: string; trust: TrustScore | null; issue: string | null; strength: string | null };
/** What's being dragged: a document or a folder. */
type Dragged = { kind: "doc" | "folder"; id: string };

const VIEWS = [
  { id: null, label: "All documents" },
  { id: "mine", label: "Owned by me" },
  { id: "shared", label: "Shared with me" },
  { id: "attention", label: "Needs attention" },
  { id: "radar", label: "Handover radar" },
  { id: "trash", label: "Trash" },
] as const;

export default function DrivePage() {
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
  const clientId = params.get("client");
  const tag = params.get("tag");
  const { viewerId, teams, people, clients, myClients, search, person, teamName, clientName, taxonomy: tax } = useApp();
  // Keyed by viewer: a list fetched for someone else is never shown, even if it arrives late.
  const [loaded, setLoaded] = useState<{ viewerId: string; docs: DocRow[]; folders: Folder[] } | null>(null);
  const docs = loaded?.viewerId === viewerId ? loaded.docs : null;
  const folders = useMemo(() => loaded?.folders ?? [], [loaded]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sort, setSort] = useState<"modified" | "trust">("modified");
  // Team and location can arrive in the URL (from the Company & tags page); after that they're local.
  const [team, setTeam] = useState(params.get("team") ?? "");
  const [location, setLocation] = useState(params.get("location") ?? "");
  const [status, setStatus] = useState("");
  const { trustOf, failed } = useScores(docs, viewerId);

  // Folders: the one being shown (null = top of the drive), a name dialog, a row menu, and drag and drop.
  const folderParam = params.get("folder");
  const folderId = folderParam && folders.some((f) => f.id === folderParam) ? folderParam : null;
  const [naming, setNaming] = useState<{ mode: "create" } | { mode: "rename"; folder: Folder } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [dragged, setDragged] = useState<Dragged | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  useEscape(!!menuFor, () => setMenuFor(null));
  // The last document moved to the trash, for the "Undo" notice.
  const [trashed, setTrashed] = useState<{ id: string; title: string } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/docs`)
      .then((r) => r.json())
      .then((j) => !cancelled && setLoaded({ viewerId, docs: j.docs, folders: j.folders ?? [] }))
      .catch(() => !cancelled && setLoadError("Could not load documents – is the server running?"));
    return () => {
      cancelled = true;
    };
  }, [viewerId, reload]);

  // The notice goes away by itself after a while, like Google Drive's.
  useEffect(() => {
    if (!trashed) return;
    const t = setTimeout(() => setTrashed(null), 8000);
    return () => clearTimeout(t);
  }, [trashed]);

  /** Views, the client, the tag and the folder live in the URL, so the navigation and back button work. */
  const setParam = useCallback(
    (key: "view" | "client" | "tag" | "folder", value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.replace(`/drive${next.size ? `?${next}` : ""}`);
    },
    [params, router],
  );
  const openFolder = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("folder", id);
    else next.delete("folder");
    router.push(`/drive${next.size ? `?${next}` : ""}`);
  };

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
      // A main topic also matches documents tagged with one of its sub-topics.
      const tagged = !tag || d.tags.includes(tag) || d.tags.some((t) => tax.topic.get(t)?.parent === tag);
      return tagged && (!team || d.teamId === team || d.audienceTeamIds.includes(team)) && (!location || d.locations.includes(location) || isGlobal(d.locations)) && (!status || d.status === status) && (!clientId || d.clientId === clientId);
    },
    [search, team, location, status, clientId, tag, tax],
  );
  const radarRows = useMemo(
    () => handovers.filter((h) => matches(h.doc)).sort((a, b) => exposure(b.doc, trustOf(b.doc)) - exposure(a.doc, trustOf(a.doc))),
    [handovers, matches, trustOf],
  );

  const filtered = !!(team || location || status || search || tag);
  // Browsing: one folder's contents. Searching or filtering in "All documents" covers the folder and
  // everything below it; the other views and a client's page list matching documents from every folder.
  const browsing = !view && !filtered && !clientId;
  const scope = useMemo(() => (!view && !clientId && folderId ? subtree(folders, folderId) : null), [view, clientId, folderId, folders]);

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
        if (browsing) return (d.folderId ?? null) === folderId;
        return !scope || (!!d.folderId && scope.has(d.folderId));
      })
      .filter(matches)
      .sort((a, b) => (sort === "trust" ? (trustOf(b)?.score ?? -1) - (trustOf(a)?.score ?? -1) : b.updatedAt.localeCompare(a.updatedAt)));
  }, [docs, view, matches, sort, viewerId, trustOf, browsing, folderId, scope]);

  const subfolders = useMemo(() => (browsing ? childFolders(folders, folderId) : []), [browsing, folders, folderId]);
  /** Per folder: how many documents it holds (subfolders included), the newest change, and how many score below 50. */
  const folderStats = useCallback(
    (f: Folder) => {
      const inside = subtree(folders, f.id);
      const contents = (docs ?? []).filter((d) => d.folderId && inside.has(d.folderId));
      const unreliable = contents.filter((d) => (trustOf(d)?.score ?? 100) < 50).length;
      const latest = contents.reduce<DocRow | null>((a, d) => (!a || d.updatedAt > a.updatedAt ? d : a), null);
      return { count: contents.length, unreliable, latest };
    },
    [folders, docs, trustOf],
  );

  // ---- folder actions

  const request = async (url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) => {
    setFolderError(null);
    const res = await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
    return json;
  };
  const setFolders = (next: Folder[]) => setLoaded((l) => l && { ...l, folders: next });

  const saveName = async (name: string): Promise<string | null> => {
    if (!naming) return null;
    const parentId = naming.mode === "create" ? folderId : (naming.folder.parentId ?? null);
    const invalid = validateFolderName(folders, name, parentId, naming.mode === "rename" ? naming.folder.id : undefined);
    if (invalid) return invalid;
    try {
      const json = naming.mode === "create" ? await request("/api/folders", "POST", { name, parentId }) : await request(`/api/folders/${naming.folder.id}`, "PATCH", { name });
      setFolders(json.folders);
      setNaming(null);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  const removeFolder = async (f: Folder) => {
    setMenuFor(null);
    const { count } = folderStats(f);
    const into = folderLabel(folders, f.parentId) ?? "the top of the drive";
    const what = count || childFolders(folders, f.id).length ? ` Its contents move to ${into}; no documents are deleted.` : "";
    if (!confirm(`Delete the folder “${f.name}”?${what}`)) return;
    try {
      const json = await request(`/api/folders/${f.id}`, "DELETE");
      setFolders(json.folders);
      // Documents that were directly in it are now one level up.
      setLoaded((l) => l && { ...l, docs: l.docs.map((d) => (d.folderId === f.id ? { ...d, folderId: f.parentId } : d)) });
    } catch (e) {
      setFolderError((e as Error).message);
    }
  };

  // ---- trash

  const canRemove = (d: DocRow) => d.ownerId === viewerId || d.collaboratorIds.includes(viewerId);
  const moveToTrash = async (d: DocRow) => {
    setMenuFor(null);
    try {
      await request(`/api/docs/${d.id}/trash`, "POST");
      setLoaded((l) => l && { ...l, docs: l.docs.filter((x) => x.id !== d.id) });
      setTrashed({ id: d.id, title: d.title });
    } catch (e) {
      setFolderError((e as Error).message);
    }
  };
  const undoTrash = async () => {
    if (!trashed) return;
    try {
      await request(`/api/docs/${trashed.id}/restore`, "POST");
      setTrashed(null);
      setReload((n) => n + 1);
    } catch (e) {
      setFolderError((e as Error).message);
    }
  };

  /** Drops what's being dragged into `targetId` (null = the top of the drive). */
  const drop = async (targetId: string | null) => {
    const item = dragged;
    setDragged(null);
    setDropTarget(null);
    if (!item) return;
    try {
      if (item.kind === "doc") {
        const doc = docs?.find((d) => d.id === item.id);
        if (!doc || (doc.folderId ?? null) === targetId) return;
        await request(`/api/docs/${item.id}/folder`, "POST", { folderId: targetId });
        setLoaded((l) => l && { ...l, docs: l.docs.map((d) => (d.id === item.id ? { ...d, folderId: targetId ?? undefined } : d)) });
      } else {
        const folder = folders.find((f) => f.id === item.id);
        if (!folder || (folder.parentId ?? null) === targetId || !canMoveFolder(folders, item.id, targetId)) return;
        setFolders((await request(`/api/folders/${item.id}`, "PATCH", { parentId: targetId })).folders);
      }
    } catch (e) {
      setFolderError((e as Error).message);
    }
  };
  /** Props that make an element a drop target for documents and folders. */
  const dropZone = (targetId: string | null) => {
    const key = targetId ?? "root";
    const accepts = () => {
      const item = dragged;
      return !!item && (item.kind === "doc" || (item.id !== targetId && canMoveFolder(folders, item.id, targetId)));
    };
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!accepts()) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dropTarget !== key) setDropTarget(key);
      },
      onDragLeave: () => dropTarget === key && setDropTarget(null),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        drop(targetId);
      },
      "data-drop-active": dropTarget === key || undefined,
    };
  };
  const dragSource = (item: Dragged) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      setDragged(item);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", item.id);
    },
    onDragEnd: () => {
      setDragged(null);
      setDropTarget(null);
    },
  });

  const path = folderPath(folders, folderId);
  const select = "rounded-full border border-slate-300 bg-white py-1 pl-3 pr-2 text-sm text-slate-700 hover:bg-slate-50";
  const crumb = "rounded-full px-2 py-0.5 data-[drop-active]:bg-[#c2e7ff] data-[drop-active]:ring-2 data-[drop-active]:ring-[#0b57d0]";

  return (
    <main className="flex min-h-0 flex-1 flex-col rounded-2xl bg-white">
      {naming && (
        <NameDialog
          title={naming.mode === "create" ? "New folder" : "Rename folder"}
          where={naming.mode === "create" ? (folderLabel(folders, folderId) ?? "Top of the drive") : null}
          initial={naming.mode === "rename" ? naming.folder.name : "Untitled folder"}
          label="Folder name"
          action={naming.mode === "create" ? "Create" : "Rename"}
          onSubmit={saveName}
          onClose={() => setNaming(null)}
        />
      )}
      <div className="px-4 pt-5 sm:px-6">
        <div className="flex items-center gap-3">
          {!clientId && !view && path.length > 0 ? (
            <nav aria-label="Folder" className="flex min-w-0 flex-wrap items-center gap-0.5 text-2xl text-slate-800">
              <button onClick={() => openFolder(null)} className={`${crumb} -ml-2 text-slate-600 hover:bg-slate-100`} {...dropZone(null)}>Drive</button>
              {path.map((f, i) => (
                <Fragment key={f.id}>
                  <Icon name="chevron" size={22} color="#747775" />
                  {i === path.length - 1 ? (
                    <h1 className={`${crumb} truncate`}>{f.name}</h1>
                  ) : (
                    <button onClick={() => openFolder(f.id)} className={`${crumb} truncate text-slate-600 hover:bg-slate-100`} {...dropZone(f.id)}>{f.name}</button>
                  )}
                </Fragment>
              ))}
            </nav>
          ) : (
            <h1 className="text-2xl text-slate-800">{clientId ? clientName(clientId) ?? "Client" : "Drive"}</h1>
          )}
          {clientId && (
            <>
              <Link href={`/client/${clientId}`} className="rounded-full bg-[#0b57d0] px-3 py-1 text-xs font-medium text-white hover:bg-[#0842a0]">
                Client overview
              </Link>
              <Link href={`/conversations?client=${clientId}`} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50">
                Conversations
              </Link>
              <button onClick={() => setParam("client", null)} className="text-xs text-slate-500 hover:underline">Show all clients</button>
            </>
          )}
          {!view && !clientId && docs && (
            <button onClick={() => setNaming({ mode: "create" })} className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
              <Icon name="newFolder" size={18} color="#444746" /> New folder
            </button>
          )}
        </div>
        <div className="mt-3 flex items-center gap-1 overflow-x-auto border-b border-slate-200 [&>button]:shrink-0">
          {VIEWS.map((v) => {
            const active = (view ?? null) === v.id;
            const count = v.id === "radar" ? handovers.length : 0;
            return (
              <button
                key={v.label}
                onClick={() => setParam("view", v.id)}
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${active ? "border-[#0b57d0] font-medium text-[#0b57d0]" : "border-transparent text-slate-600 hover:text-slate-900"}`}
              >
                {v.label}
                {count > 0 && <span className="rounded-full bg-[#fce8e6] px-1.5 text-[11px] font-medium text-[#c5221f]">{count}</span>}
              </button>
            );
          })}
        </div>
        <div className={`flex flex-wrap items-center gap-2 py-3 ${view === "trash" ? "hidden" : ""}`}>
          <select value={team} onChange={(e) => setTeam(e.target.value)} className={select} aria-label="Team">
            <option value="">All teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={location} onChange={(e) => setLocation(e.target.value)} className={select} aria-label="Location">
            <option value="">All locations</option>
            {tax.locations.map((l) => <option key={l}>{l}</option>)}
          </select>
          {!clientId && clients.length > 0 && (
            <select value="" onChange={(e) => e.target.value && setParam("client", e.target.value)} className={select} aria-label="Client">
              <option value="">All clients</option>
              {myClients.length > 0 && (
                <optgroup label="My clients">
                  {myClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              )}
              <optgroup label={myClients.length ? "Other clients" : "Clients"}>
                {clients.filter((c) => !myClients.includes(c)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            </select>
          )}
          <select value={tag ?? ""} onChange={(e) => setParam("tag", e.target.value || null)} className={select} aria-label="Tag">
            <option value="">Any tag</option>
            <optgroup label="Document type">
              {tax.docTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </optgroup>
            {tax.topTopics.map((top) => (
              <optgroup key={top.id} label={top.label}>
                <option value={top.id}>{top.label} (all)</option>
                {tax.childrenOf(top.id).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </optgroup>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={select} aria-label="Status">
            <option value="">Any status</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          {filtered && (
            <span className="text-xs text-slate-500">
              {search && <>Matching “{search}” · </>}
              {scope && <>In {path.at(-1)?.name} and its subfolders · </>}
              <button onClick={() => { setTeam(""); setLocation(""); setStatus(""); setParam("tag", null); }} className="text-blue-700 hover:underline">Clear filters</button>
            </span>
          )}
          {view !== "radar" && (
            <div className="ml-auto flex items-center gap-1 rounded-full border border-slate-300 p-0.5 text-sm">
              {(["modified", "trust"] as const).map((s) => (
                <button key={s} onClick={() => setSort(s)} className={`rounded-full px-3 py-0.5 ${sort === s ? "bg-[#c2e7ff]" : "hover:bg-slate-100"}`}>
                  {s === "modified" ? "Last modified" : "Least trusted last"}
                </button>
              ))}
            </div>
          )}
        </div>
        {folderError && (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {folderError}
            <button onClick={() => setFolderError(null)} className="ml-auto text-xs hover:underline">Dismiss</button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 sm:px-4">
        {view === "trash" ? (
          <TrashView onRestored={() => setReload((n) => n + 1)} />
        ) : view === "radar" && docs ? (
          <HandoverRadar rows={radarRows} trustOf={trustOf} failed={failed} />
        ) : (
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 z-10 bg-white text-left text-slate-600">
              <tr className="border-b border-slate-200">
                <th className="px-2 py-3 font-medium">Name</th>
                {/* Narrower screens drop owner, then last modified, so the name stays readable. */}
                <th className="hidden w-44 px-2 font-medium lg:table-cell">Owner</th>
                <th className="hidden w-36 px-2 font-medium xl:table-cell">Last modified</th>
                <th className="w-48 px-2 font-medium sm:w-64 xl:w-[22rem]">Trust for you</th>
              </tr>
            </thead>
            <tbody>
              {!docs &&
                Array.from({ length: 8 }, (_, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td colSpan={4} className="px-2 py-4"><div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" /></td>
                  </tr>
                ))}
              {loadError && (
                <tr>
                  <td colSpan={4} className="py-3 text-center text-sm text-red-700">{loadError}</td>
                </tr>
              )}
              {subfolders.map((f) => {
                const stats = folderStats(f);
                return (
                  <tr
                    key={f.id}
                    {...dragSource({ kind: "folder", id: f.id })}
                    {...dropZone(f.id)}
                    onClick={() => openFolder(f.id)}
                    className="group cursor-pointer border-b border-slate-100 hover:bg-slate-50 data-[drop-active]:bg-[#e8f0fe] data-[drop-active]:outline data-[drop-active]:outline-2 data-[drop-active]:-outline-offset-2 data-[drop-active]:outline-[#0b57d0]"
                  >
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-3">
                        <Icon name="folder" size={24} color="#5f6368" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-slate-800">{f.name}</div>
                          <div className="truncate text-xs text-slate-500">
                            {stats.count === 0 ? "Empty" : `${stats.count} document${stats.count === 1 ? "" : "s"}`}
                            {childFolders(folders, f.id).length > 0 && ` · ${childFolders(folders, f.id).length} folder${childFolders(folders, f.id).length === 1 ? "" : "s"}`}
                          </div>
                        </div>
                        <div className="relative" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => setMenuFor(menuFor === f.id ? null : f.id)}
                            className="rounded-full p-1.5 text-slate-600 opacity-60 hover:bg-slate-200 group-hover:opacity-100"
                            aria-label={`Actions for ${f.name}`}
                          >
                            <Icon name="more" size={18} color="#444746" />
                          </button>
                          {menuFor === f.id && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />
                              <div className="absolute right-0 top-8 z-20 w-40 rounded-xl bg-white py-1.5 shadow-xl ring-1 ring-black/5">
                                <button onClick={() => { setMenuFor(null); setNaming({ mode: "rename", folder: f }); }} className="block w-full px-4 py-1.5 text-left text-sm hover:bg-slate-100">Rename</button>
                                <button onClick={() => removeFolder(f)} className="block w-full px-4 py-1.5 text-left text-sm text-[#c5221f] hover:bg-slate-100">Delete folder</button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-2 text-slate-400 lg:table-cell">—</td>
                    <td className="hidden px-2 text-slate-600 xl:table-cell">{stats.latest ? timeAgo(stats.latest.updatedAt) : <span className="text-slate-400">—</span>}</td>
                    <td className="px-2 py-2 text-xs">
                      {stats.unreliable > 0 ? (
                        <span className="font-medium text-[#c5221f]">{stats.unreliable} unreliable for you</span>
                      ) : stats.count > 0 ? (
                        <span className="text-slate-500">Nothing unreliable</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {docs && shown.length === 0 && subfolders.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-16 text-center text-slate-500">
                    {view === "attention"
                      ? "Nothing here – every document scores at least 50 for you."
                      : browsing && folderId
                        ? "This folder is empty. Drag documents or folders here, or use New to add a document."
                        : "No documents match."}
                  </td>
                </tr>
              )}
              {shown.map((d) => {
                const owner = person(d.ownerId);
                const trust = trustOf(d);
                const band = trust ? trustBand(trust.score) : null;
                const reason = trust && trust.score >= 75 ? d.strength : d.issue;
                // Outside a folder's own listing, say where each result lives.
                const where = browsing ? null : folderLabel(folders, d.folderId);
                return (
                  <tr
                    key={d.id}
                    {...dragSource({ kind: "doc", id: d.id })}
                    className="group cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                    onClick={() => router.push(`/doc/${d.id}`)}
                    // Right-click opens the same menu as the ⋮ button, as in Google Drive.
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenuFor(d.id);
                    }}
                  >
                    <td className="px-2 py-2.5">
                      <Link href={`/doc/${d.id}`} className="flex items-center gap-3" onClick={(e) => e.stopPropagation()} draggable={false}>
                        <FileIcon kind={d.kind} />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-800">{d.title}</div>
                          <div className="flex items-center gap-1.5 truncate text-xs text-slate-500">
                            {d.confidential && <ConfidentialPill />}
                            {d.status !== "Completed" && <StatusPill status={d.status} />}
                            {d.clientId && <span className="rounded-full bg-slate-100 px-1.5 text-slate-600">{clientName(d.clientId)}</span>}
                            {where && (
                              <span className="flex shrink-0 items-center gap-0.5 text-slate-600">
                                <Icon name="folder" size={12} color="#747775" /> {where} ·
                              </span>
                            )}
                            <span className="truncate">{teamName(d.teamId)} · {formatLocations(d.locations)}</span>
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
                        <div className="min-w-0 flex-1">
                          {band && <div className="text-xs font-medium" style={{ color: band.color }}>{band.label}</div>}
                          {reason && <div className="truncate text-xs text-slate-500" title={reason}>{reason}</div>}
                        </div>
                        <div className="relative" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => setMenuFor(menuFor === d.id ? null : d.id)}
                            className="rounded-full p-1.5 opacity-60 hover:bg-slate-200 group-hover:opacity-100"
                            aria-label={`Actions for ${d.title}`}
                          >
                            <Icon name="more" size={18} color="#444746" />
                          </button>
                          {menuFor === d.id && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />
                              <div className="absolute right-0 top-8 z-20 w-48 rounded-xl bg-white py-1.5 shadow-xl ring-1 ring-black/5">
                                <button onClick={() => { setMenuFor(null); router.push(`/doc/${d.id}`); }} className="block w-full px-4 py-1.5 text-left text-sm hover:bg-slate-100">Open</button>
                                {canRemove(d) ? (
                                  <button onClick={() => moveToTrash(d)} className="block w-full px-4 py-1.5 text-left text-sm text-[#c5221f] hover:bg-slate-100">Move to trash</button>
                                ) : (
                                  <div className="px-4 py-1.5 text-xs text-slate-500">Only the owner and collaborators can remove it</div>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {browsing && docs && (subfolders.length > 0 || shown.length > 0) && (
          <p className="px-2 py-3 text-xs text-slate-400">Drag a document or folder onto a folder, or onto the path above, to move it. Right-click a document for more.</p>
        )}
      </div>
      {trashed && (
        <div role="status" className="fixed bottom-20 left-1/2 z-30 flex -translate-x-1/2 items-center gap-4 rounded-lg bg-[#303030] px-4 py-3 text-sm text-white shadow-xl sm:bottom-6">
          <span className="max-w-[60vw] truncate">“{trashed.title}” moved to trash</span>
          <button onClick={undoTrash} className="font-medium text-[#a8c7fa] hover:underline">Undo</button>
          <button onClick={() => setTrashed(null)} aria-label="Close" className="text-white/70 hover:text-white">✕</button>
        </div>
      )}
    </main>
  );
}

type TrashedDoc = { id: string; title: string; kind: Doc["kind"]; ownerId: string | null; trashedAt: string; trashedById: string | null };

/** The trash: documents the viewer owns or removed. Restore them, or delete them for good. */
function TrashView({ onRestored }: { onRestored: () => void }) {
  const { viewerId, person } = useApp();
  const [docs, setDocs] = useState<TrashedDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/trash")
      .then((r) => r.json())
      .then((j) => !cancelled && setDocs(j.docs))
      .catch(() => !cancelled && setError("Could not load the trash."));
    return () => {
      cancelled = true;
    };
  }, [viewerId]);

  const act = async (d: TrashedDoc, method: "POST" | "DELETE") => {
    if (method === "DELETE" && !confirm(`Delete “${d.title}” forever? Its history and trust scores go with it. This can't be undone.`)) return;
    setBusy(d.id);
    setError(null);
    try {
      const res = await fetch(method === "POST" ? `/api/docs/${d.id}/restore` : `/api/docs/${d.id}`, { method });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setDocs((ds) => ds && ds.filter((x) => x.id !== d.id));
      if (method === "POST") onRestored();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="py-2">
      <p className="mb-2 rounded-lg bg-[#f0f4f9] px-3 py-2 text-xs text-slate-600">
        Documents in the trash are hidden from the drive, search, scores and checks. Restore one to put it back where it was, or delete it forever. You see the documents you own and the ones you removed.
      </p>
      {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!docs ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading the trash…</p>
      ) : docs.length === 0 ? (
        <p className="py-16 text-center text-slate-500">The trash is empty.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {docs.map((d) => {
            const by = person(d.trashedById);
            return (
              <li key={d.id} className="flex items-center gap-3 px-2 py-2.5">
                <FileIcon kind={d.kind} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-800">{d.title}</div>
                  <div className="text-xs text-slate-500">
                    Removed {timeAgo(d.trashedAt)} by {d.trashedById === viewerId ? "you" : (by?.name ?? "someone")}
                  </div>
                </div>
                <button onClick={() => act(d, "POST")} disabled={busy === d.id} className="shrink-0 rounded-full px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50 disabled:opacity-50">
                  Restore
                </button>
                <button onClick={() => act(d, "DELETE")} disabled={busy === d.id} className="shrink-0 rounded-full px-3 py-1 text-xs font-medium text-[#c5221f] hover:bg-red-50 disabled:opacity-50">
                  Delete forever
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
