"use client";

import { formatLocations } from "@/lib/appliesTo";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppContext";
import { ConfidentialPill, StatusPill } from "@/components/StatusPill";
import { AppShell } from "@/components/AppShell";
import { Avatar } from "@/components/TopBar";
import { TrustBadge } from "@/components/TrustBadge";
import { useScores } from "@/components/useScores";
import { ContactLinks } from "@/components/WhoToContact";
import type { BriefingContact, BriefingConversation, BriefingDoc, BriefingException } from "@/lib/briefing";
import { handoverFor } from "@/lib/handover";
import { timeAgo } from "@/lib/time";
import type { Person, TrustScore } from "@/lib/types";

type Row = BriefingDoc["doc"] & { trust: TrustScore | null };
type Item = Omit<BriefingDoc, "doc"> & { doc: Row };

interface Data {
  predecessorId: string;
  docs: Item[];
  exceptions: BriefingException[];
  contacts: BriefingContact[];
  conversations: BriefingConversation[];
}

export default function HandoverPage() {
  const { personId } = useParams<{ personId: string }>();
  const { viewerId } = useApp();
  // A fresh instance per predecessor and viewer, so no state carries over between them.
  return <Briefing key={`${personId}:${viewerId}`} personId={personId} viewerId={viewerId} />;
}

function Briefing({ personId, viewerId }: { personId: string; viewerId: string }) {
  const router = useRouter();
  const { person, people, teams, teamName, clientName } = useApp();
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/handover/${personId}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(r.status === 404 ? "There's no colleague with this name in TrustDrive – the link may be wrong." : (json.error ?? "Could not load the briefing."));
        if (!cancelled) setData(json);
      })
      .catch((e: unknown) => !cancelled && setLoadError(e instanceof Error ? e.message : "Could not load the briefing."));
    return () => {
      cancelled = true;
    };
  }, [personId, viewerId, reload]);

  const rows = useMemo(() => data?.docs.map((d) => d.doc) ?? null, [data]);
  const { trustOf, failed } = useScores(rows, viewerId);

  const predecessor = person(personId);
  const viewer = person(viewerId);
  const first = predecessor?.name.split(" ")[0] ?? "they";
  const candidates = useMemo(
    () => people.filter((p) => p.id !== viewerId).sort((a, b) => Number(a.active && !a.previousTeamId) - Number(b.active && !b.previousTeamId) || a.name.localeCompare(b.name)),
    [people, viewerId],
  );

  /** Runs one first-action request, then reloads the briefing (which rescores what changed). */
  const act = async (key: string, url: string, body: Record<string, unknown>, message: string) => {
    setBusy(key);
    setActionError(null);
    try {
      const res = await fetch(url, { method: "POST", body: JSON.stringify({ ...body }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setDone((d) => [...d, message]);
      setReload((n) => n + 1);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!data || !predecessor) {
    return (
      <AppShell>
        <div className="grid flex-1 place-items-center rounded-2xl bg-white text-slate-500">
          {loadError ? (
            <div className="text-center">
              <p>{loadError}</p>
              <Link href="/drive?view=radar" className="mt-2 inline-block text-blue-700 hover:underline">Back to the handover radar</Link>
            </div>
          ) : "Preparing the briefing…"}
        </div>
      </AppShell>
    );
  }

  const live = data.docs.filter((d) => !d.doc.supersededById);
  const scoreOf = (d: Item) => trustOf(d.doc)?.score;
  const groups = [
    { key: "safe", title: "Safe to use", note: "Trusted for you, so you can rely on these as they are.", items: live.filter((d) => (scoreOf(d) ?? -1) >= 75) },
    { key: "care", title: "Use with care", note: "Mostly fine, but check the points below before relying on them.", items: live.filter((d) => { const s = scoreOf(d); return s !== undefined && s >= 50 && s < 75; }) },
    { key: "risky", title: "Don't rely on these yet", note: "Outdated, unverified or replaced. Review them or ask someone first.", items: [...live.filter((d) => (scoreOf(d) ?? 100) < 50), ...data.docs.filter((d) => d.doc.supersededById)] },
    { key: "pending", title: "Being scored", note: "Jev is still scoring these for you.", items: live.filter((d) => scoreOf(d) === undefined) },
  ].filter((g) => g.items.length);

  const owned = data.docs.filter((d) => d.doc.ownerId === personId);
  const onlyThem = live.filter((d) => d.onlyTheyVerified);
  const withFacts = live.filter((d) => d.facts.length);
  const factCount = withFacts.reduce((n, d) => n + d.facts.length, 0);

  // First actions: hand over ownership, get the documents only they checked verified again, review risky ones.
  const actions: { key: string; doc: Row; text: string; buttons: { label: string; primary?: boolean; run: () => void }[] }[] = [];
  for (const d of live) {
    const h = d.doc.ownerId === personId && people.length ? handoverFor(d.doc, people, teams) : null;
    if (h) {
      const next = h.successors.find((s) => s.personId !== viewerId);
      actions.push({
        key: `own:${d.doc.id}`,
        doc: d.doc,
        text: `Needs a new owner: ${h.reasons[0].text.toLowerCase()}`,
        buttons: [
          { label: "Take over", primary: true, run: () => act(`own:${d.doc.id}`, `/api/docs/${d.doc.id}/owner`, { ownerId: viewerId }, `You now own “${d.doc.title}”`) },
          ...(next ? [{ label: `Assign to ${person(next.personId)?.name.split(" ")[0]}`, run: () => act(`own:${d.doc.id}`, `/api/docs/${d.doc.id}/owner`, { ownerId: next.personId }, `“${d.doc.title}” assigned to ${person(next.personId)?.name}`) }] : []),
        ],
      });
    }
    if (d.onlyTheyVerified) {
      actions.push({
        key: `verify:${d.doc.id}`,
        doc: d.doc,
        text: `Only ${first} ever verified it – check it and confirm it's still correct`,
        buttons: [
          { label: "Open", run: () => router.push(`/doc/${d.doc.id}`) },
          { label: "I checked it – verify", primary: true, run: () => act(`verify:${d.doc.id}`, `/api/docs/${d.doc.id}/verify`, {}, `You verified “${d.doc.title}”`) },
        ],
      });
    } else if (!h && (scoreOf(d) ?? 100) < 50) {
      actions.push({ key: `review:${d.doc.id}`, doc: d.doc, text: "Low trust for you – review it before relying on it", buttons: [{ label: "Review", primary: true, run: () => router.push(`/doc/${d.doc.id}`) }] });
    }
  }

  return (
    <AppShell>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-4">
          {/* Header */}
          <section className="rounded-2xl bg-white p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
              <Link href="/drive?view=radar" className="text-sm text-blue-700 hover:underline">← Handover radar</Link>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                Taking over from
                <select value={personId} onChange={(e) => router.push(`/handover/${e.target.value}`)} className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm">
                  {candidates.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {!p.active ? " (left)" : p.previousTeamId ? " (moved team)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-4">
              <Avatar person={predecessor} size={56} />
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-wide text-slate-500">Handover briefing</div>
                <h1 className="text-2xl text-slate-900">What you inherit from {predecessor.name}</h1>
                <div className="text-sm text-slate-600">
                  {predecessor.role} · {teamName(predecessor.previousTeamId ?? predecessor.teamId)} · <PersonStatus p={predecessor} teamName={teamName} />
                </div>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat value={data.docs.length} label={`documents ${first} worked on`} />
              <Stat value={groups.find((g) => g.key === "safe")?.items.length ?? 0} label="safe to use for you" />
              <Stat value={data.exceptions.length} label="known exceptions" tone={data.exceptions.length ? "warn" : undefined} />
              <Stat value={onlyThem.length} label={`only ${first} verified`} tone={onlyThem.length ? "warn" : undefined} />
            </div>
            <p className="mt-4 text-[11px] text-slate-500">
              Prepared for {viewer?.name ?? "you"} from the edit history, verifications and conflict decisions. Trust scores are calculated for you.
            </p>
          </section>

          {data.docs.length === 0 && (
            <section className="rounded-2xl bg-white p-6 text-sm text-slate-600">{predecessor.name} didn&apos;t own, write or verify any document in the drive.</section>
          )}

          {/* Documents by trust */}
          {groups.length > 0 && (
            <section className="rounded-2xl bg-white p-6">
              <h2 className="text-lg text-slate-900">Documents you inherit</h2>
              {groups.map((g) => (
                <div key={g.key} className="mt-4">
                  <h3 className="text-sm font-medium text-slate-800">
                    {g.title}
                    <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{g.items.length}</span>
                  </h3>
                  <p className="text-[11px] text-slate-500">{g.note}</p>
                  <ul className="divide-y divide-slate-100">
                    {g.items.map((d) => (
                      <DocRow key={d.doc.id} d={d} trust={trustOf(d.doc)} failed={failed(d.doc.id)} />
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}

          {/* Known exceptions */}
          {data.exceptions.length > 0 && (
            <section className="rounded-2xl bg-white p-6">
              <h2 className="text-lg text-slate-900">Known exceptions</h2>
              <p className="mb-3 text-[11px] text-slate-500">
                Lines that contradict another document on purpose. They look like mistakes, so read the reason before you “fix” one.
              </p>
              <ul className="space-y-3">
                {data.exceptions.map((e) => (
                  <ExceptionCard key={e.override.id} e={e} predecessor={predecessor} />
                ))}
              </ul>
            </section>
          )}

          {/* What they knew */}
          {(withFacts.length > 0 || onlyThem.length > 0 || owned.length > 0) && (
            <section className="rounded-2xl bg-white p-6">
              <h2 className="text-lg text-slate-900">What {first} knew</h2>
              <div className="mt-3 grid gap-6 md:grid-cols-2">
                {withFacts.length > 0 && (
                  <div className="md:col-span-2">
                    <h3 className="text-sm font-medium text-slate-800">Figures {first} wrote that are still in use ({factCount})</h3>
                    <p className="mb-2 text-[11px] text-slate-500">From the edit history: lines with amounts, rates or dates that {first} added and nobody has changed since.</p>
                    <ul className="space-y-2">
                      {withFacts.map((d) => (
                        <li key={d.doc.id} className="text-sm">
                          <Link href={`/doc/${d.doc.id}`} className="font-medium text-slate-800 hover:underline">{d.doc.title}</Link>
                          <ul className="mt-0.5 space-y-0.5 text-xs text-slate-600">
                            {d.facts.map((f) => (
                              <li key={f.lineNo} className="flex gap-2">
                                <span className="w-12 shrink-0 text-right tabular-nums text-slate-400">line {f.lineNo}</span>
                                <span>{f.text}</span>
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {onlyThem.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-slate-800">Only {first} verified</h3>
                    <p className="mb-2 text-[11px] text-slate-500">Nobody else has ever confirmed these are correct.</p>
                    <DocList docs={onlyThem.map((d) => d.doc)} />
                  </div>
                )}
                {owned.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-slate-800">{first} owned</h3>
                    <p className="mb-2 text-[11px] text-slate-500">{predecessor.active && !predecessor.previousTeamId ? "Still theirs." : "These need a new owner unless they were replaced."}</p>
                    <DocList docs={owned.map((d) => d.doc)} />
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Conversations: knowledge that may only live in mail and chat */}
          {data.conversations.length > 0 && (
            <section className="rounded-2xl bg-white p-6">
              <h2 className="text-lg text-slate-900">Conversations {first} took part in</h2>
              <p className="mb-3 text-[11px] text-slate-500">Agreements and promises made by email or in Teams often never reach a document. Turn them into a client handover document while the context is still there.</p>
              <div className="space-y-4">
                {[...new Set(data.conversations.map((c) => c.clientId ?? ""))].map((clientId) => {
                  const convs = data.conversations.filter((c) => (c.clientId ?? "") === clientId);
                  return (
                    <div key={clientId || "none"} className="rounded-xl border border-slate-200 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-800">{clientId ? clientName(clientId) : "No client"}</span>
                        <Link
                          href={`/conversations/handover?ids=${convs.map((c) => c.id).join(",")}${clientId ? `&client=${clientId}` : ""}`}
                          className="rounded-full bg-[#0b57d0] px-3 py-1 text-xs font-medium text-white hover:bg-[#0842a0]"
                        >
                          Create handover document
                        </Link>
                      </div>
                      <ul className="space-y-0.5 text-sm">
                        {convs.map((c) => (
                          <li key={c.id} className="flex items-center gap-2">
                            <span className="text-xs">{c.source === "email" ? "✉" : "💬"}</span>
                            <Link href={`/conversations?c=${c.id}`} className="min-w-0 flex-1 truncate text-slate-700 hover:underline">{c.title}</Link>
                            <span className="shrink-0 text-[11px] text-slate-500">{c.messages} msg · {timeAgo(c.last)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Who to ask + first actions */}
          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-2xl bg-white p-6">
              <h2 className="text-lg text-slate-900">Who to ask</h2>
              <ul className="mt-3 space-y-3">
                {predecessor.active && (
                  <li className="rounded-xl bg-[#e8f0fe] p-3">
                    <ContactRow p={predecessor} why={[predecessor.previousTeamId ? `Still at the company, now in ${teamName(predecessor.teamId)} – ask them first` : "Still at the company – ask them first"]} subject={`Handover of your documents`} />
                  </li>
                )}
                {data.contacts.map((c) => {
                  const p = person(c.personId);
                  return p ? (
                    <li key={c.personId}>
                      <ContactRow p={p} why={c.why} subject={`Handover from ${predecessor.name}`} />
                    </li>
                  ) : null;
                })}
                {!predecessor.active && data.contacts.length === 0 && <li className="text-sm text-slate-500">Nobody else active worked on these documents.</li>}
              </ul>
            </section>

            <section className="rounded-2xl bg-white p-6">
              <h2 className="text-lg text-slate-900">First actions</h2>
              {actionError && <div className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{actionError}</div>}
              <ul className="mt-3 space-y-3">
                {actions.map((a) => (
                  <li key={a.key} className="rounded-xl border border-slate-200 p-3">
                    <Link href={`/doc/${a.doc.id}`} className="text-sm font-medium text-slate-800 hover:underline">{a.doc.title}</Link>
                    <div className="text-xs text-slate-600">{a.text}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {a.buttons.map((b) => (
                        <button
                          key={b.label}
                          disabled={busy === a.key}
                          onClick={b.run}
                          className={`rounded-full px-3 py-1 text-xs font-medium disabled:opacity-60 ${b.primary ? "bg-[#0b57d0] text-white hover:bg-[#0842a0]" : "bg-white text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50"}`}
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
                {actions.length === 0 && <li className="text-sm text-slate-500">Nothing left to do – every inherited document has an owner and has been checked.</li>}
              </ul>
              {done.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-[#0d652d]">
                  {done.map((m, i) => (
                    <li key={i}>✓ {m}</li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function PersonStatus({ p, teamName }: { p: Person; teamName: (id: string) => string }) {
  if (!p.active) return <span className="text-[#c5221f]">left the company {p.leftAt ? timeAgo(p.leftAt) : ""}</span>;
  if (p.previousTeamId && p.movedTeamAt) return <span className="text-[#b06000]">moved to {teamName(p.teamId)} {timeAgo(p.movedTeamAt)}</span>;
  return <span>active</span>;
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: "warn" }) {
  return (
    <div className={`rounded-xl px-3 py-2 ${tone ? "bg-[#fef7e0]" : "bg-slate-50"}`}>
      <div className={`text-2xl font-semibold tabular-nums ${tone ? "text-[#b06000]" : "text-slate-800"}`}>{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  );
}

function DocRow({ d, trust, failed }: { d: Item; trust: TrustScore | null; failed: boolean }) {
  const { teamName } = useApp();
  return (
    <li className="flex gap-3 py-3">
      <TrustBadge trust={trust} loading={!trust && !failed} error={failed} size={38} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link href={`/doc/${d.doc.id}`} className="truncate text-sm font-medium text-slate-800 hover:underline">{d.doc.title}</Link>
          <StatusPill status={d.doc.status} />
          {d.doc.confidential && <ConfidentialPill />}
        </div>
        <div className="text-[11px] text-slate-500">{teamName(d.doc.teamId)} · {formatLocations(d.doc.locations)} · edited {timeAgo(d.doc.updatedAt)}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {d.involvement.map((x) => (
            <span key={x} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] text-slate-600">{x}</span>
          ))}
        </div>
        <ul className="mt-1.5 space-y-0.5 text-xs">
          {d.good.map((t) => (
            <li key={t} className="text-[#0d652d]">✓ {t}</li>
          ))}
          {d.watch.map((t) => (
            <li key={t} className="text-[#b06000]">! {t}</li>
          ))}
        </ul>
      </div>
    </li>
  );
}

function ExceptionCard({ e, predecessor }: { e: BriefingException; predecessor: Person }) {
  const { person } = useApp();
  const o = e.override;
  const by = person(o.personId);
  const gone = by && !by.active;
  return (
    <li className="rounded-xl bg-[#fef7e0] p-4 text-sm text-slate-700">
      <div className="font-medium text-slate-900">
        <Link href={`/doc/${o.docId}`} className="hover:underline">{e.docTitle}</Link> deliberately differs from{" "}
        <Link href={`/doc/${o.existingDocId}`} className="hover:underline">{o.existingTitle}</Link>
      </div>
      <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
        <div className="rounded-lg bg-white/70 p-2">
          <div className="text-[11px] text-slate-500">{e.docTitle}, line {o.lineNo}</div>“{o.lineText}”
        </div>
        <div className="rounded-lg bg-white/70 p-2">
          <div className="text-[11px] text-slate-500">{o.existingTitle}, line {o.existingLineNo}</div>“{o.existingLineText}”
        </div>
      </div>
      <blockquote className="mt-2 border-l-2 border-[#b06000] pl-3 text-xs italic text-slate-700">“{o.reason}”</blockquote>
      <div className="mt-1 text-[11px] text-slate-500">
        {by?.name ?? o.personId} kept this on purpose, {timeAgo(o.at)}
      </div>
      {gone && (
        <p className="mt-2 text-xs font-medium text-[#b06000]">
          {by.id === predecessor.id ? by.name.split(" ")[0] : by.name} has left, so this note is the only record of why. Don&apos;t align the line with the other document without checking first.
        </p>
      )}
    </li>
  );
}

function DocList({ docs }: { docs: Row[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {docs.map((d) => (
        <li key={d.id}>
          <Link href={`/doc/${d.id}`} className="text-slate-800 hover:underline">{d.title}</Link>
          {d.supersededById && <span className="ml-1.5 text-[11px] text-slate-500">(replaced)</span>}
        </li>
      ))}
    </ul>
  );
}

function ContactRow({ p, why, subject }: { p: Person; why: string[]; subject: string }) {
  const { teamName } = useApp();
  return (
    <div className="flex items-start gap-3">
      <Avatar person={p} size={32} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-900">{p.name}</div>
        <div className="text-[11px] text-slate-500">{p.role} · {teamName(p.teamId)}</div>
        <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
          {why.map((w) => (
            <li key={w}>• {w}</li>
          ))}
        </ul>
        <ContactLinks person={p} subject={subject} className="mt-1" />
      </div>
    </div>
  );
}
