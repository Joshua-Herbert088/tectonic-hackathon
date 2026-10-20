import type { Doc } from "./types";

/**
 * "Quiet" documents: nobody has opened, edited or verified them for a long time. That doesn't make
 * them wrong – nothing here changes the trust score – but the reader is told, so they check before
 * relying on it.
 */

/** Untouched for this long, a document gets the notice. */
export const QUIET_DAYS = 365;
const DAY = 86_400_000;

export interface LastLook {
  at: string;
  personId?: string;
  kind: "opened" | "edited" | "verified";
}

export interface QuietNotice extends LastLook {
  days: number;
}

/**
 * The last time anyone other than this visit looked at the document: the recorded open before this
 * one, the views in its history, its last edit or its last verification – whichever is latest.
 */
export function lastLook(doc: Pick<Doc, "updatedAt" | "lastEditedById" | "verifications" | "views">, before: { at: string; personId: string | null } | null): LastLook | null {
  const looks: LastLook[] = [
    ...(before ? [{ at: before.at, personId: before.personId ?? undefined, kind: "opened" as const }] : []),
    ...doc.views.map((v) => ({ at: v.at, personId: v.personId, kind: "opened" as const })),
    { at: doc.updatedAt, personId: doc.lastEditedById ?? undefined, kind: "edited" as const },
    ...doc.verifications.map((v) => ({ at: v.at, personId: v.personId, kind: "verified" as const })),
  ];
  return looks.reduce<LastLook | null>((a, l) => (!a || l.at > a.at ? l : a), null);
}

/** The notice to show when the document has been quiet for QUIET_DAYS or more, else null. */
export function quietNotice(doc: Parameters<typeof lastLook>[0], before: Parameters<typeof lastLook>[1], now = Date.now()): QuietNotice | null {
  const last = lastLook(doc, before);
  if (!last) return null;
  const days = Math.floor((now - Date.parse(last.at)) / DAY);
  return days >= QUIET_DAYS ? { ...last, days } : null;
}
