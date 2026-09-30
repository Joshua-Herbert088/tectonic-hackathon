"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useApp } from "./AppContext";
import { ConflictDialog, selectLine, useConflictGate } from "./ConflictDialog";
import { LOCATIONS, STATUSES, type DocStatus, type Location } from "@/lib/types";

export function UploadDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { viewerId, person, teams } = useApp();
  const viewer = person(viewerId);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [location, setLocation] = useState<Location>(viewer?.location ?? "Belgium");
  const [teamId, setTeamId] = useState(viewer?.teamId ?? teams[0]?.id ?? "");
  const [status, setStatus] = useState<DocStatus>("Completed");
  const [fileName, setFileName] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  const gate = useConflictGate<{ id: string }>({
    send: (reason) =>
      fetch("/api/docs", {
        method: "POST",
        body: JSON.stringify({ viewerId, title, content, location, teamId, status, kind: "doc", override: reason ? { reason } : undefined }),
      }),
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
          <p className="text-sm text-slate-600">Before it&apos;s added, Jev checks it against every existing document for contradicting facts.</p>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 hover:border-blue-400 hover:bg-blue-50/40">
            <svg width="22" height="22" viewBox="0 0 24 24"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96ZM14 13v4h-4v-4H7l5-5 5 5h-3Z" fill="#0b57d0" /></svg>
            <span>{fileName ? <>Loaded <span className="font-medium text-slate-900">{fileName}</span> – choose another</> : "Choose a .md or .txt file, or paste the content below"}</span>
            <input type="file" accept=".md,.txt,.markdown,text/plain,text/markdown" className="hidden" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
          </label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className={`${field} w-full`} />
          <div className="grid grid-cols-3 gap-2">
            <select value={location} onChange={(e) => setLocation(e.target.value as Location)} className={field} title="Applies to location">
              {LOCATIONS.map((l) => <option key={l}>{l}</option>)}
            </select>
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className={field} title="Team">
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value as DocStatus)} className={field} title="Status">
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <textarea ref={ta} value={content} onChange={(e) => setContent(e.target.value)} placeholder="# Document content (markdown)" className={`${field} h-64 w-full resize-none font-mono leading-6`} />
        </div>
        {gate.error && <div className="mx-6 mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{gate.error}</div>}
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button onClick={onClose} className="rounded-full px-4 py-2 text-sm text-slate-700 hover:bg-slate-100">Cancel</button>
          <button
            onClick={() => gate.save()}
            disabled={gate.busy || !content.trim()}
            className="rounded-full bg-[#0b57d0] px-5 py-2 text-sm font-medium text-white hover:bg-[#0842a0] disabled:opacity-50"
          >
            {gate.busy ? "Checking for conflicts…" : "Check & upload"}
          </button>
        </div>
      </div>

      {gate.check && (
        <ConflictDialog
          check={gate.check}
          busy={gate.busy}
          error={gate.error}
          onClose={gate.dismiss}
          onRecheck={() => gate.save()}
          onOverride={(reason) => gate.save(reason)}
          onEditMine={(lineNo) => {
            gate.dismiss();
            setTimeout(() => selectLine(ta.current, lineNo), 50);
          }}
        />
      )}
    </div>
  );
}
