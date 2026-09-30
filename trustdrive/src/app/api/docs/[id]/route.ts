import type { NextRequest } from "next/server";
import { loadWorld, recordOverrides, updateDocument } from "@/lib/db";
import { docDetail, gateDraft, getViewer } from "@/lib/service";
import { LOCATIONS, STATUSES } from "@/lib/types";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/docs/[id]">) {
  const { id } = await ctx.params;
  const detail = docDetail(id, req.nextUrl.searchParams.get("viewer"));
  if (!detail) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(detail);
}

/** Content edits go through the conflict gate (409 on hard conflicts unless overridden); metadata edits don't. */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/docs/[id]">) {
  const { id } = await ctx.params;
  const world = loadWorld();
  const doc = world.docs.find((d) => d.id === id);
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json();
  const viewer = getViewer(world, body.viewerId);
  const patch = {
    title: typeof body.title === "string" ? body.title : undefined,
    content: typeof body.content === "string" ? body.content : undefined,
    status: STATUSES.includes(body.status) ? body.status : undefined,
    location: LOCATIONS.includes(body.location) ? body.location : undefined,
    teamId: world.teams.some((t) => t.id === body.teamId) ? body.teamId : undefined,
  };

  const contentChanged = (patch.content !== undefined && patch.content !== doc.content) || (patch.title !== undefined && patch.title !== doc.title);
  let gate: Awaited<ReturnType<typeof gateDraft>> | null = null;
  if (contentChanged) {
    gate = await gateDraft(
      world,
      {
        title: patch.title ?? doc.title,
        content: patch.content ?? doc.content,
        location: patch.location ?? doc.location,
        teamId: patch.teamId ?? doc.teamId,
        docId: doc.id,
        previousContent: doc.content,
      },
      body.override,
    );
    if (!gate.ok) return gate.response;
  }

  updateDocument(id, viewer.id, patch);
  if (gate?.ok) recordOverrides(id, viewer.id, body.override?.reason?.trim() ?? "", gate.overridden);
  return Response.json({ ...docDetail(id, viewer.id), conflictCheck: gate?.ok ? gate.check : null });
}
