import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, findPerson, listNotifications, loadConversations, migrateAndSeed } from "./db";
import { sendMessage } from "./messaging";
import { homeFor } from "./service";
import type { Person } from "./types";

// In-memory Postgres (vitest.config.ts), migrated and seeded with the demo company.
let sofie: Person;
let lotte: Person;
beforeAll(async () => {
  await migrateAndSeed();
  sofie = (await findPerson({ id: "sofie" }))!;
  lotte = (await findPerson({ id: "lotte" }))!;
}, 60_000);
afterAll(async () => {
  await closeDb();
});

describe("messaging inside TrustDrive", () => {
  test("an email to a client is kept in a client conversation; the client is reported as not receiving it", async () => {
    const { conversationId, undelivered } = await sendMessage(sofie, {
      source: "email",
      to: [{ name: "Els Vermeiren", email: "els.vermeiren@noordkaai.example" }, { personId: "an", name: "" }],
      subject: "Payslips for October",
      body: "Could you confirm the October headcount?",
    });
    expect(undelivered).toEqual(["Els Vermeiren"]);
    const [c] = await loadConversations([conversationId]);
    expect(c).toMatchObject({ source: "email", title: "Payslips for October", clientId: "noordkaai" });
    expect(c.participants.map((p) => p.name)).toEqual(["Sofie Willems", "Els Vermeiren", "An Claes"]);
    expect(c.messages).toHaveLength(1); // nobody answers on the client's behalf
    expect((await listNotifications("an")).items[0]).toMatchObject({ kind: "message", actorId: "sofie", docId: conversationId });
  });

  test("a Teams message to a colleague notifies them, and the next one lands in the same chat", async () => {
    const first = await sendMessage(sofie, { source: "teams", to: [{ personId: "lotte", name: "" }], body: "Do you have the Noordkaai CAO?" });
    const second = await sendMessage(sofie, { source: "teams", to: [{ personId: "lotte", name: "" }], body: "Found it, never mind!" });
    expect(second.conversationId).toBe(first.conversationId);
    expect(first.undelivered).toEqual([]);
    const [c] = await loadConversations([first.conversationId]);
    expect(c.title).toBe("Sofie Willems, Lotte Peeters");
    expect(c.messages.map((m) => m.body)).toEqual(["Do you have the Noordkaai CAO?", "Found it, never mind!"]);
    const { items, unread } = await listNotifications("lotte");
    expect(unread).toBeGreaterThanOrEqual(2);
    expect(items[0]).toMatchObject({ kind: "message", actorId: "sofie", reason: "Found it, never mind!" });

    const reply = await sendMessage(lotte, { conversationId: c.id, source: "teams", to: [], body: "👍" });
    expect(reply.conversationId).toBe(c.id);
  });

  test("answering the client who was waiting takes them off the For you page", async () => {
    expect((await homeFor(sofie)).waiting.map((w) => w.conversationId)).toContain("conv-noordkaai-indexation");
    await sendMessage(sofie, { conversationId: "conv-noordkaai-indexation", source: "email", to: [], body: "Here is the simulation, attached." });
    expect((await homeFor(sofie)).waiting.map((w) => w.conversationId)).not.toContain("conv-noordkaai-indexation");
    const [c] = await loadConversations(["conv-noordkaai-indexation"]);
    expect(c.messages.at(-1)).toMatchObject({ personId: "sofie", body: "Here is the simulation, attached." });
  });

  test("a new email needs a recipient; an unknown conversation is a 404", async () => {
    await expect(sendMessage(sofie, { source: "email", to: [], body: "Hello?" })).rejects.toMatchObject({ status: 400 });
    await expect(sendMessage(sofie, { conversationId: "nope", source: "email", to: [], body: "Hello?" })).rejects.toMatchObject({ status: 404 });
  });
});

