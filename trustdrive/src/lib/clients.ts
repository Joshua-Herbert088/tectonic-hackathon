import type { Client } from "./types";

/** What a person enters for a client. */
export interface ClientInput {
  name: string;
  domain?: string | null;
  teamId: string;
  location: string;
}

/** "Mail@Noordkaai.example" or "https://www.noordkaai.example/" → "noordkaai.example"; empty → undefined. */
export function normaliseDomain(raw: string | null | undefined) {
  const d = (raw ?? "").trim().toLowerCase().replace(/^.*@/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return d || undefined;
}

/**
 * Why a client can't be saved like this, or null. Shared by the dialog and the API.
 * `existing`: the client being edited (it may keep its own name and domain).
 */
export function validateClient(input: ClientInput, ctx: { clients: Client[]; teamIds: string[]; locations: string[] }, existing?: Client): string | null {
  const name = input.name.trim();
  if (!name) return "Give the client a name.";
  if (name.length > 120) return "Keep the name under 120 characters.";
  const others = ctx.clients.filter((c) => c.id !== existing?.id);
  if (others.some((c) => c.name.toLowerCase() === name.toLowerCase())) return `There's already a client called “${name}”.`;
  const domain = normaliseDomain(input.domain);
  if (domain && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return `“${input.domain}” isn't an email domain – use something like noordkaai.example.`;
  if (domain && others.some((c) => c.domain === domain)) return `Mail from ${domain} already belongs to ${others.find((c) => c.domain === domain)!.name}.`;
  if (!ctx.teamIds.includes(input.teamId)) return "Choose the team that serves this client.";
  if (!ctx.locations.includes(input.location)) return "Choose a country from the taxonomy.";
  return null;
}

/** The clients a person sees in their sidebar and "waiting for an answer": the ones they chose, or else their team's. */
export function myClients<C extends Client>(person: { teamId: string; clientIds?: string[] } | undefined, clients: C[]): C[] {
  if (!person) return [];
  return person.clientIds ? clients.filter((c) => person.clientIds!.includes(c.id)) : clients.filter((c) => c.teamId === person.teamId);
}
