import { cookies } from "next/headers";
import { config } from "./config";
import { findPerson } from "./db";
import { HttpError } from "./http";
import { createSession, DEMO_USER, readSession, SESSION_COOKIE, SESSION_DAYS, type Session } from "./session";
import type { Person } from "./types";

/**
 * Who is asking: the person who signed in with their own sign-in code (see session.ts). The proxy turns
 * away requests without a session, and every route checks it again here.
 *
 * Demo mode (DEMO_MODE=1, off by default) adds the shared access code, which signs in as a demo session
 * that can view the drive as anyone ("Viewing as"), so a demo can show how trust differs per person.
 * Turning demo mode off ends those sessions.
 */

export const DEFAULT_VIEWER = "jonas";

async function currentSession(): Promise<Session | null> {
  const session = config.secret ? readSession(config.secret, (await cookies()).get(SESSION_COOKIE)?.value) : null;
  return session && (session.userId !== DEMO_USER || config.demoMode) ? session : null;
}

/** Which sign-in the request belongs to; the same while switching who you view as. For limits per session. */
export async function sessionId(): Promise<string> {
  const session = await currentSession();
  if (!session) throw new HttpError(401, "Sign in to TrustDrive first.");
  return session.sessionId;
}

/** Whether this session may view the drive as someone else: only a demo session, in demo mode. */
export async function canSwitchViewer() {
  return (await currentSession())?.userId === DEMO_USER;
}

/** The person making the request: who signed in, or in a demo session who it views as. 401 without a valid session. */
export async function requireViewer(_req: Request): Promise<Person> {
  const session = await currentSession();
  const id = session && (session.userId === DEMO_USER ? session.viewerId : session.userId);
  const person = id ? await findPerson({ id }) : null;
  if (!person?.active) throw new HttpError(401, "Sign in to TrustDrive first.");
  return person;
}

/** Signs the browser in: as a person, or (`userId` DEMO_USER) as a demo session viewing as `viewerId`. */
export async function startSession(viewerId: string, opts: { userId?: string; sessionId?: string } = {}) {
  if (!config.secret) throw new HttpError(503, "TrustDrive has no secret configured.");
  (await cookies()).set(SESSION_COOKIE, createSession(config.secret, viewerId, Date.now(), opts.sessionId, opts.userId ?? viewerId), { httpOnly: true, sameSite: "lax", secure: config.production, path: "/", maxAge: 60 * 60 * 24 * SESSION_DAYS });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
