import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { myClients } from "./clients";
import { closeDb, deleteDocumentForever, documentExists, findPerson, insertScore, latestScoresForViewer, loadTrash, loadWorld, migrateAndSeed, restoreDocument, setPersonClients, trashDocument } from "./db";

// A throwaway in-memory Postgres (PGLITE_DIR=memory:// in vitest.config.ts), migrated and seeded.
beforeAll(async () => {
  await migrateAndSeed();
}, 60_000);
afterAll(async () => {
  await closeDb();
});

describe("trash", () => {
  test("a trashed document disappears from the drive and comes back where it was", async () => {
    const before = (await loadWorld()).docs.find((d) => d.id === "expense-faq")!;
    await trashDocument("expense-faq", "inge");
    expect((await loadWorld()).docs.some((d) => d.id === "expense-faq")).toBe(false);
    expect(await documentExists("expense-faq")).toBe(false);
    expect((await loadTrash()).find((d) => d.id === "expense-faq")).toMatchObject({ trashedById: "inge", title: before.title });

    await restoreDocument("expense-faq");
    const back = (await loadWorld()).docs.find((d) => d.id === "expense-faq")!;
    expect(back.folderId).toBe(before.folderId);
    expect(back.verifications).toEqual(before.verifications);
    expect(await loadTrash()).toEqual([]);
  });

  test("deleting for good only works from the trash, and takes the document's rows with it", async () => {
    await insertScore("gdpr-retention", "jonas", { score: 40, confidence: 0.9, levelProbabilities: {}, model: "test", computedAt: new Date().toISOString(), inputHash: "h", latencyMs: 1 });
    await deleteDocumentForever("gdpr-retention");
    expect(await documentExists("gdpr-retention")).toBe(true);

    await trashDocument("gdpr-retention", "tom");
    await deleteDocumentForever("gdpr-retention");
    expect(await loadTrash()).toEqual([]);
    expect((await latestScoresForViewer("jonas")).has("gdpr-retention")).toBe(false);
  });
});

describe("my clients", () => {
  test("default to the team's clients, can be chosen per person, and reset", async () => {
    const { clients } = await loadWorld();
    const jonas = (await findPerson({ id: "jonas" }))!;
    expect(myClients(jonas, clients).map((c) => c.id).sort()).toEqual(["delinde", "noordkaai", "sintanna"]);

    await setPersonClients("jonas", ["havenstaal", "noordkaai"]);
    const chose = (await findPerson({ id: "jonas" }))!;
    expect(myClients(chose, clients).map((c) => c.id).sort()).toEqual(["havenstaal", "noordkaai"]);
    // Someone else in the team still sees the default.
    expect(myClients((await findPerson({ id: "lotte" }))!, clients)).toHaveLength(3);

    await setPersonClients("jonas", []);
    expect(myClients((await findPerson({ id: "jonas" }))!, clients)).toEqual([]);
    await setPersonClients("jonas", null);
    expect(myClients((await findPerson({ id: "jonas" }))!, clients)).toHaveLength(3);
  });
});
