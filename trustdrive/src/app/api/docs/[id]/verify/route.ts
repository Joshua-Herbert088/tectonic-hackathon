import type { NextRequest } from "next/server";
import { readDb, writeDb } from "@/lib/db";
import { docDetail, getViewer } from "@/lib/service";

/** A person claims the document is correct as of now. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/docs/[id]/verify">) {
  const { id } = await ctx.params;
  const body = await req.json();
  const db = readDb();
  const doc = db.docs.find((d) => d.id === id);
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });
  const viewer = getViewer(db, body.viewerId);
  doc.verifications.push({ personId: viewer.id, at: new Date().toISOString() });
  writeDb(db);
  return Response.json(docDetail(db, doc, viewer));
}
