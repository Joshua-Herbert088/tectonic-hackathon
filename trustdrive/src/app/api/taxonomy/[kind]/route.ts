import { requireViewer } from "@/lib/auth";
import { createTerm, loadTerms } from "@/lib/db";
import { handle, HttpError, readBody } from "@/lib/http";
import { termInput, termKind } from "@/lib/schemas";
import { newTermId, taxonomyOf, validateTerm } from "@/lib/taxonomy";

/** Adds a topic, document type or country to the taxonomy. */
export const POST = handle(async (req, ctx: RouteContext<"/api/taxonomy/[kind]">) => {
  await requireViewer(req);
  const kind = termKind.parse((await ctx.params).kind);
  const body = await readBody(req, termInput);
  const tax = taxonomyOf(await loadTerms());
  const invalid = validateTerm(tax, kind, body);
  if (invalid) throw new HttpError(400, invalid);
  const label = body.label.trim();
  const term = { kind, id: newTermId(tax, kind, label), label, description: body.description, keywords: [...new Set(body.keywords.filter(Boolean))], parent: kind === "topic" ? (body.parent ?? undefined) : undefined };
  await createTerm(term);
  return Response.json({ term, terms: await loadTerms() });
});
