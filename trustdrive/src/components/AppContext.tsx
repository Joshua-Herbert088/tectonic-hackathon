"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { teamCountries } from "@/lib/appliesTo";
import { myClients } from "@/lib/clients";
import { DEFAULT_TERMS, taxonomyOf, type Taxonomy, type Term } from "@/lib/taxonomy";
import type { Client, Person, Team } from "@/lib/types";

interface Ctx {
  /** Who the server says is signed in (or, in demo mode, who they're viewing as). */
  viewerId: string;
  /** Demo mode only: view the drive as someone else. */
  canSwitch: boolean;
  /** Whether this server allows "Reset demo data". */
  canReset: boolean;
  setViewerId: (id: string) => Promise<void>;
  people: Person[];
  teams: Team[];
  clients: Client[];
  search: string;
  setSearch: (s: string) => void;
  person: (id: string | null | undefined) => Person | undefined;
  teamName: (id: string) => string;
  clientName: (id: string | null | undefined) => string | undefined;
  /** Topics, document types and countries as currently stored. */
  taxonomy: Taxonomy;
  /** Call after changing the taxonomy, with the terms the server returned. */
  setTerms: (terms: Term[]) => void;
  /** Each team's country (or Global), for choosing who a document applies to. */
  teamCountry: Map<string, string>;
  /** Call after adding or changing a client, with the clients the server returned. */
  setClients: (clients: Client[]) => void;
  /** The clients the viewer chose to see (by default their team's), for the sidebar and lists. */
  myClients: Client[];
  /** Whether the viewer picked their clients themselves (false: their team's clients). */
  choseClients: boolean;
  /** Saves which clients the viewer sees; null goes back to their team's clients. */
  setMyClients: (clientIds: string[] | null) => Promise<void>;
  /** Makes `mentorId` someone's mentor, or removes their mentor (null). Throws with a message the UI can show. */
  setMentor: (personId: string, mentorId: string | null) => Promise<void>;
}

const AppCtx = createContext<Ctx | null>(null);

/** Loads the session and reference data once; pages render after the server has said who's asking. */
export function AppProvider({ children }: { children: React.ReactNode }) {
  // The sign-in page comes before there's a session.
  if (usePathname() === "/login") return children;
  return <SignedIn>{children}</SignedIn>;
}

function SignedIn({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<{ viewerId: string; canSwitch: boolean; canReset: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [terms, setTerms] = useState<Term[]>(DEFAULT_TERMS);
  const taxonomy = useMemo(() => taxonomyOf(terms), [terms]);
  const teamCountry = useMemo(() => teamCountries(teams, people), [teams, people]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const json = async (url: string) => {
      const r = await fetch(url);
      // Signed out (or the session expired) since the page was loaded.
      if (r.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return new Promise<never>(() => {});
      }
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
      return j;
    };
    Promise.all([json("/api/session"), json("/api/meta")])
      .then(([s, m]) => {
        setSession({ viewerId: s.viewer.id, canSwitch: s.canSwitch, canReset: !!m.canReset });
        setPeople(m.people);
        setTeams(m.teams);
        setClients(m.clients ?? []);
        if (m.terms) setTerms(m.terms);
      })
      .catch((e: Error) => setError(e.message));
  }, [router]);

  const setMyClients = useCallback(
    async (clientIds: string[] | null) => {
      if (!session) return;
      const r = await fetch("/api/me/clients", { method: "PUT", body: JSON.stringify({ clientIds }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not save your clients.");
      setPeople((ps) => ps.map((p) => (p.id === session.viewerId ? { ...p, clientIds: j.clientIds ?? undefined } : p)));
    },
    [session],
  );

  const setMentor = useCallback(async (personId: string, mentorId: string | null) => {
    const r = await fetch(`/api/people/${personId}/mentor`, { method: "PUT", body: JSON.stringify({ mentorId }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Could not change the mentor.");
    setPeople((ps) => ps.map((p) => (p.id === personId ? { ...p, mentorId: j.mentorId ?? undefined, mentorSince: j.mentorSince ?? undefined } : p)));
  }, []);

  const setViewerId = useCallback(async (id: string) => {
    const r = await fetch("/api/session", { method: "POST", body: JSON.stringify({ viewerId: id }) });
    if (r.ok) setSession((s) => s && { ...s, viewerId: id });
  }, []);

  const value = useMemo<Ctx | null>(() => {
    if (!session) return null;
    const viewer = people.find((p) => p.id === session.viewerId);
    return {
      viewerId: session.viewerId,
      canSwitch: session.canSwitch,
      canReset: session.canReset,
      setViewerId,
      people,
      teams,
      clients,
      search,
      setSearch,
      person: (id) => people.find((p) => p.id === id),
      teamName: (id) => teams.find((t) => t.id === id)?.name ?? id,
      clientName: (id) => clients.find((c) => c.id === id)?.name,
      taxonomy,
      setTerms,
      teamCountry,
      setClients,
      myClients: myClients(viewer, clients),
      choseClients: !!viewer?.clientIds,
      setMyClients,
      setMentor,
    };
  }, [session, setViewerId, setMyClients, setMentor, people, teams, clients, search, taxonomy, teamCountry]);

  if (!value) {
    return (
      <div className="grid h-screen place-items-center p-8 text-center text-sm text-slate-600">
        {error ? (
          <div className="max-w-md">
            <div className="mb-1 text-lg text-slate-900">TrustDrive isn&apos;t available</div>
            {error}
          </div>
        ) : (
          "Loading TrustDrive…"
        )}
      </div>
    );
  }
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp outside AppProvider");
  return ctx;
}
