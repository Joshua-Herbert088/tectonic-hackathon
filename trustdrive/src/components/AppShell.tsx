"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useApp } from "./AppContext";
import { ChooseClientsDialog } from "./ChooseClients";
import { FileIcon } from "./FileIcon";
import { Icon, type IconName } from "./Icons";
import { NameDialog } from "./NameDialog";
import { TopBar } from "./TopBar";
import { UploadDialog } from "./UploadDialog";
import { useEscape } from "./useEscape";

/**
 * The frame around every page: top bar, the same navigation everywhere (icons only on dense pages),
 * a "New" menu, and one banner when Jev can't be reached instead of unexplained estimates.
 */
export function AppShell({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <JevBanner />
      <div className="flex min-h-0 flex-1">
        <Suspense fallback={<div className={`hidden sm:block ${compact ? "w-[72px]" : "w-[72px] lg:w-60"}`} />}>
          <Nav compact={compact} />
        </Suspense>
        {/* Phones: room at the bottom for the tab bar. */}
        <div className="flex min-w-0 flex-1 flex-col px-2 pb-16 sm:pb-4 sm:pl-0 sm:pr-4">{children}</div>
      </div>
    </div>
  );
}

// The full sidebar (with labels) shows from the lg breakpoint; below it icons only, and on phones a bottom
// bar. Class names are written out in full: Tailwind only generates classes it finds literally in the source.
function Nav({ compact }: { compact: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { clients, myClients } = useApp();
  const [choosing, setChoosing] = useState(false);
  const [menu, setMenu] = useState(false);
  useEscape(menu, () => setMenu(false));
  const [uploading, setUploading] = useState(false);
  // New documents go into the folder the drive is showing.
  const folderId = pathname === "/drive" ? (params.get("folder") ?? undefined) : undefined;

  // A blank document gets its name first, so the drive never fills up with "Untitled document"s. It opens in
  // the editor; its tags are asked for when it's saved, once there's something to tag.
  const [naming, setNaming] = useState(false);
  const createDoc = async (title: string) => {
    const res = await fetch("/api/docs", { method: "POST", body: JSON.stringify({ title, content: "", folderId }) });
    const json = await res.json();
    if (!res.ok) return json.error ?? "Could not create the document.";
    setNaming(false);
    router.push(`/doc/${json.id}?edit=1`);
    return null;
  };

  const view = params.get("view");
  const client = params.get("client");
  const isActive = (href: string) => {
    const [path, query] = href.split("?");
    if (path !== pathname) return false;
    if (path !== "/drive") return true;
    const q = new URLSearchParams(query);
    return (q.get("view") ?? null) === (view ?? null) && (q.get("client") ?? null) === (client ?? null);
  };

  const item = (href: string, label: string, icon: IconName) => {
    const active = isActive(href);
    return (
      <Link
        key={href}
        href={href}
        title={label}
        className={`flex h-9 items-center gap-3 rounded-full text-sm ${compact ? "w-11 justify-center" : `w-11 justify-center lg:w-full lg:justify-start lg:pl-4 lg:pr-3`} ${active ? "bg-[#c2e7ff] font-medium text-slate-900" : "text-slate-700 hover:bg-slate-200/70"}`}
      >
        <Icon name={icon} size={20} color={active ? "#001d35" : "#444746"} />
        {!compact && <span className={`hidden truncate lg:inline`}>{label}</span>}
      </Link>
    );
  };

  return (
    <>
    <aside className={`hidden shrink-0 flex-col overflow-y-auto px-3 pb-4 sm:flex ${compact ? "w-[72px] items-center" : `w-[72px] items-center lg:w-60 lg:items-stretch`}`}>
      {choosing && <ChooseClientsDialog onClose={() => setChoosing(false)} />}
      {uploading && <UploadDialog folderId={folderId} onClose={() => setUploading(false)} />}
      {naming && (
        <NameDialog
          title="New document"
          where={folderId ? "the folder you're viewing" : null}
          label="Document name"
          placeholder="e.g. Payroll calendar 2027 – Belgium"
          action="Create"
          onSubmit={createDoc}
          onClose={() => setNaming(false)}
        />
      )}

      <div className="relative mb-4">
        <button
          onClick={() => setMenu(!menu)}
          title="New"
          className={`flex items-center gap-3 rounded-2xl bg-white text-sm font-medium shadow-md hover:bg-[#edf2fa] ${compact ? "h-12 w-12 justify-center" : `h-12 w-12 justify-center lg:h-14 lg:w-auto lg:px-5`}`}
        >
          <Icon name="plus" size={24} color="#1f1f1f" />
          {!compact && <span className={`hidden lg:inline`}>New</span>}
        </button>
        {menu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
            <div className="absolute left-0 top-0 z-20 w-64 rounded-xl bg-white py-2 shadow-xl ring-1 ring-black/5">
              <button onClick={() => { setMenu(false); setNaming(true); }} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-slate-100">
                <FileIcon kind="doc" /> Blank document
              </button>
              <button onClick={() => { setMenu(false); setUploading(true); }} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-slate-100">
                <Icon name="upload" color="#444746" /> File upload
              </button>
              <Link href="/conversations?import=1" onClick={() => setMenu(false)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-slate-100">
                <Icon name="chat" color="#444746" /> Import email or Teams chat
              </Link>
            </div>
          </>
        )}
      </div>

      <nav className="space-y-0.5">
        {item("/", "For you", "home")}
        {item("/drive", "Drive", "folder")}
        {item("/drive?view=attention", "Needs attention", "warning")}
        {item("/drive?view=radar", "Handover radar", "handover")}
        {item("/people", "Who knows", "person")}
        {item("/mentoring", "Mentoring", "mentor")}
        {item("/conversations", "Conversations", "chat")}
        {item("/company", "Company & tags", "tag")}
      </nav>
      {clients.length > 0 && (
        <>
          <div className={`my-3 h-px w-8 bg-slate-200 ${compact ? "" : `lg:hidden`}`} />
          {!compact && (
            <div className={`mb-1 mt-5 hidden items-center px-4 text-xs font-medium uppercase tracking-wide text-slate-500 lg:flex`}>
              My clients
              <button onClick={() => setChoosing(true)} className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-blue-700 hover:bg-blue-50" title="Choose which clients you see">
                Choose
              </button>
            </div>
          )}
          <nav className="space-y-0.5">{myClients.map((c) => item(`/client/${c.id}`, c.name, "building"))}</nav>
          {myClients.length === 0 && !compact && (
            <button onClick={() => setChoosing(true)} className="hidden px-4 text-left text-xs text-blue-700 hover:underline lg:block">
              No clients yet – choose the ones you work with
            </button>
          )}
        </>
      )}

      {!compact && (
        <div className={`mt-auto hidden px-4 pt-6 text-[11px] leading-4 text-slate-500 lg:block`}>
          Trust scores by <span className="font-medium">Jev</span> (TypeSafe AI).
          <button
            className="mt-2 block text-blue-700 hover:underline"
            onClick={async () => {
              if (!confirm("Reset all demo data? Your edits and verifications will be lost.")) return;
              await fetch("/api/reset", { method: "POST" });
              location.reload();
            }}
          >
            Reset demo data
          </button>
        </div>
      )}
    </aside>
    {/* Phones: the main sections as a bottom tab bar. */}
    <nav className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-center justify-around border-t border-slate-200 bg-white sm:hidden">
      {[
        ["/", "For you", "home"],
        ["/drive", "Drive", "folder"],
        ["/drive?view=attention", "Attention", "warning"],
        ["/conversations", "Messages", "chat"],
        ["/company", "Company", "tag"],
      ].map(([href, label, icon]) => (
        <Link key={href} href={href} className="flex flex-col items-center gap-0.5 px-2 text-[10px] text-slate-600">
          <Icon name={icon as IconName} size={22} color={isActive(href) ? "#0b57d0" : "#444746"} />
          <span className={isActive(href) ? "font-medium text-[#0b57d0]" : ""}>{label}</span>
        </Link>
      ))}
    </nav>
    </>
  );
}

const STATUS_POLL_MS = 15_000;

/** One explanation for the whole app while Jev can't be reached, instead of puzzling over dashed rings. */
function JevBanner() {
  const pathname = usePathname();
  const [jev, setJev] = useState<{ available: boolean; reason?: string } | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/status")
        .then((r) => r.json())
        .then((j) => !cancelled && setJev(j.jev))
        .catch(() => {});
    // The first scores of a page decide whether Jev answers, so check shortly after loading too.
    const first = setTimeout(load, 2500);
    const t = setInterval(load, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(t);
    };
  }, [pathname]);

  if (!jev || jev.available || hidden) return null;
  return (
    <div className="mx-4 mb-3 flex items-center gap-3 rounded-xl bg-[#fef7e0] px-4 py-2 text-sm text-[#7a4a00]">
      <Icon name="cloudOff" color="#b06000" />
      <span className="min-w-0 flex-1">
        <span className="font-medium">Jev {jev.reason ?? "is unavailable"}.</span> Trust scores, conflict checks and duplicate warnings use rule-based estimates for now – scores
        with a dashed ring. They switch back to Jev automatically.
      </span>
      <button onClick={() => setHidden(true)} className="rounded-full px-2 py-0.5 text-xs hover:bg-[#fde293]">Dismiss</button>
    </div>
  );
}
