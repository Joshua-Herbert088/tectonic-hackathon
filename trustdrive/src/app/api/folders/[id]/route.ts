import { requireViewer } from "@/lib/auth";
import { deleteFolder, loadFolders, updateFolder } from "@/lib/db";
import { canMoveFolder, validateFolderName } from "@/lib/folders";
import { handle, HttpError, readBody } from "@/lib/http";
import { folderPatch } from "@/lib/schemas";

type Ctx = RouteContext<"/api/folders/[id]">;

/** Renames a folder and/or moves it (parentId null = the top of the drive). */
export const PATCH = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  await requireViewer(req);
  const body = await readBody(req, folderPatch);
  const folders = await loadFolders();
  const folder = folders.find((f) => f.id === id);
  if (!folder) throw new HttpError(404, "Not found");
  const parentId = body.parentId === undefined ? (folder.parentId ?? null) : body.parentId;
  if (parentId && !folders.some((f) => f.id === parentId)) throw new HttpError(404, "The target folder doesn't exist any more.");
  if (!canMoveFolder(folders, id, parentId)) throw new HttpError(400, "A folder can't move into itself or one of its own subfolders.");
  const name = body.name ?? folder.name;
  const invalid = validateFolderName(folders, name, parentId, id);
  if (invalid) throw new HttpError(400, invalid);
  await updateFolder(id, { name: name.trim(), parentId });
  return Response.json({ folders: await loadFolders() });
});

/** Deletes a folder. Its documents and subfolders move up a level; nothing is deleted with it. */
export const DELETE = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  await requireViewer(req);
  await deleteFolder(id);
  return Response.json({ folders: await loadFolders() });
});
