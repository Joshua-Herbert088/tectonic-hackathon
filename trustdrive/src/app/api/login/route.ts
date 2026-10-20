import { z } from "zod";
import { DEFAULT_VIEWER, startSession } from "@/lib/auth";
import { config } from "@/lib/config";
import { findPerson } from "@/lib/db";
import { handle, HttpError, readBody } from "@/lib/http";
import { log } from "@/lib/log";
import { rateLimit } from "@/lib/rateLimit";
import { codeMatches, DEMO_USER, personFromCode } from "@/lib/session";

// Guessing codes is slowed down: after this many wrong ones in a minute, sign-in waits for the next
// minute. Counted for everyone together (an address can be faked) and per server instance.
const MAX_FAILURES = 20;
let failures = { minute: 0, count: 0 };

/** Whether sign-in is possible and whether the demo access code works, so the page can say so. */
export const GET = handle(async () => Response.json({ configured: !!config.secret, demo: config.demoMode && !!config.accessCode }));

/** Signs in with a personal sign-in code, or in demo mode with the shared access code. */
export const POST = handle(async (req) => {
  const { code } = await readBody(req, z.object({ code: z.string().max(200) }));
  if (!config.secret) throw new HttpError(503, "TrustDrive has no secret configured. Set TRUSTDRIVE_SECRET and restart.");
  const minute = Math.floor(Date.now() / 60_000);
  if (failures.minute !== minute) failures = { minute, count: 0 };
  if (failures.count >= MAX_FAILURES) throw new HttpError(429, "Too many wrong codes. Try again in a minute.");
  const attempt = code.trim();
  const demo = config.demoMode && !!config.accessCode && codeMatches(config.accessCode, attempt);
  const personId = demo ? null : personFromCode(config.secret, attempt);
  const person = personId ? await findPerson({ id: personId }) : null;
  if (!demo && !person?.active) {
    failures.count++;
    log.warn("sign-in with a wrong code", { failuresThisMinute: failures.count });
    throw new HttpError(401, "That code isn't right.");
  }
  // Each sign-in is a new session with its own allowance; signing in over and over doesn't multiply it.
  rateLimit("sign-in", 60, 60_000);
  if (demo) await startSession(DEFAULT_VIEWER, { userId: DEMO_USER });
  else await startSession(person!.id);
  log.info("signed in", { as: demo ? DEMO_USER : person!.id });
  return Response.json({ ok: true });
});
