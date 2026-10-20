import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { boardThread, markSolved } from "@/lib/board";
import { handle, HttpError, readBody } from "@/lib/http";

type Ctx = RouteContext<"/api/board/[id]">;

/** A question with its answers, and what else is known about it. */
export const GET = handle(async (req, ctx: Ctx) => {
  const viewer = await requireViewer(req);
  const thread = await boardThread((await ctx.params).id, viewer);
  if (!thread) throw new HttpError(404, "Not found");
  return Response.json(thread);
});

/** The asker marks the answer that solved it (`solvedMessageId`, or null). */
export const PATCH = handle(async (req, ctx: Ctx) => {
  const viewer = await requireViewer(req);
  const { solvedMessageId } = await readBody(req, z.object({ solvedMessageId: z.number().int().nullable() }));
  await markSolved(viewer, (await ctx.params).id, solvedMessageId);
  return Response.json({ solvedMessageId });
});
