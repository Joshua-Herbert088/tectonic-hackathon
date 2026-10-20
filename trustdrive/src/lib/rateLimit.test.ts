import { describe, expect, test } from "vitest";
import { limitWrites, rateLimit } from "./rateLimit";

describe("rate limit", () => {
  test("allows up to the limit in a window, then 429 until the next window", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) rateLimit("test:a", 3, 60_000, t);
    expect(() => rateLimit("test:a", 3, 60_000, t + 1)).toThrow(expect.objectContaining({ status: 429 }));
    expect(() => rateLimit("test:b", 3, 60_000, t + 1)).not.toThrow();
    expect(() => rateLimit("test:a", 3, 60_000, t + 60_000)).not.toThrow();
  });

  test("writes are limited per person", () => {
    const t = 5_000_000;
    for (let i = 0; i < 30; i++) limitWrites("someone", t);
    expect(() => limitWrites("someone", t)).toThrow(expect.objectContaining({ status: 429 }));
    expect(() => limitWrites("someone-else", t)).not.toThrow();
  });
});
