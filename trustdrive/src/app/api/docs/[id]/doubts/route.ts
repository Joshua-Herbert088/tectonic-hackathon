import { visibleDoc } from "@/lib/access";
import { requireViewer } from "@/lib/auth";
import { loadWorld } from "@/lib/db";
import { contradictionDoubts } from "@/lib/doubts";
import { handle } from "@/lib/http";

/** Lines of this document that contradict other documents (Jev, or the rules without Jev). */
export const GET = handle(async (req, ctx: RouteContext<"/api/docs/[id]/doubts">) => {
  const viewer = await requireViewer(req);
  const { id } = await ctx.params;
  const world = await loadWorld();
  const doc = visibleDoc(world, id, viewer);
  return Response.json({ doubts: await contradictionDoubts(world, doc, viewer) });
});
