import { requireViewer } from "@/lib/auth";
import { normaliseDomain, validateClient } from "@/lib/clients";
import { deleteClient, loadConversations, loadWorld, updateClient } from "@/lib/db";
import { handle, HttpError, readBody } from "@/lib/http";
import { clientInput } from "@/lib/schemas";
import { clientOverview } from "@/lib/service";
import { taxonomyOf } from "@/lib/taxonomy";

type Ctx = RouteContext<"/api/clients/[id]">;

/** Client overview: the client's documents, exceptions, conversations and the colleagues who handled it. */
export const GET = handle(async (req, ctx: Ctx) => {
  const viewer = await requireViewer(req);
  const overview = await clientOverview((await ctx.params).id, viewer);
  if (!overview) throw new HttpError(404, "Not found");
  return Response.json(overview);
});

/** Changes a client's name, mail domain, team or country. The id stays, so documents keep pointing at it. */
export const PATCH = handle(async (req, ctx: Ctx) => {
  await requireViewer(req);
  const { id } = await ctx.params;
  const body = await readBody(req, clientInput);
  const world = await loadWorld();
  const existing = world.clients.find((c) => c.id === id);
  if (!existing) throw new HttpError(404, "Not found");
  const invalid = validateClient(body, { clients: world.clients, teamIds: world.teams.map((t) => t.id), locations: taxonomyOf(world.terms).locations }, existing);
  if (invalid) throw new HttpError(400, invalid);
  await updateClient(id, { name: body.name.trim(), domain: normaliseDomain(body.domain), teamId: body.teamId, location: body.location });
  return Response.json({ clients: (await loadWorld()).clients });
});

/** Removes a client nothing refers to any more; documents and conversations about it must be moved first. */
export const DELETE = handle(async (req, ctx: Ctx) => {
  await requireViewer(req);
  const { id } = await ctx.params;
  const [world, conversations] = await Promise.all([loadWorld(), loadConversations()]);
  const client = world.clients.find((c) => c.id === id);
  if (!client) throw new HttpError(404, "Not found");
  const docs = world.docs.filter((d) => d.clientId === id).length;
  const convs = conversations.filter((c) => c.clientId === id).length;
  if (docs || convs) {
    const used = [docs && `${docs} document${docs === 1 ? "" : "s"}`, convs && `${convs} conversation${convs === 1 ? "" : "s"}`].filter(Boolean).join(" and ");
    throw new HttpError(409, `${client.name} is still linked to ${used}. Link ${docs + convs === 1 ? "it" : "them"} to another client (or none) first.`);
  }
  await deleteClient(id);
  return Response.json({ clients: (await loadWorld()).clients });
});
