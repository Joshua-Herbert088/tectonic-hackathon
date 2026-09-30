import type { NextRequest } from "next/server";
import { createDocument, loadWorld, recordOverrides } from "@/lib/db";
import { gateDraft, getViewer, listDocs } from "@/lib/service";
import { LOCATIONS, STATUSES } from "@/lib/types";

export async function GET(req: NextRequest) {
  return Response.json(listDocs(req.nextUrl.searchParams.get("viewer")));
}

/** Creates (uploads) a document. Blocked with 409 on hard conflicts unless `override.reason` is given. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const world = loadWorld();
  const viewer = getViewer(world, body.viewerId);
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Untitled document";
  const content = typeof body.content === "string" ? body.content : "";
  const location = LOCATIONS.includes(body.location) ? body.location : viewer.location;
  const teamId = world.teams.some((t) => t.id === body.teamId) ? body.teamId : viewer.teamId;

  const gate = await gateDraft(world, { title, content, location, teamId }, body.override);
  if (!gate.ok) return gate.response;

  const now = new Date().toISOString();
  const id = `doc-${Date.now().toString(36)}`;
  createDocument({
    id,
    title,
    kind: ["doc", "sheet", "pdf"].includes(body.kind) ? body.kind : "doc",
    content,
    ownerId: viewer.id,
    location,
    status: STATUSES.includes(body.status) ? body.status : "WIP",
    teamId,
    tags: Array.isArray(body.tags) ? body.tags : [],
    createdAt: now,
    updatedAt: now,
    lastEditedById: viewer.id,
  });
  recordOverrides(id, viewer.id, body.override?.reason?.trim() ?? "", gate.overridden);
  return Response.json({ id, conflictCheck: gate.check });
}
