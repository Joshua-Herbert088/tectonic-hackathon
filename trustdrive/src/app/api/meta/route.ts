import { loadWorld } from "@/lib/db";

export async function GET() {
  const { teams, people } = loadWorld();
  return Response.json({ teams, people });
}
