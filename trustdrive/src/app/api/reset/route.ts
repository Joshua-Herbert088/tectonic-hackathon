import { requireViewer } from "@/lib/auth";
import { config } from "@/lib/config";
import { resetDb } from "@/lib/db";
import { handle, HttpError } from "@/lib/http";
import { log } from "@/lib/log";
import { rateLimit } from "@/lib/rateLimit";

/** Wipes everything and reloads the demo company. Only where allowed (ALLOW_DEMO_RESET), and once a minute. */
export const POST = handle(async (req) => {
  const viewer = await requireViewer(req);
  if (!config.allowDemoReset) throw new HttpError(403, "Resetting is turned off on this server.");
  rateLimit("reset", 1, 60_000);
  log.warn("demo data reset", { by: viewer.id });
  await resetDb();
  return Response.json({ ok: true });
});
