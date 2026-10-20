import { requireViewer } from "@/lib/auth";
import { handle, HttpError } from "@/lib/http";
import { answerPage } from "@/lib/service";

/** A shared answer, as the viewer may see it (from a private chat: without who asked). */
export const GET = handle(async (req, ctx: RouteContext<"/api/answers/[id]">) => {
  const viewer = await requireViewer(req);
  const answer = await answerPage(Number((await ctx.params).id), viewer);
  if (!answer) throw new HttpError(404, "Not found");
  return Response.json(answer);
});
