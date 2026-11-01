# Resilience Notes

A browser app that preps scribe progress notes for the next day: rolls each problem forward, flags what needs attention, rebuilds any past day for reprints, and (soon) builds the Word docs.

**No patient information ever goes in this repo.** The app runs entirely in the browser. Patient files stay on the work computer (and later, the hospital's SharePoint). Test with fake patients only.

## What's here
- `engine/engine.js`: the rules (wording, prep, flags, reprint, times). Run the tests with `node engine/test.mjs`.
- `scan/vitals.html` + `scan/camera.html`: phone camera to computer, peer-to-peer. The phone shows a live camera, sends each picture straight to the computer, and saves nothing. Only the connection handshake uses a signaling service (currently the free PeerJS server; it never sees pictures).
- `vendor/`: PeerJS and a QR code library, kept here so nothing loads from outside sites.

## Coming next
UI (after the concept pick), Word doc output from the templates, reading the vitals sheet, census Excel, H&P form.
