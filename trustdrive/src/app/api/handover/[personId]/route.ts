import { requireViewer } from "@/lib/auth";
import { handle, HttpError } from "@/lib/http";
import { handoverBriefing } from "@/lib/service";

/** Handover briefing: what the viewer inherits from this person. */
export const GET = handle(async (req, ctx: RouteContext<"/api/handover/[personId]">) => {
  const viewer = await requireViewer(req);
  const briefing = await handoverBriefing((await ctx.params).personId, viewer);
  if (!briefing) throw new HttpError(404, "Not found");
  return Response.json(briefing);
});
