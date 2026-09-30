import type { NextRequest } from "next/server";
import { addVerification, documentExists, loadWorld } from "@/lib/db";
import { docDetail, getViewer } from "@/lib/service";

/** A person claims the document is correct as of now. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/docs/[id]/verify">) {
  const { id } = await ctx.params;
  if (!documentExists(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json();
  const viewer = getViewer(loadWorld(), body.viewerId);
  addVerification(id, viewer.id);
  return Response.json(docDetail(id, viewer.id));
}
