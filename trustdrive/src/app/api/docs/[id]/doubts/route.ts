import type { NextRequest } from "next/server";
import { loadWorld } from "@/lib/db";
import { contradictionDoubts } from "@/lib/doubts";

/** Lines of this document that Jev finds contradicting other documents. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/docs/[id]/doubts">) {
  const { id } = await ctx.params;
  const world = loadWorld();
  const doc = world.docs.find((d) => d.id === id);
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    return Response.json({ doubts: await contradictionDoubts(world, doc) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
