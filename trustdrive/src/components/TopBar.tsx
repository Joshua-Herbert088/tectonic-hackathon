"use client";

import Link from "next/link";
import { useState } from "react";
import { useApp } from "./AppContext";
import { NotificationBell } from "./Notifications";
import type { Person } from "@/lib/types";

export function Avatar({ person, size = 28 }: { person?: Person; size?: number }) {
  if (!person) return <div className="grid place-items-center rounded-full bg-slate-200 text-xs text-slate-500" style={{ width: size, height: size }}>?</div>;
  const initials = person.name.split(" ").map((w) => w[0]).slice(0, 2).join("");
  return (
    <div
      className={`grid shrink-0 place-items-center rounded-full font-medium text-white ${person.active ? "" : "opacity-40 grayscale"}`}
      style={{ width: size, height: size, background: person.color, fontSize: size * 0.4 }}
      title={`${person.name}${person.active ? "" : " (left company)"}`}
    >
      {initials}
    </div>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 pr-6">
      <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden>
        <path d="M18 3 31 8v9c0 8-5.5 13.5-13 16C10.5 30.5 5 25 5 17V8l13-5Z" fill="#1a73e8" />
        <path d="m12 18 4.2 4.2L24.5 14" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-[22px] text-slate-700">TrustDrive</span>
    </Link>
  );
}

export function TopBar({ showSearch = true }: { showSearch?: boolean }) {
  const { people, viewerId, setViewerId, search, setSearch, person, teamName } = useApp();
  const [open, setOpen] = useState(false);
  const viewer = person(viewerId);

  return (
    <header className="flex h-16 items-center gap-4 px-4">
      <Logo />
      {showSearch ? (
        <div className="flex h-12 max-w-3xl flex-1 items-center gap-3 rounded-full bg-[#e9eef6] px-5 focus-within:bg-white focus-within:shadow-md">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#444746"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14Z" /></svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search in TrustDrive"
            className="flex-1 bg-transparent text-base outline-none placeholder:text-slate-600"
          />
        </div>
      ) : (
        <div className="flex-1" />
      )}
      <div className="ml-auto">
        <NotificationBell />
      </div>
      <div className="relative">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-3 rounded-full py-1 pl-3 pr-1 hover:bg-slate-200/60">
          <div className="text-right leading-tight">
            <div className="text-xs text-slate-500">Viewing as</div>
            <div className="text-sm font-medium text-slate-800">{viewer?.name ?? "…"}</div>
          </div>
          <Avatar person={viewer} size={36} />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute right-0 z-20 mt-2 max-h-[70vh] w-80 overflow-auto rounded-2xl bg-white py-2 shadow-xl ring-1 ring-black/5">
              <div className="px-4 py-2 text-xs text-slate-500">Switch user – trust scores depend on who is asking (location, team, access)</div>
              {people.filter((p) => p.active).map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setViewerId(p.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-100 ${p.id === viewerId ? "bg-blue-50" : ""}`}
                >
                  <Avatar person={p} />
                  <div className="min-w-0">
                    <div className="truncate text-sm text-slate-800">{p.name}</div>
                    <div className="truncate text-xs text-slate-500">{p.role} · {teamName(p.teamId)} · {p.location}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </header>
  );
}
