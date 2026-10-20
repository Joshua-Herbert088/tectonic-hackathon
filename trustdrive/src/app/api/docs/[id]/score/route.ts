import { requireViewer } from "@/lib/auth";
import { handle, HttpError } from "@/lib/http";
import { computeScore } from "@/lib/service";

export const POST = handle(async (req, ctx: RouteContext<"/api/docs/[id]/score">) => {
  const trust = await computeScore((await ctx.params).id, await requireViewer(req));
  if (!trust) throw new HttpError(404, "Not found");
  return Response.json({ trust });
});
