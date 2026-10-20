import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, loadDirectory, loadHistory, loadWorld, MAX_VERSIONS, migrateAndSeed, storedChars, updateDocument } from "./db";
import { checkStorage, MAX_DOCUMENTS, MAX_DOCUMENTS_PER_OWNER, MAX_STORED_CHARS } from "./service";
import type { Db, Doc } from "./types";

// A throwaway in-memory Postgres (PGLITE_DIR=memory:// in vitest.config.ts), migrated and seeded.
let world: Db;
beforeAll(async () => {
  await migrateAndSeed();
  world = await loadWorld();
}, 60_000);
afterAll(async () => {
  await closeDb();
});

const versions = async (id: string) => (await loadHistory([id])).get(id) ?? [];

describe("edit history is bounded", () => {
  test("saving again soon replaces your last version; someone else's save adds one", async () => {
    const id = "remote-work-be-2026";
    const before = (await versions(id)).length;
    await updateDocument(id, "jonas", { content: "# Remote work\n\nFirst." });
    await updateDocument(id, "jonas", { content: "# Remote work\n\nSecond." });
    await updateDocument(id, "jonas", { content: "# Remote work\n\nThird." });
    const after = await versions(id);
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)).toMatchObject({ personId: "jonas", content: "# Remote work\n\nThird." });
    await updateDocument(id, "lotte", { content: "# Remote work\n\nLotte's." });
    expect((await versions(id)).length).toBe(before + 2);
  });

  test(`a document keeps at most ${MAX_VERSIONS} versions, always with the first`, async () => {
    const id = "sick-leave-be";
    const first = (await versions(id))[0];
    for (let i = 0; i < MAX_VERSIONS + 5; i++) await updateDocument(id, i % 2 ? "jonas" : "lotte", { content: `# Sick leave\n\nVersion ${i}.` });
    const kept = await versions(id);
    expect(kept.length).toBe(MAX_VERSIONS);
    expect(kept[0]).toEqual(first);
    expect(kept.at(-1)!.content).toBe(`# Sick leave\n\nVersion ${MAX_VERSIONS + 4}.`);
  }, 60_000);
});

describe("storage limits", () => {
  const jonas = () => world.people.find((p) => p.id === "jonas")!;
  const docsOwnedBy = (n: number, ownerId: string) => Array.from({ length: n }, (_, i) => ({ ...world.docs[0], id: `x${i}`, ownerId }) as Doc);

  test("no new document past the drive's or one owner's limit", async () => {
    await expect(checkStorage({ ...world, docs: docsOwnedBy(MAX_DOCUMENTS, "someone") }, jonas(), { document: true, chars: 1 })).rejects.toMatchObject({ status: 507 });
    await expect(checkStorage({ ...world, docs: docsOwnedBy(MAX_DOCUMENTS_PER_OWNER, "jonas") }, jonas(), { document: true, chars: 1 })).rejects.toMatchObject({ status: 409 });
    await expect(checkStorage(world, jonas(), { document: true, chars: 1 })).resolves.toBeUndefined();
  });

  test("no text past the stored-characters limit", async () => {
    const { documents, history } = await storedChars();
    expect(documents).toBeGreaterThan(0);
    expect(history).toBeGreaterThan(0);
    await expect(checkStorage(world, jonas(), { chars: MAX_STORED_CHARS })).rejects.toMatchObject({ status: 507 });
  });
});

test("the directory has the same people, teams, clients and terms as the world, without documents", async () => {
  const directory = await loadDirectory();
  const fresh = await loadWorld();
  expect(directory).toEqual({ teams: fresh.teams, people: fresh.people, clients: fresh.clients, terms: fresh.terms });
});
