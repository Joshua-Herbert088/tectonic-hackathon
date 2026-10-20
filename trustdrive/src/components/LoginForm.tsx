"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "./TopBar";

/** Signing in with a personal sign-in code (or, in demo mode, the shared access code). `next` is a path on this site to go to afterwards. */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    fetch("/api/login")
      .then((r) => r.json())
      .then((j) => {
        if (!j.configured) setError("Sign-in isn't set up: set TRUSTDRIVE_SECRET on the server and restart it.");
        setDemo(!!j.demo);
      })
      .catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/login", { method: "POST", body: JSON.stringify({ code }) });
    if (r.ok) {
      // Leaving this page mounts the app, which loads the new session.
      router.replace(next);
      return;
    }
    setError((await r.json().catch(() => null))?.error ?? "Could not sign in.");
    setBusy(false);
  };

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
        <Logo />
        <h1 className="mt-4 text-lg font-medium text-slate-900">Sign in</h1>
        <p className="mt-0.5 text-sm text-slate-500">{demo ? "Enter your sign-in code, or the demo access code." : "Enter the personal sign-in code you were given."}</p>
        <input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
          autoComplete="current-password"
          aria-label="Sign-in code"
          className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex justify-end">
          <button type="submit" disabled={busy || !code} className="rounded-full bg-[#0b57d0] px-5 py-2 text-sm font-medium text-white hover:bg-[#0842a0] disabled:opacity-50">
            Sign in
          </button>
        </div>
      </form>
    </div>
  );
}
