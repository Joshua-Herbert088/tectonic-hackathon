import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { loadWorld, setHiddenExpertise } from "@/lib/db";
import { handle, HttpError, readBody } from "@/lib/http";
import { taxonomyOf } from "@/lib/taxonomy";

/** Takes a topic or client off the signed-in person's own expertise profile ("not me any more"), or puts it back. */
export const PUT = handle(async (req) => {
  const viewer = await requireViewer(req);
  const { subject, hidden } = await readBody(req, z.object({ subject: z.string().max(120), hidden: z.boolean() }));
  const world = await loadWorld();
  const colon = subject.indexOf(":");
  const kind = subject.slice(0, colon);
  const id = subject.slice(colon + 1);
  const known = kind === "topic" ? taxonomyOf(world.terms).topic.has(id) : kind === "client" && world.clients.some((c) => c.id === id);
  if (!known) throw new HttpError(400, `Unknown topic or client “${subject}”.`);
  const current = world.people.find((p) => p.id === viewer.id)?.hiddenExpertise ?? [];
  const next = hidden ? [...new Set([...current, subject])] : current.filter((s) => s !== subject);
  await setHiddenExpertise(viewer.id, next);
  return Response.json({ hiddenExpertise: next });
});
