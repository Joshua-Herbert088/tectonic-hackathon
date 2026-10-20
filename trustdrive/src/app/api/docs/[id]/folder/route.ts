import { requireViewer } from "@/lib/auth";
import { documentExists, loadFolders, moveDocument } from "@/lib/db";
import { handle, HttpError, readBody } from "@/lib/http";
import { documentFolder } from "@/lib/schemas";

/** Files the document in a folder (null = the top of the drive). Not an edit, so the trust score stays. */
export const POST = handle(async (req, ctx: RouteContext<"/api/docs/[id]/folder">) => {
  const { id } = await ctx.params;
  await requireViewer(req);
  const { folderId } = await readBody(req, documentFolder);
  if (!(await documentExists(id))) throw new HttpError(404, "Not found");
  if (folderId && !(await loadFolders()).some((f) => f.id === folderId)) throw new HttpError(404, "That folder doesn't exist any more.");
  await moveDocument(id, folderId);
  return Response.json({ id, folderId });
});
