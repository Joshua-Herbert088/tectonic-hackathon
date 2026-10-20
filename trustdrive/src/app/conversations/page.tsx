"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppContext";
import { AppShell } from "@/components/AppShell";
import { MESSAGE_SENT, useCompose } from "@/components/Compose";
import { Avatar } from "@/components/TopBar";
import { isInternal } from "@/lib/answerDoc";
import { timeAgo } from "@/lib/time";
import type { Conversation, Message } from "@/lib/types";
import { useEscape } from "@/components/useEscape";

const POLL_MS = 4_000;

/** A message kept as the answer to a colleague's question (see answers.ts). */
interface KeptAnswer {
  id: number;
  conversationId: string;
  questionMessageId: number;
  answerMessageId: number;
  askerId: string;
  answererId: string;
  topics: string[];
  sharing: "pending" | "shared";
}

/** The connected mailbox and Teams chats: read them, import more, and turn a selection into a client handover document. */
export default function ConversationsPage() {
  const router = useRouter();
  const { clients, clientName, viewerId } = useApp();
  const compose = useCompose();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [answers, setAnswers] = useState<KeptAnswer[]>([]);
  const [mineOnly, setMineOnly] = useState(false);
  const [newMenu, setNewMenu] = useState(false);
  useEscape(newMenu, () => setNewMenu(false));
  // Arriving from a document's citation: the quoted message and the start of the quote.
  const [cited, setCited] = useState<{ conversationId: string; messageId: number; quote: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [reload, setReload] = useState(0);
  // The URL's c/m/q/client are applied on the first load only, so polling doesn't undo what the user changed since.
  const urlApplied = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((j: { conversations: Conversation[]; answers: KeptAnswer[] }) => {
        if (cancelled) return;
        setConversations(j.conversations);
        setAnswers(j.answers ?? []);
        const params = new URLSearchParams(window.location.search);
        // "?import=1" (the New menu) opens the import dialog once; drop it so the next poll doesn't reopen it.
        if (params.get("import")) {
          setImporting(true);
          params.delete("import");
          const rest = params.toString();
          window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
        }
        const first = !urlApplied.current;
        urlApplied.current = true;
        // Arriving from a document: open the cited conversation, or show that client's conversations.
        const wanted = first ? params.get("c") : null;
        const m = Number(params.get("m"));
        if (wanted && m) setCited((cur) => cur ?? { conversationId: wanted, messageId: m, quote: params.get("q") ?? "" });
        const client = first ? params.get("client") : null;
        if (client) setClientFilter((cur) => (cur === "all" ? client : cur));
        setOpenId((cur) => cur ?? (wanted && j.conversations.some((c) => c.id === wanted) ? wanted : (j.conversations[0]?.id ?? null)));
      })
      .catch(() => !cancelled && setError("Could not load conversations."));
    return () => {
      cancelled = true;
    };
  }, [reload]);

  // New messages: ones sent from anywhere in the app, and colleagues' messages arriving.
  useEffect(() => {
    const onSent = (e: Event) => {
      setOpenId((e as CustomEvent<{ conversationId: string }>).detail.conversationId);
      setReload((n) => n + 1);
    };
    window.addEventListener(MESSAGE_SENT, onSent);
    const poll = setInterval(() => document.visibilityState === "visible" && setReload((n) => n + 1), POLL_MS);
    return () => {
      window.removeEventListener(MESSAGE_SENT, onSent);
      clearInterval(poll);
    };
  }, []);

  const shown = useMemo(
    () =>
      (conversations ?? []).filter(
        (c) =>
          (clientFilter === "all" || (clientFilter === "none" ? !c.clientId : c.clientId === clientFilter)) &&
          (!mineOnly || c.participants.some((p) => p.personId === viewerId) || c.messages.some((m) => m.personId === viewerId)),
      ),
    [conversations, clientFilter, mineOnly, viewerId],
  );
  const open = conversations?.find((c) => c.id === openId) ?? null;
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const selectedConvs = (conversations ?? []).filter((c) => selected.includes(c.id));
  const selectedClients = [...new Set(selectedConvs.map((c) => c.clientId).filter(Boolean))];

  // Without ticked conversations: all of the filtered client's, or else the open one.
  const filteredClient = clientFilter !== "all" && clientFilter !== "none" ? clientFilter : "";
  const targets = selected.length ? selected : filteredClient ? shown.map((c) => c.id) : open ? [open.id] : [];
  const targetLabel = selected.length
    ? `(${selected.length} selected)`
    : filteredClient
      ? `for ${clientName(filteredClient)} (${shown.length})`
      : open
        ? "from this one"
        : "";
  const draft = () => {
    const targetClients = [...new Set((conversations ?? []).filter((c) => targets.includes(c.id)).map((c) => c.clientId).filter(Boolean))];
    const client = targetClients.length === 1 ? targetClients[0] : filteredClient;
    router.push(`/conversations/handover?ids=${targets.join(",")}${client ? `&client=${client}` : ""}`);
  };

  const onImported = useCallback((id: string) => {
    setImporting(false);
    setOpenId(id);
    setReload((n) => n + 1);
  }, []);

  return (
    <AppShell>
      {importing && <ImportDialog onClose={() => setImporting(false)} onImported={onImported} defaultClient={clientFilter !== "all" && clientFilter !== "none" ? clientFilter : ""} />}
      <div className="flex flex-wrap items-center gap-3 px-2 pb-3">
        <h1 className="text-2xl text-slate-800">Conversations</h1>
        <div className="relative">
          <button onClick={() => setNewMenu(!newMenu)} className="whitespace-nowrap rounded-full bg-white px-4 py-1.5 text-sm font-medium text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50">
            New ▾
          </button>
          {newMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setNewMenu(false)} />
              <div className="absolute left-0 z-20 mt-1 w-56 rounded-xl bg-white py-1.5 shadow-xl ring-1 ring-black/5">
                {[
                  { label: "Email", run: () => compose({ source: "email" }) },
                  { label: "Teams chat", run: () => compose({ source: "teams" }) },
                  { label: "Import a chain or chat…", run: () => setImporting(true) },
                ].map((o) => (
                  <button key={o.label} onClick={() => { setNewMenu(false); o.run(); }} className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-100">{o.label}</button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <label className="flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-700">
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> Involving me
          </label>
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm">
            <option value="all">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
            <option value="none">No client</option>
          </select>
          <button
            onClick={draft}
            disabled={!targets.length}
            title="Tick conversations to choose which ones go in"
            className="whitespace-nowrap rounded-full bg-[#0b57d0] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#0842a0] disabled:opacity-40"
          >
            Create handover document {targetLabel}
          </button>
        </div>
      </div>
      {selectedClients.length > 1 && (
        <div className="mx-2 mb-2 rounded-lg bg-[#fef7e0] px-3 py-2 text-xs text-[#7a4a00]">The selection spans {selectedClients.length} clients – a handover document is usually about one.</div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <aside className="flex max-h-[38vh] w-full shrink-0 flex-col overflow-hidden rounded-2xl bg-white lg:max-h-none lg:w-[420px]">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
            <span>{shown.length} conversation{shown.length === 1 ? "" : "s"} · tick to combine several</span>
            {shown.length > 0 && (
              <button onClick={() => setSelected(shown.every((c) => selected.includes(c.id)) ? selected.filter((id) => !shown.some((c) => c.id === id)) : [...new Set([...selected, ...shown.map((c) => c.id)])])} className="text-blue-700 hover:underline">
                {shown.every((c) => selected.includes(c.id)) ? "Clear selection" : "Select all shown"}
              </button>
            )}
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {!conversations && !error && <li className="p-4 text-sm text-slate-500">Loading…</li>}
            {error && <li className="p-4 text-sm text-red-700">{error}</li>}
            {conversations && shown.length === 0 && <li className="p-4 text-sm text-slate-500">No conversations here.</li>}
            {shown.map((c) => {
              const last = c.messages.at(-1);
              return (
                <li key={c.id} className={`flex items-start gap-3 border-b border-slate-100 px-4 py-3 ${openId === c.id ? "bg-[#e8f0fe]" : "hover:bg-slate-50"}`}>
                  <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} className="mt-1" aria-label={`Select ${c.title}`} />
                  <button onClick={() => setOpenId(c.id)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <SourceIcon source={c.source} />
                      <span className="truncate text-sm font-medium text-slate-900">{c.title}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-slate-500">{last ? timeAgo(last.sentAt) : ""}</span>
                    </div>
                    <div className="truncate text-xs text-slate-600">{[...new Set(c.messages.map((m) => m.authorName))].join(", ")}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                      {c.clientId ? <span className="rounded-full bg-slate-100 px-2">{clientName(c.clientId)}</span> : <span className="text-slate-400">no client</span>}
                      <span>{c.messages.length} message{c.messages.length === 1 ? "" : "s"}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <main className="min-w-0 flex-1 overflow-hidden rounded-2xl bg-white">
          {open ? <ConversationView key={open.id} c={open} answers={answers.filter((a) => a.conversationId === open.id)} cited={cited?.conversationId === open.id ? cited : null} onSent={() => setReload((n) => n + 1)} /> : <div className="grid h-full place-items-center text-sm text-slate-500">Select a conversation</div>}
        </main>
      </div>
    </AppShell>
  );
}

function SourceIcon({ source }: { source: Conversation["source"] }) {
  return source === "email" ? (
    <span title="Email" className="grid h-5 w-5 shrink-0 place-items-center rounded bg-[#e8f0fe] text-[11px] text-[#0b57d0]">✉</span>
  ) : (
    <span title="Teams chat" className="grid h-5 w-5 shrink-0 place-items-center rounded bg-[#ebe9fb] text-[10px] font-bold text-[#5b5fc7]">T</span>
  );
}

function Author({ m, size = 32 }: { m: Message; size?: number }) {
  const { person } = useApp();
  const p = person(m.personId);
  if (p) return <Avatar person={p} size={size} />;
  const initials = m.authorName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="grid shrink-0 place-items-center rounded-full bg-slate-300 font-medium text-white" style={{ width: size, height: size, fontSize: size * 0.4 }} title={`${m.authorName} (client)`}>
      {initials}
    </div>
  );
}

function ConversationView({ c, answers, cited, onSent }: { c: Conversation; answers: KeptAnswer[]; cited: { messageId: number; quote: string } | null; onSent: () => void }) {
  const { clientName, person, viewerId } = useApp();
  const keptFor = (m: Message) => answers.find((a) => a.answerMessageId === m.id);
  const others = c.participants.filter((p) => p.personId !== viewerId);
  // The cited message in view when arriving from a document; otherwise the newest, also when one arrives.
  const scroller = useRef<HTMLDivElement>(null);
  const citedShown = useRef(false);
  useEffect(() => {
    const target = cited && !citedShown.current ? document.getElementById(`msg-${cited.messageId}`) : null;
    if (target) {
      target.scrollIntoView({ block: "center" });
      citedShown.current = true;
    } else if (!cited) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [c.messages.length, cited]);
  const body = (m: Message) => (cited?.messageId === m.id ? highlight(m.body, cited.quote) : m.body);
  const citedRing = (m: Message) => (cited?.messageId === m.id ? "ring-2 ring-[#f9ab00]" : "");
  return (
    <div className="flex h-full flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-6">
          <div className="mb-1 flex items-center gap-2">
            <SourceIcon source={c.source} />
            <h2 className="text-xl text-slate-900">{c.title}</h2>
          </div>
          <div className="mb-5 text-xs text-slate-500">
            {c.source === "email" ? "Email thread" : "Teams chat"}
            {c.clientId && <> · {clientName(c.clientId)}</>}
            {c.importedById && <> · imported by {person(c.importedById)?.name}</>}
            {c.participants.length > 0 && <> · with {c.participants.map((p) => (p.personId === viewerId ? "you" : p.name)).join(", ")}</>}
          </div>
          {isInternal(c) && <KeepForOthers c={c} kept={answers.length} onChanged={onSent} />}
          {c.source === "email" ? (
            <ol className="space-y-3">
              {c.messages.map((m) => (
                <li key={m.id} id={`msg-${m.id}`} className={`rounded-xl border border-slate-200 p-4 ${citedRing(m)}`}>
                  <div className="mb-2 flex items-center gap-3">
                    <Author m={m} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-900">
                        {m.personId === viewerId ? "You" : m.authorName}
                        {!m.personId && <span className="ml-1 rounded-full bg-slate-100 px-1.5 text-[10px] font-normal text-slate-600">client</span>}
                        {cited?.messageId === m.id && <CitedTag />}
                      </div>
                      <div className="truncate text-[11px] text-slate-500">{m.authorEmail}</div>
                    </div>
                    <span className="text-[11px] text-slate-500" title={new Date(m.sentAt).toLocaleString()}>{timeAgo(m.sentAt)}</span>
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{body(m)}</div>
                  <KeptChip a={keptFor(m)} />
                </li>
              ))}
            </ol>
          ) : (
            <ol className="space-y-3">
              {c.messages.map((m) => {
                const mine = m.personId === viewerId;
                return (
                  <li key={m.id} id={`msg-${m.id}`} className={`flex items-start gap-3 ${mine ? "flex-row-reverse" : ""}`}>
                    <Author m={m} size={28} />
                    <div className={`min-w-0 ${mine ? "text-right" : ""}`}>
                      <div className="text-[11px] text-slate-500">
                        <span className="font-medium text-slate-700">{mine ? "You" : m.authorName}</span> · <span title={new Date(m.sentAt).toLocaleString()}>{timeAgo(m.sentAt)}</span>
                        {cited?.messageId === m.id && <CitedTag />}
                      </div>
                      <div className={`mt-0.5 inline-block whitespace-pre-wrap rounded-2xl px-3 py-2 text-left text-sm ${mine ? "rounded-tr-sm bg-[#5b5fc7] text-white" : "rounded-tl-sm bg-[#f0f0fa] text-slate-800"} ${citedRing(m)}`}>{body(m)}</div>
                      <KeptChip a={keptFor(m)} />
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
      <Reply c={c} recipients={others} onSent={onSent} />
    </div>
  );
}

/** Under a message kept as an answer: whose question it answered, whether it's shared, and where colleagues find it. */
function KeptChip({ a }: { a?: KeptAnswer }) {
  const { person, taxonomy, viewerId } = useApp();
  if (!a) return null;
  const topic = taxonomy.mostSpecific(a.topics)[0];
  const label = topic ? taxonomy.tagLabel(topic) : null;
  if (a.sharing === "pending") {
    return (
      <div className="mt-1 text-[11px] text-slate-500">
        {a.answererId === viewerId ? (
          <>
            Could help others: <Link href="/#share" className="text-blue-700 hover:underline">share it?</Link>
          </>
        ) : (
          `Not shared: ${person(a.answererId)?.name.split(" ")[0] ?? "they"} decides`
        )}
      </div>
    );
  }
  return (
    <div className="mt-1 text-[11px] text-slate-500">
      Shared as the answer to {person(a.askerId)?.name.split(" ")[0] ?? "a colleague"}&apos;s question
      {label && (
        <>
          {" "}
          about{" "}
          <Link href={`/ask?q=${encodeURIComponent(label)}`} className="text-blue-700 hover:underline">
            {label}
          </Link>
        </>
      )}
    </div>
  );
}

/**
 * Whether answers in a chat among colleagues are kept for others. Anyone on it can switch it off, which
 * removes what was kept; switching it back on looks at the whole conversation again.
 */
function KeepForOthers({ c, kept, onChanged }: { c: Conversation; kept: number; onChanged: () => void }) {
  const { viewerId } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onIt = c.participants.some((p) => p.personId === viewerId);
  const set = async (keepPrivate: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${c.id}`, { method: "PATCH", body: JSON.stringify({ keepPrivate }) });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not change it.");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <span className="min-w-0 flex-1">
        {c.keepPrivate
          ? "Private: answers in this conversation aren't kept for colleagues."
          : kept
            ? `${kept} answer${kept === 1 ? "" : "s"} found here. Whoever answered decides whether others see it; shared answers don't show who asked.`
            : "Answers to work questions here can be shared with colleagues who ask the same thing, if whoever answered agrees."}
      </span>
      {onIt && (
        <button onClick={() => set(!c.keepPrivate)} disabled={busy} className="shrink-0 rounded-full px-3 py-1 font-medium text-blue-700 ring-1 ring-slate-300 hover:bg-blue-50 disabled:opacity-60">
          {c.keepPrivate ? "Keep answers for colleagues" : "Don't keep for others"}
        </button>
      )}
      {error && <span className="w-full text-red-700">{error}</span>}
    </div>
  );
}

function CitedTag() {
  return <span className="ml-1 rounded-full bg-[#fef7e0] px-1.5 text-[10px] font-medium text-[#b06000]">Quoted in a document</span>;
}

/**
 * The message with the quoted sentence marked. The quote is matched word by word, so line breaks in
 * the message don't matter; a quote that was changed (e.g. personal data removed) just isn't marked.
 */
function highlight(body: string, quote: string) {
  const words = quote.split(/\s+/).filter(Boolean);
  if (!words.length) return body;
  const match = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "i").exec(body);
  if (!match) return body;
  // Mark through the end of the sentence the quote starts.
  const end = body.slice(match.index + match[0].length).search(/[.!?](\s|$)/);
  const stop = end < 0 ? body.length : match.index + match[0].length + end + 1;
  return (
    <>
      {body.slice(0, match.index)}
      <mark className="rounded bg-[#fde293] px-0.5 text-slate-900">{body.slice(match.index, stop)}</mark>
      {body.slice(stop)}
    </>
  );
}

/** Answer in the open conversation: reply-all for email, a chat message for Teams. */
function Reply({ c, recipients, onSent }: { c: Conversation; recipients: Conversation["participants"]; onSent: () => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/messages", { method: "POST", body: JSON.stringify({ conversationId: c.id, source: c.source, body }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Sending failed (${res.status})`);
      setBody("");
      onSent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const teams = c.source === "teams";
  return (
    <div className="border-t border-slate-100 bg-white px-6 py-3">
      <div className="mx-auto max-w-3xl">
        <div className="mb-1 text-[11px] text-slate-500">
          {teams ? "Message" : "Reply to all"}
          {recipients.length > 0 && <> · {recipients.map((p) => p.name).join(", ")}</>}
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              // Teams sends on Enter; email on Ctrl/Cmd+Enter.
              if (e.key === "Enter" && (teams ? !e.shiftKey : e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
            rows={teams ? 1 : 3}
            placeholder={teams ? "Type a message" : "Write a reply (Ctrl+Enter to send)"}
            className="min-h-[40px] flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm leading-6 outline-none focus:border-blue-500"
          />
          <button onClick={send} disabled={busy || !body.trim()} className="rounded-full bg-[#0b57d0] px-4 py-2 text-sm font-medium text-white hover:bg-[#0842a0] disabled:opacity-50">
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
        {error && <div className="mt-1 text-xs text-red-700">{error}</div>}
      </div>
    </div>
  );
}

function ImportDialog({ onClose, onImported, defaultClient }: { onClose: () => void; onImported: (id: string) => void; defaultClient: string }) {
  useEscape(true, onClose);
  const { clients } = useApp();
  const [source, setSource] = useState<Conversation["source"]>("email");
  const [clientId, setClientId] = useState(defaultClient);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [eml, setEml] = useState<{ name: string; raw: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500";

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/conversations", { method: "POST", body: JSON.stringify({ source, clientId: clientId || undefined, title, text: eml ? undefined : text, eml: eml?.raw }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Import failed (${res.status})`);
      onImported(json.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-medium text-slate-900">Import a conversation</h2>
          <p className="text-sm text-slate-600">Paste an email chain or a Teams chat, or choose an .eml file. Colleagues are recognised by name or address, the client by the senders&apos; domain.</p>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          <div className="flex gap-2">
            {(["email", "teams"] as const).map((s) => (
              <button key={s} onClick={() => setSource(s)} className={`rounded-full px-4 py-1.5 text-sm ${source === s ? "bg-[#c2e7ff] font-medium" : "ring-1 ring-slate-300 hover:bg-slate-50"}`}>
                {s === "email" ? "Email chain" : "Teams chat"}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={source === "email" ? "Subject (optional)" : "Chat name (optional)"} className={field} />
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={field}>
              <option value="">Client: recognise from senders</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          {source === "email" && (
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 hover:border-blue-400 hover:bg-blue-50/40">
              <span>{eml ? <>Loaded <span className="font-medium text-slate-900">{eml.name}</span> – choose another</> : "Choose an .eml file (Outlook: File → Save As), or paste below"}</span>
              <input type="file" accept=".eml,message/rfc822" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setEml({ name: f.name, raw: await f.text() }); }} />
            </label>
          )}
          {!eml && (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                source === "email"
                  ? "Paste the whole chain, including the From: / Sent: lines of each reply (Van:, De :, Von: work too)"
                  : "Paste the chat as copied from Teams, e.g.\nSofie Willems 14:02\nWho handles Noordkaai now?\n\nor exported lines like [12/03/2026 14:02] Sofie Willems: …"
              }
              className={`${field} h-64 w-full resize-none font-mono leading-6`}
            />
          )}
        </div>
        {error && <div className="mx-6 mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button onClick={onClose} className="rounded-full px-4 py-2 text-sm text-slate-700 hover:bg-slate-100">Cancel</button>
          <button onClick={submit} disabled={busy || (!eml && !text.trim())} className="rounded-full bg-[#0b57d0] px-5 py-2 text-sm font-medium text-white hover:bg-[#0842a0] disabled:opacity-50">
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
