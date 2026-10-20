import { visibleDoc } from "@/lib/access";
import { requireViewer } from "@/lib/auth";
import { loadFolders, loadWorld, moveDocument } from "@/lib/db";
import { handle, HttpError, readBody } from "@/lib/http";
import { documentFolder } from "@/lib/schemas";

/** Files the document in a folder (null = the top of the drive). Not an edit, so the trust score stays. */
export const POST = handle(async (req, ctx: RouteContext<"/api/docs/[id]/folder">) => {
  const { id } = await ctx.params;
  const viewer = await requireViewer(req);
  const { folderId } = await readBody(req, documentFolder);
  visibleDoc(await loadWorld(), id, viewer);
  if (folderId && !(await loadFolders()).some((f) => f.id === folderId)) throw new HttpError(404, "That folder doesn't exist any more.");
  await moveDocument(id, folderId);
  return Response.json({ id, folderId });
});
