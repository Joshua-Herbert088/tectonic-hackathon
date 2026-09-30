const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function daysSince(iso: string, now = Date.now()) {
  return Math.floor((now - new Date(iso).getTime()) / DAY);
}

export function timeAgo(iso: string, now = Date.now()) {
  const diff = now - new Date(iso).getTime();
  if (diff < MIN) return "just now";
  if (diff < HOUR) return plural(Math.floor(diff / MIN), "minute");
  if (diff < DAY) return plural(Math.floor(diff / HOUR), "hour");
  const days = Math.floor(diff / DAY);
  if (days < 31) return plural(days, "day");
  if (days < 365) return plural(Math.floor(days / 30.4), "month");
  return plural(Math.floor(days / 365), "year");
}

function plural(n: number, unit: string) {
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

export function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
