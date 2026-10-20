import crypto from "node:crypto";
import { requireViewer } from "@/lib/auth";
import { createFolder, loadFolders } from "@/lib/db";
import { validateFolderName } from "@/lib/folders";
import { handle, HttpError, readBody } from "@/lib/http";
import { newFolder } from "@/lib/schemas";

export const GET = handle(async (req) => {
  await requireViewer(req);
  return Response.json({ folders: await loadFolders() });
});

/** Creates a folder at the top of the drive or inside `parentId`. */
export const POST = handle(async (req) => {
  const viewer = await requireViewer(req);
  const body = await readBody(req, newFolder);
  const folders = await loadFolders();
  const parentId = body.parentId ?? null;
  if (parentId && !folders.some((f) => f.id === parentId)) throw new HttpError(404, "That folder doesn't exist any more.");
  const invalid = validateFolderName(folders, body.name, parentId);
  if (invalid) throw new HttpError(400, invalid);
  const folder = { id: `folder-${crypto.randomUUID()}`, name: body.name.trim(), parentId: parentId ?? undefined, createdById: viewer.id, createdAt: new Date().toISOString() };
  await createFolder(folder);
  return Response.json({ folder, folders: [...folders, folder] });
});
