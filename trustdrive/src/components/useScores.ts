"use client";

import { useEffect, useState } from "react";
import type { TrustScore } from "@/lib/types";

type Scored = { id: string; trust: TrustScore | null };

/** Fills in Jev scores for docs that don't have a fresh cached one, a few at a time. */
export function useScores(docs: Scored[] | null, viewerId: string) {
  const [scores, setScores] = useState<Record<string, TrustScore>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!docs) return;
    let cancelled = false;
    const queue = docs.filter((d) => !d.trust).map((d) => d.id);
    const worker = async () => {
      while (queue.length && !cancelled) {
        const id = queue.shift()!;
        try {
          const res = await fetch(`/api/docs/${id}/score?viewer=${viewerId}`, { method: "POST" });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error);
          if (!cancelled) setScores((s) => ({ ...s, [`${viewerId}:${id}`]: json.trust }));
        } catch {
          if (!cancelled) setErrors((e) => ({ ...e, [`${viewerId}:${id}`]: true }));
        }
      }
    };
    Array.from({ length: 4 }, worker);
    return () => {
      cancelled = true;
    };
  }, [docs, viewerId]);

  return {
    trustOf: (d: Scored) => d.trust ?? scores[`${viewerId}:${d.id}`] ?? null,
    failed: (id: string) => !!errors[`${viewerId}:${id}`],
  };
}
