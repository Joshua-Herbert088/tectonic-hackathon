# TrustDrive

A Google Drive–style document store where every document carries a **trust score (0–100)** telling you how accurate and up to date it is *for you*, and why.

Built for the SD Worx challenge at the Tectonic hackathon: *"How might we turn fragmented organisational knowledge into a trusted shared resource?"* (Find · Trust · Share). The slides from the brief are the `signal-*.jpg` files in this folder.

The scoring and checking is done by **[Jev](https://jevtypesafeai.com)**, TypeSafe AI's decision model. Jev returns typed answers (scores, yes/no probabilities) instead of text, in 70–500 ms.

---

## What it does

### Trust score on every document
- Every file in the drive list shows a 0–100 score ring: **Trusted** (≥ 75), **Use with care** (50–74) or **Unreliable** (< 50).
- The score depends on who is reading, so it's calculated per document *and* per viewer. A French policy scores high for a colleague in France and low for someone in Belgium.
- Jev gets one *Score* question over a 6-level rubric (from "should not be relied on" to "authoritative and current"). Its inputs are:
  - the document content, status, location and team
  - the owner, collaborators and readers, and whether each is still at the company or has moved team
  - when it was last edited and last verified, and by whom
  - how much it's been used recently
  - whether a newer document replaced it
  - up to 4 related documents
  - conflicts that were overridden (see below)
  - the reader's role, team and location
- Results are stored with a fingerprint of the inputs, so a score is only recalculated when something Jev sees has changed. Every result is kept, and the document page shows the score history.

### Why: what's good and what to watch out for
The document page lists plain facts such as "Edited by owner Lotte Peeters 2 hours ago", "Owner Pieter Wouters left the company 2 years ago" or "Applies to Netherlands, but you are in Belgium". These come from simple rules in code (`buildSignals` in `src/lib/trust.ts`), not from Jev, so they're always accurate.

### Verify button
**"I confirm this document is correct"** records a verification by the current user. That changes Jev's input, so the document is rescored straight away.

### Conflicts block the save
Every upload and every text edit is checked against **all** existing documents (`src/lib/conflicts.ts`):
1. It picks out lines containing numbers, amounts or dates. Table rows become "Header: value; …".
2. It pairs each new line with lines elsewhere on the same subject whose values differ. Same location and team come first, but every document is included.
   - Pairing works across languages. A small payroll/HR word list in English, Dutch, French and German (`src/lib/lexicon.ts`) matches "salary" to *loon*, *salaire* and *Gehalt*, and finds words inside compounds like *maandloon*.
   - If no shared words are found, a line can still be paired through a shared name, the same kind of value and a compatible year.
3. Jev gets one yes/no question per pair: do these two statements contradict each other?
   - **≥ 0.75** is a hard conflict and blocks the save.
   - **0.40–0.75** is shown as a possible conflict but doesn't block.

When a save is blocked, a dialog shows your line next to the conflicting line. You can:
- **fix your own line**,
- **fix the existing document** in place, or
- **override with a reason**. The override is stored permanently on both documents (`conflict_overrides` table) and fed into the trust score.

### Duplicate warnings
- **When adding a file:** if an upload (or a blank document being filled for the first time) basically repeats an existing document, you get a warning: "This file is very similar… consider editing the existing one". You can continue anyway.
- **When reading:** if you open a document with basically the same information as one you opened in the last hour, a blue info banner says so.
- Both use a quick feature comparison to pick up to 3 candidates, then a Jev *Score* for how much information the documents share, ignoring wording and language. The cutoff is 2.75 on a 0–4 scale (`src/lib/similarity.ts`).

### Who to contact
Each document ranks up to 5 active colleagues, with the reasons shown (`src/lib/contacts.ts`):
- **Contribution:** ownership, share of the current text they wrote, edits, verifications, opening it often.
- **Conflict decisions:** overrides made on this document or against it.
- **Topic knowledge:** their work on related documents, weighted by how related they are.
- **Team:** the document's team and your team.

People who moved team rank lower and get a note. People who left the company are only listed as former contributors.

### Notifications
The bell in the top bar notifies people when their information changes (`src/lib/notify.ts`):
- **Line authors** hear when lines they wrote are changed or removed, with before/after.
- **The document owner** hears about every change someone else makes to their document, including title changes.
- **Overrides:** when someone saves a document despite contradicting yours, the author of the contradicted line and the owner of that document are both notified, with the reason.
- If a line's author left the company, the owner gets it instead.

"Who wrote which line" comes from the document's edit history (a line-level blame in `src/lib/diff.ts`).

### Handover radar
A drive view that lists documents that need a new owner: no owner, the owner left, or the owner moved team. They're sorted by exposure, meaning how many people rely on the document and how untrustworthy it is. Each one comes with suggested successors, and you can reassign ownership in one click (`src/lib/handover.ts`, `src/components/HandoverRadar.tsx`).

### Doubts in the text
Lines that look doubtful are underlined in the document itself: lines that only mention past years, lines involved in an overridden conflict, and lines that Jev finds contradicting other documents (checked in the background when the page opens). See `src/lib/doubts.ts`.

---

## How to run it

**Requirements:** Node.js 20+ (developed on Node 26) and a Jev API key (get one at https://jevtypesafeai.com/pricing).

```bash
cd trustdrive
npm install

# Jev credentials (the file is git-ignored)
cat > .env.local <<'EOF'
JEV_API_KEY=jv_live_...
JEV_API_URL=https://jevtypesafeai.com/api/v1/decide
EOF

npm run dev
# open http://localhost:3000
```

On first start, the SQLite database `trustdrive/data/trustdrive.db` is created, the migrations in `trustdrive/drizzle/` run, and a demo company is loaded. That's 8 teams, 24 people (some of whom left or moved team) and 40 documents in English, Dutch, French and German.

| Command | What it does |
|---|---|
| `npm run dev` | Development server on :3000 |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint |
| `npm run db:generate` | Create a migration after changing `src/db/schema.ts` (it's applied automatically on the next start) |
| `npm run db:studio` | Browse the database in the browser |

- **Reset demo data** (bottom of the drive sidebar) wipes the database and reloads the demo company.
- Demo documents added to `src/lib/seed.ts` later are inserted into existing databases automatically on startup.
- Scoring costs roughly **$0.0004 per document per viewer**, a conflict or duplicate check about **$0.001**. The first time a user opens the drive, all visible documents are scored, which takes a few seconds.

### Suggested demo
1. **Viewing as** (top right) switches user. Start as Jonas Maes, a Belgian payroll consultant. Sort the drive by trust score and open *Year-end payroll closing procedure – Belgium* (0) and its *2026* version (~99).
2. Open *Overtime policy – Belgium*. Switch to Marc (the owner), click **I confirm this document is correct**, and watch it rescore.
3. **New → File upload** `trustdrive/samples/salary-review-jonas-maes.md`. It's blocked because it conflicts with the salary register. Override it with a reason, then switch to An Claes and open the bell.
4. Upload `samples/multilingual/planning-paie-decembre-fr.md` (French, conflicts with an English deadline sheet) and `samples/multilingual/maladie-salaire-garanti-fr.md` (a French translation of an existing document, so you get the duplicate warning).
5. Open *Clocking terminal troubleshooting guide*, then *Clocking terminals – quick fixes (CS copy)*. You'll see the "you just saw this" banner.
6. Open **Handover radar** in the sidebar and reassign a document whose owner left.

### Where things are

```
trustdrive/
  src/app/                 pages (drive list, document page) and API routes under api/
  src/components/          UI: trust badge, conflict/duplicate dialogs, upload, who-to-contact, bell, radar
  src/db/schema.ts         Drizzle schema (SQLite)
  src/lib/trust.ts         Jev client, trust-score inputs, good/bad signals, related documents
  src/lib/conflicts.ts     conflict detection (fact lines → candidate pairs → Jev yes/no)
  src/lib/lexicon.ts       multilingual payroll/HR word list used for pairing
  src/lib/similarity.ts    duplicate / "same information" detection
  src/lib/contacts.ts      who-to-contact ranking
  src/lib/notify.ts        notifications on edits and overrides
  src/lib/diff.ts          line diff + blame over the edit history
  src/lib/handover.ts      handover radar
  src/lib/doubts.ts        per-line doubts
  src/lib/db.ts            database access, seeding, migrations
  src/lib/seed.ts          the demo company
  drizzle/                 SQL migrations
  samples/                 files to upload in the demo
```

---

## Unfinished / known limitations

**Not a real product yet**
- **No login or permissions.** "Viewing as" is a user switcher, anyone can edit any document, and only the status/location/team dropdowns are limited to the owner and collaborators.
- **No real Google Drive integration.** Documents live in the local SQLite database.
- **Uploads are text only** (`.md` / `.txt`). No PDF, Word or spreadsheet parsing; "sheet" and "pdf" are only icons.
- **Missing drive features:** folders, delete, rename and sharing management.
- **Local only.** The database is a local SQLite file, so it can't be deployed to serverless hosts like Vercel. Moving to Postgres would be the next step; the Drizzle schema carries over.
- **No automated tests.** Everything was tested by hand against the API. The two `react-hooks/set-state-in-effect` lint errors in `page.tsx` and `AppContext.tsx` are known and harmless.

**Trust score**
- **Opening a document isn't recorded as a view.** Views are one of Jev's inputs, so recording them would force a rescore on every open. Usage numbers come from the demo data only.
- **Scores are calculated on demand** the first time a viewer sees a document. There's no background pre-scoring. If Jev is down, the score shows an error.
- **The rubric and cutoffs** (75/50 bands, 6 levels) were tuned by eye on the demo data, not validated.

**Conflict detection**
- **Only lines with numbers, amounts or dates are checked.** Wording contradictions such as "submit on paper" vs "submit in the app" aren't caught.
- **The multilingual word list only covers payroll/HR vocabulary.** Other subjects rely on the fallback (a shared name plus the same kind of value).
- **At most 60 line pairs per check.** A very large upload could miss some pairs.
- **Edits only check new or changed lines.** Contradictions already sitting between existing documents only surface in the "doubts" panel when a document is opened; there's no organisation-wide scan.
- **Saving is blocked if Jev is unreachable** during a text edit. It returns a 502; there's no offline override.

**Duplicates, contacts, notifications**
- **The duplicate check compares only the top 3 candidates.** The "you just saw this" history is kept in the browser, per user and per device.
- **The who-to-contact weights are hand-picked**, and there's no contact action (email or Teams link).
- **Notifications are in-app only** (the bell checks every 10 s). No email or push, and no notification when ownership is transferred.
- **The edit history of the demo documents is made up** (owner writes about 60%, then collaborators, then the last editor), so "who wrote which line" works from the start.

**Caching**
- The conflict and similarity caches are in memory and reset when the server restarts. Stored trust scores are kept.
