"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppContext";
import { FileIcon } from "@/components/FileIcon";
import { Markdown } from "@/components/Markdown";
import { StatusPill } from "@/components/StatusPill";
import { Avatar, TopBar } from "@/components/TopBar";
import { TrustBadge, trustBand } from "@/components/TrustBadge";
import { useScores } from "@/components/useScores";
import { timeAgo } from "@/lib/time";
import { LOCATIONS, STATUSES, type Doc, type Signal, type TrustScore } from "@/lib/types";

const LEVEL_NAMES = ["Don't rely on it", "Likely outdated", "Uncertain", "Probably reliable", "Reliable", "Authoritative"];

interface Detail {
  doc: Doc;
  trust: TrustScore | null;
  signals: Signal[];
  related: (Omit<Doc, "content"> & { trust: TrustScore | null })[];
  jevInput: unknown;
}

export default function DocPage() {
  const { id } = useParams<{ id: string }>();
  const { viewerId, person, teamName, teams } = useApp();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [trust, setTrust] = useState<TrustScore | null>(null);
  const [previous, setPrevious] = useState<number | null>(null);
  const [scoring, setScoring] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", content: "" });
  const [showInput, setShowInput] = useState(false);
  const [justVerified, setJustVerified] = useState(false);
  const trustRef = useRef<TrustScore | null>(null);
  trustRef.current = trust;

  const rescore = useCallback(async () => {
    setScoring(true);
    setScoreError(null);
    try {
      const res = await fetch(`/api/docs/${id}/score?viewer=${viewerId}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setTrust(json.trust);
    } catch (e) {
      setScoreError((e as Error).message);
    } finally {
      setScoring(false);
    }
  }, [id, viewerId]);

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
    setTrust(null);
    setPrevious(null);
    setJustVerified(false);
    fetch(`/api/docs/${id}?viewer=${viewerId}`)
      .then((r) => r.json())
      .then((d: Detail) => {
        apply(d);
        if (new URLSearchParams(window.location.search).get("edit")) {
          setDraft({ title: d.doc.title, content: d.doc.content });
          setEditing(true);
        }
      });
  }, [id, viewerId, apply]);

  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/docs/${id}`, { method: "PATCH", body: JSON.stringify({ viewerId, ...body }) });
    apply(await res.json());
  };

  const verify = async () => {
    const res = await fetch(`/api/docs/${id}/verify`, { method: "POST", body: JSON.stringify({ viewerId }) });
    setJustVerified(true);
    apply(await res.json());
  };

  const related = useScores(detail?.related ?? null, viewerId);

  if (!detail) {
    return (
      <div className="flex h-screen flex-col">
        <TopBar showSearch={false} />
        <div className="grid flex-1 place-items-center text-slate-500">Loading…</div>
      </div>
    );
  }

  const { doc, signals } = detail;
  const owner = person(doc.ownerId);
  const band = trust ? trustBand(trust.score) : null;
  const good = signals.filter((s) => s.tone === "good");
  const bad = signals.filter((s) => s.tone === "bad" || s.tone === "warn");
  const neutral = signals.filter((s) => s.tone === "neutral");
  const canEdit = doc.ownerId === viewerId || doc.collaboratorIds.includes(viewerId);

  return (
    <div className="flex h-screen flex-col">
      <TopBar showSearch={false} />
      <div className="flex min-h-0 flex-1 gap-4 px-4 pb-4">
        {/* Document */}
        <main className="flex min-w-0 flex-1 flex-col rounded-2xl bg-white">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3">
            <Link href="/" className="rounded-full p-2 hover:bg-slate-100" aria-label="Back to drive">
              <svg width="20" height="20" viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2Z" fill="#444746" /></svg>
            </Link>
            <FileIcon kind={doc.kind} size={24} />
            <div className="min-w-0 flex-1">
              {editing ? (
                <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="w-full rounded border border-slate-300 px-2 py-1 text-lg outline-none focus:border-blue-500" />
              ) : (
                <div className="truncate text-lg text-slate-800">{doc.title}</div>
              )}
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>{teamName(doc.teamId)}</span>·<span>{doc.location}</span>·<span>edited {timeAgo(doc.updatedAt)} by {person(doc.lastEditedById)?.name ?? "unknown"}</span>
              </div>
            </div>
            <select value={doc.status} onChange={(e) => patch({ status: e.target.value })} disabled={!canEdit} className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-60" title="Document status">
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select value={doc.location} onChange={(e) => patch({ location: e.target.value })} disabled={!canEdit} className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-60" title="Location this document applies to">
              {LOCATIONS.map((l) => <option key={l}>{l}</option>)}
            </select>
            <select value={doc.teamId} onChange={(e) => patch({ teamId: e.target.value })} disabled={!canEdit} className="max-w-40 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-60" title="Team">
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {editing ? (
              <>
                <button onClick={() => setEditing(false)} className="rounded-full px-4 py-1.5 text-sm text-blue-700 hover:bg-blue-50">Cancel</button>
                <button
                  onClick={async () => {
                    await patch(draft);
                    setEditing(false);
                  }}
                  className="rounded-full bg-[#0b57d0] px-5 py-1.5 text-sm font-medium text-white hover:bg-[#0842a0]"
                >
                  Save
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  setDraft({ title: doc.title, content: doc.content });
                  setEditing(true);
                }}
                className="rounded-full bg-[#c2e7ff] px-5 py-1.5 text-sm font-medium text-slate-900 hover:bg-[#b3dcf7]"
              >
                Edit
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-[#f9fbfd] py-8">
            <div className="mx-auto min-h-full max-w-[816px] bg-white px-16 py-14 shadow-[0_1px_3px_rgba(60,64,67,.15),0_1px_2px_rgba(60,64,67,.3)]">
              {editing ? (
                <textarea
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  className="h-[60vh] w-full resize-none font-mono text-sm leading-6 outline-none"
                  autoFocus
                />
              ) : (
                <Markdown text={doc.content} />
              )}
            </div>
          </div>
        </main>

        {/* Trust panel */}
        <aside className="flex w-[380px] shrink-0 flex-col overflow-y-auto rounded-2xl bg-white">
          <section className="border-b border-slate-100 p-5">
            <div className="flex items-center gap-4">
              <TrustBadge trust={scoring ? null : trust} loading={scoring || (!trust && !scoreError)} error={!!scoreError} size={84} />
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-wide text-slate-500">Trust score</div>
                {trust && !scoring ? (
                  <>
                    <div className="text-xl font-medium" style={{ color: band!.color }}>{band!.label}</div>
                    {previous !== null && previous !== trust.score && (
                      <div className={`text-sm font-medium ${trust.score > previous ? "text-[#188038]" : "text-[#c5221f]"}`}>
                        {trust.score > previous ? "▲" : "▼"} from {previous}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-sm text-slate-500">{scoreError ? "Jev scoring failed" : "Asking Jev…"}</div>
                )}
              </div>
            </div>
            {scoreError && <div className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{scoreError}</div>}
            {trust && !scoring && (
              <>
                <LevelBars probs={trust.levelProbabilities} />
                <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
                  <span>{trust.model} · {Math.round(trust.confidence * 100)}% confident · {trust.latencyMs}ms</span>
                  <button onClick={rescore} className="text-blue-700 hover:underline">Rescore</button>
                </div>
              </>
            )}
          </section>

          <section className="border-b border-slate-100 p-5">
            <button
              onClick={verify}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[#0b57d0] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0842a0]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z" fill="#fff" /></svg>
              {justVerified ? "Verified – thanks!" : "I confirm this document is correct"}
            </button>
            <p className="mt-2 text-center text-[11px] text-slate-500">Records you as having checked this document today.</p>
          </section>

          <section className="border-b border-slate-100 p-5">
            {good.length > 0 && (
              <>
                <h3 className="mb-2 text-sm font-medium text-slate-800">What&apos;s good</h3>
                <ul className="mb-4 space-y-2">{good.map((s, i) => <SignalRow key={i} s={s} />)}</ul>
              </>
            )}
            {bad.length > 0 && (
              <>
                <h3 className="mb-2 text-sm font-medium text-slate-800">Watch out</h3>
                <ul className="mb-4 space-y-2">{bad.map((s, i) => <SignalRow key={i} s={s} />)}</ul>
              </>
            )}
            {neutral.length > 0 && <ul className="space-y-2">{neutral.map((s, i) => <SignalRow key={i} s={s} />)}</ul>}
          </section>

          <section className="border-b border-slate-100 p-5">
            <h3 className="mb-3 text-sm font-medium text-slate-800">People</h3>
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
                          <StatusPill status={r.status} /> {r.location} · {timeAgo(r.updatedAt)}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="p-5">
            <button onClick={() => setShowInput(!showInput)} className="text-xs text-blue-700 hover:underline">
              {showInput ? "Hide" : "Show"} what Jev sees
            </button>
            {showInput && (
              <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-slate-50 p-3 text-[10.5px] leading-4 text-slate-700">{JSON.stringify(detail.jevInput, null, 2)}</pre>
            )}
          </section>
        </aside>
      </div>
    </div>
  );

  function PersonRow({ label, id }: { label: string; id: string | null }) {
    const p = person(id);
    return (
      <div className="mb-2 flex items-center gap-2">
        <span className="w-24 text-xs text-slate-500">{label}</span>
        <Avatar person={p} size={24} />
        <div className="min-w-0 text-sm">
          <span className={p && !p.active ? "text-slate-400 line-through" : "text-slate-800"}>{p?.name ?? "—"}</span>
          {p && !p.active && <span className="ml-1 text-xs text-[#c5221f]">left {timeAgo(p.leftAt!)}</span>}
        </div>
      </div>
    );
  }
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
