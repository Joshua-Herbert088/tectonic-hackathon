import { describe, expect, it } from "vitest";
import { codeMatches, createSession, readSession, SESSION_DAYS } from "./session";

const CODE = "correct horse battery";

describe("session cookie", () => {
  it("reads back who it was made for", () => {
    expect(readSession(CODE, createSession(CODE, "lotte"))).toMatchObject({ viewerId: "lotte", sessionId: expect.any(String) });
    // Switching who you view as keeps the session.
    expect(readSession(CODE, createSession(CODE, "jonas", Date.now(), "abc"))).toEqual({ viewerId: "jonas", sessionId: "abc" });
  });

  it("is refused when missing, malformed, edited or signed with another code", () => {
    const token = createSession(CODE, "jonas");
    const [, sig] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ v: "lotte", exp: Date.now() + 86_400_000 })).toString("base64url")}.${sig}`;
    for (const t of [undefined, "", "jonas", `${token}.x`, `${token}x`, forged]) expect(readSession(CODE, t)).toBeNull();
    expect(readSession("another access code", token)).toBeNull();
  });

  it("expires", () => {
    const now = Date.now();
    const token = createSession(CODE, "jonas", now);
    expect(readSession(CODE, token, now + (SESSION_DAYS - 1) * 86_400_000)).not.toBeNull();
    expect(readSession(CODE, token, now + SESSION_DAYS * 86_400_000)).toBeNull();
  });
});

describe("access code", () => {
  it("only matches exactly", () => {
    expect(codeMatches(CODE, CODE)).toBe(true);
    for (const attempt of ["", "correct horse", `${CODE} `, CODE.toUpperCase()]) expect(codeMatches(CODE, attempt)).toBe(false);
  });
});
