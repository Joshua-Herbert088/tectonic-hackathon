import { pingDb } from "@/lib/db";
import { log } from "@/lib/log";

/** For container health checks: up when the database answers. */
export async function GET() {
  try {
    await pingDb();
    return Response.json({ ok: true });
  } catch (e) {
    log.error("health check failed", { error: (e as Error).message });
    return Response.json({ ok: false }, { status: 503 });
  }
}
