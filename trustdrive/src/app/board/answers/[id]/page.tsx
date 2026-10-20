"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AppContext";
import { AnswerCard } from "@/components/Expertise";
import type { AnswerView } from "@/lib/types";

/**
 * A shared answer on its own page: what anyone outside a private chat can read of it, quoted word for
 * word, without who asked. The people on the chat can open it from here.
 */
export default function AnswerPage() {
  const { id } = useParams<{ id: string }>();
  const { viewerId } = useApp();
  const [answer, setAnswer] = useState<{ viewerId: string; a: AnswerView } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/answers/${id}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(r.status === 404 ? "This answer isn't shared, or doesn't exist any more." : (json.error ?? "Could not load the answer."));
        if (!cancelled) setAnswer({ viewerId, a: json });
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id, viewerId]);

  const a = answer?.viewerId === viewerId ? answer.a : null;
  return (
    <AppShell>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4">
          <section className="rounded-2xl bg-white p-6">
            <Link href="/ask" className="text-sm text-blue-700 hover:underline">← Ask</Link>
            <h1 className="mt-3 text-xl text-slate-900">Answered {a?.source === "board" ? "on the board" : "in a chat"}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {a?.source === "board" ? "A question on the board and one of its answers." : "Shared by the colleague who answered, so others with the same question find it. Who asked isn't shown, and the chat stays private."}
            </p>
            <div className="mt-4">{a ? <AnswerCard a={a} /> : <p className="text-sm text-slate-500">{error ?? "Loading…"}</p>}</div>
          </section>
        </div>
      </main>
    </AppShell>
  );
}
