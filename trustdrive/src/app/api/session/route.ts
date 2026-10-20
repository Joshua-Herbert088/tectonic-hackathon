import { z } from "zod";
import { endSession, requireViewer, sessionId, startSession } from "@/lib/auth";
import { findPerson } from "@/lib/db";
import { handle, HttpError, readBody } from "@/lib/http";

/** Who the drive is viewed as. */
export const GET = handle(async (req) => {
  const viewer = await requireViewer(req);
  return Response.json({ viewer, canSwitch: true });
});

/** View the drive as someone else. Only once signed in. */
export const POST = handle(async (req) => {
  await requireViewer(req);
  const { viewerId } = await readBody(req, z.object({ viewerId: z.string() }));
  const person = await findPerson({ id: viewerId });
  if (!person?.active) throw new HttpError(400, "Unknown or inactive person");
  await startSession(person.id, await sessionId());
  return Response.json({ viewer: person });
});

/** Signs out. */
export const DELETE = handle(async () => {
  await endSession();
  return Response.json({ ok: true });
});
