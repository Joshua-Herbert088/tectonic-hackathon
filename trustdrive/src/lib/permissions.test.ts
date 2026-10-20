import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, loadWorld, migrateAndSeed } from "./db";
import { handoverFor } from "./handover";
import { checkTags, editDocument, maintains, mayReassign } from "./service";
import type { Db, Doc, Person } from "./types";

// A throwaway in-memory Postgres (PGLITE_DIR=memory:// in vitest.config.ts), migrated and seeded.
let world: Db;
beforeAll(async () => {
  await migrateAndSeed();
  world = await loadWorld();
}, 60_000);
afterAll(async () => {
  await closeDb();
});

const outsiderOf = (doc: Doc, also: (p: Person) => boolean = () => true) =>
  world.people.find((p) => p.active && !maintains(doc, p) && p.teamId !== doc.teamId && also(p))!;

describe("document settings", () => {
  test("only the owner and collaborators change status, confidentiality or scope", async () => {
    const doc = world.docs.find((d) => d.id === "overtime-be")!;
    const outsider = outsiderOf(doc);
    for (const body of [{ status: "Completed" as const }, { confidential: true }, { locations: ["France"] }]) {
      await expect(editDocument(outsider, doc.id, body)).rejects.toMatchObject({ status: 403 });
    }
    // Sending the current values back isn't a change.
    await expect(editDocument(outsider, doc.id, { status: doc.status, locations: [...doc.locations].reverse() })).resolves.toMatchObject({ status: 200 });
    const owner = world.people.find((p) => p.id === doc.ownerId)!;
    await expect(editDocument(owner, doc.id, { status: "Completed" })).resolves.toMatchObject({ status: 200 });
  });
});

describe("document text", () => {
  test("only the owner, collaborators and the maintaining team change it; editing doesn't make anyone else a collaborator", async () => {
    const doc = world.docs.find((d) => d.id === "remote-work-be-2026")!;
    const outsider = outsiderOf(doc);
    await expect(editDocument(outsider, doc.id, { content: `${doc.content}\n\nAdded by someone else.` })).rejects.toMatchObject({ status: 403 });
    expect((await loadWorld()).docs.find((d) => d.id === doc.id)!.collaboratorIds).not.toContain(outsider.id);
    const teammate = world.people.find((p) => p.active && p.teamId === doc.teamId && !maintains(doc, p))!;
    await expect(editDocument(teammate, doc.id, { content: `${doc.content}\n\nA teammate's note.`, acknowledgeSimilar: true })).resolves.toMatchObject({ status: 200 });
  });
});

describe("tags", () => {
  test("new tags must be in the taxonomy; ones a document already has may stay", () => {
    const known = world.docs.flatMap((d) => d.tags).find((t) => world.terms.some((x) => x.id === t))!;
    expect(() => checkTags(world, [known])).not.toThrow();
    expect(() => checkTags(world, ["constructor"])).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => checkTags(world, [known, "retired-topic"], ["retired-topic"])).not.toThrow();
  });
});

describe("handing a document over", () => {
  test("the owner always may; others only once it needs a new owner", () => {
    const healthy = world.docs.find((d) => !handoverFor(d, world.people, world.teams) && d.ownerId)!;
    expect(mayReassign(world, healthy, world.people.find((p) => p.id === healthy.ownerId)!)).toBe(true);
    expect(mayReassign(world, healthy, outsiderOf(healthy))).toBe(false);
    expect(mayReassign(world, healthy, world.people.find((p) => p.active && p.teamId === healthy.teamId && p.id !== healthy.ownerId)!)).toBe(false);

    const orphan = world.docs.find((d) => handoverFor(d, world.people, world.teams))!;
    const successors = handoverFor(orphan, world.people, world.teams)!.successors.map((s) => s.personId);
    const teammate = world.people.find((p) => p.active && p.teamId === orphan.teamId && p.id !== orphan.ownerId);
    if (teammate) expect(mayReassign(world, orphan, teammate)).toBe(true);
    const stranger = outsiderOf(orphan, (p) => !successors.includes(p.id));
    if (stranger) expect(mayReassign(world, orphan, stranger)).toBe(false);
  });
});
