import type { DocStatus, Location } from "./types";

/**
 * Hand-labelled statement pairs: what a payroll consultant would call a contradiction. Used by the
 * rule tests (conflicts.test.ts) and to measure Jev on the same cases (conflicts.jev.test.ts).
 */

/** One side of a labelled pair: a line (or a table header plus one row) in a document. */
export interface Side {
  text: string;
  title?: string;
  location?: Location;
  status?: DocStatus;
}

const register = "| Employee | Year | Grade | Gross monthly salary |\n|---|---|---|---|\n";
const deadlines = "| Month | Input deadline | Payroll run | Payment |\n|---|---|---|---|\n";

// Labelled by hand: what a payroll consultant would call a contradiction.
export const cases: { name: string; a: Side; b: Side; expected: "hard" | "possible" | "none" }[] = [
  // Same fact, different value
  { name: "salary vs register row", a: { text: "- Jonas Maes – gross monthly salary 2026: €3,900" }, b: { text: register + "| Jonas Maes | 2026 | P1 | €3,450 |" }, expected: "hard" },
  { name: "Dutch salary vs English register", a: { text: "- Jonas Maes – bruto maandloon 2026: € 3.900" }, b: { text: register + "| Jonas Maes | 2026 | P1 | €3,450 |" }, expected: "hard" },
  { name: "French salary, thin-space thousands", a: { text: "- Salaire mensuel brut de Jonas Maes en 2026 : 3 900 €" }, b: { text: register + "| Jonas Maes | 2026 | P1 | €3,450 |" }, expected: "hard" },
  { name: "French deadline vs table cell", a: { text: "- Date limite d'encodage de la paie de décembre 2026 : 12 décembre", title: "Planning de la paie de décembre 2026" }, b: { text: deadlines + "| December | 10 Dec | 15 Dec | 22 Dec |", title: "Payroll input deadlines Q4 2026" }, expected: "hard" },
  { name: "English deadline vs table cell", a: { text: "- December 2026 payroll input deadline: 12 December" }, b: { text: deadlines + "| December | 10 Dec | 15 Dec | 22 Dec |", title: "Payroll input deadlines Q4 2026" }, expected: "hard" },
  { name: "same mileage rate, different value", a: { text: "- Mileage allowance: €0.40/km" }, b: { text: "- Mileage allowance: €0.4326/km" }, expected: "hard" },

  // Same value, or not the same fact
  { name: "German salary that matches", a: { text: "- Bruttomonatsgehalt Jonas Maes 2026: 3.450 €" }, b: { text: register + "| Jonas Maes | 2026 | P1 | €3,450 |" }, expected: "none" },
  { name: "French run date that matches", a: { text: "- Traitement final de la paie de décembre : 15 décembre" }, b: { text: deadlines + "| December | 10 Dec | 15 Dec | 22 Dec |" }, expected: "none" },
  { name: "another person's salary", a: { text: "- Jonas Maes – gross monthly salary 2026: €3,900" }, b: { text: register + "| Lotte Peeters | 2026 | P4 | €4,850 |" }, expected: "none" },
  { name: "another month", a: { text: "- December 2026 payroll input deadline: 12 December" }, b: { text: deadlines + "| October | 20 Oct | 24 Oct | 30 Oct |" }, expected: "none" },
  { name: "another year", a: { text: "- Indexation joint committee 200: 2.0% on 1 January 2026" }, b: { text: "- Indexation joint committee 200: 11.08% on 1 January 2023" }, expected: "none" },
  { name: "another country", a: { text: "- Overtime premium: +50% on weekdays" }, b: { text: "- Overtime premium: +75% on weekdays", location: "Netherlands" }, expected: "none" },
  { name: "another topic (sick vs holiday pay)", a: { text: "- Days 1–7: 100% guaranteed salary paid by employer", title: "Sick leave – Belgium" }, b: { text: "A: 92% of the monthly gross salary, paid in May or June.", title: "Holiday pay – FAQ" }, expected: "none" },
  { name: "ordinal is not a value", a: { text: "- 10 December: deadline for client input of year-end bonuses (13th month)" }, b: { text: deadlines + "| December | 10 Dec | 15 Dec | 22 Dec |" }, expected: "none" },

  // Different, but not a clear contradiction
  { name: "change from a date", a: { text: "- Grade: P2 from 1 October 2026", title: "Salary review – Jonas Maes" }, b: { text: register + "| Jonas Maes | 2026 | P1 | €3,450 |" }, expected: "possible" },
  { name: "draft proposal vs current rule", a: { text: "- Hotel cap: €120/night" }, b: { text: "- Hotel cap: €150/night", status: "WIP" }, expected: "possible" },
  { name: "country rule vs global policy", a: { text: "- Mileage allowance 2026: €0.23 per km", location: "Netherlands" }, b: { text: "- Mileage allowance: €0.3707/km", location: "Global" }, expected: "possible" },
];
