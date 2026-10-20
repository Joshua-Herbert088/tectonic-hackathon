import { z } from "zod";
import { DEFAULT_VIEWER, startSession } from "@/lib/auth";
import { config } from "@/lib/config";
import { handle, HttpError, readBody } from "@/lib/http";
import { log } from "@/lib/log";
import { codeMatches } from "@/lib/session";

// Guessing the code is slowed down: after this many wrong codes in a minute, sign-in waits for the next
// minute. Counted for everyone together (an address can be faked) and per server instance.
const MAX_FAILURES = 20;
let failures = { minute: 0, count: 0 };

/** Whether sign-in is possible, so the page can say so before anyone types. */
export const GET = handle(async () => Response.json({ configured: !!config.accessCode }));

/** Signs in with the access code, viewing as the default person. */
export const POST = handle(async (req) => {
  const { code } = await readBody(req, z.object({ code: z.string().max(200) }));
  if (!config.accessCode) throw new HttpError(503, "TrustDrive has no access code configured. Set TRUSTDRIVE_ACCESS_CODE and restart.");
  const minute = Math.floor(Date.now() / 60_000);
  if (failures.minute !== minute) failures = { minute, count: 0 };
  if (failures.count >= MAX_FAILURES) throw new HttpError(429, "Too many wrong codes. Try again in a minute.");
  if (!codeMatches(config.accessCode, code)) {
    failures.count++;
    log.warn("sign-in with a wrong access code", { failuresThisMinute: failures.count });
    throw new HttpError(401, "That access code isn't right.");
  }
  await startSession(DEFAULT_VIEWER);
  return Response.json({ ok: true });
});
