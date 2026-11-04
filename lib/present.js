// Presentation mode: slides plus live guided tours of the demo, for showing NoteMaker to the team.
// Fake patients only. It never opens the team folder. Keys: → / Space / PageDown next, ← / PageUp back, Esc exit.
import { ic } from "./icons.js";

let A = null;            // hooks into the app (set by initPresent)
let P = null;            // the running presentation
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ABORT = Symbol("abort");
const chev = d => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${d === "l" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"}"/></svg>`;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function initPresent(api) { A = api; }
export const presenting = () => !!P;

// ---------------- the deck ----------------
const SRC_REWORK = "Azalea Health, denial rework estimates (2025)";
const SRC_ABANDON = "MGMA / HFMA figures via SPRY (2026)";

const slide = (cls, inner) => ({ type: "slide", cls, html: inner });
const DECK = () => [
  slide("title", `
    <img class="pz-logo pz-in" src="icons/favicon.svg" alt="" style="--d:0">
    <h1 class="pz-in" style="--d:1">NoteMaker</h1>
    <p class="pz-tag pz-in" style="--d:2">Tomorrow's notes, prepped before you leave today.</p>
    <p class="pz-sub pz-in" style="--d:3">A faster, cleaner way to prep, flag, and print scribe notes for the Tomco team.</p>
    <div class="pz-meta pz-in" style="--d:4"><span>Aspen Grove Behavioral Hospital</span><span id="pzOff" class="pz-off"></span></div>`),
  slide("safe", `
    <div class="pz-main">
      <div class="pz-kick pz-in" style="--d:0">Before anything else</div>
      <h2 class="pz-in" style="--d:1">Built safe from day one</h2>
      <div class="pz-big3">
        <div class="pz-in" style="--d:2">${ic("shield", 30)}<b>No AI inside</b><p>Scribes write every word. NoteMaker only follows set rules: copy forward, flag, and format.</p></div>
        <div class="pz-in" style="--d:3">${ic("lock", 30)}<b>Nothing leaves the hospital</b><p>Patient info stays in the team folder on hospital computers. The app has no way to send it anywhere.</p></div>
        <div class="pz-in" style="--d:4">${ic("monitor", 30)}<b>Nothing to install</b><p>It runs in Edge, the same way BlueStep does.</p></div>
      </div>
    </div>
    <aside class="pz-side pz-in" style="--d:3">
      <div class="pz-kick">Sidebar</div><h3>HIPAA, in plain words</h3>
      <ul>
        <li>No patient info is stored in the app's code. Ever.</li>
        <li>Notes stay where they live today: the team folder.</li>
        <li>A built-in security lock blocks every outside connection.</li>
        <li>Each person signs in with their own PIN.</li>
        <li>Every edit is logged with who and when.</li>
        <li>Today's demo uses fake patients only.</li>
        <li>Hospital IT gets the final review.</li>
      </ul>
    </aside>`),
  slide("what", `
    <div class="pz-kick pz-in" style="--d:0">What it is</div>
    <h2 class="pz-in" style="--d:1">Prep, flag, print, and share</h2>
    <p class="pz-lead pz-in" style="--d:2">NoteMaker takes the daily note work that eats a scribe's time and turns it into a few clicks.</p>
    <div class="pz-pillars">
      <div class="pz-in" style="--d:3">${ic("history", 26)}<b>Prep</b><p>Every note on a unit rolls forward to tomorrow in one click.</p></div>
      <div class="pz-in" style="--d:4">${ic("flag", 26)}<b>Flag</b><p>Ending antibiotics, follow-ups, pending labs, and new problems surface on their own.</p></div>
      <div class="pz-in" style="--d:5">${ic("print", 26)}<b>Print</b><p>A whole unit prints as one job, with the rounding provider on every note.</p></div>
      <div class="pz-in" style="--d:6">${ic("people", 26)}<b>Share</b><p>A dashboard, pinned notes, and announcements keep providers and scribes in sync.</p></div>
    </div>
    <p class="pz-foot pz-in" style="--d:7">Let's look at it live.</p>`),
  ...SCENES(),
  slide("grid", `
    <div class="pz-kick pz-in" style="--d:0">Also built in</div>
    <h2 class="pz-in" style="--d:1">Everything else the team needs</h2>
    <div class="pz-feat">${[
      ["pin", "Pinned notes & announcements", "Handoffs and team news live where everyone already looks."],
      ["shield", "Supervisor tools", "People, PINs, team wording rules, and saved daily counts."],
      ["history", "Edit history", "Who changed what on every note, and when."],
      ["count", "Daily count", "Builds itself from the billing column."],
      ["hp", "H&P form", "Adult and adolescent. Turns into the progress note on day 2."],
      ["vitals", "Vitals grid", "A whole unit's vitals on one screen."],
      ["folder", "Old notes", "Rebuild and reprint any past day in one click."],
      ["book", "Trainings", "Step-by-step modules for new scribes. Coming soon."],
      ["feedback", "Feedback flags", "Scribes flag a problem right on the screen it's on."],
      ["help", "Help on every page", "A short tour, or tap anything to see what it does."],
      ["hospital", "Ready for more sites", "Aspen Grove now. Salt Lake can be added."],
      ["palette", "Easy on the eyes", "Light, dark, and sepia themes."],
    ].map(([i, t, d], k) => `<div class="pz-in" style="--d:${2 + k * 0.5}">${ic(i, 22)}<b>${t}</b><p>${d}</p></div>`).join("")}</div>`),
  slide("who", `
    <div class="pz-kick pz-in" style="--d:0">Who it helps</div>
    <h2 class="pz-in" style="--d:1">Scribes do the work. Providers feel it.</h2>
    <div class="pz-two">
      <div class="pz-in" style="--d:2"><h3>${ic("user", 20)} For providers</h3><ul>
        <li>Notes ready when you round</li><li>Cleaner notes to sign, in the same format every time</li>
        <li>The whole hospital at a glance</li><li>Handoffs that don't get lost</li></ul></div>
      <div class="pz-in" style="--d:3"><h3>${ic("note", 20)} For scribes</h3><ul>
        <li>No more copy-and-paste prep</li><li>A whole unit prints in one job</li>
        <li>More time present in the room</li><li>A real training path from day one</li></ul></div>
    </div>`),
  slide("cash", `
    <div class="pz-kick pz-in" style="--d:0">Measurable savings</div>
    <h2 class="pz-in" style="--d:1">Where the time and money come back</h2>
    <div class="pz-cards">
      <div class="pz-in" style="--d:2"><span class="pz-ci">${ic("clock", 22)}</span><b>Scribe labor</b>
        <div class="pz-num">~1 hr 15 min</div><div class="pz-unit">saved per scribe, every day</div>
        <p>Prep, printing, and filing shrink, 365 days a year, at every site. On lighter days, part of the day could run with one scribe.</p>
        <small>Our estimate. Being measured now.</small></div>
      <div class="pz-in" style="--d:3"><span class="pz-ci">${ic("count", 22)}</span><b>Billing rework &amp; revenue capture</b>
        <div class="pz-num">25 to 45 min</div><div class="pz-unit">to rework one denied claim</div>
        <p>Complete, consistent notes mean fewer claims sent back for documentation, and fewer visits that never get paid.</p>
        <small>Industry figures: ${SRC_REWORK}. Up to 65% of denied claims are never resubmitted (${SRC_ABANDON}).</small></div>
      <div class="pz-in" style="--d:4"><span class="pz-ci">${ic("book", 22)}</span><b>Training</b>
        <div class="pz-num">Day 1</div><div class="pz-unit">a real training path</div>
        <p>A training protocol built into the app replaces shadow-only learning, so new scribes are accurate sooner and fewer shifts are double-staffed.</p>
        <small>Fewer shadow shifts for every new hire.</small></div>
    </div>`),
  slide("soft", `
    <div class="pz-kick pz-in" style="--d:0">And everything else</div>
    <h2 class="pz-in" style="--d:1">Better every day, in ways you'll notice</h2>
    <div class="pz-soft">
      <div class="pz-in" style="--d:2">${ic("check", 24)}<div><b>Note quality</b><p>Every note follows the same rules, so notes look the same no matter who wrote them. Flags catch what's easy to miss.</p></div></div>
      <div class="pz-in" style="--d:3">${ic("megaphone", 24)}<div><b>Smooth handoff and communication</b><p>Pinned notes, announcements, and the shared sheet keep providers and scribes on the same page.</p></div></div>
      <div class="pz-in" style="--d:4">${ic("clock", 24)}<div><b>Time saved for providers and scribes</b><p>Less hunting through notes, less chasing details, more time with patients.</p></div></div>
      <div class="pz-in" style="--d:5">${ic("hospital", 24)}<div><b>Grows with the company</b><p>A new hospital or a new scribe gets the same setup and the same training, fast.</p></div></div>
    </div>`),
  slide("next", `
    <div class="pz-kick pz-in" style="--d:0">What's next</div>
    <h2 class="pz-in" style="--d:1">Integration</h2>
    <p class="pz-lead pz-in" style="--d:2">It can go in a few ways, depending on what IT is willing to accept.</p>
    <div class="pz-paths">
      <div class="pz-in" style="--d:3"><b>As it is</b><p>Runs in Edge with the team folder we already use.</p></div>
      <div class="pz-in" style="--d:4"><b>On hospital servers</b><p>The same app, hosted inside the hospital network.</p></div>
      <div class="pz-in" style="--d:5"><b>Fully connected</b><p>Linked to SharePoint and Microsoft sign-in. Planned, not built yet.</p></div>
    </div>
    <ol class="pz-steps">
      <li class="pz-in" style="--d:6"><b>Approve &amp; set up</b><span>Pick the path that fits.</span></li>
      <li class="pz-in" style="--d:7"><b>Train the scribes</b><span>A short session, plus the built-in trainings.</span></li>
      <li class="pz-in" style="--d:8"><b>Go live &amp; measure</b><span>Track the time it saves.</span></li>
    </ol>`),
  slide("end", `
    <img class="pz-logo pz-in" src="icons/favicon.svg" alt="" style="--d:0">
    <h1 class="pz-in" style="--d:1">Questions?</h1>
    <p class="pz-sub pz-in" style="--d:2">Grab the laptop and try it. Every patient in the demo is fake.</p>
    <button class="pz-cta pz-in" style="--d:3" data-pzexit>Explore the demo</button>`),
];

// ---------------- live tours ----------------
// Step kinds: say (spotlight + caption), click (cursor clicks it), tap (cursor taps, then fn runs), go (route), fn.
const DOE = "demo-0";
function SCENES() {
  return [
    { type: "scene", n: 1, title: "Opening NoteMaker", sub: "It opens in Edge like any website. Pick the hospital and you're in.",
      setup: async () => { await A.toStart(); },
      steps: [
        { say: ".bigsites", t: "Each hospital gets its own setup", x: "Aspen Grove is live. Salt Lake can be added the same way." },
        { tap: '.bigsite[data-s="AGBH"]', fn: async () => { await A.enterDemo(); await waitFor("#ov"); } },
        { say: ".top .pill", t: "Demo mode", x: "At work it opens our team folder. Today every patient is fake." },
      ], explore: "the first screen" },
    { type: "scene", n: 2, title: "The provider dashboard", sub: "The whole hospital at a glance, before rounds even start.",
      setup: async () => { await ensureDemo(); await go("home", "#ov"); },
      steps: [
        { say: ".census", t: "Census", x: "Everyone in house today, plus today's admits. Tap a name to jump to their note." },
        { say: ".fuwrap", t: "Follow-ups by unit", x: "Every unit with what needs attention: follow-ups in red, things to check in yellow, notes to write up." },
        { click: "#ovAll", wait: 500 },
        { say: "#ov", t: "Joey's patient sheet, built in", x: "Diagnoses, pertinent issues, psych diagnosis, and billing, updated live as scribes work. No separate Excel to keep up." },
        { say: ".ovt tr[data-pt]", t: "Color that means something", x: "Acute problems stand out in orange, diabetes in purple. Billing saves as you type." },
        { say: ".daybar", t: "The daily count builds itself", x: "Pick the provider and times, and the count is generated from the billing column." },
        { say: "[data-help=pinned]", t: "Pinned notes for handoff", x: "Whoever rounds next sees them until someone marks them resolved." },
        { say: "[data-help=ann]", t: "Announcements", x: "Posts for scribes, providers, or everyone, right on the dashboard." },
      ], explore: "the dashboard" },
    { type: "scene", n: 3, title: "Units and the note", sub: "Every patient on a unit, and a note that looks exactly like what prints.",
      setup: async () => { await ensureDemo(); await go("home", "#ov"); },
      steps: [
        { say: ".tabs", t: "Every unit, one tap away", x: "Each tab shows its patient count, with a red dot when something needs a follow-up." },
        { click: '.tabs a[href="#unit-TIMP"]', wait: 400, waitFor: ".list" },
        { say: ".list", t: "The unit list", x: "Every patient, with the one thing that needs a look right next to their name." },
        { click: `a.it[href="#pt-${DOE}"]`, wait: 400, waitFor: "#paper" },
        { say: "#paper", t: "The note, exactly as it prints", x: "Same template the team uses today. Tap any paragraph to edit it.", pos: "side" },
        { say: ".glance", t: "Needs attention", x: "Everything flagged on this note in one box, like an antibiotic ending or a pending lab." },
        { click: ".glance [data-goto]", wait: 900 },
        { say: ".pp.hot, #paper .new", t: "Go to", x: "Jumps straight to the paragraph it's about. Today's entry is highlighted in yellow.", pos: "side" },
        { say: ".cmtlayer", t: "Margin comments", x: "Like comments in Word: why something is flagged, with an Addressed button." },
        { say: ".tools", t: "Quick tools", x: "Add a diagnosis, labs, or a quick note. Meds and doses come from a built-in list." },
      ], explore: "the note" },
    { type: "scene", n: 4, title: "Print a whole unit at once", sub: "One click, one print job, with the rounding provider on every note.",
      setup: async () => { await ensureDemo(); await go("unit-TIMP", ".list"); },
      steps: [
        { click: "#prn", wait: 500, waitFor: "#pP" },
        { say: "#pP", t: "Pick the provider once", x: "Their name prints on every note in the unit." },
        { say: ".modal .mb", t: "A last check before printing", x: "Every open flag is listed, so nothing prints unchecked by accident.", pos: "side" },
        { say: "#pGo", t: "Then print", x: "All the notes go out as one print job." },
        { fn: async () => { A.closeModals(); await pause(300); showPdf("TIMP"); await pause(900); } },
        { say: ".pz-pdf iframe", t: "What prints", x: "Every note on the unit in one file, ready for signatures.", pos: "side" },
      ], explore: "printing" },
    { type: "scene", n: 5, title: "Prep for tomorrow", sub: "The job that used to take the longest is now one button.",
      setup: async () => { hidePdf(); await ensureDemo(); await go("unit-TIMP", ".list"); },
      steps: [
        { say: "#prep", t: "One button", x: "At the end of the day, this preps every note on the unit for tomorrow." },
        { click: "#prep", wait: 600, waitFor: ".modal .lbl", timeout: 20000 },
        { say: ".modal", t: "Only what changed needs a look", x: "Chronic problems copy forward quietly. Anything that changed today shows up here for a quick check.", pos: "side" },
        { click: ".modal .mfoot .btn.p", wait: 700 },
        { say: "#main .al", t: "The whole unit is ready", x: "Every note now reads for tomorrow. Unprep undoes it in one click." },
        { click: `a.it[href="#pt-${DOE}"]`, wait: 500, waitFor: "#paper" },
        { say: "#paper", t: "Tomorrow's note", x: "New date, every problem carried forward, and tomorrow's entries already written in yellow.", pos: "side" },
        { click: ".side a:not(.on)", wait: 500, waitFor: "#paper" },
        { say: "#paper", t: "Same for every patient", x: "No copying and pasting, and no prep in the morning.", pos: "side" },
      ], explore: "prepped notes" },
  ];
}

// ---------------- start / stop ----------------
export async function startPresentation() {
  if (P || !A) return;
  cacheForOffline();
  const items = DECK();
  P = { items, i: -1, mode: "", tok: 0, waker: null, demo: false };
  const L = document.createElement("div"); L.className = "pz"; L.innerHTML = `
    <div class="pz-block" hidden></div>
    <div class="pz-spot"></div><div class="pz-cap" hidden></div>
    <div class="pz-cursor" hidden><svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l15 9.5-6.6 1.3 4 7.6-2.9 1.5-4-7.6L4 19z" fill="#fff" stroke="#0f1726" stroke-width="1.6" stroke-linejoin="round"/></svg></div>
    <div class="pz-veil" hidden><div class="pz-card"></div></div>
    <div class="pz-slide" hidden></div>
    <div class="pz-dock"><button data-pz="b" title="Back (←)">${chev("l")}</button><span class="pz-lbl"></span><span class="pz-dots"></span>
      <button data-pz="n" class="pz-next" title="Next (→ or Space)">${chev("r")}</button><button data-pz="x" title="Exit (Esc)">${ic("x", 15)}</button></div>`;
  document.body.append(L); document.body.classList.add("presenting"); P.L = L;
  $$("[data-pz]", L).forEach(b => b.onclick = e => { e.stopPropagation(); ({ n: next, b: back, x: stop })[b.dataset.pz](); });
  L.addEventListener("click", e => { if (e.target.closest("[data-pzexit]")) stop(); });
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("mousemove", wake);
  P.raf = requestAnimationFrame(tick);
  try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch {}
  await show(0);
}
export function stop() {
  if (!P) return;
  P.tok++; P.waker?.();
  cancelAnimationFrame(P.raf); P.L.remove(); hidePdf();
  document.body.classList.remove("presenting");
  document.removeEventListener("keydown", onKey, true); document.removeEventListener("mousemove", wake);
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  P = null;
}

// ---------------- moving through the deck ----------------
async function show(i) {
  if (i < 0 || i >= P.items.length) return;
  const tok = ++P.tok; P.waker?.(); P.i = i; const it = P.items[i];
  spot(null); cap(null); cursor(false); block(false); hidePdf();
  dots();
  try {
    if (it.type === "slide") {
      veil(null); setMode("slide");
      const s = $(".pz-slide", P.L); s.className = `pz-slide s-${it.cls}`; s.innerHTML = `<div class="pz-inner">${it.html}</div>`; s.hidden = false;
      if (it.cls === "title") offlineBadge();
      return;
    }
    // scene: set the page up behind the title card
    setMode("setup"); block(true);
    veil(it, true);
    $(".pz-slide", P.L).hidden = true;
    await it.setup?.(); check(tok);
    setMode("title");
  } catch (e) { if (e !== ABORT) { console.error(e); setMode("explore"); block(false); veil(null); } }
}
async function play(it) {
  const tok = P.tok; setMode("auto"); block(true); veil(null);
  try {
    for (const s of it.steps) { check(tok); await step(s, tok); }
    check(tok);
  } catch (e) { if (e === ABORT) return; console.error(e); }
  spot(null); cap(null); cursor(false); block(false); setMode("explore");
}
function next() {
  if (!P) return;
  const it = P.items[P.i];
  if (P.mode === "title") return play(it);
  if (P.mode === "auto") { P.waker?.(); return; }          // skip ahead to the next step
  if (P.mode === "setup") return;
  if (P.i < P.items.length - 1) show(P.i + 1);
}
function back() { if (P && P.i > 0) show(P.i - 1); }
function onKey(e) {
  if (!P) return;
  const typing = e.target.closest?.("input,textarea,select,[contenteditable]");
  if (["ArrowRight", "PageDown"].includes(e.key) || (e.key === " " && !typing)) { e.preventDefault(); e.stopPropagation(); next(); }
  else if (["ArrowLeft", "PageUp"].includes(e.key) && !typing) { e.preventDefault(); e.stopPropagation(); back(); }
  else if (e.key === "Escape") {
    if ($(".scrim") || $(".tray") || $(".pz-pdf")) { if ($(".pz-pdf") && !$(".scrim")) { e.stopPropagation(); hidePdf(); } return; }
    e.stopPropagation();
    if (P.armExit) return stop();
    P.armExit = true; label("Press Esc again to exit"); setTimeout(() => { if (P) { P.armExit = false; setMode(P.mode); } }, 2200);
  }
}

// ---------------- one tour step ----------------
async function step(s, tok) {
  if (s.go) { await go(s.go, s.waitFor); return; }
  if (s.fn && !s.tap) { await s.fn(); check(tok); return; }
  const sel = s.say || s.click || s.tap;
  const el = await waitFor(sel, s.timeout || 6000); check(tok);
  if (!el) { console.warn("presentation: couldn't find", sel); return; }
  const r0 = el.getBoundingClientRect(), beh = reduced() ? "auto" : "smooth";
  if (r0.height > innerHeight * 0.6 && !el.closest(".scrim,.pz-pdf")) window.scrollTo({ top: Math.max(0, scrollY + r0.top - 110), behavior: beh });
  else el.scrollIntoView({ behavior: beh, block: "center" });
  await pause(450, tok);
  if (s.say) {
    spot(el); cap(el, s.t, s.x, s.pos); cursor(false);
    await pause(s.hold || 3600 + s.x.length * 18, tok, true);
    return;
  }
  // click or tap: move the cursor there, show the press, then act
  spot(el); cap(null);
  await moveCursor(el, tok);
  ripple();
  await pause(180, tok);
  if (s.click) el.click(); else await s.fn?.();
  check(tok);
  if (s.waitFor) await waitFor(s.waitFor, s.timeout || 8000);
  await pause(s.wait || 400, tok);
  spot(null);
}

// ---------------- page helpers ----------------
async function ensureDemo() { if (!A.S.store?.demo) await A.enterDemo(); }
async function go(hash, sel) {
  A.closeModals();
  if (location.hash.slice(1) !== hash) location.hash = hash; else A.route();
  if (sel) await waitFor(sel, 8000);
  await pause(150);
}
async function waitFor(sel, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const el = $$(sel).find(x => x.offsetParent !== null || x.getClientRects().length);
    if (el) return el;
    await new Promise(r => setTimeout(r, 80));
  }
  return null;
}
function check(tok) { if (!P || tok !== P.tok) throw ABORT; }
function pause(ms, tok, skippable = true) {
  return new Promise(res => {
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); if (P && P.waker === done) P.waker = null; res(); }
    if (P && skippable) P.waker = done;
  }).then(() => { if (tok != null) check(tok); });
}

// ---------------- visuals ----------------
function setMode(m) {
  if (!P) return; P.mode = m;
  const it = P.items[P.i];
  const nextIt = P.items[P.i + 1];
  const nm = x => x ? (x.type === "scene" ? x.title : slideName(x.cls)) : "";
  label(m === "title" ? `Live tour ${it.n} of 5 · Next to start` : m === "auto" ? "Showing… (Next skips ahead)" : m === "setup" ? "Getting it ready…"
    : m === "explore" ? `Explore ${it.explore} · Next: ${nm(nextIt)}` : nextIt ? `Next: ${nm(nextIt)}` : "The end");
  P.L.dataset.mode = m;
}
const slideName = c => ({ title: "Intro", safe: "Built safe", what: "What it is", grid: "Also built in", who: "Who it helps", cash: "Savings", soft: "Everything else", next: "What's next", end: "Questions" }[c] || "");
function label(t) { const l = $(".pz-lbl", P.L); if (l) l.textContent = t; }
function dots() { $(".pz-dots", P.L).innerHTML = P.items.map((x, k) => `<i class="${k === P.i ? "on" : k < P.i ? "done" : ""} ${x.type}"></i>`).join(""); }
function block(on) { $(".pz-block", P.L).hidden = !on; }
function veil(it, show) {
  const v = $(".pz-veil", P.L);
  if (!it) { if (!v.hidden) { v.classList.add("out"); setTimeout(() => { v.hidden = true; v.classList.remove("out"); }, 380); } return; }
  $(".pz-card", v).innerHTML = `<div class="pz-kick">Live tour · ${it.n} of 5</div><h2>${it.title}</h2><p>${it.sub}</p><div class="pz-hint">Press <kbd>→</kbd> to start</div>`;
  v.classList.remove("out"); v.hidden = false;
  const c = $(".pz-card", v); c.style.animation = "none"; void c.offsetWidth; c.style.animation = "";
}
function spot(el) { P.target = el; const s = $(".pz-spot", P.L); s.classList.toggle("on", !!el); if (el) place(); }
function cap(el, t, x, pos) {
  const c = $(".pz-cap", P.L);
  if (!el) { c.hidden = true; P.capPos = null; return; }
  c.innerHTML = `<b>${t}</b><p>${x}</p>`; c.hidden = false; P.capPos = pos || "auto";
  c.style.animation = "none"; void c.offsetWidth; c.style.animation = ""; place();
}
function place() {
  if (!P) return;
  const el = P.target, s = $(".pz-spot", P.L), c = $(".pz-cap", P.L);
  if (!el || !el.isConnected) { s.classList.remove("on"); return; }
  const r = el.getBoundingClientRect(), pad = 8;
  const top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad);
  const w = Math.min(innerWidth - left - 4, r.width + pad * 2), h = Math.min(innerHeight - top - 4, r.height + pad * 2);
  Object.assign(s.style, { top: top + "px", left: left + "px", width: w + "px", height: h + "px" });
  if (c.hidden) return;
  const cw = c.offsetWidth, ch = c.offsetHeight;
  let x, y;
  const roomRight = innerWidth - (left + w), roomLeft = left;
  if (P.capPos === "side" || h > innerHeight * 0.55) {
    // tall target: put the caption beside it
    if (roomRight > cw + 24) x = left + w + 16; else if (roomLeft > cw + 24) x = left - cw - 16; else x = innerWidth - cw - 20;
    y = Math.min(Math.max(80, innerHeight / 2 - ch / 2), innerHeight - ch - 90);
  } else {
    x = Math.min(Math.max(16, left), innerWidth - cw - 16);
    y = top + h + 14; if (y + ch > innerHeight - 80) y = Math.max(16, top - ch - 14);
  }
  c.style.left = x + "px"; c.style.top = y + "px";
}
function tick() { if (!P) return; if (P.target) place(); P.raf = requestAnimationFrame(tick); }
function cursor(on) { const c = $(".pz-cursor", P.L); if (!on) { c.hidden = true; return; } c.hidden = false; }
async function moveCursor(el, tok) {
  const c = $(".pz-cursor", P.L), r = el.getBoundingClientRect();
  if (c.hidden) { c.style.transition = "none"; c.style.transform = `translate(${innerWidth * 0.62}px,${innerHeight * 0.78}px)`; c.hidden = false; void c.offsetWidth; c.style.transition = ""; }
  c.style.transform = `translate(${r.left + Math.min(r.width / 2, 60)}px,${r.top + r.height / 2}px)`;
  await pause(reduced() ? 50 : 750, tok, false);
}
function ripple() {
  const c = $(".pz-cursor", P.L); const d = document.createElement("i"); d.className = "pz-rip"; c.append(d); setTimeout(() => d.remove(), 700);
}
let idle;
function wake() { if (!P) return; P.L.classList.remove("idle"); clearTimeout(idle); idle = setTimeout(() => P?.L.classList.add("idle"), 2600); }

// ---------------- print preview (no real print in presentation mode) ----------------
function showPdf(unit) {
  hidePdf();
  const url = A.unitPdfUrl(unit); if (!url) return;
  const d = document.createElement("div"); d.className = "pz-pdf";
  d.innerHTML = `<div class="pz-pdfbar">${ic("print", 16)} <b>${unit}</b> · every note, one print job<span class="sp"></span><button class="btn sm" data-close>Close preview</button></div><iframe src="${url}#view=FitH" title="Print preview"></iframe>`;
  document.body.append(d);
  $("[data-close]", d).onclick = hidePdf;
}
function hidePdf() { $(".pz-pdf")?.remove(); }

// ---------------- offline copy ----------------
// The first time presentation mode opens, the browser keeps a copy of the whole app,
// so later visits load even with bad Wi-Fi. Same files as the live site; no patient data.
async function cacheForOffline() {
  try { if ("serviceWorker" in navigator) await navigator.serviceWorker.register("sw.js"); } catch (e) { console.warn("offline copy unavailable", e); }
}
async function offlineBadge() {
  const b = $("#pzOff"); if (!b) return;
  try {
    const reg = await navigator.serviceWorker?.ready;
    for (let k = 0; k < 40 && P; k++) {
      const keys = (await caches.keys()).filter(n => n.startsWith("notemaker-"));
      const n = keys.length ? (await (await caches.open(keys.at(-1))).keys()).length : 0;
      if (reg?.active && n > 10) { b.innerHTML = `${ic("check", 13)} Saved for offline`; b.classList.add("ok"); return; }
      await new Promise(r => setTimeout(r, 500));
    }
  } catch {}
}
