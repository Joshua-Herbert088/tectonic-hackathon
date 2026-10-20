import type { Doc } from "@/lib/types";

export function StatusPill({ status }: { status: Doc["status"] }) {
  const style = status === "Completed" ? "bg-[#e6f4ea] text-[#137333]" : status === "WIP" ? "bg-slate-100 text-slate-700" : "bg-[#fef7e0] text-[#b06000]";
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>{status}</span>;
}

/** Marks a confidential document: never sent to Jev, handle with care. */
export function ConfidentialPill() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#fce8e6] px-2 py-0.5 text-[11px] font-medium text-[#c5221f]" title="Confidential – never sent to Jev; scored and checked by the built-in rules">
      <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2Zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm3.1-9H8.9V6a3.1 3.1 0 0 1 6.2 0v2Z" /></svg>
      Confidential
    </span>
  );
}
