import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { captureAnswers, decideSharing, faqSuggestions, findExchanges, setSharingPreference, sharedOnly, viewOf } from "./answers";
import { composeFaqMarkdown, isInternal } from "./answerDoc";
import { askNextWhenUnanswered, askQuestion, boardList, boardThread, markSolved, reply } from "./board";
import { closeDb, findPerson, listNotifications, loadAnswers, loadBoard, loadConversations, loadWorld, markAnswersInFaq, migrateAndSeed, setConversationPrivate, updateDocument } from "./db";
import { lineDoubts } from "./doubts";
import { sendMessage } from "./messaging";
import { dismissFaqSuggestion, docDetail, faqDraft, personProfile, whoKnowsFor } from "./service";
import type { Conversation, Message, Person } from "./types";

// In-memory Postgres (vitest.config.ts), migrated and seeded with the demo company. Jev is off, so the rules decide.
let jonas: Person;
let lotte: Person;
let karim: Person;
let wout: Person;
let emma: Person;
beforeAll(async () => {
  await migrateAndSeed();
  [jonas, lotte, karim, wout, emma] = await Promise.all(["jonas", "lotte", "karim", "wout", "emma"].map(async (id) => (await findPerson({ id }))!));
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
    const answers = (await loadAnswers()).filter((a) => a.source !== "board");
    expect(answers.map((a) => a.conversationId).sort()).toEqual(["conv-qa-overtime-hours", "conv-qa-overtime-parttime", "conv-qa-overtime-recovery", "conv-qa-vakantiegeld", "conv-remote-work-check"]);
    // Julia left: her answer is kept private, waiting for a consent that won't come, so it's never shown or used.
    expect(answers.find((a) => a.conversationId === "conv-remote-work-check")).toMatchObject({ answererId: "julia", sharing: "pending" });
    expect(answers.find((a) => a.conversationId === "conv-qa-vakantiegeld")).toMatchObject({ askerId: "emma", answererId: "lars", topics: ["holiday-pay", "compensation"], locations: ["Netherlands"], method: "rules" });
    // Nothing new: a second run adds nothing.
    await captureAnswers();
    expect((await loadAnswers()).filter((a) => a.source !== "board")).toHaveLength(5);
  });

  test("the person who answered decides: Lotte always shares, Lars is asked first", async () => {
    const answers = await loadAnswers();
    expect(answers.filter((a) => a.answererId === "lotte").every((a) => a.sharing === "shared")).toBe(true);
    const lars = answers.find((a) => a.answererId === "lars")!;
    expect(lars.sharing).toBe("pending");
    // Asked quietly, in the bell; until then nobody else sees it.
    expect((await listNotifications("lars")).items[0]).toMatchObject({ kind: "share", otherDocId: String(lars.id) });
    expect((await experts("vakantiegeld", emma)).answers.map((a) => a.id)).not.toContain(lars.id);
    await decideSharing((await findPerson({ id: "lars" }))!, [lars.id], true);
    expect((await experts("vakantiegeld", emma)).answers.map((a) => a.id)).toContain(lars.id);
  });

  test("an answer that contradicts a document is flagged there, and its owner is told", async () => {
    const hours = (await loadAnswers()).find((a) => a.conversationId === "conv-qa-overtime-hours")!;
    expect(hours.conflict).toMatchObject({ docId: "overtime-be", severity: "hard", lineText: expect.stringContaining("max 100 hours"), answerLine: "Voluntary overtime is max 120 hours per calendar year now." });
    const [n] = (await listNotifications("marc")).items;
    expect(n).toMatchObject({ kind: "answer", actorId: "lotte", docId: "overtime-be", otherDocId: String(hours.id), reason: hours.question });

    // Marc isn't on that chat: he reads the answer on its own page, without who asked.
    const world = await loadWorld();
    const marc = (await findPerson({ id: "marc" }))!;
    const doubt = lineDoubts(world, world.docs.find((d) => d.id === "overtime-be")!, Date.now(), [viewOf(hours, marc)]).find((d) => d.kind === "answer")!;
    expect(doubt).toMatchObject({ tone: "bad", answer: { href: `/board/answers/${hours.id}` } });
    expect(doubt.text).toMatch(/^Lotte Peeters answered a colleague differently in chat/);
    expect((await docDetail("overtime-be", jonas))!.answers[0]).toMatchObject({ id: hours.id, conflict: { docId: "overtime-be" } });
  });

  test("a new question and answer sent in TrustDrive is kept, shared once the answerer agrees, and found by the next person", async () => {
    const { conversationId } = await sendMessage(jonas, { source: "teams", to: [{ personId: "wout", name: "" }], body: "How do we reset a clocking terminal that shows error E42?" });
    await sendMessage(wout, { conversationId, source: "teams", to: [], body: "Hold the reset button for 10 seconds until the screen restarts, then sync the badges again." });
    await captureAnswers();
    const kept = (await loadAnswers()).find((a) => a.conversationId === conversationId)!;
    expect(kept).toMatchObject({ askerId: "jonas", answererId: "wout", sharing: "pending", topics: expect.arrayContaining(["clocking"]) });
    expect((await experts("clocking terminal error", karim)).answers.map((a) => a.id)).not.toContain(kept.id);
    await decideSharing(wout, [kept.id], true);

    const r = await experts("clocking terminal error", karim);
    const seen = r.answers.find((a) => a.id === kept.id)!;
    // Karim isn't on the chat: no asker, no chat title (their names), no way into the chat.
    expect(seen).toMatchObject({ askerId: undefined, conversationTitle: "a Teams chat", canOpen: false, href: `/board/answers/${kept.id}` });
    expect(viewOf(kept, jonas)).toMatchObject({ askerId: "jonas", canOpen: true, href: expect.stringContaining(`/conversations?c=${conversationId}`) });
    const asExpert = r.experts.find((e) => e.personId === "wout")!;
    expect(asExpert.answers).toBe(1);
    const profile = (await personProfile("wout", karim))!;
    expect(profile.answers.map((a) => a.id)).toContain(kept.id);
    expect(profile.topics.find((t) => t.key === "topic:clocking")!.answers).toBe(1);
    // Asking says nothing about what someone knows.
    expect(r.experts.map((e) => e.personId)).not.toContain("jonas");
    expect((await personProfile("jonas", karim))!.topics.map((t) => t.key)).not.toContain("topic:clocking");
  });

  test("keeping an answer private deletes it; never keeping means it isn't stored at all", async () => {
    const { conversationId } = await sendMessage(jonas, { source: "teams", to: [{ personId: "tom", name: "" }], body: "How long do we keep payslips for employees who left?" });
    const tom = (await findPerson({ id: "tom" }))!;
    await sendMessage(tom, { conversationId, source: "teams", to: [], body: "Payslips are kept for five years after the employee leaves." });
    await captureAnswers();
    const pending = (await loadAnswers()).find((a) => a.conversationId === conversationId)!;
    await decideSharing(tom, [pending.id], false);
    expect((await loadAnswers()).some((a) => a.conversationId === conversationId)).toBe(false);

    await setSharingPreference(tom, "never");
    await sendMessage(jonas, { conversationId, source: "teams", to: [], body: "And timesheets, how long do we keep those?" });
    await sendMessage((await findPerson({ id: "tom" }))!, { conversationId, source: "teams", to: [], body: "Timesheets are kept for five years as well." });
    await captureAnswers();
    expect((await loadAnswers()).some((a) => a.conversationId === conversationId)).toBe(false);
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
    const md = composeFaqMarkdown("Overtime – questions & answers", draft.answers, "Lotte Peeters");
    expect(md).toContain("**Q: Within which period does recovery time for overtime have to be granted?**");
    // A shared document links to the answer's own page, never into the private chat.
    expect(md).toMatch(/A: Recovery time has to be granted within the reference period of 3 months\..*\(\[source\]\(\/board\/answers\/\d+ /);
    expect(md).not.toContain("/conversations");
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

describe("the message board", () => {
  test("seeded: a solved question counts more for whoever solved it", async () => {
    await captureAnswers();
    const solved = (await loadAnswers()).find((a) => a.conversationId === "board-absence-relapse")!;
    expect(solved).toMatchObject({ source: "board", answererId: "wout", askerId: "sofie", sharing: "shared", confirmed: true });
    const view = viewOf(solved, karim);
    expect(view).toMatchObject({ askerId: "sofie", canOpen: true, href: `/board/board-absence-relapse#m${solved.answerMessageId}` });
  });

  test("a question nobody answered for two days goes to the next people who know", async () => {
    await askNextWhenUnanswered();
    const [t] = await loadBoard(["board-parttime-bonus"]);
    expect(t.askedIds[0]).toBe("karim");
    expect(t.askedIds.length).toBeGreaterThan(1);
    const next = t.askedIds[1];
    expect((await listNotifications(next)).items[0]).toMatchObject({ kind: "question", actorId: "jonas", docId: "board-parttime-bonus", reason: expect.stringMatching(/^Nobody has answered yet\./) });
    // Asked again later, not on every visit.
    await askNextWhenUnanswered();
    expect((await loadBoard(["board-parttime-bonus"]))[0].askedIds).toEqual(t.askedIds);
  });

  test("ask, get routed to who knows, answer, mark it solved", async () => {
    // Marc fixed the overtime policy in an earlier test, so he's up to date again and asked too.
    const { id, asked } = await askQuestion(emma, { title: "How is overtime on Sundays paid for part-timers in Belgium?" });
    expect(asked).toContain("lotte");
    expect(asked.length).toBeLessThanOrEqual(3);
    expect((await listNotifications("lotte")).items[0]).toMatchObject({ kind: "question", actorId: "emma", docId: id });

    await reply(lotte, id, "Part-timers get the same overtime premium: +100% on Sundays and public holidays.");
    expect((await listNotifications("emma")).items[0]).toMatchObject({ kind: "board_answer", actorId: "lotte", docId: id });
    await captureAnswers();
    const answer = (await loadAnswers()).find((a) => a.conversationId === id)!;
    expect(answer).toMatchObject({ source: "board", sharing: "shared", confirmed: false, answererId: "lotte" });

    await expect(markSolved(karim, id, answer.answerMessageId)).rejects.toMatchObject({ status: 403 });
    await markSolved(emma, id, answer.answerMessageId);
    expect((await loadAnswers()).find((a) => a.id === answer.id)!.confirmed).toBe(true);
    const lotteOvertime = (await personProfile("lotte", karim))!.topics.find((t) => t.key === "topic:overtime")!;
    expect(lotteOvertime.evidence.some((e) => e.action === "Solved a question on the board:" && e.answer?.href.startsWith(`/board/${id}`))).toBe(true);

    const thread = (await boardThread(id, karim))!;
    expect(thread.thread.solvedMessageId).toBe(answer.answerMessageId);
    expect(thread.related!.answers.every((a) => a.conversationId !== id)).toBe(true);
  });

  test("the board lists its questions and the answers shared from chats", async () => {
    const { questions, fromChats } = await boardList(jonas);
    expect(questions.map((q) => q.id)).toEqual(expect.arrayContaining(["board-absence-relapse", "board-vakantiegeld-13th", "board-parttime-bonus"]));
    expect(questions.find((q) => q.id === "board-absence-relapse")).toMatchObject({ solved: true, answers: 1 });
    expect(fromChats.length).toBe(sharedOnly(await loadAnswers()).filter((a) => a.source !== "board").length);
    expect(fromChats.every((a) => a.source !== "board")).toBe(true);
    // Board threads aren't mail or chats.
    expect((await loadConversations()).some((c) => c.id.startsWith("board-"))).toBe(false);
  });
});

describe("folders on the profile", () => {
  test("where someone works, and (separately) where they read a lot", async () => {
    expect((await personProfile("lotte", jonas))!.worksIn.length).toBeGreaterThan(0);
    const nina = (await personProfile("nina", jonas))!;
    expect(nina.oftenOpens).toContainEqual({ id: "f-payroll", label: "Payroll", opens: 3 });
  });
});
