import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  closeDb,
  createConversation,
  createFolder,
  createTerm,
  deleteTerm,
  deleteFolder,
  findPerson,
  insertScore,
  latestScoresForViewer,
  listNotifications,
  insertNotifications,
  loadConversations,
  loadHistory,
  loadTerms,
  loadWorld,
  markNotificationsRead,
  migrateAndSeed,
  moveDocument,
  resetDb,
  transferOwnership,
  updateDocument,
} from "./db";
import { buildSeed } from "./seed";
import { DEFAULT_TERMS } from "./taxonomy";

// A throwaway in-memory Postgres (PGLITE_DIR=memory:// in vitest.config.ts), migrated and seeded.
beforeAll(async () => {
  await migrateAndSeed();
}, 60_000);
afterAll(async () => {
  await closeDb();
});

const score = (n: number) => ({ score: n, confidence: 0.9, levelProbabilities: { "3": 1 }, model: "test", computedAt: new Date().toISOString(), inputHash: `h${n}`, latencyMs: 1 });

describe("database", () => {
  test("seeds the whole demo company", async () => {
    const world = await loadWorld();
    const seed = buildSeed();
    expect(world.docs).toHaveLength(seed.docs.length);
    expect(world.people).toHaveLength(seed.people.length);
    expect(world.clients.map((c) => c.id).sort()).toEqual(seed.clients.map((c) => c.id).sort());
    const doc = world.docs.find((d) => d.id === "be-yearend-2026")!;
    expect(doc.collaboratorIds).toEqual(["an", "jonas"]);
    expect(doc.verifications.length).toBeGreaterThan(0);
  });

  test("finds people by id and case-insensitive email", async () => {
    expect((await findPerson({ email: "Lotte.Peeters@TrustDrive.example" }))?.id).toBe("lotte");
    expect(await findPerson({ id: "nobody" })).toBeNull();
  });

  test("an edit keeps a snapshot and makes the editor a collaborator", async () => {
    const before = (await loadHistory(["overtime-be"])).get("overtime-be")!.length;
    await updateDocument("overtime-be", "jonas", { content: "# Overtime policy – Belgium\n\nUpdated." });
    const world = await loadWorld();
    const doc = world.docs.find((d) => d.id === "overtime-be")!;
    expect(doc.lastEditedById).toBe("jonas");
    expect(doc.collaboratorIds).toContain("jonas");
    expect((await loadHistory(["overtime-be"])).get("overtime-be")!).toHaveLength(before + 1);
  });

  test("a metadata change is history but not an edit", async () => {
    const updatedAt = (await loadWorld()).docs.find((d) => d.id === "remote-work")!.updatedAt;
    await updateDocument("remote-work", "eva", { status: "To be reviewed" });
    expect((await loadWorld()).docs.find((d) => d.id === "remote-work")!.updatedAt).toBe(updatedAt);
  });

  test("handing over keeps an active previous owner as collaborator", async () => {
    await transferOwnership("overtime-be", "lotte");
    const doc = (await loadWorld()).docs.find((d) => d.id === "overtime-be")!;
    expect(doc.ownerId).toBe("lotte");
    expect(doc.collaboratorIds).toContain("marc");
    expect(doc.collaboratorIds).not.toContain("lotte");
  });

  test("the latest score per document wins", async () => {
    await insertScore("sick-leave-be", "sofie", score(40));
    await insertScore("sick-leave-be", "sofie", score(80));
    await insertScore("expense-faq", "sofie", score(55));
    const latest = await latestScoresForViewer("sofie");
    expect(latest.get("sick-leave-be")?.score).toBe(80);
    expect(latest.get("expense-faq")?.score).toBe(55);
  });

  test("notifications count unread per person", async () => {
    await insertNotifications([{ recipientId: "an", actorId: "jonas", kind: "doc_edit", docId: "x", docTitle: "X", changes: [] }]);
    expect((await listNotifications("an")).unread).toBe(1);
    await markNotificationsRead("an");
    expect((await listNotifications("an")).unread).toBe(0);
  });

  test("imported conversations come back with their messages in order", async () => {
    await createConversation({ id: "conv-test", source: "teams", title: "Test", createdAt: new Date().toISOString(), participants: [] }, [
      { authorName: "B", sentAt: "2026-01-02T00:00:00.000Z", body: "second" },
      { authorName: "A", sentAt: "2026-01-01T00:00:00.000Z", body: "first" },
    ]);
    const [c] = await loadConversations(["conv-test"]);
    expect(c.messages.map((m) => m.body)).toEqual(["first", "second"]);
  });

  test("the demo documents are filed in the example folders", async () => {
    const world = await loadWorld();
    expect(world.folders).toHaveLength(buildSeed().folders.length);
    expect(world.docs.find((d) => d.id === "client-noordkaai")?.folderId).toBe("f-clients-noordkaai");
  });

  test("deleting a folder moves its contents up a level", async () => {
    const at = new Date().toISOString();
    await createFolder({ id: "folder-test", name: "Test", parentId: "f-hr", createdById: "eva", createdAt: at });
    await createFolder({ id: "folder-test-sub", name: "Sub", parentId: "folder-test", createdAt: at });
    await moveDocument("remote-work", "folder-test");
    await deleteFolder("folder-test");
    const world = await loadWorld();
    expect(world.folders.some((f) => f.id === "folder-test")).toBe(false);
    expect(world.folders.find((f) => f.id === "folder-test-sub")?.parentId).toBe("f-hr");
    expect(world.docs.find((d) => d.id === "remote-work")?.folderId).toBe("f-hr");
  });

  test("filing a document isn't an edit", async () => {
    const before = (await loadWorld()).docs.find((d) => d.id === "expense-faq")!;
    const history = (await loadHistory(["expense-faq"])).get("expense-faq")!.length;
    await moveDocument("expense-faq", null);
    const after = (await loadWorld()).docs.find((d) => d.id === "expense-faq")!;
    expect(after.folderId).toBeUndefined();
    expect(after.updatedAt).toBe(before.updatedAt);
    expect((await loadHistory(["expense-faq"])).get("expense-faq")!).toHaveLength(history);
  });

  test("the taxonomy is stored, in its written order, and can be extended", async () => {
    const terms = await loadTerms();
    expect(terms.map((t) => `${t.kind}:${t.id}`)).toEqual(DEFAULT_TERMS.map((t) => `${t.kind}:${t.id}`));
    await createTerm({ kind: "country", id: "Luxembourg", label: "Luxembourg", description: "", keywords: ["luxembourg"] });
    expect((await loadWorld()).terms.at(-1)?.id).toBe("Luxembourg");
    await deleteTerm("country", "Luxembourg");
    expect((await loadTerms()).some((t) => t.id === "Luxembourg")).toBe(false);
  });

  test("reset restores the demo company", async () => {
    await resetDb();
    const world = await loadWorld();
    expect(world.docs.find((d) => d.id === "overtime-be")!.ownerId).toBe("marc");
    expect(await loadConversations(["conv-test"])).toEqual([]);
    expect(world.docs.find((d) => d.id === "expense-faq")?.folderId).toBe("f-hr");
  });
});
