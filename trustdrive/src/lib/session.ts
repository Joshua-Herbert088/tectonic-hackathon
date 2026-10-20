import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Sign-in and the signed session cookie. Everything is signed with the server secret
 * (TRUSTDRIVE_SECRET), so neither a session nor a sign-in code can be forged or edited, and changing the
 * secret signs everyone out. No database access, so the proxy can check sessions too.
 *
 * A session says who signed in (`userId`: a person, or DEMO_USER for the shared demo code), who they view
 * the drive as (the same person, unless it's a demo session), which sign-in it is (kept when switching, so
 * limits per session can't be reset that way) and until when.
 */

export const SESSION_COOKIE = "td_session";
export const SESSION_DAYS = 30;
/** Who a session signed in with the shared demo access code belongs to. */
export const DEMO_USER = "demo";

const keyFor = (secret: string, use: string) => createHash("sha256").update(`trustdrive-${use}\0${secret}`).digest();
const sign = (secret: string, use: string, payload: string) => createHmac("sha256", keyFor(secret, use)).update(payload).digest("base64url");

/** Constant-time comparison of two strings of any length. */
function same(a: string, b: string) {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** Whether `attempt` is the access code, without leaking how much of it matched. */
export const codeMatches = (code: string, attempt: string) => same(code, attempt);

/**
 * A person's own sign-in code: their id and a signature only the server can make. Given out by an admin
 * (`npm run signin-code -- <person id>`; scripts/signin-code.mjs computes the same).
 */
export const personalCode = (secret: string, personId: string) => `${personId}.${sign(secret, "sign-in", personId).slice(0, 24)}`;

/** Whose sign-in code this is; null when it isn't one. */
export function personFromCode(secret: string, code: string): string | null {
  const personId = code.slice(0, code.lastIndexOf("."));
  return personId && same(code, personalCode(secret, personId)) ? personId : null;
}

export interface Session {
  userId: string;
  viewerId: string;
  sessionId: string;
}

export function createSession(secret: string, viewerId: string, now = Date.now(), sessionId: string = randomUUID(), userId: string = viewerId): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, v: viewerId, s: sessionId, exp: now + SESSION_DAYS * 86_400_000 })).toString("base64url");
  return `${payload}.${sign(secret, "session", payload)}`;
}

/** The session in a cookie; null when there's none, it's tampered with, signed with another secret or expired. */
export function readSession(secret: string, token: string | undefined, now = Date.now()): Session | null {
  const [payload, sig, ...rest] = token?.split(".") ?? [];
  if (!payload || !sig || rest.length || !same(sig, sign(secret, "session", payload))) return null;
  try {
    const { u, v, s, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof u !== "string" || typeof v !== "string" || typeof s !== "string" || typeof exp !== "number" || exp <= now) return null;
    return { userId: u, viewerId: v, sessionId: s };
  } catch {
    return null;
  }
}
