import { describe, expect, test } from "vitest";
import { canMoveFolder, childFolders, folderLabel, folderOptions, subtree, validateFolderName } from "./folders";
import { buildSeed, SEED_FOLDERS } from "./seed";
import type { Folder } from "./types";

const at = "2026-01-01T00:00:00.000Z";
const folders: Folder[] = [
  { id: "a", name: "Payroll", createdAt: at },
  { id: "b", name: "Belgium", parentId: "a", createdAt: at },
  { id: "c", name: "Year-end", parentId: "b", createdAt: at },
  { id: "d", name: "Clients", createdAt: at },
];

describe("folder tree", () => {
  test("paths read from the top down", () => {
    expect(folderLabel(folders, "c")).toBe("Payroll / Belgium / Year-end");
    expect(folderLabel(folders, undefined)).toBeNull();
    expect(folderLabel(folders, "gone")).toBeNull();
  });

  test("children are sorted by name, top level included", () => {
    expect(childFolders(folders, null).map((f) => f.id)).toEqual(["d", "a"]);
    expect(childFolders(folders, "a").map((f) => f.id)).toEqual(["b"]);
  });

  test("a subtree holds the folder and everything below it", () => {
    expect([...subtree(folders, "a")].sort()).toEqual(["a", "b", "c"]);
    expect([...subtree(folders, "d")]).toEqual(["d"]);
  });

  test("a folder can't move into itself or below itself", () => {
    expect(canMoveFolder(folders, "a", "c")).toBe(false);
    expect(canMoveFolder(folders, "a", "a")).toBe(false);
    expect(canMoveFolder(folders, "c", "d")).toBe(true);
    expect(canMoveFolder(folders, "c", null)).toBe(true);
  });

  test("options list every folder depth-first", () => {
    expect(folderOptions(folders).map(({ folder, depth }) => `${depth}:${folder.name}`)).toEqual(["0:Clients", "0:Payroll", "1:Belgium", "2:Year-end"]);
  });

  test("names must be filled in and unique among siblings", () => {
    expect(validateFolderName(folders, "  ", null)).toMatch(/name/);
    expect(validateFolderName(folders, "payroll", null)).toMatch(/already/);
    expect(validateFolderName(folders, "Payroll", "d")).toBeNull();
    expect(validateFolderName(folders, "Payroll", null, "a")).toBeNull();
  });

  test("the demo folders file existing documents, each in one folder", () => {
    const seed = buildSeed();
    const ids = new Set(seed.docs.map((d) => d.id));
    const listed = SEED_FOLDERS.flatMap((f) => f.docs);
    expect(listed.filter((id) => !ids.has(id))).toEqual([]);
    expect(new Set(listed).size).toBe(listed.length);
    // Parents come before their subfolders, so they can be inserted in order.
    SEED_FOLDERS.forEach((f, i) => f.parentId && expect(SEED_FOLDERS.findIndex((p) => p.id === f.parentId)).toBeLessThan(i));
    expect(seed.docs.find((d) => d.id === "be-yearend-2026")?.folderId).toBe("f-payroll-be-yearend");
  });
});
