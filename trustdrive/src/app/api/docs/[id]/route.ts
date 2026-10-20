import { requireViewer } from "@/lib/auth";
import { deleteDocumentForever, loadTrash, recordActivity, recordOpen } from "@/lib/db";
import { handle, HttpError, readBody } from "@/lib/http";
import { log } from "@/lib/log";
import { quietNotice } from "@/lib/quiet";
import { documentPatch } from "@/lib/schemas";
import { docDetail, editDocument } from "@/lib/service";

type Ctx = RouteContext<"/api/docs/[id]">;

export const GET = handle(async (req, ctx: Ctx) => {
  const id = (await ctx.params).id;
  const viewer = await requireViewer(req);
  const detail = await docDetail(id, viewer);
  if (!detail) throw new HttpError(404, "Not found");
  // For the viewer's mentor, if they have one. Not a view: Jev never sees it, so no rescore.
  await recordActivity(viewer.id, { kind: "open", docId: id }).catch((e: Error) => log.warn("could not record activity", { error: e.message }));
  // When it was opened before this visit: a document nobody looked at in a long time gets a notice.
  const before = await recordOpen(id, viewer.id).catch((e: Error) => {
    log.warn("could not record the open", { error: e.message });
    return null;
  });
  return Response.json({ ...detail, quiet: quietNotice(detail.doc, before) });
});

/**
 * Content edits go through the conflict gate (409 on hard conflicts unless overridden); metadata edits don't.
 * See editDocument.
 */
export const PATCH = handle(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const viewer = await requireViewer(req);
  const { status, body } = await editDocument(viewer, id, await readBody(req, documentPatch));
  return Response.json(body, { status });
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
