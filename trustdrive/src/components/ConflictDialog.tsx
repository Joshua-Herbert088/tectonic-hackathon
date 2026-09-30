"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "./AppContext";
import { timeAgo } from "@/lib/time";
import type { Conflict, ConflictCheck } from "@/lib/types";

/** Selects a 1-based line in a textarea and scrolls it into view. */
export function selectLine(ta: HTMLTextAreaElement | null, lineNo: number) {
  if (!ta) return;
  const lines = ta.value.split("\n");
  const start = lines.slice(0, lineNo - 1).reduce((n, l) => n + l.length + 1, 0);
  ta.focus();
  ta.setSelectionRange(start, start + (lines[lineNo - 1]?.length ?? 0));
  const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 24;
  ta.scrollTop = Math.max(0, (lineNo - 4) * lineHeight);
}

export function ConflictDialog({
  check,
  busy,
  error,
  onEditMine,
  onRecheck,
  onOverride,
  onClose,
}: {
  check: ConflictCheck;
  busy: boolean;
  error?: string | null;
  onEditMine: (lineNo: number) => void;
  onRecheck: () => void;
  onOverride: (reason: string) => void;
  onClose: () => void;
}) {
  const [overriding, setOverriding] = useState(false);
  const [reason, setReason] = useState("");
  const [editingExisting, setEditingExisting] = useState<Conflict | null>(null);
  const n = check.hard.length;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-4 border-b border-slate-100 px-6 py-5">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#fce8e6]">
            <svg width="22" height="22" viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21Zm12-3h-2v-2h2v2Zm0-4h-2v-4h2v4Z" fill="#c5221f" /></svg>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-medium text-slate-900">
              {n} conflict{n === 1 ? "" : "s"} with existing documents
            </h2>
            <p className="text-sm text-slate-600">
              Jev found information that directly contradicts what&apos;s already in TrustDrive. Fix your document, fix the existing one, or override with a reason.
            </p>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close">✕</button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {check.hard.map((c) => (
            <ConflictCard key={c.key} c={c} onEditMine={() => onEditMine(c.lineNo)} onEditExisting={() => setEditingExisting(c)} />
          ))}
          {check.possible.length > 0 && (
            <details className="rounded-xl border border-slate-200 px-4 py-2 text-sm">
              <summary className="cursor-pointer text-slate-600">{check.possible.length} possible conflict{check.possible.length === 1 ? "" : "s"} (not blocking)</summary>
              <div className="mt-2 space-y-2">
                {check.possible.map((c) => (
                  <div key={c.key} className="text-xs text-slate-600">
                    Line {c.lineNo} “{c.lineText}” vs <span className="font-medium">{c.existing.title}</span> line {c.existing.lineNo} “{c.existing.lineText}” ({Math.round(c.probability * 100)}%)
                  </div>
                ))}
              </div>
            </details>
          )}
          <p className="text-[11px] text-slate-400">
            Checked {check.pairsChecked} related statements across {check.docsChecked} documents with Jev.
          </p>
        </div>

        {error && <div className="mx-6 mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="border-t border-slate-100 px-6 py-4">
          {overriding ? (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-slate-800">
                Why are you saving despite {n === 1 ? "this conflict" : "these conflicts"}?
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoFocus
                rows={2}
                placeholder="e.g. Raise approved by An on 28 Sep – register will be updated next week"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#c5221f]"
              />
              <p className="text-xs text-slate-500">Your name, this reason and the conflicting lines will stay attached to the document, and appear on the other document too.</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setOverriding(false)} className="rounded-full px-4 py-2 text-sm text-slate-700 hover:bg-slate-100">Back</button>
                <button
                  disabled={!reason.trim() || busy}
                  onClick={() => onOverride(reason.trim())}
                  className="rounded-full bg-[#c5221f] px-5 py-2 text-sm font-medium text-white hover:bg-[#a50e0e] disabled:opacity-40"
                >
                  {busy ? "Saving…" : "Override and save"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <button onClick={() => setOverriding(true)} className="text-sm text-[#c5221f] hover:underline">Override anyway…</button>
              <div className="flex gap-2">
                <button onClick={() => onEditMine(check.hard[0].lineNo)} className="rounded-full px-4 py-2 text-sm text-blue-700 hover:bg-blue-50">Edit my document</button>
                <button onClick={onRecheck} disabled={busy} className="rounded-full bg-[#0b57d0] px-5 py-2 text-sm font-medium text-white hover:bg-[#0842a0] disabled:opacity-50">
                  {busy ? "Checking…" : "Check again & save"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {editingExisting && (
        <ExistingDocEditor
          conflict={editingExisting}
          onClose={() => setEditingExisting(null)}
          onSaved={() => {
            setEditingExisting(null);
            onRecheck();
          }}
        />
      )}
    </div>
  );
}

function ConflictCard({ c, onEditMine, onEditExisting }: { c: Conflict; onEditMine: () => void; onEditExisting: () => void }) {
  const { person, teamName } = useApp();
  return (
    <div className="rounded-2xl border border-[#f4c7c3] bg-[#fffbfa] p-4">
      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-3">
        <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">Your document · line {c.lineNo}</div>
          <div className="text-sm text-slate-900">{c.lineText}</div>
        </div>
        <div className="grid place-items-center text-xs font-semibold text-[#c5221f]">≠</div>
        <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
          <div className="mb-1 truncate text-[11px] font-medium uppercase tracking-wide text-slate-500" title={c.existing.title}>
            {c.existing.title} · line {c.existing.lineNo}
          </div>
          <div className="text-sm text-slate-900">{c.existing.lineText}</div>
          <div className="mt-1 text-[11px] text-slate-500">
            {c.existing.location} · {teamName(c.existing.teamId)} · {c.existing.status} · edited {timeAgo(c.existing.updatedAt)}
            {c.existing.ownerId && ` · owner ${person(c.existing.ownerId)?.name ?? ""}`}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-[#c5221f]">{Math.round(c.probability * 100)}% likely a direct contradiction</span>
        <div className="flex gap-1">
          <button onClick={onEditMine} className="rounded-full px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50">Fix my line</button>
          <button onClick={onEditExisting} className="rounded-full px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50">Fix existing document</button>
          <a href={`/doc/${c.existing.docId}`} target="_blank" className="rounded-full px-3 py-1 text-xs text-slate-600 hover:bg-slate-100">Open ↗</a>
        </div>
      </div>
    </div>
  );
}

/** Edit the other document in place; its save goes through the same conflict gate (without override). */
function ExistingDocEditor({ conflict, onClose, onSaved }: { conflict: Conflict; onClose: () => void; onSaved: () => void }) {
  const { viewerId } = useApp();
  const [content, setContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<Conflict[]>([]);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch(`/api/docs/${conflict.existing.docId}?viewer=${viewerId}`)
      .then((r) => r.json())
      .then((d) => {
        setContent(d.doc.content);
        setTimeout(() => selectLine(ta.current, conflict.existing.lineNo), 50);
      });
  }, [conflict.existing.docId, conflict.existing.lineNo, viewerId]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setBlocking([]);
    const res = await fetch(`/api/docs/${conflict.existing.docId}`, { method: "PATCH", body: JSON.stringify({ viewerId, content }) });
    const json = await res.json();
    setSaving(false);
    if (res.ok) onSaved();
    else if (res.status === 409) setBlocking(json.check.hard);
    else setError(json.error ?? "Save failed");
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/30 p-4" onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="text-xs text-slate-500">Editing existing document</div>
          <div className="text-lg text-slate-900">{conflict.existing.title}</div>
          <div className="mt-1 text-xs text-slate-600">
            Line {conflict.existing.lineNo} is selected. Your document says: <span className="font-medium">“{conflict.lineText}”</span>
          </div>
        </div>
        <div className="min-h-0 flex-1 p-4">
          {content === null ? (
            <div className="p-8 text-center text-slate-500">Loading…</div>
          ) : (
            <textarea ref={ta} value={content} onChange={(e) => setContent(e.target.value)} className="h-[50vh] w-full resize-none rounded-xl border border-slate-200 p-3 font-mono text-sm leading-6 outline-none focus:border-blue-500" />
          )}
        </div>
        {blocking.length > 0 && (
          <div className="mx-6 mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            This change would conflict with other documents:
            {blocking.map((b) => (
              <div key={b.key}>
                • line {b.lineNo} vs {b.existing.title} line {b.existing.lineNo}: “{b.existing.lineText}”
              </div>
            ))}
          </div>
        )}
        {error && <div className="mx-6 mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button onClick={onClose} className="rounded-full px-4 py-2 text-sm text-slate-700 hover:bg-slate-100">Cancel</button>
          <button onClick={save} disabled={saving || content === null} className="rounded-full bg-[#0b57d0] px-5 py-2 text-sm font-medium text-white hover:bg-[#0842a0] disabled:opacity-50">
            {saving ? "Checking with Jev…" : "Save existing document"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Wraps a save request that may come back 409 with conflicts. `send` receives the override reason
 * when the user chose to override; `onSaved` gets the successful JSON response.
 */
export function useConflictGate<T>({ send, onSaved }: { send: (overrideReason?: string) => Promise<Response>; onSaved: (json: T) => void }) {
  const [check, setCheck] = useState<ConflictCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (overrideReason?: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await send(overrideReason);
      const json = await res.json();
      if (res.ok) {
        setCheck(null);
        onSaved(json);
      } else if (res.status === 409) setCheck(json.check);
      else setError(json.error ?? `Save failed (${res.status})`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return { save, check, busy, error, dismiss: () => setCheck(null) };
}
