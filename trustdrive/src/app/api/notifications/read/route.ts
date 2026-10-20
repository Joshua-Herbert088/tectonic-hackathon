import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { markNotificationsRead } from "@/lib/db";
import { handle, readBody } from "@/lib/http";

/** Marks the given notification ids (or all) as read for the signed-in person. */
export const POST = handle(async (req) => {
  const viewer = await requireViewer(req);
  const { ids } = await readBody(req, z.object({ ids: z.array(z.number().int()).max(500).optional() }));
  await markNotificationsRead(viewer.id, ids);
  return Response.json({ ok: true });
});
