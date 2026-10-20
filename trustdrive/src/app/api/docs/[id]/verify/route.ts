import { visibleDoc } from "@/lib/access";
import { requireViewer } from "@/lib/auth";
import { addVerification, loadWorld } from "@/lib/db";
import { handle, HttpError } from "@/lib/http";
import { docDetail } from "@/lib/service";
import { currentVerifications, mayVerify } from "@/lib/trust";

/**
 * The signed-in person states the document is correct as of now. Only someone accountable for it (see
 * mayVerify), and once per version: confirming the same text again adds nothing, so repeating the
 * request can't inflate how often it was verified.
 */
export const POST = handle(async (req, ctx: RouteContext<"/api/docs/[id]/verify">) => {
  const { id } = await ctx.params;
  const viewer = await requireViewer(req);
  const doc = visibleDoc(await loadWorld(), id, viewer);
  if (!mayVerify(doc, viewer)) throw new HttpError(403, "Only its owner, collaborators, the team that maintains it or Legal can confirm this document is correct. Ask the owner to check it.");
  if (!currentVerifications(doc).some((v) => v.personId === viewer.id)) await addVerification(id, viewer.id);
  return Response.json(await docDetail(id, viewer));
});
