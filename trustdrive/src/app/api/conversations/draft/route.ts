import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { loadConversations, loadWorld } from "@/lib/db";
import { buildHandoverDraft } from "@/lib/handoverDraft";
import { handle, HttpError, readBody } from "@/lib/http";

/** Drafts a client handover document from the selected conversations. Nothing is saved. */
export const POST = handle(async (req) => {
  await requireViewer(req);
  const body = await readBody(req, z.object({ conversationIds: z.array(z.string()).max(30), clientId: z.string().nullish() }));
  const [conversations, world] = await Promise.all([loadConversations(body.conversationIds), loadWorld()]);
  if (!conversations.length) throw new HttpError(400, "Select at least one conversation.");
  const clientId = world.clients.some((c) => c.id === body.clientId) ? body.clientId! : conversations.find((c) => c.clientId)?.clientId;
  return Response.json(await buildHandoverDraft(world, conversations, clientId));
});
