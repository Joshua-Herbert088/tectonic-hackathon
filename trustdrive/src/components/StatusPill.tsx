import type { Doc } from "@/lib/types";

export function StatusPill({ status }: { status: Doc["status"] }) {
  const style = status === "Completed" ? "bg-[#e6f4ea] text-[#137333]" : status === "WIP" ? "bg-slate-100 text-slate-700" : "bg-[#fef7e0] text-[#b06000]";
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>{status}</span>;
}
