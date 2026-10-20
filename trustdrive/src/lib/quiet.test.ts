import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, migrateAndSeed, recordOpen } from "./db";
import { lastLook, quietNotice } from "./quiet";
import { buildSeed } from "./seed";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
const world = buildSeed(NOW);

describe("quiet documents", () => {
  test("a document nobody opened, edited or verified in two years gets the notice", () => {
    const n = quietNotice(world.docs.find((d) => d.id === "teletravail-fr")!, null, NOW)!;
    expect(n.days).toBeGreaterThanOrEqual(365);
    expect(n).toMatchObject({ kind: "edited", personId: expect.any(String) });
  });

  test("any recent look clears it: an open, an edit or a verification", () => {
    const base = { updatedAt: ago(800), lastEditedById: "lotte", verifications: [], views: [] };
    expect(quietNotice(base, null, NOW)).toMatchObject({ kind: "edited", days: 800 });
    expect(quietNotice(base, { at: ago(10), personId: "jonas" }, NOW)).toBeNull();
    expect(quietNotice({ ...base, verifications: [{ personId: "tom", at: ago(5) }] }, null, NOW)).toBeNull();
    expect(quietNotice({ ...base, views: [{ personId: "an", at: ago(30) }] }, null, NOW)).toBeNull();
  });

  test("the latest look is reported with who and how", () => {
    expect(lastLook({ updatedAt: ago(900), lastEditedById: "lotte", verifications: [{ personId: "tom", at: ago(500) }], views: [] }, { at: ago(400), personId: "an" })).toMatchObject({ kind: "opened", personId: "an", at: ago(400) });
  });

  test("most demo documents are not quiet", () => {
    const quiet = world.docs.filter((d) => quietNotice(d, null, NOW));
    expect(quiet.length).toBeGreaterThan(0);
    expect(quiet.length).toBeLessThan(world.docs.length / 4);
  });
});

describe("recording opens", () => {
  beforeAll(async () => {
    await migrateAndSeed();
  }, 60_000);
  afterAll(async () => {
    await closeDb();
  });

  test("returns the open before this visit, and keeps it when the same person reloads", async () => {
    const t = Date.now();
    expect(await recordOpen("teletravail-fr", "camille", t)).toBeNull();
    // Camille reloads: still no earlier open.
    expect(await recordOpen("teletravail-fr", "camille", t + 60_000)).toBeNull();
    // Léa opens it later: she sees Camille's open.
    expect(await recordOpen("teletravail-fr", "lea", t + 3_600_000)).toMatchObject({ personId: "camille" });
    // Léa reloads: same answer, not her own open a second ago.
    expect(await recordOpen("teletravail-fr", "lea", t + 3_700_000)).toMatchObject({ personId: "camille" });
    // The next day, Camille again: she sees Léa's.
    expect(await recordOpen("teletravail-fr", "camille", t + 30 * 3_600_000)).toMatchObject({ personId: "lea" });
  });
});
