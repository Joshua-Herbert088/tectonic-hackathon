import { HttpError } from "./http";

/**
 * Fixed-window request counters, per server instance. Enough to stop one client from flooding the
 * database or the paid Jev API; a shared store would be needed to count across instances.
 */
const windows = new Map<string, { start: number; count: number }>();

/** Throws a 429 when `key` was used more than `max` times in the current window of `windowMs`. */
export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()) {
  if (windows.size > 10_000) for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    return;
  }
  if (++w.count > max) throw new HttpError(429, "Too many changes in a short time. Wait a minute and try again.");
}

/**
 * Saving documents, which grows their history, and checking drafts, which calls Jev: per person, and for
 * everyone together (switching who you view as gives another person's allowance).
 */
export function limitWrites(personId: string, now = Date.now()) {
  rateLimit(`write:${personId}`, 30, 60_000, now);
  rateLimit("write:*", 300, 60_000, now);
}
