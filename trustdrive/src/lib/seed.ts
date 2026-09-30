import type { Db, Doc, Person, Team } from "./types";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export function buildSeed(now = Date.now()): Db {
  const ago = (days: number, hours = 0) => new Date(now - days * DAY - hours * HOUR).toISOString();

  const teams: Team[] = [
    { id: "pay-be", name: "Payroll Belgium" },
    { id: "pay-nl", name: "Payroll Netherlands" },
    { id: "pay-fr", name: "Payroll France" },
    { id: "pay-de", name: "Payroll Germany" },
    { id: "hr-ops", name: "HR Operations" },
    { id: "legal", name: "Legal & Compliance" },
    { id: "time", name: "Time & Attendance" },
    { id: "cs", name: "Customer Success" },
  ];

  const people: Person[] = [
    { id: "lotte", name: "Lotte Peeters", role: "Senior Payroll Consultant", teamId: "pay-be", location: "Belgium", active: true, joinedAt: ago(2400), color: "#1a73e8" },
    { id: "jonas", name: "Jonas Maes", role: "Payroll Consultant", teamId: "pay-be", location: "Belgium", active: true, joinedAt: ago(120), color: "#e8710a" },
    { id: "an", name: "An Claes", role: "Payroll Team Lead", teamId: "pay-be", location: "Belgium", active: true, joinedAt: ago(3100), color: "#188038" },
    { id: "pieter", name: "Pieter Wouters", role: "Payroll Consultant", teamId: "pay-be", location: "Belgium", active: false, joinedAt: ago(2900), leftAt: ago(740), color: "#9334e6" },
    { id: "sanne", name: "Sanne de Vries", role: "Payroll Specialist", teamId: "pay-nl", location: "Netherlands", active: true, joinedAt: ago(1500), color: "#d01884" },
    { id: "daan", name: "Daan Bakker", role: "Payroll Consultant", teamId: "pay-nl", location: "Netherlands", active: false, joinedAt: ago(1800), leftAt: ago(95), color: "#b06000" },
    { id: "camille", name: "Camille Durand", role: "Payroll Specialist", teamId: "pay-fr", location: "France", active: true, joinedAt: ago(900), color: "#12b5cb" },
    { id: "marc", name: "Marc Dubois", role: "HR Business Partner", teamId: "hr-ops", location: "Belgium", active: true, joinedAt: ago(2000), previousTeamId: "pay-be", movedTeamAt: ago(420), color: "#5f6368" },
    { id: "eva", name: "Eva Janssens", role: "HR Operations Manager", teamId: "hr-ops", location: "Global", active: true, joinedAt: ago(1700), color: "#c5221f" },
    { id: "tom", name: "Tom Hermans", role: "Legal Counsel", teamId: "legal", location: "Belgium", active: true, joinedAt: ago(2600), color: "#3949ab" },
    { id: "julia", name: "Julia Schmidt", role: "Compliance Officer", teamId: "legal", location: "Germany", active: false, joinedAt: ago(2200), leftAt: ago(380), color: "#00897b" },
    { id: "wout", name: "Wout Jacobs", role: "Time & Attendance Engineer", teamId: "time", location: "Belgium", active: true, joinedAt: ago(1100), color: "#f9ab00" },
    { id: "nina", name: "Nina Vermeulen", role: "Customer Success Manager", teamId: "cs", location: "Belgium", active: true, joinedAt: ago(600), color: "#e52592" },
    { id: "sofie", name: "Sofie Willems", role: "Payroll Consultant", teamId: "pay-be", location: "Belgium", active: true, joinedAt: ago(1300), color: "#7cb342" },
    { id: "karim", name: "Karim El Amrani", role: "Payroll Consultant", teamId: "pay-be", location: "Belgium", active: true, joinedAt: ago(480), color: "#6d4c41" },
    { id: "lars", name: "Lars de Jong", role: "Senior Payroll Specialist", teamId: "pay-nl", location: "Netherlands", active: true, joinedAt: ago(2100), color: "#0277bd" },
    { id: "emma", name: "Emma Visser", role: "Junior Payroll Specialist", teamId: "pay-nl", location: "Netherlands", active: true, joinedAt: ago(60), color: "#ad1457" },
    { id: "lea", name: "Léa Martin", role: "Responsable Paie", teamId: "pay-fr", location: "France", active: true, joinedAt: ago(1600), color: "#00838f" },
    { id: "hugo", name: "Hugo Bernard", role: "Gestionnaire Paie", teamId: "pay-fr", location: "France", active: false, joinedAt: ago(2000), leftAt: ago(410), color: "#8d6e63" },
    { id: "felix", name: "Felix Wagner", role: "Payroll Team Lead Germany", teamId: "pay-de", location: "Germany", active: true, joinedAt: ago(900), color: "#283593" },
    { id: "lena", name: "Lena Fischer", role: "Payroll Specialist", teamId: "pay-de", location: "Germany", active: true, joinedAt: ago(350), color: "#c0ca33" },
    { id: "bram", name: "Bram Goossens", role: "Time & Attendance Engineer", teamId: "time", location: "Belgium", active: true, joinedAt: ago(1400), previousTeamId: "cs", movedTeamAt: ago(200), color: "#546e7a" },
    { id: "inge", name: "Inge Smets", role: "HR Operations Specialist", teamId: "hr-ops", location: "Belgium", active: true, joinedAt: ago(800), color: "#d84315" },
    { id: "ruben", name: "Ruben Dierckx", role: "Customer Success Lead", teamId: "cs", location: "Belgium", active: false, joinedAt: ago(1900), leftAt: ago(160), color: "#5e35b1" },
  ];

  const views = (ids: string[], spreadDays: number) =>
    ids.map((personId, i) => ({ personId, at: ago((i * spreadDays) / Math.max(ids.length, 1), i) }));

  const docs: Doc[] = [
    {
      id: "be-yearend-2026",
      title: "Year-end payroll closing procedure – Belgium 2026",
      kind: "doc",
      ownerId: "lotte",
      collaboratorIds: ["an", "jonas"],
      readerIds: ["nina", "marc"],
      location: "Belgium",
      status: "Completed",
      teamId: "pay-be",
      tags: ["year-end", "payroll-processing", "procedure"],
      createdAt: ago(60),
      updatedAt: ago(0, 2),
      lastEditedById: "lotte",
      verifications: [{ personId: "an", at: ago(5) }, { personId: "lotte", at: ago(0, 2) }],
      views: views(["jonas", "nina", "an", "marc", "jonas", "lotte", "nina"], 14),
      content: `# Year-end payroll closing – Belgium 2026

This procedure applies to all Belgian clients on the mysdworx Pay platform for the 2026 closing.

## Timeline
- 1 December: freeze of payroll configuration changes for December runs
- 10 December: deadline for client input of year-end bonuses (13th month)
- 15 December: final December payroll run
- 5 January 2027: Belfius/ING payment files for December validated
- 28 February 2027: tax forms 281.10 submitted via Belcotax-on-web

## Steps
1. Run the "Year-end readiness" report per client and resolve all blocking warnings.
2. Check indexation for joint committee 200 (2.0% on 1 January 2027 – confirmed by the sector).
3. Validate the end-of-year premium calculation for part-time employees (pro rata on worked days).
4. Lock the payroll period and generate the DmfA Q4 declaration.
5. Archive the client year-end checklist in the client folder.

## Contacts
Questions: Lotte Peeters (owner) or An Claes (team lead).`,
    },
    {
      id: "be-yearend-2023",
      title: "Year-end payroll closing procedure – Belgium",
      kind: "doc",
      ownerId: "pieter",
      collaboratorIds: ["daan"],
      readerIds: ["jonas", "nina"],
      location: "Belgium",
      status: "Completed",
      teamId: "pay-be",
      tags: ["year-end", "payroll-processing", "procedure"],
      createdAt: ago(1100),
      updatedAt: ago(1010),
      lastEditedById: "pieter",
      verifications: [{ personId: "pieter", at: ago(1010) }],
      views: views(["jonas"], 30),
      supersededById: "be-yearend-2026",
      content: `# Year-end payroll closing – Belgium

## Timeline
- 5 December: freeze of payroll configuration changes
- 12 December: deadline for client input of year-end bonuses
- 20 December: final December payroll run
- 28 February 2024: tax forms 281.10 submitted via Belcotax

## Steps
1. Export the year-end overview from the old payroll engine (Legacy Pay 7).
2. Indexation for joint committee 200: 11.08% on 1 January 2023.
3. Calculate end-of-year premium manually in the Excel template for part-timers.
4. Send the DmfA Q4 via the batch upload tool.

Contact Pieter for questions.`,
    },
    {
      id: "client-handover",
      title: "Client portfolio handover checklist",
      kind: "doc",
      ownerId: "an",
      collaboratorIds: ["lotte", "sanne"],
      readerIds: ["jonas", "nina", "camille"],
      location: "Global",
      status: "WIP",
      teamId: "pay-be",
      tags: ["handover", "client", "knowledge-sharing"],
      createdAt: ago(20),
      updatedAt: ago(3),
      lastEditedById: "sanne",
      verifications: [],
      views: views(["jonas", "nina", "camille", "jonas"], 10),
      content: `# Client portfolio handover checklist

Use this when a payroll client moves from one consultant to another.

## Before the handover
- Share the client configuration summary (joint committees, pay frequencies, special allowances)
- List all open tickets and their status
- Note client-specific agreements that are **not** in the contract (e.g. extra payroll run in July)

## Handover meeting (1 hour)
- Walk through last 3 payroll runs and any corrections
- Introduce the new consultant to the client HR contact

## After the handover
- Old consultant remains backup for 2 payroll cycles
- TODO: add section on access rights transfer in mysdworx`,
    },
    {
      id: "overtime-nl",
      title: "Overtime policy – Netherlands",
      kind: "doc",
      ownerId: "sanne",
      collaboratorIds: [],
      readerIds: ["daan"],
      location: "Netherlands",
      status: "Completed",
      teamId: "pay-nl",
      tags: ["overtime", "policy", "time"],
      createdAt: ago(400),
      updatedAt: ago(45),
      lastEditedById: "sanne",
      verifications: [{ personId: "sanne", at: ago(40) }],
      views: views(["daan", "sanne"], 30),
      content: `# Overtime policy – Netherlands

Overtime is compensated according to the applicable CAO. If no CAO applies:

- Overtime is paid at 100% of the hourly wage unless otherwise agreed in the employment contract.
- Time off in lieu (tijd-voor-tijd) must be taken within 12 months.
- Overtime hours are registered through clocking in mysdworx Time and approved by the manager.

Reference: Arbeidstijdenwet 2026 limits – max 12 hours per shift, 60 hours per week.`,
    },
    {
      id: "overtime-be",
      title: "Overtime policy – Belgium",
      kind: "doc",
      ownerId: "marc",
      collaboratorIds: ["pieter"],
      readerIds: ["jonas", "lotte"],
      location: "Belgium",
      status: "To be reviewed",
      teamId: "pay-be",
      tags: ["overtime", "policy", "time"],
      createdAt: ago(1300),
      updatedAt: ago(610),
      lastEditedById: "pieter",
      verifications: [{ personId: "marc", at: ago(700) }],
      views: views(["jonas", "lotte", "wout"], 60),
      content: `# Overtime policy – Belgium

- Overtime pay: +50% on weekdays, +100% on Sundays and public holidays.
- Voluntary overtime: max 100 hours per calendar year (2021 regime – temporary increase to 220 hours has ended).
- "Relance" hours: 120 hours tax-free (2021 recovery measure).
- Recovery time must be granted within the reference period of 3 months.

NOTE: to be updated with the 2024 labour deal changes.`,
    },
    {
      id: "sick-leave-be",
      title: "Sick leave & guaranteed salary – Belgium",
      kind: "doc",
      ownerId: "an",
      collaboratorIds: ["lotte"],
      readerIds: ["jonas", "nina", "marc"],
      location: "Belgium",
      status: "Completed",
      teamId: "pay-be",
      tags: ["absence", "leave", "policy"],
      createdAt: ago(300),
      updatedAt: ago(21),
      lastEditedById: "an",
      verifications: [{ personId: "an", at: ago(21) }],
      views: views(["jonas", "nina", "marc", "jonas", "lotte"], 20),
      content: `# Sick leave & guaranteed salary – Belgium

## Blue- and white-collar workers (unified statute)
- Days 1–7: 100% guaranteed salary paid by employer
- Days 8–30: guaranteed salary per the unified regime (employer supplement + health insurance)
- From day 31: health insurance fund takes over

## Medical certificate
Since 2026 the certificate is only required from the 3rd sick day in companies with 50+ employees (max 3 certificate-free days per year).

## Payroll input
Register absences via mysdworx Time; codes S1 (sick) and S2 (relapse within 14 days).`,
    },
    {
      id: "holiday-pay-faq",
      title: "Holiday pay calculation FAQ",
      kind: "doc",
      ownerId: null,
      collaboratorIds: ["pieter", "daan"],
      readerIds: ["jonas", "nina", "sanne"],
      location: "Global",
      status: "Completed",
      teamId: "pay-be",
      tags: ["holiday-pay", "faq", "payroll-processing"],
      createdAt: ago(900),
      updatedAt: ago(500),
      lastEditedById: "daan",
      verifications: [],
      views: views(["jonas", "nina", "sanne", "nina", "jonas", "nina"], 25),
      content: `# Holiday pay – FAQ

**Q: How is double holiday pay calculated for white-collar workers?**
A: 92% of the monthly gross salary, paid in May or June.

**Q: What about blue-collar workers?**
A: Paid by the holiday fund, not by the employer.

**Q: Does this apply to the Netherlands?**
A: Probably similar – vakantiegeld is 8%. Check with the NL team.`,
    },
    {
      id: "company-car-be",
      title: "Company car benefit in kind – taxation 2026 (BE)",
      kind: "sheet",
      ownerId: "tom",
      collaboratorIds: ["lotte"],
      readerIds: ["an", "jonas", "nina"],
      location: "Belgium",
      status: "Completed",
      teamId: "legal",
      tags: ["benefits", "tax", "compensation"],
      createdAt: ago(270),
      updatedAt: ago(12),
      lastEditedById: "tom",
      verifications: [{ personId: "tom", at: ago(12) }, { personId: "lotte", at: ago(10) }],
      views: views(["an", "jonas", "nina", "lotte"], 12),
      content: `# Company car benefit in kind – 2026

| Parameter | 2026 value |
|---|---|
| Reference CO2 (petrol) | 72 g/km |
| Reference CO2 (diesel) | 60 g/km |
| Minimum benefit per year | €1,650 |
| Zero-emission cars | 4% base rate |

- Fossil-fuel cars ordered after 1 July 2023: deductibility phases down to 0% by 2026.
- Benefit in kind = catalogue value × 6/7 × CO2 percentage × age coefficient.`,
    },
    {
      id: "remote-work",
      title: "Remote work allowance policy",
      kind: "doc",
      ownerId: "eva",
      collaboratorIds: ["julia"],
      readerIds: ["an", "sanne", "camille", "marc"],
      location: "Global",
      status: "Completed",
      teamId: "hr-ops",
      tags: ["allowance", "policy", "compensation"],
      createdAt: ago(800),
      updatedAt: ago(390),
      lastEditedById: "julia",
      verifications: [{ personId: "julia", at: ago(390) }],
      views: views(["an", "sanne", "camille"], 90),
      content: `# Remote work allowance

- Belgium: office allowance of max €151.70/month (tax-free, indexed yearly).
- Netherlands: thuiswerkvergoeding €2.35 per day worked from home.
- France: no statutory allowance; company pays €2.50/day.
- Germany: Homeoffice-Pauschale €6/day, max 210 days.

Allowances are entered as recurring payroll input.`,
    },
    {
      id: "clocking-terminals",
      title: "Clocking terminal troubleshooting guide",
      kind: "doc",
      ownerId: "wout",
      collaboratorIds: [],
      readerIds: ["nina", "jonas", "lotte", "sanne"],
      location: "Global",
      status: "Completed",
      teamId: "time",
      tags: ["clocking", "time", "support"],
      createdAt: ago(200),
      updatedAt: ago(8),
      lastEditedById: "wout",
      verifications: [{ personId: "wout", at: ago(8) }],
      views: views(["nina", "jonas", "nina", "lotte", "sanne", "nina", "nina", "jonas"], 20),
      content: `# Clocking terminal troubleshooting

1. Terminal shows "offline": check PoE switch port, then reboot terminal (hold power 10s).
2. Badge not recognised: re-sync badge list via mysdworx Time > Devices > Sync.
3. Clockings missing in counters: verify the terminal time zone matches the site.
4. Still failing: open a ticket with category "Time – Devices" including the terminal serial.`,
    },
    {
      id: "clocking-cs-copy",
      title: "Clocking terminals – quick fixes (CS copy)",
      kind: "doc",
      ownerId: "nina",
      collaboratorIds: [],
      readerIds: ["jonas"],
      location: "Global",
      status: "Completed",
      teamId: "cs",
      tags: ["clocking", "time", "support"],
      createdAt: ago(25),
      updatedAt: ago(25),
      lastEditedById: "nina",
      verifications: [],
      views: views(["nina", "jonas"], 20),
      content: `# Clocking terminals – quick fixes (CS copy)

Copied from the Time team guide so we have it at hand during customer calls.

1. Terminal offline? Check the PoE port on the switch, then reboot the terminal by holding the power button for 10 seconds.
2. Badge not recognised: sync the badge list in mysdworx Time > Devices > Sync.
3. Missing clockings in the counters: make sure the terminal's time zone matches the site.
4. Still broken: log a ticket in category "Time – Devices" with the terminal serial number.`,
    },
    {
      id: "dmfa-checklist",
      title: "DmfA quarterly declaration checklist",
      kind: "doc",
      ownerId: "lotte",
      collaboratorIds: ["an"],
      readerIds: ["jonas"],
      location: "Belgium",
      status: "Completed",
      teamId: "pay-be",
      tags: ["declarations", "payroll-processing", "checklist"],
      createdAt: ago(500),
      updatedAt: ago(150),
      lastEditedById: "lotte",
      verifications: [{ personId: "an", at: ago(95) }],
      views: views(["jonas", "jonas"], 40),
      content: `# DmfA quarterly declaration checklist

- Reconcile the quarterly payroll journal with the DmfA totals
- Check worker codes and joint committee per employee
- Validate reductions (structural reduction, first hires)
- Submit before the last day of the month following the quarter
- Store the acknowledgement (PID) in the client folder`,
    },
    {
      id: "expense-policy-draft",
      title: "Travel & expense policy 2027 (draft)",
      kind: "doc",
      ownerId: "eva",
      collaboratorIds: ["marc"],
      readerIds: [],
      location: "Global",
      status: "WIP",
      teamId: "hr-ops",
      tags: ["expenses", "travel", "policy"],
      createdAt: ago(9),
      updatedAt: ago(1),
      lastEditedById: "marc",
      verifications: [],
      views: views(["marc"], 2),
      content: `# Travel & expense policy 2027 – DRAFT

- Mileage allowance: €0.4326/km (BE, from 1 January 2027 – to be confirmed)
- Hotel cap: €150/night in Europe, €220 in capital cities
- Per diem: to be aligned with the new country tables
- Expenses submitted via mysdworx Travel & Expense within 30 days`,
    },
    {
      id: "expense-policy",
      title: "Travel & expense policy",
      kind: "pdf",
      ownerId: "julia",
      collaboratorIds: [],
      readerIds: ["an", "lotte", "sanne", "nina"],
      location: "Global",
      status: "Completed",
      teamId: "legal",
      tags: ["expenses", "travel", "policy"],
      createdAt: ago(1400),
      updatedAt: ago(720),
      lastEditedById: "julia",
      verifications: [{ personId: "julia", at: ago(720) }],
      views: views(["an", "lotte", "sanne", "nina", "jonas"], 60),
      content: `# Travel & expense policy

- Mileage allowance: €0.3707/km
- Hotel cap: €120/night
- Expenses must be submitted on paper forms within 60 days
- Per diem according to the 2022 country tables`,
    },
    {
      id: "mutuelle-fr",
      title: "Mandatory health insurance (mutuelle) – France",
      kind: "doc",
      ownerId: "camille",
      collaboratorIds: [],
      readerIds: ["eva"],
      location: "France",
      status: "Completed",
      teamId: "pay-fr",
      tags: ["benefits", "declarations", "policy"],
      createdAt: ago(250),
      updatedAt: ago(30),
      lastEditedById: "camille",
      verifications: [{ personId: "camille", at: ago(30) }],
      views: views(["eva", "camille"], 20),
      content: `# Mutuelle obligatoire – France

- Every private-sector employer must offer collective health insurance.
- Employer pays at least 50% of the contribution.
- Exemptions (dispenses d'adhésion) must be documented per employee.
- Contributions are reported monthly in the DSN.`,
    },
    {
      id: "gdpr-retention",
      title: "Employee master data retention (GDPR)",
      kind: "doc",
      ownerId: "tom",
      collaboratorIds: ["julia"],
      readerIds: ["eva", "an", "sanne"],
      location: "Global",
      status: "Completed",
      teamId: "legal",
      tags: ["gdpr", "master-data", "policy"],
      createdAt: ago(1000),
      updatedAt: ago(410),
      lastEditedById: "tom",
      verifications: [{ personId: "julia", at: ago(410) }],
      views: views(["eva", "an"], 100),
      content: `# Employee master data retention

- Payroll records: keep 5 years after the end of the year they relate to (BE), 7 years (NL).
- Recruitment data of rejected candidates: delete after 1 year unless consent.
- Medical certificates: keep only as long as needed for payroll, then delete.
- Access to master data follows the least-privilege principle in mysdworx HR.`,
    },
    {
      id: "salary-register-be",
      title: "Salary register 2026 – Payroll Belgium team",
      kind: "sheet",
      ownerId: "an",
      collaboratorIds: ["lotte"],
      readerIds: ["eva"],
      location: "Belgium",
      status: "Completed",
      teamId: "pay-be",
      tags: ["salary", "compensation", "payroll-processing"],
      createdAt: ago(270),
      updatedAt: ago(10),
      lastEditedById: "an",
      verifications: [{ personId: "an", at: ago(10) }],
      views: views(["eva", "lotte", "an"], 20),
      content: `# Salary register 2026 – Payroll Belgium team

Gross monthly salaries as of 1 January 2026 (after the 2.0% indexation).

| Employee | Year | Grade | Gross monthly salary |
|---|---|---|---|
| Lotte Peeters | 2026 | P4 | €4,850 |
| Jonas Maes | 2026 | P1 | €3,450 |
| An Claes | 2026 | M2 | €5,900 |

- Next indexation: 1 January 2027
- Salary changes require approval by the team lead and HR Operations.`,
    },
    {
      id: "input-deadlines",
      title: "Payroll input deadlines Q4 2026",
      kind: "sheet",
      ownerId: "jonas",
      collaboratorIds: ["lotte"],
      readerIds: ["nina"],
      location: "Belgium",
      status: "To be reviewed",
      teamId: "pay-be",
      tags: ["deadlines", "payroll-processing", "year-end"],
      createdAt: ago(14),
      updatedAt: ago(6),
      lastEditedById: "jonas",
      verifications: [],
      views: views(["nina", "lotte"], 5),
      content: `# Payroll input deadlines – Q4 2026

| Month | Input deadline | Payroll run | Payment |
|---|---|---|---|
| October | 20 Oct | 24 Oct | 30 Oct |
| November | 19 Nov | 24 Nov | 28 Nov |
| December | 10 Dec | 15 Dec | 22 Dec |`,
    },

    // ── Additional demo documents ──────────────────────────────────────────
    {
      id: "indexation-pc200-2027",
      title: "Loonindexering PC 200 – januari 2027",
      kind: "doc",
      ownerId: "sofie",
      collaboratorIds: ["lotte"],
      readerIds: ["jonas", "karim", "an"],
      location: "Belgium",
      status: "Completed",
      teamId: "pay-be",
      tags: ["indexation", "salary", "payroll-processing"],
      createdAt: ago(35),
      updatedAt: ago(4),
      lastEditedById: "sofie",
      verifications: [{ personId: "an", at: ago(3) }],
      views: views(["jonas", "karim", "an", "lotte", "jonas"], 10),
      content: `# Loonindexering PC 200 – januari 2027

Voor bedienden in paritair comité 200 worden de lonen op 1 januari 2027 geïndexeerd.

- Indexeringspercentage: 2,0% op 1 januari 2027
- Van toepassing op: brutomaandlonen en de sectorale minimumlonen
- Niet van toepassing op: bedrijfswagen, maaltijdcheques (aparte regeling)

## Uitvoering in mysdworx Pay
1. De indexering wordt automatisch toegepast in de loonrun van januari.
2. Controleer klanten met een afwijkende loonpolitiek (vaste lonen boven barema).
3. Communiceer het nieuwe loon uiterlijk op 10 januari 2027 aan de klant.`,
    },
    {
      id: "yearend-bonus-parttime",
      title: "Eindejaarspremie – berekening voor deeltijdse werknemers",
      kind: "doc",
      ownerId: "karim",
      collaboratorIds: ["sofie"],
      readerIds: ["jonas", "lotte"],
      location: "Belgium",
      status: "To be reviewed",
      teamId: "pay-be",
      tags: ["year-end", "bonus", "payroll-processing"],
      createdAt: ago(18),
      updatedAt: ago(2),
      lastEditedById: "karim",
      verifications: [],
      views: views(["jonas", "lotte", "sofie"], 7),
      content: `# Eindejaarspremie – deeltijdse werknemers

De eindejaarspremie (13de maand) wordt pro rata berekend op basis van de gewerkte dagen.

- Referteperiode: 1 januari tot 31 december 2026
- Deeltijdse werknemer 4/5: premie = 80% van het brutomaandloon van december
- Gelijkgestelde dagen (ziekte tot 30 dagen, klein verlet) tellen mee
- Uitbetaling: met de loonrun van december, uiterlijk 15 december 2026

Opmerking: controle nodig voor werknemers die in de loop van het jaar van regime wisselden.`,
    },
    {
      id: "payroll-calendar-2027-be",
      title: "Payroll calendar 2027 – Belgium",
      kind: "sheet",
      ownerId: "karim",
      collaboratorIds: [],
      readerIds: ["nina", "jonas"],
      location: "Belgium",
      status: "WIP",
      teamId: "pay-be",
      tags: ["deadlines", "payroll-processing"],
      createdAt: ago(6),
      updatedAt: ago(1),
      lastEditedById: "karim",
      verifications: [],
      views: views(["nina"], 1),
      content: `# Payroll calendar 2027 – Belgium

| Month | Input deadline | Payroll run | Payment |
|---|---|---|---|
| January | 20 Jan | 25 Jan | 29 Jan |
| February | 17 Feb | 22 Feb | 26 Feb |
| March | 18 Mar | 23 Mar | 30 Mar |

Remaining months to be added once the bank holidays are confirmed.`,
    },
    {
      id: "vakantiegeld-nl-2026",
      title: "Vakantiegeld Nederland 2026",
      kind: "doc",
      ownerId: "lars",
      collaboratorIds: ["emma"],
      readerIds: ["sanne"],
      location: "Netherlands",
      status: "Completed",
      teamId: "pay-nl",
      tags: ["holiday-pay", "payroll-processing"],
      createdAt: ago(160),
      updatedAt: ago(26),
      lastEditedById: "emma",
      verifications: [{ personId: "lars", at: ago(24) }],
      views: views(["sanne", "emma", "lars"], 25),
      content: `# Vakantiegeld Nederland 2026

- Wettelijk vakantiegeld: 8% van het brutoloon over de opbouwperiode
- Opbouwperiode: 1 juni 2025 tot en met 31 mei 2026
- Uitbetaling: uiterlijk in de loonrun van juni 2026
- Bij uitdienst: opgebouwd vakantiegeld wordt uitbetaald met de eindafrekening

Afwijkingen in de CAO gaan voor. Controleer de klantconfiguratie in mysdworx Pay.`,
    },
    {
      id: "company-car-nl",
      title: "Bijtelling auto van de zaak – Nederland 2026",
      kind: "doc",
      ownerId: "lars",
      collaboratorIds: [],
      readerIds: ["sanne", "emma"],
      location: "Netherlands",
      status: "Completed",
      teamId: "pay-nl",
      tags: ["benefits", "tax", "compensation"],
      createdAt: ago(240),
      updatedAt: ago(70),
      lastEditedById: "lars",
      verifications: [{ personId: "lars", at: ago(70) }],
      views: views(["emma", "sanne"], 30),
      content: `# Bijtelling auto van de zaak – 2026

- Standaard bijtelling: 22% van de cataloguswaarde
- Elektrische auto (2026): 17% tot een cataloguswaarde van € 30.000, daarboven 22%
- Rittenregistratie: geen bijtelling bij minder dan 500 km privé per jaar
- De bijtelling wordt maandelijks verwerkt in de loonadministratie`,
    },
    {
      id: "cloture-paie-fr",
      title: "Procédure de clôture de paie mensuelle – France",
      kind: "doc",
      ownerId: "lea",
      collaboratorIds: ["camille", "hugo"],
      readerIds: ["eva"],
      location: "France",
      status: "Completed",
      teamId: "pay-fr",
      tags: ["procedure", "payroll-processing", "declarations"],
      createdAt: ago(700),
      updatedAt: ago(50),
      lastEditedById: "camille",
      verifications: [{ personId: "lea", at: ago(48) }],
      views: views(["camille", "eva", "lea"], 30),
      content: `# Clôture de paie mensuelle – France

## Calendrier
- J-10 : réception des variables de paie du client
- J-5 : calcul de la paie et contrôles de cohérence
- J-3 : validation par le client
- 5 ou 15 du mois suivant : dépôt de la DSN selon l'effectif

## Contrôles
1. Comparer la masse salariale avec le mois précédent (écart > 5 % à justifier).
2. Vérifier les absences et les indemnités journalières de sécurité sociale.
3. Contrôler les cotisations de la mutuelle obligatoire.`,
    },
    {
      id: "dsn-calendar-fr-2026",
      title: "Calendrier DSN 2026",
      kind: "sheet",
      ownerId: "camille",
      collaboratorIds: [],
      readerIds: ["lea"],
      location: "France",
      status: "Completed",
      teamId: "pay-fr",
      tags: ["declarations", "deadlines"],
      createdAt: ago(280),
      updatedAt: ago(90),
      lastEditedById: "camille",
      verifications: [{ personId: "lea", at: ago(85) }],
      views: views(["lea", "camille"], 30),
      content: `# Calendrier DSN 2026

| Effectif | Date limite de dépôt |
|---|---|
| 50 salariés et plus | 5 du mois suivant |
| Moins de 50 salariés | 15 du mois suivant |

La DSN de décembre 2026 doit être déposée au plus tard le 5 janvier 2027 (entreprises de 50 salariés et plus).`,
    },
    {
      id: "teletravail-fr",
      title: "Indemnité de télétravail – France",
      kind: "doc",
      ownerId: "hugo",
      collaboratorIds: [],
      readerIds: ["camille", "lea"],
      location: "France",
      status: "Completed",
      teamId: "pay-fr",
      tags: ["allowance", "policy", "compensation"],
      createdAt: ago(900),
      updatedAt: ago(560),
      lastEditedById: "hugo",
      verifications: [{ personId: "hugo", at: ago(560) }],
      views: views(["camille"], 60),
      content: `# Indemnité de télétravail – France

- Montant : 2,70 € par jour de télétravail, exonéré dans la limite de 59,40 € par mois
- Versement mensuel avec le salaire
- Les jours de télétravail sont déclarés par le salarié dans mysdworx Time`,
    },
    {
      id: "lohnabrechnung-checkliste-de",
      title: "Checkliste monatliche Lohnabrechnung – Deutschland",
      kind: "doc",
      ownerId: "felix",
      collaboratorIds: ["lena"],
      readerIds: ["eva"],
      location: "Germany",
      status: "Completed",
      teamId: "pay-de",
      tags: ["procedure", "payroll-processing", "checklist"],
      createdAt: ago(300),
      updatedAt: ago(15),
      lastEditedById: "lena",
      verifications: [{ personId: "felix", at: ago(14) }],
      views: views(["lena", "felix", "eva", "lena"], 20),
      content: `# Checkliste monatliche Lohnabrechnung – Deutschland

1. Bewegungsdaten (Eintritte, Austritte, Fehlzeiten) bis zum 15. des Monats erfassen.
2. Sozialversicherungsbeiträge berechnen und Beitragsnachweis spätestens am drittletzten Bankarbeitstag übermitteln.
3. Lohnsteuer-Anmeldung bis zum 10. des Folgemonats an das Finanzamt senden.
4. Minijobber: Verdienstgrenze prüfen (556 € pro Monat in 2026).
5. Entgeltabrechnungen an die Mitarbeiter bereitstellen.`,
    },
    {
      id: "entgeltfortzahlung-de",
      title: "Entgeltfortzahlung im Krankheitsfall – Deutschland",
      kind: "doc",
      ownerId: "lena",
      collaboratorIds: [],
      readerIds: ["felix"],
      location: "Germany",
      status: "To be reviewed",
      teamId: "pay-de",
      tags: ["absence", "leave", "policy"],
      createdAt: ago(40),
      updatedAt: ago(40),
      lastEditedById: "lena",
      verifications: [],
      views: views(["felix"], 10),
      content: `# Entgeltfortzahlung im Krankheitsfall

- Der Arbeitgeber zahlt bis zu 6 Wochen 100 % des Entgelts.
- Danach zahlt die Krankenkasse Krankengeld (70 % des Bruttoentgelts, max. 90 % des Nettoentgelts).
- Arbeitsunfähigkeitsbescheinigung: elektronisch (eAU) ab dem 4. Kalendertag abrufen.`,
    },
    {
      id: "onboarding-consultant-be",
      title: "Onboarding nieuwe payroll consultant",
      kind: "doc",
      ownerId: "an",
      collaboratorIds: ["sofie", "lotte"],
      readerIds: ["jonas", "karim"],
      location: "Belgium",
      status: "WIP",
      teamId: "pay-be",
      tags: ["onboarding", "knowledge-sharing", "handover"],
      createdAt: ago(100),
      updatedAt: ago(9),
      lastEditedById: "sofie",
      verifications: [],
      views: views(["jonas", "karim", "jonas", "karim"], 15),
      content: `# Onboarding nieuwe payroll consultant

## Week 1
- Toegang tot mysdworx Pay en Time aanvragen via HR Operations
- Meelopen met een senior consultant tijdens 2 loonruns
- Lezen: DmfA-checklist, eindejaarsprocedure, overuren-beleid

## Week 2–4
- Eerste eigen klantportefeuille (max. 5 klanten) onder begeleiding
- Wekelijkse check-in met de teamlead

TODO: sectie over Belcotax en fiscale fiches toevoegen.`,
    },
    {
      id: "absence-codes",
      title: "Absence codes reference",
      kind: "sheet",
      ownerId: "wout",
      collaboratorIds: ["bram", "an"],
      readerIds: ["jonas", "lotte", "sofie", "karim", "nina"],
      location: "Belgium",
      status: "Completed",
      teamId: "time",
      tags: ["absence", "clocking", "time"],
      createdAt: ago(500),
      updatedAt: ago(33),
      lastEditedById: "bram",
      verifications: [{ personId: "wout", at: ago(30) }],
      views: views(["jonas", "lotte", "sofie", "karim", "nina", "jonas"], 25),
      content: `# Absence codes reference (mysdworx Time)

| Code | Meaning | Paid by |
|---|---|---|
| S1 | Sick leave | Employer (guaranteed salary) |
| S2 | Relapse within 14 days | Employer |
| V1 | Annual leave | Employer |
| KV | Short leave (klein verlet) | Employer |
| TW | Temporary unemployment | National Employment Office |`,
    },
    {
      id: "terminal-models",
      title: "Clocking terminal models & firmware",
      kind: "sheet",
      ownerId: "bram",
      collaboratorIds: ["wout"],
      readerIds: ["nina"],
      location: "Global",
      status: "Completed",
      teamId: "time",
      tags: ["clocking", "time", "support"],
      createdAt: ago(150),
      updatedAt: ago(20),
      lastEditedById: "bram",
      verifications: [{ personId: "wout", at: ago(18) }],
      views: views(["nina", "wout"], 20),
      content: `# Clocking terminal models & firmware

| Model | Supported firmware | End of support |
|---|---|---|
| TT-400 | 4.2.1 | December 2027 |
| TT-300 | 3.9.8 | June 2026 (ended) |
| Bio-500 | 5.0.3 | Not announced |

TT-300 terminals must be replaced; customers were informed in March 2026.`,
    },
    {
      id: "clocking-setup-2019",
      title: "Clocking terminal installation guide",
      kind: "pdf",
      ownerId: "ruben",
      collaboratorIds: ["daan"],
      readerIds: ["nina"],
      location: "Global",
      status: "Completed",
      teamId: "cs",
      tags: ["clocking", "time", "procedure"],
      createdAt: ago(2400),
      updatedAt: ago(1500),
      lastEditedById: "ruben",
      verifications: [{ personId: "ruben", at: ago(1500) }],
      views: views(["nina"], 90),
      supersededById: "terminal-models",
      content: `# Clocking terminal installation guide (2019)

1. Mount the TT-300 terminal at 1.2 m height near the entrance.
2. Connect it to the network with a fixed IP address.
3. Install firmware 3.2 from the USB stick delivered with the terminal.
4. Register the terminal in the old Time portal (Legacy Time 5).`,
    },
    {
      id: "escalation-playbook",
      title: "Client escalation playbook",
      kind: "doc",
      ownerId: "nina",
      collaboratorIds: ["ruben"],
      readerIds: ["an", "lotte", "sanne", "camille"],
      location: "Global",
      status: "Completed",
      teamId: "cs",
      tags: ["client", "support", "procedure"],
      createdAt: ago(420),
      updatedAt: ago(55),
      lastEditedById: "nina",
      verifications: [{ personId: "nina", at: ago(55) }],
      views: views(["an", "lotte", "sanne", "camille", "an"], 30),
      content: `# Client escalation playbook

## Severity levels
- P1 – payroll cannot be paid on time: respond within 1 hour, team lead involved immediately
- P2 – incorrect payslips for more than 10 employees: respond within 4 hours
- P3 – individual question or cosmetic issue: respond within 2 working days

## Steps
1. Log the escalation in the CRM with the client ID and severity.
2. Inform the account's payroll consultant and their team lead.
3. Send the client an update at least every 4 hours for P1 cases.`,
    },
    {
      id: "sar-procedure",
      title: "GDPR subject access request procedure",
      kind: "doc",
      ownerId: "tom",
      collaboratorIds: ["inge"],
      readerIds: ["eva", "an", "nina"],
      location: "Global",
      status: "Completed",
      teamId: "legal",
      tags: ["gdpr", "master-data", "procedure"],
      createdAt: ago(380),
      updatedAt: ago(28),
      lastEditedById: "inge",
      verifications: [{ personId: "tom", at: ago(27) }],
      views: views(["eva", "an", "nina"], 30),
      content: `# Subject access requests (GDPR art. 15)

- Respond within 1 month of receiving the request (extendable by 2 months for complex requests).
- Verify the identity of the requester before sharing any data.
- Export employee master data from mysdworx HR via Reports > Personal data export.
- Log every request in the privacy register, including the response date.`,
    },
    {
      id: "expense-faq",
      title: "Expense claims – FAQ",
      kind: "doc",
      ownerId: "inge",
      collaboratorIds: [],
      readerIds: ["jonas", "karim", "emma", "lena"],
      location: "Global",
      status: "Completed",
      teamId: "hr-ops",
      tags: ["expenses", "travel", "faq"],
      createdAt: ago(200),
      updatedAt: ago(45),
      lastEditedById: "inge",
      verifications: [],
      views: views(["jonas", "karim", "emma", "lena", "jonas"], 30),
      content: `# Expense claims – FAQ

**Q: How do I submit an expense?**
A: Via mysdworx Travel & Expense, with a photo of the receipt, within 30 days.

**Q: What is the mileage allowance in Belgium?**
A: €0.4326 per km in 2026.

**Q: What is the hotel limit?**
A: €150 per night in Europe, €220 in capital cities.`,
    },
    {
      id: "team-contacts-be",
      title: "Payroll Belgium – team contacts & backups",
      kind: "sheet",
      ownerId: "an",
      collaboratorIds: [],
      readerIds: ["jonas", "karim", "sofie", "lotte", "nina"],
      location: "Belgium",
      status: "Completed",
      teamId: "pay-be",
      tags: ["knowledge-sharing", "client"],
      createdAt: ago(600),
      updatedAt: ago(130),
      lastEditedById: "an",
      verifications: [{ personId: "an", at: ago(130) }],
      views: views(["jonas", "karim", "nina", "jonas"], 20),
      content: `# Payroll Belgium – team contacts & backups

| Consultant | Portfolio | Backup |
|---|---|---|
| Lotte Peeters | Retail & logistics (22 clients) | Sofie Willems |
| Sofie Willems | Healthcare (18 clients) | Lotte Peeters |
| Pieter Wouters | Construction (15 clients) | Jonas Maes |
| Jonas Maes | SMEs (9 clients) | Karim El Amrani |

Team lead: An Claes – escalations and holiday cover.`,
    },
    {
      id: "minijob-de-2026",
      title: "Minijobs 2026 – Überblick",
      kind: "doc",
      ownerId: "lena",
      collaboratorIds: ["felix"],
      readerIds: [],
      location: "Germany",
      status: "Completed",
      teamId: "pay-de",
      tags: ["salary", "declarations", "policy"],
      createdAt: ago(250),
      updatedAt: ago(250),
      lastEditedById: "lena",
      verifications: [],
      views: views(["felix"], 60),
      content: `# Minijobs 2026 – Überblick

- Verdienstgrenze: 538 € pro Monat
- Pauschalabgaben des Arbeitgebers: ca. 30 % (Renten-, Krankenversicherung, Pauschalsteuer)
- Anmeldung bei der Minijob-Zentrale vor Beschäftigungsbeginn`,
    },
    {
      id: "mutuelle-faq-fr",
      title: "Mutuelle d'entreprise – FAQ salariés",
      kind: "doc",
      ownerId: "lea",
      collaboratorIds: [],
      readerIds: ["camille", "eva"],
      location: "France",
      status: "Completed",
      teamId: "pay-fr",
      tags: ["benefits", "faq"],
      createdAt: ago(120),
      updatedAt: ago(60),
      lastEditedById: "lea",
      verifications: [{ personId: "lea", at: ago(60) }],
      views: views(["camille", "eva"], 30),
      content: `# Mutuelle d'entreprise – questions fréquentes

**Qui doit adhérer ?** Tous les salariés, sauf cas de dispense documentée.

**Qui paie ?** L'employeur prend en charge au moins 50 % de la cotisation.

**Comment est-elle déclarée ?** Les cotisations figurent chaque mois dans la DSN.`,
    },
  ];

  return { teams, people, docs, overrides: [] };
}

/**
 * Plausible edit history for a seeded document, so "who wrote what" has something to work with:
 * the first author writes the first ~60%, collaborators extend it, and the last editor finishes it.
 */
export function seedHistory(doc: Doc): { personId: string | null; at: string; content: string }[] {
  const lines = doc.content.split("\n");
  const first = doc.ownerId ?? doc.collaboratorIds[0] ?? doc.lastEditedById;
  const last = doc.lastEditedById ?? first;
  const middle = doc.collaboratorIds.filter((c) => c !== first && c !== last).slice(0, 2);
  const steps = [
    { personId: first, share: 0.6 },
    ...middle.map((personId, i) => ({ personId, share: 0.6 + (0.3 * (i + 1)) / (middle.length + 1) })),
    { personId: last, share: 1 },
  ];
  const start = new Date(doc.createdAt).getTime();
  const end = new Date(doc.updatedAt).getTime();
  return steps.map((step, i) => ({
    personId: step.personId,
    at: new Date(start + ((end - start) * i) / Math.max(steps.length - 1, 1)).toISOString(),
    content: lines.slice(0, Math.ceil(lines.length * step.share)).join("\n"),
  }));
}
