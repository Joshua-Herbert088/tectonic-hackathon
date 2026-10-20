import { after } from "next/server";
import { z } from "zod";
import { captureAnswers } from "@/lib/answers";
import { requireViewer } from "@/lib/auth";
import { loadConversations, setConversationPrivate } from "@/lib/db";
import { handle, HttpError, readBody } from "@/lib/http";

/**
 * "Don't keep for others" on or off. Anyone on the conversation can switch it; making it private deletes
 * the answers captured from it.
 */
export const PATCH = handle(async (req, ctx: RouteContext<"/api/conversations/[id]">) => {
  const viewer = await requireViewer(req);
  const { id } = await ctx.params;
  const { keepPrivate } = await readBody(req, z.object({ keepPrivate: z.boolean() }));
  const [conv] = await loadConversations([id]);
  if (!conv) throw new HttpError(404, "Not found");
  if (!conv.participants.some((p) => p.personId === viewer.id)) throw new HttpError(403, "Only people on the conversation can change this.");
  await setConversationPrivate(id, keepPrivate);
  if (!keepPrivate) after(captureAnswers);
  return Response.json({ keepPrivate });
});
