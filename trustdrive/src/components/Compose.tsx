"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useApp } from "./AppContext";
import { Icon } from "./Icons";
import type { Conversation, Participant } from "@/lib/types";
import { useEscape } from "./useEscape";

/**
 * Writing email and Teams messages from anywhere in the app. Messages stay inside TrustDrive (see
 * src/lib/messaging.ts); after sending, a "trustdrive:message-sent" event lets open lists refresh.
 */

export interface ComposeRequest {
  source: Conversation["source"];
  to?: Participant[];
  subject?: string;
  /** Reply in this conversation. */
  conversationId?: string;
  /** Shown for replies. */
  conversationTitle?: string;
}

export const MESSAGE_SENT = "trustdrive:message-sent";

const ComposeCtx = createContext<((r: ComposeRequest) => void) | null>(null);

export function useCompose() {
  const open = useContext(ComposeCtx);
  if (!open) throw new Error("useCompose outside ComposeProvider");
  return open;
}

export function ComposeProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<ComposeRequest | null>(null);
  const [sent, setSent] = useState<{ conversationId: string; undelivered: string[] } | null>(null);
  const open = useCallback((r: ComposeRequest) => {
    setSent(null);
    setRequest(r);
  }, []);
  return (
    <ComposeCtx.Provider value={open}>
      {children}
      {request && (
        <ComposeDialog
          key={JSON.stringify(request)}
          request={request}
          onClose={() => setRequest(null)}
          onSent={(s) => {
            setRequest(null);
            setSent(s);
            window.dispatchEvent(new CustomEvent(MESSAGE_SENT, { detail: s }));
          }}
        />
      )}
      {sent && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl">
          <span>
            Sent.
            {sent.undelivered.length > 0 && <span className="text-slate-300"> {sent.undelivered.join(", ")} won&apos;t receive it – external email isn&apos;t connected yet.</span>}
          </span>
          <Link href={`/conversations?c=${sent.conversationId}`} onClick={() => setSent(null)} className="font-medium text-[#a8c7fa] hover:underline">
            Open conversation
          </Link>
          <button onClick={() => setSent(null)} className="text-slate-400 hover:text-white" aria-label="Dismiss">✕</button>
        </div>
      )}
    </ComposeCtx.Provider>
  );
}

/** "Name <a@b.c>", "a@b.c" or a colleague's name. */
function parseRecipient(input: string, people: ReturnType<typeof useApp>["people"]): Participant | null {
  const text = input.trim();
  if (!text) return null;
  const m = text.match(/^(.*?)\s*<([^>]+@[^>]+)>$/) ?? text.match(/^()([^\s@]+@[^\s@]+\.[^\s@]+)$/);
  if (m) {
    const email = m[2].toLowerCase();
    const colleague = people.find((p) => p.email?.toLowerCase() === email);
    return colleague ? { personId: colleague.id, name: colleague.name, email: colleague.email } : { name: m[1] || email, email };
  }
  const colleague = people.find((p) => p.active && p.name.toLowerCase() === text.toLowerCase());
  return colleague ? { personId: colleague.id, name: colleague.name, email: colleague.email } : null;
}

function ComposeDialog({ request, onClose, onSent }: { request: ComposeRequest; onClose: () => void; onSent: (s: { conversationId: string; undelivered: string[] }) => void }) {
  useEscape(true, onClose);
  const { people, viewerId } = useApp();
  const reply = !!request.conversationId;
  const teams = request.source === "teams";
  const [to, setTo] = useState<Participant[]>((request.to ?? []).filter((p) => p.personId !== viewerId));
  const [adding, setAdding] = useState("");
  const [subject, setSubject] = useState(request.subject ?? "");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const colleagues = useMemo(() => people.filter((p) => p.active && p.id !== viewerId), [people, viewerId]);

  const add = () => {
    const p = parseRecipient(adding, people);
    if (!p) return setError(teams ? "Pick a colleague from the list" : "Enter an email address or a colleague's name");
    if (teams && !p.personId) return setError("Teams chats are with colleagues only");
    setError(null);
    setTo((cur) => (cur.some((c) => (c.personId ?? c.email) === (p.personId ?? p.email)) ? cur : [...cur, p]));
    setAdding("");
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        body: JSON.stringify({ source: request.source, conversationId: request.conversationId, to, subject: reply ? undefined : subject, body }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.issues?.join(", ") ?? json.error ?? `Sending failed (${res.status})`);
      onSent({ conversationId: json.conversationId, undelivered: json.undelivered ?? [] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500";
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
          <span className={`grid h-8 w-8 place-items-center rounded-lg ${teams ? "bg-[#ebe9fb]" : "bg-[#e8f0fe]"}`}>
            <Icon name={teams ? "chat" : "reply"} color={teams ? "#5b5fc7" : "#0b57d0"} size={18} />
          </span>
          <h2 className="min-w-0 flex-1 truncate text-lg font-medium text-slate-900">
            {reply ? `Reply: ${request.conversationTitle ?? "conversation"}` : teams ? "New Teams chat" : "New email"}
          </h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close">✕</button>
        </div>
        <div className="space-y-3 px-6 py-4">
          {!reply && (
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className="w-12 text-xs text-slate-500">To</span>
                {to.map((p) => (
                  <span key={p.personId ?? p.email ?? p.name} className="flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-xs text-slate-800" title={p.email}>
                    {p.name}
                    {!p.personId && <span className="text-slate-500">(client)</span>}
                    <button onClick={() => setTo((cur) => cur.filter((c) => c !== p))} className="rounded-full px-1 text-slate-500 hover:bg-slate-200" aria-label={`Remove ${p.name}`}>✕</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2 pl-14">
                <input
                  value={adding}
                  onChange={(e) => setAdding(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
                  list="compose-people"
                  placeholder={teams ? "Add a colleague" : "Add a colleague or an email address"}
                  className={field}
                />
                <datalist id="compose-people">
                  {colleagues.map((p) => <option key={p.id} value={p.name}>{p.role}</option>)}
                </datalist>
                <button onClick={add} className="shrink-0 rounded-full px-3 text-sm text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50">Add</button>
              </div>
            </div>
          )}
          {!reply && !teams && <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className={field} />}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && body.trim() && send()}
            placeholder={teams ? "Type a message" : "Write your email"}
            autoFocus
            rows={teams ? 4 : 8}
            className={`${field} resize-none leading-6`}
          />
          {to.some((p) => !p.personId) ? (
            <p className="flex items-center gap-1.5 rounded-lg bg-[#fef7e0] px-3 py-2 text-xs text-[#7a4a00]">
              <Icon name="cloudOff" size={14} color="#b06000" />
              {to.filter((p) => !p.personId).map((p) => p.name).join(", ")} won&apos;t receive this: email outside the company isn&apos;t connected yet. It&apos;s kept in the conversation.
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <Icon name="cloudOff" size={14} color="#94a3b8" />
              Delivered inside TrustDrive: colleagues see it in Conversations and get a notification.
            </p>
          )}
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button onClick={onClose} className="rounded-full px-4 py-2 text-sm text-slate-700 hover:bg-slate-100">Cancel</button>
          <button onClick={send} disabled={busy || !body.trim() || (!reply && !to.length)} className="rounded-full bg-[#0b57d0] px-5 py-2 text-sm font-medium text-white hover:bg-[#0842a0] disabled:opacity-50">
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
