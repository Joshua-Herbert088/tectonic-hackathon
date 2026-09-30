import type { NextRequest } from "next/server";
import { loadWorld, recordOverrides, updateDocument } from "@/lib/db";
import { notifyEdit, notifyOverrides } from "@/lib/notify";
import { docDetail, gateDraft, getViewer, redundancyCheck } from "@/lib/service";
import { substance } from "@/lib/similarity";
import { LOCATIONS, STATUSES } from "@/lib/types";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/docs/[id]">) {
  const { id } = await ctx.params;
  const detail = docDetail(id, req.nextUrl.searchParams.get("viewer"));
  if (!detail) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(detail);
}

/**
 * Content edits go through the conflict gate (409 on hard conflicts unless overridden); metadata edits don't.
 * Filling a still-empty document is treated like an upload and also gets the redundancy warning.
 * Authors of lines that were changed – or contradicted by an override – are notified.
 */
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
  const title = patch.title ?? doc.title;
  const content = patch.content ?? doc.content;

  const contentChanged = content !== doc.content || title !== doc.title;
  let gate: Awaited<ReturnType<typeof gateDraft>> | null = null;
  if (contentChanged) {
    const [g, similar] = await Promise.all([
      gateDraft(
        world,
        { title, content, location: patch.location ?? doc.location, teamId: patch.teamId ?? doc.teamId, docId: doc.id, previousContent: doc.content },
        body.override,
      ),
      substance(doc.content) ? Promise.resolve([]) : redundancyCheck(world, { title, content }, { excludeDocId: doc.id, acknowledged: body.acknowledgeSimilar }),
    ]);
    if (!g.ok) return Response.json({ ...g.body, similar }, { status: g.status });
    if (similar.length) return Response.json({ error: "similar", similar, check: g.check }, { status: 409 });
    gate = g;
  }

  if (contentChanged) notifyEdit(world, doc, title, content, viewer.id);
  updateDocument(id, viewer.id, patch);
  if (gate?.ok) {
    const reason = body.override?.reason?.trim() ?? "";
    recordOverrides(id, viewer.id, reason, gate.overridden);
    notifyOverrides(world, { id, title }, gate.overridden, viewer.id, reason);
  }
  return Response.json({ ...docDetail(id, viewer.id), conflictCheck: gate?.ok ? gate.check : null });
}
