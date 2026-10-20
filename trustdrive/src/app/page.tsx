"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MESSAGE_SENT, useCompose } from "@/components/Compose";
import { useApp } from "@/components/AppContext";
import { FaqSuggestions } from "@/components/FaqSuggestions";
import { Icon } from "@/components/Icons";
import { ShareAnswers } from "@/components/ShareAnswers";
import { ConfidentialPill } from "@/components/StatusPill";
import { LegalBadge } from "@/components/LegalBadge";
import { Avatar } from "@/components/TopBar";
import { TrustBadge, trustBand } from "@/components/TrustBadge";
import { useScores } from "@/components/useScores";
import type { FaqSuggestion } from "@/lib/answers";
import { daysSince, timeAgo } from "@/lib/time";
import type { AnswerView, Doc, Person, TrustScore } from "@/lib/types";

type Row = Omit<Doc, "content"> & { trust: TrustScore | null; issue: string | null; strength: string | null; role: "owner" | "collaborator"; lastVerifiedAt: string | null };

interface Home {
  viewer: Person;
  mine: Row[];
  team: Row[];
  waiting: { conversationId: string; title: string; source: "email" | "teams"; clientId: string | null; authorName: string; authorEmail: string | null; sentAt: string; ask: string }[];
  handovers: { formerOwnerId: string | null; reason: string; docs: { id: string; title: string }[] }[];
  impact: { opens: number; readers: number; latestOpen: { personId: string; at: string; docId: string; title: string } | null; verified: number; topics: string[] };
  fresh: Row[];
  faqs: FaqSuggestion[];
  toShare: AnswerView[];
}

const STALE_DAYS = 180;
/** How many quick wins to show before "Show all", so the list never feels endless. */
const QUICK = 3;

/** What's going well for the viewer, and the few things that need them today. */
export default function ForYou() {
  const { viewerId } = useApp();
  return (
    <AppShell>
      <HomeView key={viewerId} viewerId={viewerId} />
    </AppShell>
  );
}

function HomeView({ viewerId }: { viewerId: string }) {
  const { person, teamName, clientName } = useApp();
  const compose = useCompose();
  const [data, setData] = useState<Home | null>(null);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/home`)
      .then((r) => r.json())
      .then((j) => !cancelled && setData(j))
      .catch(() => !cancelled && setError("Could not load your overview."));
    return () => {
      cancelled = true;
    };
  }, [viewerId, reload]);

  // A reply sent from here takes the client off the "waiting" list.
  useEffect(() => {
    const again = () => setReload((n) => n + 1);
    window.addEventListener(MESSAGE_SENT, again);
    return () => window.removeEventListener(MESSAGE_SENT, again);
  }, []);

  const rows = useMemo(() => {
    if (!data) return null;
    const seen = new Set<string>();
    return [...data.mine, ...data.team, ...data.fresh].filter((r) => !seen.has(r.id) && seen.add(r.id));
  }, [data]);
  const { trustOf, failed } = useScores(rows, viewerId);

  if (!data) {
    return <main className="grid flex-1 place-items-center rounded-2xl bg-white text-sm text-slate-500">{error ?? "Loading your overview…"}</main>;
  }

  // Confirming records a verification; reloading drops the old score so the document is rescored.
  const confirm = async (id: string) => {
    setConfirming(id);
    try {
      const res = await fetch(`/api/docs/${id}/verify`, { method: "POST" });
      if (res.ok) {
        setConfirmed((s) => new Set(s).add(id));
        setReload((n) => n + 1);
      }
    } finally {
      setConfirming(null);
    }
  };

  const stale = (r: Row) => !r.lastVerifiedAt || daysSince(r.lastVerifiedAt) > STALE_DAYS;
  const byScore = (a: Row, b: Row) => (trustOf(a)?.score ?? 101) - (trustOf(b)?.score ?? 101);
  const needsYou = data.mine.filter((r) => !confirmed.has(r.id) && (((trustOf(r)?.score ?? 100) < 75) || stale(r))).sort(byScore);
  const justConfirmed = data.mine.filter((r) => confirmed.has(r.id));
  const scoredMine = data.mine.filter((r) => trustOf(r));
  const trustedMine = scoredMine.filter((r) => trustOf(r)!.score >= 75).length;
  const weakest = data.team.filter((r) => (trustOf(r)?.score ?? 100) < 75).sort(byScore).slice(0, QUICK);
  const fresh = data.fresh.filter((r) => (trustOf(r)?.score ?? 0) >= 75).slice(0, 4);
  const { impact } = data;
  const reader = impact.latestOpen ? person(impact.latestOpen.personId) : undefined;

  const headline =
    needsYou.length === 0 && data.waiting.length === 0
      ? "Everything is in good shape – your documents are trusted and no client is waiting."
      : [
          needsYou.length && `${needsYou.length} quick win${needsYou.length === 1 ? "" : "s"} to keep your documents trusted`,
          data.waiting.length && `${data.waiting.length} client${data.waiting.length === 1 ? "" : "s"} to answer`,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <main className="min-h-0 flex-1 overflow-y-auto rounded-2xl bg-white">
      <div className="mx-auto max-w-6xl p-4 sm:p-8">
        <h1 className="text-3xl text-slate-900">For you</h1>
        <p className="mt-1 text-slate-600">{headline}</p>
        <p className="mt-1 text-xs text-slate-500">
          {data.viewer.role} · {teamName(data.viewer.teamId)} · {data.viewer.location}. Trust scores are calculated for you: the same document can score differently for a colleague elsewhere.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Tile
            visual={<Ring value={scoredMine.length ? trustedMine / scoredMine.length : null} />}
            value={scoredMine.length ? `${trustedMine} of ${data.mine.length}` : data.mine.length ? "…" : "–"}
            label={data.mine.length ? "of your documents are trusted" : "You don't maintain any documents yet"}
          />
          <Tile
            visual={<Bubble icon="person" />}
            value={String(impact.opens)}
            label={impact.opens ? `times colleagues opened your documents this month (${impact.readers} ${impact.readers === 1 ? "person" : "people"})` : "opens of your documents this month"}
          />
          <Tile
            visual={<Bubble icon="check" />}
            value={String(impact.verified)}
            label={impact.verified === 1 ? "document you confirmed this month" : "documents you confirmed this month"}
          />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] [&>*]:min-w-0">
          <div className="space-y-6">
            {data.toShare.length > 0 && <ShareAnswers answers={data.toShare} onDone={() => setReload((n) => n + 1)} />}
            {data.faqs.length > 0 && <FaqSuggestions faqs={data.faqs} onDismissed={() => setReload((n) => n + 1)} />}
            <Card
              icon="check"
              title="Quick wins"
              note={`Your documents that score below 75 for you or weren't confirmed in the last ${STALE_DAYS} days. If one is still correct, confirm it – it's rescored straight away.`}
            >
              {needsYou.length === 0 ? (
                <AllClear text={data.mine.length ? "All clear – every document you maintain is trusted and recently confirmed." : "You don't own or work on any documents yet."} />
              ) : (
                <>
                  <ul className="divide-y divide-slate-100">
                    {(showAll ? needsYou : needsYou.slice(0, QUICK)).map((r) => (
                      <DocLine
                        key={r.id}
                        r={r}
                        trust={trustOf(r)}
                        failed={failed(r.id)}
                        extra={`${r.role === "owner" ? "You own it" : "You work on it"} · ${r.lastVerifiedAt ? `confirmed ${timeAgo(r.lastVerifiedAt)}` : "never confirmed"}`}
                      >
                        <Link href={`/doc/${r.id}`} className="shrink-0 rounded-full px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50">Review</Link>
                        <button
                          onClick={() => confirm(r.id)}
                          disabled={confirming === r.id}
                          className="shrink-0 rounded-full bg-[#c2e7ff] px-3 py-1 text-xs font-medium text-slate-900 hover:bg-[#b3dcf7] disabled:opacity-60"
                        >
                          {confirming === r.id ? "Confirming…" : "Still correct"}
                        </button>
                      </DocLine>
                    ))}
                  </ul>
                  {needsYou.length > QUICK && (
                    <button onClick={() => setShowAll((x) => !x)} className="mt-2 text-xs font-medium text-blue-700 hover:underline">
                      {showAll ? "Show fewer" : `Show all ${needsYou.length}`}
                    </button>
                  )}
                </>
              )}
              {justConfirmed.length > 0 && (
                <div className="mt-3 rounded-xl bg-[#e6f4ea] px-3 py-2 text-xs text-[#0d652d]">
                  <Icon name="check" size={14} color="#188038" /> Thanks – you confirmed {justConfirmed.map((r) => r.title).join(", ")}. Colleagues relying on {justConfirmed.length === 1 ? "it" : "them"} now see a fresher score.
                </div>
              )}
            </Card>

            <Card icon="reply" title="Clients waiting for an answer" note="The last message in these conversations is a client asking for something.">
              {data.waiting.length === 0 ? (
                <AllClear text="No client is waiting on your team." />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.waiting.map((w) => {
                    const days = Math.floor(daysSince(w.sentAt));
                    return (
                      <li key={w.conversationId} className="flex items-start gap-3 py-3">
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-200 text-xs font-medium text-slate-700">{w.authorName.split(/\s+/).map((x) => x[0]).slice(0, 2).join("")}</div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-slate-900">
                            <span className="font-medium">{w.authorName}</span>
                            {w.clientId && <span className="text-slate-500"> · {clientName(w.clientId)}</span>}
                            <span className={days > 7 ? "text-[#c5221f]" : "text-slate-500"}> · {timeAgo(w.sentAt)}</span>
                          </div>
                          <div className="mt-0.5 text-sm text-slate-700">“{w.ask}”</div>
                          <div className="text-[11px] text-slate-500">{w.source === "email" ? "Email" : "Teams"} · {w.title}</div>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Link href={`/conversations?c=${w.conversationId}`} className="rounded-full px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50">Open</Link>
                          <button
                            onClick={() => compose({ source: w.source, conversationId: w.conversationId, conversationTitle: w.title })}
                            className="rounded-full bg-[#0b57d0] px-3 py-1 text-xs font-medium text-white hover:bg-[#0842a0]"
                          >
                            Reply
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card icon="doc" title="New and trusted for you" note={`Updated in the last 30 days, applies to ${data.viewer.location}, and scores 75 or more for you.`}>
              {fresh.length === 0 ? (
                <p className="py-3 text-sm text-slate-600">{data.fresh.some((r) => !trustOf(r) && !failed(r.id)) ? "Checking recent updates…" : "No new trusted documents this month."}</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {fresh.map((r) => (
                    <DocLine key={r.id} r={r} trust={trustOf(r)} failed={failed(r.id)} good extra={`${teamName(r.teamId)} · updated ${timeAgo(r.updatedAt)}`} />
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            <Card icon="person" title="Your impact" note="How colleagues rely on what you maintain.">
              <ul className="space-y-3 py-1 text-sm text-slate-700">
                {impact.latestOpen && (
                  <li className="flex items-center gap-2">
                    <Avatar person={reader} size={28} />
                    <span className="min-w-0">
                      <span className="font-medium text-slate-900">{reader?.name ?? "A colleague"}</span> opened{" "}
                      <Link href={`/doc/${impact.latestOpen.docId}`} className="text-blue-700 hover:underline">{impact.latestOpen.title}</Link>{" "}
                      <span className="text-slate-500">{timeAgo(impact.latestOpen.at)}</span>
                    </span>
                  </li>
                )}
                {impact.topics.length > 0 && (
                  <li>
                    <div className="text-xs text-slate-500">Topics you know about</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {impact.topics.map((t) => (
                        <span key={t} className="rounded-full bg-[#e8f0fe] px-2.5 py-0.5 text-xs font-medium text-[#0b57d0]">{t}</span>
                      ))}
                    </div>
                  </li>
                )}
                {!impact.latestOpen && impact.topics.length === 0 && <li className="text-slate-600">Documents you write and confirm show up here once colleagues use them.</li>}
              </ul>
            </Card>

            <Card icon="handover" title="Knowledge you could own" note="Documents without an active owner, where you'd be a good successor.">
              {data.handovers.length === 0 ? (
                <AllClear text="Every document you'd be suggested for has an owner." />
              ) : (
                <ul className="space-y-3">
                  {data.handovers.map((h) => {
                    const p = person(h.formerOwnerId);
                    return (
                      <li key={h.formerOwnerId ?? "none"} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-center gap-2">
                          <Avatar person={p} size={28} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-slate-900">{p ? p.name : "No owner"}</div>
                            <div className="truncate text-[11px] text-[#b06000]">{h.reason}</div>
                          </div>
                        </div>
                        <ul className="mt-2 space-y-0.5 text-xs text-slate-700">
                          {h.docs.map((d) => (
                            <li key={d.id} className="truncate">• <Link href={`/doc/${d.id}`} className="hover:underline">{d.title}</Link></li>
                          ))}
                        </ul>
                        {p && (
                          <Link href={`/handover/${p.id}`} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline">
                            Read what you&apos;d inherit <Icon name="chevron" size={14} />
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card icon="folder" title={`Help ${teamName(data.viewer.teamId)}`} note="Team documents colleagues may rely on that could use an update.">
              {weakest.length === 0 ? (
                <AllClear text="Everything your team maintains is trusted." />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {weakest.map((r) => (
                    <DocLine key={r.id} r={r} trust={trustOf(r)} failed={failed(r.id)} compact />
                  ))}
                </ul>
              )}
              <Link href={`/drive?view=attention`} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline">
                Everything that needs attention <Icon name="chevron" size={14} />
              </Link>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}

function Tile({ visual, value, label }: { visual: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-[#f0f4f9] p-4">
      {visual}
      <div className="min-w-0">
        <div className="text-2xl font-medium text-slate-900">{value}</div>
        <div className="text-xs text-slate-600">{label}</div>
      </div>
    </div>
  );
}

/** Share of trusted documents as a ring, in the trusted band's green. */
function Ring({ value }: { value: number | null }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <svg width={44} height={44} viewBox="0 0 44 44" className="shrink-0" aria-hidden>
      <circle cx={22} cy={22} r={r} fill="none" stroke="#dadce0" strokeWidth={5} />
      {value !== null && <circle cx={22} cy={22} r={r} fill="none" stroke="#188038" strokeWidth={5} strokeLinecap="round" strokeDasharray={`${c * value} ${c}`} transform="rotate(-90 22 22)" />}
    </svg>
  );
}

function Bubble({ icon }: { icon: Parameters<typeof Icon>[0]["name"] }) {
  return (
    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white">
      <Icon name={icon} color="#0b57d0" />
    </div>
  );
}

function Card({ icon, title, note, children }: { icon: Parameters<typeof Icon>[0]["name"]; title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 p-5">
      <div className="flex items-center gap-2">
        <Icon name={icon} color="#0b57d0" />
        <h2 className="text-base font-medium text-slate-900">{title}</h2>
      </div>
      <p className="mb-2 mt-0.5 text-xs text-slate-500">{note}</p>
      {children}
    </section>
  );
}

function AllClear({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-[#e6f4ea] px-3 py-3 text-sm text-[#0d652d]">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white">
        <Icon name="check" size={16} color="#188038" />
      </div>
      {text}
    </div>
  );
}

function DocLine({ r, trust, failed, extra, compact, good, children }: { r: Row; trust: TrustScore | null; failed: boolean; extra?: string; compact?: boolean; good?: boolean; children?: React.ReactNode }) {
  const band = trust ? trustBand(trust.score) : null;
  const reason = good ? r.strength : r.issue;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <TrustBadge trust={trust} loading={!trust && !failed} error={failed} size={compact ? 32 : 38} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link href={`/doc/${r.id}`} className="truncate text-sm font-medium text-slate-900 hover:underline">{r.title}</Link>
          {r.confidential && <ConfidentialPill />}
          <LegalBadge doc={r} compact />
        </div>
        <div className="truncate text-xs text-slate-500">
          {band && <span style={{ color: band.color }}>{band.label}</span>}
          {reason && <> · {reason}</>}
        </div>
        {extra && <div className="truncate text-[11px] text-slate-500">{extra}</div>}
      </div>
      {children && <div className="flex shrink-0 gap-2">{children}</div>}
    </li>
  );
}
