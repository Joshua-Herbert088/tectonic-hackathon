"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useApp } from "./AppContext";
import { AnswerCard } from "./Expertise";
import { Avatar } from "./TopBar";
import { TrustBadge } from "./TrustBadge";
import { useScores } from "./useScores";
import type { WhoKnows } from "@/lib/expertise";
import type { Doc, TrustScore } from "@/lib/types";

export type KnownDoc = Omit<Doc, "content"> & { excerpt: string; trust: TrustScore | null; issue: string | null; strength: string | null };
/** What "Who knows" returns for a question, with the documents it's about. */
export type Known = WhoKnows & { documents: KnownDoc[] };

/**
 * What's already known about a question: answers given before, the documents it's about (with the
 * viewer's trust) and the colleagues who know. Shown while someone types a question, and next to one.
 */
export function AlreadyKnown({ known, peopleTitle = "Who knows" }: { known: Known; peopleTitle?: string }) {
  const { person, teamName, viewerId } = useApp();
  const docs = useMemo(() => known.documents, [known]);
  const { trustOf, failed } = useScores(docs, viewerId);
  return (
    <div className="space-y-4">
      {known.answers.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Asked before</h3>
          <div className="space-y-2">
            {known.answers.slice(0, 3).map((a) => (
              <AnswerCard key={a.id} a={a} className="bg-white text-xs" />
            ))}
          </div>
        </div>
      )}
      {docs.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">In the drive</h3>
          <ul className="space-y-1.5">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-2.5 rounded-lg bg-white px-2 py-1.5">
                <TrustBadge trust={trustOf(d)} loading={!trustOf(d) && !failed(d.id)} error={failed(d.id)} size={30} />
                <div className="min-w-0 flex-1">
                  <Link href={`/doc/${d.id}`} className="block truncate text-sm text-slate-800 hover:underline">{d.title}</Link>
                  {(d.issue ?? d.strength) && <div className={`truncate text-[11px] ${d.issue ? "text-[#b06000]" : "text-slate-500"}`}>{d.issue ?? d.strength}</div>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {known.experts.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">{peopleTitle}</h3>
          <ul className="space-y-1.5">
            {known.experts.slice(0, 3).map((e) => {
              const p = person(e.personId);
              const top = e.evidence[0];
              return (
                <li key={e.personId} className="flex items-start gap-2.5">
                  <Avatar person={p} size={26} />
                  <div className="min-w-0 text-xs">
                    <Link href={`/person/${e.personId}`} className="font-medium text-slate-800 hover:underline">{p?.name ?? e.personId}</Link>
                    <span className="text-slate-500"> · {p ? teamName(p.teamId) : ""}</span>
                    {top && <div className="truncate text-slate-600">{top.action} {top.doc?.title ?? top.answer?.question ?? top.conversation?.title}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Whether there's anything to show. */
export const knowsSomething = (k: Known | null) => !!k && (k.answers.length > 0 || k.documents.length > 0 || k.experts.length > 0);
