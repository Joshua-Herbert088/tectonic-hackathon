import type { NextRequest } from "next/server";
import { loadWorld, transferOwnership } from "@/lib/db";
import { docDetail, getViewer } from "@/lib/service";

/** Hands the document over to a new (active) owner. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/docs/[id]/owner">) {
  const { id } = await ctx.params;
  const world = loadWorld();
  if (!world.docs.some((d) => d.id === id)) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json();
  const viewer = getViewer(world, body.viewerId);
  const next = world.people.find((p) => p.id === body.ownerId && p.active);
  if (!next) return Response.json({ error: "New owner must be an active colleague" }, { status: 400 });
  transferOwnership(id, next.id);
  return Response.json(docDetail(id, viewer.id));
}
