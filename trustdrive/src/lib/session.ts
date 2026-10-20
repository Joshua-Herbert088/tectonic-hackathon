import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * The signed session cookie: who is viewing, which sign-in it belongs to (kept when switching who you view
 * as, so limits per session can't be reset that way), until when, and an HMAC so it can't be forged or edited.
 * The key comes from the access code, so changing the code signs everyone out. No database access, so
 * the proxy can check it too.
 */

export const SESSION_COOKIE = "td_session";
export const SESSION_DAYS = 30;

const key = (code: string) => createHash("sha256").update(`trustdrive-session\0${code}`).digest();
const sign = (code: string, payload: string) => createHmac("sha256", key(code)).update(payload).digest("base64url");

/** Constant-time comparison of two strings of any length. */
function same(a: string, b: string) {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** Whether `attempt` is the access code, without leaking how much of it matched. */
export const codeMatches = (code: string, attempt: string) => same(code, attempt);

export function createSession(code: string, viewerId: string, now = Date.now(), sessionId: string = randomUUID()): string {
  const payload = Buffer.from(JSON.stringify({ v: viewerId, s: sessionId, exp: now + SESSION_DAYS * 86_400_000 })).toString("base64url");
  return `${payload}.${sign(code, payload)}`;
}

/** The viewer in a session cookie; null when there's none, it's tampered with, signed with another code or expired. */
export function readSession(code: string, token: string | undefined, now = Date.now()): { viewerId: string; sessionId: string } | null {
  const [payload, sig, ...rest] = token?.split(".") ?? [];
  if (!payload || !sig || rest.length || !same(sig, sign(code, payload))) return null;
  try {
    const { v, s, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof v !== "string" || typeof exp !== "number" || exp <= now) return null;
    // Sessions from before session ids: one per person.
    return { viewerId: v, sessionId: typeof s === "string" ? s : `person:${v}` };
  } catch {
    return null;
  }
}
