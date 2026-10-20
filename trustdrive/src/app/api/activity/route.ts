import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { recordActivity } from "@/lib/db";
import { handle, readBody } from "@/lib/http";

/**
 * A question asked in "Who knows…?" or a drive search, for the signed-in person's mentor. Only kept
 * when they have one; opening a document is recorded by the document route itself.
 */
export const POST = handle(async (req) => {
  const viewer = await requireViewer(req);
  const body = await readBody(req, z.object({ kind: z.enum(["ask", "search"]), query: z.string().trim().min(1).max(300), results: z.number().int().min(0).optional() }));
  return Response.json({ recorded: await recordActivity(viewer.id, body) });
});
