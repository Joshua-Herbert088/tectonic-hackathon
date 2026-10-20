import crypto from "node:crypto";
import { after } from "next/server";
import { captureAnswers } from "@/lib/answers";
import { requireViewer } from "@/lib/auth";
import { matchAuthors, parseEmailChain, parseEml, parseTeamsChat } from "@/lib/conversationImport";
import { createConversation, loadAnswers, loadConversations, loadWorld } from "@/lib/db";
import { handle, HttpError, readBody } from "@/lib/http";
import { conversationImport } from "@/lib/schemas";

/** All conversations, and which messages were kept as answers to a colleague's question. */
export const GET = handle(async (req) => {
  await requireViewer(req);
  const [conversations, answers] = await Promise.all([loadConversations(), loadAnswers()]);
  return Response.json({
    conversations,
    answers: answers.map((a) => ({ id: a.id, conversationId: a.conversationId, questionMessageId: a.questionMessageId, answerMessageId: a.answerMessageId, askerId: a.askerId, topics: a.topics })),
  });
});

/**
 * Imports an email chain or Teams chat: `eml` (the raw file) or `text` (pasted), with `source`
 * ("email" | "teams"). The client is taken from `clientId`, or recognised from the senders' domain.
 */
export const POST = handle(async (req) => {
  const viewer = await requireViewer(req);
  const body = await readBody(req, conversationImport);
  const world = await loadWorld();
  const now = new Date().toISOString();
  const me = { authorName: viewer.name, authorEmail: viewer.email, sentAt: now };

  let title = body.title?.trim() ?? "";
  let parsed;
  if (body.eml?.trim()) {
    const eml = parseEml(body.eml);
    parsed = eml.messages;
    title ||= eml.subject;
  } else parsed = body.source === "teams" ? parseTeamsChat(body.text!, me) : parseEmailChain(body.text!, me);

  const messages = matchAuthors(parsed, world.people);
  if (!messages.length) throw new HttpError(400, "No messages found in what was pasted.");
  const domainOf = (email?: string) => email?.split("@")[1]?.toLowerCase();
  const clientId =
    world.clients.find((c) => c.id === body.clientId)?.id ?? world.clients.find((c) => c.domain && messages.some((m) => domainOf(m.authorEmail) === c.domain))?.id;
  title ||= body.source === "teams" ? [...new Set(messages.map((m) => m.authorName))].join(", ") : messages[0].body.split("\n")[0].slice(0, 60) || "Imported email";

  const id = `conv-${crypto.randomUUID()}`;
  const participants = [...new Map(messages.map((m) => [m.authorEmail ?? m.authorName, { personId: m.personId, name: m.authorName, email: m.authorEmail }])).values()];
  await createConversation({ id, source: body.source, title, clientId, importedById: viewer.id, createdAt: now, participants }, messages);
  after(captureAnswers);
  return Response.json({ id, clientId: clientId ?? null, messages: messages.length });
});
