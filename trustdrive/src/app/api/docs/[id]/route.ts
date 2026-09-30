import type { NextRequest } from "next/server";
import { readDb, writeDb } from "@/lib/db";
import { docDetail, getViewer } from "@/lib/service";
import { LOCATIONS, STATUSES } from "@/lib/types";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/docs/[id]">) {
  const { id } = await ctx.params;
  const db = readDb();
  const doc = db.docs.find((d) => d.id === id);
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(docDetail(db, doc, getViewer(db, req.nextUrl.searchParams.get("viewer"))));
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/docs/[id]">) {
  const { id } = await ctx.params;
  const body = await req.json();
  const db = readDb();
  const doc = db.docs.find((d) => d.id === id);
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });
  const viewer = getViewer(db, body.viewerId);

  const contentChanged = (typeof body.content === "string" && body.content !== doc.content) || (typeof body.title === "string" && body.title !== doc.title);
  if (typeof body.title === "string") doc.title = body.title;
  if (typeof body.content === "string") doc.content = body.content;
  if (STATUSES.includes(body.status)) doc.status = body.status;
  if (LOCATIONS.includes(body.location)) doc.location = body.location;
  if (db.teams.some((t) => t.id === body.teamId)) doc.teamId = body.teamId;
  if (contentChanged) {
    doc.updatedAt = new Date().toISOString();
    doc.lastEditedById = viewer.id;
    if (doc.ownerId !== viewer.id && !doc.collaboratorIds.includes(viewer.id)) doc.collaboratorIds.push(viewer.id);
  }
  writeDb(db);
  return Response.json(docDetail(db, doc, viewer));
}
