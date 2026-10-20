import { fold } from "./lexicon";

/**
 * The tags documents can carry – topics in two levels and document types – and the countries documents
 * apply to. They're stored in the database (`taxonomy_terms`) so people can change them on the Company &
 * tags page; the lists below are what a new database starts with. Teams, people and clients live in the
 * data itself. Topic and document type ids are the slugs stored in `documents.tags`; a country's id is its
 * name, as stored in `location`.
 * Keywords (English, Dutch, French, German; lowercase, accents stripped) are evidence for the rules and
 * for filtering Jev's suggestions; stems of 5+ letters also match inside longer words.
 */

export type TermKind = "topic" | "docType" | "country";

export interface Term {
  kind: TermKind;
  id: string;
  label: string;
  description: string;
  keywords: string[];
  /** Topics: the parent's id (top-level topics have none). */
  parent?: string;
}

/** Applies to several countries or none in particular. Always available; not a stored country. */
export const GLOBAL = "Global";

const DEFAULT_TOPICS: Omit<Term, "kind">[] = [
  { id: "payroll-processing", label: "Payroll processing", description: "Running the payroll: monthly cycles, closings, inputs, payslips and payroll declarations", keywords: ["payroll", "payslip", "loonverwerking", "verloning", "loonstrook", "paie", "bulletin", "lohnabrechnung", "gehaltsabrechnung", "payroll run"] },
  { id: "year-end", parent: "payroll-processing", label: "Year-end closing", description: "Year-end payroll closing, year-end bonuses and annual tax forms", keywords: ["year-end", "year end", "jaareinde", "eindejaar", "fin d'annee", "jahresabschluss", "belcotax", "281.10", "13th month", "dertiende maand"] },
  { id: "deadlines", parent: "payroll-processing", label: "Deadlines & calendars", description: "Input deadlines, payroll run dates, payment dates and payroll calendars", keywords: ["deadline", "uiterste datum", "date limite", "frist", "calendar", "kalender", "calendrier", "input deadline", "payment date"] },
  { id: "declarations", parent: "payroll-processing", label: "Social declarations", description: "Social security and tax declarations to authorities (DmfA, DSN, Lohnsteuer, loonaangifte)", keywords: ["dmfa", "dsn", "declaration", "aangifte", "declaration sociale", "meldung", "urssaf", "rsz", "onss", "lohnsteuer", "sozialversicherung"] },
  { id: "indexation", parent: "payroll-processing", label: "Indexation", description: "Automatic salary indexation per joint committee", keywords: ["indexation", "indexering", "indexierung", "index", "joint committee", "paritair comite", "pc 200"] },

  { id: "compensation", label: "Compensation & benefits", description: "Salaries, bonuses, holiday pay, allowances, benefits in kind and their taxation", keywords: ["compensation", "remuneration", "beloning", "verloning", "remuneration", "vergutung"] },
  { id: "salary", parent: "compensation", label: "Salary", description: "Gross and net salaries, salary scales, registers and changes", keywords: ["salary", "salaries", "loon", "salaris", "brutoloon", "maandloon", "salaire", "gehalt", "lohn", "verdienst", "grade", "bareme", "loonschaal"] },
  { id: "bonus", parent: "compensation", label: "Bonuses", description: "End-of-year premiums, 13th month and other bonuses", keywords: ["bonus", "premie", "eindejaarspremie", "prime", "treizieme", "weihnachtsgeld", "gratification"] },
  { id: "holiday-pay", parent: "compensation", label: "Holiday pay", description: "Holiday pay and double holiday pay", keywords: ["holiday pay", "vakantiegeld", "pecule de vacances", "conges payes", "urlaubsgeld"] },
  { id: "allowance", parent: "compensation", label: "Allowances", description: "Remote work, mileage, meal and other allowances paid to employees", keywords: ["allowance", "vergoeding", "toelage", "thuiswerk", "indemnite", "teletravail", "zulage", "pauschale", "homeoffice", "mileage", "kilometer"] },
  { id: "benefits", parent: "compensation", label: "Benefits", description: "Company cars, health insurance and other benefits in kind", keywords: ["benefit", "company car", "bedrijfswagen", "bijtelling", "auto van de zaak", "avantage", "voiture", "mutuelle", "sachbezug", "dienstwagen", "insurance", "verzekering"] },
  { id: "tax", parent: "compensation", label: "Taxation", description: "Tax treatment of pay and benefits", keywords: ["tax", "taxation", "belasting", "fiscaal", "impot", "fiscal", "steuer", "co2"] },

  { id: "time", label: "Time & attendance", description: "Working time, clocking, overtime and absences", keywords: ["time registration", "tijdsregistratie", "temps de travail", "arbeitszeit", "attendance"] },
  { id: "clocking", parent: "time", label: "Clocking terminals", description: "Clocking terminals, badges, devices and their setup and troubleshooting", keywords: ["clocking", "terminal", "badge", "prikklok", "pointeuse", "stempeluhr", "firmware", "device"] },
  { id: "overtime", parent: "time", label: "Overtime", description: "Overtime rules, premiums and recovery time", keywords: ["overtime", "overuren", "overwerk", "heures supplementaires", "uberstunden", "mehrarbeit", "recovery time"] },
  { id: "absence", parent: "time", label: "Absence & sickness", description: "Sick leave, guaranteed salary and absence codes", keywords: ["absence", "afwezigheid", "sick", "ziekte", "ziek", "maladie", "krank", "entgeltfortzahlung", "guaranteed salary", "gewaarborgd loon", "salaire garanti"] },
  { id: "leave", parent: "time", label: "Leave", description: "Holidays, leave entitlements and leave types", keywords: ["leave", "verlof", "conge", "urlaub"] },

  { id: "expenses", label: "Expenses & travel", description: "Expense claims, travel policies, hotel caps and per diems", keywords: ["expense", "onkosten", "kosten", "frais", "spesen", "receipt", "per diem", "hotel"] },
  { id: "travel", parent: "expenses", label: "Business travel", description: "Business travel rules, mileage, hotels and per diems", keywords: ["travel", "reis", "voyage", "reise", "hotel", "per diem", "mileage"] },

  { id: "compliance", label: "Legal & compliance", description: "Privacy, data protection and record keeping", keywords: ["compliance", "legal", "juridisch", "juridique", "recht"] },
  { id: "gdpr", parent: "compliance", label: "GDPR & privacy", description: "Personal data, subject access requests and privacy rules", keywords: ["gdpr", "avg", "rgpd", "dsgvo", "privacy", "personal data", "persoonsgegevens", "subject access"] },
  { id: "master-data", parent: "compliance", label: "Employee master data", description: "Employee master data and how long records are kept", keywords: ["master data", "personeelsgegevens", "donnees", "stammdaten", "retention", "bewaartermijn", "conservation", "aufbewahrung"] },

  { id: "client-service", label: "Client service", description: "Working with payroll clients: client files, support and escalations", keywords: ["client", "klant", "customer", "kunde"] },
  { id: "client", parent: "client-service", label: "Client management", description: "Client files, client portfolios and client-specific agreements", keywords: ["client", "klant", "portfolio", "portefeuille", "kunde", "client file"] },
  { id: "support", parent: "client-service", label: "Support & escalations", description: "Support tickets, troubleshooting and escalations", keywords: ["support", "troubleshooting", "escalation", "escalatie", "ticket", "helpdesk", "quick fix", "storing"] },

  { id: "knowledge-sharing", label: "Knowledge sharing", description: "Handovers, onboarding and team knowledge", keywords: ["knowledge", "kennis", "connaissance", "wissen"] },
  { id: "handover", parent: "knowledge-sharing", label: "Handovers", description: "Handing over clients, documents and responsibilities", keywords: ["handover", "overdracht", "passation", "ubergabe", "backup", "back-up"] },
  { id: "onboarding", parent: "knowledge-sharing", label: "Onboarding", description: "Onboarding new colleagues", keywords: ["onboarding", "inwerking", "nieuwe medewerker", "new joiner", "integration", "einarbeitung"] },
];

const DEFAULT_DOC_TYPES: Omit<Term, "kind">[] = [
  { id: "policy", label: "Policy", description: "Rules and entitlements that apply (amounts, conditions)", keywords: ["policy", "beleid", "regeling", "politique", "richtlinie", "regelung", "reglement", "rules", "regels", "regles", "regeln", "entitled", "recht op", "a droit", "anspruch", "obligatoire", "verplicht", "pflicht", "indemnite", "allowance"] },
  { id: "procedure", label: "Procedure", description: "Steps to carry out a process", keywords: ["procedure", "procedure", "stappen", "steps", "werkwijze", "verfahren", "ablauf", "how to", "installation"] },
  { id: "checklist", label: "Checklist", description: "Items to check off", keywords: ["checklist", "checkliste", "check-list", "controlelijst"] },
  { id: "reference", label: "Reference", description: "Tables, registers, calendars and lists to look things up", keywords: ["register", "overview", "overzicht", "calendar", "kalender", "calendrier", "codes", "models", "contacts", "uberblick", "apercu"] },
  { id: "guide", label: "Guide", description: "Explanations, questions and answers, troubleshooting and quick fixes", keywords: ["guide", "troubleshooting", "quick fixes", "handleiding", "gids", "anleitung", "faq", "q:", "vraag", "question", "frage"] },
  { id: "informal", label: "Informal", description: "Notes, tips and know-how written down informally – not an official policy or procedure", keywords: ["notes", "note", "tips", "tip", "fyi", "quick note", "good to know", "notities", "weetje", "astuce", "bon a savoir", "notizen", "hinweis", "tipp"] },
];

const DEFAULT_COUNTRY_EVIDENCE: Record<string, string[]> = {
  Belgium: ["belgium", "belgie", "belgique", "belgien", "belgian", "belge", "(be)", "dmfa", "belcotax", "joint committee", "paritair", "pc 200", "rsz", "onss", "mysdworx pay"],
  Netherlands: ["netherlands", "nederland", "pays-bas", "niederlande", "dutch", "vakantiegeld", "bijtelling", "loonaangifte", "cao", "thuiswerkvergoeding"],
  France: ["france", "frankrijk", "frankreich", "french", "dsn", "urssaf", "mutuelle", "teletravail", "cloture"],
  Germany: ["germany", "deutschland", "duitsland", "allemagne", "german", "minijob", "lohnabrechnung", "entgeltfortzahlung", "krankenkasse", "lohnsteuer"],
};

export const DEFAULT_TERMS: Term[] = [
  ...DEFAULT_TOPICS.map((t) => ({ ...t, kind: "topic" as const })),
  ...DEFAULT_DOC_TYPES.map((t) => ({ ...t, kind: "docType" as const })),
  ...Object.entries(DEFAULT_COUNTRY_EVIDENCE).map(([name, keywords]) => ({ kind: "country" as const, id: name, label: name, description: `Rules and work in ${name}`, keywords })),
];

export type Taxonomy = ReturnType<typeof taxonomyOf>;

/** Lookups over a set of terms (as stored, or the defaults). */
export function taxonomyOf(terms: Term[]) {
  const byLabel = (a: Term, b: Term) => a.label.localeCompare(b.label);
  const topics = terms.filter((t) => t.kind === "topic");
  const docTypes = terms.filter((t) => t.kind === "docType");
  const countries = terms.filter((t) => t.kind === "country").sort(byLabel);
  const topic = new Map(topics.map((t) => [t.id, t]));
  const docType = new Map(docTypes.map((t) => [t.id, t]));
  const isKnownTag = (id: string) => topic.has(id) || docType.has(id);
  return {
    terms,
    topics,
    docTypes,
    countries,
    topic,
    docType,
    topTopics: topics.filter((t) => !t.parent),
    childrenOf: (id: string) => topics.filter((t) => t.parent === id),
    /** Every value a document's location can take: the countries, then Global. */
    locations: [...countries.map((c) => c.id), GLOBAL],
    isKnownTag,
    tagLabel: (id: string) => topic.get(id)?.label ?? docType.get(id)?.label ?? id,
    /** Words that point at one country; documents naming several (or none) apply globally. */
    countryEvidence: Object.fromEntries(countries.map((c) => [c.id, c.keywords])) as Record<string, string[]>,
    /** A tag set with every topic's parent added (tagging a leaf implies its parent). */
    withParents(tags: Iterable<string>) {
      const out = new Set(tags);
      for (const t of [...out]) {
        const parent = topic.get(t)?.parent;
        if (parent) out.add(parent);
      }
      return out;
    },
    /** The topics among some tags, without a main topic when one of its sub-topics is there too. */
    mostSpecific(tags: string[]) {
      const topics = tags.filter((t) => topic.has(t));
      return topics.filter((t) => !topics.some((c) => topic.get(c)?.parent === t));
    },
    /** What a document's tags still lack before it can be saved: a document type and a topic. */
    missingTags(tags: string[]) {
      return [...(tags.some((t) => docType.has(t)) ? [] : ["a document type"]), ...(tags.some((t) => topic.has(t)) ? [] : ["a topic"])];
    },
  };
}

export const DEFAULT_TAXONOMY = taxonomyOf(DEFAULT_TERMS);

export const KIND_LABEL: Record<TermKind, string> = { topic: "topic", docType: "document type", country: "country" };

/** "Holiday pay" → "holiday-pay": the id a new topic or document type gets. */
export function slugify(label: string) {
  return fold(label).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "tag";
}

export interface TermInput {
  label: string;
  description?: string;
  keywords?: string[];
  parent?: string | null;
}

/** An error to show, or null. `editing` is the term being changed (its kind and id stay the same). */
export function validateTerm(tax: Taxonomy, kind: TermKind, input: TermInput, editing?: Term): string | null {
  const label = input.label.trim();
  if (!label) return "Give it a name.";
  if (label.length > 60) return "Keep the name under 60 characters.";
  if (kind === "country" && fold(label) === fold(GLOBAL)) return "“Global” is always available; it isn't a country to add.";
  const sameKind = tax.terms.filter((t) => t.kind === kind && !(editing && t.id === editing.id));
  if (sameKind.some((t) => fold(t.label) === fold(label))) return `There's already a ${KIND_LABEL[kind]} called “${label}”.`;
  if (kind === "topic" && input.parent) {
    const parent = tax.topic.get(input.parent);
    if (!parent || parent.parent) return "A sub-topic goes under a main topic (two levels).";
    if (editing && tax.childrenOf(editing.id).length) return "This topic has sub-topics of its own, so it has to stay a main topic.";
  }
  if ((input.keywords ?? []).some((k) => k.length > 60)) return "Keep each keyword under 60 characters.";
  return null;
}

/** A fresh id for a new term: the slug of its label, unique among tags (topics and document types share ids). */
export function newTermId(tax: Taxonomy, kind: TermKind, label: string) {
  if (kind === "country") return label.trim();
  const base = slugify(label);
  let id = base;
  for (let n = 2; tax.isKnownTag(id); n++) id = `${base}-${n}`;
  return id;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** How many of the keywords occur in the text: stems of 5+ letters inside words ("maandloon"), shorter words and phrases on their own. */
export function keywordHits(text: string, keywords: string[]) {
  const folded = fold(text);
  return keywords.filter((k) => {
    const key = fold(k);
    return key.length >= 5 && !key.includes(" ") ? folded.includes(key) : new RegExp(`(?<![a-z0-9])${escape(key)}(?![a-z0-9])`).test(folded);
  }).length;
}
