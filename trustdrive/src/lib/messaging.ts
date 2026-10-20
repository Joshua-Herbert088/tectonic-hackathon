import crypto from "node:crypto";
import { addMessages, createConversation, insertNotifications, loadConversations, loadWorld, setConversationPrivate } from "./db";
import { HttpError } from "./http";
import type { Client, Conversation, Db, Participant, Person } from "./types";

/**
 * Email and Teams between colleagues, inside TrustDrive: a sent message is stored in its conversation
 * and the colleagues on it get a notification. Nothing leaves the app – people outside the company
 * (client contacts) are kept on the thread but don't receive anything until external email is connected.
 */

export interface Outgoing {
  /** Reply in this conversation; otherwise a new one (or, for Teams, the existing chat with the same people). */
  conversationId?: string;
  source: Conversation["source"];
  to: Participant[];
  subject?: string;
  body: string;
  /** "Don't keep for others" on (true) or off (false) for the conversation; unset leaves it as it is. */
  keepPrivate?: boolean;
}

const PREVIEW_CHARS = 140;

const keyOf = (p: Participant) => p.personId ?? p.email?.toLowerCase() ?? p.name.toLowerCase();

/** Fills in colleagues from the directory: by id, or recognised by their address. */
function resolve(db: Db, p: Participant): Participant {
  const person = db.people.find((x) => (p.personId && x.id === p.personId) || (p.email && x.email?.toLowerCase() === p.email.toLowerCase()));
  return person ? { personId: person.id, name: person.name, email: person.email } : { name: p.name.trim() || p.email || "Unknown", email: p.email?.toLowerCase() };
}

function clientOf(db: Db, people: Participant[]): Client | undefined {
  return db.clients.find((c) => c.domain && people.some((p) => p.email?.endsWith(`@${c.domain}`)));
}

/** Sends a message; `undelivered` names the recipients outside the company, who don't receive it. */
export async function sendMessage(viewer: Person, out: Outgoing): Promise<{ conversationId: string; undelivered: string[] }> {
  const db = await loadWorld();
  const me: Participant = { personId: viewer.id, name: viewer.name, email: viewer.email };
  const to = [...new Map(out.to.map((p) => resolve(db, p)).filter((p) => p.personId !== viewer.id).map((p) => [keyOf(p), p])).values()];
  const now = new Date();
  const message = { personId: viewer.id, authorName: viewer.name, authorEmail: viewer.email, sentAt: now.toISOString(), body: out.body.trim() };

  let conv = out.conversationId ? (await loadConversations([out.conversationId]))[0] : undefined;
  if (out.conversationId && !conv) throw new HttpError(404, "Conversation not found");
  if (!conv && out.source === "teams") {
    // Teams keeps one chat per group of people.
    const wanted = new Set([keyOf(me), ...to.map(keyOf)]);
    conv = (await loadConversations()).find((c) => c.source === "teams" && c.participants.length === wanted.size && c.participants.every((p) => wanted.has(keyOf(p))));
  }
  if (!conv && !to.length) throw new HttpError(400, "Add at least one recipient");

  let conversationId: string;
  let title: string;
  let everyone: Participant[];
  if (conv) {
    conversationId = conv.id;
    title = conv.title;
    everyone = [...new Map([...conv.participants, ...to, me].map((p) => [keyOf(p), p])).values()];
    await addMessages(conv.id, [message], [...to, me]);
    if (out.keepPrivate !== undefined && out.keepPrivate !== !!conv.keepPrivate) await setConversationPrivate(conv.id, out.keepPrivate);
  } else {
    conversationId = `conv-${crypto.randomUUID()}`;
    everyone = [me, ...to];
    title = out.subject?.trim() || (out.source === "teams" ? everyone.map((p) => p.name).join(", ") : "(no subject)");
    await createConversation({ id: conversationId, source: out.source, title, clientId: clientOf(db, to)?.id, createdAt: message.sentAt, participants: everyone, keepPrivate: out.keepPrivate }, [message]);
  }

  // Colleagues on the thread hear about it; people who left don't.
  const preview = message.body.replace(/\s+/g, " ").slice(0, PREVIEW_CHARS);
  const notifications = everyone
    .filter((p) => p.personId && p.personId !== viewer.id && db.people.find((x) => x.id === p.personId)?.active)
    .map((p) => ({ recipientId: p.personId!, actorId: viewer.id, kind: "message" as const, docId: conversationId, docTitle: title, changes: [], reason: preview }));

  await insertNotifications(notifications);
  return { conversationId, undelivered: everyone.filter((p) => !p.personId).map((p) => p.name) };
}

