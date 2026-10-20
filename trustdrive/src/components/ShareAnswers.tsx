"use client";

import { useState } from "react";
import { AnswerCard } from "./Expertise";
import type { AnswerView } from "@/lib/types";

/**
 * Answers the viewer gave in private chats that could help others: nothing is shared until they say so.
 * "Always share" decides these and every future answer, so they're not asked again.
 */
export function ShareAnswers({ answers, onDone }: { answers: AnswerView[]; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (body: { ids?: number[]; share: boolean; always?: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/answers/share", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not save that.");
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="share" className="rounded-2xl bg-[#f3f0fd] p-5">
      <h2 className="text-sm font-medium text-slate-900">
        {answers.length === 1 ? "An answer you gave could help others" : `${answers.length} answers you gave could help others`}
      </h2>
      <p className="mt-0.5 text-xs text-slate-600">
        Colleagues asked you this in a chat. Shared, it&apos;s found by the next person with the same question, quoted as you wrote it, without who asked, and the chat stays private.
        Nothing is shared until you say so.
      </p>
      {error && <div className="mt-2 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">{error}</div>}
      <ul className="mt-3 space-y-2">
        {answers.map((a) => (
          <li key={a.id}>
            <AnswerCard a={a} className="bg-white" />
            <div className="mt-1.5 flex justify-end gap-2">
              <button disabled={busy} onClick={() => decide({ ids: [a.id], share: false })} className="rounded-full px-3 py-1 text-xs text-slate-600 hover:bg-white disabled:opacity-60">
                Keep private
              </button>
              <button disabled={busy} onClick={() => decide({ ids: [a.id], share: true })} className="rounded-full bg-[#5b5fc7] px-3 py-1 text-xs font-medium text-white hover:bg-[#4b4fb5] disabled:opacity-60">
                Share
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 border-t border-[#dcd6f7] pt-3 text-xs text-slate-600">
        <button disabled={busy} onClick={() => decide({ share: true, always: true })} className="font-medium text-[#5b5fc7] hover:underline disabled:opacity-60">
          Always share my answers
        </button>{" "}
        – you won&apos;t be asked again; you can change it on your profile.
      </div>
    </section>
  );
}
