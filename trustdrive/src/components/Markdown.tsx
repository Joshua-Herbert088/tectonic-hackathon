import Link from "next/link";
import { Fragment } from "react";

/** A highlighted line: doubts a reader should know about, keyed by 1-based line number. */
export interface LineMark {
  tone: "bad" | "warn";
  label: string;
}

const MARK = {
  bad: { text: "bg-[#fce8e6] decoration-[#c5221f]", active: "bg-[#f6c7c2]", chip: "#c5221f" },
  warn: { text: "bg-[#fef7e0] decoration-[#f9ab00]", active: "bg-[#fde293]", chip: "#b06000" },
};

/** Lines rendered at most; a longer document shows the rest in the editor. */
export const MAX_RENDERED_LINES = 3000;

/** Minimal markdown renderer for the seeded docs: headings, lists, tables, bold. */
export function Markdown({
  text,
  marks,
  activeLine,
  onMark,
}: {
  text: string;
  marks?: Record<number, LineMark>;
  activeLine?: number | null;
  onMark?: (lineNo: number) => void;
}) {
  const all = text.split("\n");
  const lines = all.slice(0, MAX_RENDERED_LINES);
  const blocks: React.ReactNode[] = [];
  let i = 0;

  const mark = (lineNo: number) => marks?.[lineNo];
  const markProps = (lineNo: number) => {
    const m = mark(lineNo);
    return m ? { "data-line": lineNo, title: m.label, onClick: () => onMark?.(lineNo) } : { "data-line": lineNo };
  };
  /** Wavy underline around the text itself, like a spell checker. */
  const marked = (lineNo: number, content: React.ReactNode) => {
    const m = mark(lineNo);
    if (!m) return content;
    const s = MARK[m.tone];
    return (
      <span className={`cursor-pointer rounded-sm underline decoration-wavy decoration-1 underline-offset-4 [box-decoration-break:clone] ${lineNo === activeLine ? s.active : s.text}`}>
        {content}
      </span>
    );
  };
  /** "!" in the page margin. List items sit 1.5rem further in, so they pass a larger offset. */
  const chip = (lineNo: number, left = "-left-9") => {
    const m = mark(lineNo);
    if (!m) return null;
    return (
      <span className={`absolute ${left} top-1 grid h-5 w-5 cursor-pointer place-items-center rounded-full text-[11px] font-bold text-white`} style={{ background: MARK[m.tone].chip }} aria-hidden>
        !
      </span>
    );
  };

  while (i < lines.length) {
    const line = lines[i];
    const no = i + 1;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push(<h1 key={i} {...markProps(no)} className="relative mb-4 text-3xl font-normal text-slate-900">{chip(no)}{marked(no, inline(line.slice(2)))}</h1>);
      i++;
    } else if (line.startsWith("## ")) {
      blocks.push(<h2 key={i} {...markProps(no)} className="relative mb-2 mt-6 text-xl font-medium text-slate-800">{chip(no)}{marked(no, inline(line.slice(3)))}</h2>);
      i++;
    } else if (line.startsWith("|")) {
      const rows: { cells: string[]; no: number }[] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        if (!/^\|[\s|:-]+\|$/.test(lines[i])) rows.push({ cells: lines[i].split("|").slice(1, -1).map((c) => c.trim()), no: i + 1 });
        i++;
      }
      const [head, ...body] = rows;
      // Only separator lines (|---|): nothing to show.
      if (!head) continue;
      const rowClass = (no: number) => {
        const m = mark(no);
        return m ? `cursor-pointer ${no === activeLine ? MARK[m.tone].active : MARK[m.tone].text}` : "";
      };
      blocks.push(
        <table key={i} className="my-4 w-full border-collapse text-sm">
          <thead>
            <tr {...markProps(head.no)} className={rowClass(head.no)}>
              {head.cells.map((c, j) => <th key={j} className={`relative border border-slate-200 px-3 py-2 text-left font-medium ${mark(head.no) ? "" : "bg-slate-50"}`}>{j === 0 && chip(head.no)}{inline(c)}</th>)}
            </tr>
          </thead>
          <tbody>
            {body.map((r) => (
              <tr key={r.no} {...markProps(r.no)} className={rowClass(r.no)}>
                {r.cells.map((c, j) => <td key={j} className="relative border border-slate-200 px-3 py-2">{j === 0 && chip(r.no)}{inline(c)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>,
      );
    } else if (/^(- |\d+\. )/.test(line)) {
      const ordered = /^\d+\. /.test(line);
      const items: { text: string; no: number }[] = [];
      while (i < lines.length && /^(- |\d+\. )/.test(lines[i])) {
        items.push({ text: lines[i].replace(/^(- |\d+\. )/, ""), no: i + 1 });
        i++;
      }
      const L = ordered ? "ol" : "ul";
      blocks.push(
        <L key={i} className={`my-2 space-y-1 pl-6 ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((it) => <li key={it.no} {...markProps(it.no)} className="relative">{chip(it.no, "-left-[3.75rem]")}{marked(it.no, inline(it.text))}</li>)}
        </L>,
      );
    } else {
      blocks.push(<p key={i} {...markProps(no)} className="relative my-3 leading-7">{chip(no)}{marked(no, inline(line))}</p>);
      i++;
    }
  }
  if (all.length > lines.length) blocks.push(<p key="more" className="my-3 text-sm italic text-slate-500">{(all.length - lines.length).toLocaleString()} more lines aren&apos;t shown here. Open the editor to see the whole document.</p>);
  // Long words and URLs wrap instead of running off the page.
  return <div className="text-[15px] text-slate-700 [overflow-wrap:anywhere]">{blocks}</div>;
}

const LINK = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;

function bold(s: string, key: string) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") ? <strong key={`${key}-${i}`} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong> : <Fragment key={`${key}-${i}`}>{part}</Fragment>,
  );
}

/**
 * Bold and links. Links stay inside the app (`/…`) or open https pages in a new tab; anything else
 * (javascript:, data:) is shown as text. The optional title shows on hover – sources use it for the quote.
 */
function inline(s: string) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of s.matchAll(LINK)) {
    out.push(...bold(s.slice(last, m.index), `t${last}`));
    const [, text, href, title] = m;
    const style = "text-[#0b57d0] underline decoration-[#0b57d0]/30 underline-offset-2 hover:decoration-[#0b57d0]";
    if (href.startsWith("/") && !href.startsWith("//")) {
      out.push(<Link key={`l${m.index}`} href={href} title={title} className={style}>{text}</Link>);
    } else if (href.startsWith("https://")) {
      out.push(<a key={`l${m.index}`} href={href} title={title} target="_blank" rel="noopener noreferrer" className={style}>{text}</a>);
    } else out.push(<Fragment key={`l${m.index}`}>{text}</Fragment>);
    last = m.index + m[0].length;
  }
  out.push(...bold(s.slice(last), `t${last}`));
  return out;
}
