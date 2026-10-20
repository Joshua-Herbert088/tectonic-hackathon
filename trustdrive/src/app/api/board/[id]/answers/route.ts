import { after } from "next/server";
import { z } from "zod";
import { captureAnswers } from "@/lib/answers";
import { requireViewer } from "@/lib/auth";
import { reply } from "@/lib/board";
import { handle, readBody } from "@/lib/http";

/** Answers a board question; it's captured (topics, conflict check) in the background. */
export const POST = handle(async (req, ctx: RouteContext<"/api/board/[id]/answers">) => {
  const viewer = await requireViewer(req);
  const { body } = await readBody(req, z.object({ body: z.string().max(20_000) }));
  await reply(viewer, (await ctx.params).id, body);
  after(captureAnswers);
  return Response.json({ ok: true });
});
