# NoteMaker

Browser app for the scribe team: preps tomorrow's progress notes, flags what needs attention, converts H&Ps to follow-ups, enters vitals (with a phone-camera link), reprints any past day, and prints a whole unit as one PDF with the provider circled.

Live: https://feirzen.github.io/Resilience-notes/ (capital R: GitHub Pages addresses match the repo name exactly)

**No patient information ever goes in this repo.** Everything runs in the browser. Notes live in the team folder (U:\Scans\Tomco) that the scribe picks once in Edge. The app keeps its own data in `_app-data` inside that folder. Demo mode uses fake patients stored privately in the browser.

## Ownership
See `NOTICE.md`: the note templates, the provider sheet layout, and unit/site names belong to Resilience Health and are reproduced only for compatibility. Microsoft sign-in and SharePoint are planned, not built.

## Printing
- **Print unit** shows every patient with a checkbox (select all / deselect all), "Edited today", and warnings before printing: vitals missing (not entered and not marked Refused/UTO), open flags, and "Any labs to review?" when nobody on the unit has labs added today.
- Still one print job. **Signed page on top** (on by default, remembered per provider in `_app-data/printprefs.json`): each note's pages are split at the page with the signature line and the back half goes on top (3 pages: 3,1,2; signed on 3 of 4: 3,4,1,2).
- The signing block (Signed/Scribe, providers, BC, EKG) never splits across pages, in the PDF or the Word file.
- **Billing** (unit page and Home > All patients): type 1/2/3 per patient (saves into the Home list), EKG toggle right next to it, Always 3 code with its reason.

## Vitals, admits, labs
- Vitals: **Refused** / **UTO** fill a whole row (BG only for patients who get BG checks). The HPI then reads "refused vitals today" / "BP unable to obtain today".
- **Add admits** on Home: type names as a list (Enter for the next), each gets an empty H&P marked **Needs prep** until its H&P form is saved.
- **Labs** on a unit: the whole unit's lab review on one screen. Pending labs up top (tap to add), diagnoses small unless waiting on a lab (tap to change today's plan), "New diagnosis from labs" adds a Plan-only diagnosis. One save.

## Moving fast
- Open-note tabs under the unit bar. Ctrl-click or middle-click a patient to open it as a tab without leaving the page; Alt+1-9 jumps between tabs. The note you're on is a light preview tab until you change something.
- Leaving a note with unsaved edits saves it in the background. Several edits while a save is waiting become one save.

## Two computers, one note
- Every save bumps a version. If another computer saved first, the app merges both (lib/merge.js, entry by entry). Only the same entry changed two different ways asks a person ("Pick versions", or decide later and the note stays flagged).
- An open note checks every 15 seconds and refreshes itself when someone else saved it (if you're not mid-edit).

## Bedboard, notes, holidays
- **Bedboard** (top bar): a square per unit, colored by status, seen + billing, per-person view settings, one-page fold-up print (lib/board-pdf.js).
- **Pinned notes** on Home link patients by name (type a name or @). Linked notes show on those patients' notes and only go away when someone marks them resolved. "Show big every time" makes a note pop over the patient's note once per visit until OK.
- **Vital alerts**: Settings > Vital alerts, each person's own limits. **Labs pending over a week** turn red.
- **Holidays**: lib/holidays.js. Toggle in Settings > Look.

## Presentation mode
The monitor icon on the first screen (or Settings > Presentation mode) runs a quick guided tour of the demo on fake patients: short labels only, you do the talking. → or Space next, ← back. The dock has Skip (jump past a part), the part name (click it to jump anywhere), and Pause. Esc or Pause leaves a "Resume tour" pill in the corner so you can use the app and pick back up where you were. Clicking anywhere in the app mid-tour lets you explore; → continues the tour from that spot. The first time it runs, `sw.js` saves an offline copy of the app's own files so it still loads on bad Wi-Fi. `lib/present.js` holds the tour.

## Layout
- `app.js`, `styles.css`, `index.html`: the screens (home dashboard, unit list, paper-style note editor, vitals, prep review, print check, H&P form, flag list).
- `engine/`: the rules (wording, prep, flags, reprint, times). `node engine/test.mjs`
- `lib/layout.js`: note -> template blocks. `docx-out.js` (Word), `pdf-out.js` (print), `docx-in.js` (import hand-made notes), `store.js` (folder), `demo.js` (fake patients). `node lib/test.mjs` (needs docx, jszip, jspdf from npm)
- `vendor/`: libraries kept local so nothing loads from outside sites.

## Flags
This project's flags are saved in the team folder (`_app-data/feedback.json`), not in any other flag system. Use the Flag list's "Copy open flags for Claude" button to work through them. Never put patient info in a flag.

## Security
- Patient data never leaves the work computer and the team folder. GitHub only serves the app's code.
- `index.html` has a Content Security Policy: the page can only load its own files and is blocked from sending anything to any other server (no fetch, no outside images, no forms). Libraries in `vendor/` are kept local for the same reason.
- `sw.js` (the only worker allowed) keeps an offline copy of the app's own code files. It never stores patient data.
- No inline scripts, so the policy can stay strict.
