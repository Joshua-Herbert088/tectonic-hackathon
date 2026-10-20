import { z } from "zod";
import { canSwitchViewer, endSession, requireViewer, sessionId, startSession } from "@/lib/auth";
import { findPerson } from "@/lib/db";
import { handle, HttpError, readBody } from "@/lib/http";
import { DEMO_USER } from "@/lib/session";

/** Who the drive is viewed as, and whether this session may switch (demo mode only). */
export const GET = handle(async (req) => {
  const viewer = await requireViewer(req);
  return Response.json({ viewer, canSwitch: await canSwitchViewer() });
});

/** View the drive as someone else. Only a demo session in demo mode; everyone else is who they signed in as. */
export const POST = handle(async (req) => {
  await requireViewer(req);
  if (!(await canSwitchViewer())) throw new HttpError(403, "You're signed in as yourself. Viewing the drive as someone else is only possible in demo mode.");
  const { viewerId } = await readBody(req, z.object({ viewerId: z.string() }));
  const person = await findPerson({ id: viewerId });
  if (!person?.active) throw new HttpError(400, "Unknown or inactive person");
  await startSession(person.id, { userId: DEMO_USER, sessionId: await sessionId() });
  return Response.json({ viewer: person });
});

/** Signs out. */
export const DELETE = handle(async () => {
  await endSession();
  return Response.json({ ok: true });
});
