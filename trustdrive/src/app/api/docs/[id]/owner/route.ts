import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { findPerson, loadWorld, transferOwnership } from "@/lib/db";
import { handle, HttpError, readBody } from "@/lib/http";
import { docDetail, mayReassign } from "@/lib/service";

/** Hands the document over to a new (active) owner. Who may: see mayReassign. */
export const POST = handle(async (req, ctx: RouteContext<"/api/docs/[id]/owner">) => {
  const { id } = await ctx.params;
  const viewer = await requireViewer(req);
  const { ownerId } = await readBody(req, z.object({ ownerId: z.string() }));
  const world = await loadWorld();
  const doc = world.docs.find((d) => d.id === id);
  if (!doc) throw new HttpError(404, "Not found");
  if (!mayReassign(world, doc, viewer)) throw new HttpError(403, "Only the owner can hand this document over. Once it needs a new owner, its team and collaborators can too.");
  const next = await findPerson({ id: ownerId });
  if (!next?.active) throw new HttpError(400, "New owner must be an active colleague");
  await transferOwnership(id, next.id);
  return Response.json(await docDetail(id, viewer));
});
