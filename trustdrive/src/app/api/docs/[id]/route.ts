import { requireViewer } from "@/lib/auth";
import { deleteDocumentForever, loadTrash, loadWorld, recordActivity, recordOverrides, updateDocument } from "@/lib/db";
import { handle, HttpError, readBody } from "@/lib/http";
import { log } from "@/lib/log";
import { notifyEdit, notifyOverrides } from "@/lib/notify";
import { documentPatch } from "@/lib/schemas";
import { checkAppliesTo, docDetail, gateDraft, redundancyCheck, requireTags } from "@/lib/service";
import { substance } from "@/lib/similarity";

type Ctx = RouteContext<"/api/docs/[id]">;

export const GET = handle(async (req, ctx: Ctx) => {
  const id = (await ctx.params).id;
  const viewer = await requireViewer(req);
  const detail = await docDetail(id, viewer);
  if (!detail) throw new HttpError(404, "Not found");
  // For the viewer's mentor, if they have one. Not a view: Jev never sees it, so no rescore.
  await recordActivity(viewer.id, { kind: "open", docId: id }).catch((e: Error) => log.warn("could not record activity", { error: e.message }));
  return Response.json(detail);
});

/**
 * Content edits go through the conflict gate (409 on hard conflicts unless overridden); metadata edits don't.
 * Filling a still-empty document is treated like an upload and also gets the redundancy warning.
 * Authors of lines that were changed – or contradicted by an override – are notified.
 */
export const PATCH = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const viewer = await requireViewer(req);
  const body = await readBody(req, documentPatch);
  const world = await loadWorld();
  const doc = world.docs.find((d) => d.id === id);
  if (!doc) throw new HttpError(404, "Not found");
  if (body.title !== undefined && !body.title.trim()) throw new HttpError(400, "A document needs a name.");
  const patch = {
    title: body.title?.trim(),
    content: body.content,
    status: body.status,
    ...checkAppliesTo(world, body.locations, body.audienceTeamIds),
    tags: body.tags ? [...new Set(body.tags)] : undefined,
    clientId: body.clientId === null || world.clients.some((c) => c.id === body.clientId) ? body.clientId : undefined,
    confidential: body.confidential,
  };
  const confidential = patch.confidential ?? !!doc.confidential;
  const title = patch.title ?? doc.title;
  const content = patch.content ?? doc.content;

  const contentChanged = content !== doc.content || title !== doc.title;
  // Saving content (a new document's first save, or any edit of one that was never tagged) needs tags.
  if (contentChanged) requireTags(world, content, patch.tags ?? doc.tags);
  let gate: Awaited<ReturnType<typeof gateDraft>> | null = null;
  if (contentChanged) {
    const [g, similar] = await Promise.all([
      gateDraft(world, { title, content, locations: patch.locations ?? doc.locations, teamId: doc.teamId, docId: doc.id, previousContent: doc.content, confidential }, body.override),
      substance(doc.content) ? Promise.resolve([]) : redundancyCheck(world, { title, content, confidential }, { excludeDocId: doc.id, acknowledged: body.acknowledgeSimilar }),
    ]);
    if (!g.ok) return Response.json({ ...g.body, similar }, { status: g.status });
    if (similar.length) return Response.json({ error: "similar", similar, check: g.check }, { status: 409 });
    gate = g;
  }

  if (contentChanged) await notifyEdit(world, doc, title, content, viewer.id);
  await updateDocument(id, viewer.id, patch);
  if (gate?.ok) {
    const reason = body.override?.reason ?? "";
    await recordOverrides(id, viewer.id, reason, gate.overridden);
    await notifyOverrides(world, { id, title }, gate.overridden, viewer.id, reason);
  }
  return Response.json({ ...(await docDetail(id, viewer)), conflictCheck: gate?.ok ? gate.check : null });
});

/** Deletes a document for good. Only from the trash, by its owner or whoever put it there. */
export const DELETE = handle(async (req, ctx: Ctx) => {
  const viewer = await requireViewer(req);
  const { id } = await ctx.params;
  const doc = (await loadTrash()).find((d) => d.id === id);
  if (!doc) throw new HttpError(409, "Move the document to the trash first.");
  if (doc.ownerId !== viewer.id && doc.trashedById !== viewer.id) throw new HttpError(403, "Only the owner or the person who removed it can delete it for good.");
  await deleteDocumentForever(id);
  return Response.json({ ok: true });
});
