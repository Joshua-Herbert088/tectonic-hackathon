import { requireViewer } from "@/lib/auth";
import { loadWorld } from "@/lib/db";
import { contradictionDoubts } from "@/lib/doubts";
import { handle, HttpError } from "@/lib/http";

/** Lines of this document that contradict other documents (Jev, or the rules without Jev). */
export const GET = handle(async (req, ctx: RouteContext<"/api/docs/[id]/doubts">) => {
  await requireViewer(req);
  const { id } = await ctx.params;
  const world = await loadWorld();
  const doc = world.docs.find((d) => d.id === id);
  if (!doc) throw new HttpError(404, "Not found");
  return Response.json({ doubts: await contradictionDoubts(world, doc) });
});
