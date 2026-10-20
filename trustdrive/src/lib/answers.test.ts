import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { captureAnswers, faqSuggestions, findExchanges } from "./answers";
import { composeFaqMarkdown, isInternal } from "./answerDoc";
import { closeDb, findPerson, listNotifications, loadAnswers, loadConversations, loadWorld, markAnswersInFaq, migrateAndSeed, setConversationPrivate, updateDocument } from "./db";
import { lineDoubts } from "./doubts";
import { sendMessage } from "./messaging";
import { dismissFaqSuggestion, docDetail, faqDraft, personProfile, whoKnowsFor } from "./service";
import type { Conversation, Message, Person } from "./types";

// In-memory Postgres (vitest.config.ts), migrated and seeded with the demo company. Jev is off, so the rules decide.
let jonas: Person;
let lotte: Person;
let karim: Person;
beforeAll(async () => {
  await migrateAndSeed();
  [jonas, lotte, karim] = await Promise.all(["jonas", "lotte", "karim"].map(async (id) => (await findPerson({ id }))!));
}, 60_000);
afterAll(async () => {
  await closeDb();
});

const chat = (...messages: [string, string][]): Conversation => ({
  id: "c",
  source: "teams",
  title: "chat",
  createdAt: "2026-01-01T00:00:00Z",
  participants: [...new Set(messages.map(([p]) => p))].map((p) => ({ personId: p, name: p })),
  messages: messages.map(([personId, body], i): Message => ({ id: i + 1, personId, authorName: personId, sentAt: `2026-01-01T00:0${i}:00Z`, body })),
});
const experts = async (q: string, viewer: Person) => {
  const r = await whoKnowsFor(q, viewer);
  if (!("experts" in r)) throw new Error("expected an answer");
  return r;
};

describe("finding questions and answers", () => {
  test("the answer is the next reply by another colleague that says something", () => {
    const [x] = findExchanges(chat(["jonas", "Which absence code do we use for a relapse?"], ["lotte", "Let me check and come back to you."], ["lotte", "Use code S2 for a relapse within 14 days."], ["jonas", "Thanks!"]), []);
    expect(x).toMatchObject({ askerId: "jonas", answererId: "lotte", questionText: "Which absence code do we use for a relapse?", answerLines: ["Use code S2 for a relapse within 14 days."] });
    expect(x.answers.map((m) => m.id)).toEqual([3]);
  });

  test("a question back isn't an answer; a new question from the asker starts over", () => {
    expect(findExchanges(chat(["jonas", "How long do we keep payslips?"], ["lotte", "For which country?"]), [])).toEqual([]);
    const found = findExchanges(chat(["jonas", "How long do we keep payslips?"], ["jonas", "And timesheets, how long for those?"], ["lotte", "Timesheets are kept for five years after the end of the year."]), []);
    expect(found.map((x) => x.question.id)).toEqual([2]);
  });

  test("health information, personal data and colleagues by name are never kept", () => {
    const people = [{ id: "karim", name: "Karim El Amrani" }] as Person[];
    const skipped = (c: Conversation) => findExchanges(c, people)[0].skipped;
    expect(skipped(chat(["jonas", "Does a doctor's medical certificate cover the first day?"], ["lotte", "Only from the third sick day in companies with 50 or more employees."]))).toBe("personal data or health information");
    expect(skipped(chat(["jonas", "What's the salary of Karim El Amrani again?"], ["lotte", "It's in the salary register: €3,450 gross per month."]))).toBe("about a colleague by name");
  });

  test("only conversations among colleagues", () => {
    expect(isInternal(chat(["jonas", "?"], ["lotte", "!"]))).toBe(true);
    expect(isInternal({ ...chat(["jonas", "?"], ["lotte", "!"]), clientId: "noordkaai" })).toBe(false);
    expect(isInternal({ ...chat(["jonas", "?"]), participants: [{ personId: "jonas", name: "Jonas" }, { name: "Els", email: "els@noordkaai.example" }] })).toBe(false);
  });
});

describe("capturing answers", () => {
  test("keeps the answers in the demo chats, not the private one or the one about a colleague", async () => {
    await captureAnswers();
    const answers = await loadAnswers();
    expect(answers.map((a) => a.conversationId).sort()).toEqual(["conv-qa-overtime-hours", "conv-qa-overtime-parttime", "conv-qa-overtime-recovery", "conv-qa-vakantiegeld"]);
    expect(answers.find((a) => a.conversationId === "conv-qa-vakantiegeld")).toMatchObject({ askerId: "emma", answererId: "lars", topics: ["holiday-pay", "compensation"], locations: ["Netherlands"], method: "rules" });
    // Nothing new: a second run adds nothing.
    await captureAnswers();
    expect(await loadAnswers()).toHaveLength(4);
  });

  test("an answer that contradicts a document is flagged there, and its owner is told", async () => {
    const hours = (await loadAnswers()).find((a) => a.conversationId === "conv-qa-overtime-hours")!;
    expect(hours.conflict).toMatchObject({ docId: "overtime-be", severity: "hard", lineText: expect.stringContaining("max 100 hours"), answerLine: "Voluntary overtime is max 120 hours per calendar year now." });
    const [n] = (await listNotifications("marc")).items;
    expect(n).toMatchObject({ kind: "answer", actorId: "lotte", docId: "overtime-be", otherDocId: "conv-qa-overtime-hours", reason: hours.question });

    const world = await loadWorld();
    const doubt = lineDoubts(world, world.docs.find((d) => d.id === "overtime-be")!, Date.now(), [hours]).find((d) => d.kind === "answer")!;
    expect(doubt).toMatchObject({ tone: "bad", chat: { conversationId: "conv-qa-overtime-hours", messageId: hours.answerMessageId } });
    expect((await docDetail("overtime-be", jonas))!.answers[0]).toMatchObject({ id: hours.id, conflict: { docId: "overtime-be" } });
  });

  test("a new question and answer sent in TrustDrive is kept, and found by the next person who asks", async () => {
    const { conversationId } = await sendMessage(jonas, { source: "teams", to: [{ personId: "wout", name: "" }], body: "How do we reset a clocking terminal that shows error E42?" });
    await sendMessage((await findPerson({ id: "wout" }))!, { conversationId, source: "teams", to: [], body: "Hold the reset button for 10 seconds until the screen restarts, then sync the badges again." });
    await captureAnswers();
    const kept = (await loadAnswers()).find((a) => a.conversationId === conversationId)!;
    expect(kept).toMatchObject({ askerId: "jonas", answererId: "wout", topics: expect.arrayContaining(["clocking"]) });

    const r = await experts("clocking terminal error", karim);
    expect(r.answers.map((a) => a.id)).toContain(kept.id);
    const wout = r.experts.find((e) => e.personId === "wout")!;
    expect(wout.answers).toBe(1);
    const profile = (await personProfile("wout", karim))!;
    expect(profile.answers.map((a) => a.id)).toContain(kept.id);
    expect(profile.topics.find((t) => t.key === "topic:clocking")!.answers).toBe(1);
    // Asking says nothing about what someone knows.
    expect(r.experts.map((e) => e.personId)).not.toContain("jonas");
    expect((await personProfile("jonas", karim))!.topics.map((t) => t.key)).not.toContain("topic:clocking");
  });

  test("answering questions puts someone forward: Lotte now knows Belgian overtime", async () => {
    const r = await experts("overtime in Belgium", jonas);
    expect(r.experts[0]).toMatchObject({ personId: "lotte", answers: 3 });
    expect(r.answers.length).toBeGreaterThanOrEqual(3);
    expect((await personProfile("lotte", jonas))!.stats.answeredLastYear).toBe(3);
  });
});

describe("don't keep for others", () => {
  test("a message sent as private is never kept", async () => {
    const { conversationId } = await sendMessage(karim, { source: "teams", to: [{ personId: "inge", name: "" }], body: "Which form do I need to change my bank account for my own payslip?", keepPrivate: true });
    await sendMessage((await findPerson({ id: "inge" }))!, { conversationId, source: "teams", to: [], body: "Use the personal data form in the HR portal, it takes effect next month." });
    await captureAnswers();
    expect((await loadConversations([conversationId]))[0].keepPrivate).toBe(true);
    expect((await loadAnswers()).some((a) => a.conversationId === conversationId)).toBe(false);
  });

  test("making a conversation private removes its answers; sharing it again brings them back", async () => {
    await setConversationPrivate("conv-qa-vakantiegeld", true);
    expect((await loadAnswers()).some((a) => a.conversationId === "conv-qa-vakantiegeld")).toBe(false);
    await captureAnswers();
    expect((await loadAnswers()).some((a) => a.conversationId === "conv-qa-vakantiegeld")).toBe(false);
    await setConversationPrivate("conv-qa-vakantiegeld", false);
    await captureAnswers();
    expect((await loadAnswers()).some((a) => a.conversationId === "conv-qa-vakantiegeld")).toBe(true);
  });
});

describe("writing answers up as an FAQ", () => {
  test("three answers on a topic are offered as an FAQ, with the answers quoted and linked", async () => {
    const [world, answers] = await Promise.all([loadWorld(), loadAnswers()]);
    expect(faqSuggestions(world, answers, "lotte")).toEqual([{ topic: "overtime", label: "Overtime", answerIds: expect.any(Array), askers: 3 }]);
    expect(faqSuggestions(world, answers, "lars")).toEqual([]);

    const draft = (await faqDraft("overtime", lotte))!;
    expect(draft.answers).toHaveLength(3);
    const md = composeFaqMarkdown("Overtime – questions & answers", draft.answers, "Lotte Peeters", (id) => id);
    expect(md).toContain("**Q: Within which period does recovery time for overtime have to be granted?**");
    expect(md).toMatch(/A: Recovery time has to be granted within the reference period of 3 months\..*\(\[chat\]\(\/conversations\?c=conv-qa-overtime-recovery&m=\d+&q=/);
  });

  test("written up or dismissed, the suggestion goes away", async () => {
    const world = await loadWorld();
    const ids = (await faqDraft("overtime", lotte))!.answers.map((a) => a.id);
    await markAnswersInFaq([ids[0]], "lotte", "overtime-be");
    expect(faqSuggestions(world, await loadAnswers(), "lotte")).toEqual([]);
    // Only the person who answered can mark their answers.
    await markAnswersInFaq([ids[1]], "jonas", "overtime-be");
    expect((await loadAnswers()).find((a) => a.id === ids[1])!.faqDocId).toBeUndefined();
    expect(await dismissFaqSuggestion("overtime", lotte)).toEqual({ dismissed: 2 });
  });
});

describe("contradictions stay current", () => {
  test("once the document is fixed, the answer no longer shows as contradicting it", async () => {
    const world = await loadWorld();
    const doc = world.docs.find((d) => d.id === "overtime-be")!;
    await updateDocument(doc.id, "marc", { content: doc.content.replace("max 100 hours per calendar year (2021 regime – temporary increase to 220 hours has ended)", "max 120 hours per calendar year") });
    const detail = (await docDetail("overtime-be", jonas))!;
    expect(detail.doubts.some((d) => d.kind === "answer")).toBe(false);
    expect(detail.answers.every((a) => !a.conflict)).toBe(true);
  });
});
