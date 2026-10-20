import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { codeMatches, createSession, DEMO_USER, personalCode, personFromCode, readSession, SESSION_DAYS } from "./session";

const SECRET = "a server secret of at least thirty-two characters";

describe("session cookie", () => {
  it("reads back who signed in, who they view as and which sign-in it is", () => {
    expect(readSession(SECRET, createSession(SECRET, "lotte"))).toMatchObject({ userId: "lotte", viewerId: "lotte", sessionId: expect.any(String) });
    expect(readSession(SECRET, createSession(SECRET, "jonas", Date.now(), "abc", DEMO_USER))).toEqual({ userId: DEMO_USER, viewerId: "jonas", sessionId: "abc" });
  });

  it("is refused when missing, malformed, edited or signed with another secret", () => {
    const token = createSession(SECRET, "jonas");
    const [, sig] = token.split(".");
    // Claiming to be someone else, or a demo session, with a copied signature.
    const forge = (claims: object) => `${Buffer.from(JSON.stringify({ s: "x", exp: Date.now() + 86_400_000, ...claims })).toString("base64url")}.${sig}`;
    for (const t of [undefined, "", "jonas", `${token}.x`, `${token}x`, forge({ u: "lotte", v: "lotte" }), forge({ u: DEMO_USER, v: "an" })]) expect(readSession(SECRET, t)).toBeNull();
    expect(readSession("another secret of at least thirty-two characters", token)).toBeNull();
  });

  it("expires", () => {
    const now = Date.now();
    const token = createSession(SECRET, "jonas", now);
    expect(readSession(SECRET, token, now + (SESSION_DAYS - 1) * 86_400_000)).not.toBeNull();
    expect(readSession(SECRET, token, now + SESSION_DAYS * 86_400_000)).toBeNull();
  });
});

describe("personal sign-in codes", () => {
  it("say whose they are, and can't be made up or edited", () => {
    expect(personFromCode(SECRET, personalCode(SECRET, "lotte"))).toBe("lotte");
    const [, sig] = personalCode(SECRET, "lotte").split(".");
    for (const attempt of ["", "lotte", "lotte.", `jonas.${sig}`, `${personalCode(SECRET, "lotte")}x`, personalCode("another secret of at least thirty-two characters", "lotte")]) {
      expect(personFromCode(SECRET, attempt)).toBeNull();
    }
  });

  it("are the same as the script prints", () => {
    const out = execFileSync(process.execPath, [path.join(__dirname, "../../scripts/signin-code.mjs"), "jonas", "an"], { env: { ...process.env, TRUSTDRIVE_SECRET: SECRET } }).toString();
    expect(out.trim().split("\n")).toEqual([`jonas\t${personalCode(SECRET, "jonas")}`, `an\t${personalCode(SECRET, "an")}`]);
  });
});

describe("access code", () => {
  it("only matches exactly", () => {
    const CODE = "correct horse battery";
    expect(codeMatches(CODE, CODE)).toBe(true);
    for (const attempt of ["", "correct horse", `${CODE} `, CODE.toUpperCase()]) expect(codeMatches(CODE, attempt)).toBe(false);
  });
});
