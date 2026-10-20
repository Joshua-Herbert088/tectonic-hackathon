import crypto from "node:crypto";
import type { z } from "zod";
import { redactConflicts } from "@/lib/access";
import { requireViewer, sessionId, signedInAs } from "@/lib/auth";
import { createDocument, loadWorld, markAnswersInFaq, recordOverrides } from "@/lib/db";
import { handle, HttpError, readBody } from "@/lib/http";
import { log } from "@/lib/log";
import { notifyOverrides } from "@/lib/notify";
import { limitWrites, withSaveSlot } from "@/lib/rateLimit";
import { newDocument } from "@/lib/schemas";
import { checkAppliesTo, checkStorage, checkTags, gateDraft, listDocs, redundancyCheck, requireTags } from "@/lib/service";
import type { ConflictCheck, Person } from "@/lib/types";

export const GET = handle(async (req) => Response.json(await listDocs(await requireViewer(req))));

/**
 * Creates (uploads) a document.
 * - 409 `conflicts`: hard conflicts – blocked unless `override.reason` is given.
 * - 409 `similar`: basically the same information already exists – warning, pass `acknowledgeSimilar: true` to continue.
 */
export const POST = handle(async (req) => {
  const viewer = await requireViewer(req);
  const body = await readBody(req, newDocument);
  limitWrites(viewer.id, await sessionId(), (body.title?.length ?? 0) + body.content.length);
  const actor = await signedInAs();
  return withSaveSlot(viewer.id, () => create(viewer, body, actor));
});

async function create(viewer: Person, body: z.infer<typeof newDocument>, signedIn: string) {
  const world = await loadWorld();
  const title = body.title?.trim() ?? "";
  if (!title) throw new HttpError(400, "Give the document a name.");
  const scope = checkAppliesTo(world, body.locations, body.audienceTeamIds);
  // An upload is tagged when it's added; a blank document when it's first saved.
  checkTags(world, body.tags);
  requireTags(world, body.content, body.tags);
  const locations = scope.locations ?? [viewer.location];
  const audienceTeamIds = scope.audienceTeamIds ?? [];
  // The team that maintains it is the creator's; who it's for is in `locations` and `audienceTeamIds`.
  const teamId = viewer.teamId;
  const clientId = world.clients.some((c) => c.id === body.clientId) ? body.clientId : undefined;
  const folderId = world.folders.some((f) => f.id === body.folderId) ? body.folderId : undefined;

  const [gate, similar] = await Promise.all([
    gateDraft(world, { title, content: body.content, locations, teamId, confidential: body.confidential }, body.override, viewer),
    redundancyCheck(world, { title, content: body.content, confidential: body.confidential }, { acknowledged: body.acknowledgeSimilar, viewer }),
  ]);
  // Conflicts with documents the viewer may not see still block, without saying what those say.
  if (!gate.ok) return Response.json({ ...gate.body, ...(gate.body.check ? { check: redactConflicts(world, gate.body.check as ConflictCheck, viewer) } : {}), similar }, { status: gate.status });
  if (similar.length) return Response.json({ error: "similar", similar, check: redactConflicts(world, gate.check, viewer) }, { status: 409 });

  await checkStorage(world, viewer, { document: true, owned: true, chars: title.length + body.content.length });
  const now = new Date().toISOString();
  const id = `doc-${crypto.randomUUID()}`;
  await createDocument(
    { id, title, kind: body.kind, content: body.content, ownerId: viewer.id, locations, audienceTeamIds, status: body.status ?? "WIP", teamId, tags: [...new Set(body.tags)], createdAt: now, updatedAt: now, lastEditedById: viewer.id, clientId, folderId, confidential: body.confidential },
    body.sourceConversationIds,
  );
  // Written up: these answers stop counting towards an FAQ suggestion, and point to the document.
  await markAnswersInFaq(body.answerIds, viewer.id, id);
  const reason = body.override?.reason ?? "";
  await recordOverrides(id, viewer.id, reason, gate.overridden);
  if (gate.overridden.length) log.info("saved over hard conflicts", { docId: id, by: viewer.id, signedInAs: signedIn, conflicts: gate.overridden.length, reason });
  await notifyOverrides(world, { id, title }, gate.overridden, viewer.id, reason);
  return Response.json({ id, conflictCheck: redactConflicts(world, gate.check, viewer) });
}
