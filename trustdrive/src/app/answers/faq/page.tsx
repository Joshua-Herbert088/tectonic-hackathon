"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AppContext";
import { SaveGateDialogs, useSaveGate } from "@/components/ConflictDialog";
import { AnswerCard } from "@/components/Expertise";
import { Markdown } from "@/components/Markdown";
import { TagDialog, type DocMeta } from "@/components/Tags";
import { GLOBAL } from "@/lib/taxonomy";
import { composeFaqMarkdown } from "@/lib/answerDoc";
import type { Answer } from "@/lib/types";

interface Draft {
  topic: string;
  label: string;
  parent: string | null;
  answers: Answer[];
}

/**
 * Turn answers the viewer gave in chat into an FAQ: pick the answers, check the preview, then save it
 * through the usual tagging, conflict and duplicate checks. The answers then point to the document.
 */
export default function FaqPage() {
  return (
    <Suspense fallback={<AppShell compact><main className="flex-1 rounded-2xl bg-white" /></AppShell>}>
      <FaqDraft />
    </Suspense>
  );
}

function FaqDraft() {
  const router = useRouter();
  const topic = useSearchParams().get("topic") ?? "";
  const { person, viewerId, taxonomy } = useApp();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [included, setIncluded] = useState<Set<number>>(new Set());
  const [title, setTitle] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/answers/faq?topic=${encodeURIComponent(topic)}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Could not load your answers.");
        if (cancelled) return;
        setDraft(json);
        // Answers a document contradicts stay out until someone has checked which one is right.
        setIncluded(new Set((json as Draft).answers.filter((a) => !a.conflict).map((a) => a.id)));
        setTitle(`${json.label} – questions & answers`);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [topic, viewerId]);

  const viewer = person(viewerId);
  const chosen = useMemo(() => draft?.answers.filter((a) => included.has(a.id)) ?? [], [draft, included]);
  const nameOf = (id: string) => person(id)?.name ?? "a colleague";
  const markdown = draft ? composeFaqMarkdown(title || draft.label, chosen, viewer?.name ?? "you", nameOf) : "";

  const locations = [...new Set(chosen.flatMap((a) => a.locations))];
  const defaultMeta: DocMeta = {
    locations: !locations.length || locations.includes(GLOBAL) ? [GLOBAL] : locations,
    audienceTeamIds: [],
    clientId: null,
    tags: ["guide", topic, ...(draft?.parent ? [draft.parent] : [])].filter(taxonomy.isKnownTag),
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
          clientId: undefined,
          sourceConversationIds: [...new Set(chosen.map((a) => a.conversationId))],
          answerIds: chosen.map((a) => a.id),
          override: overrideReason ? { reason: overrideReason } : undefined,
          acknowledgeSimilar,
        }),
      }),
    onSaved: ({ id }) => router.push(`/doc/${id}`),
  });

  if (!draft) {
    return (
      <AppShell compact>
        <div className="grid flex-1 place-items-center rounded-2xl bg-white text-center text-sm text-slate-500">
          {error ? (
            <div>
              <p>{error}</p>
              <Link href="/" className="mt-2 inline-block text-blue-700 hover:underline">Back to For you</Link>
            </div>
          ) : (
            "Collecting your answers…"
          )}
        </div>
      </AppShell>
    );
  }

  const toggle = (id: number) =>
    setIncluded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
        <Link href="/" className="text-sm text-blue-700 hover:underline">← For you</Link>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Document name"
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-2xl text-slate-800 outline-none hover:border-slate-300 focus:border-blue-500 focus:bg-white"
        />
        <button
          onClick={() => (confirmed.current || !taxonomy.missingTags(defaultMeta.tags).length ? gate.save() : setTaggingOpen(true))}
          disabled={gate.busy || !title.trim() || !chosen.length}
          className="rounded-full bg-[#0b57d0] px-5 py-2 text-sm font-medium text-white hover:bg-[#0842a0] disabled:opacity-50"
        >
          {gate.busy ? "Checking for conflicts…" : "Check & create document"}
        </button>
      </div>
      {gate.error && !gate.mode && <div className="mx-2 mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{gate.error}</div>}

      <div className="flex min-h-0 flex-1 gap-4">
        <main className="min-w-0 flex-1 overflow-y-auto rounded-2xl bg-white p-6">
          <p className="text-sm text-slate-600">
            You answered {draft.answers.length} question{draft.answers.length === 1 ? "" : "s"} about {draft.label} that aren&apos;t written up yet. Tick the ones that belong in the FAQ. It&apos;s saved as{" "}
            <span className="font-medium">To be reviewed</span> and checked against the drive like any document.
          </p>
          {draft.answers.length === 0 && <p className="mt-4 text-sm text-slate-500">Nothing left to write up on this topic.</p>}
          <ul className="mt-4 space-y-3">
            {draft.answers.map((a) => (
              <li key={a.id} className="flex items-start gap-3">
                <input type="checkbox" checked={included.has(a.id)} onChange={() => toggle(a.id)} className="mt-4" aria-label={`Include “${a.question}”`} />
                <AnswerCard a={a} className={`min-w-0 flex-1 ${included.has(a.id) ? "" : "opacity-60"}`} />
              </li>
            ))}
          </ul>
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
