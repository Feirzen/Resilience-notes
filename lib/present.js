// Presentation mode: a quick guided tour of the demo. Short labels only; the presenter does the talking.
// Fake patients only. It never opens the team folder.
// Keys: → / Space / PageDown next, ← / PageUp back, Esc pauses (a Resume pill stays in the corner).
// Click anywhere in the app mid-tour to explore; → picks the tour back up where it was.
import { ic } from "./icons.js";

let A = null;            // hooks into the app (set by initPresent)
let P = null;            // the running tour
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ABORT = Symbol("abort");
const chev = d => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${d === "l" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"}"/></svg>`;
const skipIc = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5l7 7-7 7M13 5l7 7-7 7"/></svg>`;
const pauseIc = `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>`;
const playIc = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>`;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function initPresent(api) { A = api; }
export const presenting = () => !!P && !P.paused;

// ---------------- the tour ----------------
// Slides are just bookends. Everything else is live in the demo.
// Step kinds: say (spotlight + short label), click (cursor clicks it), tap (cursor taps, then fn runs), fn.
// opt: true means skip quietly if it isn't on screen (depends on the demo's random data).
const DOE = "demo-0";
const slide = (name, cls, html) => ({ type: "slide", name, cls, html });
const TOUR = () => [
  slide("Start", "title", `
    <img class="pz-logo pz-in" src="icons/favicon.svg" alt="" style="--d:0">
    <h1 class="pz-in" style="--d:1">NoteMaker</h1>
    <p class="pz-tag pz-in" style="--d:2">Quick tour · fake patients</p>
    <div class="pz-meta pz-in" style="--d:3"><span id="pzOff" class="pz-off"></span></div>`),
  { type: "scene", name: "Getting in",
    setup: async () => { await A.toStart(); },
    steps: [
      { say: ".bigsites", t: "Pick the hospital" },
      { tap: '.bigsite[data-s="AGBH"]', fn: async () => { await A.enterDemo(); await waitFor("#ov"); } },
      { say: ".top .pill", t: "Demo mode", x: "Every patient is fake." },
    ] },
  { type: "scene", name: "Home",
    setup: async () => { await ensureDemo(); await go("home", "#ov"); },
    steps: [
      { say: ".census", t: "Census and today's admits" },
      { say: ".fuwrap", t: "Follow-ups by unit" },
      { click: "#ovAll", wait: 500 },
      { say: "#ov", t: "All patients", x: "Joey's sheet, kept up as we work." },
      { say: "[data-help=count]", t: "Daily count" },
      { say: "[data-help=pinned]", t: "Pinned notes" },
      { say: "[data-help=ann]", t: "Announcements" },
    ] },
  { type: "scene", name: "Bedboard",
    setup: async () => { await ensureDemo(); await go("board", ".bboard"); },
    steps: [
      { say: ".bboard", t: "Every unit at once", x: "Colored by status." },
      { say: ".bbr .bseen", t: "Seen", opt: true },
      { say: ".bbr .bbill", t: "Billing", opt: true },
      { say: "#bbSet", t: "Your own view" },
      { say: "#bbPrint", t: "One-page printout" },
    ] },
  { type: "scene", name: "A note",
    setup: async () => { await ensureDemo(); await go("unit-TIMP", ".list"); },
    steps: [
      { say: ".list", t: "A unit" },
      { click: `a.it[href="#pt-${DOE}"]`, wait: 400, waitFor: "#paper" },
      { say: "#paper", t: "The note, as it prints", pos: "side" },
      { say: ".glance", t: "Needs attention", opt: true },
      { click: ".glance [data-goto]", wait: 900, opt: true },
      { say: ".pp.hot, #paper .new", t: "Go to", pos: "side", opt: true },
      { say: ".cmtlayer", t: "Margin comments", opt: true },
      { click: "#addP", wait: 500, waitFor: ".modal" },
      { say: ".modal", t: "Add diagnosis", x: "Meds, doses, and the plan fill in.", pos: "side" },
      { fn: async () => { A.closeModals(); await pause(250); } },
      { tap: ".side a:not(.on)", fn: async el => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true })); await waitFor("#otabs .ot:not(.on)", 2000); } },
      { say: "#otabs", t: "Note tabs", x: "Half-done notes stay open." },
    ] },
  { type: "scene", name: "Labs",
    setup: async () => { await ensureDemo(); await go("unit-TIMP", ".list"); },
    steps: [
      { click: "#labsU", wait: 500, waitFor: ".bllist" },
      { say: ".blquick", t: "One line for everyone" },
      { say: ".blpend", t: "Pending labs", opt: true },
      { say: ".bldx", t: "Plan changes by diagnosis" },
    ] },
  { type: "scene", name: "Billing",
    setup: async () => { await ensureDemo(); await go("unit-TIMP", ".list"); },
    steps: [
      { click: "#bill", wait: 500, waitFor: ".btab" },
      { say: ".btab", t: "Today's billing", x: "Goes straight to Home." },
      { say: ".ekgb", t: "EKG" },
      { say: ".bchips", t: "Any unit, or all" },
    ] },
  { type: "scene", name: "Print",
    setup: async () => { await ensureDemo(); await go("unit-TIMP", ".list"); },
    steps: [
      { click: "#prn", wait: 500, waitFor: "#pP" },
      { say: "#pP", t: "Provider" },
      { say: "label:has(#pSig)", t: "Signed page on top" },
      { say: ".modal .mb", t: "Last check", x: "Missing vitals, open flags, H&Ps.", pos: "side" },
      { fn: async () => { A.closeModals(); await pause(300); showPdf("TIMP"); await pause(900); } },
      { say: ".pz-pdf iframe", t: "One print job", pos: "side" },
    ] },
  { type: "scene", name: "Prep",
    setup: async () => { hidePdf(); await A.enterDemo(); await go("unit-TIMP", ".list"); },
    steps: [
      { say: "#prep", t: "Prep for tomorrow" },
      { click: "#prep", wait: 600, waitFor: ".modal .lbl", timeout: 20000 },
      { say: ".modal", t: "Only what changed", pos: "side" },
      { click: ".modal .mfoot .btn.p", wait: 700 },
      { say: "#main .al", t: "Whole unit ready" },
      { click: `a.it[href="#pt-${DOE}"]`, wait: 500, waitFor: "#paper" },
      { say: "#paper", t: "Tomorrow's note", pos: "side" },
    ] },
  slide("Also in there", "more", `
    <h2 class="pz-in" style="--d:0">Also in there</h2>
    <div class="pz-chips">${[
      ["people", "Two computers, one note"], ["vitals", "Vital alerts"], ["hp", "H&amp;P form"], ["folder", "Old notes"],
      ["shield", "Supervisor tools"], ["history", "Edit history"], ["help", "Help on every page"], ["palette", "Themes"],
    ].map(([i, t], k) => `<span class="pz-in" style="--d:${1 + k * 0.4}">${ic(i, 18)}${t}</span>`).join("")}</div>`),
  slide("Good to know", "safe", `
    <h2 class="pz-in" style="--d:0">Good to know</h2>
    <ul class="pz-good">
      <li class="pz-in" style="--d:1">${ic("shield", 22)}No AI. Just rules.</li>
      <li class="pz-in" style="--d:2">${ic("lock", 22)}Stays on hospital computers.</li>
      <li class="pz-in" style="--d:3">${ic("monitor", 22)}Runs in Edge. Nothing to install.</li>
    </ul>`),
  slide("End", "end", `
    <img class="pz-logo pz-in" src="icons/favicon.svg" alt="" style="--d:0">
    <h1 class="pz-in" style="--d:1">That's it</h1>
    <button class="pz-cta pz-in" style="--d:2" data-pzexit>Play with the demo</button>`),
];

// ---------------- start / pause / stop ----------------
export async function startPresentation() {
  if (!A) return;
  if (P) { if (P.paused) resume(); return; }
  cacheForOffline();
  P = { items: TOUR(), i: 0, s: 0, mode: "", tok: 0, waker: null, paused: false };
  const L = document.createElement("div"); L.className = "pz"; L.innerHTML = `
    <div class="pz-block" hidden></div>
    <div class="pz-spot"></div><div class="pz-cap" hidden></div>
    <div class="pz-cursor" hidden><svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l15 9.5-6.6 1.3 4 7.6-2.9 1.5-4-7.6L4 19z" fill="#fff" stroke="#0f1726" stroke-width="1.6" stroke-linejoin="round"/></svg></div>
    <div class="pz-slide" hidden></div>
    <div class="pz-menu" hidden></div>
    <div class="pz-dock">
      <button data-pz="b" title="Back (←)">${chev("l")}</button>
      <button class="pz-name" data-pz="m" title="Jump to a part"><b></b><span class="pz-dots"></span></button>
      <button data-pz="n" class="pz-next" title="Next (→ or Space)">${chev("r")}</button>
      <button data-pz="s" class="pz-skip" title="Skip this part">${skipIc}</button>
      <button data-pz="p" title="Pause (Esc)">${pauseIc}</button>
    </div>`;
  const pill = document.createElement("div"); pill.className = "pz-pill"; pill.hidden = true;
  pill.innerHTML = `<button class="pz-res" title="Resume the tour">${playIc}<span>Resume tour</span><small></small></button><button class="pz-end" title="End the tour">${ic("x", 13)}</button>`;
  document.body.append(L, pill); P.L = L; P.pill = pill;
  $$("[data-pz]", L).forEach(b => b.onclick = e => { e.stopPropagation(); ({ n: next, b: back, s: skip, p: pauseTour, m: toggleMenu })[b.dataset.pz](); });
  L.addEventListener("click", e => { if (e.target.closest("[data-pzexit]")) pauseTour(); });
  $(".pz-res", pill).onclick = resume; $(".pz-end", pill).onclick = stop;
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointerdown", onPagePointer, true);
  document.addEventListener("mousemove", wake);
  P.raf = requestAnimationFrame(tick);
  document.body.classList.add("presenting");
  try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch {}
  await enter(0);
}
// Pause: the overlay goes away, a small pill stays in the corner. The app works normally underneath.
function pauseTour() {
  if (!P || P.paused) return;
  P.tok++; P.waker?.(); P.paused = true;
  spot(null); cap(null); cursor(false); block(false); menu(false); hidePdf();
  P.L.hidden = true; document.body.classList.remove("presenting");
  $("small", P.pill).textContent = P.items[P.i].name; P.pill.hidden = false;
}
function resume() {
  if (!P || !P.paused) return;
  P.paused = false; P.pill.hidden = true; P.L.hidden = false; document.body.classList.add("presenting");
  const it = P.items[P.i];
  enter(P.i, it.type === "scene" ? P.s : 0);
}
export function stop() {
  if (!P) return;
  P.tok++; P.waker?.();
  cancelAnimationFrame(P.raf); P.L.remove(); P.pill.remove(); hidePdf();
  document.body.classList.remove("presenting");
  document.removeEventListener("keydown", onKey, true);
  document.removeEventListener("pointerdown", onPagePointer, true);
  document.removeEventListener("mousemove", wake);
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  P = null;
}

// ---------------- moving around ----------------
// enter(i, s): open part i and land on step s. Getting to step s replays the earlier steps instantly,
// so it works the same whether you came from the start, went back, jumped, or wandered off and came back.
async function enter(i, s = 0) {
  if (!P || i < 0 || i >= P.items.length) return;
  const tok = ++P.tok; P.waker?.(); P.i = i; P.s = 0;
  spot(null); cap(null); cursor(false); menu(false); hidePdf();
  const it = P.items[i], sl = $(".pz-slide", P.L);
  try {
    if (it.type === "slide") {
      block(false); setMode("slide");
      sl.className = `pz-slide s-${it.cls}`; sl.innerHTML = `<div class="pz-inner">${it.html}</div>`; sl.hidden = false;
      if (it.cls === "title") offlineBadge();
      return;
    }
    sl.hidden = true; setMode("busy"); block(true);
    await it.setup?.(); check(tok);
    for (let k = 0; k < s && k < it.steps.length; k++) { await step(it.steps[k], tok, true); check(tok); }
    await run(s, tok);
  } catch (e) { if (e !== ABORT) { console.error(e); block(false); setMode("explore"); } }
}
// Play steps from `from` until the next label, then wait for the presenter.
async function run(from, tok) {
  const it = P.items[P.i];
  setMode("busy"); block(true);
  for (let k = from; k < it.steps.length; k++) {
    const st = it.steps[k];
    if (st.say) {
      const el = await waitFor(st.say, st.opt ? 1500 : (st.timeout || 6000)); check(tok);
      if (!el) { if (!st.opt) console.warn("presentation: couldn't find", st.say); continue; }
      await showSay(el, st, tok);
      P.s = k; block(false); setMode("say");
      return;
    }
    await step(st, tok, false); check(tok);
  }
  // nothing left to show in this part
  P.s = it.steps.length; block(false); spot(null); cap(null); cursor(false); setMode("explore");
}
function next() {
  if (!P || P.paused) return;
  const it = P.items[P.i];
  if (P.mode === "busy") { P.waker?.(); return; }        // hurry the current animation along
  if (P.mode === "slide") return enter(P.i + 1);
  if (P.mode === "explore") {                              // came back from clicking around
    return P.s + 1 < (it.steps?.length || 0) ? enter(P.i, P.s + 1) : enter(P.i + 1);
  }
  // showing a label: play on to the next one, or the next part
  const rest = it.steps.slice(P.s + 1);
  if (!rest.some(x => x.say)) return enter(P.i + 1);
  run(P.s + 1, ++P.tok).catch(e => { if (e !== ABORT) console.error(e); });
}
function back() {
  if (!P || P.paused || P.mode === "busy") return;
  const it = P.items[P.i];
  if (it.type === "scene" && P.mode !== "slide") {
    let k = P.s - 1; while (k >= 0 && !it.steps[k].say) k--;
    if (k >= 0) {
      // only labels in between: just move the spotlight back, no replay
      const between = it.steps.slice(k + 1, P.s);
      if (P.mode === "say" && between.every(x => x.say)) {
        const st = it.steps[k], el = $$(st.say).find(vis);
        if (el) { const tok = ++P.tok; P.s = k; showSay(el, st, tok).catch(() => {}); setMode("say"); return; }
      }
      return enter(P.i, k);
    }
  }
  if (P.i > 0) enter(P.i - 1);
}
function skip() { if (P && !P.paused && P.i < P.items.length - 1) enter(P.i + 1); }
function onKey(e) {
  if (!P || P.paused) return;
  const typing = e.target.closest?.("input,textarea,select,[contenteditable]");
  if (["ArrowRight", "PageDown"].includes(e.key) || (e.key === " " && !typing)) { if (typing && e.key === "ArrowRight") return; e.preventDefault(); e.stopPropagation(); next(); }
  else if (["ArrowLeft", "PageUp"].includes(e.key) && !typing) { e.preventDefault(); e.stopPropagation(); back(); }
  else if (e.key === "Escape") {
    if (!$(".pz-menu", P.L).hidden) { e.stopPropagation(); return menu(false); }
    if ($(".scrim") || $(".tray")) return;                // let the app close its own window first
    if ($(".pz-pdf")) { e.stopPropagation(); return hidePdf(); }
    e.stopPropagation(); pauseTour();
  }
}
// Clicking the app mid-tour: drop the spotlight and let the presenter explore. → picks it back up.
function onPagePointer(e) {
  if (!P || P.paused || P.mode !== "say") return;
  if (e.target.closest(".pz-dock,.pz-menu,.pz-pill")) return;
  spot(null); cap(null); setMode("explore");
}

// ---------------- one tour step ----------------
// fast = replaying to get back to a spot: no cursor, no waiting, labels skipped.
async function step(s, tok, fast) {
  if (s.say) return;
  if (s.fn && !s.tap) { await s.fn(); check(tok); return; }
  const sel = s.click || s.tap;
  const el = await waitFor(sel, s.opt ? 1500 : (s.timeout || 6000)); check(tok);
  if (!el) { if (!s.opt) console.warn("presentation: couldn't find", sel); return; }
  if (!fast) {
    el.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
    await pause(400, tok);
    spot(el); cap(null);
    await moveCursor(el, tok);
    ripple();
    await pause(180, tok);
  }
  if (s.click) el.click(); else await s.fn?.(el);
  check(tok);
  if (s.waitFor) await waitFor(s.waitFor, s.timeout || 8000);
  await pause(fast ? 120 : (s.wait || 400), tok);
  if (!fast) spot(null);
}
async function showSay(el, s, tok) {
  const r0 = el.getBoundingClientRect(), beh = reduced() ? "auto" : "smooth";
  if (r0.height > innerHeight * 0.6 && !el.closest(".scrim,.pz-pdf")) window.scrollTo({ top: Math.max(0, scrollY + r0.top - 110), behavior: beh });
  else el.scrollIntoView({ behavior: beh, block: "center" });
  cursor(false);
  await pause(380, tok);
  // windows the tour opens grab the keyboard; let go so → keeps working (clicking in counts as exploring)
  if (document.activeElement?.matches?.("input,textarea,select,[contenteditable]")) document.activeElement.blur();
  spot(el); cap(el, s.t, s.x, s.pos);
}

// ---------------- page helpers ----------------
const vis = x => x.offsetParent !== null || x.getClientRects().length;
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
    const el = $$(sel).find(vis);
    if (el) return el;
    await new Promise(r => setTimeout(r, 80));
  }
  return null;
}
function check(tok) { if (!P || P.paused || tok !== P.tok) throw ABORT; }
function pause(ms, tok) {
  return new Promise(res => {
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); if (P && P.waker === done) P.waker = null; res(); }
    if (P) P.waker = done;
  }).then(() => { if (tok != null) check(tok); });
}

// ---------------- dock and menu ----------------
function setMode(m) {
  if (!P) return; P.mode = m; P.L.dataset.mode = m;
  const it = P.items[P.i];
  $(".pz-name b", P.L).textContent = m === "explore" && it.type === "scene" ? `${it.name} · → to continue` : it.name;
  const says = it.type === "scene" ? it.steps.map((x, k) => [x, k]).filter(([x]) => x.say) : [];
  $(".pz-dots", P.L).innerHTML = says.length > 1 ? says.map(([, k]) => `<i class="${k === P.s ? "on" : k < P.s ? "done" : ""}"></i>`).join("") : "";
  $(".pz-skip", P.L).disabled = P.i >= P.items.length - 1;
}
function toggleMenu() { menu($(".pz-menu", P.L).hidden); }
function menu(on) {
  if (!P) return;
  const m = $(".pz-menu", P.L);
  if (!on) { m.hidden = true; return; }
  m.innerHTML = P.items.map((x, k) => `<button data-k="${k}" class="${k === P.i ? "on" : ""}"><i>${k + 1}</i>${x.name}</button>`).join("");
  $$("[data-k]", m).forEach(b => b.onclick = e => { e.stopPropagation(); enter(+b.dataset.k); });
  m.hidden = false;
}

// ---------------- visuals ----------------
function block(on) { $(".pz-block", P.L).hidden = !on; }
function spot(el) { P.target = el; const s = $(".pz-spot", P.L); s.classList.toggle("on", !!el); if (el) place(); }
function cap(el, t, x, pos) {
  const c = $(".pz-cap", P.L);
  if (!el) { c.hidden = true; P.capPos = null; return; }
  c.innerHTML = `<b>${t}</b>${x ? `<p>${x}</p>` : ""}`; c.hidden = false; P.capPos = pos || "auto";
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
  await pause(reduced() ? 50 : 700, tok);
}
function ripple() {
  const c = $(".pz-cursor", P.L); const d = document.createElement("i"); d.className = "pz-rip"; c.append(d); setTimeout(() => d.remove(), 700);
}
let idle;
function wake() { if (!P) return; P.L.classList.remove("idle"); clearTimeout(idle); idle = setTimeout(() => P?.L.classList.add("idle"), 3000); }

// ---------------- print preview (no real print in presentation mode) ----------------
function showPdf(unit) {
  hidePdf();
  const url = A.unitPdfUrl(unit); if (!url) return;
  const d = document.createElement("div"); d.className = "pz-pdf";
  d.innerHTML = `<div class="pz-pdfbar">${ic("print", 16)} <b>${unit}</b><span class="sp"></span><button class="btn sm" data-close>Close preview</button></div><iframe src="${url}#view=FitH" title="Print preview"></iframe>`;
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
