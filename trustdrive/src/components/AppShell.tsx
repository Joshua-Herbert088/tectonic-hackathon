"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useApp } from "./AppContext";
import { FileIcon } from "./FileIcon";
import { Icon, type IconName } from "./Icons";
import { TopBar } from "./TopBar";
import { UploadDialog } from "./UploadDialog";
import { useEscape } from "./useEscape";

/** The frame around every page: top bar, the same navigation everywhere (icons only on dense pages) and a "New" menu. */
export function AppShell({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  return (
    <div className="flex h-screen flex-col">
      <TopBar />
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

const NAV: [href: string, label: string, short: string, icon: IconName][] = [
  ["/", "My Drive", "Drive", "folder"],
  ["/?view=mine", "Owned by me", "Mine", "person"],
  ["/?view=shared", "Shared with me", "Shared", "handover"],
  ["/?view=attention", "Needs attention", "Attention", "warning"],
  ["/?view=radar", "Handover radar", "Radar", "radar"],
];

// The full sidebar (with labels) shows from the lg breakpoint; below it icons only, and on phones a bottom
// bar. Class names are written out in full: Tailwind only generates classes it finds literally in the source.
function Nav({ compact }: { compact: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { viewerId } = useApp();
  const [menu, setMenu] = useState(false);
  useEscape(menu, () => setMenu(false));
  const [uploading, setUploading] = useState(false);

  const createDoc = async () => {
    setMenu(false);
    const res = await fetch("/api/docs", { method: "POST", body: JSON.stringify({ viewerId, title: "Untitled document", content: "# Untitled document\n\n" }) });
    const { id } = await res.json();
    router.push(`/doc/${id}?edit=1`);
  };

  const view = params.get("view");
  const isActive = (href: string) => {
    const [path, query] = href.split("?");
    if (path !== pathname) return false;
    return (new URLSearchParams(query).get("view") ?? null) === (view ?? null);
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
        {uploading && <UploadDialog onClose={() => setUploading(false)} />}

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
              <div className="absolute left-0 top-0 z-20 w-60 rounded-xl bg-white py-2 shadow-xl ring-1 ring-black/5">
                <button onClick={createDoc} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-slate-100">
                  <FileIcon kind="doc" /> Blank document
                </button>
                <button onClick={() => { setMenu(false); setUploading(true); }} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-slate-100">
                  <Icon name="upload" color="#444746" /> File upload
                </button>
              </div>
            </>
          )}
        </div>

        <nav className="space-y-0.5">{NAV.map(([href, label, , icon]) => item(href, label, icon))}</nav>

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
        {NAV.map(([href, , short, icon]) => (
          <Link key={href} href={href} className="flex flex-col items-center gap-0.5 px-2 text-[10px] text-slate-600">
            <Icon name={icon} size={22} color={isActive(href) ? "#0b57d0" : "#444746"} />
            <span className={isActive(href) ? "font-medium text-[#0b57d0]" : ""}>{short}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
