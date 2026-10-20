"use client";

import Link from "next/link";
import { useState } from "react";
import { useApp } from "./AppContext";
import { SaveGateDialogs, useSaveGate } from "./ConflictDialog";
import type { EditView } from "@/lib/edits";

/** A line as the reader sees it: source links as their text. */
const plain = (line: string) => line.replace(/\s*\(\[([^\]]*)\]\([^)]*\)\)/g, "").replace(/\*\*/g, "");

/**
 * Changes answers suggest to documents. The person who answered proposes a draft (or says it isn't
 * needed); the document's owner accepts it (saved like any edit, with the usual conflict and duplicate
 * checks) or rejects it. Either can reword it first.
 */
export function SuggestedEdits({ edits, onDone, title, note }: { edits: EditView[]; onDone: () => void; title?: string; note?: string }) {
  if (!edits.length) return null;
  return (
    <section id="edits" className="rounded-2xl bg-[#e6f4ea] p-5">
      {title && <h2 className="text-sm font-medium text-slate-900">{title}</h2>}
      {note && <p className="mt-0.5 text-xs text-slate-600">{note}</p>}
      <ul className="mt-3 space-y-3">
        {edits.map((e) => (
          <EditCard key={e.id} e={e} onDone={onDone} />
        ))}
      </ul>
    </section>
  );
}

function EditCard({ e, onDone }: { e: EditView; onDone: () => void }) {
  const { viewerId, person } = useApp();
  const [text, setText] = useState(e.newLine);
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answerer = person(e.answererId);
  const decider = person(e.deciderId);
  const mineToPropose = e.status === "draft" && e.answererId === viewerId;
  const mineToDecide = e.status === "proposed" && e.deciderId === viewerId;
  const own = e.answererId === e.deciderId;

  const post = (body: Record<string, unknown>) => fetch(`/api/edits/${e.id}`, { method: "POST", body: JSON.stringify({ text, ...body }) });
  const gate = useSaveGate<{ status: string }>({
    send: ({ overrideReason, acknowledgeSimilar }) => post({ action: "accept", override: overrideReason ? { reason: overrideReason } : undefined, acknowledgeSimilar }),
    onSaved: () => onDone(),
  });
  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await post(body);
      if (!res.ok) throw new Error((await res.json()).error ?? `Request failed (${res.status})`);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const headline = mineToPropose ? (
    <>
      Your answer could update <Link href={`/doc/${e.docId}`} className="font-medium underline">{e.docTitle}</Link>
      {decider && <>, which {decider.name.split(" ")[0]} owns</>}.
    </>
  ) : mineToDecide ? (
    own ? (
      <>
        Your answer could update <Link href={`/doc/${e.docId}`} className="font-medium underline">{e.docTitle}</Link>
        {e.ownerId !== viewerId && <> (nobody owns it, so you can apply it)</>}.
      </>
    ) : (
      <>
        {answerer?.name ?? "A colleague"} suggests a change to your document <Link href={`/doc/${e.docId}`} className="font-medium underline">{e.docTitle}</Link>.
      </>
    )
  ) : e.status === "draft" ? (
    <>Drafted from {answerer?.name ?? "a colleague"}&apos;s answer; waiting for {answerer?.name.split(" ")[0] ?? "them"} to propose it.</>
  ) : (
    <>
      {answerer?.name ?? "A colleague"} suggests this; waiting for {decider?.name.split(" ")[0] ?? "the owner"} to decide.
    </>
  );

  return (
    <li className="rounded-xl bg-white p-4 text-sm">
      <SaveGateDialogs gate={gate} onEditMine={() => setEditing(true)} />
      <div className="text-slate-700">{headline}</div>
      <div className="mt-1 text-[11px] text-slate-500">
        From the answer to <Link href={e.answerHref} className="text-blue-700 hover:underline">“{e.question}”</Link> · {e.kind === "replace" ? "it says otherwise than this line" : "it isn't written down anywhere yet"}
      </div>
      <div className="mt-2 space-y-1 rounded-lg bg-slate-50 p-2 font-mono text-[12px] leading-5">
        {e.oldLine && <div className="text-[#a50e0e] line-through decoration-[#a50e0e]/40">− {plain(e.oldLine)}</div>}
        {editing ? (
          <textarea value={text} onChange={(ev) => setText(ev.target.value)} rows={3} aria-label="Suggested line" className="w-full resize-y rounded border border-slate-300 bg-white p-1.5 font-mono text-[12px]" />
        ) : (
          plain(text)
            .split("\n")
            .map((l, i) => (
              <div key={i} className="text-[#137333]">
                + {l}
              </div>
            ))
        )}
      </div>
      {error && <div className="mt-2 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">{error}</div>}
      {gate.error && !gate.mode && <div className="mt-2 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">{gate.error}</div>}
      {(mineToPropose || mineToDecide) && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          {!editing && (
            <button onClick={() => setEditing(true)} className="mr-auto text-xs text-blue-700 hover:underline">
              Edit
            </button>
          )}
          {mineToPropose && (
            <>
              <button disabled={busy} onClick={() => act({ action: "dismiss" })} className="rounded-full px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-60">
                Not needed
              </button>
              <button disabled={busy || !text.trim()} onClick={() => act({ action: "propose" })} className="rounded-full bg-[#0b57d0] px-3 py-1 text-xs font-medium text-white hover:bg-[#0842a0] disabled:opacity-60">
                Suggest to {decider?.name.split(" ")[0] ?? "the owner"}
              </button>
            </>
          )}
          {mineToDecide && !rejecting && (
            <>
              <button disabled={busy || gate.busy} onClick={() => (own ? act({ action: "reject" }) : setRejecting(true))} className="rounded-full px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-60">
                {own ? "Not needed" : "Reject"}
              </button>
              <button disabled={busy || gate.busy || !text.trim()} onClick={() => gate.save()} className="rounded-full bg-[#188038] px-3 py-1 text-xs font-medium text-white hover:bg-[#137333] disabled:opacity-60">
                {gate.busy ? "Checking…" : own ? "Apply to the document" : "Accept and save"}
              </button>
            </>
          )}
          {mineToDecide && rejecting && (
            <div className="flex w-full flex-wrap items-center gap-2">
              <input value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder={`Why not? ${answerer?.name.split(" ")[0] ?? "They"} will see this (optional)`} aria-label="Reason" className="min-w-0 flex-1 rounded-full border border-slate-300 px-3 py-1 text-xs outline-none focus:border-blue-500" />
              <button onClick={() => setRejecting(false)} className="text-xs text-slate-600 hover:underline">Cancel</button>
              <button disabled={busy} onClick={() => act({ action: "reject", reason })} className="rounded-full bg-slate-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-60">
                Reject
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
