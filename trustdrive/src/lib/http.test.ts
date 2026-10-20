import { describe, expect, test } from "vitest";
import { z } from "zod";
import { handle, HttpError, readBody } from "./http";

const post = (body: string) => new Request("http://x/api", { method: "POST", body });

describe("route wrapper", () => {
  const route = handle(async (req: Request) => Response.json(await readBody(req, z.object({ n: z.number() }))));

  test("valid input passes through", async () => {
    const res = await route(post('{"n":1}'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ n: 1 });
  });
  test("malformed JSON is a 400, not a crash", async () => {
    expect((await route(post("{nope"))).status).toBe(400);
  });
  test("invalid input is a 400 that says what's wrong", async () => {
    const res = await route(post('{"n":"one"}'));
    expect(res.status).toBe(400);
    expect((await res.json()).issues[0]).toMatch(/^n:/);
  });
  test("an oversized body is a 413, whether or not its size is declared", async () => {
    const big = JSON.stringify({ n: 1, pad: "x".repeat(2_100_000) });
    expect((await route(post(big))).status).toBe(413);
    const undeclared = new Request("http://x/api", { method: "POST", body: new Blob([big]).stream(), duplex: "half" } as RequestInit);
    expect(undeclared.headers.get("content-length")).toBeNull();
    expect((await route(undeclared)).status).toBe(413);
    const small = handle(async (req: Request) => Response.json(await readBody(req, z.object({ n: z.number() }), 10)));
    expect((await small(post('{"n":1, "more": true}'))).status).toBe(413);
  });
  test("HttpErrors keep their status; anything else is a 500 without internals", async () => {
    expect((await handle(async () => { throw new HttpError(404, "Not found"); })(post("{}"))).status).toBe(404);
    const res = await handle(async () => { throw new Error("secret detail"); })(post("{}"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
