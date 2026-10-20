import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { findPerson, loadWorld, setMentor } from "@/lib/db";
import { handle, HttpError, readBody } from "@/lib/http";
import { mentorProblem } from "@/lib/mentoring";

/** Assigns someone's mentor (buddy), or removes it with `mentorId: null`. Nobody is notified. */
export const PUT = handle(async (req, ctx: RouteContext<"/api/people/[id]/mentor">) => {
  await requireViewer(req);
  const { id } = await ctx.params;
  const { mentorId } = await readBody(req, z.object({ mentorId: z.string().max(100).nullable() }));
  const world = await loadWorld();
  const person = world.people.find((p) => p.id === id);
  if (!person) throw new HttpError(404, "Not found");
  if (mentorId) {
    const problem = mentorProblem(world, person, mentorId);
    if (problem) throw new HttpError(400, problem);
  }
  await setMentor(id, mentorId);
  const updated = await findPerson({ id });
  return Response.json({ mentorId: updated?.mentorId ?? null, mentorSince: updated?.mentorSince ?? null });
});
