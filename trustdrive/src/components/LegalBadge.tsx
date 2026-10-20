"use client";

import { useApp } from "@/components/AppContext";
import { legalStamp } from "@/lib/legal";
import { timeAgo } from "@/lib/time";
import type { Doc } from "@/lib/types";

const NOW = { legal: " (Legal & Compliance)", moved: " (has since moved team)", left: " (has since left the company)" } as const;
const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function Scales({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 3c.55 0 1 .45 1 1v1h5l3 7c0 1.66-1.57 3-3.5 3S14 13.66 14 12l2.6-5H13v12h4v2H7v-2h4V7H7.4L10 12c0 1.66-1.57 3-3.5 3S3 13.66 3 12l3-7h5V4c0-.55.45-1 1-1Zm6.5 4.2L16.6 11h3.8l-1.9-3.8ZM5.5 7.2 3.6 11h3.8L5.5 7.2Z" />
    </svg>
  );
}

/**
 * Legal & Compliance badge with who validated the document and when. `compact` for lists; the full
 * form on the document page spells out the date and whether the validation is due again.
 */
export function LegalBadge({ doc, compact = false }: { doc: Pick<Doc, "teamId" | "verifications">; compact?: boolean }) {
  const { person, people } = useApp();
  const stamp = legalStamp(doc, people);
  if (!stamp) return null;
  const v = stamp.validation;
  const who = v ? person(v.personId) : undefined;
  const tone = !v || v.due ? "bg-[#fef7e0] text-[#7a4a00] ring-[#f6d58b]" : "bg-[#e8eaf6] text-[#283593] ring-[#c5cae9]";
  const label = stamp.fromLegal ? "Legal & Compliance" : "Validated by Legal";
  const title = v
    ? `${stamp.fromLegal ? "From Legal & Compliance. " : ""}Validated by ${who?.name ?? v.personId}${NOW[v.now]} on ${date(v.at)}${v.due ? " – over a year ago, due for another check" : ""}.`
    : "From Legal & Compliance, but nobody in Legal has validated this version yet.";

  if (compact) {
    return (
      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${tone}`} title={title}>
        <Scales size={11} />
        {v ? `Legal · ${who?.name.split(" ")[0] ?? "validated"}, ${date(v.at)}` : "Legal · not validated"}
      </span>
    );
  }
  return (
    <div className={`mt-2 inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-3 py-1.5 text-xs ring-1 ${tone}`} title={title}>
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <Scales size={15} />
        {label}
      </span>
      {v ? (
        <span>
          Validated by <span className="font-medium">{who?.name ?? v.personId}</span>
          {v.now !== "legal" && NOW[v.now]} on <span className="whitespace-nowrap font-medium">{date(v.at)}</span> <span className="whitespace-nowrap">({timeAgo(v.at)})</span>
          {v.due && <span className="font-medium"> – due for another check</span>}
        </span>
      ) : (
        <span>Not validated by Legal yet</span>
      )}
    </div>
  );
}
