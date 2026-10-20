"use client";

import { useState } from "react";
import { useEscape } from "./useEscape";

/** Asks for a name (a folder, a new document); `onSubmit` returns an error to show, or null when it's done. */
export function NameDialog({ title, where, initial = "", label, placeholder, action, onSubmit, onClose }: { title: string; where: string | null; initial?: string; label: string; placeholder?: string; action: string; onSubmit: (name: string) => Promise<string | null>; onClose: () => void }) {
  useEscape(true, onClose);
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(await onSubmit(name.trim()));
    setBusy(false);
  };
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-medium text-slate-900">{title}</h2>
        {where && <p className="mt-0.5 text-sm text-slate-500">In {where}</p>}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.target.select()}
          autoFocus
          aria-label={label}
          placeholder={placeholder}
          className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm text-blue-700 hover:bg-blue-50">Cancel</button>
          <button type="submit" disabled={busy || !name.trim()} className="rounded-full bg-[#0b57d0] px-5 py-2 text-sm font-medium text-white hover:bg-[#0842a0] disabled:opacity-50">
            {action}
          </button>
        </div>
      </form>
    </div>
  );
}
