import type { TrustScore } from "@/lib/types";

export function trustBand(score: number) {
  if (score >= 75) return { label: "Trusted", color: "#188038", bg: "#e6f4ea" };
  if (score >= 50) return { label: "Use with care", color: "#b06000", bg: "#fef7e0" };
  return { label: "Unreliable", color: "#c5221f", bg: "#fce8e6" };
}

export function TrustBadge({
  trust,
  loading,
  error,
  size = 36,
}: {
  trust: TrustScore | null | undefined;
  loading?: boolean;
  error?: boolean;
  size?: number;
}) {
  const stroke = Math.max(3, size / 10);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  if (!trust) {
    return (
      <div
        className="relative grid place-items-center rounded-full text-[10px] text-slate-400"
        style={{ width: size, height: size }}
        title={error ? "Jev scoring failed" : "Scoring with Jev…"}
      >
        <svg width={size} height={size} className={loading ? "animate-spin" : ""}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} strokeDasharray={loading ? `${c * 0.25} ${c}` : undefined} />
        </svg>
        {error && <span className="absolute">!</span>}
      </div>
    );
  }

  const band = trustBand(trust.score);
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} title={`Trust ${trust.score}/100 – ${band.label}`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e8eaed" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={band.color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(trust.score / 100) * c} ${c}`}
          style={{ transition: "stroke-dasharray 600ms ease" }}
        />
      </svg>
      <span className="absolute font-semibold tabular-nums" style={{ color: band.color, fontSize: size * 0.34 }}>
        {trust.score}
      </span>
    </div>
  );
}
