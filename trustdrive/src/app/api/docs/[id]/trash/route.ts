import { visibleDoc } from "@/lib/access";
import { requireViewer } from "@/lib/auth";
import { loadWorld, trashDocument } from "@/lib/db";
import { handle, HttpError } from "@/lib/http";

/** Moves a document to the trash. The owner and collaborators can; it can be restored from the trash. */
export const POST = handle(async (req, ctx: RouteContext<"/api/docs/[id]/trash">) => {
  const viewer = await requireViewer(req);
  const { id } = await ctx.params;
  const doc = visibleDoc(await loadWorld(), id, viewer);
  if (doc.ownerId !== viewer.id && !doc.collaboratorIds.includes(viewer.id)) throw new HttpError(403, "Only the owner and collaborators can move this document to the trash.");
  await trashDocument(id, viewer.id);
  return Response.json({ ok: true });
});
