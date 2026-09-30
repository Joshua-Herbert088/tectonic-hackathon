import type { NextRequest } from "next/server";
import { readDb, writeDb } from "@/lib/db";
import { docSummary, getViewer } from "@/lib/service";
import type { Doc } from "@/lib/types";

export async function GET(req: NextRequest) {
  const db = readDb();
  const viewer = getViewer(db, req.nextUrl.searchParams.get("viewer"));
  const docs = [...db.docs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((d) => docSummary(db, d, viewer));
  return Response.json({ viewer, docs });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const db = readDb();
  const viewer = getViewer(db, body.viewerId);
  const now = new Date().toISOString();
  const doc: Doc = {
    id: `doc-${Date.now().toString(36)}`,
    title: body.title || "Untitled document",
    kind: "doc",
    content: body.content ?? "",
    ownerId: viewer.id,
    collaboratorIds: [],
    readerIds: [],
    location: body.location ?? viewer.location,
    status: "WIP",
    teamId: body.teamId ?? viewer.teamId,
    tags: body.tags ?? [],
    createdAt: now,
    updatedAt: now,
    lastEditedById: viewer.id,
    verifications: [],
    views: [],
  };
  db.docs.push(doc);
  writeDb(db);
  return Response.json({ id: doc.id });
}
