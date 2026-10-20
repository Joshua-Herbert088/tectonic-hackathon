import { GLOBAL } from "./taxonomy";
import type { Location, Person, Team } from "./types";

/**
 * Who a document applies to: one or more countries (or Global), then optionally teams within them.
 * No teams means every team in those countries. Shared by the server and the browser.
 */

export const isGlobal = (locations: Location[]) => locations.includes(GLOBAL);

/** Two scopes can be about the same rules: Global overlaps everything, otherwise they share a country. */
export function overlaps(a: Location[], b: Location[]) {
  return isGlobal(a) || isGlobal(b) || a.some((l) => b.includes(l));
}

/** Whether a document's countries cover someone in `location` (Global covers everyone; a Global person every document). */
export function coversCountry(locations: Location[], location: Location) {
  return isGlobal(locations) || location === GLOBAL || locations.includes(location);
}

/** "Belgium and France", "Global". */
export function formatLocations(locations: Location[]) {
  if (!locations.length) return "no country";
  if (locations.length === 1) return locations[0];
  return `${locations.slice(0, -1).join(", ")} and ${locations.at(-1)}`;
}

/**
 * Each team's country: where most of its active people are, or Global when they're spread out.
 * Teams are offered under that country when choosing who a document applies to.
 */
export function teamCountries(teams: Team[], people: Person[]): Map<string, Location> {
  return new Map(
    teams.map((t) => {
      const active = people.filter((p) => p.teamId === t.id && p.active);
      const byCountry = new Map<string, number>();
      for (const p of active) byCountry.set(p.location, (byCountry.get(p.location) ?? 0) + 1);
      const [top] = [...byCountry].sort((a, b) => b[1] - a[1]);
      return [t.id, top && top[1] * 2 > active.length ? top[0] : GLOBAL];
    }),
  );
}

/** Teams that can be picked for these countries: the teams based there, plus teams working across countries. With Global, every team. */
export function teamsFor(locations: Location[], teams: Team[], countryOf: Map<string, Location>) {
  if (isGlobal(locations)) return teams;
  return teams.filter((t) => {
    const c = countryOf.get(t.id) ?? GLOBAL;
    return c === GLOBAL || locations.includes(c);
  });
}
