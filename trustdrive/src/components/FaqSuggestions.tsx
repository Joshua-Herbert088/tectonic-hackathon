"use client";

import Link from "next/link";
import { useState } from "react";
import type { FaqSuggestion } from "@/lib/answers";

/**
 * "You keep answering this": topics the viewer answered colleagues about several times, offered as an FAQ
 * draft built from their own answers. "Not now" stops the suggestion until new questions come in.
 */
export function FaqSuggestions({ faqs, onDismissed }: { faqs: FaqSuggestion[]; onDismissed: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dismiss = async (topic: string) => {
    setBusy(topic);
    setError(null);
    try {
      const res = await fetch("/api/answers/faq", { method: "DELETE", body: JSON.stringify({ topic }) });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not dismiss it.");
      onDismissed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-2xl bg-[#e8f0fe] p-5">
      <h2 className="text-sm font-medium text-slate-900">You keep answering the same questions</h2>
      <p className="mt-0.5 text-xs text-slate-600">Write your answers up once, so colleagues find them without asking. The draft is made from what you already wrote; you check it before it&apos;s saved.</p>
      {error && <div className="mt-2 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">{error}</div>}
      <ul className="mt-3 space-y-2">
        {faqs.map((f) => (
          <li key={f.topic} className="flex flex-wrap items-center gap-2 rounded-xl bg-white px-3 py-2">
            <span className="min-w-0 flex-1 text-sm text-slate-800">
              <span className="font-medium">{f.label}</span>
              <span className="text-xs text-slate-500">
                {" "}
                · {f.answerIds.length} answers to {f.askers} colleague{f.askers === 1 ? "" : "s"}
              </span>
            </span>
            <button onClick={() => dismiss(f.topic)} disabled={busy === f.topic} className="rounded-full px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-60">Not now</button>
            <Link href={`/answers/faq?topic=${encodeURIComponent(f.topic)}`} className="rounded-full bg-[#0b57d0] px-3 py-1 text-xs font-medium text-white hover:bg-[#0842a0]">Draft an FAQ</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
