import type { Folder } from "./types";

/** Folder tree helpers, shared by the API and the drive. Folders without a (known) parent are top level. */

export const MAX_FOLDER_NAME = 120;

/** The folders from the top of the drive down to `id` (inclusive); empty for the top level or an unknown id. */
export function folderPath(folders: Folder[], id: string | null | undefined): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: Folder[] = [];
  const seen = new Set<string>();
  for (let f = id ? byId.get(id) : undefined; f && !seen.has(f.id); f = f.parentId ? byId.get(f.parentId) : undefined) {
    seen.add(f.id);
    path.unshift(f);
  }
  return path;
}

/** "Payroll / Belgium", or null for the top level. */
export function folderLabel(folders: Folder[], id: string | null | undefined): string | null {
  const path = folderPath(folders, id);
  return path.length ? path.map((f) => f.name).join(" / ") : null;
}

/** Direct subfolders of `parentId` (null = top level), by name. */
export function childFolders(folders: Folder[], parentId: string | null): Folder[] {
  return folders.filter((f) => (f.parentId ?? null) === parentId).sort((a, b) => a.name.localeCompare(b.name));
}

/** `id` and every folder below it. */
export function subtree(folders: Folder[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Whether `folderId` can move into `targetId` (null = top level): not into itself or one of its own subfolders. */
export function canMoveFolder(folders: Folder[], folderId: string, targetId: string | null): boolean {
  return targetId === null || !subtree(folders, folderId).has(targetId);
}

/** Every folder depth-first, sorted by name, with its depth – for a "Move to" list. */
export function folderOptions(folders: Folder[]): { folder: Folder; depth: number }[] {
  const out: { folder: Folder; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const f of childFolders(folders, parentId)) {
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** A name that isn't empty and isn't taken by a sibling (case-insensitive), or an error to show. */
export function validateFolderName(folders: Folder[], name: string, parentId: string | null, ignoreId?: string): string | null {
  const n = name.trim();
  if (!n) return "Give the folder a name.";
  if (n.length > MAX_FOLDER_NAME) return `Keep the name under ${MAX_FOLDER_NAME} characters.`;
  const taken = folders.some((f) => f.id !== ignoreId && (f.parentId ?? null) === parentId && f.name.toLowerCase() === n.toLowerCase());
  return taken ? `There's already a folder called “${n}” here.` : null;
}
