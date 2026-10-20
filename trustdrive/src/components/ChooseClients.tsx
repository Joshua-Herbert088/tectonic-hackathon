"use client";

import { useState } from "react";
import { useApp } from "./AppContext";
import { useEscape } from "./useEscape";

/** Picks which clients the viewer sees in their sidebar and lists; the choice is saved on their profile. */
export function ChooseClientsDialog({ onClose }: { onClose: () => void }) {
  useEscape(true, onClose);
  const { clients, teams, myClients, choseClients, setMyClients, person, viewerId, teamName } = useApp();
  const viewer = person(viewerId);
  const [picked, setPicked] = useState(() => new Set(myClients.map((c) => c.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The viewer's own team first, then the other teams that serve clients.
  const groups = teams
    .map((t) => ({ team: t, clients: clients.filter((c) => c.teamId === t.id).sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter((g) => g.clients.length)
    .sort((a, b) => Number(b.team.id === viewer?.teamId) - Number(a.team.id === viewer?.teamId));

  const save = async (ids: string[] | null) => {
    setBusy(true);
    setError(null);
    try {
      await setMyClients(ids);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6">
          <h2 className="text-lg font-medium text-slate-900">Your clients</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Choose the clients you work with. Only these show in your sidebar and in &ldquo;Clients waiting for an answer&rdquo;. Everyone chooses their own.
          </p>
          {!choseClients && viewer && <p className="mt-1 text-[11px] text-slate-500">Right now you see {teamName(viewer.teamId)}&apos;s clients, the default.</p>}
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {groups.map((g) => (
            <fieldset key={g.team.id}>
              <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                {g.team.name}
                {g.team.id === viewer?.teamId && " (your team)"}
              </legend>
              <ul className="space-y-0.5">
                {g.clients.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                      <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} className="h-4 w-4 accent-[#0b57d0]" />
                      <span className="min-w-0 flex-1 truncate text-slate-800">{c.name}</span>
                      <span className="shrink-0 text-[11px] text-slate-500">{c.location}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ))}
          {clients.length === 0 && <p className="text-sm text-slate-500">There are no clients yet. Add them on the Company &amp; tags page.</p>}
        </div>
        {error && <p className="mx-6 mb-2 text-sm text-red-700">{error}</p>}
        <div className="flex items-center gap-2 border-t border-slate-100 px-6 py-3">
          <button onClick={() => save(null)} disabled={busy} className="mr-auto rounded-full px-3 py-2 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-50">
            Use my team&apos;s clients
          </button>
          <button onClick={onClose} className="rounded-full px-4 py-2 text-sm text-blue-700 hover:bg-blue-50">Cancel</button>
          <button onClick={() => save([...picked])} disabled={busy} className="rounded-full bg-[#0b57d0] px-5 py-2 text-sm font-medium text-white hover:bg-[#0842a0] disabled:opacity-50">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
