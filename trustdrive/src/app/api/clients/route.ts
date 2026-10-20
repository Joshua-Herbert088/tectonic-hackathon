import { requireViewer } from "@/lib/auth";
import { normaliseDomain, validateClient } from "@/lib/clients";
import { createClient, loadWorld } from "@/lib/db";
import { handle, HttpError, readBody } from "@/lib/http";
import { clientInput } from "@/lib/schemas";
import { slugify, taxonomyOf } from "@/lib/taxonomy";

/** Adds a client. Mail from its domain is recognised when conversations are imported. */
export const POST = handle(async (req) => {
  await requireViewer(req);
  const body = await readBody(req, clientInput);
  const world = await loadWorld();
  const invalid = validateClient(body, { clients: world.clients, teamIds: world.teams.map((t) => t.id), locations: taxonomyOf(world.terms).locations });
  if (invalid) throw new HttpError(400, invalid);
  const base = slugify(body.name);
  let id = base;
  for (let i = 2; world.clients.some((c) => c.id === id); i++) id = `${base}-${i}`;
  const client = { id, name: body.name.trim(), domain: normaliseDomain(body.domain), teamId: body.teamId, location: body.location };
  await createClient(client);
  return Response.json({ client, clients: (await loadWorld()).clients });
});
