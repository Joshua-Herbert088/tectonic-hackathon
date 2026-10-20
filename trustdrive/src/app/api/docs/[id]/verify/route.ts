import { requireViewer } from "@/lib/auth";
import { addVerification, documentExists } from "@/lib/db";
import { handle, HttpError } from "@/lib/http";
import { docDetail } from "@/lib/service";

/** The signed-in person states the document is correct as of now. */
export const POST = handle(async (req, ctx: RouteContext<"/api/docs/[id]/verify">) => {
  const { id } = await ctx.params;
  const viewer = await requireViewer(req);
  if (!(await documentExists(id))) throw new HttpError(404, "Not found");
  await addVerification(id, viewer.id);
  return Response.json(await docDetail(id, viewer));
});
