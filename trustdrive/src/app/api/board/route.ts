import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { askQuestion, boardList } from "@/lib/board";
import { handle, readBody } from "@/lib/http";

/** The message board: its questions, and answers from chats that the people who gave them shared. */
export const GET = handle(async (req) => Response.json(await boardList(await requireViewer(req))));

/** Posts a question; the colleagues who know most about it are asked to answer. */
export const POST = handle(async (req) => {
  const viewer = await requireViewer(req);
  const body = await readBody(req, z.object({ title: z.string().max(300), details: z.string().max(5000).optional() }));
  return Response.json(await askQuestion(viewer, body));
});
