import type { NextRequest } from "next/server";
import { computeScore, DEFAULT_VIEWER } from "@/lib/service";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/docs/[id]/score">) {
  const { id } = await ctx.params;
  try {
    const trust = await computeScore(id, req.nextUrl.searchParams.get("viewer") ?? DEFAULT_VIEWER);
    return Response.json({ trust });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
