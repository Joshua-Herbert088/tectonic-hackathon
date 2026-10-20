import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { loadWorld } from "@/lib/db";
import { handle, HttpError, readBody } from "@/lib/http";
import { findSameInformation } from "@/lib/similarity";

/** Which of `ids` (e.g. documents the reader just looked at) contain basically the same information as this one? */
export const POST = handle(async (req, ctx: RouteContext<"/api/docs/[id]/overlap">) => {
  const { id } = await ctx.params;
  await requireViewer(req);
  const { ids } = await readBody(req, z.object({ ids: z.array(z.string()).max(10).default([]) }));
  const world = await loadWorld();
  const doc = world.docs.find((d) => d.id === id);
  if (!doc) throw new HttpError(404, "Not found");
  return Response.json({ matches: await findSameInformation(doc, world.docs.filter((d) => d.id !== id && ids.includes(d.id))) });
});
