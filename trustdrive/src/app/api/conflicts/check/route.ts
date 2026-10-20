import { requireViewer } from "@/lib/auth";
import { checkConflicts } from "@/lib/conflicts";
import { loadWorld } from "@/lib/db";
import { handle, readBody } from "@/lib/http";
import { limitWrites } from "@/lib/rateLimit";
import { conflictDraft } from "@/lib/schemas";
import { GLOBAL } from "@/lib/taxonomy";

/** Dry run: which hard/possible conflicts would saving this draft hit? Nothing is written. */
export const POST = handle(async (req) => {
  const viewer = await requireViewer(req);
  // Each check can ask Jev, which is paid for.
  limitWrites(viewer.id);
  const body = await readBody(req, conflictDraft);
  const world = await loadWorld();
  const existing = world.docs.find((d) => d.id === body.docId);
  const check = await checkConflicts(world, {
    title: body.title ?? existing?.title ?? "",
    content: body.content,
    locations: body.locations ?? existing?.locations ?? [GLOBAL],
    teamId: world.teams.some((t) => t.id === body.teamId) ? body.teamId! : (existing?.teamId ?? world.teams[0].id),
    docId: existing?.id,
    previousContent: existing?.content,
    // A confidential document stays confidential here: its text must not reach Jev because a request said otherwise.
    confidential: !!existing?.confidential || !!body.confidential,
  });
  return Response.json(check);
});
