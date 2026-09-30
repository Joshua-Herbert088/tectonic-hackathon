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
  const lines = text.split("\n");
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
  return <div className="text-[15px] text-slate-700">{blocks}</div>;
}

function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") ? <strong key={i} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}
