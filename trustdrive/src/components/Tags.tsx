"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { TagSuggestion } from "@/lib/tagging";
import { formatLocations, isGlobal, teamsFor } from "@/lib/appliesTo";
import { GLOBAL } from "@/lib/taxonomy";
import { useApp } from "./AppContext";
import { useEscape } from "./useEscape";

/** A tag as a chip: document types stand out from topics; tags outside the taxonomy are marked. */
export function TagChip({ id, onRemove, confidence }: { id: string; onRemove?: () => void; confidence?: number }) {
  const { taxonomy: tax } = useApp();
  const term = tax.topic.get(id) ?? tax.docType.get(id);
  const style = tax.docType.has(id) ? "bg-[#e8f0fe] text-[#0b57d0]" : term ? "bg-slate-100 text-slate-700" : "bg-white text-slate-500 ring-1 ring-dashed ring-slate-300";
  const parent = tax.topic.get(id)?.parent;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full py-0.5 pl-2.5 text-xs ${onRemove ? "pr-1" : "pr-2.5"} ${style}`} title={term ? term.description : "Not in the taxonomy"}>
      {parent && <span className="text-slate-400">{tax.tagLabel(parent)} ›</span>}
      {tax.tagLabel(id)}
      {confidence !== undefined && <span className="text-[10px] text-slate-400">{Math.round(confidence * 100)}%</span>}
      {onRemove && (
        <button type="button" onClick={onRemove} className="rounded-full px-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label={`Remove ${tax.tagLabel(id)}`}>
          ✕
        </button>
      )}
    </span>
  );
}

/** Tags with remove buttons and an "add" menu grouped like the taxonomy. `only` limits the menu to topics. */
export function TagEditor({ tags, onChange, disabled, only }: { tags: string[]; onChange: (tags: string[]) => void; disabled?: boolean; only?: "topics" }) {
  const { taxonomy: tax } = useApp();
  const add = (id: string) => id && !tags.includes(id) && onChange([...tags, id]);
  const shown = only === "topics" ? tags.filter((t) => tax.topic.has(t)) : tags;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.length === 0 && <span className="text-xs text-slate-400">{only === "topics" ? "No topic yet" : "No tags"}</span>}
      {shown.map((t) => (
        <TagChip key={t} id={t} onRemove={disabled ? undefined : () => onChange(tags.filter((x) => x !== t))} />
      ))}
      {!disabled && (
        <select value="" onChange={(e) => add(e.target.value)} className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs text-blue-700" aria-label={only === "topics" ? "Add a topic" : "Add a tag"}>
          <option value="">{only === "topics" ? "+ Add topic" : "+ Add tag"}</option>
          {only !== "topics" && (
            <optgroup label="Document type">
              {tax.docTypes.filter((t) => !tags.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </optgroup>
          )}
          {tax.topTopics.map((top) => (
            <optgroup key={top.id} label={top.label}>
              {!tags.includes(top.id) && <option value={top.id}>{top.label} (general)</option>}
              {tax.childrenOf(top.id).filter((t) => !tags.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </optgroup>
          ))}
        </select>
      )}
    </div>
  );
}

/** The four things every document is tagged with: its type and topics (both in `tags`), who it applies to, and its client. */
export interface DocMeta {
  /** Countries, or ["Global"]. */
  locations: string[];
  /** Teams within those countries; empty = all of them. */
  audienceTeamIds: string[];
  clientId: string | null;
  tags: string[];
}

/**
 * Asks for a document's tags before it's saved: a document type, at least one topic, who it applies to
 * (countries, then teams there) and optionally a client. Opens with suggestions from the content filled in
 * where something is missing; nothing is saved until the person confirms.
 */
export function TagDialog({ title, content, initial, action, heading = "Tag this document", confidential, error, onConfirm, onClose }: { title: string; content: string; initial: DocMeta; action: string; heading?: string; confidential?: boolean; error?: string | null; onConfirm: (meta: DocMeta) => void; onClose: () => void }) {
  useEscape(true, onClose);
  const { taxonomy: tax, teams, teamCountry } = useApp();
  const [meta, setMeta] = useState(initial);
  const [suggestion, setSuggestion] = useState<TagSuggestion | null>(null);
  const tagging = useTagSuggestion();
  const { suggest } = tagging;

  // Suggest once on opening. Only gaps are filled: what the person already chose stays. Country, team and
  // client are only taken from a confident suggestion, and only for a document that was never tagged.
  useEffect(() => {
    let cancelled = false;
    suggest(title, content, confidential).then((s) => {
      if (cancelled || !s) return;
      setSuggestion(s);
      setMeta((m) => {
        const fresh = !m.tags.some(tax.isKnownTag);
        const hasType = m.tags.some((t) => tax.docType.has(t));
        const hasTopic = m.tags.some((t) => tax.topic.has(t));
        const add = [...(!hasType && s.docType ? [s.docType.value] : []), ...(!hasTopic ? s.topics.map((t) => t.value) : [])].filter(tax.isKnownTag);
        const country = fresh ? confident(s.location) : undefined;
        const locations = country ? [country] : m.locations;
        const team = fresh ? confident(s.team) : undefined;
        return {
          locations,
          // A suggested team only when it fits the countries.
          audienceTeamIds: team && teamsFor(locations, teams, teamCountry).some((t) => t.id === team) ? [team] : m.audienceTeamIds,
          clientId: fresh ? (confident(s.client) ?? m.clientId) : m.clientId,
          tags: [...new Set([...m.tags, ...add])],
        };
      });
    });
    return () => {
      cancelled = true;
    };
    // Once per opening: the dialog is mounted fresh each time it's shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const docType = meta.tags.find((t) => tax.docType.has(t)) ?? "";
  const setDocType = (id: string) => setMeta((m) => ({ ...m, tags: [...m.tags.filter((t) => !tax.docType.has(t)), ...(id ? [id] : [])] }));
  const missing = [...tax.missingTags(meta.tags), ...(meta.locations.length ? [] : ["a country"])];
  const unpicked = (suggestion?.topics ?? []).filter((t) => tax.topic.has(t.value) && !meta.tags.includes(t.value));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <form
        className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-3xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!missing.length) onConfirm(meta);
        }}
      >
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-medium text-slate-900">{heading}</h2>
          <p className="text-sm text-slate-600">A type, at least one topic and who it applies to, so colleagues can find it and know whether it&apos;s meant for them.</p>
          <p className="mt-1 text-xs text-slate-500">
            {tagging.busy ? "Reading the document for suggestions…" : suggestion ? `${suggestedBy(suggestion, confidential)} – check them before saving.` : tagging.error ? "No suggestions right now – pick the tags yourself." : null}
          </p>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
          <Field label="Document type" required>
            <div className="flex flex-wrap gap-1.5">
              {tax.docTypes.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  title={t.description}
                  onClick={() => setDocType(docType === t.id ? "" : t.id)}
                  aria-pressed={docType === t.id}
                  className={`rounded-full px-3 py-1 text-xs ${docType === t.id ? "bg-[#0b57d0] font-medium text-white" : "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Topics" required>
            <TagEditor tags={meta.tags} onChange={(tags) => setMeta((m) => ({ ...m, tags }))} only="topics" />
            {unpicked.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                Also suggested:
                {unpicked.map((t) => (
                  <button key={t.value} type="button" onClick={() => setMeta((m) => ({ ...m, tags: [...m.tags, t.value] }))} className="rounded-full bg-white px-2 py-0.5 text-blue-700 ring-1 ring-dashed ring-blue-300 hover:bg-blue-50">
                    + {tax.tagLabel(t.value)}
                  </button>
                ))}
              </div>
            )}
          </Field>
          <Field label="Applies to" required note="Pick one or more countries, or Global. Teams are optional: none picked means every team there.">
            <AppliesToPicker locations={meta.locations} teamIds={meta.audienceTeamIds} onChange={(locations, audienceTeamIds) => setMeta((m) => ({ ...m, locations, audienceTeamIds }))} />
          </Field>
          <Field label="Client" note="Only when the document is about one client.">
            <ClientPicker value={meta.clientId} onChange={(clientId) => setMeta((m) => ({ ...m, clientId }))} />
          </Field>
          <p className="text-xs text-slate-500">
            Missing a topic, type or country?{" "}
            <Link href="/company" target="_blank" className="text-blue-700 hover:underline">
              Add it on Company &amp; tags
            </Link>{" "}
            – it shows up here when you reopen this dialog.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-3">
          {missing.length > 0 && <span className="mr-auto text-xs text-[#b06000]">Still needed: {missing.join(", ")}</span>}
          {!missing.length && error && <span className="mr-auto text-xs text-red-700">{error}</span>}
          <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm text-blue-700 hover:bg-blue-50">
            Back
          </button>
          <button type="submit" disabled={missing.length > 0} className="rounded-full bg-[#0b57d0] px-5 py-2 text-sm font-medium text-white hover:bg-[#0842a0] disabled:opacity-50">
            {action}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, required, note, children }: { label: string; required?: boolean; note?: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-slate-800">
        {label} {required && <span className="text-[#c5221f]">*</span>}
      </legend>
      {note && <p className="mb-1.5 text-[11px] text-slate-500">{note}</p>}
      <div className={note ? "" : "mt-1.5"}>{children}</div>
    </fieldset>
  );
}

/**
 * Countries as a list of checkboxes; under each chosen country, the teams based there (and teams working
 * across countries) to narrow it down. Global stands for every country, so it replaces the others.
 */
export function AppliesToPicker({ locations, teamIds, onChange }: { locations: string[]; teamIds: string[]; onChange: (locations: string[], teamIds: string[]) => void }) {
  const { taxonomy: tax, teams, teamCountry } = useApp();
  const global = isGlobal(locations);
  const toggleCountry = (c: string) => {
    if (c === GLOBAL) return onChange(global ? [] : [GLOBAL], teamIds);
    const next = locations.includes(c) ? locations.filter((l) => l !== c) : [...locations.filter((l) => l !== GLOBAL), c];
    // Teams that no longer fit the countries are dropped.
    const allowed = new Set(teamsFor(next, teams, teamCountry).map((t) => t.id));
    onChange(next, teamIds.filter((id) => allowed.has(id)));
  };
  const toggleTeam = (id: string) => onChange(locations, teamIds.includes(id) ? teamIds.filter((t) => t !== id) : [...teamIds, id]);
  // Under a country: the teams based there. Teams spread over countries are listed once, under "Across countries".
  const teamsIn = (c: string) => teams.filter((t) => (teamCountry.get(t.id) ?? GLOBAL) === c);
  const rows = [...tax.countries.map((c) => c.id), GLOBAL];

  const teamChips = (list: typeof teams) =>
    list.length > 0 && (
      <div className="mb-1 ml-7 mt-1 flex flex-wrap gap-1.5">
        {list.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => toggleTeam(t.id)}
            aria-pressed={teamIds.includes(t.id)}
            className={`rounded-full px-2.5 py-0.5 text-xs ${teamIds.includes(t.id) ? "bg-[#c2e7ff] font-medium text-slate-900" : "bg-white text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"}`}
          >
            {t.name}
          </button>
        ))}
      </div>
    );

  return (
    <div className="rounded-xl border border-slate-200 p-2">
      {rows.map((c) => {
        const on = locations.includes(c);
        const label = c === GLOBAL ? "Global – every country" : c;
        return (
          <div key={c} className={c === GLOBAL ? "mt-1 border-t border-slate-100 pt-1" : ""}>
            <label className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50 ${global && c !== GLOBAL ? "text-slate-400" : "text-slate-800"}`}>
              <input type="checkbox" checked={on} onChange={() => toggleCountry(c)} className="h-4 w-4 accent-[#0b57d0]" />
              {label}
            </label>
            {on && c !== GLOBAL && teamChips(teamsIn(c))}
            {on && c === GLOBAL && teamChips(teams)}
          </div>
        );
      })}
      {!global && locations.length > 0 && teamsIn(GLOBAL).length > 0 && (
        <div className="mt-1 border-t border-slate-100 px-2 pt-1 text-xs text-slate-500">
          Teams across countries
          {teamChips(teamsIn(GLOBAL))}
        </div>
      )}
    </div>
  );
}

/** A client, picked by typing part of its name. */
export function ClientPicker({ value, onChange }: { value: string | null; onChange: (clientId: string | null) => void }) {
  const { clients, clientName } = useApp();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const q = query.trim().toLowerCase();
  const matches = clients.filter((c) => !q || c.name.toLowerCase().includes(q) || c.domain?.toLowerCase().includes(q)).slice(0, 8);

  if (value) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-3 pr-1 text-sm text-slate-800">
        {clientName(value) ?? value}
        <button type="button" onClick={() => onChange(null)} className="rounded-full px-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label="Remove the client">
          ✕
        </button>
      </span>
    );
  }
  return (
    <div className="relative max-w-sm">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={clients.length ? "Search clients…" : "No clients yet"}
        disabled={!clients.length}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-500"
        aria-label="Search clients"
      />
      {open && clients.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl bg-white py-1 shadow-lg ring-1 ring-black/5">
          {matches.length === 0 && <li className="px-3 py-1.5 text-sm text-slate-500">No client matches “{query}”</li>}
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(c.id);
                  setQuery("");
                  setOpen(false);
                }}
                className="flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-100"
              >
                {c.name}
                <span className="text-[11px] text-slate-400">{c.location}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Belgium › Payroll Belgium, HR Operations" – who a document applies to, in one line. */
export function AppliesToLabel({ locations, teamIds }: { locations: string[]; teamIds: string[] }) {
  const { teamName } = useApp();
  return (
    <>
      {formatLocations(locations)}
      {teamIds.length > 0 && <span className="text-slate-500"> › {teamIds.map(teamName).join(", ")}</span>}
    </>
  );
}

/** Asks for suggestions for a text; returns null on failure (suggesting must never block anything). */
export function useTagSuggestion() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** `confidential`: suggested by the keyword rules, so the text never goes to Jev. */
  const suggest = async (title: string, content: string, confidential = false): Promise<TagSuggestion | null> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tags/suggest", { method: "POST", body: JSON.stringify({ title, content, confidential }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Suggesting failed (${res.status})`);
      return json as TagSuggestion;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { suggest, busy, error };
}

/** Country, team and client are only proposed when the suggestion is this sure: "nothing found" mustn't overwrite a known value. */
export const CONFIDENT = 0.5;
export const confident = <T,>(x: { value: T; confidence: number } | null | undefined) => (x && x.confidence >= CONFIDENT ? x.value : undefined);

/** The tags a suggestion proposes: topics plus the document type. */
export const suggestedTags = (s: TagSuggestion) => [...s.topics.map((t) => t.value), ...(s.docType ? [s.docType.value] : [])];

export const suggestedBy = (s: TagSuggestion, confidential?: boolean) =>
  s.method === "jev" ? "Suggested by Jev" : confidential ? "Suggested by keyword rules (confidential, not sent to Jev)" : "Suggested by keyword rules (Jev unavailable)";
