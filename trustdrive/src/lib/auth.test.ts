import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// A stand-in for the request's cookies, so routes run as they would for a browser.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

const { config } = await import("./config");
const { createSession, DEMO_USER, SESSION_COOKIE } = await import("./session");
const { requireViewer } = await import("./auth");
const { closeDb, loadWorld, migrateAndSeed } = await import("./db");
const { gateDraft } = await import("./service");
const { proxy } = await import("../proxy");
const sessionRoute = await import("../app/api/session/route");
const docsRoute = await import("../app/api/docs/route");
const docRoute = await import("../app/api/docs/[id]/route");

const secret = config.secret!;
const signIn = (personId: string, userId = personId) => jar.set(SESSION_COOKIE, createSession(secret, personId, Date.now(), `test-${personId}`, userId));
const req = (url: string, init?: RequestInit) => new Request(`http://localhost${url}`, init);
const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

beforeAll(async () => {
  await migrateAndSeed();
}, 60_000);
afterAll(async () => {
  await closeDb();
});
beforeEach(() => jar.clear());

describe("unauthenticated requests", () => {
  test("the proxy turns them away: APIs with 401, pages to the sign-in page", () => {
    expect(proxy(new NextRequest("http://localhost/api/docs")).status).toBe(401);
    expect(proxy(new NextRequest("http://localhost/api/reset", { method: "POST" })).status).toBe(401);
    const page = proxy(new NextRequest("http://localhost/drive"));
    expect(page.headers.get("location")).toContain("/login?next=%2Fdrive");
    expect(proxy(new NextRequest("http://localhost/api/health")).headers.get("x-middleware-next")).toBe("1");
  });

  test("routes check again, and a forged session or a viewerId in the request doesn't help", async () => {
    await expect(requireViewer(req("/api/docs"))).rejects.toMatchObject({ status: 401 });
    jar.set(SESSION_COOKIE, createSession("a different secret of at least thirty-two chars", "an"));
    await expect(requireViewer(req("/api/docs"))).rejects.toMatchObject({ status: 401 });
    expect((await docsRoute.POST(req("/api/docs", json({ title: "x", content: "", viewerId: "an" })))).status).toBe(401);
  });

  test("a demo session doesn't work while demo mode is off", async () => {
    expect(config.demoMode).toBe(false);
    signIn("an", DEMO_USER);
    await expect(requireViewer(req("/api/docs"))).rejects.toMatchObject({ status: 401 });
    expect(proxy(new NextRequest("http://localhost/api/docs", { headers: { cookie: `${SESSION_COOKIE}=${jar.get(SESSION_COOKIE)}` } })).status).toBe(401);
  });
});

describe("switching who you are", () => {
  test("someone signed in as themselves can't switch to anyone else", async () => {
    signIn("marc");
    const res = await sessionRoute.POST(req("/api/session", json({ viewerId: "lotte" })));
    expect(res.status).toBe(403);
    expect((await requireViewer(req("/api/session"))).id).toBe("marc");
    expect((await (await sessionRoute.GET(req("/api/session"))).json()).canSwitch).toBe(false);
  });
});

describe("saving over a hard conflict", () => {
  const sample = fs.readFileSync(path.join(__dirname, "../../samples/salary-review-jonas-maes.md"), "utf8");
  const upload = (reason?: string) => req("/api/docs", json({ title: "Salary review – Jonas Maes", content: sample, locations: ["Belgium"], tags: ["policy", "salary"], acknowledgeSimilar: true, ...(reason ? { override: { reason } } : {}) }));

  test("is recorded against the person who signed in, whatever the request says", async () => {
    signIn("jonas");
    expect((await docsRoute.POST(upload())).status).toBe(409);
    expect((await docsRoute.POST(upload("x"))).status).toBe(400);
    const res = await docsRoute.POST(req("/api/docs", { method: "POST", body: JSON.stringify({ ...JSON.parse(await upload("Raise approved by An on 28 Sep").text()), viewerId: "an", personId: "an" }) }));
    expect(res.status).toBe(200);
    const { id } = await res.json();
    const overrides = (await loadWorld()).overrides.filter((o) => o.docId === id);
    expect(overrides.length).toBeGreaterThan(0);
    expect(overrides.every((o) => o.personId === "jonas")).toBe(true);
  });

  test("needs the right to edit the document being saved, and a real reason", async () => {
    const world = await loadWorld();
    const person = (id: string) => world.people.find((p) => p.id === id)!;
    // Saving the sample's text into Legal's expense policy: it contradicts the salary register.
    const draft = { title: "Travel & expense policy", content: sample, locations: ["Belgium"], teamId: "legal", docId: "expense-policy" };
    const reason = { reason: "Raise approved by An on 28 Sep" };
    expect(await gateDraft(world, draft, undefined, person("julia"))).toMatchObject({ ok: false, status: 409 });
    // Jonas may not edit Legal's policy, so he can't push it through over the conflict.
    expect(await gateDraft(world, draft, reason, person("jonas"))).toMatchObject({ ok: false, status: 403 });
    // Julia owns it: with a real reason she may; with a keystroke she may not.
    expect(await gateDraft(world, draft, { reason: "ok" }, person("julia"))).toMatchObject({ ok: false, status: 400 });
    expect(await gateDraft(world, draft, reason, person("julia"))).toMatchObject({ ok: true, overridden: expect.arrayContaining([expect.anything()]) });
    // Through the route, Jonas doesn't even get to the conflict check.
    signIn("jonas");
    const res = await docRoute.PATCH(req("/api/docs/expense-policy", { method: "PATCH", body: JSON.stringify({ content: sample, override: reason }) }), { params: Promise.resolve({ id: "expense-policy" }) });
    expect(res.status).toBe(403);
  });
});
