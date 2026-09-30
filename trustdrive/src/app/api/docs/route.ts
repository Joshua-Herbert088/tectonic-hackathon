import type { NextRequest } from "next/server";
import { createDocument, loadWorld, recordOverrides } from "@/lib/db";
import { notifyOverrides } from "@/lib/notify";
import { gateDraft, getViewer, listDocs, redundancyCheck } from "@/lib/service";
import { LOCATIONS, STATUSES } from "@/lib/types";

export async function GET(req: NextRequest) {
  return Response.json(listDocs(req.nextUrl.searchParams.get("viewer")));
}

/**
 * Creates (uploads) a document.
 * - 409 `conflicts`: hard conflicts – blocked unless `override.reason` is given.
 * - 409 `similar`: basically the same information already exists – warning, pass `acknowledgeSimilar: true` to continue.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const world = loadWorld();
  const viewer = getViewer(world, body.viewerId);
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Untitled document";
  const content = typeof body.content === "string" ? body.content : "";
  const location = LOCATIONS.includes(body.location) ? body.location : viewer.location;
  const teamId = world.teams.some((t) => t.id === body.teamId) ? body.teamId : viewer.teamId;

  const [gate, similar] = await Promise.all([
    gateDraft(world, { title, content, location, teamId }, body.override),
    redundancyCheck(world, { title, content }, { acknowledged: body.acknowledgeSimilar }),
  ]);
  if (!gate.ok) return Response.json({ ...gate.body, similar }, { status: gate.status });
  if (similar.length) return Response.json({ error: "similar", similar, check: gate.check }, { status: 409 });

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
  const reason = body.override?.reason?.trim() ?? "";
  recordOverrides(id, viewer.id, reason, gate.overridden);
  notifyOverrides(world, { id, title }, gate.overridden, viewer.id, reason);
  return Response.json({ id, conflictCheck: gate.check });
}
