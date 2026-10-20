import { teamCountries } from "./appliesTo";
import { GLOBAL, taxonomyOf } from "./taxonomy";
import type { Conversation, Db } from "./types";

/**
 * What exists to tag and filter by: the company structure (countries → teams → people), clients, and
 * the taxonomy, each with how many documents use it.
 */
export function companyMap(db: Db, conversations: Conversation[]) {
  const tax = taxonomyOf(db.terms);
  const live = db.docs.filter((d) => !d.supersededById);
  const count = (pred: (d: (typeof live)[number]) => boolean) => live.filter(pred).length;

  // A team's country is where most of its people are; teams spread over countries are global.
  const countryOf = teamCountries(db.teams, db.people);
  const teams = db.teams.map((t) => {
    const members = db.people.filter((p) => p.teamId === t.id);
    const location = countryOf.get(t.id) ?? GLOBAL;
    return {
      ...t,
      location,
      people: members.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name, role: m.role })),
      left: members.filter((m) => !m.active).length,
      movedIn: members.filter((m) => m.active && m.previousTeamId).length,
      documents: count((d) => d.teamId === t.id),
      /** Documents meant specifically for this team. */
      audience: count((d) => d.audienceTeamIds.includes(t.id)),
    };
  });
  // Every country in the taxonomy (a new one has nothing yet), plus any still in use that was removed from it.
  const countries = [...new Set([...tax.locations, ...teams.map((t) => t.location), ...live.flatMap((d) => d.locations)])]
    .sort((a, b) => (a === GLOBAL ? 1 : b === GLOBAL ? -1 : a.localeCompare(b)))
    .map((location) => {
      const term = tax.countries.find((c) => c.id === location) ?? null;
      return {
        location,
        term,
        documents: count((d) => d.locations.includes(location)),
        teams: teams.filter((t) => t.location === location),
        /** What still refers to it: a country can only be removed when nothing does. */
        inUse: db.docs.filter((d) => d.locations.includes(location)).length + db.people.filter((p) => p.location === location).length + db.clients.filter((c) => c.location === location).length,
      };
    });

  const tagCounts = new Map<string, number>();
  for (const d of live) for (const t of new Set(d.tags)) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);

  return {
    countries,
    clients: db.clients.map((c) => ({
      ...c,
      documents: count((d) => d.clientId === c.id),
      conversations: conversations.filter((x) => x.clientId === c.id).length,
    })),
    topics: tax.topics.map((t) => ({ ...t, documents: tagCounts.get(t.id) ?? 0 })),
    docTypes: tax.docTypes.map((t) => ({ ...t, documents: tagCounts.get(t.id) ?? 0 })),
    /** Tags on documents that aren't in the taxonomy (typos, old or ad-hoc tags). */
    untracked: [...tagCounts].filter(([t]) => !tax.isKnownTag(t)).map(([tag, documents]) => ({ tag, documents })).sort((a, b) => b.documents - a.documents),
    untagged: count((d) => !d.tags.some(tax.isKnownTag)),
    /** Documents still missing a document type or a topic; they're asked for on their next save. */
    incomplete: count((d) => tax.missingTags(d.tags).length > 0),
    documents: live.length,
  };
}
