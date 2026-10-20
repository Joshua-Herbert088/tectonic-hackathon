import { describe, expect, test } from "vitest";
import { matchAuthors, parseEmailChain, parseEml, parseLooseDate, parseTeamsChat } from "./conversationImport";
import { buildSeed } from "./seed";

const me = { authorName: "Jonas Maes", authorEmail: "jonas.maes@trustdrive.example", sentAt: "2026-10-18T10:00:00.000Z" };

describe("dates", () => {
  test.each([
    ["Monday, 3 March 2025 10:12", [2025, 2, 3]],
    ["maandag 3 maart 2025 10:12", [2025, 2, 3]],
    ["lundi 3 mars 2025 à 10:12", [2025, 2, 3]],
    ["03/03/2025 10:12", [2025, 2, 3]],
  ])("%s", (s, [y, m, d]) => {
    const date = parseLooseDate(s)!;
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([y, m, d]);
  });
});

describe("pasted email chains", () => {
  test("Outlook chain, newest first, with an unheaded reply on top", () => {
    const text = `Thanks, I'll plan it.

From: Els Vermeiren <els.vermeiren@noordkaai.example>
Sent: Tuesday, 4 March 2025 09:00
To: Jonas Maes
Subject: RE: July run

Great, 15 July works.

From: Jonas Maes <jonas.maes@trustdrive.example>
Sent: Monday, 3 March 2025 16:30
Subject: July run

Shall we do the extra run on 15 July?`;
    const msgs = parseEmailChain(text, me);
    expect(msgs.map((m) => [m.authorName, m.body])).toEqual([
      ["Jonas Maes", "Shall we do the extra run on 15 July?"],
      ["Els Vermeiren", "Great, 15 July works."],
      ["Jonas Maes", "Thanks, I'll plan it."],
    ]);
    expect(msgs[1].authorEmail).toBe("els.vermeiren@noordkaai.example");
  });
  test("Dutch headers", () => {
    const msgs = parseEmailChain("Van: Marloes Vink <marloes.vink@havenstaal.example>\nVerzonden: dinsdag 4 maart 2025 09:00\nAan: Lars\nOnderwerp: Vakantiegeld\n\nGraag in twee delen.", me);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ authorName: "Marloes Vink", body: "Graag in twee delen." });
    expect(new Date(msgs[0].sentAt).getMonth()).toBe(2);
  });
  test("Gmail quote line", () => {
    const msgs = parseEmailChain("Confirmed.\n\nOn Mon, 3 Mar 2025 at 16:30, Els Vermeiren <els@noordkaai.example> wrote:\n> Can you confirm?", me);
    expect(msgs.map((m) => m.authorName)).toEqual(["Els Vermeiren", "Jonas Maes"]);
    expect(msgs[0].body).toBe("Can you confirm?");
  });
  test("no headers: one message from whoever pasted it", () => {
    expect(parseEmailChain("Just a note about Noordkaai.", me)).toEqual([{ authorName: "Jonas Maes", authorEmail: me.authorEmail, sentAt: me.sentAt, body: "Just a note about Noordkaai." }]);
  });
});

describe("Teams chats", () => {
  test("copied from the app", () => {
    const msgs = parseTeamsChat("Sofie Willems 14:02\nWho handles Noordkaai now?\nAnyone?\nLotte Peeters 14:05\nI do.", me);
    expect(msgs.map((m) => [m.authorName, m.body])).toEqual([
      ["Sofie Willems", "Who handles Noordkaai now?\nAnyone?"],
      ["Lotte Peeters", "I do."],
    ]);
  });
  test("exported lines", () => {
    const msgs = parseTeamsChat("[12/03/2026 14:02] Sofie Willems: Who handles Noordkaai now?\n[12/03/2026 14:05] Lotte Peeters: I do.", me);
    expect(msgs.map((m) => m.authorName)).toEqual(["Sofie Willems", "Lotte Peeters"]);
    expect(new Date(msgs[0].sentAt).getFullYear()).toBe(2026);
  });
});

test(".eml with a quoted-printable body and an encoded subject", () => {
  const raw = [
    "From: =?utf-8?Q?Els_Vermeiren?= <els.vermeiren@noordkaai.example>",
    "Date: Tue, 4 Mar 2025 09:00:00 +0100",
    "Subject: RE: =?utf-8?Q?Kilometervergoeding_=E2=82=AC0.45?=",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "We keep =E2=82=AC0.45/km for our drivers.",
  ].join("\r\n");
  const eml = parseEml(raw);
  expect(eml.subject).toBe("Kilometervergoeding €0.45");
  expect(eml.messages).toHaveLength(1);
  expect(eml.messages[0]).toMatchObject({ authorName: "Els Vermeiren", body: "We keep €0.45/km for our drivers." });
});

test("colleagues are recognised by address or name; clients stay external", () => {
  const { people } = buildSeed();
  const msgs = matchAuthors(
    [
      { authorName: "S. Willems", authorEmail: "sofie.willems@trustdrive.example", sentAt: me.sentAt, body: "a" },
      { authorName: "lotte peeters", sentAt: me.sentAt, body: "b" },
      { authorName: "Els Vermeiren", authorEmail: "els.vermeiren@noordkaai.example", sentAt: me.sentAt, body: "c" },
    ],
    people,
  );
  expect(msgs.map((m) => m.personId)).toEqual(["sofie", "lotte", undefined]);
});
