# Resilience Notes

Browser app for the scribe team: preps tomorrow's progress notes, flags what needs attention, converts H&Ps to follow-ups, enters vitals (with a phone-camera link), reprints any past day, and prints a whole unit as one PDF with the provider circled.

Live: https://feirzen.github.io/Resilience-notes/ (capital R: GitHub Pages addresses match the repo name exactly)

**No patient information ever goes in this repo.** Everything runs in the browser. Notes live in the team folder (U:\Scans\Tomco) that the scribe picks once in Edge. The app keeps its own data in `_app-data` inside that folder. Demo mode uses fake patients stored privately in the browser.

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
- No inline scripts, so the policy can stay strict.
