"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AppContext";
import { AnswerCard, EvidenceList } from "@/components/Expertise";
import { FaqSuggestions } from "@/components/FaqSuggestions";
import { ConfidentialPill, StatusPill } from "@/components/StatusPill";
import { Avatar } from "@/components/TopBar";
import { ContactLinks } from "@/components/WhoToContact";
import type { Area, Profile } from "@/lib/expertise";
import { timeAgo } from "@/lib/time";
import type { Person } from "@/lib/types";

export default function PersonPage() {
  const { id } = useParams<{ id: string }>();
  const { viewerId } = useApp();
  // A fresh instance per person and viewer, so no state carries over between them.
  return <PersonProfile key={`${id}:${viewerId}`} personId={id} viewerId={viewerId} />;
}

function PersonProfile({ personId, viewerId }: { personId: string; viewerId: string }) {
  const { person, teamName } = useApp();
  const [data, setData] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/people/${personId}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(r.status === 404 ? "There's no colleague with this name in TrustDrive – the link may be wrong." : (json.error ?? "Could not load the profile."));
        if (!cancelled) setData(json);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [personId, reload]);

  const p = person(personId);
  const own = personId === viewerId;
  const first = p?.name.split(" ")[0] ?? "They";

  /** Takes an area off the viewer's own profile, or puts it back. */
  const setHidden = async (key: string, hidden: boolean) => {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/me/expertise", { method: "PUT", body: JSON.stringify({ subject: key, hidden }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not change your profile.");
      setReload((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!data || !p) {
    return (
      <AppShell>
        <div className="grid flex-1 place-items-center rounded-2xl bg-white text-slate-500">
          {error ? (
            <div className="text-center">
              <p>{error}</p>
              <Link href="/people" className="mt-2 inline-block text-blue-700 hover:underline">Who knows…?</Link>
            </div>
          ) : "Loading the profile…"}
        </div>
      </AppShell>
    );
  }

  const nothing = !data.topics.length && !data.clients.length && !data.inCharge.length && !data.answers.length;
  return (
    <AppShell>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-4">
          <section className="rounded-2xl bg-white p-6">
            <Link href="/people" className="text-sm text-blue-700 hover:underline">← Who knows…?</Link>
            <div className="mt-4 flex items-center gap-4">
              <Avatar person={p} size={56} />
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl text-slate-900">{p.name}</h1>
                <div className="text-sm text-slate-600">
                  {p.role} · {teamName(p.teamId)} · {p.location} · <Status p={p} />
                </div>
                {!own && <ContactLinks person={p} subject="Question" profile={false} className="mt-1" />}
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat value={data.stats.documents} label="documents worked on" />
              <Stat value={data.stats.answeredLastYear} label="questions answered in the last year" />
              <Stat value={data.stats.verifiedLastYear} label="verified in the last year" />
              <Stat value={data.stats.conversations} label="client conversations" />
              <Stat value={data.stats.decisions} label="exceptions explained" />
            </div>
            <p className="mt-4 text-[11px] text-slate-500">
              {own ? "Your profile is built from your work in TrustDrive, so you never have to update it. Take off anything that isn't you any more." : `Built from ${first}'s work in TrustDrive: nobody typed this in. Every line links to where it comes from.`}
            </p>
            {p.active && <MentorRow personId={p.id} own={own} />}
          </section>

          {!p.active && (
            <section className="rounded-2xl bg-[#fef7e0] p-5 text-sm text-[#7a4a00]">
              {first} left the company {p.leftAt ? timeAgo(p.leftAt) : ""}, so everything below is fading. <Link href={`/handover/${p.id}`} className="font-medium underline">The handover briefing</Link> shows what {first} left behind and who can take it over.
            </section>
          )}
          {error && <section className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</section>}
          {data.faqs.length > 0 && <FaqSuggestions faqs={data.faqs} onDismissed={() => setReload((n) => n + 1)} />}
          {nothing && <section className="rounded-2xl bg-white p-6 text-sm text-slate-600">{own ? "You haven't" : `${first} hasn't`} written, verified or decided anything in TrustDrive yet.</section>}

          {data.topics.length > 0 && (
            <section className="rounded-2xl bg-white p-6">
              <h2 className="text-lg text-slate-900">Knows about</h2>
              <p className="mb-2 text-[11px] text-slate-500">Topics of the documents {own ? "you" : first} wrote, verified or decided on, and of the questions {own ? "you" : first} answered. Strongest first; open one to see why.</p>
              <AreaList areas={data.topics} own={own} busy={busy} onHide={setHidden} />
            </section>
          )}
          {data.clients.length > 0 && (
            <section className="rounded-2xl bg-white p-6">
              <h2 className="text-lg text-slate-900">Clients</h2>
              <p className="mb-2 text-[11px] text-slate-500">From the client&apos;s documents and the mail and Teams conversations {own ? "you" : first} wrote in.</p>
              <AreaList areas={data.clients} own={own} busy={busy} onHide={setHidden} />
            </section>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {data.inCharge.length > 0 && (
              <section className="rounded-2xl bg-white p-6">
                <h2 className="text-lg text-slate-900">In charge of</h2>
                <p className="mb-2 text-[11px] text-slate-500">Documents {own ? "you own" : `${first} owns`}.</p>
                <ul className="space-y-2">
                  {data.inCharge.map((d) => (
                    <li key={d.id} className="text-sm">
                      <div className="flex items-center gap-2">
                        <Link href={`/doc/${d.id}`} className="min-w-0 truncate text-slate-800 hover:underline">{d.title}</Link>
                        {d.confidential && <ConfidentialPill />}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                        <StatusPill status={d.status} />
                        {d.lastVerifiedAt ? `verified ${timeAgo(d.lastVerifiedAt)}` : <span className="text-[#b06000]">never verified</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {data.worksWith.length > 0 && (
              <section className="rounded-2xl bg-white p-6">
                <h2 className="text-lg text-slate-900">Works most with</h2>
                <p className="mb-2 text-[11px] text-slate-500">Colleagues who worked on the same documents or conversations.</p>
                <ul className="space-y-3">
                  {data.worksWith.map((w) => (
                    <Colleague key={w.personId} id={w.personId} shared={w.shared} />
                  ))}
                </ul>
              </section>
            )}
          </div>

          {data.answers.length > 0 && (
            <section className="rounded-2xl bg-white p-6">
              <h2 className="text-lg text-slate-900">Answered recently</h2>
              <p className="mb-3 text-[11px] text-slate-500">Questions colleagues asked {own ? "you" : first} in email or Teams, kept so the next person finds the answer.</p>
              <div className="space-y-3">
                {data.answers.map((a) => (
                  <AnswerCard key={a.id} a={a} />
                ))}
              </div>
            </section>
          )}

          {data.decisions.length > 0 && (
            <section className="rounded-2xl bg-white p-6">
              <h2 className="text-lg text-slate-900">Knows why</h2>
              <p className="mb-3 text-[11px] text-slate-500">Lines {own ? "you" : first} kept on purpose although they contradict another document, with the reason given at the time.</p>
              <ul className="space-y-3">
                {data.decisions.map((o) => (
                  <li key={o.id} className="rounded-xl bg-[#fef7e0] p-4 text-sm text-slate-700">
                    <div className="font-medium text-slate-900">
                      <Link href={`/doc/${o.docId}`} className="hover:underline">{o.docTitle}</Link> deliberately differs from{" "}
                      <Link href={`/doc/${o.existingDocId}`} className="hover:underline">{o.existingTitle}</Link>
                    </div>
                    <div className="mt-1 text-xs text-slate-600">“{o.lineText}”</div>
                    <blockquote className="mt-2 border-l-2 border-[#b06000] pl-3 text-xs italic text-slate-700">“{o.reason}”</blockquote>
                    <div className="mt-1 text-[11px] text-slate-500">{timeAgo(o.at)}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function AreaList({ areas, own, busy, onHide }: { areas: Area[]; own: boolean; busy: string | null; onHide: (key: string, hidden: boolean) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="divide-y divide-slate-100">
      {areas.map((a) => {
        const expanded = open === a.key;
        const counts = [
          a.documents && `${a.documents} document${a.documents === 1 ? "" : "s"}`,
          a.answers && `answered ${a.answers} question${a.answers === 1 ? "" : "s"}`,
          a.conversations && `${a.conversations} conversation${a.conversations === 1 ? "" : "s"}`,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={a.key} className={`py-2.5 ${a.hidden ? "opacity-60" : ""}`}>
            <div className="flex items-center gap-3">
              <button onClick={() => setOpen(expanded ? null : a.key)} className="min-w-0 flex-1 text-left" aria-expanded={expanded}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium text-slate-900">{a.label}</span>
                  {a.parentLabel && <span className="text-[11px] text-slate-500">{a.parentLabel}</span>}
                  {a.hidden && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">Hidden from others</span>}
                </div>
                <div className="mt-1 flex items-center gap-3">
                  <div className="h-1 w-32 shrink-0 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${a.fading ? "bg-slate-400" : "bg-[#0b57d0]"}`} style={{ width: `${Math.max(6, a.relevance * 100)}%` }} />
                  </div>
                  <span className="truncate text-[11px] text-slate-500">
                    {counts}
                    {a.fading ? <span className="text-[#b06000]"> · fading{a.lastActive ? `, last worked on ${timeAgo(a.lastActive)}` : ""}</span> : a.lastActive && <> · last active {timeAgo(a.lastActive)}</>}
                  </span>
                </div>
              </button>
              {own && (
                <button
                  disabled={busy === a.key}
                  onClick={() => onHide(a.key, !a.hidden)}
                  className="shrink-0 rounded-full px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50 disabled:opacity-60"
                  title={a.hidden ? "Show this on your profile and in “Who knows” again" : "Take this off your profile: you won't be suggested for it any more"}
                >
                  {a.hidden ? "Show again" : "Not me any more"}
                </button>
              )}
            </div>
            {expanded && <EvidenceList evidence={a.evidence} className="mt-2 pl-1" />}
          </li>
        );
      })}
    </ul>
  );
}

function Colleague({ id, shared }: { id: string; shared: Profile["worksWith"][number]["shared"] }) {
  const { person, teamName } = useApp();
  const p = person(id);
  const shown = shared.slice(0, 2);
  return (
    <li className="flex items-start gap-3">
      <Avatar person={p} size={32} />
      <div className="min-w-0 flex-1">
        <Link href={`/person/${id}`} className="text-sm font-medium text-slate-900 hover:underline">{p?.name ?? id}</Link>
        <div className="text-[11px] text-slate-500">{p ? (p.active ? `${p.role} · ${teamName(p.teamId)}` : "Left the company") : ""}</div>
        <div className="mt-0.5 text-xs text-slate-600">
          Both worked on{" "}
          {shown.map((s, i) => (
            <span key={`${s.kind}:${s.id}`}>
              {i > 0 && ", "}
              <Link href={s.kind === "doc" ? `/doc/${s.id}` : `/conversations?c=${s.id}`} className="text-slate-800 hover:underline">{s.title}</Link>
            </span>
          ))}
          {shared.length > shown.length && <> +{shared.length - shown.length} more</>}
        </div>
      </div>
    </li>
  );
}

function Status({ p }: { p: Person }) {
  const { teamName } = useApp();
  if (!p.active) return <span className="text-[#c5221f]">left the company {p.leftAt ? timeAgo(p.leftAt) : ""}</span>;
  if (p.previousTeamId && p.movedTeamAt) return <span className="text-[#b06000]">moved from {teamName(p.previousTeamId)} {timeAgo(p.movedTeamAt)}</span>;
  return <span>active</span>;
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <div className="text-2xl font-semibold tabular-nums text-slate-800">{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  );
}

/** Who mentors this person (buddy system), with a way to assign, change or remove the mentor. */
function MentorRow({ personId, own }: { personId: string; own: boolean }) {
  const { viewerId, people, person, setMentor } = useApp();
  const p = person(personId)!;
  const mentor = person(p.mentorId);
  const first = p.name.split(" ")[0];
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const candidates = people.filter((x) => x.active && x.id !== p.id && x.mentorId !== p.id).sort((a, b) => a.name.localeCompare(b.name));

  const save = async (mentorId: string | null) => {
    setError(null);
    try {
      await setMentor(p.id, mentorId);
      setEditing(false);
      setChoice("");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Mentor</span>
        {mentor ? (
          <>
            <Avatar person={mentor} size={20} />
            <Link href={`/person/${mentor.id}`} className="text-slate-900 hover:underline">{mentor.id === viewerId ? "You" : mentor.name}</Link>
            {p.mentorSince && <span className="text-[11px] text-slate-500">since {timeAgo(p.mentorSince)}</span>}
          </>
        ) : (
          <span className="text-slate-500">{own ? "You don't have a mentor." : `${first} doesn't have a mentor.`}</span>
        )}
        {!editing && (
          <button onClick={() => setEditing(true)} className="text-xs font-medium text-blue-700 hover:underline">{mentor ? "Change" : "Assign a mentor"}</button>
        )}
        {!editing && mentor && (
          <button onClick={() => save(null)} className="text-xs font-medium text-slate-600 hover:underline">Remove</button>
        )}
        {!editing && p.mentorId === viewerId && (
          <Link href={`/mentoring?p=${p.id}`} className="ml-auto text-xs font-medium text-blue-700 hover:underline">See what {first} has been asking and reading →</Link>
        )}
      </div>
      {editing && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={choice} onChange={(e) => setChoice(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm" aria-label="Mentor">
            <option value="">Choose a colleague…</option>
            {candidates.map((x) => (
              <option key={x.id} value={x.id}>{x.id === viewerId ? `Me (${x.name})` : x.name} – {x.role}</option>
            ))}
          </select>
          <button onClick={() => save(choice)} disabled={!choice} className="rounded-full bg-[#0b57d0] px-3 py-1 text-xs font-medium text-white disabled:opacity-50">Save</button>
          <button onClick={() => setEditing(false)} className="text-xs text-slate-600 hover:underline">Cancel</button>
        </div>
      )}
      {error && <div className="mt-1 text-xs text-red-700">{error}</div>}
      <p className="mt-1 text-[11px] text-slate-500">
        {mentor
          ? `${mentor.id === viewerId ? "You" : mentor.name.split(" ")[0]} can see the questions ${own ? "you ask" : `${first} asks`} in Who knows…?, drive searches, the documents ${own ? "you open" : `${first} opens`} and questions to colleagues – from the day the mentorship started. Nobody is notified.`
          : `A mentor can see what ${own ? "you ask" : `${first} asks`}, ${own ? "search for and open" : "searches for and opens"} from then on, to check in where it's needed. Nobody is notified.`}
      </p>
    </div>
  );
}
