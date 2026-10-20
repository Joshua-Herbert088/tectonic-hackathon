import { cookies } from "next/headers";
import { z } from "zod";
import { requireViewer, VIEWER_COOKIE } from "@/lib/auth";
import { config } from "@/lib/config";
import { findPerson } from "@/lib/db";
import { handle, HttpError, readBody } from "@/lib/http";

/** Who the drive is viewed as. */
export const GET = handle(async (req) => {
  const viewer = await requireViewer(req);
  return Response.json({ viewer, canSwitch: true });
});

/** View the drive as someone else. */
export const POST = handle(async (req) => {
  const { viewerId } = await readBody(req, z.object({ viewerId: z.string() }));
  const person = await findPerson({ id: viewerId });
  if (!person?.active) throw new HttpError(400, "Unknown or inactive person");
  (await cookies()).set(VIEWER_COOKIE, person.id, { httpOnly: true, sameSite: "lax", secure: config.production, path: "/", maxAge: 60 * 60 * 24 * 30 });
  return Response.json({ viewer: person });
});
