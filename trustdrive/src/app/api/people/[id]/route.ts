import { requireViewer } from "@/lib/auth";
import { handle, HttpError } from "@/lib/http";
import { personProfile } from "@/lib/service";

/** Someone's expertise profile: what they know, what they're in charge of and who they work with, from their work. */
export const GET = handle(async (req, ctx: RouteContext<"/api/people/[id]">) => {
  const viewer = await requireViewer(req);
  const profile = await personProfile((await ctx.params).id, viewer);
  if (!profile) throw new HttpError(404, "Not found");
  return Response.json(profile);
});
