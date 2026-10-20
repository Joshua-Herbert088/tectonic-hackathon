"use client";

import { formatLocations } from "@/lib/appliesTo";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AppContext";
import { Icon } from "@/components/Icons";
import { ConfidentialPill, StatusPill } from "@/components/StatusPill";
import { Avatar } from "@/components/TopBar";
import { TrustBadge, trustBand } from "@/components/TrustBadge";
import { useScores } from "@/components/useScores";
import { ContactLinks } from "@/components/WhoToContact";
import { citationHref, type DraftItem, type HandoverDraft } from "@/lib/handoverDoc";
import { timeAgo } from "@/lib/time";
import type { Client, ConflictOverride, Doc, TrustScore } from "@/lib/types";

type Row = Omit<Doc, "content"> & { trust: TrustScore | null; issue: string | null; strength: string | null };

interface Overview {
  client: Client;
  about: Row[];
  applies: Row[];
  exceptions: { override: ConflictOverride; docTitle: string }[];
  conversations: { id: string; title: string; source: "email" | "teams"; messages: number; last: string; waiting: boolean }[];
  people: { personId: string; why: string[]; status: string | null }[];
}

/** How many general documents to show before "Show all". */
const APPLIES = 5;

export default function ClientPage() {
  const { id } = useParams<{ id: string }>();
  const { viewerId } = useApp();
  return (
    <AppShell>
      <ClientView key={`${id}:${viewerId}`} clientId={id} viewerId={viewerId} />
    </AppShell>
  );
}

function ClientView({ clientId, viewerId }: { clientId: string; viewerId: string }) {
  const { person, teamName } = useApp();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<HandoverDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [allApplies, setAllApplies] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/clients/${clientId}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(r.status === 404 ? "There's no client with this name in TrustDrive – the link may be wrong." : (json.error ?? "Could not load the client."));
        if (!cancelled) setData(json);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Could not load the client."));
    return () => {
      cancelled = true;
    };
  }, [clientId, viewerId]);

  // What the conversations say: the handover draft's agreements, open items and contacts. Nothing is saved.
  useEffect(() => {
    if (!data?.conversations.length) return;
    let cancelled = false;
    fetch("/api/conversations/draft", { method: "POST", body: JSON.stringify({ conversationIds: data.conversations.map((c) => c.id), clientId }) })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Could not read the conversations.");
        if (!cancelled) setDraft(json);
      })
      .catch((e: unknown) => !cancelled && setDraftError(e instanceof Error ? e.message : "Could not read the conversations."));
    return () => {
      cancelled = true;
    };
  }, [data, clientId]);

  const rows = useMemo(() => (data ? [...data.about, ...data.applies] : null), [data]);
  const { trustOf, failed } = useScores(rows, viewerId);

  if (!data) {
    return <main className="grid flex-1 place-items-center rounded-2xl bg-white text-sm text-slate-500">{error ?? "Preparing the client overview…"}</main>;
  }

  const { client } = data;
  const scoreOf = (r: Row) => trustOf(r)?.score;
  const groups = [
    { key: "safe", title: "Safe to use", note: "Trusted for you, so you can rely on these as they are.", items: data.about.filter((r) => (scoreOf(r) ?? -1) >= 75) },
    { key: "care", title: "Use with care", note: "Mostly fine, but check the points below before relying on them.", items: data.about.filter((r) => { const s = scoreOf(r); return s !== undefined && s >= 50 && s < 75; }) },
    { key: "risky", title: "Don't rely on these yet", note: "Outdated, unverified or contradicted. Review them or ask someone first.", items: data.about.filter((r) => (scoreOf(r) ?? 100) < 50) },
    { key: "pending", title: "Being scored", note: "Jev is still scoring these for you.", items: data.about.filter((r) => scoreOf(r) === undefined) },
  ].filter((g) => g.items.length);
  const applies = [...data.applies].sort((a, b) => (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1));

  const usable = (i: DraftItem) => !i.sensitive;
  const open = draft?.items.filter((i) => i.kind === "open" && !i.resolved && usable(i)) ?? [];
  const undocumented = draft?.items.filter((i) => (i.kind === "agreement" || i.kind === "fact") && !i.documentedIn && usable(i)) ?? [];
  const documented = draft?.items.filter((i) => (i.kind === "agreement" || i.kind === "fact") && i.documentedIn && usable(i)) ?? [];
  const handoverHref = `/conversations/handover?ids=${data.conversations.map((c) => c.id).join(",")}&client=${client.id}`;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto rounded-2xl">
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="rounded-2xl bg-white p-6">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[#e8f0fe]">
              <Icon name="building" size={28} color="#0b57d0" />
            </div>
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-slate-500">Client overview</div>
              <h1 className="text-2xl text-slate-900">{client.name}</h1>
              <div className="text-sm text-slate-600">
                {teamName(client.teamId)} · {client.location}
                {client.domain && <> · {client.domain}</>}
              </div>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat value={data.about.length} label={`documents about ${client.name}`} />
            <Stat value={groups.find((g) => g.key === "safe")?.items.length ?? 0} label="safe to use for you" tone="good" />
            <Stat value={data.exceptions.length} label="known exceptions" tone={data.exceptions.length ? "warn" : undefined} />
            <Stat value={draft ? open.length : data.conversations.length ? "…" : 0} label="open items in conversations" tone={open.length ? "warn" : undefined} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {data.conversations.length > 0 && (
              <Link href={handoverHref} className="rounded-full bg-[#0b57d0] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#0842a0]">Create handover document</Link>
            )}
            <Link href={`/conversations?client=${client.id}`} className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50">Conversations</Link>
            <Link href={`/drive?client=${client.id}`} className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50">Show in drive</Link>
          </div>
          <p className="mt-4 text-[11px] text-slate-500">
            For taking over {client.name} or preparing a meeting. Built from the documents, conflict decisions and conversations. Trust scores are calculated for you.
          </p>
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] [&>*]:min-w-0">
          <div className="space-y-4">
            <Section title={`About ${client.name}`} note="Documents linked to this client, grouped by how much you can rely on them.">
              {data.about.length === 0 ? (
                <p className="text-sm text-slate-600">No document is linked to {client.name} yet. What the team knows may only be in the conversations below.</p>
              ) : (
                groups.map((g) => (
                  <div key={g.key} className="mt-3 first:mt-0">
                    <h3 className="text-sm font-medium text-slate-800">
                      {g.title}
                      <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{g.items.length}</span>
                    </h3>
                    <p className="text-[11px] text-slate-500">{g.note}</p>
                    <ul className="divide-y divide-slate-100">
                      {g.items.map((r) => (
                        <DocLine key={r.id} r={r} trust={trustOf(r)} failed={failed(r.id)} />
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </Section>

            <Section title="What the conversations say" note={`From ${data.conversations.length} email and Teams conversation${data.conversations.length === 1 ? "" : "s"} with ${client.name}. Every line is quoted from a message; personal data is left out.`}>
              {data.conversations.length === 0 ? (
                <p className="text-sm text-slate-600">No conversations with {client.name} yet.</p>
              ) : draftError ? (
                <p className="text-sm text-[#c5221f]">{draftError}</p>
              ) : !draft ? (
                <p className="text-sm text-slate-500">Reading the conversations…</p>
              ) : (
                <div className="space-y-4">
                  <QuoteList title="Still open" tone="warn" empty="Nothing is waiting – every question and promise was followed up." items={open} />
                  <QuoteList title="Not written down anywhere" tone="warn" empty="Every agreement in the conversations is also in a document." items={undocumented} note="Agreements and facts that only live in the conversations. Create a handover document to get them into the drive." />
                  {documented.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-sm font-medium text-slate-800">
                        Already in the drive <span className="ml-1 rounded-full bg-[#e6f4ea] px-1.5 text-xs text-[#0d652d]">{documented.length}</span>
                      </summary>
                      <ul className="mt-2 space-y-2">
                        {documented.map((i) => (
                          <Quote key={i.key} i={i}>
                            <div className="mt-0.5 text-[11px] text-[#0d652d]">
                              ✓ In <Link href={`/doc/${i.documentedIn!.docId}`} className="hover:underline">{i.documentedIn!.title}</Link>
                            </div>
                          </Quote>
                        ))}
                      </ul>
                    </details>
                  )}
                  {draft.method === "rules" && <p className="text-[11px] text-slate-500">Jev wasn&apos;t available, so keyword rules sorted these statements.</p>}
                </div>
              )}
            </Section>

            {data.exceptions.length > 0 && (
              <Section title="Known exceptions" note="Lines that contradict another document on purpose. They look like mistakes, so read the reason before you “fix” one.">
                <ul className="space-y-3">
                  {data.exceptions.map(({ override: o, docTitle }) => {
                    const by = person(o.personId);
                    return (
                      <li key={o.id} className="rounded-xl bg-[#fef7e0] p-4 text-sm text-slate-700">
                        <div className="font-medium text-slate-900">
                          <Link href={`/doc/${o.docId}`} className="hover:underline">{docTitle}</Link> deliberately differs from{" "}
                          <Link href={`/doc/${o.existingDocId}`} className="hover:underline">{o.existingTitle}</Link>
                        </div>
                        <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                          <div className="rounded-lg bg-white/70 p-2">“{o.lineText}”</div>
                          <div className="rounded-lg bg-white/70 p-2">“{o.existingLineText}”</div>
                        </div>
                        <blockquote className="mt-2 border-l-2 border-[#b06000] pl-3 text-xs italic text-slate-700">“{o.reason}”</blockquote>
                        <div className="mt-1 text-[11px] text-slate-500">
                          {by?.name ?? o.personId} kept this on purpose, {timeAgo(o.at)}
                          {by && !by.active && <span className="font-medium text-[#b06000]"> · {by.name.split(" ")[0]} has left, so this note is the only record of why.</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            )}

            <Section title={`Also applies to ${client.name}`} note={`General documents for ${client.location} or globally that cover the same topics as the client's documents. The client's own documents and exceptions come first.`}>
              {applies.length === 0 ? (
                <p className="text-sm text-slate-600">No general documents found on these topics.</p>
              ) : (
                <>
                  <ul className="divide-y divide-slate-100">
                    {(allApplies ? applies : applies.slice(0, APPLIES)).map((r) => (
                      <DocLine key={r.id} r={r} trust={trustOf(r)} failed={failed(r.id)} compact />
                    ))}
                  </ul>
                  {applies.length > APPLIES && (
                    <button onClick={() => setAllApplies((x) => !x)} className="mt-2 text-xs font-medium text-blue-700 hover:underline">
                      {allApplies ? "Show fewer" : `Show all ${applies.length}`}
                    </button>
                  )}
                </>
              )}
            </Section>
          </div>

          <div className="space-y-4">
            <Section title="Colleagues who know this client" note="From the conversations, document ownership and verifications.">
              {data.people.length === 0 ? (
                <p className="text-sm text-slate-600">Nobody has worked on {client.name} in TrustDrive yet.</p>
              ) : (
                <ul className="space-y-3">
                  {data.people.map((c) => {
                    const p = person(c.personId);
                    if (!p) return null;
                    return (
                      <li key={c.personId}>
                        <div className="flex items-start gap-3">
                          <Avatar person={p} size={32} />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-900">{p.name}{c.personId === viewerId && <span className="font-normal text-slate-500"> (you)</span>}</div>
                            <div className="text-[11px] text-slate-500">{p.role}</div>
                            {c.status && <div className="text-[11px] font-medium text-[#b06000]">{c.status}</div>}
                            <ul className="mt-0.5 text-[11px] text-slate-600">
                              {c.why.map((w) => (
                                <li key={w}>{w}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                        {p.active && c.personId !== viewerId && <ContactLinks person={p} subject={client.name} />}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>

            <Section title={`Contacts at ${client.name}`} note="From the senders of the client's messages and their email signatures.">
              {!draft ? (
                <p className="text-sm text-slate-500">{data.conversations.length ? (draftError ? "Not available." : "Reading the conversations…") : "No conversations yet."}</p>
              ) : draft.contacts.length === 0 ? (
                <p className="text-sm text-slate-600">No one from the client wrote in these conversations.</p>
              ) : (
                <ul className="space-y-2">
                  {draft.contacts.map((c) => (
                    <li key={c.email ?? c.name} className="text-sm">
                      <div className="font-medium text-slate-900">{c.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {c.role && <>{c.role} · </>}
                        {c.email && <a href={`mailto:${c.email}`} className="text-blue-700 hover:underline">{c.email}</a>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Conversations" note="Newest first.">
              {data.conversations.length === 0 ? (
                <p className="text-sm text-slate-600">None yet.</p>
              ) : (
                <ul className="space-y-1">
                  {data.conversations.map((c) => (
                    <li key={c.id}>
                      <Link href={`/conversations?c=${c.id}`} className="-mx-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                        <Icon name={c.source === "email" ? "reply" : "chat"} size={16} color="#444746" />
                        <span className="min-w-0 flex-1 truncate text-slate-800">{c.title}</span>
                        {c.waiting && <span className="shrink-0 rounded-full bg-[#fef7e0] px-2 text-[10.5px] font-medium text-[#b06000]">waiting</span>}
                        <span className="shrink-0 text-[11px] text-slate-500">{timeAgo(c.last)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>
      </div>
    </main>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-6">
      <h2 className="text-lg text-slate-900">{title}</h2>
      <p className="mb-3 text-[11px] text-slate-500">{note}</p>
      {children}
    </section>
  );
}

function Stat({ value, label, tone }: { value: number | string; label: string; tone?: "warn" | "good" }) {
  const bg = tone === "warn" ? "bg-[#fef7e0]" : tone === "good" ? "bg-[#e6f4ea]" : "bg-slate-50";
  const fg = tone === "warn" ? "text-[#b06000]" : tone === "good" ? "text-[#0d652d]" : "text-slate-800";
  return (
    <div className={`rounded-xl px-3 py-2 ${bg}`}>
      <div className={`text-2xl font-semibold tabular-nums ${fg}`}>{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  );
}

function DocLine({ r, trust, failed, compact }: { r: Row; trust: TrustScore | null; failed: boolean; compact?: boolean }) {
  const { teamName } = useApp();
  const band = trust ? trustBand(trust.score) : null;
  const good = trust && trust.score >= 75;
  const reason = good ? r.strength : r.issue ?? r.strength;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <TrustBadge trust={trust} loading={!trust && !failed} error={failed} size={compact ? 32 : 38} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link href={`/doc/${r.id}`} className="truncate text-sm font-medium text-slate-900 hover:underline">{r.title}</Link>
          {!compact && <StatusPill status={r.status} />}
          {r.confidential && <ConfidentialPill />}
        </div>
        <div className="truncate text-xs text-slate-500">
          {band && <span style={{ color: band.color }}>{band.label}</span>}
          {reason && <> · {reason}</>}
        </div>
        <div className="truncate text-[11px] text-slate-500">{teamName(r.teamId)} · {formatLocations(r.locations)} · edited {timeAgo(r.updatedAt)}</div>
      </div>
    </li>
  );
}

function QuoteList({ title, note, empty, items, tone }: { title: string; note?: string; empty: string; items: DraftItem[]; tone: "warn" }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-slate-800">
        {title}
        <span className={`ml-1.5 rounded-full px-1.5 text-xs ${items.length && tone === "warn" ? "bg-[#fef7e0] text-[#b06000]" : "bg-slate-100 text-slate-600"}`}>{items.length}</span>
      </h3>
      {note && items.length > 0 && <p className="text-[11px] text-slate-500">{note}</p>}
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-[#0d652d]">✓ {empty}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((i) => (
            <Quote key={i.key} i={i} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Quote({ i, children }: { i: DraftItem; children?: React.ReactNode }) {
  return (
    <li className="rounded-lg border border-slate-200 px-3 py-2">
      <Link href={citationHref(i.conversationId, i.messageId, i.text)} className="text-sm text-slate-800 hover:underline">
        “{i.text}”
      </Link>
      <div className="text-[11px] text-slate-500">
        {i.authorName}
        {i.external ? " (client)" : ""} · {timeAgo(i.sentAt)}
      </div>
      {children}
    </li>
  );
}
