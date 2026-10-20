import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { captureAnswers, decideSharing, liveConflict } from "./answers";
import { closeDb, findPerson, insertSuggestedEdits, listNotifications, loadAnswers, loadSuggestedEdits, loadWorld, migrateAndSeed } from "./db";
import { applyEdit, decideEdit, editsFor, editsForDoc, swapFigure } from "./edits";
import type { Person } from "./types";

// In-memory Postgres (vitest.config.ts), migrated and seeded with the demo company. Jev is off, so the rules decide.
let lotte: Person;
let marc: Person;
let sanne: Person;
let lars: Person;
beforeAll(async () => {
  await migrateAndSeed();
  [lotte, marc, sanne, lars] = await Promise.all(["lotte", "marc", "sanne", "lars"].map(async (id) => (await findPerson({ id }))!));
}, 60_000);
afterAll(async () => {
  await closeDb();
});

describe("drafting a change", () => {
  test("swaps only the figure the answer changed, picked by the words around it", () => {
    expect(swapFigure("- Voluntary overtime: max 100 hours per calendar year (2021 regime – temporary increase to 220 hours has ended).", "Voluntary overtime is max 120 hours per calendar year now.")).toBe(
      "- Voluntary overtime: max 120 hours per calendar year (2021 regime – temporary increase to 220 hours has ended).",
    );
    expect(swapFigure("- Mileage allowance: €0.42/km for all employees.", "The mileage allowance is €0.45/km since July.")).toBe("- Mileage allowance: €0.45/km for all employees.");
  });

  test("leaves it to a person when it isn't clear which figure changed", () => {
    // Three dates of the same kind with the same words around them.
    expect(swapFigure("| December | 10 Dec | 15 Dec | 22 Dec |", "The input deadline for December is 12 Dec.")).toBeNull();
    // Nothing of the same kind to swap; years are never swapped.
    expect(swapFigure("- Recovery within 3 months.", "It's 120 hours per year.")).toBeNull();
    expect(swapFigure("- Applies from 2026.", "It applies from 2027.")).toBeNull();
  });

  test("applies a change, unless the line it replaces is gone", () => {
    expect(applyEdit("# T\n- a: 1\n- b: 2", { kind: "replace", oldLine: "- a: 1", newLine: "- a: 3" })).toBe("# T\n- a: 3\n- b: 2");
    expect(applyEdit("# T\n- a: 1", { kind: "replace", oldLine: "- gone", newLine: "- x" })).toBeNull();
    expect(applyEdit("# T\n- a: 1\n\n", { kind: "add", newLine: "- new" })).toBe("# T\n- a: 1\n\n- new\n");
  });
});

describe("from answer to document", () => {
  test("shared answers that say something a document doesn't are drafted for whoever answered", async () => {
    await captureAnswers();
    const edits = await loadSuggestedEdits();
    expect(edits.find((e) => e.docId === "overtime-be")).toMatchObject({
      kind: "replace",
      status: "draft",
      oldLine: expect.stringContaining("max 100 hours"),
      newLine: expect.stringMatching(/^- Voluntary overtime: max 120 hours per calendar year .*\(\[source\]\(\/board\/answers\/\d+ /),
    });
    // Sanne's board answer isn't written down anywhere yet: it's drafted as a line for Lars's document.
    expect(edits.find((e) => e.docId === "vakantiegeld-nl-2026")).toMatchObject({ kind: "add", status: "draft", newLine: expect.stringContaining("13th month") });
    // Answers that are already in the drive suggest nothing.
    expect(edits).toHaveLength(2);
    expect((await listNotifications("lotte")).items.some((n) => n.kind === "suggestion_draft" && n.docId === "overtime-be")).toBe(true);
    expect((await editsFor(lotte)).toPropose.map((e) => e.docId)).toEqual(["overtime-be"]);
  });

  test("an answer waiting to be shared suggests nothing until it's shared", async () => {
    const pending = (await loadAnswers()).find((a) => a.answererId === "lars" && a.sharing === "pending")!;
    expect((await loadSuggestedEdits()).some((e) => e.answerId === pending.id)).toBe(false);
    await decideSharing(lars, [pending.id], true);
    // It's already in the drive, so it's checked but nothing is drafted.
    expect((await loadSuggestedEdits()).some((e) => e.answerId === pending.id)).toBe(false);
  });

  test("the answerer proposes (reworded), the owner accepts: the document changes and the contradiction goes", async () => {
    const draft = (await editsFor(lotte)).toPropose[0];
    expect(draft).toMatchObject({ deciderId: "marc", answererId: "lotte" });
    await expect(decideEdit(marc, draft.id, { action: "propose" })).rejects.toMatchObject({ status: 403 });

    const reworded = "- Voluntary overtime: max 120 hours per calendar year (since the 2023 labour deal).";
    await decideEdit(lotte, draft.id, { action: "propose", text: reworded });
    expect((await listNotifications("marc")).items[0]).toMatchObject({ kind: "suggestion", actorId: "lotte", docId: "overtime-be" });
    expect((await editsFor(marc)).toReview.map((e) => e.id)).toEqual([draft.id]);
    expect((await editsForDoc("overtime-be")).map((e) => e.status)).toEqual(["proposed"]);
    await expect(decideEdit(lotte, draft.id, { action: "accept" })).rejects.toMatchObject({ status: 403 });

    const res = await decideEdit(marc, draft.id, { action: "accept" });
    expect(res.status).toBe(200);
    const world = await loadWorld();
    const doc = world.docs.find((d) => d.id === "overtime-be")!;
    expect(doc.content).toContain(reworded);
    expect(doc.content).not.toContain("max 100 hours");
    expect(doc.lastEditedById).toBe("marc");
    expect((await loadSuggestedEdits({ ids: [draft.id] }))[0]).toMatchObject({ status: "accepted", decidedById: "marc", newLine: reworded });
    expect((await listNotifications("lotte")).items[0]).toMatchObject({ kind: "suggestion_decided", actorId: "marc", reason: "Changed" });
    const answer = (await loadAnswers()).find((a) => a.id === draft.answerId)!;
    expect(liveConflict(world, answer)).toBeUndefined();
    expect(await editsForDoc("overtime-be")).toEqual([]);
  });

  test("the owner can reject, with a reason the answerer sees", async () => {
    const draft = (await editsFor(sanne)).toPropose[0];
    expect(draft).toMatchObject({ docId: "vakantiegeld-nl-2026", deciderId: "lars" });
    await decideEdit(sanne, draft.id, { action: "propose" });
    await decideEdit(lars, draft.id, { action: "reject", reason: "It depends on the CAO; that's in the client files" });
    expect((await loadSuggestedEdits({ ids: [draft.id] }))[0]).toMatchObject({ status: "rejected", reason: "It depends on the CAO; that's in the client files" });
    expect((await listNotifications("sanne")).items[0]).toMatchObject({ kind: "suggestion_decided", reason: "Not changed: It depends on the CAO; that's in the client files" });
    await expect(decideEdit(lars, draft.id, { action: "accept" })).rejects.toMatchObject({ status: 409 });
  });

  test("a change to a line someone has edited since can't be applied blindly", async () => {
    const answer = (await loadAnswers()).find((a) => a.answererId === "lotte")!;
    const [{ id }] = await insertSuggestedEdits([{ answerId: answer.id, docId: "overtime-be", kind: "replace", oldLine: "- a line that isn't there any more", newLine: "- something else", status: "proposed" }]);
    // Not offered any more…
    expect((await editsFor(marc)).toReview.map((e) => e.id)).not.toContain(id);
    // …and refused if someone tries anyway.
    await expect(decideEdit(marc, id, { action: "accept" })).rejects.toMatchObject({ status: 409 });
  });
});
