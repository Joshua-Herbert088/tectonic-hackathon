import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { findPerson, documentExists, transferOwnership } from "@/lib/db";
import { handle, HttpError, readBody } from "@/lib/http";
import { docDetail } from "@/lib/service";

/** Hands the document over to a new (active) owner. */
export const POST = handle(async (req, ctx: RouteContext<"/api/docs/[id]/owner">) => {
  const { id } = await ctx.params;
  const viewer = await requireViewer(req);
  const { ownerId } = await readBody(req, z.object({ ownerId: z.string() }));
  if (!(await documentExists(id))) throw new HttpError(404, "Not found");
  const next = await findPerson({ id: ownerId });
  if (!next?.active) throw new HttpError(400, "New owner must be an active colleague");
  await transferOwnership(id, next.id);
  return Response.json(await docDetail(id, viewer));
});
