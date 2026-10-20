import { requireViewer } from "@/lib/auth";
import { loadTrash, restoreDocument } from "@/lib/db";
import { handle, HttpError } from "@/lib/http";

/** Takes a document out of the trash: the owner or whoever put it there can. */
export const POST = handle(async (req, ctx: RouteContext<"/api/docs/[id]/restore">) => {
  const viewer = await requireViewer(req);
  const { id } = await ctx.params;
  const doc = (await loadTrash()).find((d) => d.id === id);
  if (!doc) throw new HttpError(404, "Not in the trash");
  if (doc.ownerId !== viewer.id && doc.trashedById !== viewer.id) throw new HttpError(403, "Only the owner or the person who removed it can restore it.");
  await restoreDocument(id);
  return Response.json({ ok: true });
});
