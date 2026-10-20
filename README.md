# TrustDrive

A Google Drive–style document store where every document carries a **trust score (0–100)** telling you how accurate and up to date it is *for you*, and why.

Built for the SD Worx challenge at the Tectonic hackathon: *"How might we turn fragmented organisational knowledge into a trusted shared resource?"* (Find · Trust · Share).

The scoring and checking is done by **[Jev](https://jevtypesafeai.com)**, TypeSafe AI's decision model. Jev returns typed answers (scores, yes/no probabilities) instead of text, in 70–500 ms.

---

## What it does

### For you
The home page lists what needs the person viewing it: documents they own or work on that score below 75 for them or weren't verified in 180 days, client conversations where the client asked something and is still waiting, documents without an owner where they're a suggested successor, and their team's least trusted documents. The same navigation is on every page, and when Jev can't be reached a single banner explains that scores and checks are rule-based estimates.

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

### Legal & Compliance badge
Documents that come from Legal & Compliance (the team that maintains them), or that someone from Legal confirmed, carry a badge saying **who in Legal validated it and when** (`src/lib/legal.ts`, `src/components/LegalBadge.tsx`):
- On the document page it's a stamp under the title: *Legal & Compliance · Validated by Tom Hermans on 23 Sept 2026 (27 days ago)*. In the drive and on **For you** it's a short pill: *Legal · Tom, 23 Sept 2026*.
- The validation is the latest "I confirm this document is correct" by someone in Legal (or who was in Legal before moving team). It turns amber, *due for another check*, when it's over a year old, and says so when the validator has since left the company or moved team.
- A Legal document that nobody in Legal validated yet says *Not validated by Legal yet*.

### Quiet documents: "nobody has looked at this in two years"
A document can be wrong without anything contradicting it. When nobody has **opened, edited or verified** a document in over a year, whoever opens it gets a notice at the top: *Nobody has looked at this document in over a year. It was last edited by Hugo Bernard on 8 April 2025. That doesn't mean it's wrong, and its trust score is unchanged – but check that it still applies before you rely on it* (`src/lib/quiet.ts`).
- Nothing is decided for the reader: the score doesn't change and the AI isn't asked, because a quiet document isn't necessarily a bad one. The notice offers **It's still correct** (a verification, which clears it for everyone) and **Ask the owner** when the owner is still at the company.
- Every open is recorded per document (`document_opens`, kept apart from the views Jev reads, so opening a document never rescores it). Reopening it in the same visit keeps the notice; the next person opening it sees that it was looked at recently.
- In the demo, *Indemnité de télétravail – France*, *Noordkaai Logistics – onboarding checklist (2022)* and *Clocking terminal installation guide* have been quiet for over a year; the GDPR documents in *Legal & compliance* show a current and an outdated Legal validation.

### Conflicts block the save
Every upload and every text edit is checked against **all** existing documents (`src/lib/conflicts.ts`):
1. It picks out lines containing numbers, amounts or dates. Table rows become "Header: value; …".
2. It pairs each new line with lines elsewhere on the same subject whose values differ. Same location and team come first, but every document is included.
   - Pairing works across languages. A small payroll/HR word list in English, Dutch, French and German (`src/lib/lexicon.ts`) matches "salary" to *loon*, *salaire* and *Gehalt*, and finds words inside compounds like *maandloon*.
   - If no shared words are found, a line can still be paired through a shared name, the same kind of value and a compatible year.
3. Jev gets one yes/no question per pair: do these two statements contradict each other?
   - **≥ 0.75** is a hard conflict and blocks the save.
   - **0.40–0.75** is shown as a possible conflict but doesn't block.
4. **Without Jev**, fixed rules decide instead (`ruleProbability` in `src/lib/conflicts.ts`). A pair is a hard conflict only when both lines are clearly about the same thing (the same person or client, or nearly all subject words shared) in the same country, year and month, and the values that answer it differ. In a table row, the matching column is compared, so "12 décembre" is checked against *Input deadline: 10 Dec* rather than *Payroll run: 15 Dec*. Drafts, changes "from" a date, a country rule next to a global one, and lines tied to a topic the other side doesn't mention are at most *possible*. The dialog says when the rules decided.

When a save is blocked, a dialog shows your line next to the conflicting line. You can:
- **fix your own line**,
- **fix the existing document** in place, or
- **override with a reason**. The override is stored permanently on both documents (`conflict_overrides` table) and fed into the trust score.

### Confidential documents
Uploading has a **Contains confidential information** switch, which can also be changed later in a document's Details tab. A confidential document is marked with a red *Confidential* badge wherever it's listed, and its content is **never sent to Jev**:
- its trust score is the rule-based estimate (labelled as such),
- conflict and duplicate checks decide every pair that involves it with the rules, in both directions: when it's saved, and when another document is compared with it,
- tag suggestions for it come from the keyword rules,
- other documents' trust inputs leave out its excerpt and its lines in conflict overrides.

`src/lib/confidential.test.ts` checks this against a stand-in for Jev.

### Duplicate warnings
- **When adding a file:** if an upload (or a blank document being filled for the first time) basically repeats an existing document, you get a warning: "This file is very similar… consider editing the existing one". You can continue anyway.
- **When reading:** if you open a document with basically the same information as one you opened in the last hour, a blue info banner says so.
- Both use a quick feature comparison to pick up to 3 candidates, then a Jev *Score* for how much information the documents share, ignoring wording and language. The cutoff is 2.75 on a 0–4 scale (`src/lib/similarity.ts`).
- Without Jev, `ruleOverlap` estimates that score from the numbers, concepts and names the texts share, which works across languages (a translation shares them), or from all features for near-copies.

### Who to contact
Each document ranks up to 5 active colleagues, with the reasons shown (`src/lib/contacts.ts`):
- **Contribution:** ownership, share of the current text they wrote, edits, verifications, opening it often.
- **Conflict decisions:** overrides made on this document or against it.
- **Topic knowledge:** their work on related documents, weighted by how related they are.
- **Team:** the document's team and your team.

People who moved team rank lower and get a note. People who left the company are only listed as former contributors.

### Ask: answers, documents and who knows, in one place
Sometimes the answer isn't a document but a person: who has dealt with this before, who really knows this client, who knows why we do it this way. **Ask** (sidebar) takes one question and answers it from what's already there, cheapest first. Only if that isn't enough does it ask anyone. Nobody fills in a profile (`src/app/ask/`, `src/lib/expertise.ts`, `src/lib/board.ts`):
1. **Asked before:** answers colleagues gave on the board, or in chats they chose to share (below).
2. **In the drive:** the documents it's about, with your trust score.
3. **Who knows:** the colleagues to ask directly, ranked by evidence, with email, Teams and profile links. Looking things up is private: nobody sees what you searched.
4. **Already asked on the board:** open questions on the same topic, to follow instead of asking again.
5. **Still stuck? Ask everyone:** post it to the board (below).

Results update as you type, and the page shows how the question was read. Topics are matched by their names and keywords in four languages, plus clients and countries, e.g. *overtime in Belgium*, *Noordkaai* or *wie kent de overuren?*. If nothing is recognised, it searches the text instead. With nothing typed, the page shows the board, questions *asked to you* first. Searching the drive shows the top answer and three people above the results too, and old `/people` and `/board` links lead here.
- **Evidence is only what someone produced:**
  - owning a document, and the share of its current text they wrote (from the line-level blame)
  - edits and verifications
  - exceptions they kept on purpose, with their reason
  - answers to colleagues' questions (below)
  - messages in client conversations

  Reading a document or asking a question never counts. Every person comes with that evidence, linked to the document or message.
- **It stays current by itself:** evidence counts fully for three months, then half as much for every year after that. Ownership doesn't fade while someone is at the company. People who moved team get a note (and rank lower if they haven't worked on it since), and people who left are listed separately with a link to their handover briefing.
- **Profile** (`/person/<id>`, or **Profile** next to any contact), all from their work:
  - the topics and clients someone knows, strongest first, each with its evidence and *fading* when nothing happened in a year
  - *Works mostly in*: the folders their work is in
  - the questions they answered, and the documents they're in charge of
  - the exceptions they explained (*Knows why*)
  - who they work with most, through the same documents and conversations

  *Often opens* shows the folders someone reads a lot in the last three months. It's per folder, labelled as reading, and never counted as expertise.
- **"Not me any more":** on your own profile you can take a topic or client off; you're then no longer suggested for it, and only you still see it. That's the only human step.

### Posting to everyone: the board
Most questions are asked in private chats, so the answer only helps one person. Posting from **Ask** puts the question on a board everyone can see, built so that asking there gets a quick answer you can trust (`src/lib/board.ts`, `src/app/board/[id]/`):
- **Asked for you:** a posted question goes to the three colleagues ranked highest under *Who knows*, with a notification saying why them ("Answered a colleague in chat: …"). It isn't sent to everyone. If nobody has answered after two days, the next two are asked.
- **Trustworthy answers:** answers are public, go through the conflict check like every answer (below), and the asker marks the one that **solved it**. A solved answer is labelled as such everywhere and counts more for whoever gave it.
- **The board** (on **Ask**, with nothing typed): *Asked to you*, *Not answered yet*, *All questions*, *Yours*, and *Shared from chats*. That last tab has answers from private chats that the people who gave them chose to share.

### Answers from email, Teams and the board, kept for the next person
When a colleague asks something and someone answers, the exchange is kept, so the next person with the same question finds the answer and who gave it (`src/lib/answers.ts`, run in the background after every message):
- **What's kept:**
  - in chats among colleagues, a message ending in a question mark and the next reply by another colleague that actually says something (not "let me check", not a question back)
  - on the board, every answer

  Answers are quoted as written. Client conversations aren't used: they have their own handover documents.
- **Private chats need the answerer's yes:** nothing from a chat is shared until the person who answered says so. They're asked quietly afterwards, never with a pop-up in the chat: a bell notification and *An answer you gave could help others* on **For you**, with **Share** and **Keep private** (which deletes it). On their profile they choose **Ask me first** (the default), **Always share** or **Never keep**. **Always share my answers** on the card does the same, so people can move to "always" once they trust it. Board answers are public from the start.
- **The asker and the chat stay private:** for anyone not on the chat, a shared answer says "answered a colleague", hides the chat's title (which names its people) and links to the answer's own page instead of the conversation. Only the people on the chat can open it. FAQ documents also link to that page.
- **Where answers show up:**
  - *Asked before* on **Ask** and above drive search results
  - *Asked before* next to **Who to contact** on a document about the same sub-topic
  - *Answered recently* on the profile of whoever answered
  - a label under the message in **Conversations** ("Shared as the answer…" or "Not shared")

  Each answer is marked *Not verified* unless the asker said it solved their question.
- **It counts for whoever answered, not whoever asked.** "Answered a colleague in chat: How many hours of voluntary overtime…?" is evidence on Lotte's profile and in **Ask**, so expertise that only lives in chats becomes findable.
- **Checked against the drive:** each answer gets topics and a country (Jev, or the keyword rules) and goes through the conflict check. Once it's shared and contradicts a document:
  - the document's line is underlined ("Lotte answered a colleague differently in chat")
  - the answer shows the contradiction
  - the document's owner gets a notification with both lines

  Once either is fixed, the warning goes away.
- **From answers to a document:** someone who answered three questions on the same topic in a year gets *You keep answering the same questions* on **For you** and their profile. **Draft an FAQ** builds it from their own answers, each quoted and linked, and saves it through the usual tag, conflict and duplicate checks. Answers a document contradicts start unticked. **Not now** hides the suggestion until new questions come in.
- **Never kept:**
  - exchanges with health information, bank or national numbers, or a colleague's full name
  - conversations someone on them switched to **Don't keep for others**

In the demo:
- Jonas, Sofie and Karim asked Lotte about Belgian overtime in chats. Lotte always shares, so her answers are found straight away. One of them ("max 120 hours per calendar year now") contradicts the outdated overtime policy, whose owner Marc moved team. Lotte now comes first when you ask about *overtime in Belgium*, Marc is told his policy may be out of date, and Lotte is offered an overtime FAQ.
- Lars answered Emma about vakantiegeld, and he's asked first: switch to Lars to see the card.
- On the board, Sofie's absence-code question was solved by Wout, and Emma's vakantiegeld question has an answer. Jonas's year-end bonus question has gone unanswered for three days, so opening **Ask** asks the next colleagues.
- Two chats are never kept: one is private, the other is about a named colleague's salary.

### Mentoring (buddy system)
A newcomer gets a mentor, who can quietly keep an eye on where they're getting stuck and step in: *Jonas keeps asking about GDPR and his searches find nothing, so let's sit down about how Legal works.* Nobody is notified; the mentor checks in when they choose (`src/lib/mentoring.ts`, `src/app/mentoring/`).
- **Assigning a mentor:** on anyone's profile (**Mentor → Assign a mentor / Change / Remove**), or on **Mentoring** (sidebar) with **Mentor someone**. Someone can't mentor themselves, mentor someone who mentors them, or be mentored by someone who left.
- **What the mentor sees**, for each mentee, from the day the mentorship started (and only while it lasts):
  - **What they asked:** questions in **Ask**, and questions they wrote to colleagues by email or Teams (client conversations aren't included).
  - **What they searched for** in the drive, with how many documents matched; searches that found nothing stand out.
  - **What they looked at:** the documents they opened, how often, and the mentee's own trust score for each, so the mentor can tell when they were reading something they can't rely on.
- **Where to step in:** all of it grouped by the department it's about: the team that maintains the documents, or the team whose topics or clients a question names (or whose words it uses; a question to someone in another department counts for that department). A department is highlighted as *may be struggling* when it keeps coming back: several questions or searches that found nothing, documents opened three times or more, or documents that score below 50 for them. It then suggests trusted documents in that area they haven't opened yet, and an **Ask** link for its main topic to find someone to bring in.
- **Transparent to the mentee:** the mentee sees who their mentor is and exactly what that mentor can see, on **Mentoring** and on their profile. Activity is only recorded for people who have a mentor, and only their mentor can open it (anyone else gets a 403). It's kept apart from the views Jev reads, so it never changes a trust score.
- In the demo, Lotte Peeters mentors Jonas Maes: switch **Viewing as** to Lotte and open **Mentoring**.

### Notifications
The bell in the top bar notifies people when their information changes (`src/lib/notify.ts`):
- **Line authors** hear when lines they wrote are changed or removed, with before/after.
- **The document owner** hears about every change someone else makes to their document, including title changes.
- **Overrides:** when someone saves a document despite contradicting yours, the author of the contradicted line and the owner of that document are both notified, with the reason.
- If a line's author left the company, the owner gets it instead.

"Who wrote which line" comes from the document's edit history (a line-level blame in `src/lib/diff.ts`).

### Handover radar
A drive view that lists documents that need a new owner: no owner, the owner left, or the owner moved team. They're sorted by exposure, meaning how many people rely on the document and how untrustworthy it is. Each one comes with suggested successors, and you can reassign ownership in one click (`src/lib/handover.ts`, `src/components/HandoverRadar.tsx`).

### Handover briefing
When you take over from someone who left or moved team, `/handover/<person>` gives you one page with everything you inherit from them (`src/lib/briefing.ts`, `src/app/handover/[personId]/page.tsx`):
- **Documents you inherit:** everything they owned, wrote, edited or verified, grouped by your trust score into *safe to use*, *use with care* and *don't rely on these yet*, with the reasons.
- **Known exceptions:** conflict overrides on those documents, showing both lines and the written reason. If the person who overrode the conflict has left, the briefing warns that this note is the only record of why the line is different.
- **What they knew:** lines with figures they wrote that are still in the current text (from the line-level blame), documents only they ever verified, and documents they owned.
- **Who to ask:** the predecessor if they're still at the company, then the active colleagues who own, verified or worked on the same documents, with email, Teams and phone links.
- **First actions:** take over or reassign ownership, and verify documents only they checked, each in one click.

Open it from the chips at the top of the Handover radar, or from the "Handover needed" box on a document.

### Client overview
Taking over a client, or preparing a meeting with one? `/client/<id>` (the client names in the sidebar, the client card on **Company & tags**, or **Client overview** in the drive's client filter) puts everything on one page (`clientOverview` in `src/lib/service.ts`, `src/app/client/[id]/page.tsx`):
- **About the client:** documents linked to it, grouped by your trust score into *safe to use*, *use with care* and *don't rely on these yet*.
- **What the conversations say:** the handover draft's analysis of all the client's mail and Teams chats, read-only: what's still open, agreements and facts that aren't written down anywhere, and what's already in the drive. Every line links to its message.
- **Known exceptions:** conflict overrides on the client's documents, with the reason.
- **Also applies:** general documents for the client's country (or global) on the same topics, the ones an exception differs from first.
- **Colleagues who know this client**, from the conversations, ownership and verifications (former colleagues flagged), and **contacts at the client** from the email signatures.

### Client handover documents from email and Teams
Agreements made by email and promises made in a Teams chat often never reach a document. **Conversations** (in the drive sidebar) shows the client mail threads and Teams chats. You can import more, select one or more of them, and get a draft handover document for that client (`src/lib/handoverDraft.ts`, `src/app/conversations/`):
- **Every line is quoted from a message and links to it.** The letter after each line opens the conversation scrolled to that message, with the quoted sentence highlighted; hovering shows who said it, where and when. Nothing is invented and anyone can check it. Link addresses are ignored by the conflict, duplicate, tagging and outdated-year checks.
- **Sorted into sections:** agreements with the client, client setup, open items and contacts. Jev classifies each statement with a *choice* question, or keyword rules in four languages when Jev is unavailable. You can move items between sections or untick them before saving.
- **Open loops:** Jev checks for each question, request or promise whether it's still open, given the later messages in the same conversation. Questions asking for information count as answered by any reply.
- **"Not written down anywhere":** each agreement and fact is checked against the drive using the conflict rules' fact match, so the review shows what's already documented and what only lives in the chats.
- **Personal data:** IBANs and national numbers are removed before anything is sent to Jev, and lines with an employee's personal data or health information are left out unless someone ticks them.
- **Contacts at the client** come from the senders and their email signatures.
- **Saved through the usual check:** the draft is saved as *To be reviewed*, linked to the client, through the same conflict and duplicate check as any upload.

**Import** accepts pasted email chains (reply headers in English, Dutch, French or German, Outlook or Gmail style), Teams chats (copied from the app or exported), and `.eml` files (`src/lib/conversationImport.ts`). Colleagues are recognised by name or address, and the client by the senders' email domain.

The handover briefing lists the conversations the predecessor took part in, with a **Create handover document** button for each client. Documents can also be filtered by client in the drive sidebar.

### Email and Teams inside TrustDrive
Colleagues can write each other email and Teams messages without leaving the app (`src/lib/messaging.ts`, `src/components/Compose.tsx`). Nothing goes through Microsoft 365.
- **Email** and **Teams chat** next to every contact open a compose window. The home page's **Reply** answers in that thread, and each conversation has a reply box. **New → Email / Teams chat** on the Conversations page starts a new one.
- Messages are stored in their conversation, and the colleagues on it get a bell notification. Switch **Viewing as** to answer as someone else. A Teams message to the same people continues the existing chat.
- **Client contacts don't receive anything yet**, because email outside the company isn't connected. The compose window and the confirmation say so; the message is kept in the conversation.
- Replying to a client takes them off **Clients waiting for an answer**. Sent messages feed into client handover documents like any other conversation.

### Folders
The drive has nested folders (`src/lib/folders.ts`, `src/app/drive/page.tsx`). The demo company comes with an example structure: *Payroll* (per country, with *Year-end closing* and *Policies* under Belgium), *Clients* (a folder per client), *HR policies*, *Legal & compliance* and *Time & attendance* (with *Clocking terminals*).
- **Browse** with the path at the top. Each folder row shows how many documents it holds and how many of them are unreliable for you.
- **New folder** creates one in the folder you're in, and **New → Blank document / File upload** adds the document there too. The ⋮ menu on a folder renames or deletes it. Deleting a folder moves its documents and subfolders up a level, so no document is deleted.
- **Trash:** the ⋮ menu on a document (or right-click) has **Move to trash**, for its owner and collaborators, with an **Undo** notice. The **Trash** tab lists the documents you own or removed: **Restore** puts one back where it was, **Delete forever** removes it with its history and scores. Documents in the trash are left out of everything else: the drive, search, scores, conflict and duplicate checks.
- **Move** documents and folders by dragging them onto a folder or onto the path at the top, or pick a folder in a document's **Details** tab. Moving a document isn't an edit: it doesn't change its history or its trust score.
- **Search and filters** cover the current folder and its subfolders, and each result shows the folder it's in. The other views (Owned by me, Needs attention, a client) list documents from every folder.

### Finding documents: tags and the company map
Every document is tagged with four things (`src/lib/taxonomy.ts`, `src/lib/appliesTo.ts`):

| Field | What it holds |
|---|---|
| **Document type** | One of policy, procedure, checklist, reference, guide (which now includes Q&A) and informal (notes, tips, know-how) |
| **Topics** | One or more topics in two levels (e.g. *Compensation & benefits › Salary*) |
| **Applies to** | One or more countries, or Global, and optionally teams within them. Only the teams based in the chosen countries (or working across countries) can be picked; no team means every team there |
| **Client** | Optional; picked by searching the clients |

The team that maintains a document isn't a tag: it's the team of whoever created it.
- **Company & tags** (sidebar) shows what exists: countries → teams → people, clients, the topic tree with descriptions, and document types, each with a document count that opens the filtered drive. It also lists tags in use that aren't in the taxonomy, and documents that still lack a type or topic.
  - **My clients:** everyone chooses which clients they work with (**Choose** next to *My clients* in the sidebar, or **In my sidebar** on a client card). Only those show in their sidebar and in *Clients waiting for an answer*; until someone chooses, they see their team's clients.
  - **Clients** are added, edited and removed there (name, email domain, team, country). A client that documents or conversations still refer to can't be removed (`src/lib/clients.ts`, `src/app/api/clients/`).
  - The **Edit tags** tab is where the taxonomy is changed: add, rename, describe and remove topics, document types and countries, edit their keywords, and move a sub-topic to another main topic or make it a main topic. Ids never change, so documents keep their tags.
- **The taxonomy is editable.** Topics, document types and countries are stored in the database (`taxonomy_terms`), starting from the defaults in `src/lib/taxonomy.ts`. On **Company & tags**, anyone can add a country, a main topic, a sub-topic or a document type, and edit its name, description and keywords. The keywords drive the rule-based suggestions and are given to Jev as evidence, so a new country like Luxembourg is suggested from words such as *CCSS*. Ids never change, so renaming a topic keeps every document's tags. A country can't be renamed (documents and people store its name) or removed while anything uses it. A topic with sub-topics can't be removed either. Removing a tag that documents use leaves it on them as an untracked tag until they're retagged.
- **Tagging is mandatory.** A document needs a document type, at least one topic and at least one country before its content is saved. **Upload** always ends in the **Tag this document** dialog. The first **Save** of a new blank document, and **Check & create document** for a client handover, open it when something is missing. **Edit tags** in a document's Details tab opens the same dialog. It's pre-filled with suggestions from the content. The server refuses untagged content and unknown countries too. Demo documents that were never fully tagged are asked for their tags on their next save.
- **Suggested tags.** **Suggest from content** in the upload dialog and **Suggest tags** in a document's Details tab propose country, team, client, document type and topics (`src/lib/tagging.ts`). Jev answers typed *choice* questions in one call per document, walking the topic tree level by level (a sub-topic's confidence is P(main topic) × P(sub-topic)). A suggested topic is kept only if the text contains supporting words, unless Jev is very sure, which filters out unsupported tags. Without Jev, keyword rules in four languages decide. Country, team and client are only proposed when the suggestion is confident, so "nothing found" never overwrites a known value. Nothing changes until someone applies it.
- The drive filters by tag (a main topic includes its sub-topics), team, country, client and status, all linkable (`/drive?tag=salary`).

This is the *Find* part of the challenge, in the spirit of McKinsey's automated knowledge tagging ([MIT Sloan poster](https://mitsloan.mit.edu/sites/default/files/inline-files/McKinsey_Vojta_Machytka_Samantha_Tsang%20Vojta%20Machytka.pdf)): they reported 46% consistency over repeated GPT runs and $0.35 per document. Here a suggestion costs one Jev call (about a tenth of a cent), and the rules give the same answer every time.

### Evaluation
Measured on the 39 demo documents' hand-written country, team, client and tags (`src/lib/tagEval.ts`), with Jev run five times per document:

| Tag suggestions | Jev | Rules |
|---|---|---|
| Country | 87.2% | 84.6% |
| Team | 79.5% | 71.8% |
| Client | 100% | 100% |
| Document type (22 labelled) | 90.9% | 77.3% |
| Topic precision | 88.5% | 78.6% |
| Topic recall | 70.0% | 80.0% |
| At least one correct topic | 97.4% | 97.4% |
| Same answer in 5 runs | 92.3% | 100% |

Jev is more precise and better on country, team and document type; the rules find more topics (higher recall). Jev gets the country words the rules recognise (e.g. *DmfA* and joint committees are Belgian) as evidence; without them it put the Belgian DmfA checklist in France. For conflicts, Jev matches 16 of the 17 labelled pairs (it blocks a draft proposal against a current rule) and gives the same verdict in all five runs on 15 of 17.

For comparison, the [McKinsey/MIT poster](https://mitsloan.mit.edu/sites/default/files/inline-files/McKinsey_Vojta_Machytka_Samantha_Tsang%20Vojta%20Machytka.pdf) reports 46% consistency and $0.35 per document for GPT-4o tagging on a different and larger taxonomy, so the numbers aren't directly comparable. The rule keywords were written knowing these documents, so the rules' scores are optimistic; Jev wasn't tuned on them beyond the country evidence. Re-run with `JEV_EVAL=1 npm test -- tagging.jev` and `JEV_EVAL=1 npm test -- conflicts.jev` (paid API, well under a dollar together).

### Doubts in the text
Lines that look doubtful are underlined in the document itself: lines that only mention past years, lines involved in an overridden conflict, and lines that Jev finds contradicting other documents (checked in the background when the page opens). See `src/lib/doubts.ts`.

---

## How to run it

**Requirements:** Node.js 22+ (developed on Node 26). A Jev API key (https://jevtypesafeai.com/pricing) is optional: without one, everything runs on the rule-based fallbacks. Nothing else to install: locally the database is an embedded Postgres (PGlite).

```bash
cd trustdrive
npm install

# Settings (the file is git-ignored); at least JEV_API_KEY=jv_live_... for Jev
cp .env.example .env.local

npm run dev
# open http://localhost:3000
```

On first start, the embedded Postgres database is created in `trustdrive/data/pglite`, the migrations in `trustdrive/drizzle/` run, and a demo company is loaded. That's 8 teams, 24 people (some of whom left or moved team), 8 clients (Noordkaai Logistics and Havenstaal BV with 6 email and Teams conversations), and 48 documents in English, Dutch, French and German. Set `DATABASE_URL` to use a real Postgres instead.

| Command | What it does |
|---|---|
| `npm run dev` | Development server on :3000 |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run check` | Lint, typecheck and tests together (what CI runs, plus a build) |
| `npm test` | Tests (vitest), against a throwaway in-memory Postgres and never calling Jev: the conflict rules, duplicate estimate, conversation import and handover drafts, the database layer, and the route wrapper |
| `JEV_EVAL=1 npm test -- conflicts.jev` | Runs the same labelled pairs through Jev and the rules and prints a comparison (calls the paid API, Node 21+) |
| `npm run db:generate` | Create a migration after changing `src/db/schema.ts` (applied automatically on the next start) |
| `npm run db:migrate` | Apply migrations now |
| `npm run db:studio` | Browse the database in the browser |

- **Reset demo data** (bottom of the sidebar) wipes the database and reloads the demo company.
- **No sign-in:** **Viewing as** picks who you are. The choice is kept in a cookie and the server decides who's asking: requests can't claim to be someone else.
- **No network for Jev?** Add `JEV_DISABLED=1` to `.env.local`. Trust scores, conflict checks, duplicate warnings and doubts then all run on the rule-based fallbacks; the UI labels each result as rule-based. Without the flag, the same fallbacks kick in automatically whenever Jev can't be reached.
- Demo documents added to `src/lib/seed.ts` later are inserted into existing databases automatically on startup.
- Scoring costs roughly **$0.0004 per document per viewer**, a conflict or duplicate check about **$0.001**. The first time a user opens the drive, all visible documents are scored, which takes a few seconds.
- **CI:** every push and pull request runs lint, typecheck, tests and a build (`.github/workflows/ci.yml`).

### Docker
`trustdrive/Dockerfile` builds a production image (Next.js standalone server, non-root, port 8080). A production server needs a real database, so pass `DATABASE_URL`; for a quick try, `PGLITE_DIR=memory://` uses a throwaway embedded database instead.

```bash
cd trustdrive
docker build -t trustdrive .
docker run --rm -p 8080:8080 -e PGLITE_DIR=memory:// -e JEV_DISABLED=1 trustdrive
# open http://localhost:8080 · /api/health answers when the database does
```

Migrations run on startup; with `MIGRATE_ON_START=false`, run them separately with `node scripts/migrate.mjs` in the same image.

### Suggested demo
1. **Viewing as** (top right) switches user. Start as Jonas Maes, a Belgian payroll consultant. **For you** (the home page) shows what needs him: his documents that need checking, clients waiting for an answer, and handovers he could pick up. Open **Drive**, sort by trust and open *Year-end payroll closing procedure – Belgium* (0) and its *2026* version (~99).
2. Open *Overtime policy – Belgium*. Switch to Marc (the owner), click **I confirm this document is correct**, and watch it rescore.
3. **New → File upload** `trustdrive/samples/salary-review-jonas-maes.md`. It's blocked because it conflicts with the salary register. Override it with a reason, then switch to An Claes and open the bell.
4. Upload `samples/multilingual/planning-paie-decembre-fr.md` (French, conflicts with an English deadline sheet) and `samples/multilingual/maladie-salaire-garanti-fr.md` (a French translation of an existing document, so you get the duplicate warning).
5. Open *Clocking terminal troubleshooting guide*, then *Clocking terminals – quick fixes (CS copy)*. You'll see the "you just saw this" banner.
6. Open **Handover radar** in the sidebar (or the tab in the drive) and reassign a document whose owner left.
7. Still as Jonas, click **Pieter Wouters** at the top of the radar to open his handover briefing. *Client file – Noordkaai Logistics* has a known exception: €0.45/km against the policy's €0.3707/km, with Pieter's reason. Take over the client file and verify it from **First actions**.
8. In Pieter's briefing, under **Conversations Pieter took part in**, click **Create handover document** for Noordkaai Logistics. The review shows his mailed €0.45/km agreement (already in the client file), the 8 July bonus-input deadline (not written down anywhere), and the unanswered 2027 indexation request (still open). The IBAN and national number from the correction mail are kept out. Click **Check & create document**.
9. As Sofie, click **Reply** next to Els Vermeiren on **For you** and send the simulation; Els disappears from the waiting list. Then send An Claes a **Teams chat** from a document's **People** tab, switch to An, open the bell and answer.
10. Open **Company & tags**, click the document count of *Compensation & benefits*, then open a document you own, go to **Details** and click **Suggest tags**.

### Where things are

```
trustdrive/
  src/app/                 pages: For you (/), drive (/drive), document, handover briefing, conversations; API routes under api/
  src/components/AppShell.tsx  navigation, New menu and the Jev-status banner shared by every page
  src/components/          UI: trust badge, conflict/duplicate dialogs, upload, who-to-contact, bell, radar
  src/db/schema.ts         Drizzle schema (Postgres)
  src/lib/config.ts        environment variables, validated
  src/lib/auth.ts          who's asking: the Viewing as switcher's cookie
  src/lib/http.ts          route wrapper: input validation, error responses, logging
  src/lib/trust.ts         Jev client, trust-score inputs, good/bad signals, related documents
  src/lib/conflicts.ts     conflict detection (fact lines → candidate pairs → Jev yes/no, or the rules without Jev)
  src/lib/conflict-cases.ts  hand-labelled conflict pairs used by the tests and the Jev eval
  src/lib/briefing.ts      handover briefing
  src/lib/legal.ts         the Legal & Compliance badge: who in Legal validated a document, and when
  src/lib/quiet.ts         "nobody has looked at this in a year" notices (opens are recorded in document_opens)
  src/lib/mentoring.ts     mentoring: a mentee's questions, searches and reading by department, and where they struggle
  src/app/client/[id]/     client overview (service: clientOverview in src/lib/service.ts)
  src/lib/taxonomy.ts      default topics, document types and countries (with multilingual keywords), validation, required tags
  src/lib/tagging.ts       tag suggestions (Jev choice questions, or rules) · tagEval.ts measures them
  src/lib/companyMap.ts    company structure, clients and tag counts for the Company & tags page
  src/lib/folders.ts       folder tree helpers (paths, subtrees, move checks, name validation)
  src/lib/handoverDraft.ts client handover drafts from conversations (statements → kinds → open loops → documented?)
  src/lib/handoverDoc.ts   the handover document's markdown, shared with the review page
  src/lib/conversationImport.ts  email chain / Teams chat / .eml parsing
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
- **No login or permissions.** "Viewing as" is a user switcher, anyone can edit any document, and only the status/location/team fields are limited to the owner and collaborators. There's no admin screen: people are added to the `people` table with SQL.
- **No real Google Drive integration.** Documents live in TrustDrive's own Postgres database.
- **Uploads are text only** (`.md` / `.txt`). No PDF, Word or spreadsheet parsing; "sheet" and "pdf" are only icons.
- **Missing drive features:** sharing management. Folders have no permissions of their own: anyone can create, rename, move or delete them.
- **The UI isn't tested automatically.** `npm test` covers the library code (conflict rules, duplicate estimate, tagging and taxonomy, applies-to, confidential handling, folders, trash, conversation import, handover drafts, messaging, the database layer and the route wrapper); pages were tested by hand. On the 17 labelled conflict pairs (`src/lib/conflict-cases.ts`), Jev matched the label on 16 (it blocked a draft proposal against a current rule) and the rules on 17, but the rules were tuned on those same pairs, so that's not an independent measurement.

**Trust score**
- **Opening a document isn't recorded as a view.** Views are one of Jev's inputs, so recording them would force a rescore on every open. Usage numbers come from the demo data only.
- **Scores are calculated on demand** the first time a viewer sees a document. There's no background pre-scoring. If Jev is down, a rule-based estimate on the same rubric is shown instead (dashed ring, not stored), and Jev is skipped for 30 s so pages don't hang.
- **The rubric and cutoffs** (75/50 bands, 6 levels) were tuned by eye on the demo data, not validated.

**Conflict detection**
- **Only lines with numbers, amounts or dates are checked.** Wording contradictions such as "submit on paper" vs "submit in the app" aren't caught.
- **The multilingual word list only covers payroll/HR vocabulary.** Other subjects rely on the fallback (a shared name plus the same kind of value).
- **At most 60 line pairs per check.** A very large upload could miss some pairs.
- **Edits only check new or changed lines.** Contradictions already sitting between existing documents only surface in the "doubts" panel when a document is opened; there's no organisation-wide scan.
- **The rule-based fallback is narrower than Jev.** It only compares values (numbers, dates, codes like P1) and needs a shared name or several shared subject words, so paraphrased subjects and every wording contradiction are left to Jev. Rule results aren't cached, so Jev decides again as soon as it's back.

**Duplicates, contacts, notifications**
- **The duplicate check compares only the top 3 candidates.** The "you just saw this" history is kept in the browser, per user and per device.
- **The who-to-contact weights are hand-picked.** Each contact has email, Teams chat and phone links; the demo addresses use the reserved `.example` domain and the phone numbers are made up.
- **Notifications are in-app only** (the bell checks every 10 s). No email or push, and no notification when ownership is transferred.
- **The edit history of the demo documents is made up** (owner writes about 60%, then collaborators, then the last editor), so "who wrote which line" works from the start.

**Messaging**
- **Email and Teams work between colleagues only, inside TrustDrive.** Nothing is sent through Microsoft 365, so client contacts don't receive messages, and there are no attachments, read receipts or per-message recipients (a thread has one participant list). New messages show up within a few seconds (the Conversations page and the bell poll); there's no push.

**Client handover from conversations**
- **No live Microsoft 365 connection.** The mailbox and Teams chats are demo data plus whatever you import. A real connection needs an Azure app registration with admin consent for Microsoft Graph (Mail.Read, Chat.Read). The import functions are where that would plug in.
- **Sorting statements isn't perfect.** Jev or the rules can put a sentence in the wrong section, which is why the review step exists. Statements are single sentences, so a fact spread over two sentences is split.
- **Redaction only covers patterns:** IBANs, Belgian/Dutch/French national numbers, and a list of health words. Names of the client's employees stay.
- **Open loops are only checked within one conversation.** A promise picked up in another thread isn't seen as resolved.

**Caching**
- The conflict and similarity caches, the "is Jev reachable" status and the deduplication of identical scoring requests are per server instance and reset on restart. Everything else (including stored trust scores) is in Postgres, so any number of instances can run side by side.
