import { describe, expect, test } from "vitest";
import { limitWrites, MAX_SAVES_PER_PERSON, rateLimit, withSaveSlot } from "./rateLimit";

const tooMany = expect.objectContaining({ status: 429 });

describe("rate limit", () => {
  test("allows up to the limit in a window, then 429 until the next window", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) rateLimit("test:a", 3, 60_000, t);
    expect(() => rateLimit("test:a", 3, 60_000, t + 1)).toThrow(tooMany);
    expect(() => rateLimit("test:b", 3, 60_000, t + 1)).not.toThrow();
    expect(() => rateLimit("test:a", 3, 60_000, t + 60_000)).not.toThrow();
  });

  test("a cost counts that much", () => {
    const t = 2_000_000;
    rateLimit("test:cost", 100, 60_000, t, 60);
    expect(() => rateLimit("test:cost", 100, 60_000, t, 50)).toThrow(tooMany);
    expect(() => rateLimit("test:cost", 100, 60_000, t, 40)).not.toThrow();
  });

  test("writes are limited per person and per session: switching who you view as doesn't reset it", () => {
    const t = 5_000_000;
    for (let i = 0; i < 30; i++) limitWrites(`viewer-${i}`, "session-1", 0, t);
    expect(() => limitWrites("viewer-31", "session-1", 0, t)).toThrow(tooMany);
    expect(() => limitWrites("someone-else", "session-2", 0, t)).not.toThrow();
  });

  test("characters written per hour are limited per session", () => {
    const t = 9_000_000;
    for (let i = 0; i < 25; i++) limitWrites(`writer-${i % 20}`, "session-big", 199_000, t + i * 61_000);
    expect(() => limitWrites("writer-x", "session-big", 199_000, t + 26 * 61_000)).toThrow(tooMany);
  });

  test("a person can't run more than a couple of saves at once", async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const running = Array.from({ length: MAX_SAVES_PER_PERSON }, () => withSaveSlot("busy", () => slow));
    await expect(withSaveSlot("busy", async () => "third")).rejects.toMatchObject({ status: 429 });
    await expect(withSaveSlot("someone-else", async () => "fine")).resolves.toBe("fine");
    release();
    await Promise.all(running);
    await expect(withSaveSlot("busy", async () => "after")).resolves.toBe("after");
  });
});
