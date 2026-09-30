/**
 * Language-independent "concepts" for conflict pairing. Documents may be written in English, Dutch,
 * French or German, so plain keyword overlap misses e.g. "gross monthly salary" vs "bruto maandloon".
 * Each concept lists stems in those languages (accents stripped, lowercase). Stems of 4+ characters
 * also match inside compound words (maandloon, Bruttomonatsgehalt); shorter ones must match exactly.
 */
const CONCEPTS: Record<string, string[]> = {
  salary: ["salary", "salaries", "wage", "loon", "lonen", "salaris", "salair", "gehalt", "lohn", "remuneration", "bezoldiging", "verdienst", "pay"],
  gross: ["gross", "bruto", "brut", "brute", "brutto"],
  net: ["net", "netto", "nette"],
  month: ["month", "monthly", "maand", "mois", "mensuel", "mensuelle", "monat"],
  year: ["year", "yearly", "annual", "jaar", "jaarlijks", "annee", "annuel", "annuelle", "jahr", "jahrlich"],
  deadline: ["deadline", "uiterste", "limite", "frist", "echeance", "stichtag"],
  input: ["input", "invoer", "encodage", "encoder", "gegevens", "eingabe", "saisie"],
  payroll: ["payroll", "verloning", "loonverwerking", "loonlijst", "paie", "lohnabrechnung", "gehaltsabrechnung", "abrechnung"],
  run: ["run", "verwerking", "traitement", "lauf"],
  payment: ["payment", "betaling", "uitbetaling", "paiement", "versement", "zahlung", "auszahlung"],
  overtime: ["overtime", "overuren", "overwerk", "supplementaire", "supplementaires", "uberstunde", "mehrarbeit"],
  premium: ["premium", "surcharge", "toeslag", "majoration", "zuschlag"],
  allowance: ["allowance", "vergoeding", "toelage", "indemnite", "zulage", "pauschale"],
  mileage: ["mileage", "kilomet", "km"],
  holidaypay: ["vakantiegeld", "vacances", "urlaubsgeld", "holiday"],
  bonus: ["bonus", "premie", "prime", "eindejaarspremie", "dertiende", "treizieme", "weihnachtsgeld", "gratification", "13th"],
  sick: ["sick", "ziekte", "ziek", "maladie", "krank"],
  leave: ["leave", "verlof", "conge", "urlaub"],
  indexation: ["indexation", "indexering", "indexierung", "index"],
  car: ["company car", "bedrijfswagen", "bedrijfsauto", "voiture", "dienstwagen", "firmenwagen", "car"],
  hotel: ["hotel", "overnachting", "nuitee", "ubernachtung"],
  perdiem: ["diem", "dagvergoeding", "journaliere", "tagegeld"],
  retention: ["retention", "bewaar", "conservation", "aufbewahr"],
  employee: ["employee", "werknemer", "medewerker", "salarie", "employe", "mitarbeiter", "arbeitnehmer"],
  grade: ["grade", "graad", "loonschaal", "bareme", "stufe", "gehaltsstufe"],
  tax: ["tax", "belasting", "impot", "steuer", "fiscal", "fiscaal"],
  contribution: ["contribution", "bijdrage", "cotisation", "beitrag"],
  declaration: ["declaration", "aangifte", "meldung", "dmfa", "dsn"],
  remote: ["remote", "thuiswerk", "teletravail", "homeoffice", "telewerk"],
  day: ["day", "days", "dag", "dagen", "jour", "jours", "tag"],
  week: ["week", "weekly", "weken", "semaine", "woche", "weekdag", "weekday"],
  hour: ["hour", "hours", "uur", "uren", "heure", "heures", "stunde", "stunden"],
  maximum: ["maximum", "max", "maximaal", "hochstens", "plafond", "cap"],
  // Months (exact or prefix), so "10 Dec", "12 december" and "12 décembre" line up.
  m01: ["jan", "january", "januari", "janvier", "januar"],
  m02: ["feb", "february", "februari", "fevrier", "februar"],
  m03: ["mar", "march", "maart", "mars", "marz"],
  m04: ["apr", "april", "avril"],
  m05: ["may", "mei", "mai"],
  m06: ["jun", "june", "juni", "juin"],
  m07: ["jul", "july", "juli", "juillet"],
  m08: ["aug", "august", "augustus", "aout"],
  m09: ["sep", "sept", "september", "septembre"],
  m10: ["oct", "october", "oktober", "octobre"],
  m11: ["nov", "november", "novembre"],
  m12: ["dec", "december", "decembre", "dezember"],
};

const EXACT = new Map<string, string[]>();
const PARTIAL: [string, string][] = [];
for (const [concept, stems] of Object.entries(CONCEPTS)) {
  for (const stem of stems) {
    if (stem.includes(" ")) continue; // phrases are matched on the full text below
    // Month names only match whole words ("juni" must not match "junior").
    if (stem.length >= 4 && !/^m\d\d$/.test(concept)) PARTIAL.push([stem, concept]);
    EXACT.set(stem, [...(EXACT.get(stem) ?? []), concept]);
  }
}
const PHRASES = Object.entries(CONCEPTS).flatMap(([concept, stems]) => stems.filter((s) => s.includes(" ")).map((s) => [s, concept] as const));

export function fold(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Concept ids (prefixed "c:") present in a piece of text, whatever its language. */
export function conceptsIn(text: string): Set<string> {
  const folded = fold(text);
  const out = new Set<string>();
  for (const [phrase, concept] of PHRASES) if (folded.includes(phrase)) out.add(`c:${concept}`);
  for (const word of folded.split(/[^a-z0-9]+/)) {
    if (!word) continue;
    for (const c of EXACT.get(word) ?? []) out.add(`c:${c}`);
    if (word.length < 4) continue;
    for (const [stem, concept] of PARTIAL) if (word.includes(stem)) out.add(`c:${concept}`);
  }
  return out;
}

/** Words that are covered by a concept – excluded from name/anchor detection. */
export function isConceptWord(word: string) {
  const w = fold(word);
  return EXACT.has(w) || PARTIAL.some(([stem]) => w.length >= 4 && w.includes(stem));
}
