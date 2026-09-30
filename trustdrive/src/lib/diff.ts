export type DiffOp = { op: "equal"; a: number; b: number } | { op: "delete"; a: number } | { op: "insert"; b: number };

/** Line-level LCS diff. Documents here are small (tens of lines), so O(n·m) is fine. */
export function lineDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) ops.push({ op: "equal", a: i++, b: j++ });
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) ops.push({ op: "delete", a: i++ });
    else ops.push({ op: "insert", b: j++ });
  }
  while (i < n) ops.push({ op: "delete", a: i++ });
  while (j < m) ops.push({ op: "insert", b: j++ });
  return ops;
}

export interface Hunk {
  /** Indices into the old version. */
  removed: number[];
  /** Indices into the new version. */
  added: number[];
}

/** Groups consecutive deletes/inserts into hunks (a replaced line shows up as removed + added). */
export function hunks(ops: DiffOp[]): Hunk[] {
  const out: Hunk[] = [];
  let cur: Hunk | null = null;
  for (const o of ops) {
    if (o.op === "equal") {
      cur = null;
      continue;
    }
    if (!cur) out.push((cur = { removed: [], added: [] }));
    if (o.op === "delete") cur.removed.push(o.a);
    else cur.added.push(o.b);
  }
  return out;
}

export interface Snapshot {
  personId: string | null;
  content: string;
}

/**
 * "git blame" over a document's snapshots: who introduced each line of the latest version.
 * Returns one author id (or null when unknown) per line of the last snapshot.
 */
export function blame(snapshots: Snapshot[]): { lines: string[]; authors: (string | null)[] } {
  let lines: string[] = [];
  let authors: (string | null)[] = [];
  for (const s of snapshots) {
    const next = s.content.split("\n");
    const nextAuthors: (string | null)[] = new Array(next.length).fill(s.personId);
    for (const o of lineDiff(lines, next)) if (o.op === "equal") nextAuthors[o.b] = authors[o.a];
    lines = next;
    authors = nextAuthors;
  }
  return { lines, authors };
}
