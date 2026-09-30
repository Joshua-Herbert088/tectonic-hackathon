import type { NextRequest } from "next/server";
import { loadWorld } from "@/lib/db";
import { findSameInformation } from "@/lib/similarity";

/** Which of `ids` (e.g. documents the reader just looked at) contain basically the same information as this one? */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/docs/[id]/overlap">) {
  const { id } = await ctx.params;
  const body = await req.json();
  const world = loadWorld();
  const doc = world.docs.find((d) => d.id === id);
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });
  const ids: string[] = Array.isArray(body.ids) ? body.ids.slice(0, 10) : [];
  const pool = world.docs.filter((d) => d.id !== id && ids.includes(d.id));
  try {
    return Response.json({ matches: await findSameInformation(doc, pool) });
  } catch (e) {
    return Response.json({ matches: [], error: (e as Error).message });
  }
}
