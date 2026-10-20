"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AppContext";
import { Avatar } from "@/components/TopBar";
import { trustBand } from "@/components/TrustBadge";
import { ContactLinks } from "@/components/WhoToContact";
import type { MenteeView, StruggleArea } from "@/lib/mentoring";
import { timeAgo } from "@/lib/time";

interface Overview {
  mentor: { personId: string; since: string | null } | null;
  mentees: { personId: string; since: string; counts: MenteeView["counts"]; struggling: { teamId: string; reasons: string[] }[]; lastAt: string | null }[];
}

/**
 * Buddy system: who you mentor, and for each mentee what they asked, searched for and opened since you
 * became their mentor – by department, so you can see where they struggle and step in. Nobody gets a
 * notification; the mentee can see who their mentor is and what that mentor can see.
 */
export default function MentoringPage() {
  return (
    <AppShell>
      <Suspense fallback={<main className="flex-1 rounded-2xl bg-white" />}>
        <MentoringView />
      </Suspense>
    </AppShell>
  );
}

function MentoringView() {
  const router = useRouter();
  const params = useSearchParams();
  const { viewerId, people } = useApp();
  const selected = params.get("p");
  // Keyed by viewer and by the people list (which changes when a mentor is assigned), so it's never stale.
  const mentorKey = people.map((p) => `${p.id}>${p.mentorId ?? ""}`).join(",");
  const key = `${viewerId}:${mentorKey}`;
  const [loaded, setLoaded] = useState<{ key: string; data: Overview } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/mentoring")
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Could not load mentoring.");
        if (!cancelled) setLoaded({ key, data: json });
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [key]);

  const data = loaded?.key === key ? loaded.data : null;
  const open = selected && data?.mentees.some((m) => m.personId === selected) ? selected : null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-4">
        <section className="rounded-2xl bg-white p-6">
          <h1 className="text-2xl text-slate-900">Mentoring</h1>
          <p className="mt-1 text-sm text-slate-600">
            A mentor sees what their mentee asks in <Link href="/people" className="text-blue-700 hover:underline">Who knows…?</Link>, searches for in the drive, opens, and asks colleagues by email or Teams, grouped by department. That way you can check in when a newcomer keeps circling a subject, without them having to ask and without anyone being notified.
          </p>
          {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        </section>

        {data?.mentor && <YourMentor mentorId={data.mentor.personId} since={data.mentor.since} />}

        <section className="rounded-2xl bg-white p-6">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="text-lg text-slate-900">Your mentees</h2>
            <MentorSomeone />
          </div>
          {!data ? (
            <p className="mt-3 text-sm text-slate-500">Loading…</p>
          ) : data.mentees.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">You don&apos;t mentor anyone yet. Pick a colleague above, or set someone&apos;s mentor on their profile.</p>
          ) : (
            <ul className="mt-3 grid gap-3 md:grid-cols-2">
              {data.mentees.map((m) => (
                <MenteeCard key={m.personId} m={m} active={open === m.personId} onOpen={() => router.replace(open === m.personId ? "/mentoring" : `/mentoring?p=${m.personId}`, { scroll: false })} />
              ))}
            </ul>
          )}
        </section>

        {open && <MenteeDetail key={`${open}:${key}`} personId={open} />}
      </div>
    </div>
  );
}

function YourMentor({ mentorId, since }: { mentorId: string; since: string | null }) {
  const { person } = useApp();
  const mentor = person(mentorId);
  if (!mentor) return null;
  const first = mentor.name.split(" ")[0];
  return (
    <section className="rounded-2xl bg-[#e8f0fe] p-5 text-sm text-slate-700">
      <div className="flex items-center gap-3">
        <Avatar person={mentor} size={36} />
        <div className="min-w-0 flex-1">
          <div className="text-slate-900">
            <Link href={`/person/${mentor.id}`} className="font-medium hover:underline">{mentor.name}</Link> is your mentor{since ? ` since ${timeAgo(since)}` : ""}.
          </div>
          <div className="text-xs text-slate-600">
            {first} can see the questions you ask in Who knows…?, what you search for in the drive, the documents you open and the questions you send colleagues – only from when {first} became your mentor, and only {first}.
          </div>
        </div>
      </div>
      <ContactLinks person={mentor} subject="Question" profile={false} className="mt-2 pl-12" />
    </section>
  );
}

/** Pick a colleague to mentor. Replaces their current mentor, if they have one. */
function MentorSomeone() {
  const { viewerId, people, person, setMentor } = useApp();
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const candidates = people.filter((p) => p.active && p.id !== viewerId && p.mentorId !== viewerId && person(viewerId)?.mentorId !== p.id).sort((a, b) => a.name.localeCompare(b.name));
  const current = person(person(choice)?.mentorId);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await setMentor(choice, viewerId);
      setChoice("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="text-slate-600" htmlFor="mentor-someone">Mentor someone:</label>
      <select id="mentor-someone" value={choice} onChange={(e) => setChoice(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm">
        <option value="">Choose a colleague…</option>
        {candidates.map((p) => (
          <option key={p.id} value={p.id}>{p.name} – {p.role}</option>
        ))}
      </select>
      <button onClick={save} disabled={!choice || busy} className="rounded-full bg-[#0b57d0] px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
        Become their mentor
      </button>
      {current && <span className="text-[11px] text-slate-500">replaces {current.name} as mentor</span>}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}

function MenteeCard({ m, active, onOpen }: { m: Overview["mentees"][number]; active: boolean; onOpen: () => void }) {
  const { person, teamName } = useApp();
  const p = person(m.personId);
  if (!p) return null;
  return (
    <li className={`rounded-xl p-4 ring-1 ${active ? "bg-[#f8fafd] ring-[#0b57d0]" : "ring-slate-200"}`}>
      <button onClick={onOpen} className="flex w-full items-center gap-3 text-left" aria-expanded={active}>
        <Avatar person={p} size={36} />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-slate-900">{p.name}</div>
          <div className="text-xs text-slate-500">
            {p.role} · {teamName(p.teamId)} · joined {timeAgo(p.joinedAt)} · your mentee since {timeAgo(m.since)}
          </div>
        </div>
        <span className="text-xs font-medium text-blue-700">{active ? "Close" : "Open"}</span>
      </button>
      <div className="mt-2 text-xs text-slate-600">
        {m.counts.questions} question{m.counts.questions === 1 ? "" : "s"} · {m.counts.searches} search{m.counts.searches === 1 ? "" : "es"}
        {m.counts.failedSearches > 0 && <span className="text-[#c5221f]"> ({m.counts.failedSearches} found nothing)</span>} · {m.counts.documents} document{m.counts.documents === 1 ? "" : "s"} opened
        {m.lastAt && <> · last active {timeAgo(m.lastAt)}</>}
      </div>
      {m.struggling.map((s) => (
        <div key={s.teamId} className="mt-2 rounded-lg bg-[#fef7e0] px-3 py-1.5 text-xs text-[#7a4a00]">
          <span className="font-medium">May be struggling with {teamName(s.teamId)}:</span> {s.reasons.slice(0, 3).join(" · ")}
        </div>
      ))}
    </li>
  );
}

function MenteeDetail({ personId }: { personId: string }) {
  const { person, teamName, setMentor } = useApp();
  const p = person(personId);
  const [view, setView] = useState<MenteeView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/mentoring/${personId}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Could not load what they've been doing.");
        if (!cancelled) setView(json);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [personId]);

  if (!p) return null;
  const first = p.name.split(" ")[0];
  const area = (teamId: string | null | undefined) => (teamId ? teamName(teamId) : "No department recognised");

  const stop = async () => {
    if (!confirm(`Stop mentoring ${p.name}? What ${first} did so far is no longer shown to anyone.`)) return;
    try {
      await setMentor(p.id, null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <section className="rounded-2xl bg-white p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar person={p} size={44} />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl text-slate-900">{p.name}</h2>
            <div className="text-xs text-slate-500">{p.role} · {teamName(p.teamId)}</div>
            <ContactLinks person={p} subject="Checking in" className="mt-1" />
          </div>
          <button onClick={stop} className="rounded-full px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">Stop mentoring</button>
        </div>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        {!view && !error && <p className="mt-3 text-sm text-slate-500">Reading what {first} has been doing…</p>}
        {view && (
          <p className="mt-3 text-[11px] text-slate-500">
            Since you became {first}&apos;s mentor ({timeAgo(view.since)}). {first} wasn&apos;t notified of anything; {first} can see on this page that you&apos;re their mentor and what you can see.
          </p>
        )}
      </section>

      {view && (
        <>
          <section className="rounded-2xl bg-white p-6">
            <h3 className="text-lg text-slate-900">Where to step in</h3>
            <p className="mb-3 text-[11px] text-slate-500">
              Everything {first} asked, searched for and opened, by the department it&apos;s about. Highlighted when it keeps coming back: several questions or searches that found nothing, documents opened again and again, or documents {first} can&apos;t rely on.
            </p>
            {view.areas.length === 0 ? (
              <p className="text-sm text-slate-600">Nothing yet: {first} hasn&apos;t asked, searched for or opened anything since you became their mentor.</p>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {view.areas.map((a) => (
                  <AreaCard key={a.teamId ?? "none"} a={a} label={area(a.teamId)} first={first} />
                ))}
              </ul>
            )}
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-2xl bg-white p-6">
              <h3 className="text-lg text-slate-900">What {first} asked</h3>
              <p className="mb-2 text-[11px] text-slate-500">Questions in Who knows…? and questions {first} wrote to colleagues.</p>
              {view.questions.length === 0 ? (
                <p className="text-sm text-slate-600">No questions yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {view.questions.map((q, i) => (
                    <li key={i} className="py-2 text-sm">
                      <div className="text-slate-800">
                        {q.kind === "ask" ? (
                          <Link href={`/people?q=${encodeURIComponent(q.text)}`} className="hover:underline">“{q.text}”</Link>
                        ) : (
                          <Link href={`/conversations?c=${q.conversationId}`} className="hover:underline">“{q.text}”</Link>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {q.kind === "ask" ? "Who knows…?" : `to ${q.to?.join(", ") || "colleagues"}`} · {area(q.teamId)}
                        {q.about.length > 0 && <> · about {q.about.join(", ")}</>} · {timeAgo(q.at)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-2xl bg-white p-6">
              <h3 className="text-lg text-slate-900">What {first} searched for</h3>
              <p className="mb-2 text-[11px] text-slate-500">Drive searches, with how many documents matched.</p>
              {view.searches.length === 0 ? (
                <p className="text-sm text-slate-600">No searches yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {view.searches.map((s, i) => (
                    <li key={i} className="flex items-baseline gap-2 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate text-slate-800">“{s.query}”</span>
                      <span className={`shrink-0 text-[11px] ${s.results === 0 ? "font-medium text-[#c5221f]" : "text-slate-500"}`}>
                        {s.results === 0 ? "found nothing" : `${s.results} found`}
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-500">{timeAgo(s.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="rounded-2xl bg-white p-6">
            <h3 className="text-lg text-slate-900">What {first} looked at</h3>
            <p className="mb-2 text-[11px] text-slate-500">Documents {first} opened, with {first}&apos;s own trust score: what {first} could rely on.</p>
            {view.reads.length === 0 ? (
              <p className="text-sm text-slate-600">No documents opened yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="py-1 font-medium">Document</th>
                    <th className="hidden py-1 font-medium sm:table-cell">Department</th>
                    <th className="py-1 font-medium">Opened</th>
                    <th className="py-1 font-medium">Trust for {first}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {view.reads.map((r) => (
                    <tr key={r.docId}>
                      <td className="py-2 pr-2">
                        <Link href={`/doc/${r.docId}`} className="text-slate-800 hover:underline">{r.title}</Link>
                      </td>
                      <td className="hidden py-2 pr-2 text-xs text-slate-600 sm:table-cell">{teamName(r.teamId)}</td>
                      <td className="py-2 pr-2 text-xs text-slate-600">
                        <span className={r.opens >= 3 ? "font-medium text-[#b06000]" : ""}>{r.opens}×</span> · {timeAgo(r.lastAt)}
                      </td>
                      <td className="py-2">{r.score !== undefined && <ScorePill score={r.score} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </>
  );
}

function AreaCard({ a, label, first }: { a: StruggleArea; label: string; first: string }) {
  return (
    <li className={`rounded-xl p-4 text-sm ${a.struggling ? "bg-[#fef7e0]" : "ring-1 ring-slate-200"}`}>
      <div className="flex items-baseline gap-2">
        <span className="font-medium text-slate-900">{label}</span>
        {a.struggling && <span className="rounded-full bg-[#b06000] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">may be struggling</span>}
        <span className="ml-auto text-[11px] text-slate-500">{timeAgo(a.lastAt)}</span>
      </div>
      <div className="mt-1 text-xs text-slate-600">
        {a.questions} question{a.questions === 1 ? "" : "s"} · {a.searches} search{a.searches === 1 ? "" : "es"}
        {a.failedSearches > 0 && <> ({a.failedSearches} found nothing)</>} · {a.opens} document open{a.opens === 1 ? "" : "s"}
      </div>
      {a.reasons.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-slate-700">
          {a.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {a.struggling && (
        <div className="mt-3 space-y-1 text-xs">
          {a.startingPoints.length > 0 && (
            <div>
              <span className="text-slate-600">Trusted documents {first} hasn&apos;t opened: </span>
              {a.startingPoints.map((d, i) => (
                <span key={d.docId}>
                  {i > 0 && ", "}
                  <Link href={`/doc/${d.docId}`} className="text-blue-700 hover:underline">{d.title}</Link>
                </span>
              ))}
            </div>
          )}
          {a.topTopic && (
            <Link href={`/people?q=${encodeURIComponent(a.topTopic.label)}`} className="inline-block text-blue-700 hover:underline">
              Who knows about {a.topTopic.label}? – someone to bring in
            </Link>
          )}
        </div>
      )}
    </li>
  );
}

function ScorePill({ score }: { score: number }) {
  const band = trustBand(score);
  return (
    <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color: band.color, background: band.bg }} title={band.label}>
      {score}
    </span>
  );
}
