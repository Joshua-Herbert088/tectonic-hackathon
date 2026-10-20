import { cookies } from "next/headers";
import { config } from "./config";
import { findPerson } from "./db";
import { HttpError } from "./http";
import { createSession, readSession, SESSION_COOKIE, SESSION_DAYS } from "./session";
import type { Person } from "./types";

/**
 * Who is asking. Signing in takes the shared access code (TRUSTDRIVE_ACCESS_CODE); once signed in, the
 * "Viewing as" switcher picks a person, so a demo can show how trust differs per person. Both live in a
 * signed session cookie: the proxy turns away requests without one, and every route checks it again here.
 */

export const DEFAULT_VIEWER = "jonas";

async function currentSession() {
  return config.accessCode ? readSession(config.accessCode, (await cookies()).get(SESSION_COOKIE)?.value) : null;
}

/** Which sign-in the request belongs to; the same while switching who you view as. For limits per session. */
export async function sessionId(): Promise<string> {
  const session = await currentSession();
  if (!session) throw new HttpError(401, "Sign in to TrustDrive first.");
  return session.sessionId;
}

/** The person making the request, from the signed session. 401 when there's no valid session. */
export async function requireViewer(_req: Request): Promise<Person> {
  const session = await currentSession();
  const person = session && (await findPerson({ id: session.viewerId }));
  if (!person?.active) throw new HttpError(401, "Sign in to TrustDrive first.");
  return person;
}

/** Signs the browser in as `viewerId`, or (with the current `sessionId`) switches who it views as. */
export async function startSession(viewerId: string, sessionId?: string) {
  if (!config.accessCode) throw new HttpError(503, "TrustDrive has no access code configured.");
  (await cookies()).set(SESSION_COOKIE, createSession(config.accessCode, viewerId, Date.now(), sessionId), { httpOnly: true, sameSite: "lax", secure: config.production, path: "/", maxAge: 60 * 60 * 24 * SESSION_DAYS });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
