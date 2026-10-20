"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AppContext";
import { Icon } from "@/components/Icons";
import { useEscape } from "@/components/useEscape";
import type { companyMap } from "@/lib/companyMap";
import { validateClient } from "@/lib/clients";
import { GLOBAL, KIND_LABEL, validateTerm, type Term, type TermKind } from "@/lib/taxonomy";
import type { Client } from "@/lib/types";

type CompanyMap = ReturnType<typeof companyMap>;
/** The term dialog: adding one (topics may go under a main topic) or editing an existing one. */
type Editing = { kind: TermKind; term?: Term; parent?: string; inUse?: number };

type Tab = "overview" | "edit";

/**
 * What exists to organise documents by: the company's countries, teams and clients, and the tag taxonomy.
 * The overview shows how it's used; the "Edit tags" tab is where the taxonomy and its structure are changed.
 */
export default function CompanyPage() {
  return (
    <Suspense fallback={null}>
      <CompanyView />
    </Suspense>
  );
}

function CompanyView() {
  const params = useSearchParams();
  const { teamName, taxonomy: tax, setTerms, setClients, myClients, setMyClients } = useApp();
  const [data, setData] = useState<CompanyMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [editingClient, setEditingClient] = useState<{ client?: CompanyMap["clients"][number] } | null>(null);
  // A link can open the editor straight away (/company?tab=edit).
  const [tab, setTab] = useState<Tab>(params.get("tab") === "edit" ? "edit" : "overview");
  const [moveError, setMoveError] = useState<string | null>(null);

  const switchTab = (t: Tab) => {
    setTab(t);
    window.history.replaceState(null, "", t === "edit" ? "/company?tab=edit" : "/company");
  };

  const load = useCallback(
    () =>
      fetch("/api/taxonomy")
        .then(async (r) => {
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? "Could not load the company map.");
          setData(j);
        })
        .catch((e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  /** After a change: the whole app gets the new terms, and the counts here are reloaded. */
  const changed = (terms: Term[]) => {
    setTerms(terms);
    setEditing(null);
    load();
  };
  const clientsChanged = (clients: Client[]) => {
    setClients(clients);
    setEditingClient(null);
    load();
  };

  /** Moves a topic under another main topic, or makes it a main topic; everything else about it stays. */
  const moveTopic = async (term: Term, parent: string | null) => {
    setMoveError(null);
    const res = await fetch(`/api/taxonomy/topic/${encodeURIComponent(term.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ label: term.label, description: term.description, keywords: term.keywords, parent }),
    });
    const json = await res.json();
    if (!res.ok) return setMoveError(json.error ?? `Moving “${term.label}” failed.`);
    changed(json.terms);
  };

  if (!data) {
    return (
      <AppShell>
        <main className="grid flex-1 place-items-center rounded-2xl bg-white text-sm text-slate-500">{error ?? "Loading…"}</main>
      </AppShell>
    );
  }

  const count = (n: number, href: string) =>
    n ? (
      <Link href={href} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-[#e8f0fe] hover:text-[#0b57d0]">
        {n} doc{n === 1 ? "" : "s"}
      </Link>
    ) : (
      <span className="px-2 text-[11px] text-slate-400">no docs</span>
    );
  const add = (label: string, onClick: () => void) => (
    <button onClick={onClick} className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50">
      <Icon name="plus" size={14} color="#0b57d0" /> {label}
    </button>
  );
  const topicDocs = (id: string) => {
    const own = data.topics.find((x) => x.id === id)?.documents ?? 0;
    return own + data.topics.filter((x) => x.parent === id).reduce((n, s) => n + s.documents, 0);
  };
  const tabButton = (t: Tab, label: string) => (
    <button
      role="tab"
      aria-selected={tab === t}
      onClick={() => switchTab(t)}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === t ? "border-[#0b57d0] text-[#0b57d0]" : "border-transparent text-slate-600 hover:text-slate-900"}`}
    >
      {label}
    </button>
  );

  return (
    <AppShell>
      {editing && <TermDialog editing={editing} onDone={changed} onClose={() => setEditing(null)} />}
      {editingClient && <ClientDialog client={editingClient.client} onDone={clientsChanged} onClose={() => setEditingClient(null)} />}
      <main className="min-h-0 flex-1 overflow-y-auto rounded-2xl bg-white">
        <div className="mx-auto max-w-6xl space-y-8 p-4 sm:p-8">
          <header>
            <h1 className="text-3xl text-slate-900">Company & tags</h1>
            <p className="mt-1 text-slate-600">
              How documents are organised: by the country they apply to, the team that maintains them, the client they&apos;re about, and their topic and type. {data.documents} documents
              {data.untagged > 0 && <>, {data.untagged} without any tag from the taxonomy</>}.
            </p>
            <div role="tablist" className="mt-4 flex border-b border-slate-200">
              {tabButton("overview", "Overview")}
              {tabButton("edit", "Edit tags")}
            </div>
          </header>

          {tab === "overview" ? (
            <>
              <Section icon="building" title="Company structure" note="Countries, the teams working there, and who's in them. A team's country is where most of its people are.">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {data.countries.map((c) => (
                    <div key={c.location} className="rounded-xl border border-slate-200 p-4">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h3 className="flex min-w-0 items-center gap-1 font-medium text-slate-900">
                          {c.location === GLOBAL ? "Global / several countries" : c.location}
                          {!c.term && c.location !== GLOBAL && <span className="text-[11px] font-normal text-[#b06000]">not in the taxonomy</span>}
                        </h3>
                        {count(c.documents, `/drive?location=${encodeURIComponent(c.location)}`)}
                      </div>
                      {c.teams.length === 0 && <p className="text-xs text-slate-400">No team based here</p>}
                      <ul className="space-y-2">
                        {c.teams.map((t) => (
                          <li key={t.id} className="rounded-lg bg-slate-50 p-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-slate-800">{t.name}</span>
                              {count(t.documents, `/drive?team=${t.id}`)}
                            </div>
                            <details className="mt-1 text-xs text-slate-600">
                              <summary className="cursor-pointer text-slate-500">
                                {t.people.length} {t.people.length === 1 ? "person" : "people"}
                                {t.left > 0 && <> · {t.left} left</>}
                                {t.movedIn > 0 && <> · {t.movedIn} moved in</>}
                              </summary>
                              <ul className="mt-1 space-y-0.5 pl-2">
                                {t.people.map((p) => (
                                  <li key={p.id}>
                                    {p.name} <span className="text-slate-400">– {p.role}</span>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </Section>

              <Section icon="building" title="Clients" note="Payroll clients. Mail from their domain is recognised when conversations are imported." action={add("Add client", () => setEditingClient({}))}>
                {data.clients.length === 0 && <p className="text-sm text-slate-500">No clients yet.</p>}
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {data.clients.map((c) => (
                    <div key={c.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="flex min-w-0 items-center gap-1 font-medium text-slate-900">
                          <Link href={`/client/${c.id}`} className="truncate hover:underline">{c.name}</Link>
                          <button onClick={() => setEditingClient({ client: c })} className="rounded-full p-1 hover:bg-slate-100" title="Edit" aria-label={`Edit ${c.name}`}>
                            <Icon name="edit" size={15} color="#5f6368" />
                          </button>
                        </h3>
                        {count(c.documents, `/drive?client=${c.id}`)}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {teamName(c.teamId)} · {c.location}
                        {c.domain && <> · @{c.domain}</>}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <Link href={`/conversations?client=${c.id}`} className="text-xs text-blue-700 hover:underline">
                          {c.conversations} conversation{c.conversations === 1 ? "" : "s"}
                        </Link>
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600" title="Show this client in your sidebar and in “Clients waiting for an answer”">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-[#0b57d0]"
                            checked={myClients.some((m) => m.id === c.id)}
                            onChange={(e) => setMyClients(e.target.checked ? [...myClients.map((m) => m.id), c.id] : myClients.filter((m) => m.id !== c.id).map((m) => m.id)).catch((err: Error) => alert(err.message))}
                          />
                          In my sidebar
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>

              <Section icon="tag" title="Topics" note="Two levels: a main area and its sub-topics. Filtering by a main area includes its sub-topics." action={<EditLink onClick={() => switchTab("edit")} />}>
                <div className="grid gap-4 md:grid-cols-2">
                  {tax.topTopics.map((top) => {
                    const t = data.topics.find((x) => x.id === top.id) ?? { ...top, documents: 0 };
                    const subs = data.topics.filter((x) => x.parent === top.id);
                    return (
                      <div key={top.id} className="rounded-xl border border-slate-200 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="font-medium text-slate-900">{t.label}</h3>
                          {count(topicDocs(top.id), `/drive?tag=${t.id}`)}
                        </div>
                        <p className="mb-2 text-xs text-slate-500">{t.description}</p>
                        <ul className="space-y-1">
                          {subs.map((s) => (
                            <li key={s.id} className="flex items-start justify-between gap-2 text-sm">
                              <div className="min-w-0">
                                <div className="text-slate-800">{s.label}</div>
                                <div className="text-[11px] text-slate-500">{s.description}</div>
                              </div>
                              {count(s.documents, `/drive?tag=${s.id}`)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </Section>

              <Section icon="doc" title="Document types" note="What kind of document it is – each document has one." action={<EditLink onClick={() => switchTab("edit")} />}>
                <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {data.docTypes.map((t) => (
                    <li key={t.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 p-3">
                      <div>
                        <div className="text-sm font-medium text-slate-800">{t.label}</div>
                        <div className="text-[11px] text-slate-500">{t.description}</div>
                      </div>
                      {count(t.documents, `/drive?tag=${t.id}`)}
                    </li>
                  ))}
                </ul>
              </Section>

              {(data.untracked.length > 0 || data.untagged > 0 || data.incomplete > 0) && (
                <Section icon="warning" title="Housekeeping" note="Tags on documents that aren't in the taxonomy (typos, removed or one-off tags), and documents that still need a type or topic.">
                  <div className="flex flex-wrap items-center gap-2">
                    {data.untracked.map((u) => (
                      <Link key={u.tag} href={`/drive?tag=${encodeURIComponent(u.tag)}`} className="rounded-full bg-white px-2.5 py-0.5 text-xs text-slate-600 ring-1 ring-dashed ring-slate-300 hover:bg-slate-50">
                        {u.tag} · {u.documents}
                      </Link>
                    ))}
                    {data.incomplete > 0 && (
                      <span className="text-xs text-slate-500">
                        {data.incomplete} document{data.incomplete === 1 ? " has" : "s have"} no document type or no topic yet – they&apos;re asked for on the next save, or use Suggest tags in a document&apos;s Details tab.
                      </span>
                    )}
                  </div>
                </Section>
              )}
            </>
          ) : (
            <>
              <p className="rounded-xl bg-[#f0f4f9] px-4 py-3 text-sm text-slate-700">
                Change which tags exist and how they&apos;re structured. Changes apply straight away for everyone. Documents keep their tags when you rename or move one; a removed tag stays on its documents as an untracked tag until someone retags them. Keywords drive the tag suggestions.
              </p>
              {moveError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{moveError}</p>}

              <Section icon="tag" title="Topics" note="Two levels. Move a sub-topic to another main topic, or make it a main topic of its own." action={add("Add main topic", () => setEditing({ kind: "topic" }))}>
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {tax.topTopics.map((top) => {
                    const subs = tax.childrenOf(top.id);
                    return (
                      <li key={top.id} className="p-3">
                        <TermRow
                          term={top}
                          docs={topicDocs(top.id)}
                          strong
                          onEdit={() => setEditing({ kind: "topic", term: top, inUse: topicDocs(top.id) })}
                          move={
                            subs.length === 0 && (
                              <MoveSelect value="" mainLabel="Main topic" options={tax.topTopics.filter((t) => t.id !== top.id)} onChange={(p) => p && moveTopic(top, p)} />
                            )
                          }
                        />
                        <ul className="ml-5 mt-1 border-l border-slate-200 pl-3">
                          {subs.map((s) => (
                            <li key={s.id} className="py-1">
                              <TermRow
                                term={s}
                                docs={data.topics.find((x) => x.id === s.id)?.documents ?? 0}
                                onEdit={() => setEditing({ kind: "topic", term: s, inUse: data.topics.find((x) => x.id === s.id)?.documents ?? 0 })}
                                move={<MoveSelect value={top.id} mainLabel="Make it a main topic" options={tax.topTopics} onChange={(p) => moveTopic(s, p || null)} />}
                              />
                            </li>
                          ))}
                          <li className="py-1">
                            <button onClick={() => setEditing({ kind: "topic", parent: top.id })} className="text-xs text-blue-700 hover:underline">
                              + Add sub-topic to {top.label}
                            </button>
                          </li>
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              </Section>

              <Section icon="doc" title="Document types" note="Every document has exactly one." action={add("Add document type", () => setEditing({ kind: "docType" }))}>
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {tax.docTypes.map((t) => {
                    const docs = data.docTypes.find((x) => x.id === t.id)?.documents ?? 0;
                    return (
                      <li key={t.id} className="p-3">
                        <TermRow term={t} docs={docs} onEdit={() => setEditing({ kind: "docType", term: t, inUse: docs })} />
                      </li>
                    );
                  })}
                </ul>
              </Section>

              <Section icon="building" title="Countries" note="Where a document applies. Global is always available. A country can't be renamed or removed while documents, people or clients refer to it." action={add("Add country", () => setEditing({ kind: "country" }))}>
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {data.countries
                    .filter((c) => c.term)
                    .map((c) => (
                      <li key={c.location} className="p-3">
                        <TermRow term={c.term!} docs={c.documents} onEdit={() => setEditing({ kind: "country", term: c.term!, inUse: c.inUse })} />
                      </li>
                    ))}
                </ul>
              </Section>
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}

function EditLink({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50">
      <Icon name="edit" size={14} color="#0b57d0" /> Edit tags
    </button>
  );
}

/** One term in the editor: name, description, keywords and how many documents use it. */
function TermRow({ term, docs, strong, onEdit, move }: { term: Term; docs: number; strong?: boolean; onEdit: () => void; move?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
      <div className="min-w-0 flex-1">
        <div className={`text-sm ${strong ? "font-medium text-slate-900" : "text-slate-800"}`}>{term.label}</div>
        {term.description && <div className="text-[11px] text-slate-500">{term.description}</div>}
        <div className="truncate text-[11px] text-slate-400" title={term.keywords.join(", ")}>
          {term.keywords.length ? `Keywords: ${term.keywords.join(", ")}` : "No keywords – suggestions won't find it"}
        </div>
      </div>
      <span className="shrink-0 pt-0.5 text-[11px] text-slate-500">{docs} doc{docs === 1 ? "" : "s"}</span>
      {move}
      <button onClick={onEdit} className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50">
        <Icon name="edit" size={13} color="#0b57d0" /> Edit
      </button>
    </div>
  );
}

/** Where a topic sits: under one of the main topics, or a main topic itself (value ""). */
function MoveSelect({ value, mainLabel, options, onChange }: { value: string; mainLabel: string; options: Term[]; onChange: (parent: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Belongs to" className="shrink-0 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700">
      <option value="">{value ? mainLabel : "Main topic – move under…"}</option>
      {options.map((t) => (
        <option key={t.id} value={t.id}>
          Under {t.label}
        </option>
      ))}
    </select>
  );
}

/** Adds or edits a client; removing one is here too (only when nothing refers to it). */
function ClientDialog({ client, onDone, onClose }: { client?: CompanyMap["clients"][number]; onDone: (clients: Client[]) => void; onClose: () => void }) {
  useEscape(true, onClose);
  const { teams, clients, taxonomy, viewerId, person } = useApp();
  const viewer = person(viewerId);
  const [name, setName] = useState(client?.name ?? "");
  const [domain, setDomain] = useState(client?.domain ?? "");
  const [teamId, setTeamId] = useState(client?.teamId ?? viewer?.teamId ?? teams[0]?.id ?? "");
  const [location, setLocation] = useState<string>(client?.location ?? viewer?.location ?? taxonomy.locations[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const request = async (method: "POST" | "PATCH" | "DELETE", body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(client ? `/api/clients/${client.id}` : "/api/clients", { method, body: body === undefined ? undefined : JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      onDone(json.clients);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const input = { name, domain: domain || null, teamId, location };
    const invalid = validateClient(input, { clients, teamIds: teams.map((t) => t.id), locations: taxonomy.locations }, client);
    if (invalid) return setError(invalid);
    request(client ? "PATCH" : "POST", input);
  };
  const remove = () => {
    if (!confirm(`Remove the client “${client!.name}”?`)) return;
    request("DELETE");
  };

  const field = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500";
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={save} className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-medium text-slate-900">{client ? `Edit ${client.name}` : "Add a client"}</h2>
        <div className="mt-4 space-y-3">
          <label className="block text-xs text-slate-500">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!client} className={field} placeholder="Havenstaal BV" />
          </label>
          <label className="block text-xs text-slate-500">
            Email domain
            <input value={domain} onChange={(e) => setDomain(e.target.value)} className={field} placeholder="havenstaal.example" />
            <span className="mt-1 block text-[11px]">Optional. Imported mail from this domain is linked to the client.</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-slate-500">
              Team
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className={field}>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="block text-xs text-slate-500">
              Country
              <select value={location} onChange={(e) => setLocation(e.target.value)} className={field}>
                {taxonomy.locations.map((l) => <option key={l}>{l}</option>)}
              </select>
            </label>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex items-center gap-2">
          {client && (
            <button type="button" onClick={remove} disabled={busy} className="mr-auto rounded-full px-3 py-2 text-sm text-[#c5221f] hover:bg-red-50 disabled:opacity-50">
              Remove
            </button>
          )}
          <button type="button" onClick={onClose} className="ml-auto rounded-full px-4 py-2 text-sm text-blue-700 hover:bg-blue-50">
            Cancel
          </button>
          <button type="submit" disabled={busy || !name.trim()} className="rounded-full bg-[#0b57d0] px-5 py-2 text-sm font-medium text-white hover:bg-[#0842a0] disabled:opacity-50">
            {client ? "Save" : "Add"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Adds or edits a topic, document type or country; removing one is here too. */
function TermDialog({ editing, onDone, onClose }: { editing: Editing; onDone: (terms: Term[]) => void; onClose: () => void }) {
  useEscape(true, onClose);
  const { taxonomy: tax } = useApp();
  const { kind, term } = editing;
  const [label, setLabel] = useState(term?.label ?? "");
  const [description, setDescription] = useState(term?.description ?? "");
  const [keywords, setKeywords] = useState((term?.keywords ?? []).join(", "));
  const [parent, setParent] = useState(term ? (term.parent ?? "") : (editing.parent ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noun = kind === "topic" ? (parent ? "sub-topic" : "main topic") : KIND_LABEL[kind];
  const hasSubtopics = kind === "topic" && !!term && tax.childrenOf(term.id).length > 0;

  const request = async (method: "POST" | "PATCH" | "DELETE", body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const url = term ? `/api/taxonomy/${kind}/${encodeURIComponent(term.id)}` : `/api/taxonomy/${kind}`;
      const res = await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      onDone(json.terms);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const input = { label, description, keywords: keywords.split(/[,\n]/).map((k) => k.trim().toLowerCase()).filter(Boolean), parent: kind === "topic" ? parent || null : undefined };
    const invalid = validateTerm(tax, kind, input, term);
    if (invalid) return setError(invalid);
    request(term ? "PATCH" : "POST", input);
  };

  const remove = () => {
    const keep = editing.inUse ? ` ${editing.inUse} document${editing.inUse === 1 ? " keeps" : "s keep"} it as an untracked tag until someone retags ${editing.inUse === 1 ? "it" : "them"}.` : "";
    if (!confirm(`Remove the ${noun} “${term!.label}”?${kind === "country" ? "" : keep}`)) return;
    request("DELETE");
  };

  const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500";
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={save} className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-medium text-slate-900">{term ? `Edit ${noun}` : `Add a ${noun}`}</h2>
        {kind === "topic" && !term && editing.parent && <p className="text-sm text-slate-500">Under {tax.tagLabel(editing.parent)}</p>}
        <div className="mt-4 space-y-3">
          <label className="block text-xs text-slate-500">
            Name
            <input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus={!term} disabled={kind === "country" && !!term} className={`${field} disabled:bg-slate-50 disabled:text-slate-500`} placeholder={kind === "country" ? "Luxembourg" : kind === "docType" ? "Template" : "Pensions"} />
            {kind === "country" && term && <span className="mt-1 block text-[11px]">Documents and people refer to a country by its name, so it can&apos;t be renamed.</span>}
          </label>
          {kind === "topic" && (
            <label className="block text-xs text-slate-500">
              Belongs to
              <select value={parent} onChange={(e) => setParent(e.target.value)} disabled={hasSubtopics} className={`${field} bg-white disabled:bg-slate-50`}>
                <option value="">Nothing – it&apos;s a main topic</option>
                {tax.topTopics.filter((t) => t.id !== term?.id).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              {hasSubtopics && <span className="mt-1 block text-[11px]">It has sub-topics, so it stays a main topic.</span>}
            </label>
          )}
          <label className="block text-xs text-slate-500">
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={field} placeholder={kind === "country" ? "Rules and work in Luxembourg" : "What belongs here, in one line"} />
          </label>
          <label className="block text-xs text-slate-500">
            Keywords
            <textarea value={keywords} onChange={(e) => setKeywords(e.target.value)} rows={3} className={`${field} resize-none`} placeholder={kind === "country" ? "luxembourg, luxemburg, ccss, …" : "words in English, Dutch, French or German, separated by commas"} />
            <span className="mt-1 block text-[11px]">
              {kind === "country" ? "Words that point at this country (its name in several languages, its authorities and declarations). Used to suggest a document's country." : "Words that point at it, in any language. Used to suggest tags from a document's content."}
            </span>
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex items-center gap-2">
          {term && (
            <button type="button" onClick={remove} disabled={busy} className="mr-auto rounded-full px-3 py-2 text-sm text-[#c5221f] hover:bg-red-50 disabled:opacity-50">
              Remove
            </button>
          )}
          <button type="button" onClick={onClose} className="ml-auto rounded-full px-4 py-2 text-sm text-blue-700 hover:bg-blue-50">
            Cancel
          </button>
          <button type="submit" disabled={busy || !label.trim()} className="rounded-full bg-[#0b57d0] px-5 py-2 text-sm font-medium text-white hover:bg-[#0842a0] disabled:opacity-50">
            {term ? "Save" : "Add"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Section({ icon, title, note, action, children }: { icon: Parameters<typeof Icon>[0]["name"]; title: string; note: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-2">
        <Icon name={icon} color="#0b57d0" />
        <h2 className="text-xl text-slate-900">{title}</h2>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <p className="mb-4 mt-0.5 text-xs text-slate-500">{note}</p>
      {children}
    </section>
  );
}
