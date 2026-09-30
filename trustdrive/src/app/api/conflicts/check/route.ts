import type { NextRequest } from "next/server";
import { checkConflicts } from "@/lib/conflicts";
import { loadWorld } from "@/lib/db";
import { LOCATIONS } from "@/lib/types";

/** Dry run: which hard/possible conflicts would saving this draft hit? Nothing is written. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const world = loadWorld();
  const existing = world.docs.find((d) => d.id === body.docId);
  try {
    const check = await checkConflicts(world, {
      title: String(body.title ?? existing?.title ?? ""),
      content: String(body.content ?? ""),
      location: LOCATIONS.includes(body.location) ? body.location : (existing?.location ?? "Global"),
      teamId: world.teams.some((t) => t.id === body.teamId) ? body.teamId : (existing?.teamId ?? world.teams[0].id),
      docId: existing?.id,
      previousContent: existing?.content,
    });
    return Response.json(check);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
