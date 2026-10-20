import { requireViewer } from "@/lib/auth";
import { resetDb } from "@/lib/db";
import { handle } from "@/lib/http";
import { log } from "@/lib/log";

/** Wipes everything and reloads the demo company. */
export const POST = handle(async (req) => {
  const viewer = await requireViewer(req);
  log.warn("demo data reset", { by: viewer.id });
  await resetDb();
  return Response.json({ ok: true });
});
