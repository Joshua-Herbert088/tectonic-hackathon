import { describe, expect, test } from "vitest";
import { extractFacts } from "./conflicts";
import { citationHref, composeHandoverMarkdown } from "./handoverDoc";
import { buildHandoverDraft, redact, ruleKind, statementsOf } from "./handoverDraft";
import { buildConversations, buildSeed } from "./seed";
import type { Conversation } from "./types";

// Jev is disabled in tests, so this is the rule-based path.
const db = buildSeed();
let id = 0;
const conversations: Conversation[] = buildConversations().map((c) => ({ ...c, messages: c.messages.map((m) => ({ ...m, id: ++id })) }));
const noordkaai = conversations.filter((c) => c.clientId === "noordkaai");

describe("statements", () => {
  test("greeting, sign-off and signature are not statements; the signature is kept for the role", () => {
    const { statements, signature } = statementsOf("Hello Pieter,\n\nOur agreement gives drivers €0.45/km. Can you keep it?\n\nKind regards,\nEls Vermeiren\nHR Manager, Noordkaai Logistics");
    expect(statements).toEqual(["Our agreement gives drivers €0.45/km.", "Can you keep it?"]);
    expect(signature).toEqual(["Els Vermeiren", "HR Manager, Noordkaai Logistics"]);
  });
  test("quoted replies are cut off", () => {
    expect(statementsOf("Confirmed for next month.\n\nOn Mon, 3 Mar 2025, Els wrote:\n> Can you plan it?").statements).toEqual(["Confirmed for next month."]);
  });
});

describe("rule kinds in four languages", () => {
  test.each([
    ["Agreed: an extra payroll run on 15 July every year for the summer bonus.", "agreement"],
    ["Afgesproken: vakantiegeld 50% in mei en 50% in december, vanaf 2026.", "agreement"],
    ["Could you send it before 15 December?", "open"],
    ["Kunnen jullie dat zo inplannen?", "open"],
    ["We'll include the correction in the October payroll run.", "open"],
    ["Bart Mertens, their payroll administrator (bart.mertens@noordkaai.example).", "contact"],
    ["Perfect, thank you!", "noise"],
  ])("%s → %s", (text, kind) => expect(ruleKind(text)).toBe(kind));
});

test("personal data is removed and left out by default", () => {
  const r = redact("Kevin Janssens (national register number 85.07.30-033.61) – pay €212.40 to BE71 0961 2345 6769.");
  expect(r.text).toBe("Kevin Janssens (national register number [national number removed]) – pay €212.40 to [bank account removed].");
  expect(r.redactions).toEqual(["bank account", "national number"]);
  expect(r.sensitive).toBeTruthy();
});

describe("citations", () => {
  test("every quoted line links to the message it came from, with the quote's start", async () => {
    const draft = await buildHandoverDraft(db, noordkaai, "noordkaai", { rulesOnly: true });
    const included = new Set(draft.items.filter((i) => i.include).map((i) => i.key));
    const md = composeHandoverMarkdown(draft, "Handover", included, (pid) => pid);
    const item = draft.items.find((i) => i.text.includes("€0.45/km for Noordkaai drivers"))!;
    const line = md.split("\n").find((l) => l.includes("€0.45/km for Noordkaai drivers"))!;
    expect(line).toContain(`(/conversations?c=conv-noordkaai-mileage&m=${item.messageId}&q=Confirmed%3A%20we%20keep`);
    expect(line).toMatch(/"Email “Mileage rate for our drivers” – Pieter Wouters, \d+ \w+ \d{4}"\)\)$/);
    // Every included quote is cited.
    for (const i of draft.items.filter((x) => included.has(x.key))) expect(md).toContain(`&m=${i.messageId}`);
  });
  test("parentheses in a quote can't end the link", () => {
    expect(citationHref("c1", 3, "A (draft) rule!")).toBe("/conversations?c=c1&m=3&q=A%20%28draft%29%20rule%21");
  });
  test("link addresses are never read as facts or years", () => {
    const cited = "- Mileage allowance: €0.45/km ([b](/conversations?c=conv-2019-x&m=2021&q=Mileage%202020 \"Email – 3 Mar 2025\"))";
    expect(extractFacts(cited)).toEqual(extractFacts("- Mileage allowance: €0.45/km (b)"));
  });
});

describe("Noordkaai handover draft (rules)", async () => {
  const draft = await buildHandoverDraft(db, noordkaai, "noordkaai", { rulesOnly: true });
  const find = (part: string) => draft.items.find((i) => i.text.includes(part));

  test("the mileage exception is an agreement that's already in the client file", () => {
    const item = find("€0.45/km for Noordkaai drivers")!;
    expect(item.kind).toBe("agreement");
    expect(item.documentedIn?.docId).toBe("client-noordkaai");
  });
  test("what the client file already says is recognised, in other words too", () => {
    expect(find("15 July every year")?.documentedIn?.docId).toBe("client-noordkaai");
    expect(find("overtime is paid out every month")?.documentedIn?.docId).toBe("client-noordkaai");
  });
  test("what only lives in the chats is new knowledge", () => {
    expect(find("Els prefers a phone call")?.documentedIn).toBeUndefined();
    expect(find("8 July at the latest")?.include).toBe(true);
  });
  test("an internal question answered in the next message is resolved; an accepted request is not", () => {
    expect(find("Who do I contact there")?.resolved?.authorName).toBe("Pieter Wouters");
    expect(find("Can you pick that up?")?.resolved).toBeUndefined();
  });
  test("the unanswered indexation request is open; the July request was answered", () => {
    expect(find("before 15 December")).toMatchObject({ kind: "open", include: true });
    expect(find("Could you plan an extra payroll run")?.resolved?.authorName).toBe("Pieter Wouters");
  });
  test("client contacts come from senders and signatures", () => {
    expect(draft.contacts).toContainEqual({ name: "Els Vermeiren", email: "els.vermeiren@noordkaai.example", role: "HR Manager" });
  });
  test("the document cites every conversation and never contains the IBAN", () => {
    const md = composeHandoverMarkdown(draft, "Handover – Noordkaai Logistics", new Set(draft.items.map((i) => i.key)), (pid) => pid);
    expect(md).toContain("## Agreements with Noordkaai Logistics");
    expect(md).toContain("- e: [Email “2027 indexation simulation”](/conversations?c=conv-noordkaai-indexation");
    expect(md).not.toContain("BE71");
    expect(md).not.toContain("85.07.30");
  });
});
