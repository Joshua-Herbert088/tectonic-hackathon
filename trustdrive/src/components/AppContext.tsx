"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Person, Team } from "@/lib/types";

interface Ctx {
  viewerId: string;
  setViewerId: (id: string) => void;
  people: Person[];
  teams: Team[];
  search: string;
  setSearch: (s: string) => void;
  person: (id: string | null | undefined) => Person | undefined;
  teamName: (id: string) => string;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [viewerId, setViewerIdState] = useState("jonas");
  const [people, setPeople] = useState<Person[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("viewerId");
      if (saved) setViewerIdState(saved);
    } catch {}
    fetch("/api/meta")
      .then((r) => r.json())
      .then((m) => {
        setPeople(m.people);
        setTeams(m.teams);
      });
  }, []);

  const setViewerId = (id: string) => {
    setViewerIdState(id);
    try {
      localStorage.setItem("viewerId", id);
    } catch {}
  };

  return (
    <AppCtx.Provider
      value={{
        viewerId,
        setViewerId,
        people,
        teams,
        search,
        setSearch,
        person: (id) => people.find((p) => p.id === id),
        teamName: (id) => teams.find((t) => t.id === id)?.name ?? id,
      }}
    >
      {children}
    </AppCtx.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp outside AppProvider");
  return ctx;
}
