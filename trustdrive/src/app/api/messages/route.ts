import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { handle, readBody } from "@/lib/http";
import { sendMessage } from "@/lib/messaging";

const participant = z.object({ personId: z.string().optional(), name: z.string().max(200).default(""), email: z.string().email().max(320).optional() });

/** Sends an email or Teams message inside TrustDrive: a reply (conversationId) or a new conversation. */
export const POST = handle(async (req) => {
  const viewer = await requireViewer(req);
  const body = await readBody(
    req,
    z.object({
      conversationId: z.string().optional(),
      source: z.enum(["email", "teams"]),
      to: z.array(participant).max(20).default([]),
      subject: z.string().max(300).optional(),
      body: z.string().trim().min(1, "Write a message").max(20_000),
    }),
  );
  return Response.json(await sendMessage(viewer, body));
});
