import crypto from "node:crypto";
import { requireViewer } from "@/lib/auth";
import { createDocument, loadWorld, recordOverrides } from "@/lib/db";
import { handle, HttpError, readBody } from "@/lib/http";
import { notifyOverrides } from "@/lib/notify";
import { newDocument } from "@/lib/schemas";
import { checkAppliesTo, gateDraft, listDocs, redundancyCheck, requireTags } from "@/lib/service";

export const GET = handle(async (req) => Response.json(await listDocs(await requireViewer(req))));

/**
 * Creates (uploads) a document.
 * - 409 `conflicts`: hard conflicts – blocked unless `override.reason` is given.
 * - 409 `similar`: basically the same information already exists – warning, pass `acknowledgeSimilar: true` to continue.
 */
export const POST = handle(async (req) => {
  const viewer = await requireViewer(req);
  const body = await readBody(req, newDocument);
  const world = await loadWorld();
  const title = body.title?.trim() ?? "";
  if (!title) throw new HttpError(400, "Give the document a name.");
  const scope = checkAppliesTo(world, body.locations, body.audienceTeamIds);
  // An upload is tagged when it's added; a blank document when it's first saved.
  requireTags(world, body.content, body.tags);
  const locations = scope.locations ?? [viewer.location];
  const audienceTeamIds = scope.audienceTeamIds ?? [];
  // The team that maintains it is the creator's; who it's for is in `locations` and `audienceTeamIds`.
  const teamId = viewer.teamId;
  const clientId = world.clients.some((c) => c.id === body.clientId) ? body.clientId : undefined;
  const folderId = world.folders.some((f) => f.id === body.folderId) ? body.folderId : undefined;

  const [gate, similar] = await Promise.all([
    gateDraft(world, { title, content: body.content, locations, teamId, confidential: body.confidential }, body.override),
    redundancyCheck(world, { title, content: body.content, confidential: body.confidential }, { acknowledged: body.acknowledgeSimilar }),
  ]);
  if (!gate.ok) return Response.json({ ...gate.body, similar }, { status: gate.status });
  if (similar.length) return Response.json({ error: "similar", similar, check: gate.check }, { status: 409 });

  const now = new Date().toISOString();
  const id = `doc-${crypto.randomUUID()}`;
  await createDocument(
    { id, title, kind: body.kind, content: body.content, ownerId: viewer.id, locations, audienceTeamIds, status: body.status ?? "WIP", teamId, tags: body.tags, createdAt: now, updatedAt: now, lastEditedById: viewer.id, clientId, folderId, confidential: body.confidential },
    body.sourceConversationIds,
  );
  const reason = body.override?.reason ?? "";
  await recordOverrides(id, viewer.id, reason, gate.overridden);
  await notifyOverrides(world, { id, title }, gate.overridden, viewer.id, reason);
  return Response.json({ id, conflictCheck: gate.check });
});
