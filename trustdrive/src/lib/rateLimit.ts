import { HttpError } from "./http";

/**
 * Fixed-window request counters, per server instance. Enough to stop one client from flooding the
 * database or the paid Jev API; a shared store would be needed to count across instances.
 */
const windows = new Map<string, { start: number; count: number }>();

/**
 * Throws a 429 when `key` was used more than `max` times in the current window of `windowMs`. With a
 * `cost`, it counts that much instead of 1 (e.g. characters written).
 */
export function rateLimit(key: string, max: number, windowMs: number, now = Date.now(), cost = 1) {
  if (windows.size > 10_000) for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    if (cost > max) throw new HttpError(429, "Too many changes in a short time. Wait a minute and try again.");
    windows.set(key, { start: now, count: cost });
    return;
  }
  if (w.count + cost > max) throw new HttpError(429, "Too many changes in a short time. Wait a minute and try again.");
  w.count += cost;
}

const HOUR = 3_600_000;

/**
 * Saving documents, which grows their history, and checking drafts, which calls Jev. Counted per person,
 * per session (switching who you view as doesn't give another allowance) and for everyone together, and
 * by the characters written per hour, so a stream of moderate saves can't fill the database.
 */
export function limitWrites(personId: string, sessionId: string, chars = 0, now = Date.now()) {
  rateLimit(`write:${personId}`, 30, 60_000, now);
  rateLimit(`write-session:${sessionId}`, 30, 60_000, now);
  rateLimit("write:*", 300, 60_000, now);
  if (!chars) return;
  rateLimit(`chars-session:${sessionId}`, 5_000_000, HOUR, now, chars);
  rateLimit("chars:*", 20_000_000, HOUR, now, chars);
}

/** Saves running at once: per person, and in all. More are turned away instead of queueing up. */
export const MAX_SAVES_PER_PERSON = 2;
export const MAX_SAVES = 8;
const running = new Map<string, number>();
let runningTotal = 0;

/** Runs a save, or answers 429 when that person or the server already has too many running. */
export async function withSaveSlot<T>(personId: string, save: () => Promise<T>): Promise<T> {
  const mine = running.get(personId) ?? 0;
  if (mine >= MAX_SAVES_PER_PERSON || runningTotal >= MAX_SAVES) throw new HttpError(429, "Another save is still running. Try again in a moment.");
  running.set(personId, mine + 1);
  runningTotal++;
  try {
    return await save();
  } finally {
    const left = (running.get(personId) ?? 1) - 1;
    if (left) running.set(personId, left);
    else running.delete(personId);
    runningTotal--;
  }
}
