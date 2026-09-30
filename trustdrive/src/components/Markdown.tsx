import { Fragment } from "react";

/** Minimal markdown renderer for the seeded docs: headings, lists, tables, bold. */
export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push(<h1 key={i} className="mb-4 text-3xl font-normal text-slate-900">{inline(line.slice(2))}</h1>);
      i++;
    } else if (line.startsWith("## ")) {
      blocks.push(<h2 key={i} className="mb-2 mt-6 text-xl font-medium text-slate-800">{inline(line.slice(3))}</h2>);
      i++;
    } else if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        if (!/^\|[\s|:-]+\|$/.test(lines[i])) rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim()));
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <table key={i} className="my-4 w-full border-collapse text-sm">
          <thead>
            <tr>{head.map((c, j) => <th key={j} className="border border-slate-200 bg-slate-50 px-3 py-2 text-left font-medium">{inline(c)}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((r, k) => (
              <tr key={k}>{r.map((c, j) => <td key={j} className="border border-slate-200 px-3 py-2">{inline(c)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
    } else if (/^(- |\d+\. )/.test(line)) {
      const ordered = /^\d+\. /.test(line);
      const items: string[] = [];
      while (i < lines.length && /^(- |\d+\. )/.test(lines[i])) {
        items.push(lines[i].replace(/^(- |\d+\. )/, ""));
        i++;
      }
      const L = ordered ? "ol" : "ul";
      blocks.push(
        <L key={i} className={`my-2 space-y-1 pl-6 ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((it, k) => <li key={k}>{inline(it)}</li>)}
        </L>,
      );
    } else {
      blocks.push(<p key={i} className="my-3 leading-7">{inline(line)}</p>);
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
