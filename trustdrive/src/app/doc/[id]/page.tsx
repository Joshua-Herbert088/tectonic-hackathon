"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppContext";
import { SaveGateDialogs, selectLine, useSaveGate } from "@/components/ConflictDialog";
import { useCompose } from "@/components/Compose";
import { AnswerCard } from "@/components/Expertise";
import { FileIcon } from "@/components/FileIcon";
import { Icon } from "@/components/Icons";
import { Markdown, type LineMark } from "@/components/Markdown";
import { RecentOverlap } from "@/components/RecentOverlap";
import { ConfidentialPill, StatusPill } from "@/components/StatusPill";
import { LegalBadge } from "@/components/LegalBadge";
import type { QuietNotice } from "@/lib/quiet";
import { ConfidentialSwitch } from "@/components/UploadDialog";
import { AppShell } from "@/components/AppShell";
import { Avatar } from "@/components/TopBar";
import { TrustBadge, trustBand } from "@/components/TrustBadge";
import { useScores } from "@/components/useScores";
import { AppliesToLabel, TagChip, TagDialog, type DocMeta } from "@/components/Tags";
import { formatLocations } from "@/lib/appliesTo";
import { VersionHistory } from "@/components/VersionHistory";
import { WhoToContact } from "@/components/WhoToContact";
import type { Contact, FormerContributor } from "@/lib/contacts";
import { folderLabel, folderOptions } from "@/lib/folders";
import { handoverFor } from "@/lib/handover";
import { timeAgo } from "@/lib/time";
import { STATUSES, type AnswerView, type Client, type ConflictOverride, type Conversation, type Doc, type Doubt, type Folder, type GovernanceSnapshot, type Signal, type TrustScore } from "@/lib/types";

/** Non-breaking spaces: an option's text can't be indented with padding. */
const INDENT = "\u00a0\u00a0\u00a0";
const LEVEL_NAMES =["Don't rely on it", "Likely outdated", "Uncertain", "Probably reliable", "Reliable", "Authoritative"];

interface Detail {
  doc: Doc;
  trust: TrustScore | null;
  history: { score: number; computedAt: string }[];
  signals: Signal[];
  doubts: Doubt[];
  related: (Omit<Doc, "content"> & { trust: TrustScore | null })[];
  jevInput: unknown;
  governance: GovernanceSnapshot;
  conflictDecisions: { made: ConflictOverride[]; against: (ConflictOverride & { docTitle: string })[] };
  people: { contacts: Contact[]; former: FormerContributor[] };
  client: Client | null;
  sources: Conversation[];
  folders: Folder[];
  /** Answers colleagues gave in chat on this document's topics, ones that contradict it first. */
  answers: AnswerView[];
  /** Set when nobody opened, edited or verified it for a long time (only when the page is opened). */
  quiet?: QuietNotice | null;
}

export default function DocPage() {
  const { id } = useParams<{ id: string }>();
  const { viewerId } = useApp();
  // A fresh instance per document and viewer, so no state carries over between them.
  return <DocView key={`${id}:${viewerId}`} id={id} viewerId={viewerId} />;
}

function DocView({ id, viewerId }: { id: string; viewerId: string }) {
  const { person, teamName, teams, people, taxonomy } = useApp();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [trust, setTrust] = useState<TrustScore | null>(null);
  const [previous, setPrevious] = useState<number | null>(null);
  const [scoring, setScoring] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", content: "" });
  const [showInput, setShowInput] = useState(false);
  const [justVerified, setJustVerified] = useState(false);
  const [live, setLive] = useState<{ key: string; doubts?: Doubt[]; error?: string } | null>(null);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [showMarks, setShowMarks] = useState(true);
  const [handedTo, setHandedTo] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  // The score shown before a rescore, to display the change ("▲ from 34").
  const trustRef = useRef<TrustScore | null>(null);
  useEffect(() => {
    trustRef.current = trust;
  }, [trust]);

  const rescore = useCallback(async () => {
    setScoring(true);
    setScoreError(null);
    try {
      const res = await fetch(`/api/docs/${id}/score`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setTrust(json.trust);
      // Estimates aren't stored, so they don't belong in the score history either.
      if (!json.trust.fallback) setDetail((d) => d && { ...d, history: [...d.history, { score: json.trust.score, computedAt: json.trust.computedAt }] });
    } catch (e) {
      setScoreError((e as Error).message);
    } finally {
      setScoring(false);
    }
  }, [id]);

  const apply = useCallback(
    (d: Detail) => {
      setDetail(d);
      if (d.trust) setTrust(d.trust);
      else {
        // Inputs changed → remember the old score so we can show the delta, then ask Jev again.
        if (trustRef.current) setPrevious(trustRef.current.score);
        rescore();
      }
    },
    [rescore],
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/docs/${id}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok || !d?.doc) throw new Error(r.status === 404 ? "This document doesn't exist – it may have been moved to the trash (Drive → Trash), or the link is wrong." : (d?.error ?? "Could not load this document."));
        return d as Detail;
      })
      .then((d) => {
        if (cancelled) return;
        apply(d);
        const params = new URLSearchParams(window.location.search);
        if (params.get("edit")) {
          setDraft({ title: d.doc.title, content: d.doc.content });
          setEditing(true);
        }
        // Arriving from a handover on the drive: show how the score moves.
        if (params.get("from")) {
          setPrevious(Number(params.get("from")));
          setHandedTo(d.doc.ownerId);
          window.history.replaceState(null, "", window.location.pathname);
        }
      })
      .catch((e: unknown) => !cancelled && setLoadError(e instanceof Error ? e.message : "Could not load this document."));
    return () => {
      cancelled = true;
    };
  }, [id, viewerId, apply]);

  const [actionError, setActionError] = useState<string | null>(null);

  /** Runs a request that answers with the updated document; errors are shown instead of replacing the page. */
  const act = async (url: string, method: "PATCH" | "POST", body: Record<string, unknown>) => {
    setActionError(null);
    try {
      const res = await fetch(url, { method, body: JSON.stringify({ ...body }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      apply(json);
      return true;
    } catch (e) {
      setActionError((e as Error).message);
      return false;
    }
  };

  const patch = (body: Record<string, unknown>) => act(`/api/docs/${id}`, "PATCH", body);

  const verify = async () => {
    if (await act(`/api/docs/${id}/verify`, "POST", {})) setJustVerified(true);
  };

  // A document is tagged before its content is first saved: a new blank one, or an old one that never was.
  const [taggingOpen, setTaggingOpen] = useState(false);
  // What the tag dialog confirmed, sent with the save that follows (and its retries after a conflict).
  const confirmedTags = useRef<DocMeta | null>(null);

  const saveGate = useSaveGate<Detail>({
    send: ({ overrideReason, acknowledgeSimilar }) =>
      fetch(`/api/docs/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...draft, ...(confirmedTags.current ?? {}), override: overrideReason ? { reason: overrideReason } : undefined, acknowledgeSimilar }),
      }),
    onSaved: (d) => {
      confirmedTags.current = null;
      apply(d);
      setEditing(false);
    },
  });
  const save = () => {
    if (!confirmedTags.current && detail && taxonomy.missingTags(detail.doc.tags).length) setTaggingOpen(true);
    else saveGate.save();
  };

  /** Filing a document isn't an edit: the score and history stay as they are. */
  const moveTo = async (folderId: string | null) => {
    setActionError(null);
    const res = await fetch(`/api/docs/${id}/folder`, { method: "POST", body: JSON.stringify({ folderId }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setActionError(json.error ?? `Request failed (${res.status})`);
    setDetail((d) => d && { ...d, doc: { ...d.doc, folderId: folderId ?? undefined } });
  };

  const transfer = async (ownerId: string) => {
    if (await act(`/api/docs/${id}/owner`, "POST", { ownerId })) setHandedTo(ownerId);
  };

  // Contradictions with other documents take a few Jev calls, so they arrive after the page.
  // Keyed by the document version, so results for an older version are never shown.
  const docKey = detail && `${detail.doc.id}@${detail.doc.updatedAt}@${detail.doc.locations}@${detail.doc.teamId}`;
  useEffect(() => {
    if (!docKey) return;
    let cancelled = false;
    fetch(`/api/docs/${id}/doubts`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error);
        if (!cancelled) setLive({ key: docKey, doubts: json.doubts });
      })
      .catch((e) => !cancelled && setLive({ key: docKey, error: (e as Error).message }));
    return () => {
      cancelled = true;
    };
  }, [id, docKey]);
  const liveDoubts = live?.key === docKey ? (live.doubts ?? null) : null;
  const doubtError = live?.key === docKey ? (live.error ?? null) : null;

  const doubts = useMemo(() => [...(detail?.doubts ?? []), ...(liveDoubts ?? [])].sort((a, b) => a.lineNo - b.lineNo || (a.tone === "bad" ? -1 : 1)), [detail?.doubts, liveDoubts]);
  const marks = useMemo(() => {
    const out: Record<number, LineMark> = {};
    for (const d of doubts) {
      const m = out[d.lineNo];
      out[d.lineNo] = { tone: m?.tone === "bad" || d.tone === "bad" ? "bad" : "warn", label: m ? `${m.label}\n${d.text}` : d.text };
    }
    return out;
  }, [doubts]);

  /** Highlight a doubtful line in both the document and the panel. */
  const focusLine = (lineNo: number, from: "doc" | "panel") => {
    setActiveLine(lineNo);
    if (from === "doc") document.querySelector(`[data-doubt-line="${lineNo}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    else if (editing) selectLine(editorRef.current, lineNo);
    else document.querySelector(`[data-line="${lineNo}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const related = useScores(detail?.related ?? null, viewerId);
  const [tab, setTab] = useState<"why" | "people" | "history" | "details">("why");
  // "Edit tags" in the Details tab: the same dialog, saving only the tags.
  const [editingTags, setEditingTags] = useState(false);

  if (!detail) {
    return (
      <AppShell compact>
        <div className="grid flex-1 place-items-center rounded-2xl bg-white text-slate-500">
          {loadError ? (
            <div className="text-center">
              <p>{loadError}</p>
              <Link href="/drive" className="mt-2 inline-block text-blue-700 hover:underline">Back to the drive</Link>
            </div>
          ) : "Loading…"}
        </div>
      </AppShell>
    );
  }

  const { doc, signals, governance } = detail;
  const owner = person(doc.ownerId);
  const band = trust ? trustBand(trust.score) : null;
  const good = signals.filter((s) => s.tone === "good");
  const bad = signals.filter((s) => s.tone === "bad" || s.tone === "warn");
  const neutral = signals.filter((s) => s.tone === "neutral");
  const canEdit = doc.ownerId === viewerId || doc.collaboratorIds.includes(viewerId);
  const handover = people.length ? handoverFor(doc, people, teams) : null;
  // One plain sentence on why, from the strongest facts: problems first unless it's trusted.
  const reasons = trust && trust.score >= 75 ? good : bad.length ? bad : good;
  const verdict = reasons.slice(0, 2).map((s) => s.text).join(" · ");
  const folder = folderLabel(detail.folders, doc.folderId);
  const driveHref = doc.folderId && folder ? `/drive?folder=${doc.folderId}` : "/drive";
  const tabs = [
    { id: "why" as const, label: "Why", count: doubts.length },
    { id: "people" as const, label: "People", count: handover ? 1 : 0 },
    { id: "history" as const, label: "History", count: 0 },
    { id: "details" as const, label: "Details", count: 0 },
  ];

  return (
    <AppShell compact>
      {taggingOpen && (
        <TagDialog
          title={draft.title}
          content={draft.content}
          initial={metaOf(doc)}
          confidential={!!doc.confidential}
          action="Save"
          onClose={() => setTaggingOpen(false)}
          onConfirm={(m) => {
            setTaggingOpen(false);
            confirmedTags.current = m;
            saveGate.save();
          }}
        />
      )}
      {editingTags && (
        <TagDialog
          title={doc.title}
          content={doc.content}
          initial={metaOf(doc)}
          heading="Edit tags"
          confidential={!!doc.confidential}
          action="Save tags"
          onClose={() => setEditingTags(false)}
          onConfirm={async (m) => {
            if (await patch({ ...m })) setEditingTags(false);
          }}
        />
      )}
      <SaveGateDialogs gate={saveGate} onEditMine={(lineNo) => setTimeout(() => selectLine(editorRef.current, lineNo), 50)} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto lg:flex-row lg:overflow-visible">
        {/* Document */}
        <main className="flex min-w-0 shrink-0 flex-col rounded-2xl bg-white lg:min-h-0 lg:flex-1 lg:shrink">
          <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-3">
            <Link href={driveHref} className="mt-0.5 rounded-full p-2 hover:bg-slate-100" aria-label={folder ? `Back to ${folder}` : "Back to the drive"}>
              <svg width="20" height="20" viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2Z" fill="#444746" /></svg>
            </Link>
            <FileIcon kind={doc.kind} size={24} />
            <div className="min-w-0 flex-1">
              {editing ? (
                <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="w-full rounded border border-slate-300 px-2 py-1 text-lg outline-none focus:border-blue-500" />
              ) : (
                <h1 className="truncate text-lg text-slate-900">{doc.title}</h1>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                <StatusPill status={doc.status} />
                {doc.confidential && <ConfidentialPill />}
                {folder && (
                  <Link href={driveHref} className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 hover:underline" title="Open the folder">
                    <Icon name="folder" size={13} color="#5f6368" /> {folder}
                  </Link>
                )}
                {detail.client && (
                  <Link href={`/drive?client=${detail.client.id}`} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 hover:underline">{detail.client.name}</Link>
                )}
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{teamName(doc.teamId)}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700" title="Applies to">
                  <AppliesToLabel locations={doc.locations} teamIds={doc.audienceTeamIds} />
                </span>
                <span>edited {timeAgo(doc.updatedAt)} by {person(doc.lastEditedById)?.name ?? "unknown"}</span>
              </div>
              <LegalBadge doc={doc} />
            </div>
            {editing ? (
              <div className="flex shrink-0 gap-2">
                <button onClick={() => { confirmedTags.current = null; setEditing(false); }} className="rounded-full px-4 py-1.5 text-sm text-blue-700 hover:bg-blue-50">Cancel</button>
                <button
                  onClick={save}
                  disabled={saveGate.busy}
                  className="rounded-full bg-[#0b57d0] px-5 py-1.5 text-sm font-medium text-white hover:bg-[#0842a0] disabled:opacity-60"
                >
                  {saveGate.busy ? "Checking for conflicts…" : "Save"}
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setDraft({ title: doc.title, content: doc.content });
                  setEditing(true);
                }}
                className="shrink-0 rounded-full bg-[#c2e7ff] px-5 py-1.5 text-sm font-medium text-slate-900 hover:bg-[#b3dcf7]"
              >
                Edit
              </button>
            )}
          </div>

          <RecentOverlap docId={doc.id} viewerId={viewerId} />
          {detail.quiet && !editing && <QuietBanner notice={detail.quiet} ownerId={doc.ownerId} title={doc.title} onVerify={verify} />}
          {saveGate.error && !saveGate.mode && <div className="bg-red-50 px-5 py-2 text-sm text-red-700">{saveGate.error}</div>}
          {actionError && <div className="bg-red-50 px-5 py-2 text-sm text-red-700">{actionError}</div>}
          {!editing && doubts.length > 0 && showMarks && (
            <div className="flex items-center gap-2 border-b border-slate-100 bg-[#fffbf0] px-5 py-1.5 text-xs text-[#7a4a00]">
              {doubts.length} line{doubts.length === 1 ? "" : "s"} highlighted – click one to see why.
              <button onClick={() => setShowMarks(false)} className="ml-auto text-blue-700 hover:underline">Hide highlights</button>
            </div>
          )}
          <div className="bg-[#f9fbfd] py-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:py-8">
            <div className="mx-auto min-h-full max-w-[816px] bg-white px-5 py-6 sm:px-10 sm:py-10 lg:px-16 lg:py-14 shadow-[0_1px_3px_rgba(60,64,67,.15),0_1px_2px_rgba(60,64,67,.3)]">
              {editing ? (
                <textarea
                  ref={editorRef}
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  className="h-[60vh] w-full resize-none font-mono text-sm leading-6 outline-none"
                  autoFocus
                />
              ) : (
                <Markdown
                  text={doc.content}
                  marks={showMarks ? marks : undefined}
                  activeLine={activeLine}
                  onMark={(n) => {
                    setTab("why");
                    focusLine(n, "doc");
                  }}
                />
              )}
            </div>
          </div>
        </main>

        {/* Trust panel: the verdict first, the evidence in tabs */}
        <aside className="flex w-full shrink-0 flex-col rounded-2xl bg-white lg:w-[400px] lg:overflow-hidden">
          <section className="border-b border-slate-100 p-5">
            <div className="flex items-start gap-4">
              <TrustBadge trust={scoring ? null : trust} loading={scoring || (!trust && !scoreError)} error={!!scoreError} size={72} />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Trust for you</div>
                {trust && !scoring ? (
                  <>
                    <div className="flex items-baseline gap-2">
                      <span className="text-xl font-medium" style={{ color: band!.color }}>{band!.label}</span>
                      {previous !== null && previous !== trust.score && (
                        <span className={`text-sm font-medium ${trust.score > previous ? "text-[#188038]" : "text-[#c5221f]"}`}>
                          {trust.score > previous ? "▲" : "▼"} from {previous}
                        </span>
                      )}
                    </div>
                    {verdict && <p className="mt-1 text-sm leading-5 text-slate-700">{verdict}</p>}
                    {trust.fallback && <p className="mt-1 text-[11px] text-slate-500">{trust.fallback.confidential ? "Estimated with fixed rules – this document is confidential, so it's never sent to Jev." : "Estimated with fixed rules – Jev is unavailable."}</p>}
                  </>
                ) : (
                  <div className="text-sm text-slate-500">{scoreError ? "Scoring failed" : "Asking Jev…"}</div>
                )}
              </div>
            </div>
            {scoreError && <div className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{scoreError}</div>}
            <button
              onClick={verify}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-[#0b57d0] px-4 py-2 text-sm font-medium text-white hover:bg-[#0842a0]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z" fill="#fff" /></svg>
              {justVerified ? "Verified – thanks!" : "I confirm this document is correct"}
            </button>
          </section>

          <div className="flex border-b border-slate-100 px-3" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`-mb-px flex items-center gap-1 border-b-2 px-3 py-2.5 text-sm ${tab === t.id ? "border-[#0b57d0] font-medium text-[#0b57d0]" : "border-transparent text-slate-600 hover:text-slate-900"}`}
              >
                {t.label}
                {t.count > 0 && <span className="rounded-full bg-[#fef7e0] px-1.5 text-[11px] font-medium text-[#b06000]">{t.count}</span>}
              </button>
            ))}
          </div>

          <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {tab === "why" && (
              <>
                <section className="border-b border-slate-100 p-5">
                  {bad.length > 0 && (
                    <>
                      <h3 className="mb-2 text-sm font-medium text-slate-800">Watch out</h3>
                      <ul className="mb-4 space-y-2">{bad.map((s, i) => <SignalRow key={i} s={s} />)}</ul>
                    </>
                  )}
                  {good.length > 0 && (
                    <>
                      <h3 className="mb-2 text-sm font-medium text-slate-800">What&apos;s good</h3>
                      <ul className="mb-4 space-y-2">{good.map((s, i) => <SignalRow key={i} s={s} />)}</ul>
                    </>
                  )}
                  {neutral.length > 0 && <ul className="space-y-2">{neutral.map((s, i) => <SignalRow key={i} s={s} />)}</ul>}
                </section>
                <section className="border-b border-slate-100 p-5">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-slate-800">Doubts in the text</h3>
                    {doubts.length > 0 && !editing && (
                      <button onClick={() => setShowMarks(!showMarks)} className="text-xs text-blue-700 hover:underline">
                        {showMarks ? "Hide" : "Show"} highlights
                      </button>
                    )}
                  </div>
                  {!liveDoubts && !doubtError && (
                    <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-[#0b57d0]" />
                      Checking each line against other documents…
                    </div>
                  )}
                  {doubtError && <div className="mb-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">Couldn&apos;t check for contradictions: {doubtError}</div>}
                  {liveDoubts && doubts.length === 0 && <p className="text-sm text-slate-600">No line looks outdated or contradicts another document.</p>}
                  <ul className="space-y-2">
                    {doubts.map((d) => (
                      <DoubtRow key={d.key} d={d} active={d.lineNo === activeLine} onFocus={() => focusLine(d.lineNo, "panel")} />
                    ))}
                  </ul>
                </section>
                {(detail.conflictDecisions.made.length > 0 || detail.conflictDecisions.against.length > 0) && (
                  <section className="p-5">
                    <h3 className="mb-1 text-sm font-medium text-slate-800">Known exceptions</h3>
                    <p className="mb-3 text-[11px] text-slate-500">Saved despite a contradiction, with the reason. Read these before “fixing” a line.</p>
                    <ul className="space-y-3">
                      {detail.conflictDecisions.made.map((o) => (
                        <OverrideRow key={`m${o.id}`} o={o} otherId={o.existingDocId} otherTitle={o.existingTitle} ours={{ no: o.lineNo, text: o.lineText }} theirs={{ no: o.existingLineNo, text: o.existingLineText }} />
                      ))}
                      {detail.conflictDecisions.against.map((o) => (
                        <OverrideRow key={`a${o.id}`} o={o} otherId={o.docId} otherTitle={o.docTitle} ours={{ no: o.existingLineNo, text: o.existingLineText }} theirs={{ no: o.lineNo, text: o.lineText }} />
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}

            {tab === "people" && (
              <>
                {handover && (
                  <section className="border-b border-slate-100 p-5">
                    <div className="rounded-xl bg-[#fef7e0] p-3">
                      <div className="text-sm font-medium text-slate-900">Handover needed</div>
                      <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
                        {handover.reasons.map((r, i) => <li key={i}>• {r.text}</li>)}
                      </ul>
                      {handover.formerOwnerId && (
                        <p className="mt-2 text-xs text-slate-600">{person(handover.formerOwnerId)?.name} is still at the company – ask them what changed before taking over.</p>
                      )}
                      {handover.successors.length > 0 && <div className="mb-1 mt-3 text-[11px] font-medium uppercase tracking-wide text-slate-500">Suggested new owner</div>}
                      <ul className="space-y-1.5">
                        {handover.successors.map((s) => {
                          const p = person(s.personId);
                          return (
                            <li key={s.personId} className="flex items-center gap-2">
                              <Avatar person={p} size={24} />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm text-slate-800">{s.personId === viewerId ? "You" : p?.name}</div>
                                <div className="truncate text-[11px] text-slate-500">{s.why.join(" · ")}</div>
                              </div>
                              <button onClick={() => transfer(s.personId)} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50">
                                {s.personId === viewerId ? "Take over" : "Assign"}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                        {doc.ownerId !== viewerId && !handover.successors.some((s) => s.personId === viewerId) && (
                          <button onClick={() => transfer(viewerId)} className="text-xs font-medium text-blue-700 hover:underline">Take ownership myself</button>
                        )}
                        {owner && (
                          <Link href={`/handover/${owner.id}`} className="text-xs font-medium text-blue-700 hover:underline">Handover briefing for {owner.name} →</Link>
                        )}
                      </div>
                    </div>
                  </section>
                )}
                {handedTo && !handover && (
                  <div className="m-5 rounded-xl bg-[#e6f4ea] p-3 text-xs text-[#0d652d]">
                    Handed over to <span className="font-medium">{handedTo === viewerId ? "you" : person(handedTo)?.name}</span>. The document was rescored with its new owner.
                  </div>
                )}
                <WhoToContact docTitle={doc.title} contacts={detail.people.contacts} former={detail.people.former} />
                {detail.answers.length > 0 && (
                  <section className="border-b border-slate-100 p-5">
                    <h3 className="text-sm font-medium text-slate-800">Asked before in chat</h3>
                    <p className="mb-3 text-[11px] text-slate-500">Questions colleagues answered by email or Teams on this document&apos;s topics.</p>
                    <div className="space-y-2">
                      {detail.answers.map((a) => (
                        <AnswerCard key={a.id} a={a} className="text-xs" />
                      ))}
                    </div>
                  </section>
                )}
                <section className="border-b border-slate-100 p-5">
                  <h3 className="mb-3 text-sm font-medium text-slate-800">People with access</h3>
                  <PersonRow label="Owner" id={doc.ownerId} />
                  {doc.collaboratorIds.map((c) => <PersonRow key={c} label="Collaborator" id={c} />)}
                  {doc.readerIds.length > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="w-24 text-xs text-slate-500">Readers</span>
                      <div className="flex -space-x-1.5">{doc.readerIds.map((r) => <Avatar key={r} person={person(r)} size={24} />)}</div>
                    </div>
                  )}
                  {!owner && <div className="mt-2 text-xs text-[#c5221f]">This document has no owner.</div>}
                </section>
                {detail.sources.length > 0 && (
                  <section className="p-5">
                    <h3 className="text-sm font-medium text-slate-800">Written from {detail.sources.length} conversation{detail.sources.length === 1 ? "" : "s"}</h3>
                    <p className="mb-2 text-[11px] text-slate-500">Each line cites one of these by its letter. Open one to check what was said.</p>
                    <ul className="space-y-1">
                      {[...detail.sources].sort((a, b) => (a.messages[0]?.sentAt ?? a.createdAt).localeCompare(b.messages[0]?.sentAt ?? b.createdAt)).map((c, i) => (
                        <li key={c.id}>
                          <Link href={`/conversations?c=${c.id}`} className="-mx-2 flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50">
                            <span className="w-5 text-xs text-slate-500">[{"abcdefghijklmnopqrstuvwxyz"[i % 26]}]</span>
                            <span className="text-xs">{c.source === "email" ? "✉" : "💬"}</span>
                            <span className="min-w-0 flex-1 truncate text-slate-800">{c.title}</span>
                            <span className="shrink-0 text-[11px] text-slate-500">{c.messages.length} msg · {timeAgo(c.messages.at(-1)?.sentAt ?? c.createdAt)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}

            {tab === "history" && (
              <>
                {detail.history.length > 1 && (
                  <section className="border-b border-slate-100 p-5">
                    <History points={detail.history} />
                  </section>
                )}
                <VersionHistory versions={governance.versionHistory} />
              </>
            )}

            {tab === "details" && (
              <>
                <section className="border-b border-slate-100 p-5">
                  <h3 className="mb-3 text-sm font-medium text-slate-800">Details</h3>
                  <div className="grid grid-cols-[100px_1fr] items-center gap-2 text-sm">
                    <label className="text-xs text-slate-500" htmlFor="doc-status">Status</label>
                    <select id="doc-status" value={doc.status} onChange={(e) => patch({ status: e.target.value })} disabled={!canEdit} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 disabled:opacity-60">
                      {STATUSES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                    <span className="text-xs text-slate-500">Maintained by</span>
                    <span className="px-2 text-slate-800" title="The team of whoever created the document">{teamName(doc.teamId)}</span>
                  </div>
                  <div className="mt-3">
                    <ConfidentialSwitch checked={!!doc.confidential} onChange={(on) => patch({ confidential: on })} disabled={!canEdit} />
                  </div>
                  <div className="mt-3 grid grid-cols-[100px_1fr] items-center gap-2 text-sm">
                    <label className="text-xs text-slate-500" htmlFor="doc-folder">Folder</label>
                    <select id="doc-folder" value={doc.folderId ?? ""} onChange={(e) => moveTo(e.target.value || null)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5">
                      <option value="">Top of the drive</option>
                      {folderOptions(detail.folders).map(({ folder: f, depth }) => (
                        <option key={f.id} value={f.id}>{`${INDENT.repeat(depth)}${f.name}`}</option>
                      ))}
                    </select>
                  </div>
                  {!canEdit && <p className="mt-2 text-[11px] text-slate-500">Only the owner and collaborators can change the status and tags.</p>}
                </section>
                <section className="border-b border-slate-100 p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-slate-800">Tags</h3>
                    {canEdit && (
                      <button onClick={() => setEditingTags(true)} className="rounded-full bg-white px-3 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50">
                        Edit tags
                      </button>
                    )}
                  </div>
                  <dl className="grid grid-cols-[100px_1fr] items-start gap-x-2 gap-y-2.5 text-sm">
                    <dt className="pt-0.5 text-xs text-slate-500">Type</dt>
                    <dd className="flex flex-wrap gap-1.5">
                      {doc.tags.filter((t) => taxonomy.docType.has(t)).map((t) => <TagChip key={t} id={t} />)}
                      {!doc.tags.some((t) => taxonomy.docType.has(t)) && <span className="text-xs text-[#b06000]">Not set – asked for on the next save</span>}
                    </dd>
                    <dt className="pt-0.5 text-xs text-slate-500">Topics</dt>
                    <dd className="flex flex-wrap gap-1.5">
                      {doc.tags.filter((t) => !taxonomy.docType.has(t)).map((t) => <TagChip key={t} id={t} />)}
                      {!doc.tags.some((t) => taxonomy.topic.has(t)) && <span className="text-xs text-[#b06000]">None yet</span>}
                    </dd>
                    <dt className="text-xs text-slate-500">Applies to</dt>
                    <dd className="text-slate-800">
                      <AppliesToLabel locations={doc.locations} teamIds={doc.audienceTeamIds} />
                      {!doc.audienceTeamIds.length && <span className="text-xs text-slate-500"> · all teams</span>}
                    </dd>
                    <dt className="text-xs text-slate-500">Client</dt>
                    <dd className="text-slate-800">{detail.client ? <Link href={`/client/${detail.client.id}`} className="hover:underline">{detail.client.name}</Link> : <span className="text-slate-500">–</span>}</dd>
                  </dl>
                </section>
                {detail.related.length > 0 && (
                  <section className="border-b border-slate-100 p-5">
                    <h3 className="mb-3 text-sm font-medium text-slate-800">Related documents</h3>
                    <ul className="space-y-1">
                      {detail.related.map((r) => (
                        <li key={r.id}>
                          <Link href={`/doc/${r.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                            <TrustBadge trust={related.trustOf(r)} loading={!related.trustOf(r)} size={30} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm text-slate-800">{r.title}</div>
                              <div className="flex items-center gap-2 text-xs text-slate-500">
                                <StatusPill status={r.status} /> {formatLocations(r.locations)} · {timeAgo(r.updatedAt)}
                              </div>
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <section className="p-5">
                  <h3 className="mb-1 text-sm font-medium text-slate-800">How the score was made</h3>
                  {trust && !scoring && (
                    <>
                      {!trust.fallback && <LevelBars probs={trust.levelProbabilities} />}
                      <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
                        <span>{trust.fallback ? trust.model : `${trust.model} · ${Math.round(trust.confidence * 100)}% confident · ${trust.latencyMs}ms`}</span>
                        <button onClick={rescore} className="text-blue-700 hover:underline">Rescore</button>
                      </div>
                    </>
                  )}
                  <button onClick={() => setShowInput(!showInput)} className="mt-3 text-xs text-blue-700 hover:underline">
                    {showInput ? "Hide" : "Show"} what Jev sees
                  </button>
                  {showInput && (
                    <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-slate-50 p-3 text-[10.5px] leading-4 text-slate-700">{JSON.stringify(detail.jevInput, null, 2)}</pre>
                  )}
                </section>
              </>
            )}
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

function OverrideRow({ o, otherId, otherTitle, ours, theirs }: { o: ConflictOverride; otherId: string; otherTitle: string; ours: { no: number; text: string }; theirs: { no: number; text: string } }) {
  const { person } = useApp();
  const p = person(o.personId);
  return (
    <li className="rounded-xl bg-[#fef7e0] p-3 text-xs text-slate-700">
      <div className="mb-1.5 flex items-center gap-2">
        <Avatar person={p} size={20} />
        <span>
          <span className="font-medium text-slate-900">{p?.name ?? o.personId}</span> overrode {Math.round(o.probability * 100)}% conflict · {timeAgo(o.at)}
        </span>
      </div>
      <div>This doc, line {ours.no}: “{ours.text}”</div>
      <div>
        <Link href={`/doc/${otherId}`} className="text-blue-700 hover:underline">{otherTitle}</Link>, line {theirs.no}: “{theirs.text}”
      </div>
      <div className="mt-1.5 italic text-slate-600">Reason: {o.reason}</div>
    </li>
  );
}

function PersonRow({ label, id }: { label: string; id: string | null }) {
  const { person } = useApp();
  const p = person(id);
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="w-24 text-xs text-slate-500">{label}</span>
      <Avatar person={p} size={24} />
      <div className="min-w-0 text-sm">
        <span className={p && !p.active ? "text-slate-400 line-through" : "text-slate-800"}>{p?.name ?? "—"}</span>
        {p && !p.active && p.leftAt && <span className="ml-1 text-xs text-[#c5221f]">left {timeAgo(p.leftAt)}</span>}
      </div>
    </div>
  );
}

function DoubtRow({ d, active, onFocus }: { d: Doubt; active: boolean; onFocus: () => void }) {
  const color = d.tone === "bad" ? "#c5221f" : "#b06000";
  return (
    <li data-doubt-line={d.lineNo}>
      <div
        role="button"
        tabIndex={0}
        onClick={onFocus}
        onKeyDown={(e) => e.key === "Enter" && onFocus()}
        className={`cursor-pointer rounded-xl border-l-4 p-2.5 text-xs text-slate-700 ${active ? "bg-slate-100" : "bg-slate-50 hover:bg-slate-100"}`}
        style={{ borderColor: color }}
      >
        <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-500">
          <span className="font-medium" style={{ color }}>Line {d.lineNo}</span>
          <span className="truncate italic">“{d.lineText}”</span>
        </div>
        <div className="text-slate-800">{d.text}</div>
        {d.answer && (
          <div className="mt-1.5 border-t border-slate-200 pt-1.5 text-slate-600">
            “{d.answer.line}”{" "}
            <Link href={d.answer.href} onClick={(e) => e.stopPropagation()} className="text-blue-700 hover:underline">
              Read the answer
            </Link>
          </div>
        )}
        {d.source && (
          <div className="mt-1.5 border-t border-slate-200 pt-1.5 text-slate-600">
            <Link href={`/doc/${d.source.docId}`} onClick={(e) => e.stopPropagation()} className="text-blue-700 hover:underline">{d.source.title}</Link>, line {d.source.lineNo}: “{d.source.lineText}”
            <div className="mt-0.5 text-[11px] text-slate-500">
              {d.source.status} · {formatLocations(d.source.locations)} · edited {timeAgo(d.source.updatedAt)}
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

function SignalRow({ s }: { s: Signal }) {
  const icon = {
    good: { c: "#188038", bg: "#e6f4ea", d: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z" },
    bad: { c: "#c5221f", bg: "#fce8e6", d: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z" },
    warn: { c: "#b06000", bg: "#fef7e0", d: "M11 7h2v6h-2zm0 8h2v2h-2z" },
    neutral: { c: "#5f6368", bg: "#f1f3f4", d: "M11 7h2v2h-2zm0 4h2v6h-2z" },
  }[s.tone];
  return (
    <li className="flex items-start gap-2.5 text-sm text-slate-700">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ background: icon.bg }}>
        <svg width="14" height="14" viewBox="0 0 24 24"><path d={icon.d} fill={icon.c} /></svg>
      </span>
      <span>{s.text}</span>
    </li>
  );
}

function LevelBars({ probs }: { probs: Record<string, number> }) {
  return (
    <div className="mt-4 space-y-1">
      {LEVEL_NAMES.map((name, i) => {
        const p = probs[String(i)] ?? 0;
        return (
          <div key={i} className="flex items-center gap-2 text-[11px] text-slate-500">
            <span className="w-28 truncate">{name}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-[#0b57d0]" style={{ width: `${p * 100}%`, transition: "width 500ms" }} />
            </div>
            <span className="w-8 text-right tabular-nums">{Math.round(p * 100)}%</span>
          </div>
        );
      })}
    </div>
  );
}

function History({ points }: { points: { score: number; computedAt: string }[] }) {
  const w = 300;
  const h = 36;
  const x = (i: number) => (i / (points.length - 1)) * (w - 8) + 4;
  const y = (s: number) => h - 4 - (s / 100) * (h - 8);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.score)}`).join(" ");
  return (
    <div>
      <div className="mb-1 text-sm font-medium text-slate-800">Score history for you</div>
      <div className="mb-2 text-[11px] text-slate-500">{points.length} scores, oldest first</div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
        <path d={d} fill="none" stroke="#0b57d0" strokeWidth="1.5" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.score)} r="2.5" fill="#0b57d0">
            <title>{`${p.score} · ${timeAgo(p.computedAt)}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

/** A document's tags as the tag dialog edits them. */
function metaOf(doc: Doc): DocMeta {
  return { locations: doc.locations, audienceTeamIds: doc.audienceTeamIds, clientId: doc.clientId ?? null, tags: doc.tags };
}

/**
 * Nobody has opened, edited or verified this document in a long time. Not a verdict – the score is
 * unchanged – just a nudge to check before relying on it, with the two ways to clear it up.
 */
function QuietBanner({ notice, ownerId, title, onVerify }: { notice: QuietNotice; ownerId: string | null; title: string; onVerify: () => void }) {
  const { person } = useApp();
  const compose = useCompose();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const who = person(notice.personId);
  const owner = person(ownerId);
  const years = Math.floor(notice.days / 365);
  const span = years >= 2 ? `${years} years` : years === 1 ? "over a year" : `${notice.days} days`;
  const what = { opened: "opened", edited: "edited", verified: "verified" }[notice.kind];
  const when = new Date(notice.at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-[#f6d58b] bg-[#fef7e0] px-5 py-2.5 text-sm text-[#7a4a00]" role="status">
      <svg width="18" height="18" viewBox="0 0 24 24" className="mt-0.5 shrink-0" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7Z" /></svg>
      <div className="min-w-0 flex-1">
        <div className="font-medium">Nobody has looked at this document in {span}.</div>
        <div className="text-xs">
          It was last {what} {who ? `by ${who.name} ` : ""}on {when}. That doesn&apos;t mean it&apos;s wrong, and its trust score is unchanged – but check that it still applies before you rely on it.
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs font-medium">
          <button onClick={onVerify} className="text-[#0b57d0] hover:underline">It&apos;s still correct</button>
          {owner?.active && (
            <button onClick={() => compose({ source: "email", to: [{ personId: owner.id, name: owner.name, email: owner.email }], subject: `Is “${title}” still up to date?` })} className="text-[#0b57d0] hover:underline">
              Ask {owner.name.split(" ")[0]} (owner)
            </button>
          )}
        </div>
      </div>
      <button onClick={() => setHidden(true)} className="shrink-0 text-xs text-[#7a4a00] hover:underline">Dismiss</button>
    </div>
  );
}
