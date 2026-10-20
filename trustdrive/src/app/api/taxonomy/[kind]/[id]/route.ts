import { requireViewer } from "@/lib/auth";
import { deleteTerm, loadTerms, loadWorld, updateTerm } from "@/lib/db";
import { handle, HttpError, readBody } from "@/lib/http";
import { termInput, termKind } from "@/lib/schemas";
import { taxonomyOf, validateTerm } from "@/lib/taxonomy";

type Ctx = RouteContext<"/api/taxonomy/[kind]/[id]">;

async function find(ctx: Ctx) {
  const params = await ctx.params;
  const kind = termKind.parse(params.kind);
  const id = decodeURIComponent(params.id);
  const tax = taxonomyOf(await loadTerms());
  const term = tax.terms.find((t) => t.kind === kind && t.id === id);
  if (!term) throw new HttpError(404, "Not found");
  return { tax, term };
}

/**
 * Changes a term's name, description, keywords or (topics) its main topic. Ids stay the same, so
 * documents keep their tags. A country's name is what documents store, so it can't be renamed.
 */
export const PATCH = handle(async (req, ctx: Ctx) => {
  await requireViewer(req);
  const { tax, term } = await find(ctx);
  const body = await readBody(req, termInput);
  if (term.kind === "country" && body.label.trim() !== term.label) throw new HttpError(400, "A country can't be renamed: documents and people refer to it by name. Add the new name and move them over instead.");
  const invalid = validateTerm(tax, term.kind, body, term);
  if (invalid) throw new HttpError(400, invalid);
  await updateTerm(term.kind, term.id, {
    label: body.label.trim(),
    description: body.description,
    keywords: [...new Set(body.keywords.filter(Boolean))],
    parent: term.kind === "topic" && body.parent !== undefined ? body.parent : undefined,
  });
  return Response.json({ terms: await loadTerms() });
});

/**
 * Removes a term. A main topic with sub-topics, and a country anything still refers to, can't be removed.
 * Documents keep a removed tag (shown as untracked) until someone retags them.
 */
export const DELETE = handle(async (req, ctx: Ctx) => {
  await requireViewer(req);
  const { tax, term } = await find(ctx);
  if (term.kind === "topic" && tax.childrenOf(term.id).length) throw new HttpError(409, "Remove or move its sub-topics first.");
  if (term.kind === "country") {
    const world = await loadWorld();
    const n = { documents: world.docs.filter((d) => d.locations.includes(term.id)).length, people: world.people.filter((p) => p.location === term.id).length, clients: world.clients.filter((c) => c.location === term.id).length };
    const used = Object.entries(n).filter(([, v]) => v).map(([k, v]) => `${v} ${v === 1 ? k.replace(/s$/, "").replace(/^people$/, "person") : k}`);
    const total = n.documents + n.people + n.clients;
    if (used.length) throw new HttpError(409, `${term.label} is still used by ${used.join(", ")}. Move ${total === 1 ? "it" : "them"} to another country first.`);
  }
  await deleteTerm(term.kind, term.id);
  return Response.json({ terms: await loadTerms() });
});
