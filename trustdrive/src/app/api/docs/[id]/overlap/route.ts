import { z } from "zod";
import { canSee, visibleDoc } from "@/lib/access";
import { requireViewer } from "@/lib/auth";
import { loadWorld } from "@/lib/db";
import { handle, readBody } from "@/lib/http";
import { findSameInformation } from "@/lib/similarity";

/** Which of `ids` (e.g. documents the reader just looked at) contain basically the same information as this one? */
export const POST = handle(async (req, ctx: RouteContext<"/api/docs/[id]/overlap">) => {
  const { id } = await ctx.params;
  const viewer = await requireViewer(req);
  const { ids } = await readBody(req, z.object({ ids: z.array(z.string()).max(10).default([]) }));
  const world = await loadWorld();
  const doc = visibleDoc(world, id, viewer);
  return Response.json({ matches: await findSameInformation(doc, world.docs.filter((d) => d.id !== id && ids.includes(d.id) && canSee(d, viewer))) });
});
