import { describe, expect, test } from "vitest";
import { legalStamp } from "./legal";
import { buildSeed } from "./seed";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const world = buildSeed(NOW);
const doc = (id: string) => world.docs.find((d) => d.id === id)!;
const DAY = 86_400_000;

describe("Legal & Compliance badge", () => {
  test("a Legal document shows who in Legal validated it and when", () => {
    const s = legalStamp(doc("sar-procedure"), world.people, NOW)!;
    expect(s.fromLegal).toBe(true);
    expect(s.validation).toMatchObject({ personId: "tom", now: "legal", due: false });
  });

  test("a validation by someone who left, over a year ago, is shown as due", () => {
    const s = legalStamp(doc("gdpr-retention"), world.people, NOW)!;
    expect(s.validation).toMatchObject({ personId: "julia", now: "left", due: true });
  });

  test("another team's document validated by Legal gets the badge too; others don't", () => {
    expect(legalStamp(doc("remote-work"), world.people, NOW)).toMatchObject({ fromLegal: false, validation: { personId: "julia" } });
    expect(legalStamp(doc("overtime-be"), world.people, NOW)).toBeNull();
  });

  test("a Legal document nobody in Legal validated says so", () => {
    expect(legalStamp({ teamId: "legal", verifications: [{ personId: "lotte", at: new Date(NOW - DAY).toISOString() }] }, world.people, NOW)).toEqual({ fromLegal: true, validation: null });
  });

  test("a validation given in an email points at that message", () => {
    const source = { conversationId: "conv-remote-work-check", messageId: 17 };
    const verifications = [{ personId: "julia", at: new Date(NOW - 390 * DAY).toISOString(), source }];
    expect(legalStamp({ teamId: "hr-ops", verifications }, world.people, NOW)?.validation).toMatchObject({ personId: "julia", now: "left", due: true, source });
  });

  test("the latest Legal validation wins", () => {
    const verifications = [
      { personId: "julia", at: new Date(NOW - 400 * DAY).toISOString() },
      { personId: "tom", at: new Date(NOW - 3 * DAY).toISOString() },
      { personId: "lotte", at: new Date(NOW - DAY).toISOString() },
    ];
    expect(legalStamp({ teamId: "hr-ops", verifications }, world.people, NOW)?.validation).toMatchObject({ personId: "tom", days: 3 });
  });
});
