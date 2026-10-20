"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useApp } from "./AppContext";
import { SaveGateDialogs, selectLine, useSaveGate } from "./ConflictDialog";
import { TagDialog, type DocMeta } from "./Tags";
import { STATUSES, type DocStatus } from "@/lib/types";
import { useEscape } from "./useEscape";

/**
 * Upload a text document. Tagging happens when it's finished: "Next" opens the tag dialog (type, topics,
 * who it applies to, client), and confirming it runs the conflict and duplicate check and uploads.
 * `folderId`: the folder the document is added to (unset = the top of the drive).
 */
export function UploadDialog({ onClose, folderId }: { onClose: () => void; folderId?: string }) {
  useEscape(true, onClose);
  const router = useRouter();
  const { viewerId, person, taxonomy } = useApp();
  const viewer = person(viewerId);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<DocStatus>("Completed");
  const [fileName, setFileName] = useState<string | null>(null);
  const [confidential, setConfidential] = useState(false);
  // Starts as "for my country"; the tag dialog fills in the rest from the content.
  const [meta, setMeta] = useState<DocMeta>({ locations: [viewer?.location ?? taxonomy.locations[0]], audienceTeamIds: [], clientId: null, tags: [] });
  const [taggingOpen, setTaggingOpen] = useState(false);
  // What the tag dialog confirmed, for the save that follows straight away (state updates land a render later).
  const confirmed = useRef<DocMeta | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  const gate = useSaveGate<{ id: string }>({
    send: ({ overrideReason, acknowledgeSimilar }) => {
      const m = confirmed.current ?? meta;
      return fetch("/api/docs", {
        method: "POST",
        body: JSON.stringify({ title, content, status, kind: "doc", ...m, clientId: m.clientId ?? undefined, folderId, confidential, override: overrideReason ? { reason: overrideReason } : undefined, acknowledgeSimilar }),
      });
    },
    onSaved: ({ id }) => router.push(`/doc/${id}`),
  });

  const loadFile = async (f: File) => {
    const text = await f.text();
    setFileName(f.name);
    setContent(text);
    const heading = text.match(/^#\s+(.+)$/m)?.[1];
    setTitle(heading ?? f.name.replace(/\.[^.]+$/, ""));
  };

  const field = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500";

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-medium text-slate-900">Upload a document</h2>
          <p className="text-sm text-slate-600">Next you tag it. Before it&apos;s added, it&apos;s checked against every existing document for contradicting facts and duplicate information.</p>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 hover:border-blue-400 hover:bg-blue-50/40">
            <svg width="22" height="22" viewBox="0 0 24 24"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96ZM14 13v4h-4v-4H7l5-5 5 5h-3Z" fill="#0b57d0" /></svg>
            <span>{fileName ? <>Loaded <span className="font-medium text-slate-900">{fileName}</span> – choose another</> : "Choose a .md or .txt file, or paste the content below"}</span>
            <input type="file" accept=".md,.txt,.markdown,text/plain,text/markdown" className="hidden" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
          </label>
          <div className="flex gap-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (required)" aria-label="Title" className={`${field} min-w-0 flex-1`} />
            <select value={status} onChange={(e) => setStatus(e.target.value as DocStatus)} className={field} title="Status">
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <ConfidentialSwitch checked={confidential} onChange={setConfidential} />
          <textarea ref={ta} value={content} onChange={(e) => setContent(e.target.value)} placeholder="# Document content (markdown)" className={`${field} h-64 w-full resize-none font-mono leading-6`} />
        </div>
        {gate.error && !gate.mode && <div className="mx-6 mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{gate.error}</div>}
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button onClick={onClose} className="rounded-full px-4 py-2 text-sm text-slate-700 hover:bg-slate-100">Cancel</button>
          <button
            onClick={() => setTaggingOpen(true)}
            disabled={gate.busy || !content.trim() || !title.trim()}
            className="rounded-full bg-[#0b57d0] px-5 py-2 text-sm font-medium text-white hover:bg-[#0842a0] disabled:opacity-50"
          >
            {gate.busy ? "Checking for conflicts…" : "Next: tag it"}
          </button>
        </div>
      </div>

      {taggingOpen && (
        <TagDialog
          title={title}
          content={content}
          initial={meta}
          action="Check & upload"
          confidential={confidential}
          onClose={() => setTaggingOpen(false)}
          onConfirm={(m) => {
            setMeta(m);
            setTaggingOpen(false);
            confirmed.current = m;
            gate.save();
          }}
        />
      )}
      <SaveGateDialogs gate={gate} action="upload" onEditMine={(lineNo) => setTimeout(() => selectLine(ta.current, lineNo), 50)} />
    </div>
  );
}

/** The confidential flag: a switch with what it means, shared by the upload dialog and a document's details. */
export function ConfidentialSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 ${checked ? "bg-[#fce8e6]" : "bg-slate-50"} ${disabled ? "cursor-default opacity-60" : ""}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-[#c5221f]" : "bg-slate-300"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
      </button>
      <span className="text-sm">
        <span className="font-medium text-slate-900">Contains confidential information</span>
        <span className="block text-[11px] text-slate-600">
          Never sent to Jev: its trust score, conflict and duplicate checks and tag suggestions use the built-in rules instead. It&apos;s marked confidential everywhere it&apos;s listed.
        </span>
      </span>
    </label>
  );
}
