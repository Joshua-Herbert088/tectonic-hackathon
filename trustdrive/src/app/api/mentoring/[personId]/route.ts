import { requireViewer } from "@/lib/auth";
import { handle } from "@/lib/http";
import { menteeDetail } from "@/lib/service";

/** What a mentee asked, searched for and opened, by department. Only for their mentor. */
export const GET = handle(async (req, ctx: RouteContext<"/api/mentoring/[personId]">) => {
  const viewer = await requireViewer(req);
  return Response.json(await menteeDetail((await ctx.params).personId, viewer));
});
