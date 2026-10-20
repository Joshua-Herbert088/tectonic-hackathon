import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { validateClient, normaliseDomain } from "./clients";
import { buildSeed } from "./seed";
import type { Doc } from "./types";

// A stand-in for Jev that answers every question, so we can see exactly what would have been sent.
const sent: string[] = [];
vi.mock("./trust", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./trust")>()),
  callJev: vi.fn(async (body: { questions: Record<string, unknown> }) => {
    sent.push(JSON.stringify(body));
    return { model: "fake", answers: Object.fromEntries(Object.keys(body.questions).map((k) => [k, { noul: 0.1, score: 0 }])) };
  }),
}));
const { checkConflicts } = await import("./conflicts");
const { findSameInformation } = await import("./similarity");
const { buildJevState } = await import("./trust");

const sample = fs.readFileSync(path.join(__dirname, "../../samples/salary-review-jonas-maes.md"), "utf8");
const draft = { title: "Salary review – Jonas Maes", content: sample, locations: ["Belgium"], teamId: "pay-be" };

beforeEach(() => {
  sent.length = 0;
});

describe("confidential documents never reach Jev", () => {
  test("without the flag, the same checks do ask Jev (so the stand-in is wired up)", async () => {
    // The seeded salary register is confidential; without that flag it would be sent.
    const db = buildSeed();
    db.docs.find((d) => d.id === "salary-register-be")!.confidential = false;
    await checkConflicts(db, draft);
    expect(sent.join("")).toContain("Salary register");
  });

  test("a confidential draft is checked for conflicts by the rules only", async () => {
    const check = await checkConflicts(buildSeed(), { ...draft, confidential: true });
    expect(sent).toEqual([]);
    expect(check.method).toBe("rules");
    expect(check.hard.map((c) => c.existing.docId)).toContain("salary-register-be");
  });

  test("lines of a confidential document aren't sent when another draft is checked against it", async () => {
    const db = buildSeed();
    const register = db.docs.find((d) => d.id === "salary-register-be")!;
    register.confidential = true;
    const check = await checkConflicts(db, draft);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.join("")).not.toContain("Salary register");
    // The rules still find the contradiction with it.
    expect(check.hard.map((c) => c.existing.docId)).toContain("salary-register-be");
  });

  test("duplicate checks compare confidential texts and candidates by the rules", async () => {
    const db = buildSeed();
    const source = db.docs.find((d) => d.id === "sick-leave-be")!;
    await findSameInformation({ ...source, confidential: true }, db.docs.filter((d) => d.id !== source.id));
    expect(sent).toEqual([]);
    const pool = db.docs.filter((d) => d.id !== source.id).map((d): Doc => ({ ...d, confidential: true }));
    await findSameInformation(source, pool);
    expect(sent).toEqual([]);
  });

  test("another document's trust input leaves out confidential excerpts and lines", () => {
    const db = buildSeed();
    for (const d of db.docs) d.confidential = d.id === "expense-policy";
    const viewer = db.people.find((p) => p.id === "jonas")!;
    const state = JSON.stringify(buildJevState(db, db.docs.find((d) => d.id === "client-noordkaai")!, viewer));
    expect(state).not.toContain("€0.3707/km");
    expect(state).toContain("confidential – not shared");
  });
});

describe("clients", () => {
  const ctx = { clients: buildSeed().clients, teamIds: ["pay-be", "pay-nl"], locations: ["Belgium", "Netherlands", "Global"] };
  test("domains are normalised from addresses and links", () => {
    expect(normaliseDomain("Mail@Noordkaai.Example")).toBe("noordkaai.example");
    expect(normaliseDomain("https://www.havenstaal.example/contact")).toBe("havenstaal.example");
    expect(normaliseDomain("  ")).toBeUndefined();
  });
  test("names and domains must be unique, team and country must exist", () => {
    expect(validateClient({ name: "Kustlijn NV", domain: "kustlijn.example", teamId: "pay-be", location: "Belgium" }, ctx)).toBeNull();
    expect(validateClient({ name: "noordkaai logistics", teamId: "pay-be", location: "Belgium" }, ctx)).toMatch(/already a client/);
    expect(validateClient({ name: "New", domain: "noordkaai.example", teamId: "pay-be", location: "Belgium" }, ctx)).toMatch(/already belongs to Noordkaai/);
    expect(validateClient({ name: "New", domain: "not a domain", teamId: "pay-be", location: "Belgium" }, ctx)).toMatch(/isn't an email domain/);
    expect(validateClient({ name: "New", teamId: "nope", location: "Belgium" }, ctx)).toMatch(/team/);
    expect(validateClient({ name: "New", teamId: "pay-be", location: "Mars" }, ctx)).toMatch(/country/);
    const noordkaai = ctx.clients.find((c) => c.id === "noordkaai")!;
    expect(validateClient({ name: noordkaai.name, domain: noordkaai.domain, teamId: "pay-be", location: "Belgium" }, ctx, noordkaai)).toBeNull();
  });
});
