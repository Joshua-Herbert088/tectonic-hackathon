"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppContext";
import { SaveGateDialogs, useSaveGate } from "@/components/ConflictDialog";
import { Markdown } from "@/components/Markdown";
import { TagDialog, type DocMeta } from "@/components/Tags";
import { AppShell } from "@/components/AppShell";
import { citationHref, composeHandoverMarkdown, ITEM_KINDS, type DraftItem, type HandoverDraft, type ItemKind } from "@/lib/handoverDoc";
import { timeAgo } from "@/lib/time";

const SECTIONS: ItemKind[] = ["agreement", "fact", "open", "contact"];
const SHORT_KIND: Record<ItemKind, string> = { agreement: "Agreement", fact: "Setup", open: "Open item", contact: "Contact", noise: "Not needed" };

/** Review a handover document drafted from conversations, then save it through the conflict check. */
export default function HandoverFromConversations() {
  const router = useRouter();
  const { person, viewerId, taxonomy } = useApp();
  const [request, setRequest] = useState<{ ids: string[]; client: string | null } | null>(null);
  const [draft, setDraft] = useState<HandoverDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [kinds, setKinds] = useState<Record<string, ItemKind>>({});
  const [title, setTitle] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ids = (params.get("ids") ?? "").split(",").filter(Boolean);
    let cancelled = false;
    fetch("/api/conversations/draft", { method: "POST", body: JSON.stringify({ conversationIds: ids, clientId: params.get("client") }) })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Could not draft the document.");
        if (cancelled) return;
        const d = json as HandoverDraft;
        setRequest({ ids, client: params.get("client") });
        setDraft(d);
        setIncluded(new Set(d.items.filter((i) => i.include).map((i) => i.key)));
        setTitle(`Handover – ${d.client?.name ?? "client"}`);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Could not draft the document."));
    return () => {
      cancelled = true;
    };
  }, []);

  const nameOf = (id: string) => {
    const p = person(id);
    return p ? `${p.name}${p.active ? "" : " (left the company)"}` : id;
  };
  const effective = useMemo(() => (draft ? { ...draft, items: draft.items.map((i) => ({ ...i, kind: kinds[i.key] ?? i.kind })) } : null), [draft, kinds]);
  const markdown = effective ? composeHandoverMarkdown(effective, title || "Handover", included, nameOf) : "";

  // A client handover is tagged as such; if those tags were taken out of the taxonomy, the tag dialog asks.
  const viewer = person(viewerId);
  const defaultMeta: DocMeta = {
    // For the client's country, and the team that serves the client.
    locations: [draft?.client?.location ?? viewer?.location ?? taxonomy.locations[0]],
    audienceTeamIds: draft?.client?.teamId ? [draft.client.teamId] : [],
    clientId: draft?.client?.id ?? null,
    tags: ["handover", "client", "reference"].filter(taxonomy.isKnownTag),
  };
  const [taggingOpen, setTaggingOpen] = useState(false);
  const confirmed = useRef<DocMeta | null>(null);

  const gate = useSaveGate<{ id: string }>({
    send: ({ overrideReason, acknowledgeSimilar }) =>
      fetch("/api/docs", {
        method: "POST",
        body: JSON.stringify({
          title,
          content: markdown,
          kind: "doc",
          status: "To be reviewed",
          ...(confirmed.current ?? defaultMeta),
          clientId: (confirmed.current ?? defaultMeta).clientId ?? undefined,
          sourceConversationIds: request?.ids ?? [],
          override: overrideReason ? { reason: overrideReason } : undefined,
          acknowledgeSimilar,
        }),
      }),
    onSaved: ({ id }) => router.push(`/doc/${id}`),
  });

  if (!effective) {
    return (
      <AppShell compact>
        <div className="grid flex-1 place-items-center rounded-2xl bg-white text-center text-slate-500">
          {error ? (
            <div>
              <p>{error}</p>
              <Link href="/conversations" className="mt-2 inline-block text-blue-700 hover:underline">Back to conversations</Link>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-[#0b57d0]" />
              Reading the conversations: sorting statements, finding open loops and checking what&apos;s already written down…
            </div>
          )}
        </div>
      </AppShell>
    );
  }

  const client = effective.client?.name ?? "the client";
  const live = effective.items.filter((i) => i.kind !== "noise");
  // Small talk, answered items and personal data sit in "Left out" unless ticked; everything else stays in its section.
  const inSection = (i: DraftItem) => SECTIONS.includes(i.kind) && (included.has(i.key) || !(i.sensitive || i.resolved));
  const leftOut = effective.items.filter((i) => !inSection(i));
  const isNew = (i: DraftItem) => (i.kind === "agreement" || i.kind === "fact") && !i.documentedIn;
  const stats = [
    { n: live.filter((i) => i.kind === "agreement" && included.has(i.key)).length, label: "agreements" },
    { n: live.filter((i) => isNew(i) && included.has(i.key)).length, label: "not written down anywhere", tone: "warn" },
    { n: live.filter((i) => i.kind === "open" && included.has(i.key)).length, label: "open items", tone: "warn" },
    { n: effective.items.filter((i) => i.redactions.length || i.sensitive).length, label: "personal-data lines protected" },
  ];
  const toggle = (key: string) => setIncluded((s) => { const next = new Set(s); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  return (
    <AppShell compact>
      <SaveGateDialogs gate={gate} action="upload" onEditMine={() => {}} />
      {taggingOpen && (
        <TagDialog
          title={title}
          content={markdown}
          initial={defaultMeta}
          action="Create document"
          onClose={() => setTaggingOpen(false)}
          onConfirm={(m) => {
            setTaggingOpen(false);
            confirmed.current = m;
            gate.save();
          }}
        />
      )}
      <div className="flex flex-wrap items-center gap-3 px-2 pb-3">
        <Link href="/conversations" className="text-sm text-blue-700 hover:underline">← Conversations</Link>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-2xl text-slate-800 outline-none hover:border-slate-300 focus:border-blue-500 focus:bg-white" />
        <span className="text-xs text-slate-500">{effective.method === "jev" ? "Sorted by Jev" : "Sorted by keyword rules (Jev unavailable)"}</span>
        <button
          onClick={() => (confirmed.current || !taxonomy.missingTags(defaultMeta.tags).length ? gate.save() : setTaggingOpen(true))}
          disabled={gate.busy || !title.trim() || !included.size}
          className="rounded-full bg-[#0b57d0] px-5 py-2 text-sm font-medium text-white hover:bg-[#0842a0] disabled:opacity-50"
        >
          {gate.busy ? "Checking for conflicts…" : "Check & create document"}
        </button>
      </div>
      {gate.error && !gate.mode && <div className="mx-2 mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{gate.error}</div>}

      <div className="flex min-h-0 flex-1 gap-4">
        <main className="min-w-0 flex-1 overflow-y-auto rounded-2xl bg-white p-6">
          <p className="text-sm text-slate-600">
            {effective.conversations.length} conversation{effective.conversations.length === 1 ? "" : "s"} about {client}. Every line below is a sentence someone wrote; tick what belongs in the
            handover and move anything that landed in the wrong section.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className={`rounded-xl px-3 py-2 ${s.tone ? "bg-[#fef7e0]" : "bg-slate-50"}`}>
                <div className={`text-2xl font-semibold tabular-nums ${s.tone ? "text-[#b06000]" : "text-slate-800"}`}>{s.n}</div>
                <div className="text-[11px] text-slate-500">{s.label}</div>
              </div>
            ))}
          </div>

          {SECTIONS.map((kind) => {
            const items = effective.items.filter((i) => i.kind === kind && inSection(i));
            if (!items.length) return null;
            return (
              <section key={kind} className="mt-6">
                <h2 className="mb-2 text-sm font-medium text-slate-800">{ITEM_KINDS[kind].title(client)}</h2>
                <ul className="space-y-2">
                  {items.map((i) => (
                    <ItemRow key={i.key} i={i} draft={effective} checked={included.has(i.key)} onToggle={() => toggle(i.key)} onKind={(k) => setKinds((m) => ({ ...m, [i.key]: k }))} />
                  ))}
                </ul>
              </section>
            );
          })}

          {leftOut.length > 0 && (
            <details className="mt-6 rounded-xl border border-slate-200 px-4 py-2">
              <summary className="cursor-pointer text-sm text-slate-600">Left out ({leftOut.length}): small talk, answered questions and personal data</summary>
              <ul className="mt-2 space-y-2">
                {leftOut.map((i) => (
                  <ItemRow key={i.key} i={i} draft={effective} checked={false} onToggle={() => toggle(i.key)} onKind={(k) => setKinds((m) => ({ ...m, [i.key]: k }))} />
                ))}
              </ul>
            </details>
          )}
        </main>

        <aside className="hidden w-[460px] shrink-0 overflow-y-auto rounded-2xl bg-white lg:block">
          <div className="sticky top-0 border-b border-slate-100 bg-white px-5 py-3 text-xs uppercase tracking-wide text-slate-500">Preview</div>
          <div className="px-8 py-6">
            <Markdown text={markdown} />
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

function ItemRow({ i, draft, checked, onToggle, onKind }: { i: DraftItem; draft: HandoverDraft; checked: boolean; onToggle: () => void; onKind: (k: ItemKind) => void }) {
  const conv = draft.conversations.find((c) => c.id === i.conversationId);
  const factLike = i.kind === "agreement" || i.kind === "fact";
  return (
    <li className={`flex gap-3 rounded-xl border p-3 ${checked ? "border-slate-200" : "border-dashed border-slate-200 bg-slate-50/60"}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} className="mt-1" aria-label="Include in the document" />
      <div className="min-w-0 flex-1">
        <div className={`text-sm ${checked ? "text-slate-900" : "text-slate-500"}`}>{i.text}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
          <span>
            {i.authorName}
            {i.external && <span className="ml-1 rounded-full bg-slate-100 px-1.5 text-slate-600">client</span>}
          </span>
          <span>·</span>
          <Link href={citationHref(i.conversationId, i.messageId, i.text)} className="text-blue-700 hover:underline" target="_blank">
            [{conv?.ref}] {conv?.source === "email" ? "Email" : "Teams"} “{conv?.title}”
          </Link>
          <span>· {timeAgo(i.sentAt)}</span>
          <select
            value={i.kind}
            onChange={(e) => onKind(e.target.value as ItemKind)}
            className="ml-auto rounded-full border-0 bg-slate-100 py-0.5 pl-2 pr-1 text-[11px] text-slate-700 hover:bg-slate-200"
            title={`Move to another section (sorted with ${Math.round(i.confidence * 100)}% confidence)`}
          >
            {(Object.keys(ITEM_KINDS) as ItemKind[]).map((k) => (
              <option key={k} value={k}>{SHORT_KIND[k]}</option>
            ))}
          </select>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
          {factLike && i.documentedIn && (
            <Link href={`/doc/${i.documentedIn.docId}`} target="_blank" className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 hover:underline" title={i.documentedIn.line}>
              Already in “{i.documentedIn.title}”
            </Link>
          )}
          {factLike && !i.documentedIn && <span className="rounded-full bg-[#fef7e0] px-2 py-0.5 font-medium text-[#b06000]">Not written down anywhere</span>}
          {i.kind === "open" && !i.resolved && <span className="rounded-full bg-[#fce8e6] px-2 py-0.5 font-medium text-[#c5221f]">Still open</span>}
          {i.resolved && (
            <span className="rounded-full bg-[#e6f4ea] px-2 py-0.5 text-[#0d652d]" title={i.resolved.text}>
              Dealt with by {i.resolved.authorName}, {timeAgo(i.resolved.sentAt)}
            </span>
          )}
          {i.redactions.length > 0 && <span className="rounded-full bg-[#f3e8fd] px-2 py-0.5 text-[#7627bb]">Removed: {i.redactions.join(", ")}</span>}
          {i.sensitive && <span className="rounded-full bg-[#f3e8fd] px-2 py-0.5 text-[#7627bb]">{i.sensitive} – left out</span>}
        </div>
      </div>
    </li>
  );
}
