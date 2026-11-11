// NoteMaker: the screens. Rules live in engine/, Word/PDF/folders in lib/.
import * as E from "./engine/engine.js";
import { UNITS, PROVIDERS, PE_LINES, TAPERS, blocksFor, progressBlocks } from "./lib/layout.js";
import { toDocx } from "./lib/docx-out.js";
import { readDocx } from "./lib/docx-in.js";
import { toPdf } from "./lib/pdf-out.js";
import { boardPdf, STATUS as BSTAT } from "./lib/board-pdf.js";
import { mergePatient, applyTheirs } from "./lib/merge.js";
import { holidayFor, markFor, byKey as hByKey, PREVIEW as HPREVIEW } from "./lib/holidays.js";
import { Store, supported } from "./lib/store.js";
import { demoPatients } from "./lib/demo.js";
import { MED_NAMES, findMed } from "./lib/meds.js";
import { ic } from "./lib/icons.js";
import { initPresent, startPresentation, presenting } from "./lib/present.js";

// ---------------- state & helpers ----------------
const localToday = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const S = { store: null, pts: [], today: localToday(), date: localToday(), viewDate: null, rules: { dx: {}, wording: [] }, overrides: {}, settings: { scribes: [] }, provider: "", open: null, pending: null, regrant: null };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const md = E.md;
const uid = () => Math.random().toString(36).slice(2, 9);
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const byName = (a, b) => a.name.localeCompare(b.name);
const active = pt => pt.status !== "discharged";
const unitPts = u => S.pts.filter(p => p.unit === u && active(p)).sort(byName);
const findPt = id => S.pts.find(p => p.id === id);

function toast(msg, ms = 2400) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.append(t); setTimeout(() => t.remove(), ms);
}
function modal(title, body, foot = "", wide = false) {
  const s = document.createElement("div"); s.className = "scrim";
  s.innerHTML = `<div class="modal ${wide ? "wide" : ""}" role="dialog"><div class="mh">${title}<span class="sp"></span><button class="btn sm" data-x style="background:transparent;color:inherit;border-color:rgba(255,255,255,.25)">Close</button></div><div class="mb">${body}</div>${foot ? `<div class="mfoot">${foot}</div>` : ""}</div>`;
  const close = async (force) => {
    if (force !== true && s.dirty && !(await ask("Unsaved changes", "You typed something here that isn't saved yet. Close without saving?", "Close without saving"))) return;
    s.remove(); s.onclose?.();
  };
  s.addEventListener("input", e => { if (!e.target.closest("[data-nodirty]")) s.dirty = true; });
  s.addEventListener("click", e => { if (e.target.closest(".mfoot .btn.p")) s.dirty = false; }, true);   // the Save button
  s.addEventListener("click", e => { if (e.target === s || e.target.closest("[data-x]")) close(); });
  document.body.append(s); s.close = close; return s;
}
// Busy feedback: the button shows a spinner and can't be pressed twice.
async function busy(btn, fn) {
  if (!btn || btn.dataset.busy) return;
  btn.dataset.busy = "1"; const html = btn.innerHTML; btn.disabled = true;
  btn.innerHTML = `<span class="spin"></span>${html}`;
  try { return await fn(); }
  catch (e) { console.error(e); showError(e); }
  finally { if (btn.isConnected) { btn.innerHTML = html; btn.disabled = false; delete btn.dataset.busy; } }
}
// Full-screen progress for longer jobs (prep, import, print).
function progress(title) {
  const s = document.createElement("div"); s.className = "scrim";
  s.innerHTML = `<div class="modal" style="max-width:380px"><div class="mb" style="text-align:center;padding:26px 20px"><div class="spin big"></div><div style="font-weight:600;margin-top:14px">${title}</div><div class="muted" id="pgT" style="margin-top:6px">&nbsp;</div><div class="bar2"><i id="pgB"></i></div></div></div>`;
  document.body.append(s);
  return { set(text, frac) { $("#pgT", s).textContent = text; if (frac != null) $("#pgB", s).style.width = Math.round(frac * 100) + "%"; }, close() { s.remove(); } };
}
function showError(e) {
  modal("Something went wrong", `<p class="muted" style="font-size:14px">${esc(e?.message || e)}</p><p class="muted" style="margin-top:8px">Nothing was lost. Try again; if it keeps happening, raise a flag with what you clicked.</p>`, `<button class="btn p" data-x>OK</button>`);
}
const ask = (title, text, yes = "OK", no = "Cancel") => new Promise(res => {
  const m = modal(title, `<p class="muted" style="font-size:14px">${text}</p>`, `<button class="btn" data-x>${no}</button><button class="btn p" data-yes>${yes}</button>`);
  m.onclose = () => res(false); $("[data-yes]", m).onclick = () => { m.onclose = null; m.remove(); res(true); };
});

// ---------------- rulebook & flags ----------------
// Team rules live in the team folder, so every computer uses the same ones.
const dHpi = (pt, p, d) => E.applyRules(E.defaultHpi(pt, p, d, S.rules), p, "hpi", S.rules);
const dPlan = (pt, p, d) => E.applyRules(E.defaultPlan(pt, p, d), p, "plan", S.rules);
function rulebook() {
  const rb = E.learn({}, S.pts.filter(active));
  for (const [k, v] of Object.entries(S.rules.dx || {})) rb[k] = { ...(rb[k] || { seen: 0 }), ...v };
  return rb;
}
async function loadRules() {
  const r = await S.store.getShared("rulebook.json", {});
  S.rules = r.dx || r.wording || r.pending ? { dx: r.dx || {}, wording: r.wording || [], pending: r.pending || [] } : { dx: r, wording: [], pending: [] };   // older files were just the dx list
}
const saveRules = () => S.store.setShared("rulebook.json", S.rules);
// Labs waiting on a result, read from the note itself ("will order CMP", "TSH pending", "recheck BMP").
const LABS = ["CBC with diff", "CBC", "CMP", "BMP", "TSH", "free T4", "T4", "T3", "Hgb A1c", "HbA1c", "A1c", "lipid panel", "urinalysis", "UA", "urine culture", "UDS", "urine drug screen",
  "NT-proBNP", "BNP", "vitamin D", "B12", "folate", "iron studies", "ferritin", "LFTs", "LFT", "lipase", "amylase", "magnesium", "phosphorus", "potassium", "ammonia", "CK", "troponin",
  "EKG", "ECG", "chest x-ray", "chest xray", "CXR", "x-ray", "xray", "CT", "MRI", "ultrasound", "hCG", "pregnancy test", "HIV", "RPR", "hepatitis panel", "ESR", "CRP", "INR",
  "lithium level", "depakote level", "valproic acid level", "prolactin", "cortisol", "blood culture", "wound culture", "strep test", "COVID test", "flu test", "ALT", "AST"];
const LAB_RE = new RegExp("\\b(" + LABS.map(x => x.replace(/[-/]/g, "\\$&")).join("|") + ")\\b", "gi");
const WAIT_RE = /\b(order(?:ed|ing)?|re-?order(?:ed)?|pending|re-?check(?:ed|ing)?|check(?:ed|ing)?|will obtain|obtain(?:ed)?|drawn|sent)\b/i;
function pendingLabs(pt, date = S.today) {
  const since = E.addDays(date, -30), out = new Map();
  const results = (pt.labs || []).map(l => ({ d: l.date, t: (l.text + " " + (l.bullets || []).join(" ")).toLowerCase() }));
  for (const q of pt.problems) {
    if (q.resolved && q.resolved < date) continue;
    const src = [...(q.start >= since && q.planOpen ? [{ date: q.start, text: q.planOpen }] : []), ...q.plan, ...q.hpi].filter(e => e.date >= since && e.date <= date);
    for (const e of src) for (const seg of String(e.text).split(/[.;]/)) {
      if (!WAIT_RE.test(seg) || /\b(reviewed|resulted|results?|wnl|normal)\b/i.test(seg)) continue;
      for (const m of seg.matchAll(LAB_RE)) { const k = m[1].toUpperCase(); if (!out.has(k) || out.get(k).since > e.date) out.set(k, { name: m[1], dx: q.name, problemId: q.id, since: e.date }); }
    }
  }
  for (const n of pt.pendingLabs || []) if (!out.has(n.toUpperCase())) out.set(n.toUpperCase(), { name: n, since: "0000" });
  return [...out.values()].filter(x => !results.some(r => r.d >= x.since && r.t.includes(x.name.toLowerCase())));
}
// Abnormal vitals: each person sets their own limits (gear > Vital alerts). Blank = no alert for that one.
const VLIM = [["sbpHi", "Systolic BP above", 160], ["sbpLo", "Systolic BP below", 90], ["dbpHi", "Diastolic BP above", 100], ["hrHi", "Pulse above", 110], ["hrLo", "Pulse below", 50],
  ["tempHi", "Temp at or above", 100.4], ["o2Lo", "O2 sat below", 92], ["bgHi", "BG above", 250], ["bgLo", "BG below", 70]];
const myLimits = () => ({ ...Object.fromEntries(VLIM.map(([k, , d]) => [k, d])), ...(S.settings?.vitalLimits?.[S.user?.id || "me"] || {}) });
function vitalFlags(pt, date) {
  const v = pt.vitals?.[date]; if (!v) return [];
  const L = myLimits(), out = [], num = x => { const n = parseFloat(String(x ?? "").replace(/[^\d.]/g, "")); return isNaN(n) ? null : n; };
  const has = k => L[k] !== "" && L[k] != null;
  const tie = key => pt.problems.find(q => q.autoVital === key && !(q.resolved && q.resolved < date))?.id;
  const [sbp, dbp] = String(v.bp || "").split("/").map(num);
  if (sbp != null && ((has("sbpHi") && sbp > L.sbpHi) || (has("sbpLo") && sbp < L.sbpLo) || (has("dbpHi") && dbp > L.dbpHi)))
    out.push({ level: "amber", problemId: tie("bp"), text: `BP ${v.bp} (${sbp < L.sbpLo ? "low" : "high"})` });
  const hr = num(v.hr); if (hr != null && ((has("hrHi") && hr > L.hrHi) || (has("hrLo") && hr < L.hrLo))) out.push({ level: "amber", text: `Pulse ${v.hr} (${hr < L.hrLo ? "low" : "high"})` });
  const t = num(v.temp); if (t != null && has("tempHi") && t >= L.tempHi) out.push({ level: "amber", text: `Temp ${v.temp}` });
  const o2 = num(v.o2); if (o2 != null && has("o2Lo") && o2 < L.o2Lo) out.push({ level: "amber", text: `O2 sat ${v.o2}%` });
  const bg = num(v.bg); if (bg != null && ((has("bgHi") && bg > L.bgHi) || (has("bgLo") && bg < L.bgLo))) out.push({ level: "amber", problemId: tie("bg"), text: `BG ${v.bg} (${bg < L.bgLo ? "low" : "high"})` });
  return out;
}
function vitalLimitsModal() {
  const L = myLimits();
  const m = modal(`${ic("vitals")} Vital alerts`, `<p class="muted" style="margin-bottom:10px">Your own limits. A vital outside them shows as a flag on the note and before printing. Leave a box empty to turn that alert off.</p>
    <div class="vlim">${VLIM.map(([k, n, d]) => `<label class="f"><span>${n}</span><input data-k="${k}" value="${esc(L[k] ?? "")}" placeholder="off" inputmode="decimal"><small class="muted">default ${d}</small></label>`).join("")}</div>`,
    `<button class="btn" id="vlReset">Back to defaults</button><span class="sp"></span><button class="btn" data-x>Cancel</button><button class="btn p" id="vlGo">Save</button>`);
  $("#vlReset", m).onclick = () => $$("[data-k]", m).forEach(i => i.value = VLIM.find(x => x[0] === i.dataset.k)[2]);
  $("#vlGo", m).onclick = e => busy(e.currentTarget, async () => {
    const mine = {}; $$("[data-k]", m).forEach(i => { const t = i.value.trim(); mine[i.dataset.k] = t === "" ? "" : parseFloat(t); });
    if (S.store) { const fresh = await S.store.getShared("settings.json", S.settings); fresh.vitalLimits = { ...(fresh.vitalLimits || {}), [S.user?.id || "me"]: mine }; S.settings = { ...S.settings, vitalLimits: fresh.vitalLimits }; await S.store.setShared("settings.json", { ...fresh }); }
    m.close(true); toast("Vital alerts saved"); route();
  });
}
function flagsFor(pt, date = S.today) {
  const done = pt.addressed?.[date] || [];
  const extra = pt.problems.filter(q => q.start <= date && !(q.resolved && q.resolved < date) && isDiabetes(q.name) && onInsulin(q) === undefined)
    .map(q => ({ level: "amber", problemId: q.id, text: `Taking insulin? (${q.name})` }));
  const week = E.addDays(date, -7);
  const labs = pendingLabs(pt, date).map(x => x.since !== "0000" && x.since <= week
    ? { level: "red", problemId: x.problemId, text: `${x.name} pending since ${md(x.since)}: was it ordered?` }
    : { level: "amber", problemId: x.problemId, text: `${x.name} pending` });
  extra.push(...vitalFlags(pt, date));
  if (pt.clashes?.length) extra.push({ level: "amber", text: `Two versions to pick between (${pt.clashes.length})` });
  const live = pt.problems.filter(q => q.start <= date && !(q.resolved && q.resolved < date));
  const all = [...E.flags(pt, date, rulebook()).filter(f => !/pending$/i.test(f.text)), ...extra, ...labs].filter(f => !done.includes(f.text));
  // Med flags ("Augmentin last dose today") sometimes come without a diagnosis; tie them to the diagnosis that has that med.
  for (const f of all) if (!f.problemId) {
    const lo = f.text.toLowerCase(), q = live.find(q => q.meds.some(m => m.name && lo.startsWith(m.name.toLowerCase().split(/\s+/)[0])));
    if (q) f.problemId = q.id;
  }
  return all;
}
const popts = o => ({ providers: providerNames(), ...o });
const loud = fs => fs.filter(f => f.level === "red" || f.level === "amber");
const editedToday = (pt, p) => [...p.hpi, ...p.plan].some(e => e.date >= S.today && e.text !== e.auto);

// ---------------- saving ----------------
// Every save goes in a queue: the note's data first, then its Word file in the background.
// A banner shows "Saving… 2 of 5" so you can keep working but won't close the tab mid-save.
// If something takes too long or fails, the banner turns red with Keep trying / Retry / Undo.
const timers = {}, queue = {}, conflicts = new Set();
const BASE = new Map();                       // the version of each note this computer last loaded or saved (for merging)
const setBase = pt => BASE.set(pt.id, structuredClone(pt));
const enqueue = (pt, job) => (queue[pt.id] = (queue[pt.id] || Promise.resolve()).then(job).catch(e => { console.error(e); }));
const SV = { total: 0, done: 0, pending: new Set(), failed: new Map(), good: new Map(), slow: false };
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} took too long`)), ms))]);
function track(id) {
  if (SV.pending.has(id)) return;
  if (!SV.pending.size && !SV.failed.size) { SV.total = 0; SV.done = 0; }
  SV.pending.add(id); SV.total++; saveBanner();
}
function finish(pt) { SV.good.set(pt.id, structuredClone(pt)); if (SV.pending.delete(pt.id)) SV.done++; saveBanner(); }
function fail(pt, e, stage) { SV.pending.delete(pt.id); SV.failed.set(pt.id, { pt, e, stage }); console.warn("save failed", pt.name, e); saveBanner(); }
function save(pt) { return saveNow(pt); }
// If a save for this patient is already waiting its turn, it will write the newest version anyway, so don't queue a second one.
const waiting = new Map();
function saveNow(pt, { docx = true, why = "Edited note" } = {}) {
  clearTimeout(timers[pt.id]);
  logEdit(pt, why); SV.failed.delete(pt.id); pinTab(pt.id, why);
  const w = waiting.get(pt.id);
  if (w) { if (docx) w.docx = true; return w.promise; }
  track(pt.id);
  const job = { docx };
  waiting.set(pt.id, job);
  return job.promise = enqueue(pt, async () => {
    waiting.delete(pt.id); docx = job.docx;
    pt.updated = Date.now();
    try { const r = await withTimeout(S.store.savePatient(pt), SV.slow ? 60000 : 15000, "Saving the note"); if (r === "conflict") { SV.pending.delete(pt.id); saveBanner(); return conflict(pt, docx); } setBase(pt); }
    catch (e) { return fail(pt, e, "data"); }
    if (docx) queueDocx(pt, true); else finish(pt);
  });
}
// Light edit history: who, when, what. The supervisor sees it in Supervisor tools.
function logEdit(pt, what) {
  if (!what) return;
  const by = S.user?.name || "Unknown", last = pt.log?.at(-1);
  if (last && last.by === by && last.what === what && Date.now() - last.at < 120000) { last.at = Date.now(); return; }
  (pt.log ||= []).push({ by, at: Date.now(), what }); if (pt.log.length > 300) pt.log.splice(0, pt.log.length - 300);
}
// Run jobs a few at a time (network drives are faster in parallel, but not unlimited).
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }
// Another computer saved this note after we loaded it. Merge both sets of edits; only real clashes
// (the same entry changed two different ways) need a person, and those can wait ("decide later" flags the note).
async function conflict(pt, docx = true) {
  if (conflicts.has(pt.id)) return; conflicts.add(pt.id);
  try {
    const theirs = await S.store.reloadPatient(pt.id);
    if (!theirs) { await S.store.savePatient(pt, true); setBase(pt); return; }
    const who = theirs.log?.at(-1)?.by || "someone else";
    const { merged, clashes } = mergePatient(BASE.get(pt.id), pt, theirs);
    for (const k of Object.keys(pt)) delete pt[k]; Object.assign(pt, merged, { rev: theirs.rev });
    if (clashes.length) pt.clashes = [...(pt.clashes || []), ...clashes.map(c => ({ ...c, by: who, at: Date.now() }))];
    track(pt.id); await S.store.savePatient(pt); setBase(theirs);
    if (docx) queueDocx(pt, true); else finish(pt);
    toast(clashes.length ? `${pt.name}: ${who} saved at the same time. ${clashes.length} spot${clashes.length > 1 ? "s" : ""} to pick.` : `${pt.name}: merged with ${who}'s save`, 3200);
    if (S.snap?.id === pt.id) S.snap = { id: pt.id, data: structuredClone(pt), dirty: false };
    if (clashes.length) reconcileModal(pt); else if (location.hash === "#pt-" + pt.id && !S.open) route();
  } catch (e) { fail(pt, e, "data"); }
  finally { conflicts.delete(pt.id); }
}
function reconcileModal(pt) {
  const cs = pt.clashes || []; if (!cs.length) return;
  const show = v => typeof v === "string" ? esc(v) : v == null ? `<span class="muted">(removed)</span>` : esc(v.text ?? v.name ?? JSON.stringify(v));
  const m = modal(`Two versions of ${esc(pt.name)}`, `<div data-nodirty><p class="muted" style="margin-bottom:10px">This note was saved on two computers at the same time and these spots were changed both ways. Everything else was combined. Pick which wording stays.</p>
    ${cs.map((c, i) => `<div class="rc"><div class="rcl">${esc(c.label)}</div><div class="rcg">
      <label class="rco"><input type="radio" name="rc${i}" value="mine" checked><span><b>This computer</b>${show(c.mine)}</span></label>
      <label class="rco"><input type="radio" name="rc${i}" value="theirs"><span><b>${esc(c.by || "Other computer")}</b>${show(c.theirs)}</span></label></div></div>`).join("")}</div>`,
    `<button class="btn" id="rcLater" title="Keeps this computer's version for now and flags the note">Decide later</button><span class="sp"></span><button class="btn p" id="rcGo">Use these</button>`, true);
  $("#rcLater", m).onclick = () => { m.close(true); route(); };
  $("#rcGo", m).onclick = e => busy(e.currentTarget, async () => {
    cs.forEach((c, i) => { if ($(`input[name="rc${i}"]:checked`, m)?.value === "theirs") applyTheirs(pt, c); });
    delete pt.clashes; m.close(true); await saveNow(pt, { why: "Picked between two versions" }); toast("Done"); route();
  });
}
// While a note is open, check every 15 seconds whether another computer saved it. If you're not mid-edit,
// it quietly refreshes; if you are, your next save merges both.
setInterval(async () => {
  if (document.visibilityState !== "visible" || !S.store || !location.hash.startsWith("#pt-")) return;
  const id = location.hash.slice(4), pt = findPt(id); if (!pt || conflicts.has(id)) return;
  if ((S.snap?.id === id && S.snap.dirty) || SV.pending.has(id) || waiting.has(id) || S.open || $(".scrim")) return;
  try {
    const rev = await S.store.peekRev(id); if (rev <= (S.store.revs[id] || 0)) return;
    const fresh = await S.store.reloadPatient(id); if (!fresh) return;
    for (const k of Object.keys(pt)) delete pt[k]; Object.assign(pt, fresh); setBase(pt);
    if (location.hash === "#pt-" + id && !S.open) { route(); toast(`Updated: ${fresh.log?.at(-1)?.by || "someone"} saved a newer version`, 2400); }
  } catch {}
}, 15000);
const lastDate = pt => pt.problems.flatMap(p => [...p.hpi, ...p.plan]).reduce((a, e) => e.date > a ? e.date : a, S.today);
const noteDate = pt => S.viewDate || (pt.status === "admit" ? S.today : lastDate(pt));
async function docxTarget(pt) {
  const unitDir = await S.store.unitDir(pt.unit, true);
  if (pt.status === "admit") return { dir: S.store.root, name: `${pt.file} ADMIT.docx` };
  return { dir: unitDir, name: `${pt.file}.docx` };
}
const docxQ = new Map(); let docxRunning = false;
function queueDocx(pt, tracked) { if (!tracked) track(pt.id); docxQ.set(pt.id, pt); saveBanner(); if (!docxRunning) runDocx(); }
async function runDocx() {
  docxRunning = true;
  while (docxQ.size) {
    const [id, pt] = docxQ.entries().next().value; docxQ.delete(id);
    try { await withTimeout(writeDocx(pt), SV.slow ? 90000 : 25000, "Writing the Word file"); finish(pt); }
    catch (e) { fail(pt, e, "word"); }
  }
  docxRunning = false; saveBanner();
}
function saveBanner() {
  $$("#otabs .ot").forEach(a => { const id = a.dataset.tab, pend = SV.pending.has(id) || waiting.has(id) || (S.snap?.id === id && S.snap.dirty), d = $(".odot", a);
    if (pend && !d) a.insertAdjacentHTML("afterbegin", `<i class="odot"></i>`); if (!pend && d) d.remove(); });
  let el = $("#saveBar");
  const busyN = SV.pending.size, failed = [...SV.failed.values()];
  if (!busyN && !failed.length) { if (el && !el.dataset.done) { el.dataset.done = "1"; el.classList.remove("bad"); el.innerHTML = `${ic("check", 15)} All saved`; setTimeout(() => { if (!SV.pending.size && !SV.failed.size) el.remove(); }, 1400); } return; }
  if (!el) { el = document.createElement("div"); el.id = "saveBar"; document.body.append(el); }
  delete el.dataset.done;
  if (failed.length) {
    const f = failed[0];
    el.className = "savebar bad";
    el.innerHTML = `<div class="sbt">${ic("x", 15)} Couldn't save <b>${esc(f.pt.name)}</b>${failed.length > 1 ? ` (+${failed.length - 1} more)` : ""}</div>
      <div class="sbs">${esc(f.e?.message || "Unknown problem")}. Your changes are still on this screen.</div>
      <div class="row"><button class="btn sm" data-sv="keep">Keep trying</button><button class="btn sm" data-sv="retry">Retry now</button><button class="btn sm" data-sv="undo">Skip &amp; undo changes</button></div>`;
    $$("[data-sv]", el).forEach(b => b.onclick = () => saveAction(b.dataset.sv, f));
    return;
  }
  el.className = "savebar";
  const n = Math.min(SV.done + 1, SV.total);
  el.innerHTML = `<div class="sbt"><span class="spin"></span>Saving… ${n} of ${SV.total}</div><div class="bar2"><i style="width:${Math.round(SV.done / Math.max(1, SV.total) * 100)}%"></i></div><div class="sbs">You can keep working. Don't close this tab yet.</div>`;
}
async function saveAction(kind, f) {
  const { pt, stage } = f; SV.failed.delete(pt.id);
  if (kind === "keep") SV.slow = true;
  if (kind === "undo") {
    const g = SV.good.get(pt.id);
    if (g) { for (const k of Object.keys(pt)) delete pt[k]; Object.assign(pt, structuredClone(g)); try { await S.store.savePatient(pt, true); } catch {} toast(`${pt.name}: changes undone`); }
    else toast("Nothing saved earlier to go back to. Reload to see the last saved version.");
    saveBanner(); route(); return;
  }
  track(pt.id);
  if (stage === "data") enqueue(pt, async () => { try { const r = await withTimeout(S.store.savePatient(pt, true), SV.slow ? 60000 : 15000, "Saving the note"); queueDocx(pt, true); } catch (e) { fail(pt, e, "data"); } });
  else queueDocx(pt, true);
}
window.addEventListener("beforeunload", e => { if (SV.pending.size || SV.failed.size || docxQ.size || docxRunning) { e.preventDefault(); e.returnValue = ""; } });
async function writeDocx(pt) {
  if (pt.status === "discharged") return;
  const { dir, name } = await docxTarget(pt);
  if (pt.imported && !pt.backedUp && await S.store.exists(dir, name)) {     // keep the hand-made original once
    const bdir = await S.store.dir(await S.store.data(), "originals", true);
    const f = await (await dir.getFileHandle(name)).getFile();
    await S.store.write(bdir, `${pt.unit} - ${name}`, await f.arrayBuffer());
    pt.backedUp = true; S.store.savePatient(pt, true);
  }
  const blob = await toDocx(window.docx, blocksFor(pt, pt.status === "admit" ? pt.admitDate : lastDate(pt), popts({})));
  await S.store.write(dir, name, blob);
}

// ---------------- theme (Look) ----------------
const LOOKS = { light: ["Light", "#efebe3", "#0f1726"], dark: ["Dark", "#0b111d", "#22c9a0"], sepia: ["Sepia", "#e9dfcb", "#3b2f1e"], chameleon: ["Chameleon", "", ""] };
// Holidays: a small mark by the logo; the big ones (Christmas, Halloween, Thanksgiving, July 4th, New Year) also recolor the app.
const holidayNow = () => { if (ls.get("rn-holiday") === "off") return null; const pv = S.store?.demo && ls.get("rn-hpreview"); return pv ? hByKey(pv) : holidayFor(S.today); };
function applyHoliday() { const h = holidayNow(); document.documentElement.dataset.holiday = h?.big ? h.key : ""; }
function applyTheme(t = ls.get("rn-theme") || "light") {
  const r = document.documentElement; r.dataset.theme = t === "chameleon" ? "light" : t;
  ["--chrome", "--chrome2", "--chromeLine", "--accent"].forEach(v => r.style.removeProperty(v));
  if (t === "chameleon") {
    const h = +(ls.get("rn-hue") || Math.floor(Math.random() * 360));
    r.style.setProperty("--chrome", `hsl(${h} 40% 14%)`); r.style.setProperty("--chrome2", `hsl(${h} 35% 20%)`);
    r.style.setProperty("--chromeLine", `hsl(${h} 30% 28%)`); r.style.setProperty("--accent", `hsl(${(h + 150) % 360} 65% 48%)`);
  }
  $('meta[name="theme-color"]')?.setAttribute("content", getComputedStyle(r).getPropertyValue("--chrome").trim() || "#0f1726");
}

// ---------------- shell ----------------
function shell() {
  const counts = Object.fromEntries(UNITS.map(u => [u, unitPts(u)]));
  const hash = location.hash.slice(1);
  const curUnit = hash.startsWith("unit-") ? hash.slice(5) : hash.startsWith("pt-") ? findPt(hash.slice(3))?.unit : null;
  $("#top").innerHTML = `
    <div class="bar">
      ${S.store && hash && hash !== "home" ? `<button class="back" id="back" aria-label="Back">‹</button>` : ""}
      <img class="logo" src="icons/favicon.svg" alt="">
      <span class="brand">NOTEMAKER</span>${(() => { const h = holidayNow(); return h ? `<span class="hmark hm-${h.key}" title="${esc(h.name)}">${markFor(h)}</span>` : ""; })()}${S.site && S.user ? `<span class="sitetag">${S.site}</span>` : ""}
      ${S.store?.demo ? `<span class="pill a" style="font-size:10px">DEMO</span>` : ""}
      <span class="sp"></span>
      <div class="today"><b>${new Date(S.today + "T12:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</b>
        ${!(S.store && S.user) ? "" : S.viewDate ? `<button class="oldbtn on" id="oldNotes">Viewing ${md(S.viewDate)} ✕</button>` : `<button class="oldbtn" id="oldNotes">Old notes</button>`}</div>
      ${S.store && S.user ? `<button class="gear" id="helpB" aria-label="Help" title="Help">${ic("help", 18)}</button>` : ""}
      <button class="gear" id="gear" aria-label="Settings"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button>
    </div>
    ${S.store ? `<nav class="tabs"><a href="#home" class="${!curUnit && !hash.startsWith("pt-") && hash !== "board" ? "on" : ""}">HOME</a>${UNITS.map(u => {
      const red = counts[u].some(p => flagsFor(p).some(f => f.level === "red"));
      return `<a href="#unit-${u}" class="${curUnit === u ? "on" : ""}">${u.toUpperCase()}<i>${counts[u].length}</i>${red ? `<span class="rd"></span>` : ""}</a>`;
    }).join("")}<a href="#board" class="bbtab ${hash === "board" ? "on" : ""}">${ic("grid", 13)} BEDBOARD</a></nav>${tabStrip(hash)}` : ""}`;
  wireTabs(); setTopH(); applyHoliday();
  if ($("#oldNotes")) $("#oldNotes").onclick = () => S.viewDate ? (S.viewDate = null, route()) : oldNotesModal();
  $("#gear").onclick = toggleTray;
  $("#helpB")?.addEventListener("click", helpMenu);
  $("#back")?.addEventListener("click", goBack);
}
// ---------------- open-note tabs ----------------
// Like browser tabs, but instant: every patient is already loaded. The note you're on shows as a light "preview" tab;
// it stays as a real tab once you change something (or Ctrl/middle-click a name to open it without leaving the page).
// Tabs stay until you close them, so half-finished notes don't get forgotten. Alt+1…9 jumps to a tab.
let TABS = []; try { TABS = JSON.parse(sessionStorage.getItem("rn-tabs") || "[]"); } catch {}
const saveTabs = () => { try { sessionStorage.setItem("rn-tabs", JSON.stringify(TABS)); } catch {} };
const AUTO_WHY = /^(Prepped|Unprep|Entered vitals|Billing|Always 3|Imported|Labs reviewed|Added admit)/i;
function pinTab(id, why = "") {
  if (TABS.includes(id) || AUTO_WHY.test(why) || location.hash !== "#pt-" + id) return;
  TABS.push(id); saveTabs(); const st = $("#otabs"); if (st) { st.outerHTML = tabStrip(location.hash.slice(1)); wireTabs(); setTopH(); }
}
function tabStrip(hash) {
  TABS = TABS.filter(id => findPt(id)); const cur = hash.startsWith("pt-") ? hash.slice(3) : null;
  const ids = [...TABS, ...(cur && !TABS.includes(cur) && findPt(cur) ? [cur] : [])];
  if (!ids.length) return `<div class="otabs" id="otabs" hidden></div>`;
  return `<div class="otabs" id="otabs">${ids.map((id, i) => { const p = findPt(id), pend = SV.pending.has(id) || waiting.has(id) || (S.snap?.id === id && S.snap.dirty);
    return `<a href="#pt-${id}" class="ot ${id === cur ? "on" : ""} ${TABS.includes(id) ? "" : "pv"}" data-tab="${id}" title="${esc(p.name)} · ${p.unit}${i < 9 ? ` (Alt+${i + 1})` : ""}">
      ${pend ? `<i class="odot"></i>` : ""}<span>${esc(p.name)}</span><small>${p.unit}</small><button class="ox" data-close="${id}" aria-label="Close tab">${ic("x", 11)}</button></a>`; }).join("")}
    ${TABS.length > 1 ? `<button class="oclear" id="oClear">Close all</button>` : ""}</div>`;
}
const setTopH = () => requestAnimationFrame(() => { const t = $("#top"); if (t) document.documentElement.style.setProperty("--toph", t.offsetHeight + "px"); });
function wireTabs() {
  $$("[data-close]").forEach(b => b.onclick = e => { e.preventDefault(); e.stopPropagation(); const id = b.dataset.close;
    const i = TABS.indexOf(id); TABS = TABS.filter(x => x !== id); saveTabs();
    if (location.hash === "#pt-" + id) location.hash = TABS.length ? "pt-" + TABS[Math.min(i, TABS.length - 1)] : "unit-" + (findPt(id)?.unit || ""); else shell(); });
  $("#oClear")?.addEventListener("click", () => { TABS = []; saveTabs(); shell(); });
}
// Ctrl/Cmd-click or middle-click a patient anywhere: open it as a tab without leaving the page.
function openInTab(e) {
  const a = e.target.closest('a[href^="#pt-"]'); if (!a || a.classList.contains("ot")) return;
  if (!(e.ctrlKey || e.metaKey || e.button === 1)) return;
  e.preventDefault(); const id = a.getAttribute("href").slice(4); if (!findPt(id)) return;
  if (!TABS.includes(id)) { TABS.push(id); saveTabs(); }
  const st = $("#otabs"); if (st) { st.outerHTML = tabStrip(location.hash.slice(1)); wireTabs(); setTopH(); }
  toast(`${findPt(id).name} opened in a tab`, 1400);
}
document.addEventListener("click", openInTab, true);
document.addEventListener("auxclick", openInTab, true);
document.addEventListener("keydown", e => { if (e.altKey && /^[1-9]$/.test(e.key)) { const st = $$("#otabs .ot")[+e.key - 1]; if (st) { e.preventDefault(); location.hash = st.getAttribute("href").slice(1); } } });

// Feedback lives in the team folder, so it's only offered when a real team folder is open.
const feedbackOn = () => !!S.store && !S.store.demo && !!S.user;
const seesFeedback = () => isSup() || !!users().find(u => u.id === S.user?.id)?.feedback;
function toggleTray() {
  const old = $(".tray"); if (old) { old.remove(); $("#gear").classList.remove("open"); return; }
  $("#gear").classList.add("open");
  const cur = ls.get("rn-theme") || "light";
  const t = document.createElement("div"); t.className = "tray";
  t.innerHTML = `<h4>Look</h4><div class="looks">${Object.entries(LOOKS).map(([k, [n, bg, fg]]) =>
    `<button data-look="${k}" class="${cur === k ? "on" : ""}"><span class="sw" style="background:${k === "chameleon" ? "conic-gradient(#e5484d,#f0a020,#22c9a0,#4f7cff,#a855f7,#e5484d)" : `linear-gradient(135deg,${bg} 55%,${fg} 55%)`}"></span>${n}</button>`).join("")}</div>
    ${cur === "chameleon" ? `<button class="item" data-reroll>${ic("palette")} New colors</button>` : ""}
    <label class="tgl item" style="padding:6px 8px"><input type="checkbox" data-hol ${ls.get("rn-holiday") === "off" ? "" : "checked"}><span class="sw"></span><span>Holiday decorations<small>${(() => { const h = holidayFor(S.today); return h ? esc(h.name) + " today" : "Shows up on holidays"; })()}</small></span></label>
    ${S.store?.demo ? `<select class="item hpv" data-hpv><option value="">Preview a holiday…</option>${Object.entries(HPREVIEW).map(([k, n]) => `<option value="${k}" ${ls.get("rn-hpreview") === k ? "selected" : ""}>${n}</option>`).join("")}</select>` : ""}
    <button class="item" data-present>${ic("monitor")} Presentation mode</button>
    ${S.store && S.user ? `<h4>Work</h4><button class="item" data-train>${ic("book")} Trainings</button><button class="item" data-vlim>${ic("vitals")} Vital alerts</button>
      <button class="item" data-rules>${ic("shield")} ${isSup() ? "Supervisor tools" : "Team rules"}</button>` : ""}
    ${feedbackOn() ? `<button class="item" data-flag>${ic("feedback")} Give feedback</button>${seesFeedback() ? `<button class="item" data-hub>${ic("flag")} Feedback list</button>` : ""}` : ""}
    ${S.store ? `<h4>${S.user ? esc(S.user.name) + (S.site ? " · " + S.site : "") : "Team"}</h4>
    ${S.user && !S.store.demo ? `<button class="item" data-site>${ic("hospital")} Switch hospital</button><button class="item" data-pin>${ic("key")} Change my PIN</button><button class="item" data-out>${ic("logout")} Sign out</button>` : ""}
    <button class="item" data-folder>${ic("folder")} ${S.store.demo ? "Leave demo" : "Change team folder"}</button>` : ""}`;
  document.body.append(t);
  const close = () => { t.remove(); $("#gear")?.classList.remove("open"); };
  $$("[data-look]", t).forEach(b => b.onclick = () => { ls.set("rn-theme", b.dataset.look); applyTheme(b.dataset.look); close(); toggleTray(); });
  $("[data-reroll]", t)?.addEventListener("click", () => { ls.set("rn-hue", String(Math.floor(Math.random() * 360))); applyTheme("chameleon"); });
  $("[data-present]", t)?.addEventListener("click", () => { close(); startPresentation(); });
  $("[data-hol]", t)?.addEventListener("change", e => { ls.set("rn-holiday", e.target.checked ? "on" : "off"); shell(); });
  $("[data-hpv]", t)?.addEventListener("change", e => { ls.set("rn-hpreview", e.target.value); shell(); });
  $("[data-flag]", t)?.addEventListener("click", () => { close(); raiseFlag(); });
  $("[data-hub]", t)?.addEventListener("click", () => { close(); location.hash = "flags"; });
  $("[data-train]", t)?.addEventListener("click", () => { close(); location.hash = "training"; });
  $("[data-vlim]", t)?.addEventListener("click", () => { close(); vitalLimitsModal(); });
  $("[data-rules]", t)?.addEventListener("click", () => { close(); location.hash = "rules"; });
  $("[data-site]", t)?.addEventListener("click", () => { close(); leaveGuard(() => { setSite(null); S.user = null; try { sessionStorage.removeItem("rn-user"); } catch {} route(); }); });
  $("[data-pin]", t)?.addEventListener("click", () => { close(); newPinModal(users().find(u => u.id === S.user.id), "Change my PIN"); });
  $("[data-out]", t)?.addEventListener("click", () => { close(); signOut(); });
  $("[data-folder]", t)?.addEventListener("click", async () => { close(); await Store.forget(); S.store = null; S.user = null; S.pts = []; location.hash = ""; boot(); });
  setTimeout(() => document.addEventListener("click", function off(e) { if (!t.contains(e.target) && e.target.id !== "gear" && !e.target.closest("#gear")) { close(); document.removeEventListener("click", off); } }), 0);
}
// Monitor icon in the corner of the first screens: starts presentation mode.
function pzButton() { if ($("#pzGo")) return; $("#gear").insertAdjacentHTML("beforebegin", `<button class="gear pzgo" id="pzGo" aria-label="Presentation mode" title="Presentation mode">${ic("monitor", 18)}</button>`); $("#pzGo").onclick = startPresentation; }
// The very first screen: pick the hospital. Only Aspen Grove is set up so far.
const SITES = { AGBH: ["Aspen Grove", "Behavioral Hospital · Orem"], SLBH: ["Salt Lake", "Behavioral Health · Salt Lake City"] };
function setSite(k) { S.site = k; try { k ? sessionStorage.setItem("rn-site", k) : sessionStorage.removeItem("rn-site"); } catch {} }
function sitePage() {
  $("#main").innerHTML = `<div class="sitepage"><img class="logo" src="icons/favicon.svg" alt=""><h1>NoteMaker</h1><p class="muted">Pick your hospital</p>
    <div class="bigsites">${Object.entries(SITES).map(([k, [a, b]]) => `<button class="bigsite" data-s="${k}"><span class="bs-ic">${ic("hospital", 30)}</span><b>${a}</b><span>${b}</span>${k === "SLBH" ? `<i>Coming soon</i>` : ""}</button>`).join("")}</div>
    <p class="warnbox" id="sNo" hidden>Salt Lake Behavioral isn't set up yet. It'll get its own units and setup, modeled on Aspen Grove.</p>
    <button class="btn sm" id="sDemo">Try the demo</button></div>`;
  pzButton();
  $$("[data-s]").forEach(b => b.onclick = () => { if (b.dataset.s === "SLBH") { $("#sNo").hidden = false; return; } setSite(b.dataset.s); route(); });
  $("#sDemo").onclick = async () => { setSite("AGBH"); S.store = await Store.demoStore(); await load(); };
}
// ---------------- routing ----------------
function route() {
  shell();
  const h = location.hash.slice(1), main = $("#main");
  main.style.animation = "none"; void main.offsetWidth; main.style.animation = "";
  if (!S.site) { try { S.site = sessionStorage.getItem("rn-site"); } catch {} }
  if (!S.site) { $("#top .tabs")?.remove(); return sitePage(); }
  if (!S.store) return welcome();
  if (!S.user) { $("#top .tabs")?.remove(); return loginScreen(); }
  S.today = localToday(); S.date = S.viewDate || S.today;
  if (h.startsWith("unit-")) return unitView(h.slice(5));
  if (h.startsWith("pt-")) { const pt = findPt(h.slice(3)); if (pt) S.date = noteDate(pt); return ptView(h.slice(3)); }
  if (h === "hp-new") return hpForm();
  if (h.startsWith("hp-")) return hpForm(h.slice(3));
  if (h === "flags") return seesFeedback() ? flagHub() : home();
  if (h === "training") return trainingPage();
  if (h === "board") return bedboard();
  if (h === "rules") return rulesPage();
  return home();
}
// ---------------- unsaved-changes guard ----------------
// The note editor works on a copy until Save; leaving first asks "Save / Discard / Keep editing".
const isDirty = () => !!(S.snap?.dirty || S.formDirty);
function discard() {
  if (S.snap) { const pt = findPt(S.snap.id); if (pt) { for (const k of Object.keys(pt)) delete pt[k]; Object.assign(pt, S.snap.data); } }
  S.snap = null; S.formDirty = false; S.open = null;
}
function leaveGuard(go) {
  if (!isDirty()) return go();
  const m = modal("Wait, you have unsaved changes", `<p class="muted" style="font-size:14px">${S.formDirty ? "This form" : "This note"} has changes that aren't saved. If you leave now they'll be lost.</p>`,
    `<button class="btn" data-x>Keep editing</button><button class="btn warn" id="lgD">Don't save</button><button class="btn p" id="lgS">Save</button>`);
  $("#lgD", m).onclick = () => { m.close(true); discard(); go(); };
  $("#lgS", m).onclick = e => busy(e.currentTarget, async () => {
    if (S.formDirty) { m.close(true); return $("#hSave")?.click(); }
    const pt = findPt(S.snap.id); S.snap = null; S.open = null; await saveNow(pt); m.close(true); go();
  });
}
let lastHash = location.hash;
window.addEventListener("hashchange", () => {
  // A popup left open (browser Back, a link) shouldn't float over the next page.
  const open = $$(".scrim").filter(x => x.close);
  if (open.some(x => x.dirty)) { history.replaceState(null, "", lastHash || "#home"); return toast("Finish or close the open window first"); }
  open.forEach(x => x.close(true));
  if (S.snap?.dirty && !S.formDirty) { const pt = findPt(S.snap.id); S.snap = null; S.open = null; if (pt) { saveNow(pt); toast(`${pt.name}: saved in the background`, 1600); } }
  if (isDirty()) { const want = location.hash; history.replaceState(null, "", lastHash || "#home"); leaveGuard(() => { lastHash = want; location.hash = want; }); return; }
  lastHash = location.hash; S.open = null; S.visit = (S.visit || 0) + 1; route();
});
window.addEventListener("beforeunload", e => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });
const goBack = () => { const h = location.hash.slice(1); location.hash = h.startsWith("pt-") ? "unit-" + (findPt(h.slice(3))?.unit || "") : h.startsWith("hp-") && h !== "hp-new" ? "pt-" + h.slice(3) : "home"; };

// ---------------- welcome / folder ----------------
function welcome() {
  $("#main").innerHTML = `<div class="card welcome">
    <img class="logo" src="icons/favicon.svg" alt="">
    <h1>NoteMaker <span class="sitetag dark">${S.site || ""}</span></h1>
    <p class="muted" style="margin:6px 0 16px">Preps tomorrow's notes, flags what needs you, and prints a whole unit at once. Everything stays in your team folder; nothing is sent anywhere.</p>
    ${S.regrant ? `<button class="btn go" id="regrant">Reconnect to ${esc(S.regrant.name)}</button><p class="muted" style="margin-top:8px">Edge asks once per visit before the app can use the folder again.</p>` : ""}
    ${supported() ? `<button class="btn p" id="pick" style="margin-top:10px">Choose team folder</button>
      <p class="muted" style="margin-top:8px">Pick <b>U:\\Scans\\Tomco</b> (the folder with the unit folders inside).</p>`
      : `<p class="warnbox">Choosing a folder needs Microsoft Edge or Chrome on a computer. You can still try the demo.</p>`}
    <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--paperLine)">
      <button class="btn" id="demo">Try the demo (fake patients)</button>
    </div>
  </div>`;
  pzButton();
  $("#pick")?.addEventListener("click", async () => { try { S.store = await Store.pick(); await load(); } catch (e) { if (e.name !== "AbortError") toast("Couldn't open that folder: " + e.message); } });
  $("#regrant")?.addEventListener("click", async () => { const s = await Store.regrant(S.regrant); if (s) { S.store = s; S.regrant = null; await load(); } });
  $("#demo").onclick = async () => { S.store = await Store.demoStore(); await load(); };
}

async function load() {
  S.pts = await S.store.loadPatients(); S.pts.forEach(setBase);
  S.pts.forEach(p => p.file ||= p.name);
  for (const pt of S.pts) {                       // clean up notes imported by older versions
    const before = pt.problems.length;
    pt.problems = pt.problems.filter(q => !/^[-–•·\s]*\d{1,2}\/\d{1,2}\b/.test(q.name) && !/^(Patient Name|Date of Birth|MRN|Medical Record|Admit Date|Unit|Page \d|Date of service)/i.test(q.name));
    if (pt.problems.length !== before) S.store.savePatient(pt, true);
  }
  if (S.store.demo && !S.pts.length) {
    toast("Setting up fake patients…");
    S.pts = demoPatients(S.date);
    await pool(S.pts, 6, pt => S.store.savePatient(pt, true)); S.pts.forEach(pt => queueDocx(pt));
  }
  S.pts.forEach(pt => SV.good.set(pt.id, structuredClone(pt)));
  await loadRules();
  S.settings = await S.store.getShared("settings.json", {});
  if (!S.settings.users && S.settings.scribes?.length) { for (const n of S.settings.scribes) await addUser(n, "scribe"); }   // older setting
  if (!S.store.demo) {                                   // starting accounts: both begin with PIN 1234
    const has = n => users().some(u => u.name.replace(/\W/g, "").toLowerCase() === n.replace(/\W/g, "").toLowerCase());
    let changed = false;
    if (!has("B. Olsen")) { await addUser("B. Olsen", "supervisor"); changed = true; }
    if (!has("S. Wills")) { const u = await addUser("S. Wills", "scribe"); u.admin = true; u.feedback = true; changed = true; }
    if (changed) await saveSettings();
  }
  if (S.store.demo) S.user = { id: "demo", name: "Demo user", role: "supervisor" };
  else { let id = null; try { id = sessionStorage.getItem("rn-user"); } catch {} const u = users().find(x => x.id === id); S.user = u ? { id: u.id, name: u.name, role: u.role, admin: !!u.admin } : null; }
  S.days = await S.store.getShared("days.json", {}); S.board = await S.store.getShared("board.json", []); S.ann = await S.store.getShared("announce.json", []); S.table = await S.store.getShared("table.json", {});
  if (!location.hash || location.hash === "#") location.hash = "home"; else route();
}
window.addEventListener("focus", async () => {        // pick up other computers' changes
  if (!S.store || S.open || $(".scrim") || presenting()) return;
  try { S.pts = await S.store.loadPatients(); S.pts.forEach(setBase); S.days = await S.store.getShared("days.json", {}); S.board = await S.store.getShared("board.json", []); S.ann = await S.store.getShared("announce.json", []); S.table = await S.store.getShared("table.json", {}); route(); } catch {}
});

// Small shared badges: circled A for a new admit, teal count for notes to write up.
// An H&P only counts as ready when a scribe says so (older H&Ps made before this setting count as ready).
const hpReady = p => p.hpReady === true || (p.hpReady === undefined && p.needsPrep === undefined);
const admA = p => p.status === "admit" ? `<span class="admA" title="New admit (H&P)" aria-label="New admit"><svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="8"/><path d="M5.1 11.6 8 4.4l2.9 7.2M6.15 9.1h3.7"/></svg></span>` : "";
const qnTag = p => { const n = (p.notes || []).filter(x => x.kind === "quick" && !x.done).length; return n ? `<span class="qtag" title="${n} note${n > 1 ? "s" : ""} to write up">${ic("note", 12)}${n}</span>` : ""; };
// ---------------- home dashboard ----------------
const isDiabetes = n => /diabet|\bT[12]DM\b|\bDM ?[12]?\b|IDDM|NIDDM/i.test(n || "");
const onInsulin = q => q.insulin ?? (q.meds.some(m => /insulin|lantus|humalog|novolog|glargine|lispro|basaglar|levemir|tresiba/i.test(m.name || "")) ? true : undefined);
const a3 = p => p.always3 || autoA3(p, p.problems.filter(q => !(q.resolved && q.resolved < S.today)));
const always3 = p => ["P", "OD"].includes(a3(p));
const effBill = (p, d) => p.bill?.[d] ?? (tset().today.default3 && always3(p) && (p.admitDate || d) <= d && (!p.dischargedOn || p.dischargedOn >= d) ? "3" : "");
const fullMDY = d => `${md(d)}/${d.slice(0, 4)}`;
let dayQ = Promise.resolve();
function saveDay(patch) {                             // one at a time; re-read first since other computers write here too
  S.days[S.today] = { ...(S.days[S.today] || {}), ...patch };
  return dayQ = dayQ.then(async () => {
    const disk = await S.store.getShared("days.json", {});
    disk[S.today] = { ...(disk[S.today] || {}), ...patch }; S.days = disk; await S.store.setShared("days.json", disk);
  }).catch(e => console.warn(e));
}
function buildCount(d = S.today) {
  const day = S.days?.[d] || {}, n = {};
  for (const p of S.pts) {
    if (p.admitDate > d || (p.dischargedOn && p.dischargedOn < d)) continue;
    const v = String(effBill(p, d)).trim(); if (!/^[123]$/.test(v)) continue;
    const code = (p.admitDate === d ? "9922" : "9923") + v; n[code] = (n[code] || 0) + 1;
  }
  const c = k => `${k}: ${n[k] || 0}`;
  return [day.provider || "(provider)", `${day.in || "____"} - ${day.out || "____"} ${fullMDY(d)}`, "",
    ...(n["99231"] || true ? [c("99231")] : []), c("99232"), c("99233"), "", ...(n["99221"] ? [c("99221")] : []), c("99222"), c("99223"), "",
    `EKG - 93010: ${day.ekg || ekgCount()}`].join("\n");
}
function countModal() {
  const m = modal(`${ic("count")} Count for ` + fullMDY(S.today), `<p class="muted" style="margin-bottom:8px">Check it over. You can fix anything right here before saving.</p>
    <textarea id="cT" class="counttxt" rows="14">${esc(buildCount())}</textarea>`,
    `<button class="btn" id="cCopy">Copy</button><span class="sp"></span><button class="btn" data-x>Cancel</button><button class="btn p" id="cSave">Save count</button>`);
  $("#cCopy", m).onclick = async () => { try { await navigator.clipboard.writeText($("#cT", m).value); toast("Copied"); } catch { $("#cT", m).select(); } };
  $("#cSave", m).onclick = e => busy(e.currentTarget, async () => { await saveDay({ count: { text: $("#cT", m).value, by: S.user?.name, at: Date.now() } }); m.close(true); toast("Count saved"); home(); });
}
async function boardSave(fn) { S.board = await S.store.getShared("board.json", []); fn(S.board); await S.store.setShared("board.json", S.board); }
function boardModal() {
  const links = new Map();
  const m = modal(`${ic("pin")} Pinned note`, `<div class="f"><textarea id="bT" rows="5" placeholder="What happened, what to watch, what's still pending… Type a patient's name (or @) to link them."></textarea><div class="msug" id="bSug"></div></div>
    <label class="tgl" style="padding:2px 0 8px"><input type="checkbox" id="bPop"><span class="sw"></span><span>Show big every time<small>Linked patients' notes open with this on top until you press OK</small></span></label>
    <p class="muted">Stays on Home for everyone, and on each linked patient's note, until someone marks it resolved.</p>`,
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="bGo">Save note</button>`);
  mentionBox($("#bT", m), $("#bSug", m), links);
  setTimeout(() => $("#bT", m)?.focus(), 50);
  $("#bGo", m).onclick = async () => { const t = $("#bT", m).value.trim(); if (!t) return;
    const ids = [...links.keys()].filter(id => t.includes("@" + links.get(id)));
    await boardSave(b => b.push({ id: uid(), text: t, by: S.user?.name, date: S.today, at: Date.now(), links: ids, popup: $("#bPop", m).checked }));
    m.close(true); route(); };
}
// Name suggestions while typing: "@" or the start of a patient's name. Picking one writes "@Last, First" and links the note to them.
function mentionBox(ta, box, links) {
  const frag = () => { const before = ta.value.slice(0, ta.selectionStart);
    const m = before.match(/@([A-Za-z][A-Za-z' -]*,?\s*[A-Za-z'-]*)$/) || before.match(/(?:^|[\s(])([A-Za-z][A-Za-z'-]{2,}(?:,\s*[A-Za-z'-]*)?)$/);
    return m ? { q: m[1].trim().toLowerCase(), at: before.length - m[0].replace(/^[\s(]/, "").length, at2: before.length, mention: m[0].includes("@") } : null; };
  const show = () => {
    const f = frag(); if (!f || (!f.mention && f.q.length < 3)) { box.innerHTML = ""; return; }
    const hits = S.pts.filter(p => active(p) && !links.has(p.id) && (() => { const n = p.name.toLowerCase(), [last, first = ""] = n.split(/,\s*/);
      return n.startsWith(f.q) || `${first} ${last}`.startsWith(f.q) || (f.mention && first.startsWith(f.q)); })()).slice(0, 4);
    box.innerHTML = hits.map(p => `<button type="button" class="mchip" data-id="${p.id}">${ic("user", 12)} Link <b>${esc(p.name)}</b> <small>${p.unit}</small></button>`).join("");
    $$(".mchip", box).forEach(c => c.onmousedown = e => { e.preventDefault(); const p = findPt(c.dataset.id), f2 = frag(); if (!f2) return;
      ta.value = ta.value.slice(0, f2.at) + "@" + p.name + " " + ta.value.slice(f2.at2); links.set(p.id, p.name);
      const pos = f2.at + p.name.length + 2; ta.setSelectionRange(pos, pos); ta.focus(); box.innerHTML = ""; ta.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  ta.addEventListener("input", show); ta.addEventListener("click", show); ta.addEventListener("blur", () => setTimeout(() => box.innerHTML = "", 150));
}
// "@Last, First" becomes a blue link to that patient's note.
function withLinks(text, ids = []) {
  let h = esc(text).replace(/\n/g, "<br>");
  for (const id of ids) { const p = findPt(id); if (!p) continue; h = h.split(esc("@" + p.name)).join(`<a class="plink" href="#pt-${p.id}">${esc(p.name)}</a>`); }
  return h;
}
const boardFor = pt => (S.board || []).filter(n => (n.links || []).includes(pt.id));
async function resolveBoard(id) { await boardSave(list => { const i = list.findIndex(x => x.id === id); if (i >= 0) list.splice(i, 1); }); route(); }
// Notes marked "show big every time": shown over the note once per visit, until OK.
function popupNotes(pt) {
  if (S.viewDate) return;
  const due = [...(pt.notes || []).filter(n => n.popup && !(n.kind === "quick" && n.done)).map(n => ({ n, from: n.kind === "keep" ? "Keep in mind" : "To write up" })),
    ...boardFor(pt).filter(n => n.popup).map(n => ({ n, from: "Pinned note" }))].filter(({ n }) => !(S.popSeen ||= new Set()).has(`${S.visit || 0}:${pt.id}:${n.id}`));
  if (!due.length || $(".popnote")) return;
  const { n, from } = due[0];
  const s2 = document.createElement("div"); s2.className = "scrim popnote";
  s2.innerHTML = `<div class="popcard"><div class="pophead">${ic("note", 18)} ${from}<span class="sp"></span><span class="muted small">${esc(n.by || "")} · ${md(n.date)}</span></div>
    <div class="popbody">${withLinks(n.text, n.links)}</div><div class="row"><span class="sp"></span><button class="btn p" id="popOk">OK</button></div></div>`;
  document.body.append(s2); setTimeout(() => $("#popOk", s2)?.focus(), 60);
  $("#popOk", s2).onclick = () => { S.popSeen.add(`${S.visit || 0}:${pt.id}:${n.id}`); s2.classList.add("out"); setTimeout(() => { s2.remove(); popupNotes(pt); }, 220); };
}
// ---- announcements: resolved per person, not for everyone
const myAud = () => S.store?.demo ? ["scribes", "providers", "everyone"] : S.user?.role === "provider" ? ["providers", "everyone"] : ["scribes", "everyone"];
const canAnnounce = () => S.store?.demo ? ["scribes", "providers", "everyone"] : S.user?.role === "supervisor" ? ["scribes", "everyone"] : S.user?.role === "provider" ? ["providers"] : [];
async function annSave(fn) { S.ann = await S.store.getShared("announce.json", []); fn(S.ann); await S.store.setShared("announce.json", S.ann); }
function annModal() {
  const aud = canAnnounce(), label = { scribes: "Scribes", providers: "Providers", everyone: "Everyone" };
  const m = modal(`${ic("megaphone")} Announcement`, `<div class="row" style="margin-bottom:8px"><span class="muted">To:</span>${aud.map((a, i) => `<span class="chip ${i ? "" : "on"}" data-a="${a}">${label[a]}</span>`).join("")}</div>
    <div class="f"><textarea id="aT" rows="4" placeholder="e.g. New H&P template starts Monday"></textarea></div><p class="muted">Each person dismisses it for themselves.</p>`,
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="aGo">Post</button>`);
  let to = aud[0]; $$("[data-a]", m).forEach(c => c.onclick = () => { to = c.dataset.a; $$("[data-a]", m).forEach(x => x.classList.toggle("on", x === c)); });
  $("#aGo", m).onclick = async () => { const t = $("#aT", m).value.trim(); if (!t) return; await annSave(a => a.push({ id: uid(), text: t, to, by: S.user?.name, byId: S.user?.id, date: S.today, at: Date.now(), seen: [] })); m.close(true); home(); };
}
// ---- the patient table's own settings (providers and supervisors can change these)
const SWATCH = [["Red", "#c4262e", "#f3a5a8"], ["Orange", "#b4531a", "#f6b68a"], ["Gold", "#8a6400", "#e9c661"], ["Green", "#1f8a55", "#8fd4ac"], ["Teal", "#0f7c86", "#86d1d8"],
  ["Blue", "#2a62c9", "#9cbcf2"], ["Indigo", "#4b45b8", "#b0acf0"], ["Purple", "#6d3fc0", "#c6a9f2"], ["Pink", "#b8327a", "#f2a7cf"], ["Gray", "#5d5a52", "#b9b3a6"]];
const NAMED = { orange: "#b4531a", purple: "#6d3fc0", red: "#c4262e", blue: "#2a62c9", green: "#1f8a55" };
const TABLE_DEFAULT = {
  patient: { admit: true, notes: true },
  issues: { show: true, red: true, amber: true, keep: true },
  dx: { acute: "#b4531a", rules: [["diabet", "#6d3fc0"], ["dm2", "#6d3fc0"]], shortNames: true,
    abbr: [["Acute otitis media", "AOM"], ["Asthma", "Az"], ["Chronic back pain", "CBP"], ["Chronic kidney disease", "CKD"], ["Diabetes mellitus type 2", "DM2"], ["Type 2 diabetes", "DM2"],
      ["Hypertension", "HTN"], ["Gastroesophageal reflux disease", "GERD"], ["Headache", "HA"], ["Irritable bowel syndrome", "IBS"], ["Insomnia", "Ins"], ["Dizziness", "Dz"], ["Constipation", "C"], ["Diarrhea", "D"]] },
  psych: { show: true, short: false },
  notes: { show: true, insulin: true, keep: true },
  yest: { show: true },
  today: { show: true, default3: true },
  a3: { show: true },
};
function tset() {
  const T = S.table || {}, d = structuredClone(TABLE_DEFAULT);
  if (T.cols && !T.issues) {                       // settings saved by the earlier version
    for (const k of ["issues", "psych", "notes", "yest", "today", "a3"]) if (T.cols[k] === false) d[k].show = false;
    if (T.acute) d.dx.acute = NAMED[T.acute] || T.acute;
    if (T.colors) d.dx.rules = T.colors.map(([m, c]) => [m, NAMED[c] || c]);
    if (T.abbr) d.dx.abbr = T.abbr;
    return withCols(d);
  }
  for (const k of Object.keys(d)) if (T[k]) d[k] = { ...d[k], ...T[k] };
  return withCols(d);
}
const withCols = t => ({ ...t, cols: { issues: t.issues.show, psych: t.psych.show, notes: t.notes.show, yest: t.yest.show, today: t.today.show, a3: t.a3.show } });
const canEditTable = () => S.store?.demo || ["provider", "supervisor"].includes(S.user?.role) || !!S.user?.admin;
const tAbbr = n => { const t = tset(); if (!t.dx.shortNames) return n; const hit = t.dx.abbr.find(([f]) => f.toLowerCase() === String(n).toLowerCase()); return hit ? hit[1] : n; };
function dxColor(name, acute) {
  const t = tset(), r = t.dx.rules.find(([m]) => m && String(name).toLowerCase().includes(m.toLowerCase()));
  return r ? r[1] : acute ? t.dx.acute : "";
}
const TCOL = { orange: "#b4531a" };
function swatches(key, val) {
  return `<div class="swatches" data-sw="${key}">${SWATCH.map(([n, dk, lt]) => [[n, dk], [n + " (light)", lt]]).flat().map(([n, c]) =>
    `<button type="button" class="sw ${String(val).toLowerCase() === c ? "on" : ""}" data-c="${c}" title="${n}" style="background:${c}"></button>`).join("")}
    <button type="button" class="sw none ${!val ? "on" : ""}" data-c="" title="No color">${ic("x", 12)}</button></div>`;
}
function tableSettings() {
  const t = tset();
  const sw = (on, key) => `<label class="switch" onclick="event.stopPropagation()"><input type="checkbox" data-show="${key}" ${on ? "checked" : ""}><i></i></label>`;
  const opt = (key, sub, on, label) => `<label class="switch sm"><input type="checkbox" data-opt="${key}.${sub}" ${on ? "checked" : ""}><i></i>${label}</label>`;
  const sec = (key, icon, title, show, body, open) => `<details class="tsec" ${open ? "open" : ""}><summary>${ic(icon, 15)}<b>${title}</b><span class="sp"></span>${show === null ? `<span class="muted small">always shown</span>` : sw(show, key)}<span class="chev">▸</span></summary><div class="tsb">${body}</div></details>`;
  const ruleRow = (m = "", c = "#2a62c9") => `<div class="tsrule"><input class="btn sm" data-cm value="${esc(m)}" placeholder="Diagnosis contains… (e.g. cellulitis)"><input type="hidden" data-cc value="${c}">${swatches("rule", c)}<button class="iconbtn" data-del title="Remove">${ic("x", 14)}</button></div>`;
  const abbrRow = (f = "", a = "") => `<div class="row tsrow"><input class="btn sm" data-bf value="${esc(f)}" placeholder="Full diagnosis"><span class="muted">→</span><input class="btn sm short" data-ba value="${esc(a)}" placeholder="Short"><button class="iconbtn" data-del title="Remove">${ic("x", 14)}</button></div>`;
  const m = modal(`${ic("palette")} Table settings`, `<p class="muted small" style="margin-bottom:10px">Open a column to change what it shows. Changes apply for everyone.</p>
    ${sec("patient", "user", "Patient", null, opt("patient", "admit", t.patient.admit, "Show the A badge for new admits") + opt("patient", "notes", t.patient.notes, "Show notes still to write up"))}
    ${sec("issues", "flag", "Pertinent issues", t.issues.show, opt("issues", "red", t.issues.red, "Follow-up flags (red)") + opt("issues", "amber", t.issues.amber, "Things to check (yellow)") + opt("issues", "keep", t.issues.keep, "Keep-in-mind notes"))}
    ${sec("dx", "palette", "Medical diagnoses", null, `
      <div class="lbl">Color for acute or flagged diagnoses</div><input type="hidden" id="tsA" value="${t.dx.acute}">${swatches("acute", t.dx.acute)}
      <div class="lbl">Color rules</div><div id="tsC">${t.dx.rules.map(([mm, c]) => ruleRow(mm, c)).join("")}</div><button class="btn sm" id="tsCA">${ic("plus", 13)} Add a color rule</button>
      <div class="lbl row"><span>Short names</span><span class="sp"></span>${opt("dx", "shortNames", t.dx.shortNames, "Use short names")}</div>
      <div id="tsB">${t.dx.abbr.map(([f, a]) => abbrRow(f, a)).join("")}</div><button class="btn sm" id="tsBA">${ic("plus", 13)} Add a short name</button>`, true)}
    ${sec("psych", "psych", "Psychiatric diagnosis", t.psych.show, opt("psych", "short", t.psych.short, "Shorten long diagnoses (first part only)"))}
    ${sec("notes", "note", "Notes", t.notes.show, opt("notes", "insulin", t.notes.insulin, "Insulin status for diabetes") + opt("notes", "keep", t.notes.keep, "Keep-in-mind notes"))}
    ${sec("yest", "history", "Yesterday's billing", t.yest.show, `<p class="muted small">Shows what was billed the day before.</p>`)}
    ${sec("today", "count", "Today's billing", t.today.show, opt("today", "default3", t.today.default3, "Show a light 3 for Always-3 patients (counts as 3)"))}
    ${sec("a3", "shield", "Always 3?", t.a3.show, `<p class="muted small">P always 3 · ~ 3 on admit, then mental status · M medical issue · OD overdose.</p>`)}`,
    `<button class="btn" id="tsR">${ic("history", 14)} Reset</button><span class="sp"></span><button class="btn" data-x>Cancel</button><button class="btn p" id="tsGo">Save</button>`, true);
  const wire = () => {
    $$("[data-del]", m).forEach(b => b.onclick = () => { b.closest(".tsrule,.tsrow").remove(); m.dirty = true; });
    $$(".swatches", m).forEach(g => $$(".sw", g).forEach(b => b.onclick = () => { $$(".sw", g).forEach(x => x.classList.toggle("on", x === b));
      const hid = g.previousElementSibling; if (hid?.type === "hidden") hid.value = b.dataset.c; m.dirty = true; }));
  };
  wire();
  $("#tsCA", m).onclick = () => { $("#tsC", m).insertAdjacentHTML("beforeend", ruleRow()); wire(); };
  $("#tsBA", m).onclick = () => { $("#tsB", m).insertAdjacentHTML("beforeend", abbrRow()); wire(); };
  $("#tsR", m).onclick = async () => { if (await ask("Reset table settings?", "Puts colors, short names, and columns back to how they started, for everyone.", "Reset")) { S.table = {}; await S.store.setShared("table.json", S.table); m.close(true); home(); } };
  $("#tsGo", m).onclick = async () => {
    const n = structuredClone(TABLE_DEFAULT);
    $$("[data-show]", m).forEach(c => n[c.dataset.show].show = c.checked);
    $$("[data-opt]", m).forEach(c => { const [k, sub] = c.dataset.opt.split("."); n[k][sub] = c.checked; });
    n.dx.acute = $("#tsA", m).value;
    n.dx.rules = $$("#tsC .tsrule", m).map(r => [$("[data-cm]", r).value.trim(), $("[data-cc]", r).value]).filter(([x]) => x);
    n.dx.abbr = $$("#tsB .tsrow", m).map(r => [$("[data-bf]", r).value.trim(), $("[data-ba]", r).value.trim()]).filter(([f, a]) => f && a);
    S.table = n; await S.store.setShared("table.json", S.table); m.close(true); toast("Table settings saved for everyone"); home();
  };
}
function home() {
  const live = S.pts.filter(active), yest = E.addDays(S.today, -1);
  const admits = S.pts.filter(p => p.admitDate === S.today && p.status !== "discharged");
  const day = S.days?.[S.today] || {}, t = tset();
  const dayName = new Date(S.today + "T12:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const uStats = u => { const l = unitPts(u), fs = l.flatMap(p => flagsFor(p));
    return { l, r: fs.filter(f => f.level === "red").length, a: fs.filter(f => f.level === "amber").length, q: l.reduce((k, p) => k + (p.notes || []).filter(n => n.kind === "quick" && !n.done).length, 0), adm: l.filter(p => p.status === "admit").length }; };
  const all = UNITS.map(u => [u, uStats(u)]), fuTotal = all.reduce((k, [, x]) => k + x.r, 0);
  const anns = (S.ann || []).filter(a => myAud().includes(a.to) && !(a.seen || []).includes(S.user?.id));
  const dxCell = p => p.problems.filter(q => !(q.resolved && q.resolved < S.today)).map(q => {
    const acute = flagsFor(p).some(x => x.problemId === q.id && x.level === "red") || q.alwaysFlag || q.meds.some(m => m.end && m.end >= S.today);
    const c = dxColor(q.name, acute); return c ? `<span class="dxc" style="color:${c}">${esc(tAbbr(q.name))}</span>` : esc(tAbbr(q.name)); }).join(", ") || "None";
  const notesCell = p => [...p.problems.filter(q => t.notes.insulin && isDiabetes(q.name) && !(q.resolved && q.resolved < S.today)).map(q => { const i = onInsulin(q);
      return i === true ? "Taking insulin" : i === false ? "No insulin" : `<span class="dxc" style="color:${TCOL.orange}">Insulin?</span>`; }),
    ...(t.notes.keep ? (p.notes || []).filter(n => n.kind === "keep").map(n => esc(n.text)) : [])].join("; ");
  const C = t.cols;
  $("#main").innerHTML = `<div class="homegrid"><div style="min-width:0">
    <div class="row"><h1>${dayName}</h1><span class="sp"></span>
      <button class="btn" id="imp">${ic("import")} Import notes</button><a class="btn p" href="#hp-new" style="text-decoration:none">${ic("hp")} New H&amp;P</a></div>
    <div class="card daybar" data-help="daybar">
      <label><span>Provider today</span><select id="dP"><option value="">Pick…</option>${providerNames().map(n => `<option ${day.provider === n ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
      <label><span>In</span><input id="dIn" value="${esc(day.in || "")}" placeholder="0800" maxlength="4" inputmode="numeric"></label>
      <label><span>Out</span><input id="dOut" value="${esc(day.out || "")}" placeholder="1500" maxlength="4" inputmode="numeric"></label>
      <label><span>EKGs reviewed</span><input id="dE" value="${esc(day.ekg || "")}" placeholder="${ekgCount()}" maxlength="3" inputmode="numeric"></label>
      <button class="btn go" id="genC">${ic("count")} Generate count</button>
    </div>
    <div class="card census" data-help="census">
      <div class="cz"><b>${live.length}</b><span>in house</span></div>
      <div class="cz"><b>${admits.length}</b><span>admit${admits.length === 1 ? "" : "s"} today</span></div>
      <div class="cadm">${admits.map(p => `<a href="#${hpReady(p) ? "pt-" : "hp-"}${p.id}">${admA(p)}${esc(p.name)}<i>${p.unit}</i>${p.status === "admit" ? (hpReady(p) ? `<b class="prepok">Ready</b>` : `<b class="needprep">Needs prep</b>`) : ""}</a>`).join("") || `<span class="muted">No new admits yet</span>`}
        <button class="btn sm addadm" id="addAdm">${ic("plus", 13)} Add admits</button></div>
    </div>
    <div class="card fuwrap" data-help="units">
      <div class="fuh"><b>${fuTotal}</b> follow-up flag${fuTotal === 1 ? "" : "s"}</div>
      <div class="furows">${all.map(([u, x]) => `<a class="fur" href="#unit-${u}"><span class="fun">${u}</span><span class="fuc">${x.l.length}</span>
        <span class="fut">${x.r ? `<span class="fpill r">${x.r} follow-up</span>` : ""}${x.a ? `<span class="fpill a">${x.a} to check</span>` : ""}${x.q ? `<span class="fpill q">${x.q} note${x.q > 1 ? "s" : ""}</span>` : ""}${x.adm ? `<span class="fpill n">${x.adm} admit</span>` : ""}${!x.r && !x.a && !x.q && !x.adm ? `<span class="muted">All clear</span>` : ""}</span></a>`).join("")}</div>
    </div>
    <div class="row" style="margin:20px 0 8px"><h2 style="margin:0">All patients</h2><span class="sp"></span><button class="btn sm" id="billAll">${ic("count", 13)} Billing</button><button class="btn sm" id="ovAll">${S.ovAll ? "Collapse all" : "Expand all"}</button></div>
    <div class="card" id="ov" data-help="table">${UNITS.map(u => {
      const l = unitPts(u), open = S.ovAll || S.expanded?.has(u);
      const nFlag = l.filter(p => loud(flagsFor(p)).length).length;
      return `<div class="ovu ${open ? "open" : ""}" data-u="${u}"><div class="ovh"><span class="ovn">${u.toUpperCase()}</span>
        <span class="muted">${l.length} patient${l.length === 1 ? "" : "s"}${nFlag ? ` · ${nFlag} with pertinent issues` : ""}</span><span class="sp"></span><span class="chev">▸</span></div>
        <div class="ovb">${l.length ? `<table class="ovt xl zebra"><tr><th></th><th>Patient</th>${C.issues ? "<th>Pertinent issues</th>" : ""}<th>Medical diagnoses</th>${C.psych ? "<th>Psychiatric diagnosis</th>" : ""}${C.notes ? "<th>Notes</th>" : ""}${C.yest ? `<th title="Billing level yesterday">Yest.</th>` : ""}${C.today ? `<th title="Billing level today">Today</th>` : ""}${C.a3 ? "<th>Always 3?</th>" : ""}</tr>
          ${l.map((p, i) => { const names = p.problems.map(q => q.name), f = loud(flagsFor(p)).filter(x => (x.level === "red" ? t.issues.red : t.issues.amber)).map(x => x.text).filter(x => !/^Taking insulin\?/.test(x) && !names.includes(x));
            if (t.issues.keep) f.push(...(p.notes || []).filter(n => n.kind === "keep").map(n => n.text));
            const qn = (p.notes || []).some(n => n.kind === "quick" && !n.done);
            return `<tr data-pt="${p.id}"><td class="muted">${i + 1}</td><td class="nm"><b>${esc(p.name)}</b>${t.patient.admit ? admA(p) : ""}${t.patient.notes ? qnTag(p) : ""}</td>
              ${C.issues ? `<td>${esc(f.join("; "))}</td>` : ""}<td>${dxCell(p)}</td>${C.psych ? `<td>${esc(t.psych.short ? String(p.psych?.dx || "").split(/[,(;]/)[0] : p.psych?.dx || "")}</td>` : ""}${C.notes ? `<td>${notesCell(p)}</td>` : ""}
              ${C.yest ? `<td class="muted" style="text-align:center">${esc(effBill(p, yest)) || "—"}</td>` : ""}
              ${C.today ? `<td><input class="cell" data-bill value="${esc(p.bill?.[S.today] ?? "")}" placeholder="${t.today.default3 && always3(p) ? "3" : ""}" maxlength="1" inputmode="numeric"></td>` : ""}
              ${C.a3 ? `<td><select class="cell" data-a3>${["~", "P", "M", "OD"].map(o => `<option ${a3(p) === o ? "selected" : ""}>${o}</option>`).join("")}</select></td>` : ""}</tr>`; }).join("")}</table>` : `<p class="muted" style="padding:10px">No patients.</p>`}</div></div>`;
    }).join("")}</div>
    ${canEditTable() ? `<div class="row" style="margin-top:8px"><span class="sp"></span><button class="btn sm" id="tSet">${ic("palette", 14)} Table settings</button></div>` : ""}
    ${S.store.demo ? `<p class="warnbox">Demo mode: every patient here is fake, and nothing touches the U: drive.</p>` : ""}
  </div>
  <aside class="rail">
    <div class="countcard" data-help="count"><div class="cch">${ic("count")} Today's count${day.count ? `<span class="sp"></span><button class="btn sm" id="reC">Redo</button>` : ""}</div>
      ${day.count ? `<pre>${esc(day.count.text)}</pre><div class="ccf">saved by ${esc(day.count.by || "")}</div>` : `<p>Not generated yet. Fill in the provider bar, then tap Generate count.</p>`}</div>
    <div class="railsec" data-help="ann">
      <div class="row rh">${ic("megaphone")}<b>Announcements</b><span class="sp"></span>${canAnnounce().length ? `<button class="btn sm" id="aAdd">${ic("plus", 13)} Post</button>` : ""}</div>
      ${anns.slice().reverse().map(a => `<div class="sticky ann"><div>${esc(a.text).replace(/\n/g, "<br>")}</div><div class="sh" style="margin:6px 0 0"><span class="muted">${esc(a.by || "")} · to ${a.to} · ${md(a.date)}</span><span class="sp"></span>
        ${a.byId === S.user?.id ? `<button class="btn sm" data-adel="${a.id}" title="Delete for everyone">${ic("x", 12)}</button>` : ""}<button class="btn sm" data-aok="${a.id}">${ic("check", 12)} Got it</button></div></div>`).join("") || `<p class="muted small">Nothing new.</p>`}
    </div>
    <div class="railsec" data-help="pinned">
      <div class="row rh">${ic("pin")}<b>Pinned Notes</b><span class="sp"></span><button class="btn sm" id="bAdd">${ic("plus", 13)} Note</button></div>
      ${(S.board || []).slice().reverse().map((n, i) => `<div class="sticky board c${i % 3}"><div>${n.popup ? `<span class="popbadge" title="Shows big on linked notes">${ic("pin", 11)}</span>` : ""}${withLinks(n.text, n.links)}</div>
        <div class="sh" style="margin:6px 0 0"><span class="muted">${esc(n.by || "")} · ${md(n.date)}</span><span class="sp"></span><button class="btn sm" data-bd="${n.id}">${ic("check", 12)} Resolved</button></div></div>`).join("") || `<p class="muted small">Nothing pinned.</p>`}
    </div>
  </aside></div>`;
  $("#imp").onclick = e => busy(e.currentTarget, importNotes);
  $("#addAdm").onclick = bulkAdmits;
  const dayField = (id, key, clean = v => v.trim()) => $(id).onchange = async e => { await saveDay({ [key]: clean(e.target.value) }); toast("Saved"); };
  const mil = v => v.replace(/\D/g, "") ? v.replace(/\D/g, "").padStart(4, "0").slice(-4) : "";
  dayField("#dP", "provider"); dayField("#dIn", "in", mil); dayField("#dOut", "out", mil); dayField("#dE", "ekg", v => v.replace(/\D/g, ""));
  $("#genC").onclick = countModal; $("#reC")?.addEventListener("click", countModal);
  $("#bAdd").onclick = boardModal; $("#aAdd")?.addEventListener("click", annModal); $("#tSet")?.addEventListener("click", tableSettings);
  $$("[data-bd]").forEach(b => b.onclick = async () => { await boardSave(list => { const i = list.findIndex(x => x.id === b.dataset.bd); if (i >= 0) list.splice(i, 1); }); home(); });
  $$("[data-aok]").forEach(b => b.onclick = async () => { await annSave(list => { const a = list.find(x => x.id === b.dataset.aok); if (a) (a.seen ||= []).push(S.user?.id); }); home(); });
  $$("[data-adel]").forEach(b => b.onclick = async () => { if (await ask("Delete announcement?", "Removes it for everyone.", "Delete")) { await annSave(list => { const i = list.findIndex(x => x.id === b.dataset.adel); if (i >= 0) list.splice(i, 1); }); home(); } });
  $$(".ovh").forEach(h => h.onclick = () => { const u = h.parentElement.dataset.u; (S.expanded ||= new Set()).has(u) ? S.expanded.delete(u) : S.expanded.add(u); h.parentElement.classList.toggle("open"); });
  $("#billAll").onclick = () => billingModal();
  $("#ovAll").onclick = () => { S.ovAll = !S.ovAll; if (!S.ovAll) S.expanded = new Set(); home(); };
  $$("tr[data-pt]").forEach(tr => {
    const pt = findPt(tr.dataset.pt);
    tr.onclick = e => { if (!e.target.closest(".cell")) location.hash = "pt-" + pt.id; };
    $("[data-bill]", tr)?.addEventListener("change", e => { const v = e.target.value.trim(); pt.bill ||= {}; if (v) pt.bill[S.today] = v; else delete pt.bill[S.today]; saveNow(pt, { docx: false, why: `Billing ${v || "cleared"}` }); toast("Saved"); });
    $("[data-a3]", tr)?.addEventListener("change", e => { pt.always3 = e.target.value; saveNow(pt, { docx: false, why: `Always 3: ${e.target.value}` }); toast("Saved"); home(); });
  });
}

// Always-3 code, guessed from the note (the provider can override it in the table).
function autoA3(p, live) {
  const names = live.map(q => q.name).join(" ") + " " + (p.psych?.dx || "");
  if (/overdose|\bOD\b/i.test(names)) return "OD";
  if (/suicide attempt|schizophrenia/i.test(names)) return "P";
  if (loud(flagsFor(p)).some(f => f.level === "red" && !/was it ordered\?$/.test(f.text))) return "M";
  return "~";
}

// ---------------- import old Word notes ----------------
async function importNotes() {
  const m = modal("Import notes", `<p class="muted">Looking through the team folder…</p>`, "", true);
  // Look everywhere a note might have been dropped: unit folders, the top folder,
  // other top-level folders (like an unzipped download), even _app-data/patients.
  const sources = [], zips = [];
  const unitOf = name => UNITS.find(u => name.toLowerCase().includes(u.toLowerCase()));
  const add = async (dir, where, unit) => {
    for (const e of await S.store.entries(dir)) {
      if (e.h.kind !== "file") continue;
      if (/\.zip$/i.test(e.name)) zips.push(where + "/" + e.name);
      if (/\.docx$/i.test(e.name) && !e.name.startsWith("~$") && !/ADMIT\.docx$/i.test(e.name)) sources.push({ dir, e, where, unit });
    }
  };
  await add(S.store.root, "Top folder", null);
  for (const e of await S.store.entries(S.store.root)) {
    if (e.h.kind !== "directory" || /template/i.test(e.name)) continue;
    if (e.name === "_app-data") { const pd = await S.store.dir(e.h, "patients"); if (pd) await add(pd, "_app-data/patients", null); continue; }
    await add(e.h, e.name, unitOf(e.name) || null);
  }
  const found = []; let k = 0;
  const todo = sources.filter(s => !S.pts.some(p => p.file === s.e.name.replace(/\.docx$/i, "") && active(p)));
  await pool(todo, 6, async s => {
    const file = s.e.name.replace(/\.docx$/i, "");
    try {
      const pt = await readDocx(window.JSZip, await (await s.e.h.getFile()).arrayBuffer(), s.e.name);
      found.push({ ...s, file, pt, unit: s.unit || UNITS.find(u => u.toLowerCase() === String(pt.unit).toLowerCase()) || "" });
    } catch (err) { found.push({ ...s, file, bad: true }); }
    const t = $(".mb", m); if (t) t.innerHTML = `<div style="text-align:center;padding:20px"><div class="spin big"></div><p class="muted" style="margin-top:10px">Reading notes… ${++k} of ${todo.length}</p></div>`;
  });
  found.sort((a, b) => (a.pt?.name || a.file).localeCompare(b.pt?.name || b.file));
  const legacyAdmits = (await S.store.docxIn(S.store.root)).filter(e => /ADMIT\.docx$/i.test(e.name) && !S.pts.some(p => `${p.file} ADMIT.docx` === e.name));
  const ok = found.filter(f => !f.bad);
  $(".mb", m).innerHTML = `
    ${zips.length ? `<p class="warnbox">Found ${zips.length} .zip file(s). Downloads from SharePoint come zipped: right-click the zip, choose <b>Extract All</b>, then try again.</p>` : ""}
    ${ok.length ? `<p class="muted">Notes not in the app yet. Check each one's unit (read from the note's header). After import, each Word file is moved into its unit folder, and the original is backed up the first time the app rewrites it.</p>
    <div style="margin-top:8px">${found.map((f, i) => f.bad ? `<div class="chk"><input type="checkbox" disabled><div>${esc(f.file)}<small>Couldn't read this file (${esc(f.where)})</small></div></div>` :
      `<div class="chk"><input type="checkbox" checked data-i="${i}"><div style="flex:1">${esc(f.pt.name || f.file)}<small>${f.pt.problems.length} problems · found in ${esc(f.where)}</small></div>
      <select data-u="${i}" class="btn sm">${["", ...UNITS].map(u => `<option ${u === f.unit ? "selected" : ""} value="${u}">${u || "Pick unit"}</option>`).join("")}</select></div>`).join("")}</div>`
    : `<p class="muted">No new notes found. Put each unit's Word notes inside that unit's folder (or anywhere in the team folder), then tap Import again.</p>`}
    ${legacyAdmits.length ? `<p class="warnbox">${legacyAdmits.length} hand-made H&amp;P file(s) at the top can't be imported yet. Finish those the usual way, or re-enter them with + New H&amp;P.</p>` : ""}`;
  if (!ok.length) return;
  const foot = document.createElement("div"); foot.className = "mfoot";
  foot.innerHTML = `<button class="btn" data-x>Cancel</button><button class="btn p" id="doImp">Import</button>`;
  $(".modal", m).append(foot);
  $("#doImp").onclick = async () => {
    const pick = $$("[data-i]", m).filter(c => c.checked).map(c => found[+c.dataset.i]);
    for (const f of pick) f.unit = $(`[data-u="${found.indexOf(f)}"]`, m).value;
    if (pick.some(f => !f.unit)) return toast("Pick a unit for every checked note");
    m.close(); const pg = progress(`Importing ${pick.length} notes`);
    let n = 0, bad = [], i = 0;
    await pool(pick, 4, async f => {
      try {
        const pt = f.pt; pt.unit = f.unit; pt.file = f.file; pt.id = (pt.id + "-" + uid()).replace(/[^a-z0-9-]/gi, "");
        const target = await S.store.unitDir(f.unit, true);
        if (!(await target.isSameEntry(f.dir))) {
          if (await S.store.exists(target, f.e.name)) await f.dir.removeEntry(f.e.name);   // a copy is already in the unit folder
          else await S.store.move(f.dir, f.e.name, target);
        }
        await S.store.savePatient(pt, true); S.pts.push(pt); n++;
      } catch (err) { bad.push(f.file); console.warn(err); }
      pg.set(`${++i} of ${pick.length}`, i / pick.length);
    });
    pg.close(); toast(`Imported ${n}${bad.length ? `, couldn't import ${bad.length}` : ""}`); route();
  };
}

// ---------------- unit view ----------------
function unitView(u) {
  if (!UNITS.includes(u)) return home();
  const l = unitPts(u), y = E.addDays(S.today, -1), tmw = E.addDays(S.today, 1);
  const isPrepped = p => lastDate(p) > S.today;
  const preppedCount = l.filter(isPrepped).length;
  const has = (q, d) => (q.planOnly ? q.plan : q.hpi).some(e => e.date === d);
  const behind = l.filter(p => p.status !== "admit" && p.problems.some(q => !(q.resolved && q.resolved < S.today) && !q.parked && q.start < S.today
    && (q.planOnly ? q.plan : q.hpi).length && !has(q, S.today)));
  $("#main").innerHTML = `
    <div class="row" style="margin-bottom:12px"><h1>${u}</h1><span class="muted">${l.length} patients</span><span class="sp"></span>
      <button class="btn" id="qn">${ic("note")} Make a Note</button><button class="btn" id="vit">${ic("vitals")} Vitals</button><button class="btn" id="labsU">${ic("labs")} Labs</button><button class="btn" id="prn">${ic("print")} Print unit</button><button class="btn" id="bill">${ic("count")} Billing</button><button class="btn go" id="prep">${preppedCount && preppedCount === l.filter(p => p.status !== "admit").length ? `✓ Prepped for ${md(tmw)}` : `Prep for ${md(tmw)}`}</button></div>
    ${preppedCount ? `<div class="al" style="background:var(--hover);border-color:var(--accent);margin-bottom:10px">${preppedCount} of ${l.length} notes prepped for ${md(tmw)}.<span class="sp"></span><button class="btn sm" id="unprepU">Unprep ${u}</button></div>` : ""}

    ${behind.length ? `<div class="al amber" style="margin-bottom:10px">${behind.length} note${behind.length > 1 ? "s aren't" : " isn't"} prepped for today (${md(S.date)}).<span class="sp"></span><button class="btn sm" id="catch">Prep from ${md(y)}</button></div>` : ""}
    <div class="card list">${l.length ? l.map(p => {
      const fs = loud(flagsFor(p)); const top = fs.find(f => f.level === "red") || fs[0];
      const qn = (p.notes || []).filter(n => n.kind === "quick" && !n.done).length;
      return `<a class="it" href="#pt-${p.id}"><span class="nm">${esc(p.name)}${p.status === "admit" ? `<span class="admpill">${ic("hp", 12)} New admit</span>${!hpReady(p) ? `<b class="needprep">Needs prep</b>` : ""}` : ""}${qn ? `<span class="qpill">${ic("note", 12)} ${qn} note${qn > 1 ? "s" : ""} to write up</span>` : ""}</span>
        <span class="mk ${top ? (top.level === "red" ? "r" : "a") : "q"}">${top ? esc(top.text) + (fs.length > 1 ? ` +${fs.length - 1}` : "") : "ready"}</span></a>`;
    }).join("") : `<div class="it"><span class="muted">No patients on ${u}.</span></div>`}</div>
    ${(() => { const dc = S.pts.filter(p => p.unit === u && p.status === "discharged").sort((a, b) => (b.dischargedOn || "").localeCompare(a.dischargedOn || ""));
      return dc.length ? `<details class="dcbox"><summary>${ic("door", 14)} Discharged <span class="muted">(${dc.length})</span></summary><div class="card list">${dc.map(p => `<a class="it" href="#pt-${p.id}"><span class="nm">${esc(p.name)}</span><span class="mk q">discharged ${p.dischargedOn ? md(p.dischargedOn) : ""}</span></a>`).join("")}</div></details>` : ""; })()}
    <div class="row" style="margin-top:14px"><span class="sp"></span><button class="btn sm" id="reimp">${ic("history", 13)} Reset ${u} files to originals</button></div>`;
  $("#reimp").onclick = () => restartUnit(u);
  $("#unprepU")?.addEventListener("click", e => busy(e.currentTarget, async () => {
    if (!(await ask(`Unprep ${u}?`, `Removes everything added for ${md(tmw)} so the notes go back to today (${md(S.today)}). H&amp;Ps converted today go back to H&amp;Ps.`, "Unprep"))) return;
    const pg = progress(`Unprepping ${u}`); try { await pool(l.filter(isPrepped), 6, p => unprep(p)); } finally { pg.close(); } toast(`${u} is back to ${md(S.today)}`); route();
  }));
  $("#vit").onclick = () => vitalsModal(u);
  $("#labsU").onclick = () => bulkLabs(u);
  $("#qn").onclick = () => stickyModal(l);
  $$(".dcbox .it").forEach(a => a.addEventListener("click", () => {}));
  $("#prn").onclick = () => printModal(unitPts(u));
  $("#bill").onclick = () => billingModal(u);
  $("#prep").onclick = e => busy(e.currentTarget, () => prepUnit(u));
  $("#catch")?.addEventListener("click", e => busy(e.currentTarget, async () => {
    const pg = progress(`Prepping ${u} for ${md(S.today)}`);
    try { let i = 0; for (const p of behind) { pg.set(`${p.name} (${++i} of ${behind.length})`, i / behind.length); E.prep(p, y); await saveNow(p); } }
    finally { pg.close(); }
    toast("Caught up"); route();
  }));
}

// Undo the app's changes for a unit (or just some patients): put the original Word files back and import them again.
async function restartUnit(u) {
  const orig = await S.store.dir(await S.store.data(), "originals", true);
  const backups = (await S.store.entries(orig)).filter(e => e.h.kind === "file" && e.name.startsWith(u + " - ")).map(e => ({ e, file: e.name.slice(u.length + 3).replace(/\.docx$/i, "") }));
  const pts = S.pts.filter(p => p.unit === u && active(p));
  const rows = pts.map(p => ({ p, b: backups.find(b => b.file === p.file) }));
  const m = modal(`${ic("history")} Reset ${u} files to originals`, `
    <p style="font-size:14px;margin-bottom:8px"><b>This can't be undone.</b> For each patient you pick:</p>
    <ul class="bul"><li>Their Word file is replaced with the <b>original</b> one from before NoteMaker first changed it.</li>
      <li>Everything done in NoteMaker for them is <b>erased</b>: edits, preps, meds, flags addressed, notes, billing.</li>
      <li>Then Import opens so you can bring the originals back in.</li>
      <li>Patients with no saved original only lose NoteMaker's copy; their current Word file stays as it is.</li></ul>
    <label class="switch" style="margin:10px 0" data-nodirty><input type="checkbox" id="rsPick"><i></i>Only reset some patients</label>
    <div id="rsList" hidden data-nodirty>${rows.map((r, k) => `<label class="chk"><input type="checkbox" data-k="${k}" checked><div>${esc(r.p.name)}<small>${r.b ? "original saved" : "no original saved"}</small></div></label>`).join("")}</div>
    <div class="f" style="margin-top:10px"><span>Type RESET to confirm</span><input id="rsT" autocomplete="off" data-nodirty></div>`,
    `<button class="btn" data-x>Cancel</button><button class="btn warn" id="rsGo" disabled>Reset files</button>`);
  $("#rsPick", m).onchange = e => { $("#rsList", m).hidden = !e.target.checked; };
  $("#rsT", m).oninput = e => { $("#rsGo", m).disabled = e.target.value.trim().toUpperCase() !== "RESET"; };
  $("#rsGo", m).onclick = async () => {
    const pick = $("#rsPick", m).checked ? $$("[data-k]", m).filter(c => c.checked).map(c => rows[+c.dataset.k]) : rows;
    if (!pick.length) return toast("Pick at least one patient");
    m.close(true); const pg = progress(`Resetting ${pick.length} file${pick.length > 1 ? "s" : ""}`);
    try {
      const unitDir = await S.store.unitDir(u, true), pdir = await S.store.patientsDir();
      let i = 0;
      for (const { p, b } of pick) {
        pg.set(`${p.name} (${++i} of ${pick.length})`, i / pick.length);
        if (b) { await S.store.write(unitDir, b.e.name.slice(u.length + 3), await (await b.e.h.getFile()).arrayBuffer()); await orig.removeEntry(b.e.name); }
        try { await pdir.removeEntry(p.id + ".json"); } catch {}
        S.pts = S.pts.filter(x => x !== p); SV.good.delete(p.id);
      }
    } finally { pg.close(); }
    route(); await importNotes();
  };
}

// ---------------- patient view ----------------
// The note shows only what prints. Flags become underlines in the text and comment cards in the margin, like Word.
const val = (pt, k) => pt.vitals?.[S.date]?.[k];
function entriesHtml(list, date) {
  return list.filter(e => e.date <= date).sort((a, b) => a.date < b.date ? -1 : 1)
    .map(e => { const t = `${md(e.date)}: ${esc(/[.!?]$/.test(e.text.trim()) || !e.text.trim() ? e.text.trim() : e.text.trim() + ".")}`; return e.date === date ? `<span class="new">${t}</span>` : t; }).join(" ");
}
const worst = fs => fs.some(f => f.level === "red") ? "red" : fs.some(f => f.level === "amber") ? "amber" : fs.length ? "soft" : "";
function probPara(pt, p, kind, fs) {
  const open = kind === "hpi" ? p.hpiOpen : p.planOpen;
  const ent = entriesHtml(kind === "hpi" ? p.hpi : p.plan, S.date);
  const lv = worst(fs.filter(f => f.problemId === p.id && f.level !== "done")) || (fs.some(f => f.problemId === p.id && f.level === "done") ? "done" : "");
  return `<span class="dxn ${lv ? "u-" + lv : ""}">${esc(p.name)}</span>: ${open ? esc(open.replace(/\.?$/, ".")) + " " : ""}${ent}`;
}
// Which paragraph each flag belongs to.
function anchorFor(pt, f, live) {
  if (f.problemId) { const p = live.find(q => q.id === f.problemId); if (p) return p.planOnly ? `p-${p.id}` : `h-${p.id}`; }
  if (/pending/i.test(f.text)) return "labsPara";
  if (/^Refusing/.test(f.text)) { const p = live.find(q => q.meds.some(m => (pt.refusing || []).includes(m.id))); if (p) return `h-${p.id}`; }
  return "noteTop";
}
function ptView(id) {
  const pt = findPt(id); if (!pt) return home();
  const date = S.date, fs = flagsFor(pt), ro = !!S.viewDate;
  const live = pt.problems.filter(p => p.start <= date && !(p.resolved && p.resolved < date));
  const peOver = { ...(pt.peExtra || {}) }, peBy = {};
  live.filter(p => p.peLine).forEach(p => { peOver[p.peLine.key] = p.peLine.text; peBy[p.peLine.key] = p.name; });
  const v = pt.vitals?.[date] || pt.vitals?.[S.today] || {};
  const n = E.render(pt, date);
  const loudF = loud(fs);
  // margin comments
  const doneF = ro ? [] : (pt.addrLog || []).filter(a => a.date === S.today && !fs.some(f => f.text === a.text)).map(a => ({ level: "done", text: a.text, problemId: a.problemId, by: a.by }));
  const cm = ro ? [] : [...fs.filter(f => !/^Exam (changed by|not template)/.test(f.text)), ...doneF].map((f, i) => ({ id: "c" + i, f, at: anchorFor(pt, f, live) }));
  const fsU = [...fs, ...doneF];
  Object.keys(peOver).forEach(k => cm.push({ id: "pe-" + k, f: { level: "soft", text: peBy[k] ? `Exam line changed by ${peBy[k]}. Reverts when it resolves.` : "Exam line isn't the template." }, at: "pe-" + k }));
  const ccls = id => cm.filter(c => c.at === id).map(c => c.id).join(" ");
  const pp = (id, cls, attrs, inner) => `<div class="pp ${cls}" id="${id}" ${attrs} data-c="${ccls(id)}">${inner}</div>`;
  $("#main").innerHTML = `<div class="ptwrap">
    <nav class="side">${unitPts(pt.unit).map(p => { const c = loud(flagsFor(p)); const r = c.filter(f => f.level === "red").length;
      const qn = (p.notes || []).some(n => n.kind === "quick" && !n.done);
      return `<a href="#pt-${p.id}" class="${p.id === id ? "on" : ""}"><span>${esc(p.name)}${admA(p)}${qnTag(p)}</span>${c.length ? `<span class="pill ${r ? "r" : "a"}">${c.length}</span>` : `<small class="ok">ready</small>`}</a>`; }).join("")}</nav>
    <div style="min-width:0">
      ${ro ? `<div class="al amber" style="margin-bottom:10px">Old version: how this note read on ${md(S.viewDate)}. Read only.<span class="sp"></span><button class="btn sm" id="reprint">${ic("print", 13)} Print this version</button><button class="btn sm" id="backNow">Back to current</button></div>`
        : lastDate(pt) > S.today ? `<div class="al" style="background:var(--hover);border-color:var(--accent);margin-bottom:10px">Prepped for ${md(lastDate(pt))}.<span class="sp"></span><button class="btn sm" id="unprepP">Unprep</button></div>` : ""}
      ${!ro && pt.clashes?.length ? `<div class="al amber" style="margin-bottom:10px">Saved on two computers at once: ${pt.clashes.length} spot${pt.clashes.length > 1 ? "s" : ""} to pick between.<span class="sp"></span><button class="btn sm" id="rcOpen">Pick versions</button></div>` : ""}
      ${!ro && pt.status === "admit" ? `<div class="al ${hpReady(pt) ? "" : "amber"} hpst" style="margin-bottom:10px;${hpReady(pt) ? "background:var(--hover);border-color:var(--accent)" : ""}">${hpReady(pt) ? `<b class="prepok" style="margin:0">Ready</b> H&amp;P is ready for the provider.` : `<b class="needprep" style="margin:0">Needs prep</b> H&amp;P still pending.`}<span class="sp"></span><a class="btn sm" href="#hp-${pt.id}" style="text-decoration:none">${ic("hp", 13)} Edit H&amp;P form</a><button class="btn sm" id="hpTog">${hpReady(pt) ? "Mark pending" : "Mark ready to see"}</button></div>` : ""}
      ${ro ? "" : `<div class="tools" data-help="tools">
        <button class="btn go big" id="addP">${ic("plus")} Add diagnosis</button>
        <button class="btn ic" id="labs">${ic("labs")}<span>Add labs</span></button>
        <button class="btn ic" id="stk">${ic("note")}<span>Add a note</span></button>
        <span class="sp"></span>
        <button class="btn ic" id="reprint">${ic("print")}<span>Print</span></button>
        <div class="more"><button class="btn ic" id="moreB" title="More">${ic("more")}<span>More</span></button>
          <div class="menu" id="moreM" hidden>
            <button data-m="vit">${ic("vitals")} Vitals</button><button data-m="pe">${ic("user")} Physical exam</button><button data-m="info">${ic("user")} Patient info &amp; history blurb</button><button data-m="psy">${ic("psych")} Psych / primary diagnosis line</button>
            ${pt.status === "admit" ? `<button data-m="hp">${ic("hp")} Edit H&amp;P form</button>` : ""}
            <button data-m="hist">${ic("history")} Who edited this note</button>${pt.status === "discharged" ? `<button data-m="undc">${ic("door")} Undo discharge</button>` : `<button data-m="dc" class="warn">${ic("door")} Discharge</button>`}</div></div></div>
      ${stickyPanel(pt)}`}
      <div class="notewrap ${cm.length ? "has-c" : ""}">
      <div class="paper" id="paper" data-help="paper">
        <div class="hdr" id="noteTop" data-c="${ccls("noteTop")}"><span>${esc(pt.name)}</span><span>DOB ${esc(pt.dob || "—")} · MRN ${esc(pt.mrn || "—")}</span><span>Unit: ${pt.unit}</span><span>${md(date)}/${date.slice(0, 4)}</span></div>
        <div class="ttl">${pt.status === "admit" ? "HISTORY AND PHYSICAL EXAMINATION" : "MEDICAL PROGRESS NOTE:"}</div>
        <div class="box">CHIEF COMPLAINT/HISTORY OF PRESENT ILLNESS:</div>
        <div class="pp click" data-edit="blurb">${esc(pt.blurb) || `<span class="muted">Add the patient history blurb…</span>`}</div>
        ${live.filter(p => !p.planOnly).map(p => pp(`h-${p.id}`, "click", `data-prob="${p.id}"`, probPara(pt, p, "hpi", fsU)) + `<div data-slot="${p.id}"></div>`).join("") ||
          `<ul class="dash"><li>${md(date)}: Patient reports no medical or physical concerns today.</li></ul>`}
        <div class="boxed"><div class="bl">RESOLVED HPI:</div><div class="bc">${n.resolvedHpi.map(esc).join("<br>")}</div></div>
        <div class="box">REVIEW OF SYSTEMS: <em>Systems were reviewed and normal, except as noted in the HPI.</em></div>
        <div class="box">PHYSICAL EXAMINATION:</div>
        <table class="vs pp click" data-edit="vitals"><tr><th>BP</th><th>Pulse</th><th>RR</th><th>Temp</th><th>O2 Sat</th><th>BG</th></tr>
          <tr><td>${esc(v.bp || "—")}</td><td>${esc(v.hr || "—")}</td><td>${esc(v.rr || "—")}</td><td>${esc(v.temp || "—")}</td><td>${esc(v.o2 || "—")}</td><td>${esc(v.bg || "N/A")}</td></tr></table>
        <div class="pl pp click" data-edit="pe">${PE_LINES.map(([k, d]) => peOver[k] ? `<div class="pp" id="pe-${k}" data-c="${ccls("pe-" + k)}"><span class="u-soft">${k}: ${esc(peOver[k])}</span></div>` : `<div>${k}: ${esc(d)}</div>`).join("")}</div>
        <div class="box">LABORATORY DATA:</div>
        ${pp("labsPara", "click", `data-edit="labs"`, (pt.labs || []).length ? pt.labs.map(l => `${esc(l.text)}${(l.bullets || []).map(b => `<br>&nbsp;&nbsp;- ${esc(b)}`).join("")}`).join("<br>") : "All Labs Pending")}
        <div class="box">ASSESSMENT/PLAN:</div>
        <div class="pp">Diet is regular.<br>Activity is as tolerated.</div>
        <div class="pp click" data-edit="psych">${n.plan[0] && pt.psych?.dx ? esc(n.plan[0]).replace(/\n/g, "<br>") : `<span class="muted">Add the primary (psych) diagnosis…</span>`}</div>
        ${live.filter(p => p.planOnly).map(p => `<div data-slot="${p.id}"></div>`).join("")}
        ${live.filter(p => !p.hpiOnly).map(p => pp(`p-${p.id}`, "click", `data-prob="${p.id}"`, probPara(pt, p, "plan", fsU))).join("")}
        <div class="boxed"><div class="bl">RESOLVED PLAN:</div><div class="bc">${n.resolvedPlan.map(esc).join("<br>")}</div></div>
        <div class="box">FOLLOW UP WITH PRIMARY CARE PROVIDER FOR THE FOLLOWING:</div>
        <div class="pp">- ${esc([...n.pcp, ...(pt.pcpExtra || [])].join(", ") || "N/A")}</div>
      </div>
      ${cm.length || loudF.length ? `<aside class="comments" id="cmts" data-help="comments">
        ${loudF.length ? `<div class="glance" data-help="alerts"><div class="gh">${ic("flag", 14)} Needs attention <span class="gn">${loudF.length}</span></div>
          ${loudF.map((f, i) => { const at = anchorFor(pt, f, live); return `<div class="gi ${f.level} ${i > 2 ? "more" : ""}"><span>${esc(f.text)}</span>${at !== "noteTop" ? `<button class="btn sm" data-goto="${at}">${ic("goto", 12)} Go to</button>` : `<button class="btn sm" data-addr="${esc(f.text)}">${ic("check", 12)}</button>`}</div>`; }).join("")}
          ${loudF.length > 3 ? `<button class="gmore" id="gMore">+${loudF.length - 3} more</button>` : ""}</div>` : ""}
        <div class="cmtlayer">${cm.map(c => `<div class="cmt ${c.f.level}" id="${c.id}" data-at="${c.at}">
        <div class="ct">${esc(c.f.text)}</div>
        ${c.f.level === "red" || c.f.level === "amber" ? `<div class="ca">${c.f.text.startsWith("Uncommon: ") ? `<button class="btn sm" data-routine="${esc(c.f.text.slice(10))}">Mark routine</button><button class="btn sm" data-always="${esc(c.f.text.slice(10))}">Always flag</button>` : ""}<button class="btn sm" data-addr="${esc(c.f.text)}">${ic("check", 12)} Addressed</button></div>` : c.f.level === "done" ? `<div class="cd">${ic("check", 11)} Addressed${c.f.by ? " by " + esc(c.f.by) : ""}</div>` : ""}</div>`).join("")}</div></aside>` : ""}
      </div>
    </div></div>`;
  layoutComments();
  $("#gMore")?.addEventListener("click", e => { const g = e.target.closest(".glance"); g.classList.toggle("open"); e.target.textContent = g.classList.contains("open") ? "Show less" : `+${loudF.length - 3} more`; layoutComments(); });
  // hover link between a paragraph and its comments
  $$("[data-c]").forEach(el => { const ids = (el.dataset.c || "").split(" ").filter(Boolean); if (!ids.length) return;
    el.addEventListener("mouseenter", () => ids.forEach(i => $("#" + i)?.classList.add("hot"))); el.addEventListener("mouseleave", () => ids.forEach(i => $("#" + i)?.classList.remove("hot"))); });
  $$(".cmt").forEach(c => { const a = () => $("#" + c.dataset.at);
    c.addEventListener("mouseenter", () => { c.classList.add("hot"); a()?.classList.add("hot"); }); c.addEventListener("mouseleave", () => { c.classList.remove("hot"); a()?.classList.remove("hot"); });
    c.addEventListener("click", e => { if (!e.target.closest("button")) a()?.scrollIntoView({ behavior: "smooth", block: "center" }); }); });
  $$("[data-goto]").forEach(b => b.onclick = () => { const t = $("#" + b.dataset.goto); if (!t) return; t.scrollIntoView({ behavior: "smooth", block: "center" }); t.classList.add("hot", "pulse"); setTimeout(() => t.classList.remove("hot", "pulse"), 1800); });
  wireSticky(pt);
  $$("[data-addr]").forEach(b => b.onclick = () => busy(b, () => address(pt, b.dataset.addr)));
  $$("[data-routine]").forEach(b => b.onclick = () => setRule(b.dataset.routine, { routine: true }));
  $$("[data-always]").forEach(b => b.onclick = () => setRule(b.dataset.always, { alwaysFlag: true }));
  if (ro) { $$("#paper .click").forEach(el => { el.classList.remove("click"); el.removeAttribute("data-edit"); el.removeAttribute("data-prob"); }); }
  $$("[data-prob]").forEach(el => el.onclick = e => { if (!e.target.closest(".ed")) openEditor(pt, el.dataset.prob); });
  $('[data-edit="blurb"]')?.addEventListener("click", () => infoModal(pt));
  $('[data-edit="vitals"]')?.addEventListener("click", () => vitalsModal(pt.unit, pt.id));
  $('[data-edit="labs"]')?.addEventListener("click", () => labsModal(pt));
  $('[data-edit="psych"]')?.addEventListener("click", () => psychModal(pt));
  $('[data-edit="pe"]')?.addEventListener("click", () => peModal(pt));
  $("#addP")?.addEventListener("click", () => addProblem(pt));
  $("#stk")?.addEventListener("click", () => stickyModal([pt]));
  $("#labs")?.addEventListener("click", () => labsModal(pt));
  $("#reprint")?.addEventListener("click", () => reprintModal(pt));
  $("#rcOpen")?.addEventListener("click", () => reconcileModal(pt));
  $("#hpTog")?.addEventListener("click", async () => { pt.hpReady = !hpReady(pt); delete pt.needsPrep; await saveNow(pt, { docx: false, why: pt.hpReady ? "H&P marked ready" : "H&P marked pending" }); route(); });
  $("#moreB")?.addEventListener("click", e => { e.stopPropagation(); const m = $("#moreM"); m.hidden = !m.hidden; if (!m.hidden) setTimeout(() => document.addEventListener("click", () => { m.hidden = true; }, { once: true })); });
  $$("[data-m]").forEach(b => b.onclick = () => { const k = b.dataset.m;
    if (k === "vit") vitalsModal(pt.unit, pt.id); if (k === "pe") peModal(pt); if (k === "undc") undischarge(pt); if (k === "info") infoModal(pt); if (k === "psy") psychModal(pt); if (k === "hp") location.hash = "hp-" + pt.id; if (k === "dc") discharge(pt);
    if (k === "hist") modal("Who edited this note", `<table class="ovt zebra"><tr><th>When</th><th>Who</th><th>What</th></tr>${(pt.log || []).slice().reverse().slice(0, 60).map(l => `<tr><td>${new Date(l.at).toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}</td><td><b>${esc(l.by)}</b></td><td>${esc(l.what)}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">No edits recorded yet.</td></tr>`}</table>`); });
  $("#unprepP")?.addEventListener("click", e => busy(e.currentTarget, async () => { if (await ask("Unprep this note?", `Removes what was added for ${md(lastDate(pt))} so it goes back to today (${md(S.today)}).`, "Unprep")) { await unprep(pt); route(); } }));
  $("#backNow")?.addEventListener("click", () => { S.viewDate = null; route(); });
  if (S.open) openEditor(pt, S.open);
}
function peModal(pt) {
  const live = pt.problems.filter(p => p.start <= S.date && !(p.resolved && p.resolved < S.date));
  const byDx = Object.fromEntries(live.filter(p => p.peLine).map(p => [p.peLine.key, p]));
  const cur = pt.peExtra || {};
  const m = modal(`${ic("user")} Physical exam`, PE_LINES.map(([k, d]) => byDx[k]
      ? `<div class="f"><span>${k}</span><div class="muted" style="font-size:13px">${esc(byDx[k].peLine.text)} <i>(set by ${esc(byDx[k].name)}; change it in that diagnosis)</i></div></div>`
      : `<div class="f"><span class="lrow">${k}<span class="sp"></span><button class="iconbtn" data-rs="${k}" title="Back to the template">${ic("history", 13)}</button></span><input data-pe="${k}" value="${esc(cur[k] || d)}"></div>`).join(""),
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="peGo">Save exam</button>`);
  $$("[data-rs]", m).forEach(b => b.onclick = () => { const k = b.dataset.rs; $(`[data-pe="${k}"]`, m).value = PE_LINES.find(x => x[0] === k)[1]; m.dirty = true; });
  $("#peGo", m).onclick = async () => {
    const ex = {}; $$("[data-pe]", m).forEach(i => { const d = PE_LINES.find(x => x[0] === i.dataset.pe)[1]; if (i.value.trim() && i.value.trim() !== d) ex[i.dataset.pe] = i.value.trim(); });
    pt.peExtra = ex; m.close(true); await saveNow(pt, { why: "Edited physical exam" }); route();
  };
}
async function undischarge(pt) {
  if (!(await ask("Undo discharge?", `${esc(pt.name)} goes back on ${pt.unit}'s list and their note moves back out of the discharge folder.`, "Undo discharge"))) return;
  try { const u = await S.store.unitDir(pt.unit, true), dc = await S.store.subDir(u, "discharge"); if (await S.store.exists(dc, `${pt.file}.docx`)) await S.store.move(dc, `${pt.file}.docx`, u); } catch (e) { console.warn(e); }
  pt.status = "active"; delete pt.dischargedOn; await saveNow(pt, { why: "Undid discharge" }); route();
}
// Line each margin comment up with its paragraph (wide screens); stack them under the note otherwise.
function layoutComments() {
  const box = $("#cmts"), paper = $("#paper"), layer = $(".cmtlayer"); if (!box || !paper || !layer) return;
  const wide = window.innerWidth >= 1150; box.classList.toggle("stacked", !wide);
  if (!wide) { $$(".cmt", box).forEach(c => c.style.top = ""); layer.style.height = ""; return; }
  let y = 0; const off = layer.getBoundingClientRect().top;
  const at = c => { const a = $("#" + c.dataset.at); return a ? a.getBoundingClientRect().top - off : 0; };
  const list = $$(".cmt", box).map((c, i) => ({ c, i, t: at(c) })).sort((a, b) => a.t - b.t || a.i - b.i);
  for (const { c } of list) {
    const a = $("#" + c.dataset.at); const top = a ? a.getBoundingClientRect().top - off : 0;
    const t = Math.max(top, y); c.style.top = t + "px"; y = t + c.offsetHeight + 8;
  }
  layer.style.height = y + "px";
}
window.addEventListener("resize", () => layoutComments());
async function address(pt, text) {
  const f = flagsFor(pt).find(x => x.text === text);
  (pt.addrLog ||= []).push({ date: S.today, text, problemId: f?.problemId || null, level: f?.level, by: S.user?.name });
  const p = f?.problemId && pt.problems.find(q => q.id === f.problemId);
  const med = p && p.meds.find(m => text.startsWith(m.name) && m.end);
  if (med) med.addressed = true;
  else if (p && /course ended|last dose today/.test(text)) p.courseAddressed = true;
  else ((pt.addressed ||= {})[S.today] ||= []).push(text);
  await saveNow(pt, { why: `Addressed: ${text}` }); route();
}
async function setRule(name, rule) {
  if (!isSup()) return suggest({ type: "dx", dx: name, change: rule, note: rule.routine ? "Mark routine" : "Always flag" });
  S.rules.dx[name] = { ...(S.rules.dx[name] || {}), ...rule }; await saveRules(); toast(rule.routine ? `${name} marked routine` : `${name} will always be flagged`); route(); }

// ---------------- sticky notes ----------------
// "keep" notes stay with the patient (triggers, what works). "quick" notes are shorthand to write up later.
function stickyPanel(pt) {
  const ns = pt.notes || [], quick = ns.filter(n => n.kind === "quick" && !n.done), keep = ns.filter(n => n.kind === "keep");
  if (S.viewDate) return "";
  const board = boardFor(pt);
  if (!quick.length && !keep.length && !board.length) return "";
  return `<div class="stickies">${board.map(n => `<div class="sticky board c1"><div class="sh"><b>${ic("pin", 12)} Pinned note</b><span class="muted">${esc(n.by || "")} · ${md(n.date)}</span><span class="sp"></span>
      <button class="btn sm" data-bres="${n.id}" title="Resolves it everywhere">${ic("check", 12)} Resolved</button></div><div>${withLinks(n.text, n.links)}</div></div>`).join("")}${[...quick, ...keep].map(n => `<div class="sticky ${n.kind}"><div class="sh"><b>${n.kind === "quick" ? "To write up" : "Keep in mind"}</b>${n.popup ? `<span class="popbadge" title="Shows big every time">${ic("pin", 11)}</span>` : ""}<span class="muted">${md(n.date)}</span><span class="sp"></span>
      ${n.kind === "quick" ? `<button class="btn sm" data-sdone="${n.id}" title="I wrote this into the note">${ic("check", 12)} Written up</button>` : ""}<button class="btn sm" data-sdel="${n.id}" title="Delete">${ic("x", 12)}</button></div><div>${esc(n.text).replace(/\n/g, "<br>")}</div></div>`).join("")}
    </div>`;
}
function stickyModal(pts, preselect) {
  const m = modal(`${ic("note")} Make a Note`, `${pts.length > 1 ? `<div class="f"><span>Patient</span><select id="sP">${pts.map(p => `<option value="${p.id}" ${p.id === preselect ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>` : ""}
    <div class="row" style="margin-bottom:8px"><span class="chip on" data-k="quick">Quick note (write up later)</span><span class="chip" data-k="keep">Keep with patient</span></div>
    <div class="f"><textarea id="sT" rows="4" placeholder="e.g. HA, start Tylenol 650 Q6H PRN"></textarea></div>
    <p class="muted" id="sHelp">Shows on the patient until you mark it written up.</p>
    <label class="tgl" style="padding:8px 0 0"><input type="checkbox" id="sPop"><span class="sw"></span><span>Show big every time<small>Anyone opening this note sees it on top first, until they press OK</small></span></label>`,
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="sGo">Save note</button>`);
  let kind = "quick"; setTimeout(() => $("#sT", m)?.focus(), 50);
  $$("[data-k]", m).forEach(c => c.onclick = () => { kind = c.dataset.k; $$("[data-k]", m).forEach(x => x.classList.toggle("on", x === c));
    $("#sHelp", m).textContent = kind === "keep" ? "Stays on the patient every day (triggers, what they respond well to). Shows in the overview's Pertinent Issues." : "Shows on the patient until you mark it written up."; });
  $("#sGo", m).onclick = async () => {
    const text = $("#sT", m).value.trim(); if (!text) return;
    const pt = pts.length > 1 ? findPt($("#sP", m).value) : pts[0];
    (pt.notes ||= []).push({ id: uid(), kind, text, date: S.today, by: S.user?.name, ...($("#sPop", m).checked ? { popup: true } : {}) }); m.close(true);
    await saveNow(pt, { docx: false, why: kind === "quick" ? "Added quick note" : "Added sticky note" }); toast("Note saved"); route();
  };
}
function wireSticky(pt) {
  $$("[data-bres]").forEach(b => b.onclick = () => resolveBoard(b.dataset.bres));
  setTimeout(() => popupNotes(pt), 120);
  $("#addSticky")?.addEventListener("click", () => stickyModal([pt]));
  $$("[data-sdone]").forEach(b => b.onclick = async () => { pt.notes.find(n => n.id === b.dataset.sdone).done = S.today; await saveNow(pt, { docx: false }); route(); });
  $$("[data-sdel]").forEach(b => b.onclick = async () => { if (await ask("Delete this note?", "It will be gone for everyone.", "Delete")) { pt.notes = pt.notes.filter(n => n.id !== b.dataset.sdel); await saveNow(pt, { docx: false }); route(); } });
}

// Undo a prep: drop entries after today; an H&P converted today goes back to being an H&P.
async function unprep(pt) {
  for (const p of pt.problems) { p.hpi = p.hpi.filter(e => e.date <= S.today); p.plan = p.plan.filter(e => e.date <= S.today); p.needsReview = false; }
  if (pt.convertedOn === S.today) {
    try {
      const unitDir = await S.store.unitDir(pt.unit, true), adm = await S.store.subDir(unitDir, "admit");
      if (await S.store.exists(adm, `${pt.file} ADMIT.docx`)) await S.store.move(adm, `${pt.file} ADMIT.docx`, S.store.root);
      if (await S.store.exists(unitDir, `${pt.file}.docx`)) await unitDir.removeEntry(`${pt.file}.docx`);
    } catch (e) { console.warn(e); }
    pt.status = "admit"; pt.type = "admit"; delete pt.convertedOn;
  }
  await saveNow(pt, { why: "Unprepped" });
}
function oldNotesModal() {
  const m = modal("Old notes", `<div class="f"><span>Show notes as they read on</span><input type="date" id="oD" value="${E.addDays(S.today, -1)}" max="${S.today}"></div>
    <p class="muted">Everything opens read-only, exactly as it stood that day, so you can reprint it. Tap the date at the top to come back.</p>`,
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="oGo">View</button>`);
  $("#oGo", m).onclick = () => { S.viewDate = $("#oD", m).value; m.close(); route(); };
}

// ---------------- problem editor ----------------
function todayEntry(pt, p, kind) {
  const list = kind === "hpi" ? p.hpi : p.plan;
  let e = list.find(x => x.date === S.date);
  if (!e) {
    const text = kind === "hpi" ? dHpi(pt, p, S.date) : dPlan(pt, p, S.date);
    e = { date: S.date, text, auto: text }; list.push(e);
  }
  return e;
}
function refreshParas(pt, p) {
  const fs = flagsFor(pt);
  const h = $(`#h-${p.id}`), pl = $(`#p-${p.id}`);
  if (h) { const ed = $(".ed", h.parentElement); h.innerHTML = probPara(pt, p, "hpi", fs); }
  if (pl) pl.innerHTML = probPara(pt, p, "plan", fs);
}
function syncPlan(pt, p) {
  if (p.start === S.date) { if (!p.planOpen || p.planOpen === p.planAuto || p.planOpen === "Will continue to monitor") p.planOpen = p.planAuto = E.planOpening(p); return; }
  const e = todayEntry(pt, p, "plan");
  if (e.text === e.auto) { e.text = e.auto = dPlan(pt, p, S.date); }
}
function doseChips(m) {
  const opts = findMed(m.name); if (!opts) return "";
  return `<span class="muted">Common:</span>` + opts.map((o, i) => `<span class="chip sug" data-sug="${i}">${esc([o.dose, o.route, o.freq, o.prn ? "PRN" : ""].filter(Boolean).join(" "))}</span>`).join("");
}
function medRow(pt, p, m) {
  const ref = (pt.refusing || []).includes(m.id);
  return `<div class="med" data-med="${m.id}">
    <input data-k="name" value="${esc(m.name)}" placeholder="Medication" list="medList" autocomplete="off">
    <input data-k="dose" value="${esc(m.dose || "")}" placeholder="Dose">
    <input data-k="route" value="${esc(m.route || "")}" placeholder="Route">
    <input data-k="freq" value="${esc(m.freq || "")}" placeholder="Freq">
    <button class="btn sm" data-del title="Remove (added by mistake)">✕</button>
    <div class="x">
      <span class="chip ${m.prn ? "on" : ""}" data-t="prn">PRN</span>
      <span class="chip ${m.home ? "on" : ""}" data-t="home">Home med</span>
      <span class="chip ${ref ? "on" : ""}" data-t="refuse">Refusing</span>
      <span class="chip ${m.end ? "on" : ""}" data-t="dates">${m.end ? `Last dose ${md(m.end)}` : "Set dates"}</span>
      <span class="chip ${m.discontinued === S.date ? "on" : ""}" data-t="stop">${m.discontinued === S.date ? "Stopping today" : "Stop today"}</span>
      ${m.start === S.date ? `<span class="muted">· started today</span>` : m.changedOn === S.date ? `<span class="muted">· dose changed today</span>` : ""}
    </div>
    <div class="x" data-sugg>${doseChips(m)}</div>
    <div class="x" data-dates ${m.end ? "" : "hidden"}>Start <input type="date" data-k="start" value="${m.start}" style="width:auto">
      Last dose <input type="date" data-k="end" value="${m.end || ""}" style="width:auto"> or <input data-days placeholder="# days" style="width:80px"></div>
  </div>`;
}
function openEditor(pt, pid) {
  const p = pt.problems.find(q => q.id === pid); if (!p) return;
  $$(".ed").forEach(e => e.remove()); $$(".pp.open").forEach(e => e.classList.remove("open"));
  S.open = pid;
  if (!S.snap || S.snap.id !== pt.id) S.snap = { id: pt.id, data: structuredClone(pt), dirty: false };
  const firstDay = p.start === S.date;
  const hE = firstDay && !p.hpiOpen ? (p.hpi.find(e => e.date === S.date) || (p.hpi.push({ date: S.date, text: "", auto: "" }), p.hpi.at(-1))) : todayEntry(pt, p, "hpi");
  const pE = firstDay ? null : todayEntry(pt, p, "plan");
  const meds = p.meds.filter(m => !m.discontinued || m.discontinued >= S.date);
  const slot = $(`[data-slot="${pid}"]`); $(`#h-${pid}`)?.classList.add("open");
  const ed = document.createElement("div"); ed.className = "ed";
  ed.innerHTML = `
    <label>Diagnosis</label><input id="eName" value="${esc(p.name)}">
    <label>HPI ${md(S.date)}${firstDay && !p.hpiOpen ? " (first day: what the patient reports)" : ""}</label>
    <textarea id="eH">${esc(hE.text)}</textarea>
    <label class="lrow">${firstDay ? "Plan (first day)" : "Plan " + md(S.date)}<span class="sp"></span><button class="iconbtn" id="eReset" title="Reset HPI and plan to the suggested wording">${ic("history", 15)}</button></label>
    <textarea id="eP">${esc(firstDay ? (p.planOpen || E.planOpening(p)) : pE.text)}</textarea>
    <div class="meds" id="eMeds" style="margin-top:8px">${meds.map(m => medRow(pt, p, m)).join("")}</div>
    <button class="btn sm" id="eAdd" style="margin-top:6px">${ic("plus", 13)} Add medication</button>
    <div class="row" style="margin-top:10px">
      ${isDiabetes(p.name) ? `<span class="muted">Taking insulin?</span><span class="chip ${onInsulin(p) === true ? "on" : ""}" data-o="insY">Yes</span><span class="chip ${onInsulin(p) === false ? "on" : ""}" data-o="insN">No</span><span class="muted">·</span>` : ""}
      <span class="chip ${p.resolved === S.date ? "on" : ""}" data-o="resolve">${p.resolved === S.date ? "Resolving today" : "Resolve today"}</span></div>
    <details class="nmore" ${S.edMore ? "open" : ""} id="eMore"><summary>More options</summary>
      <label>Symptom word (for "reports ___ managed well")</label><input id="eSym" value="${esc(p.symptom || "")}" placeholder="e.g. acid reflux">
      <div class="row" style="margin-top:10px"><label class="switch"><input type="checkbox" id="eVitOn" ${p.autoVital ? "checked" : ""}><i></i>Record vitals every day</label>
        <select id="eVit" class="btn sm" ${p.autoVital ? "" : "hidden"}>${[["bp", "Blood pressure"], ["hr", "Heart rate"], ["bg", "Blood glucose"]].map(([k, n]) => `<option value="${k}" ${p.autoVital === k ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      <div class="row" style="margin-top:8px">
        <span class="chip ${p.alwaysFlag ? "on" : ""}" data-o="alwaysFlag">Always flag</span>
        <span class="chip ${p.pcp ? "on" : ""}" data-o="pcp">PCP follow-up</span>
        <span class="chip ${p.peLine ? "on" : ""}" data-o="pe">Affects exam</span>
        <span class="chip ${p.planOnly ? "on" : ""}" data-o="planOnly" title="Found on labs or exam, nothing the patient reports">Plan only</span>
        <span class="chip ${p.parked ? "on" : ""}" data-o="parked" title="Sent to PCP, a specialist or psych: stays on the note, no daily entries, not resolved">${p.parked ? `Parked since ${md(p.parked)}` : "Outpatient / psych follow-up"}</span>
      </div>
      <div id="ePe" ${p.peLine ? "" : "hidden"} style="margin-top:6px"><div class="grid2"><select id="ePeK">${PE_LINES.map(([k]) => `<option ${p.peLine?.key === k ? "selected" : ""}>${k}</option>`).join("")}</select>
        <input id="ePeT" value="${esc(p.peLine?.text || "")}" placeholder="New exam line"></div></div>
      <div class="row" style="margin-top:10px"><button class="btn sm warn" id="eDel">Delete problem</button><button class="btn sm" id="eTeach" title="Turn this fix into a rule for everyone">${ic("teach", 14)} Make this a rule</button></div>
    </details>
    <div class="row" style="margin-top:12px"><span class="sp"></span>
      <span class="muted" id="eUns" ${S.snap?.dirty ? "" : "hidden"}>Not saved yet</span><button class="btn" id="eCancel">Cancel</button><button class="btn p ${S.snap?.dirty ? "go" : ""}" id="eDone">Save</button></div>`;
  slot.append(ed); setTimeout(layoutComments, 30);
  ed.scrollIntoView({ behavior: "smooth", block: "nearest" });
  const changed = () => { refreshParas(pt, p); if (!S.snap.dirty) { S.snap.dirty = true; pinTab(pt.id); } S.snap.dirty = true; $("#eDone", ed)?.classList.add("go"); const u = $("#eUns", ed); if (u) u.hidden = false; };
  $("#eName", ed).oninput = e => { p.name = e.target.value; changed(); };
  $("#eSym", ed).oninput = e => { p.symptom = e.target.value; const t = todayEntry(pt, p, "hpi"); if (t.text === t.auto && !firstDay) { t.text = t.auto = dHpi(pt, p, S.date); $("#eH", ed).value = t.text; } changed(); };
  $("#eH", ed).oninput = e => { hE.text = e.target.value; changed(); };
  $("#eP", ed).oninput = e => { if (firstDay) p.planOpen = e.target.value; else pE.text = e.target.value; changed(); };
  const resetWording = () => {
    if (!(firstDay && !p.hpiOpen)) { hE.text = hE.auto = dHpi(pt, p, S.date); $("#eH", ed).value = hE.text; }
    if (firstDay) { p.planOpen = E.planOpening(p); $("#eP", ed).value = p.planOpen; } else { pE.text = pE.auto = dPlan(pt, p, S.date); $("#eP", ed).value = pE.text; }
    changed();
  };
  $("#eReset", ed).onclick = async () => { if (await ask("Reset wording?", "Replaces today's HPI and plan text for this diagnosis with the suggested wording. Your typed changes to them will be lost.", "Reset")) resetWording(); };
  const vitOn = () => { $("#eVit", ed).hidden = !$("#eVitOn", ed).checked; p.autoVital = $("#eVitOn", ed).checked ? $("#eVit", ed).value : undefined; resetWording(); };
  $("#eVitOn", ed).onchange = vitOn; $("#eVit", ed).onchange = vitOn;
  /* reset handler end */
  const wireMed = row => {
    const m = p.meds.find(x => x.id === row.dataset.med);
    $$("input[data-k]", row).forEach(inp => inp.oninput = () => {
      const k = inp.dataset.k; m[k] = inp.value || undefined;
      if ((k === "dose" || k === "freq") && m.start < S.date && !m.home) m.changedOn = S.date;
      if ((k === "dose" || k === "freq") && m.start < S.date && m.home) m.changedOn = S.date;
      if (k === "end" && m.end) m.addressed = false;
      if (k === "name") { $("[data-sugg]", row).innerHTML = doseChips(m); wireSugg(); }
      syncPlan(pt, p); $("#eP", ed).value = firstDay ? p.planOpen : pE.text; changed();
    });
    const wireSugg = () => $$("[data-sug]", row).forEach(c => c.onclick = () => {
      const o = findMed(m.name)[+c.dataset.sug]; Object.assign(m, { dose: o.dose, route: o.route, freq: o.freq, prn: o.prn });
      if (m.start < S.date) m.changedOn = S.date;
      syncPlan(pt, p); changed(); openEditor(pt, pid);
    });
    wireSugg();
    $("[data-days]", row).oninput = e => { const d = parseInt(e.target.value); if (d > 0) { m.end = E.addDays(m.start, d - 1); $('[data-k="end"]', row).value = m.end; m.addressed = false; syncPlan(pt, p); $("#eP", ed).value = firstDay ? p.planOpen : pE.text; changed(); } };
    $$("[data-t]", row).forEach(c => c.onclick = () => {
      const t = c.dataset.t;
      if (t === "prn") m.prn = !m.prn;
      if (t === "home") m.home = !m.home;
      if (t === "refuse") { pt.refusing ||= []; pt.refusing = pt.refusing.includes(m.id) ? pt.refusing.filter(x => x !== m.id) : [...pt.refusing, m.id];
        const t2 = todayEntry(pt, p, "hpi"); if (t2.text === t2.auto) { t2.text = t2.auto = dHpi(pt, p, S.date); $("#eH", ed).value = t2.text; } }
      if (t === "dates") { $("[data-dates]", row).hidden = false; if (!m.end) return; }
      if (t === "stop") m.discontinued = m.discontinued === S.date ? undefined : S.date;
      syncPlan(pt, p); changed(); openEditor(pt, pid);
    });
    $("[data-del]", row).onclick = () => { p.meds = p.meds.filter(x => x !== m); syncPlan(pt, p); changed(); openEditor(pt, pid); };
  };
  $$(".med", ed).forEach(wireMed);
  $("#eAdd", ed).onclick = () => { p.meds.push({ id: uid(), name: "", start: S.date }); changed(); openEditor(pt, pid); setTimeout(() => $$(".med input", ed.isConnected ? ed : document).at(-5)?.focus(), 50); };
  $$("[data-o]", ed).forEach(c => c.onclick = () => {
    const o = c.dataset.o;
    if (o === "alwaysFlag") p.alwaysFlag = !p.alwaysFlag;
    if (o === "pcp") p.pcp = !p.pcp;
    if (o === "insY") p.insulin = true;
    if (o === "insN") p.insulin = false;
    if (o === "pe") { if (p.peLine) delete p.peLine; else p.peLine = { key: "SKIN", text: "" }; }
    if (o === "resolve") p.resolved = p.resolved === S.date ? undefined : S.date;
    if (o === "planOnly") p.planOnly = !p.planOnly || undefined;
    if (o === "parked") p.parked = p.parked ? undefined : S.date;
    changed(); openEditor(pt, pid);
  });
  $("#ePeK", ed).onchange = e => { p.peLine.key = e.target.value; changed(); };
  $("#ePeT", ed).oninput = e => { p.peLine.text = e.target.value; changed(); };
  $("#eDel", ed).onclick = async () => { if (await ask("Delete problem?", `Remove <b>${esc(p.name)}</b> and all its entries from this note? Use Resolve instead if it got better.`, "Delete")) { pt.problems = pt.problems.filter(q => q !== p); S.open = null; S.snap = null; await saveNow(pt, { why: `Deleted ${p.name}` }); route(); } };
  $("#eDone", ed).onclick = e => busy(e.currentTarget, async () => {
    const missing = [];
    if (!p.name.trim()) missing.push("the diagnosis name");
    if (isDiabetes(p.name) && onInsulin(p) === undefined) missing.push("whether they take insulin");
    p.meds.filter(m => !m.name?.trim()).length && missing.push("a medication name");
    p.meds.filter(m => m.name?.trim() && !m.dose && m.start === S.today).forEach(m => missing.push(`the dose for ${m.name}`));
    if (missing.length && !(await ask("Some info is missing", `Still blank: <b>${missing.map(esc).join(", ")}</b>.`, "Save without it", "Go back and fill it in"))) return;
    p.meds = p.meds.filter(m => m.name?.trim());
    S.open = null; S.snap = null; await saveNow(pt, { why: `Edited ${p.name}` }); toast("Saved"); route(); });
  $("#eCancel", ed).onclick = () => { discard(); route(); };
  $("#eMore", ed).ontoggle = e => { S.edMore = e.target.open; };
  $("#eTeach", ed).onclick = () => teachModal(pt, p, hE, pE);
}
// Common "manage ___" words, used when the team's rulebook has nothing for a diagnosis yet.
const SYM = [[/reflux|gerd/i, "acid reflux"], [/hypertension|\bhtn\b|blood pressure/i, "blood pressure"], [/diabet|\bdm\b/i, "blood sugar"], [/migraine/i, "migraines"],
  [/headache/i, "headaches"], [/asthma/i, "asthma"], [/copd/i, "COPD"], [/allerg/i, "allergies"], [/hypothyroid/i, "hypothyroidism"], [/constipation/i, "constipation"],
  [/insomnia|sleep/i, "sleep"], [/back pain/i, "back pain"], [/arthritis/i, "arthritis pain"], [/pain/i, "pain"], [/seizure|epilep/i, "seizures"], [/cholesterol|lipid/i, "cholesterol"], [/acne/i, "acne"]];
const symFor = name => SYM.find(([re]) => re.test(name || ""))?.[1] || "";
// Add diagnosis: one window. Name, where it goes (patient reports it, or labs/exam only = Plan only), what they report,
// medications with common doses, and a plan that writes itself from the meds (still editable). Rare settings sit under More options.
function addProblem(pt) {
  const cur = pt.problems.filter(q => !(q.resolved && q.resolved < S.today));
  const known = Object.keys(rulebook()).sort();
  const meds = [];
  let planTouched = false, symTouched = false, where = "hpi";
  const medHtml = (m, i) => `<div class="nmed" data-i="${i}">
      <input data-k="name" value="${esc(m.name || "")}" placeholder="Medication" list="medList" autocomplete="off">
      <input data-k="dose" value="${esc([m.dose, m.route, m.freq].filter(Boolean).join(" "))}" placeholder="Dose · route · how often">
      <input data-k="days" value="${esc(m.days || "")}" placeholder="# days" inputmode="numeric" title="For a course (antibiotics, steroids). Leave blank if ongoing.">
      <label class="mini"><input type="checkbox" data-k="prn" ${m.prn ? "checked" : ""}>PRN</label>
      <label class="mini"><input type="checkbox" data-k="home" ${m.home ? "checked" : ""}>Home</label>
      <button class="btn sm" data-rm title="Remove">${ic("x", 12)}</button>
      <div class="nsug">${(findMed(m.name) || []).map((o, k) => `<button type="button" class="chip sug" data-sug="${k}">${esc([o.dose, o.route, o.freq, o.prn ? "PRN" : ""].filter(Boolean).join(" "))}</button>`).join("")}</div></div>`;
  const m = modal(`${ic("plus")} Add diagnosis`, `
    <div class="f"><span>Diagnosis</span><input id="nN" class="big" list="dxList" autocomplete="off" placeholder="e.g. Cellulitis, left forearm"><datalist id="dxList">${known.map(k => `<option value="${esc(k)}">`).join("")}</datalist></div>
    <p class="warnbox" id="nDup" hidden></p>
    <div class="seg2" id="nWhere"><button class="on" data-w="hpi">Patient reports it<small>HPI + Plan</small></button><button data-w="plan">Labs or exam only<small>Plan only</small></button></div>
    <div class="f" id="nHw"><span>What the patient reports</span><textarea id="nH" rows="2" placeholder="Patient presents with… / Patient reports taking … at home for …"></textarea></div>
    <div class="f"><span>Medications</span><div id="nMeds"></div><button class="btn sm" id="nAddM" type="button">${ic("plus", 12)} Add medication</button></div>
    <div class="row nexam"><label class="mini"><input type="checkbox" id="nPE"> Affects the physical exam?</label><span id="nPEw" hidden style="flex:1;display:flex;gap:6px"><select id="nPEk">${PE_LINES.map(([k]) => `<option>${k}</option>`).join("")}</select><input id="nPEt" placeholder="New exam line, e.g. wound on R calf healing, no erythema." style="flex:1"></span></div>
    <div class="f"><span>Plan <em class="muted" id="nPauto" style="text-transform:none;letter-spacing:0;font-weight:500">· writes itself from the meds</em></span><textarea id="nP" rows="2">Will continue to monitor</textarea></div>
    <details class="nmore"><summary>More options</summary>
      <div class="grid2" style="margin-top:8px"><div class="f"><span>Symptom word (for "reports ___ managed well")</span><input id="nS" placeholder="auto from the name"></div>
        <div class="f"><span>Record a vital every day</span><select id="nV"><option value="">No</option><option value="bp">Blood pressure</option><option value="hr">Heart rate</option><option value="bg">Blood glucose</option></select></div></div>
      <div class="row"><label class="mini"><input type="checkbox" id="nAF"> Always flag</label><label class="mini"><input type="checkbox" id="nPCP"> PCP follow-up</label>
        <label class="mini" title="Sent to PCP, a specialist or psych: stays on the note, no daily entries"><input type="checkbox" id="nPark"> Outpatient / psych follow-up only</label></div>
    </details>
    ${cur.length ? `<p class="muted small" style="margin-top:10px">Already on this note: ${cur.map(q => esc(q.name)).join(", ")}</p>` : ""}`,
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="nGo">Save diagnosis</button>`, true);
  const norm = x => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const dupOf = name => { const a = norm(name); return a.length > 2 && cur.find(q => { const b = norm(q.name); return b === a || b.includes(a) || a.includes(b); }); };
  const parseDose = t => { const w = t.trim().split(/\s+/).filter(Boolean); const ri = w.findIndex(x => /^(PO|IV|IM|SQ|SL|INH|TD|topical|ODT|PR|NG)$/i.test(x));
    return ri > 0 ? { dose: w.slice(0, ri).join(" "), route: w[ri], freq: w.slice(ri + 1).join(" ") || undefined } : { dose: w[0], route: undefined, freq: w.slice(1).join(" ") || undefined }; };
  const asMeds = () => meds.filter(x => x.name?.trim()).map(x => { const d = parseDose(x.doseText || ""), n = parseInt(x.days);
    return { id: x.id, name: x.name.trim(), ...d, prn: !!x.prn, home: !!x.home, start: S.date, ...(n > 0 ? { end: E.addDays(S.date, n - 1) } : {}) }; });
  const autoPlan = () => { if (planTouched) return; $("#nP", m).value = E.planOpening({ start: S.date, meds: asMeds() }); };
  const drawMeds = () => { $("#nMeds", m).innerHTML = meds.map((x, i) => medHtml({ ...x, dose: x.doseText }, i)).join(""); wireMeds(); };
  const wireMeds = () => $$(".nmed", m).forEach(r => { const x = meds[+r.dataset.i];
    $('[data-k="name"]', r).oninput = e => { x.name = e.target.value; const o = findMed(x.name); $(".nsug", r).innerHTML = (o || []).map((o2, k) => `<button type="button" class="chip sug" data-sug="${k}">${esc([o2.dose, o2.route, o2.freq, o2.prn ? "PRN" : ""].filter(Boolean).join(" "))}</button>`).join(""); wireSug(r, x); autoPlan(); };
    $('[data-k="dose"]', r).oninput = e => { x.doseText = e.target.value; autoPlan(); };
    $('[data-k="days"]', r).oninput = e => { x.days = e.target.value; autoPlan(); };
    $('[data-k="prn"]', r).onchange = e => { x.prn = e.target.checked; autoPlan(); };
    $('[data-k="home"]', r).onchange = e => { x.home = e.target.checked; autoPlan(); };
    $("[data-rm]", r).onclick = () => { meds.splice(+r.dataset.i, 1); drawMeds(); autoPlan(); };
    wireSug(r, x); });
  const wireSug = (r, x) => $$("[data-sug]", r).forEach(c => c.onclick = () => { const o = findMed(x.name)[+c.dataset.sug];
    x.doseText = [o.dose, o.route, o.freq].filter(Boolean).join(" "); x.prn = !!o.prn; drawMeds(); autoPlan(); });
  $("#nAddM", m).onclick = () => { meds.push({ id: uid(), name: "", home: false }); drawMeds(); $$('.nmed [data-k="name"]', m).at(-1)?.focus(); };
  $("#nP", m).oninput = () => { planTouched = true; $("#nPauto", m).hidden = true; };
  $("#nPE", m).onchange = e => { $("#nPEw", m).hidden = !e.target.checked; if (e.target.checked) $("#nPEt", m).focus(); };
  $("#nS", m).oninput = () => { symTouched = true; };
  $$("[data-w]", m).forEach(b => b.onclick = () => { where = b.dataset.w; $$("[data-w]", m).forEach(x => x.classList.toggle("on", x === b)); $("#nHw", m).hidden = where === "plan"; });
  $("#nN", m).focus();
  $("#nN", m).oninput = e => { const v = e.target.value, d = dupOf(v), tr = rulebook()[v];
    if (tr?.autoVital) $("#nV", m).value = tr.autoVital;
    $("#nDup", m).hidden = !d; if (d) $("#nDup", m).innerHTML = `Looks like <b>${esc(d.name)}</b> is already on this note. Add today's update there instead? <button class="btn sm" id="nOpen">Open ${esc(d.name)}</button>`;
    $("#nOpen", m)?.addEventListener("click", () => { m.close(true); S.open = d.id; route(); }); };
  $("#nGo", m).onclick = async () => {
    const name = $("#nN", m).value.trim(); if (!name) return $("#nN", m).focus();
    const d = dupOf(name); if (d && !(await ask("Add a second one?", `<b>${esc(d.name)}</b> is already on this note.`, "Add anyway", "Go back"))) return;
    const ms = asMeds();
    const p = { id: uid(), name, symptom: (symTouched && $("#nS", m).value.trim()) || name.toLowerCase(), autoVital: $("#nV", m).value || undefined, start: S.date, hpiOpen: null,
      planOpen: $("#nP", m).value.trim() || "Will continue to monitor", meds: ms,
      hpi: where === "plan" ? [] : [{ date: S.date, text: $("#nH", m).value.trim(), auto: "" }], plan: [],
      ...(where === "plan" ? { planOnly: true } : {}), ...($("#nAF", m).checked ? { alwaysFlag: true } : {}), ...($("#nPCP", m).checked ? { pcp: true } : {}),
      ...($("#nPark", m).checked ? { parked: S.date } : {}), ...($("#nPE", m).checked && $("#nPEt", m).value.trim() ? { peLine: { key: $("#nPEk", m).value, text: $("#nPEt", m).value.trim() } } : {}) };
    pt.problems.push(p); m.close(true); await saveNow(pt, { why: `Added ${name}` }); toast(`${name} added`); route();
  };
}

// ---------------- small patient modals ----------------
function infoModal(pt) {
  const m = modal("Patient info", `
    <div class="grid2"><div class="f"><span>Name (Last, First)</span><input id="iN" value="${esc(pt.name)}"></div><div class="f"><span>Unit</span><select id="iU">${UNITS.map(u => `<option ${u === pt.unit ? "selected" : ""}>${u}</option>`).join("")}</select></div>
    <div class="f"><span>Date of birth</span><input id="iD" value="${esc(pt.dob || "")}"></div><div class="f"><span>MRN</span><input id="iM" value="${esc(pt.mrn || "")}"></div>
    <div class="f"><span>Admit date</span><input type="date" id="iA" value="${pt.admitDate || ""}"></div></div>
    <div class="f"><span>History blurb (top of HPI)</span><textarea id="iB" rows="5">${esc(pt.blurb || "")}</textarea></div>`,
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="iGo">Save</button>`);
  $("#iGo", m).onclick = async () => {
    const oldUnit = pt.unit, newUnit = $("#iU", m).value, oldFile = pt.file;
    pt.name = $("#iN", m).value.trim(); pt.dob = $("#iD", m).value; pt.mrn = $("#iM", m).value; pt.admitDate = $("#iA", m).value; pt.blurb = $("#iB", m).value;
    if (pt.status !== "admit" && (newUnit !== oldUnit)) {           // transfer: move the Word file to the new unit folder
      try { await S.store.move(await S.store.unitDir(oldUnit, true), `${oldFile}.docx`, await S.store.unitDir(newUnit, true)); } catch {}
    }
    pt.unit = newUnit; m.close(); await saveNow(pt, { why: oldUnit !== newUnit ? `Moved to ${newUnit}` : "Edited patient info" }); route();
  };
}
function psychModal(pt) {
  const ps = pt.psych ||= { dx: "", taper: "none" };
  const m = modal("Primary diagnosis line", `<div class="f"><span>Primary (psych) diagnosis from HCS</span><textarea id="yD" rows="2">${esc(ps.dx)}</textarea></div>
    <div class="f"><span>Taper line (only if psychiatry started one)</span><select id="yT">${[["none", "None"], ["ciwa", "CIWA / Valium"], ["cows", "COWS / Subutex"], ["both", "CIWA and COWS"]].map(([k, n]) => `<option value="${k}" ${ps.taper === k ? "selected" : ""}>${n}</option>`).join("")}</select></div>`,
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="yGo">Save</button>`);
  $("#yGo", m).onclick = async () => { ps.dx = $("#yD", m).value.trim(); ps.taper = $("#yT", m).value; m.close(); await saveNow(pt, { why: "Edited psych line" }); route(); };
}
function labsModal(pt) {
  pt.labs ||= []; pt.pendingLabs ||= [];
  const pend = pendingLabs(pt);
  const m = modal(`${ic("labs")} Labs`, `
    <div class="lbl" style="margin-top:0">Waiting on</div><div class="row">${pend.map(x => `<button class="fpill a" data-fill="${esc(x.name)}" title="Add this result">${esc(x.name)} pending${x.dx ? ` · ${esc(x.dx)}` : ""}</button>`).join("") || `<span class="muted small">Nothing. Writing "will order CMP" or "TSH pending" in a plan adds it here.</span>`}</div>
    <div class="lbl">Already in the note</div>
    <div id="lList">${pt.labs.map((l, i) => `<div class="card" style="padding:9px 10px;margin-bottom:6px;box-shadow:none"><div class="row"><b style="flex:1">${esc(l.text)}</b><button class="btn sm warn" data-rm="${i}">Remove</button></div>${(l.bullets || []).map(b => `<div class="muted">- ${esc(b)}</div>`).join("")}</div>`).join("") || `<p class="muted">No results yet (prints "All Labs Pending").</p>`}</div>
    <div class="lbl">Add a result</div>
    <div class="f"><span>Line</span><input id="lT" placeholder="CMP reviewed ${md(S.today)}."></div>
    <div class="f"><span>Abnormal values (one per line, become bullets)</span><textarea id="lB" rows="3" placeholder="Potassium 5.6 (H)"></textarea></div>
    ${pt.problems.length ? `<p class="warnbox">Abnormal results can add or change a diagnosis. On this note: ${pt.problems.filter(p => !p.resolved).map(p => esc(p.name)).join(", ")}.</p>` : ""}`,
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="lGo">Save labs</button>`);
  $$("[data-rm]", m).forEach(b => b.onclick = async () => { pt.labs.splice(+b.dataset.rm, 1); m.close(true); await saveNow(pt, { why: "Removed a lab" }); labsModal(pt); route(); });
  const key = t => (String(t).match(/[A-Za-z][A-Za-z0-9-]+/) || [""])[0].toLowerCase();
  $$("[data-fill]", m).forEach(b => b.onclick = () => { $("#lT", m).value = `${b.dataset.fill} reviewed ${md(S.today)}.`; $("#lB", m).focus(); m.dirty = true; });
  $("#lGo", m).onclick = async () => {
    const t = $("#lT", m).value.trim();
    if (t) {
      const k = key(t), dup = pt.labs.find(l => key(l.text) === k);
      if (dup && !(await ask("Already in the note?", `<b>${esc(dup.text)}</b> is already listed. Add <b>${esc(t)}</b> too?`, "Add it anyway", "Go back"))) return;
      pt.labs.push({ date: S.today, text: t, bullets: $("#lB", m).value.split("\n").map(s => s.trim()).filter(Boolean) });
    }
    if (t) pt.pendingLabs = (pt.pendingLabs || []).filter(x => !t.toLowerCase().includes(x.toLowerCase()));
    m.close(true); await saveNow(pt, { why: "Edited labs" }); route();
  };
}
function reprintModal(pt) {
  const d = S.date;
  const m = modal(`${ic("print")} Print`, `<p style="font-size:15px"><b>${esc(pt.name)}</b><br><span class="muted">Note for ${new Date(d + "T12:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span></p>
    <div class="f" style="margin-top:12px"><span>Provider</span><select id="rP"><option value="">(none)</option>${providerNames().map(p => `<option ${(S.provider || S.days?.[S.today]?.provider) === p ? "selected" : ""}>${p}</option>`).join("")}</select></div>`,
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="rGo">Print</button>`);
  $("#rGo", m).onclick = async () => { S.provider = $("#rP", m).value; m.close(true); printPdf([blocksFor(pt, d, popts({ provider: S.provider }))], `${pt.file} ${md(d).replace("/", "-")}.pdf`, { sigFirst: sigFirstFor(await printPrefs(), S.provider) }); };
}
async function discharge(pt) {
  const m = modal(`Discharge ${esc(pt.name)}`, `<p class="muted" style="font-size:14px">Moves the note into ${pt.unit}'s discharge folder and takes them off the list.</p>
    <label class="chk"><input type="checkbox" id="dSeen"><div>We saw them today<small>Print today's note before moving it</small></div></label>`,
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="dGo">Discharge</button>`);
  $("#dGo", m).onclick = e => busy(e.currentTarget, async () => {
    if ($("#dSeen", m).checked) await printPdf([progressBlocks(pt, S.today, popts({ provider: S.provider }))], `${pt.file}.pdf`, { sigFirst: sigFirstFor(await printPrefs(), S.provider) });
    await saveNow(pt, { why: "Discharged" }); await queue[pt.id]; docxQ.delete(pt.id); await writeDocx(pt);
    try {
      const { dir, name } = await docxTarget(pt);
      const to = pt.status === "admit" ? await S.store.subDir(await S.store.unitDir(pt.unit, true), "admit") : await S.store.subDir(dir, "discharge");
      await S.store.move(dir, name, to);
    } catch (e) { toast("Couldn't move the Word file: " + e.message); }
    pt.status = "discharged"; pt.dischargedOn = S.today; await S.store.savePatient(pt, true);
    m.close(true); toast(`${pt.name} discharged`); location.hash = `unit-${pt.unit}`;
  });
}

// ---------------- vitals (typed in) ----------------
function vitalsModal(unit, focusId, after) {
  const list = unitPts(unit), K = [["bp", "BP"], ["hr", "Pulse"], ["rr", "RR"], ["temp", "Temp"], ["o2", "O2"], ["bg", "BG"]];
  const tracksBg = p => p.problems.some(q => q.autoVital === "bg" && !(q.resolved && q.resolved < S.today)) || Object.values(p.vitals || {}).some(v => v?.bg);
  const m = modal(`Vitals · ${unit} · ${md(S.today)}`, `<div>
    <p class="muted" style="margin-bottom:8px">Type each patient's vitals from the sheet. Tab moves to the next box. <b>Refused</b> or <b>UTO</b> fills the whole row (BG only for patients who get BG checks).</p>
    <div style="overflow:auto"><table class="vgrid"><tr><th>Patient</th>${K.map(([, n]) => `<th>${n}</th>`).join("")}<th></th></tr>
      ${list.map(p => `<tr data-id="${p.id}" data-bg="${tracksBg(p) ? 1 : ""}"><td class="nm">${esc(p.name)}</td>${K.map(([k]) => `<td><input data-k="${k}" value="${esc(p.vitals?.[S.today]?.[k] || "")}" inputmode="${k === "bp" ? "text" : "decimal"}"></td>`).join("")}
        <td class="vbtns"><button class="btn sm" data-fill="Refused" tabindex="-1">Refused</button><button class="btn sm" data-fill="UTO" tabindex="-1">UTO</button><button class="btn sm" data-clr tabindex="-1">Clear</button></td></tr>`).join("")}
    </table></div></div>`,
    `<button class="btn warn" id="vAll">Clear all</button><span class="sp"></span><button class="btn" data-x>Cancel</button><button class="btn p" id="vSave">Save vitals</button>`, true);
  const mark = tr => { const vals = $$("input", tr).map(i => i.value.trim().toLowerCase()).filter(Boolean); tr.classList.toggle("vref", !!vals.length && vals.every(v => v === "refused" || v === "uto")); };
  $$("[data-clr]", m).forEach(b => b.onclick = () => { $$("input", b.closest("tr")).forEach(i => i.value = ""); mark(b.closest("tr")); m.dirty = true; });
  $$("[data-fill]", m).forEach(b => b.onclick = () => { const tr = b.closest("tr");
    $$("input", tr).forEach(i => { i.value = i.dataset.k === "bg" && !tr.dataset.bg ? "" : b.dataset.fill; }); mark(tr); m.dirty = true; });
  $$("tr[data-id]", m).forEach(mark);
  $("#vAll", m).onclick = () => { $$(".vgrid input", m).forEach(i => i.value = ""); $$("tr[data-id]", m).forEach(mark); };
  if (focusId) setTimeout(() => $(`tr[data-id="${focusId}"] input`, m)?.focus(), 80);
  $("#vSave", m).onclick = e => busy(e.currentTarget, async () => {
    for (const tr of $$("tr[data-id]", m)) {
      const pt = findPt(tr.dataset.id), v = {};
      $$("input", tr).forEach(i => { if (i.value.trim()) v[i.dataset.k] = i.value.trim(); });
      const old = pt.vitals?.[S.today] || {};
      if (JSON.stringify(old) === JSON.stringify(v)) continue;
      (pt.vitals ||= {})[S.today] = v; E.fillVitals(pt, S.today);
      for (const p of pt.problems) if (p.autoVital) { const e = p.hpi.find(x => x.date === S.today); if (e && e.text === e.auto) e.text = e.auto = dHpi(pt, p, S.today); }
      await saveNow(pt, { why: "Entered vitals" });
    }
    m.close(true); toast("Vitals saved"); route(); after?.();
  });
}

// ---------------- prep ----------------
async function prepUnit(u) {
  const list = unitPts(u), review = [], tomorrow = E.addDays(S.today, 1);
  let quiet = 0, converted = [], i = 0;
  const pg = progress(`Prepping ${u} for ${md(tomorrow)}`);
  try {
  const toSave = [];
  for (const pt of list) {
    if (pt.status === "admit") {                       // day 2: H&P becomes the running progress note
      if (pt.admitDate > S.today) continue;
      const { dir, name } = await docxTarget(pt);
      try { await S.store.move(dir, name, await S.store.subDir(await S.store.unitDir(pt.unit, true), "admit")); } catch {}
      Object.assign(pt, E.convertAdmit(pt)); pt.convertedOn = S.today;
      converted.push(pt.name);
    }
    const r = E.prep(pt, S.today, S.rules);
    if (r.review.length) review.push({ pt, items: r.review }); else quiet++;
    toSave.push(pt);
  }
  await pool(toSave, 6, async pt => { await saveNow(pt, { why: `Prepped for ${md(tomorrow)}` }); pg.set(`Saved ${++i} of ${toSave.length}`, i / toSave.length); });
  } finally { pg.close(); }
  const m = modal(`Prep ${u} for ${md(tomorrow)}`, `
    <div class="lbl">Copied forward quietly</div><p class="muted">${quiet} patient${quiet === 1 ? "" : "s"} with no changes today.</p>
    ${converted.length ? `<div class="lbl">H&amp;P converted to follow-up</div><p class="muted">${converted.map(esc).join(", ")}</p>` : ""}
    ${review.length ? `<div class="lbl">Changed today: check tomorrow's wording</div>${review.map(({ pt, items }) => items.map(it => `
      <div class="chk"><input type="checkbox" checked><div><b>${esc(pt.name)} · ${esc(it.name)}</b> <span class="muted">(${esc(it.reasons.join(", "))})</span>
      <small>HPI ${md(tomorrow)}: ${esc(it.hpi)}</small><small>Plan ${md(tomorrow)}: ${esc(it.plan)}</small>
      <button class="btn sm" data-open="${pt.id}" style="margin-top:6px">Edit</button></div></div>`).join("")).join("")}` : `<p class="muted" style="margin-top:8px">Nothing needs review.</p>`}`,
    `<button class="btn p" data-x>Approve all</button>`);
  $(".mb", m).insertAdjacentHTML("afterbegin", `<p class="muted" style="margin-bottom:6px">Notes now show what they'll say on <b>${md(tomorrow)}</b>. Need to redo today? Use <b>Unprep</b> on the unit or the note.</p>`);
  $$("[data-open]", m).forEach(b => b.onclick = () => { m.close(true); location.hash = "pt-" + b.dataset.open; });
  m.onclose = async () => { for (const { pt } of review) { pt.problems.forEach(p => p.needsReview = false); await S.store.savePatient(pt, true); } route(); };
}

// ---------------- print ----------------
// One print job for the whole unit. Each note's signed page can come off on top (per provider, remembered on every computer).
async function printPdf(notes, name = "notes.pdf", opts = {}) {
  const pdf = toPdf(window.jspdf.jsPDF, notes, opts);
  const url = URL.createObjectURL(pdf.output("blob"));
  const f = document.createElement("iframe"); f.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0";
  f.src = url; document.body.append(f);
  f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { window.open(url); } setTimeout(() => f.remove(), 60000); };
  const t = document.createElement("div"); t.className = "toast"; t.innerHTML = `Print window opening… <a href="${url}" target="_blank" download="${esc(name)}" style="color:inherit;margin-left:8px">Open PDF</a>`;
  document.body.append(t); setTimeout(() => t.remove(), 8000);
  return pdf.noteInfo;
}
async function printPrefs() { return S.store ? S.store.getShared("printprefs.json", {}) : {}; }
const sigFirstFor = (pp, prov) => pp.sigFirst?.[prov || "(none)"] ?? true;
const noVitals = pt => !Object.values(pt.vitals?.[S.today] || {}).some(v => String(v || "").trim());
const vitalsNote = pt => { const v = Object.values(pt.vitals?.[S.today] || {}).map(x => String(x).toLowerCase());
  return v.includes("refused") ? "Refused" : v.includes("uto") ? "UTO" : ""; };
const labsToday = pt => (pt.labs || []).filter(l => l.date === S.today);
const ekgToday = pt => labsToday(pt).some(l => /\b(EKG|ECG)\b/i.test(l.text + " " + (l.bullets || []).join(" ")));
// Edits a person made today (not prep, vitals, or billing done by the app or the table).
const AUTO_LOG = /^(Prepped|Unprep|Entered vitals|Billing|Always 3|Imported)/i;
const touchedToday = pt => pt.problems.some(p => editedToday(pt, p)) || (pt.log || []).some(l => localDay(l.at) === S.today && !AUTO_LOG.test(l.what || ""));
function localDay(ms) { const d = new Date(ms); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); }
const billCode = pt => { const v = String(effBill(pt, S.today) || "").trim(); return /^[123]$/.test(v) ? (pt.admitDate === S.today || pt.status === "admit" ? "9922" : "9923") + v : ""; };

async function printModal(list) {
  if (!list.length) return toast("No notes to print");
  const unit = list[0].unit, unitAll = unitPts(unit);
  const pp = await printPrefs();
  let prov = S.provider || S.days?.[S.today]?.provider || "";
  const sel = new Set(list.map(p => p.id));
  const noLabs = unitAll.length > 1 && !unitAll.some(p => labsToday(p).length);
  const items = list.flatMap(pt => loud(flagsFor(pt)).map(f => {
    const p = f.problemId && pt.problems.find(q => q.id === f.problemId);
    return { pt, text: f.text, auto: !!(p && editedToday(pt, p)) };
  })).concat(list.flatMap(pt => (pt.notes || []).filter(n => n.kind === "quick" && !n.done).map(n => ({ pt, text: "Quick note not written up: " + n.text, auto: false }))));
  const row = pt => {
    const fl = items.map((x, i) => [x, i]).filter(([x]) => x.pt === pt), nv = noVitals(pt), vn = vitalsNote(pt);
    return `<div class="prow ${sel.has(pt.id) ? "" : "off"}" data-pid="${pt.id}">
      <label class="pmain"><input type="checkbox" data-sel ${sel.has(pt.id) ? "checked" : ""}><span class="pn">${esc(pt.name)}</span>${admA(pt)}
        ${touchedToday(pt) ? `<span class="ptag ed">Edited today</span>` : `<span class="ptag">No edits today</span>`}
        ${vn ? `<span class="ptag">Vitals: ${vn}</span>` : ""}${ekgToday(pt) ? `<span class="ptag ekg">EKG</span>` : ""}</label>
      ${pt.status === "admit" && !hpReady(pt) ? `<div class="pflag"><label class="chk"><input type="checkbox" data-ack="h-${pt.id}"><div>H&amp;P still pending<small>Not marked ready to see yet</small></div></label><a class="btn sm" href="#hp-${pt.id}" style="text-decoration:none">Open H&amp;P</a></div>` : ""}
      ${nv ? `<div class="pflag"><label class="chk"><input type="checkbox" data-ack="v-${pt.id}"><div>Vitals missing<small>Not entered, and not marked Refused or UTO</small></div></label><button class="btn sm" data-vit="${pt.id}">Enter vitals</button></div>` : ""}
      ${fl.map(([x, i]) => `<div class="pflag"><label class="chk"><input type="checkbox" data-fc="${i}" ${x.auto ? "checked" : ""}><div>${esc(x.text)}<small>${x.auto ? "Edited today, checked for you" : "Not addressed yet"}</small></div></label></div>`).join("")}
    </div>`; };
  const m = modal(`${ic("print")} Print ${esc(unit)}`, `<div data-nodirty>
    <div class="pgrid">
      <label class="f"><span>Provider (circled on every note)</span><select id="pP"><option value="">(none)</option>${providerNames().map(p => `<option ${prov === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></label>
      <label class="tgl" title="Remembered for this provider on every computer"><input type="checkbox" id="pSig"><span class="sw"></span><span>Signed page on top<small id="pSigSub"></small></span></label>
    </div>
    ${noLabs ? `<div class="al amber pwarn"><div style="flex:1"><b>Any labs to review?</b> None in all of ${esc(unit)} have been added today.</div><button class="btn sm" id="pLabs">Add labs</button><label class="chk" style="border:0;padding:0"><input type="checkbox" data-ack="labs"><div>No labs today</div></label></div>` : ""}
    <div class="row psel"><b id="pCount"></b><span class="sp"></span><button class="btn sm" id="pAll">Select all</button><button class="btn sm" id="pNone">Deselect all</button></div>
    <div class="plist">${list.map(row).join("")}</div>
    <p class="muted small" style="margin-top:10px">One print job. You'll pick the printer in the next window.</p></div>`,
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="pGo">Print</button>`, true);
  const sigUi = () => { $("#pSig", m).checked = sigFirstFor(pp, prov); $("#pSigSub", m).textContent = $("#pSig", m).checked ? "3 of 3 prints 3, 1, 2" : "Pages print in order"; };
  sigUi();
  $("#pP", m).onchange = e => { prov = e.target.value; sigUi(); };
  $("#pSig", m).onchange = async e => {
    $("#pSigSub", m).textContent = e.target.checked ? "3 of 3 prints 3, 1, 2" : "Pages print in order";
    if (!S.store) return;
    const fresh = await printPrefs(); (fresh.sigFirst ||= {})[prov || "(none)"] = e.target.checked; Object.assign(pp, fresh);
    try { await S.store.setShared("printprefs.json", fresh); } catch {}
  };
  const upd = () => {
    $$(".prow", m).forEach(r => { const on = $("[data-sel]", r).checked; r.classList.toggle("off", !on); on ? sel.add(r.dataset.pid) : sel.delete(r.dataset.pid); });
    const open = $$(".prow:not(.off) [data-fc], .prow:not(.off) [data-ack], .pwarn [data-ack]", m).filter(c => !c.checked).length;
    $("#pCount", m).textContent = `${sel.size} of ${list.length} selected`;
    $("#pGo", m).disabled = !sel.size;
    $("#pGo", m).textContent = !sel.size ? "Nothing selected" : open ? `Print anyway (${open} unchecked)` : `Print ${sel.size} note${sel.size > 1 ? "s" : ""}`;
  };
  m.addEventListener("change", upd); upd();
  $("#pAll", m).onclick = () => { $$("[data-sel]", m).forEach(c => c.checked = true); upd(); };
  $("#pNone", m).onclick = () => { $$("[data-sel]", m).forEach(c => c.checked = false); upd(); };
  $$("[data-vit]", m).forEach(b => b.onclick = () => { m.close(true); vitalsModal(unit, b.dataset.vit, () => printModal(list)); });
  $("#pLabs", m)?.addEventListener("click", () => { m.close(true); bulkLabs(unit, () => printModal(list)); });
  $("#pGo", m).onclick = async () => {
    S.provider = prov; const chosen = list.filter(p => sel.has(p.id)), sigFirst = $("#pSig", m).checked;
    m.close(true);
    chosen.forEach(pt => queueDocx(pt));
    await printPdf(chosen.map(pt => blocksFor(pt, S.today, popts({ provider: S.provider }))), `${unit} ${md(S.today).replace("/", "-")}.pdf`, { sigFirst });
  };
}

// ---------------- billing window ----------------
// Billing for one unit or all of them, typed here and saved into the Home patient list (same field).
// EKGs sit right next to billing since they can't be circled automatically; Always 3 shows its reason.
function a3Reason(p) {
  const live = p.problems.filter(q => !(q.resolved && q.resolved < S.today)), code = a3(p);
  if (p.always3) return { code, why: "set by hand" };
  const names = [...live.map(q => q.name), p.psych?.dx || ""];
  if (code === "OD") return { code, why: names.find(n => /overdose|\bOD\b/i.test(n)) || "overdose" };
  if (code === "P") return { code, why: names.find(n => /suicide attempt|schizophrenia/i.test(n)) || "psych" };
  if (code === "M") return { code, why: loud(flagsFor(p)).find(f => f.level === "red")?.text || "medical issue" };
  return { code, why: "" };
}
const ekgCount = () => S.pts.filter(p => active(p) && ekgToday(p)).length;
function billingModal(unit) {
  let show = unit || "all";
  const yest = E.addDays(S.today, -1);
  const body = () => {
    const units = show === "all" ? UNITS : [show];
    return `<div class="bchips">${["all", ...UNITS].map(u => `<button class="chip ${show === u ? "on" : ""}" data-u="${u}">${u === "all" ? "All units" : u}</button>`).join("")}
      <span class="sp"></span><span class="muted small">EKGs today: <b id="bE">${ekgCount()}</b></span></div>
      ${units.map(u => { const l = unitPts(u); if (!l.length) return "";
        return `<div class="bunit"><div class="bun">${u.toUpperCase()}</div><table class="ovt xl zebra btab"><tr><th></th><th>Patient</th><th title="Billing level today">Today</th><th>EKG</th><th>Always 3?</th><th title="Billing level yesterday">Yest.</th></tr>
        ${l.map((p, i) => { const r = a3Reason(p), on3 = ["P", "OD"].includes(r.code), e = ekgToday(p);
          return `<tr data-pt="${p.id}"><td class="muted">${i + 1}</td><td class="nm"><b>${esc(p.name)}</b>${admA(p)}</td>
            <td><input class="cell bin" value="${esc(p.bill?.[S.today] ?? "")}" placeholder="${tset().today.default3 && on3 ? "3" : ""}" maxlength="1" inputmode="numeric"></td>
            <td><button class="ekgb ${e ? "on" : ""}" data-ekg title="${e ? "EKG reviewed today (circle 93010)" : "Mark EKG reviewed today"}">${e ? "EKG 93010" : "+ EKG"}</button></td>
            <td>${r.code !== "~" ? `<span class="a3c ${on3 ? "on" : ""}">${r.code}</span> <span class="muted small">${esc(r.why)}</span>` : `<span class="muted">~</span>`}</td>
            <td class="muted" style="text-align:center">${esc(effBill(p, yest)) || "—"}</td></tr>`; }).join("")}</table></div>`; }).join("")}`;
  };
  const m = modal(`${ic("count")} Billing · ${md(S.today)}`, `<div data-nodirty id="bBody">${body()}</div>`, `<span class="muted small">Saves into the Home list as you type.</span><span class="sp"></span><button class="btn p" data-x>Done</button>`, true);
  const wire = () => {
    $$("[data-u]", m).forEach(b => b.onclick = () => { show = b.dataset.u; $("#bBody", m).innerHTML = body(); wire(); });
    const ins = $$(".bin", m);
    ins.forEach((inp, k) => {
      const pt = findPt(inp.closest("tr").dataset.pt);
      inp.onchange = () => { const v = inp.value.trim(); pt.bill ||= {}; if (v) pt.bill[S.today] = v; else delete pt.bill[S.today]; saveNow(pt, { docx: false, why: `Billing ${v || "cleared"}` }); };
      inp.oninput = () => { if (/^[123]$/.test(inp.value)) { inp.dispatchEvent(new Event("change")); ins[k + 1]?.focus(); ins[k + 1]?.select(); } };
      inp.onkeydown = e => { if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); ins[k + 1]?.focus(); } if (e.key === "ArrowUp") { e.preventDefault(); ins[k - 1]?.focus(); } };
    });
    $$("[data-ekg]", m).forEach(b => b.onclick = async () => {
      const pt = findPt(b.closest("tr").dataset.pt); pt.labs ||= [];
      if (ekgToday(pt)) {
        const i = pt.labs.findIndex(l => l.date === S.today && /^EKG Reviewed/i.test(l.text));
        if (i < 0) return toast("This EKG was entered with other labs. Remove it from the note's labs.");
        pt.labs.splice(i, 1);
      } else pt.labs.push({ date: S.today, text: `EKG Reviewed ${md(S.today)}.`, bullets: [] });
      const e = ekgToday(pt); b.classList.toggle("on", e); b.textContent = e ? "EKG 93010" : "+ EKG"; $("#bE", m).textContent = ekgCount();
      await saveNow(pt, { why: e ? "EKG reviewed" : "EKG removed" });
    });
  };
  wire(); setTimeout(() => $(".bin", m)?.focus(), 80);
  m.onclose = () => route();
}

// ---------------- bulk labs ----------------
// The morning lab review for a whole unit on one screen: pending labs up front, diagnoses small unless they're waiting on a lab,
// edit a diagnosis's plan for today or add a lab-only diagnosis (those go in the Plan only), then save everything at once.
function bulkLabs(unit, after) {
  const list = unitPts(unit), d = md(S.today);
  const live = pt => pt.problems.filter(q => q.start <= S.today && !(q.resolved && q.resolved < S.today));
  const planToday = (pt, q) => q.start === S.today ? (q.planOpen || "") : (q.plan.find(e => e.date === S.today)?.text ?? dPlan(pt, q, S.today));
  const card = pt => {
    const pend = pendingLabs(pt), waitIds = new Set(pend.map(x => x.problemId).filter(Boolean)), done = labsToday(pt);
    const dx = live(pt).sort((a, b) => waitIds.has(b.id) - waitIds.has(a.id));
    return `<div class="blpt" data-pid="${pt.id}">
      <div class="blh"><span class="pn">${esc(pt.name)}</span>${admA(pt)}<span class="sp"></span>${done.length ? `<span class="ptag ed" title="${esc(done.map(l => l.text).join(" · "))}">${done.length} added today</span>` : ""}</div>
      ${pend.length ? `<div class="blpend">${pend.map(x => `<button class="blwait" data-lab="${esc(x.name)}" title="Add to today's line">${esc(x.name)}<small>pending${x.dx ? " · " + esc(x.dx) : ""}</small></button>`).join("")}</div>` : ""}
      <div class="blrow"><input data-line placeholder="e.g. CMP and CBC Reviewed ${d}." autocomplete="off"><textarea data-ab rows="1" placeholder="Abnormal values, one per line"></textarea></div>
      <div class="bldx">${dx.map(q => `<button class="bdx ${waitIds.has(q.id) ? "wait" : ""}" data-dx="${q.id}">${esc(q.name)}${waitIds.has(q.id) ? `<small>awaiting ${esc(pend.filter(x => x.problemId === q.id).map(x => x.name).join(", "))}</small>` : ""}</button>`).join("")}
        <button class="bdx bnewdx" data-new>${ic("plus", 11)} New diagnosis from labs</button></div>
      <div class="bled">${dx.map(q => `<div class="f" data-edx="${q.id}" hidden><span>${esc(q.name)} · plan ${d}</span><input value="${esc(planToday(pt, q))}" data-orig="${esc(planToday(pt, q))}"></div>`).join("")}
        <div class="bnew" hidden><div class="grid2"><div class="f"><span>New diagnosis (Plan only)</span><input data-nn placeholder="e.g. Hypokalemia"></div><div class="f"><span>Plan</span><input data-np placeholder="K 3.2 on ${d}. Will treat with…"></div></div></div></div>
    </div>`; };
  const m = modal(`${ic("labs")} Labs · ${esc(unit)} · ${d}`, `
    <div class="blquick"><input id="blQ" placeholder="Same line for many? e.g. CMP, CBC, A1c, Lipid Panel, and TSH Reviewed ${d}." autocomplete="off"><button class="btn" id="blFill">Fill empty lines</button></div>
    <p class="muted small" style="margin:-2px 0 10px">Tap a pending lab to add it. Tap a diagnosis to change today's plan for it. A diagnosis found only on labs goes in the Plan, not the HPI.</p>
    <div class="bllist">${list.map(card).join("") || `<p class="muted">No patients on ${esc(unit)}.</p>`}</div>`,
    `<span class="muted small" id="blN"></span><span class="sp"></span><button class="btn" data-x>Cancel</button><button class="btn p" id="blGo">Save labs</button>`, true);
  const changed = c => $("[data-line]", c).value.trim() || $("[data-ab]", c).value.trim() || $("[data-nn]", c).value.trim()
    || $$("[data-edx] input", c).some(i => i.value !== i.dataset.orig);
  const upd = () => { const n = $$(".blpt", m).filter(changed).length; $("#blN", m).textContent = n ? `${n} patient${n > 1 ? "s" : ""} changed` : "";
    $("#blGo", m).textContent = n ? `Save labs for ${n}` : "Save labs"; $$(".blpt", m).forEach(c => c.classList.toggle("chg", !!changed(c))); };
  const grow = t => { t.style.height = "auto"; t.style.height = t.scrollHeight + 2 + "px"; };
  m.addEventListener("input", e => { if (e.target.matches("textarea")) grow(e.target); upd(); });
  $("#blFill", m).onclick = () => { const q = $("#blQ", m).value.trim(); if (!q) return $("#blQ", m).focus();
    $$("[data-line]", m).forEach(i => { if (!i.value.trim()) i.value = q; }); m.dirty = true; upd(); };
  $$("[data-lab]", m).forEach(b => b.onclick = () => {
    const i = $("[data-line]", b.closest(".blpt")), name = b.dataset.lab;
    const parts = t => t.trim().replace(/\s*Reviewed\s+\d+\/\d+\.?\s*$/i, "").split(/\s*,\s*(?:and\s+)?|\s+and\s+/).filter(Boolean);
    const items = parts(i.value), have = new Set(items.map(x => x.toLowerCase()));
    const add = parts(name).filter(x => !have.has(x.toLowerCase()));
    if (add.length) {
      items.push(...add);
      const joined = items.length < 3 ? items.join(" and ") : items.slice(0, -1).join(", ") + ", and " + items.at(-1);
      i.value = `${joined} Reviewed ${d}.`;
    }
    b.classList.add("on"); m.dirty = true; upd(); i.focus();
  });
  $$("[data-dx]", m).forEach(b => b.onclick = () => { const f = $(`[data-edx="${b.dataset.dx}"]`, b.closest(".blpt")); f.hidden = !f.hidden; b.classList.toggle("on", !f.hidden); if (!f.hidden) $("input", f).focus(); });
  $$("[data-new]", m).forEach(b => b.onclick = () => { const f = $(".bnew", b.closest(".blpt")); f.hidden = !f.hidden; b.classList.toggle("on", !f.hidden); if (!f.hidden) $("[data-nn]", f).focus(); });
  upd();
  $("#blGo", m).onclick = e => busy(e.currentTarget, async () => {
    const touched = [];
    for (const c of $$(".blpt", m).filter(changed)) {
      const pt = findPt(c.dataset.pid); pt.labs ||= [];
      const bullets = $("[data-ab]", c).value.split("\n").map(x => x.trim()).filter(Boolean);
      let line = $("[data-line]", c).value.trim();
      if (!line && bullets.length) line = `Labs Reviewed ${d}.`;
      if (line && !pt.labs.some(l => l.date === S.today && l.text === line)) {
        pt.labs.push({ date: S.today, text: line, bullets });
        pt.pendingLabs = (pt.pendingLabs || []).filter(x => !line.toLowerCase().includes(x.toLowerCase()));
      }
      for (const i of $$("[data-edx] input", c)) {
        if (i.value === i.dataset.orig) continue;
        const q = pt.problems.find(x => x.id === i.closest("[data-edx]").dataset.edx);
        if (q.start === S.today) q.planOpen = i.value.trim(); else { const en = todayEntry(pt, q, "plan"); en.text = i.value.trim(); }
      }
      const nn = $("[data-nn]", c).value.trim();
      if (nn) pt.problems.push({ id: uid(), name: nn, symptom: nn.toLowerCase(), start: S.today, hpiOpen: null, planOpen: $("[data-np]", c).value.trim() || "Will continue to monitor",
        meds: [], hpi: [], plan: [], planOnly: true });
      touched.push(pt);
    }
    if (!touched.length) { m.close(true); return; }
    await pool(touched, 4, pt => saveNow(pt, { why: "Labs reviewed" }));
    m.close(true); toast(`Labs saved for ${touched.length} patient${touched.length > 1 ? "s" : ""}`); route(); after?.();
  });
}

// ---------------- bulk admits ----------------
// Type the morning's admits as a list; each gets an empty H&P marked "Needs prep" until someone fills in the form.
function bulkAdmits() {
  const lastUnit = () => $$(".barow select").at(-1)?.value || UNITS[0];
  const rowHtml = u => `<div class="barow"><input placeholder="Last, First" data-n autocomplete="off"><select>${UNITS.map(x => `<option ${x === u ? "selected" : ""}>${x}</option>`).join("")}</select><button class="btn sm" data-rm title="Remove">${ic("x", 12)}</button></div>`;
  const m = modal(`${ic("hp")} Add admits`, `
    <p class="muted" style="margin-bottom:10px">One per line. Enter jumps to a new line. Each one gets an H&amp;P file in the team folder marked <b>Needs prep</b>.</p>
    <div id="baRows">${rowHtml(UNITS[0])}</div>
    <button class="btn sm" id="baMore">${ic("plus", 13)} Add another</button>
    <p class="warnbox" id="baDup" hidden></p>`,
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="baGo">Add admits</button>`);
  const rows = $("#baRows", m);
  const wire = () => { $$("[data-rm]", m).forEach(b => b.onclick = () => { if ($$(".barow", m).length > 1) b.closest(".barow").remove(); count(); }); };
  const add = () => { rows.insertAdjacentHTML("beforeend", rowHtml(lastUnit())); wire(); $$("[data-n]", m).at(-1).focus(); count(); };
  const names = () => $$(".barow", m).map(r => ({ name: $("[data-n]", r).value.trim().replace(/\s*,\s*/, ", "), unit: $("select", r).value })).filter(x => x.name);
  const count = () => {
    const n = names(), dup = n.filter(x => S.pts.some(p => active(p) && p.name.toLowerCase() === x.name.toLowerCase()));
    $("#baGo", m).textContent = n.length ? `Add ${n.length} admit${n.length > 1 ? "s" : ""}` : "Add admits";
    $("#baDup", m).hidden = !dup.length; $("#baDup", m).innerHTML = dup.length ? `Already in the hospital: ${dup.map(x => esc(x.name)).join(", ")}. They'll be skipped.` : "";
  };
  $("#baMore", m).onclick = add; wire();
  m.addEventListener("input", count);
  rows.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches("[data-n]")) { e.preventDefault(); const all = $$("[data-n]", m); all.indexOf(e.target) === all.length - 1 ? add() : all[all.indexOf(e.target) + 1].focus(); } });
  setTimeout(() => $("[data-n]", m)?.focus(), 60);
  $("#baGo", m).onclick = e => busy(e.currentTarget, async () => {
    const list = names().filter(x => !S.pts.some(p => active(p) && p.name.toLowerCase() === x.name.toLowerCase()));
    if (!list.length) return toast("Type at least one name");
    const made = [];
    for (const { name, unit } of list) {
      const rec = { id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + uid(), status: "admit", hpReady: false, name, file: name, unit,
        dob: "", mrn: "", admitDate: S.today, admitTime: "", age: "", sex: "", adolescent: false, psych: { dx: "", taper: "safety" },
        hp: { allergies: "NKA", scribe: S.user?.name || "", meds: [] }, blurb: "", problems: [], vitals: {}, times: {}, refusing: [], labs: [], pendingLabs: [] };
      E.assignTimes([rec], S.today, rec.id + S.today);
      S.pts.push(rec); made.push(rec);
    }
    await pool(made, 4, pt => saveNow(pt, { why: "Added admit (needs prep)" }));
    m.close(true); toast(`Added ${made.length} admit${made.length > 1 ? "s" : ""}`); route();
  });
}

// ---------------- H&P form ----------------
function hpForm(id) {
  const pt = id ? findPt(id) : null, h = pt?.hp || {};
  const v = pt?.vitals?.[pt.admitDate] || {};
  const probs = pt?.problems || [];
  const scribes = scribeNames();
  const probRow = (p = {}) => { const m = p.meds?.[0] || {}; return `<div class="card hpP" style="padding:10px;margin-bottom:8px;box-shadow:none">
    <div class="grid2"><div class="f"><span>Diagnosis</span><input data-f="name" value="${esc(p.name || "")}"></div><div class="f"><span>Symptom word</span><input data-f="symptom" value="${esc(p.symptom || "")}" placeholder="e.g. acid reflux"></div></div>
    <div class="f"><span>HPI (what they report / take at home)</span><input data-f="hpi" value="${esc(p.hpiOpen || p.hpi?.find(e => e.date === p.start)?.text || "")}" placeholder="Patient reports taking Omeprazole 40mg BID PRN at home to manage acid reflux"></div>
    <div class="grid2"><div class="f"><span>Medication</span><input data-f="mname" list="medList" autocomplete="off" value="${esc(m.name || "")}"></div><div class="f"><span>Dose · route · freq</span><input data-f="mdose" value="${esc([m.dose, m.route, m.freq].filter(Boolean).join(" "))}" placeholder="40mg PO BID"></div></div>
    <div class="row hpSug" style="margin-bottom:6px"></div>
    <div class="row"><label class="chip ${m.home !== false && m.name ? "on" : ""}"><input type="checkbox" data-f="home" ${m.home !== false ? "checked" : ""} hidden>Home med</label><label class="chip"><input type="checkbox" data-f="prn" ${m.prn ? "checked" : ""}> PRN</label><span class="sp"></span><button class="btn sm warn" data-rmp>Remove</button></div></div>`; };
  $("#main").innerHTML = `<div class="row" style="margin-bottom:10px"><h1>${pt ? "Edit H&amp;P" : "New H&amp;P"}</h1><span class="sp"></span><a class="btn" href="${pt ? "#pt-" + pt.id : "#home"}" style="text-decoration:none">Cancel</a><button class="btn" id="hSave" title="Save and keep it marked Needs prep">Save · still pending</button><button class="btn p" id="hReady" title="Save and mark it ready for the provider">Save · ready to see</button></div>
    <div class="hpsec card"><div class="hph">${ic("user", 16)} Patient</div>
      <div class="grid3">
        <div class="f span2"><span>Name (Last, First)</span><input id="hN" value="${esc(pt?.name || "")}"></div>
        <div class="f"><span>Unit</span><select id="hU">${UNITS.map(u => `<option ${pt?.unit === u ? "selected" : ""}>${u}</option>`).join("")}</select></div>
        <div class="f"><span>Date of birth</span><input id="hD" value="${esc(pt?.dob || "")}" placeholder="MM/DD/YYYY"></div>
        <div class="f"><span>Age</span><input id="hAge" value="${esc(pt?.age || "")}" inputmode="numeric"></div>
        <div class="f"><span>Sex</span><select id="hSex">${["female", "male"].map(s => `<option ${pt?.sex === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
        <div class="f"><span>MRN (no zeros)</span><input id="hM" value="${esc(pt?.mrn || "")}"></div>
        <div class="f span2"><span>Admitted (date and time)</span><input type="datetime-local" id="hA" value="${pt?.admitDate || S.today}T${(pt?.admitTime || "").padStart(4, "0").replace(/^(\d\d)(\d\d)$/, "$1:$2") || "00:00"}"></div>
        <div class="f"><span>Allergies</span><input id="hAl" value="${esc(h.allergies || "NKA")}"></div>
        <div class="f"><span>Scribe</span><select id="hScr"><option value="">—</option>${scribes.map(s => `<option ${(h.scribe || S.user?.name) === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
      </div><p class="muted small" id="hAdol"></p></div>
    <div class="hpsec card"><div class="hph">${ic("psych", 16)} Admitting diagnosis</div>
      <div class="grid3"><div class="f span2"><span>Primary / admitting diagnosis (from HCS)</span><input id="hDx" value="${esc(pt?.psych?.dx || "")}"></div>
        <div class="f"><span>Taper (from HCS)</span><select id="hTap">${Object.entries({ safety: "Q15 safety checks only", ciwa: "CIWA / Valium", cows: "COWS / Subutex", both: "CIWA and COWS" }).map(([k, n]) => `<option value="${k}" ${pt?.psych?.taper === k ? "selected" : ""}>${n}</option>`).join("")}</select></div></div></div>
    <div class="hpsec card"><div class="hph">${ic("labs", 16)} Medications &amp; history</div>
      <div class="f"><span>Home medications (one per line)</span><textarea id="hMeds" rows="3">${esc((h.meds || []).join("\n"))}</textarea></div>
      <div class="f"><span>Past surgical history</span><input id="hSurg" value="${esc(h.surgical || "No surgical history.")}"></div>
      <div class="lbl">Social history</div>
      <div class="grid3"><div class="f"><span>Alcohol</span><input id="hAlc" value="${esc(h.alcohol || "Patient denies use.")}"></div><div class="f"><span>Nicotine</span><input id="hNic" value="${esc(h.nicotine || "Patient denies use.")}"></div>
        <div class="f"><span>Illicit drugs</span><input id="hDr" value="${esc(h.drugs || "Patient denies use.")}"></div></div></div>
    <div class="hpsec card"><div class="hph">${ic("plus", 16)} Diagnoses &amp; labs <span class="muted small" style="font-weight:400">· every diagnosis is listed in the chief complaint</span></div>
      <div id="hProbs">${probs.map(probRow).join("")}</div>
      <button class="btn sm" id="hAddP">${ic("plus", 13)} Add diagnosis</button>
      <div class="f" style="margin-top:12px"><span>Labs (blank = All Labs Pending)</span><input id="hLab" value="${esc(pt?.labs?.[0]?.text || "")}"></div></div>
    <div class="hpsec card"><div class="hph">${ic("vitals", 16)} Exam &amp; vitals <span class="muted small" style="font-weight:400">· often filled in later</span></div>
      <div class="f"><span>General (objective description)</span><input id="hGen" value="${esc(h.general || "")}" placeholder="Patient appears stated age"></div>
      <div class="grid4">${[["bp", "BP"], ["hr", "Pulse"], ["rr", "Resp"], ["temp", "Temp"], ["o2", "O2 %"], ["ht", "Height (in)"], ["wt", "Weight (lb)"]].map(([k, n]) => `<div class="f"><span>${n}</span><input data-v="${k}" value="${esc(v[k] || "")}"></div>`).join("")}</div></div>`;
  S.formDirty = false; $("#main").addEventListener("input", () => { if (location.hash.startsWith("#hp-")) S.formDirty = true; });
  const adol = () => { const a = parseInt($("#hAge").value); $("#hAdol").textContent = a && a < 18 ? "Under 18: uses the adolescent GU/rectal line." : ""; };
  $("#hAge").oninput = adol; adol();
  const wireRows = () => $$(".hpP").forEach(r => {
    const nm = $('[data-f="mname"]', r), sg = $(".hpSug", r);
    const show = () => { const o = findMed(nm.value); sg.innerHTML = o ? `<span class="muted">Common:</span>` + o.map((x, i) => `<span class="chip sug" data-i="${i}">${esc([x.dose, x.route, x.freq, x.prn ? "PRN" : ""].filter(Boolean).join(" "))}</span>`).join("") : "";
      $$(".sug", sg).forEach(c => c.onclick = () => { const x = o[+c.dataset.i]; $('[data-f="mdose"]', r).value = [x.dose, x.route, x.freq].join(" "); $('[data-f="prn"]', r).checked = x.prn; S.formDirty = true; }); };
    // Suggested HPI line: "Patient reports taking … at home to manage <symptom>." The … fills in from the med as you type it.
    const dxI = $('[data-f="name"]', r), hpiI = $('[data-f="hpi"]', r), symI = $('[data-f="symptom"]', r), doseI = $('[data-f="mdose"]', r);
    const symWord = () => symI.value.trim() || rulebook()[dxI.value.trim()]?.symptom || symFor(dxI.value) || dxI.value.trim().toLowerCase();
    const medText = () => [nm.value.trim(), doseI.value.trim()].filter(Boolean).join(" ");
    const template = () => `Patient reports taking ${medText() || "…"} at home to manage ${symWord()}.`;
    let auto = !hpiI.value.trim();
    const fill = () => { if (auto && dxI.value.trim()) hpiI.value = template(); };
    dxI.addEventListener("change", fill); dxI.addEventListener("input", () => { if (!hpiI.value.trim()) auto = true; fill(); });
    symI.addEventListener("input", fill); doseI.addEventListener("input", fill);
    hpiI.addEventListener("input", () => { auto = false; });
    nm.oninput = () => { show(); fill(); }; show(); $("[data-rmp]", r).onclick = () => r.remove(); $$("label.chip", r).forEach(l => l.onclick = () => setTimeout(() => l.classList.toggle("on", $("input", l).checked))); });
  wireRows();
  $("#hAddP").onclick = () => { $("#hProbs").insertAdjacentHTML("beforeend", probRow()); wireRows(); };
  const saveHp = ready => e => busy(e.currentTarget, async () => {
    const name = $("#hN").value.trim(); if (!name) return toast("Add the patient's name");
    const adm = $("#hA").value || S.today, admit = adm.slice(0, 10), age = parseInt($("#hAge").value) || "";
    const rec = pt || { id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + uid(), status: "admit", problems: [], vitals: {}, times: {}, refusing: [], labs: [], pendingLabs: [] };
    const oldFile = pt ? `${pt.file} ADMIT.docx` : null;
    Object.assign(rec, { name, file: name, unit: $("#hU").value, dob: $("#hD").value, mrn: $("#hM").value, admitDate: admit, admitTime: adm.slice(11, 16).replace(":", ""),
      age, sex: $("#hSex").value, adolescent: !!age && age < 18, psych: { dx: $("#hDx").value.trim(), taper: $("#hTap").value } });
    rec.hp = { allergies: $("#hAl").value, scribe: $("#hScr").value, meds: $("#hMeds").value.split("\n").map(s => s.trim()).filter(Boolean),
      surgical: $("#hSurg").value, alcohol: $("#hAlc").value, nicotine: $("#hNic").value, drugs: $("#hDr").value, general: $("#hGen").value };
    delete rec.needsPrep; rec.hpReady = ready;
    rec.blurb = rec.blurb || `Patient is a ${age} year-old ${rec.sex} who admitted to Aspen Grove Behavioral Hospital for inpatient treatment due to ${rec.psych.dx}.`;
    const vv = {}; $$("[data-v]").forEach(i => { if (i.value.trim()) vv[i.dataset.v] = i.value.trim(); }); rec.vitals[admit] = vv;
    { const t = $("#hLab").value.trim(), rest = (rec.labs || []).slice(1);      // the box edits the first lab line; labs added elsewhere stay
      rec.labs = t ? [{ ...(rec.labs?.[0] || { date: admit, bullets: [] }), text: t }, ...rest] : rest; }
    rec.problems = $$(".hpP").map(r => {
      const g = k => $(`[data-f="${k}"]`, r); const nm = g("name").value.trim(); if (!nm) return null;
      const old = probs.find(p => p.name === nm);
      const [dose, route, ...freq] = g("mdose").value.trim().split(/\s+/);
      const meds = [...(g("mname").value.trim() ? [{ ...(old?.meds?.[0] || {}), id: old?.meds?.[0]?.id || uid(), name: g("mname").value.trim(), dose, route, freq: freq.join(" ") || undefined, prn: g("prn").checked, home: g("home").checked, start: old?.meds?.[0]?.start || admit }] : []),
        ...(old?.meds || []).slice(1)];                                      // meds added in the note editor stay too
      const hv = g("hpi").value.trim(), first = !old?.hpiOpen && old?.hpi?.find(e => e.date === old.start);
      if (first) first.text = hv;                                          // added with "Add diagnosis": the text lives in its first dated entry
      const p = { ...(old || {}), id: old?.id || uid(), name: nm, symptom: g("symptom").value.trim() || nm.toLowerCase(), start: old?.start || admit, hpiOpen: first ? null : hv || null, meds, hpi: old?.hpi || [], plan: old?.plan || [] };
      const autoBefore = !old || !old.planOpen || old.planOpen === "Will continue to monitor" || old.planOpen === E.planOpening(old);
      if (autoBefore) p.planOpen = E.planOpening(p); return p;                // a plan someone typed by hand isn't overwritten
    }).filter(Boolean);
    if (!rec.times[admit]) E.assignTimes([rec], admit, rec.id + admit);
    if (!pt) S.pts.push(rec);
    if (oldFile && oldFile !== `${rec.file} ADMIT.docx`) { try { await S.store.root.removeEntry(oldFile); } catch {} }
    S.formDirty = false; await saveNow(rec, { why: (pt ? "Edited H&P" : "Created H&P") + (ready ? " (ready)" : " (pending)") });
    toast(ready ? `${rec.name}: H&P ready to see` : `${rec.name}: saved, still pending`); location.hash = "pt-" + rec.id;
  });
  $("#hSave").onclick = saveHp(false); $("#hReady").onclick = saveHp(true);
}

// ---------------- bedboard ----------------
// Every unit as a square, every patient colored by status. Seen and billing can be ticked right here.
// Each person keeps their own view settings (palette button); Print makes a one-page fold-up sheet.
const UCOL = { TIMP: [20, 150, 140], Arches: [214, 110, 40], Nebo: [52, 102, 200], Zion: [124, 82, 196], Canyons: [176, 72, 72], Bryce: [46, 140, 70] };
const ucol = u => UCOL[u] || [90, 100, 120];
const BOARD_DEF = { seen: true, bill: true, text: "flag", color: "status", hideOk: false };
const boardPrefs = () => ({ ...BOARD_DEF, ...(S.settings?.boardPrefs?.[S.user?.id || "me"] || {}) });
async function saveMine(key, val) {
  const me = S.user?.id || "me";
  S.settings = { ...S.settings, [key]: { ...(S.settings?.[key] || {}), [me]: val } };
  if (!S.store) return;
  try { const fresh = await S.store.getShared("settings.json", {}); fresh[key] = { ...(fresh[key] || {}), [me]: val }; await S.store.setShared("settings.json", fresh); } catch (e) { console.warn(e); }
}
function bStatus(p) {
  if (p.status === "admit") return "admit";
  const f = loud(flagsFor(p)); return f.some(x => x.level === "red") ? "attn" : f.length ? "fu" : "ok";
}
function bText(p, mode) {
  if (mode === "none") return "";
  if (mode === "dx") return p.problems.filter(q => !(q.resolved && q.resolved < S.today)).map(q => tAbbr(q.name)).join(", ");
  const f = loud(flagsFor(p)); const top = f.find(x => x.level === "red") || f[0];
  return p.status === "admit" ? (hpReady(p) ? "H&P ready" : "H&P needs prep") : top ? top.text + (f.length > 1 ? ` +${f.length - 1}` : "") : "";
}
function bedboard() {
  const P = boardPrefs(), rgb = c => `rgb(${c.join(",")})`;
  const seenN = S.pts.filter(p => active(p) && p.seen?.[S.today]).length, total = S.pts.filter(active).length;
  $("#main").innerHTML = `<div class="row" style="margin-bottom:12px"><h1>Bedboard</h1><span class="muted">${total} patients${P.seen ? ` · <b id="bbSeenN">${seenN}</b> seen` : ""}</span><span class="sp"></span>
      <div class="blegend">${Object.entries(BSTAT).map(([k, v]) => `<span><i style="background:${rgb(v.color)}"></i>${v.label}</span>`).join("")}</div>
      <button class="btn ic" id="bbSet" title="View settings">${ic("palette")}</button><button class="btn" id="bbPrint">${ic("print")} Print</button></div>
    <div class="bboard ${P.color === "unit" ? "byunit" : ""}">${UNITS.map(u => { const l = unitPts(u).filter(p => !P.hideOk || bStatus(p) !== "ok");
      return `<section class="bbu" style="--uc:${rgb(ucol(u))}"><header><a href="#unit-${u}">${u.toUpperCase()}</a><span>${unitPts(u).length}</span></header>
        ${l.map(p => { const st = bStatus(p), t = bText(p, P.text);
          return `<div class="bbr ${p.seen?.[S.today] ? "seen" : ""}" data-pt="${p.id}" style="--sc:${rgb(BSTAT[st].color)}"><i class="bdot" title="${BSTAT[st].label}"></i>
            <a class="bbn" href="#pt-${p.id}"><b>${esc(p.name)}</b>${t ? `<small>${esc(t)}</small>` : ""}</a>
            ${P.bill ? `<input class="cell bbill" value="${esc(p.bill?.[S.today] ?? "")}" placeholder="${tset().today.default3 && always3(p) ? "3" : "–"}" maxlength="1" inputmode="numeric" title="Billing today">` : ""}
            ${P.seen ? `<label class="bseen" title="Seen today"><input type="checkbox" ${p.seen?.[S.today] ? "checked" : ""}><span>${ic("check", 12)}</span></label>` : ""}</div>`; }).join("") || `<p class="muted small" style="padding:8px 10px">${P.hideOk && unitPts(u).length ? "Nothing to flag" : "No patients"}</p>`}</section>`; }).join("")}</div>`;
  $$(".bbr").forEach(r => { const pt = findPt(r.dataset.pt);
    $(".bbill", r)?.addEventListener("change", e => { const v = e.target.value.trim(); pt.bill ||= {}; if (v) pt.bill[S.today] = v; else delete pt.bill[S.today]; saveNow(pt, { docx: false, why: `Billing ${v || "cleared"}` }); });
    $(".bseen input", r)?.addEventListener("change", e => { pt.seen ||= {}; if (e.target.checked) pt.seen[S.today] = S.user?.name || true; else delete pt.seen[S.today]; r.classList.toggle("seen", e.target.checked); if ($("#bbSeenN")) $("#bbSeenN").textContent = S.pts.filter(p => active(p) && p.seen?.[S.today]).length; saveNow(pt, { docx: false, why: e.target.checked ? "Marked seen" : "Unmarked seen" }); });
  });
  $("#bbPrint").onclick = () => {
    const units = UNITS.map(u => ({ name: u, color: ucol(u), rows: unitPts(u).map(p => ({ name: p.name, status: bStatus(p), text: bText(p, P.text), bill: P.bill ? (p.bill?.[S.today] || "") : "" })) })).filter(u => u.rows.length);
    const doc = boardPdf(window.jspdf.jsPDF, units, { title: `Bedboard · ${new Date(S.today + "T12:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`, showBill: P.bill, showSeen: P.seen, showText: P.text !== "none" });
    const url = URL.createObjectURL(doc.output("blob")), f = document.createElement("iframe");
    f.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0"; f.src = url; document.body.append(f);
    f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { window.open(url); } setTimeout(() => f.remove(), 60000); };
  };
  $("#bbSet").onclick = () => {
    const opt = (k, v, label) => `<button class="chip ${P[k] === v ? "on" : ""}" data-k="${k}" data-v="${v}">${label}</button>`;
    const tog = (k, label, sub) => `<label class="tgl" style="padding:4px 0"><input type="checkbox" data-t="${k}" ${P[k] ? "checked" : ""}><span class="sw"></span><span>${label}<small>${sub}</small></span></label>`;
    const m = modal(`${ic("palette")} Bedboard view`, `<div data-nodirty><p class="muted" style="margin-bottom:10px">Just for you. Saved on every computer you sign in to.</p>
      <div class="lbl" style="margin-top:0">Under each name</div><div class="row">${opt("text", "flag", "Top flag")}${opt("text", "dx", "Diagnoses")}${opt("text", "none", "Nothing")}</div>
      <div class="lbl">Colors</div><div class="row">${opt("color", "status", "By status")}${opt("color", "unit", "By unit")}</div>
      <div class="lbl">Show</div>${tog("seen", "Seen today", "A check box per patient")}${tog("bill", "Billing", "Type 1, 2 or 3 right on the board")}${tog("hideOk", "Only patients with something going on", "Hides 'Nothing abnormal'")}</div>`,
      `<button class="btn" id="bbDef">Back to defaults</button><span class="sp"></span><button class="btn p" data-x>Done</button>`);
    const apply = async patch => { Object.assign(P, patch); await saveMine("boardPrefs", { ...P }); bedboard(); };
    $$("[data-k]", m).forEach(b => b.onclick = () => { $$(`[data-k="${b.dataset.k}"]`, m).forEach(x => x.classList.toggle("on", x === b)); apply({ [b.dataset.k]: b.dataset.v }); });
    $$("[data-t]", m).forEach(c => c.onchange = () => apply({ [c.dataset.t]: c.checked }));
    $("#bbDef", m).onclick = async () => { await saveMine("boardPrefs", { ...BOARD_DEF }); m.close(true); bedboard(); };
  };
}

// ---------------- flags (this project's own hub, saved in the team folder) ----------------
async function getFlags() { return S.store ? S.store.getShared("feedback.json", []) : JSON.parse(ls.get("rn-flags") || "[]"); }
async function setFlags(list) { return S.store ? S.store.setShared("feedback.json", list) : ls.set("rn-flags", JSON.stringify(list)); }
// What a tapped spot is, in words, without copying note text (so no patient info ends up in the flag).
function describeSpot(el) {
  const screen = location.hash.startsWith("#pt-") ? "Patient note" : location.hash.startsWith("#unit-") ? "Unit list" : location.hash.slice(1) || "Home";
  if (!el) return screen;
  const sec = el.closest("[data-prob]") ? (el.closest("[id^='p-']") ? "a plan paragraph" : "an HPI paragraph")
    : el.closest(".ed") ? "the diagnosis editor" : el.closest(".sticky") ? "a sticky note" : el.closest(".al") ? "an alert banner"
    : el.closest(".vs,[data-edit='vitals']") ? "the vitals table" : el.closest(".stats") ? "the summary numbers" : el.closest(".unit2") ? "a unit card"
    : el.closest(".daybar") ? "the provider/time bar" : el.closest("#ov") ? "the all-patients table" : el.closest(".tools") ? "the note toolbar" : el.closest(".side") ? "the patient list" : null;
  const lab = el.closest("button,label,th,h1,h2,.box,.lbl,.chip,.tabs a")?.textContent.trim().replace(/\s+/g, " ").slice(0, 50);
  const isCtl = el.closest("button,.chip,.tabs a,label");
  return `${screen}: ${isCtl && lab ? `“${lab}” button` : sec || (lab ? `“${lab}”` : el.tagName.toLowerCase())}`;
}
function plantFlag() {
  const bar = document.createElement("div"); bar.className = "aimbar";
  bar.innerHTML = `${ic("flag")} Go to the screen, then tap the spot your feedback is about.<span class="sp"></span><button class="btn sm" id="aimX">Cancel</button>`;
  document.body.append(bar); document.body.classList.add("aiming");
  const done = () => { bar.remove(); document.body.classList.remove("aiming"); document.removeEventListener("click", pick, true); };
  const pick = e => {
    if (bar.contains(e.target)) { if (e.target.id === "aimX") done(); return; }
    if (e.target.closest(".tabs a, .back")) return;          // let them move between screens first
    e.preventDefault(); e.stopPropagation(); done();
    const el = e.target; el.classList.add("flagged"); setTimeout(() => el.classList.remove("flagged"), 1600);
    raiseFlag(describeSpot(el));
  };
  setTimeout(() => document.addEventListener("click", pick, true), 0);
}
document.addEventListener("contextmenu", e => {
  if (!feedbackOn() || e.target.closest("input,textarea,select,[contenteditable]") || e.shiftKey || document.body.classList.contains("helping")) return;
  e.preventDefault(); const el = e.target; el.classList.add("flagged"); setTimeout(() => el.classList.remove("flagged"), 1600); raiseFlag(describeSpot(el));
});
function raiseFlag(spot) {
  const where = spot || describeSpot(null);
  const m = modal(`${ic("feedback")} Give feedback`, `<div class="lbl" style="margin-top:0">About</div><div class="row"><span class="chip on">${ic("flag", 12)} ${esc(where)}</span>${spot ? "" : `<button class="btn sm" id="fAim">${ic("flag", 12)} Plant a flag on a spot</button>`}</div>
    <div class="f" style="margin-top:10px"><span>What should change or what broke?</span><textarea id="fT" rows="4" placeholder="e.g. Prep should keep the antibiotic dates for UTIs too"></textarea></div>
    <div class="row">${["Bug", "Idea", "Wording"].map((k, i) => `<span class="chip ${i ? "" : "on"}" data-k="${k}">${k}</span>`).join("")}</div>
    <p class="warnbox"><b>Leave out patient names and MRNs.</b> Flags get copied to Claude to fix, so describe the problem, not the patient. Tip: right-click anything to flag that exact spot.</p>`,
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="fGo">Send feedback</button>`);
  $("#fAim", m)?.addEventListener("click", () => { m.close(true); plantFlag(); });
  setTimeout(() => $("#fT", m)?.focus(), 50);
  let kind = "Bug"; $$("[data-k]", m).forEach(c => c.onclick = () => { kind = c.dataset.k; $$("[data-k]", m).forEach(x => x.classList.toggle("on", x === c)); });
  $("#fGo", m).onclick = async () => {
    const text = $("#fT", m).value.trim(); if (!text) return;
    if (/\b\d{5,}\b/.test(text) && !(await ask("Possible patient info", "That flag has a long number in it (like an MRN). Save anyway?", "Save anyway"))) return;
    const list = await getFlags(); list.push({ id: uid(), kind, text, where, by: S.user?.name, date: S.today, status: "open" }); await setFlags(list);
    m.close(true); toast("Thanks! Feedback saved");
  };
}
async function flagHub() {
  const list = await getFlags();
  $("#main").innerHTML = `<div class="row" style="margin-bottom:10px"><h1>Feedback list</h1><span class="sp"></span><button class="btn" id="fCopy">Copy open feedback for Claude</button><button class="btn" id="fDl">${ic("import", 14)} Save as file</button><button class="btn p" id="fNew">${ic("feedback", 14)} Give feedback</button></div>
    <div class="card list">${list.length ? list.slice().reverse().map(f => `<div class="it" style="cursor:default"><span class="nm" style="font-family:var(--sans);font-size:14px">${f.status === "done" ? "<s>" : ""}${esc(f.text)}${f.status === "done" ? "</s>" : ""}<br><small class="muted">${esc(f.kind)} · ${esc(f.where)} · ${esc(f.by || "")} · ${md(f.date)}</small></span>
      <button class="btn sm" data-tog="${f.id}">${f.status === "done" ? "Reopen" : "Done"}</button></div>`).join("") : `<div class="it"><span class="muted">No flags yet.</span></div>`}</div>`;
  $("#fNew").onclick = () => raiseFlag();
  $("#fDl").onclick = () => { const txt = list.map(f => `[${f.status}] [${f.kind}] ${f.text} (${f.where}, ${f.by || ""}, ${f.date})`).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain" })); a.download = `NoteMaker feedback ${S.today}.txt`; a.click(); };
  $("#fCopy").onclick = async () => {
    const open = list.filter(f => f.status !== "done");
    const txt = `NoteMaker feedback (${open.length}):\n` + open.map((f, i) => `${i + 1}. [${f.kind}] ${f.text} (${f.where}, ${f.date})`).join("\n");
    try { await navigator.clipboard.writeText(txt); toast("Copied"); } catch { modal("Copy these", `<textarea style="width:100%" rows="10">${esc(txt)}</textarea>`); }
  };
  $$("[data-tog]").forEach(b => b.onclick = async () => { const f = list.find(x => x.id === b.dataset.tog); f.status = f.status === "done" ? "open" : "done"; await setFlags(list); flagHub(); });
}

// ---------------- trainings (placeholder for now) ----------------
const MODULES = [
  ["book", "Getting around NoteMaker", "Home, units, the note screen, and where everything lives."],
  ["hp", "Writing an H&P", "From HCS to a finished H&P, adult and adolescent."],
  ["note", "Daily notes", "How entries roll forward, what to change on rounds, and the wording rules."],
  ["labs", "Labs and vitals", "Entering results, pending labs, and when a lab means a new diagnosis."],
  ["print", "Printing and the daily count", "Picking the provider, the flag checklist, and billing."],
  ["shield", "Flags and follow-ups", "What red and yellow mean and how to clear them."],
];
function trainingPage() {
  $("#main").innerHTML = `<div class="row" style="margin-bottom:12px"><h1>Trainings</h1></div>
    <div class="trgrid" data-help="trainings">${MODULES.map(([i, t, d], k) => `<div class="card tr"><div class="tri">${ic(i, 22)}</div><b>${k + 1}. ${t}</b><p>${d}</p><span class="soon">Coming soon</span></div>`).join("")}</div>`;
}

// ---------------- help mode ----------------
// "?" in the top bar: take a tour of the page, or click any highlighted piece to learn what it does.
const HELP = {
  home: [
    [".daybar", "Provider bar", "Pick who's rounding, their in/out times (military time), and EKGs reviewed. These feed the daily count."],
    ["#genC", "Generate count", "Builds today's billing count from the Today column. Check it, fix anything, then Save. It stays in the green card."],
    [".census", "Census", "Everyone in house today and the new admits, with their unit. Tap a name to open them."],
    [".fuwrap", "Follow-up flags", "Each unit with what needs attention: red follow-ups, yellow things to check, notes to write up, new admits."],
    ["#ov", "All patients", "The provider sheet. Orange = acute, purple = diabetes. Today's billing saves as you type; a light 3 counts as 3 unless you change it. Always 3?: P always 3, ~ 3 on admit then mental status, M medical issue, OD overdose."],
    ["#tSet", "Table settings", "Providers and supervisors can change colors, short names, and which columns show."],
    [".countcard", "Today's count", "Once saved, today's count lives here all day."],
    ["[data-help=ann]", "Announcements", "Posts for scribes or providers. 'Got it' hides it just for you."],
    ["[data-help=pinned]", "Pinned notes", "Notes for whoever rounds next. They stay for everyone until someone marks them resolved."],
  ],
  unit: [
    ["#prep", "Prep", "Copies every note forward to tomorrow. Anything changed today shows up for review first."],
    ["#qn", "Make a Note", "Jot something fast on rounds. A yellow dot follows that patient until it's written up."],
    ["#vit", "Vitals", "Type the unit's vitals in one grid. Refused or UTO fills a whole row."],
    ["#labsU", "Labs", "Review labs for the whole unit at once: pending labs up top, fix a diagnosis's plan, or add a lab-only diagnosis. One save."],
    ["#prn", "Print unit", "Pick who to print, check flags (missing vitals, no labs today), then print as one job. The signed page can come off on top."],
    ["#bill", "Billing", "Type billing for the unit (it saves into the Home list). EKGs sit right next to it, and Always 3 shows why."],
    [".list", "Patients", "Tap a name to open their note. Red and yellow text means something needs a look."],
  ],
  pt: [
    [".glance", "Needs attention", "Everything flagged on this note. Go to jumps to the paragraph it's about. Long lists fold up under '+ more'."],
    ["#addP", "Add diagnosis", "Starts a new problem dated today. It warns you if it's already on the note."],
    ["#labs", "Add labs", "Shows what's pending and what's already in the note, so nothing gets entered twice."],
    ["#stk", "Add a note", "A quick note to write up later, or a note that stays with the patient."],
    ["#reprint", "Print", "Prints this note exactly as you see it."],
    ["#moreB", "More", "Vitals, patient info, the psych line, edit history, and discharge."],
    ["#paper", "The note", "Only what prints. Tap any paragraph to edit it. Yellow is today's entry; underlined names have a comment in the margin."],
    ["#cmts", "Comments", "Like Word comments: why something's underlined, plus the Addressed button. Hover to link a comment to its paragraph."],
  ],
  rules: [
    [".segtabs", "Supervisor tools", "People and PINs, who edited what, saved daily counts, and the team's rules."],
    ["#nuGo", "Add person", "New people start with PIN 1234 and pick their own the first time they sign in."],
  ],
  flags: [["#fCopy", "Copy for Claude", "Copies every open item so it can be pasted into a chat and fixed."]],
  training: [["[data-help=trainings]", "Trainings", "Modules for new scribes. They're on the way."]],
  hp: [["#hSave", "Save H&P", "Saves the H&P file to the team folder as 'Last, First ADMIT'."]],
};
function helpKey() { const h = location.hash.slice(1); return h.startsWith("unit-") ? "unit" : h.startsWith("pt-") ? "pt" : h.startsWith("hp") ? "hp" : HELP[h] ? h : "home"; }
const helpItems = () => (HELP[helpKey()] || []).map(([sel, t, x]) => ({ el: $(sel), t, x })).filter(i => i.el && i.el.offsetParent !== null);
function helpMenu() {
  const m = modal(`${ic("help")} Help`, `<div class="sites"><button class="site" id="hTour"><b>Take a tour</b><span>Walk through this page step by step</span></button>
    <button class="site" id="hPick"><b>Click something</b><span>Tap any highlighted part to see what it does</span></button></div>`, "");
  $("#hTour", m).onclick = () => { m.close(true); tour(); };
  $("#hPick", m).onclick = () => { m.close(true); helpPick(); };
}
function bubble(item, foot) {
  $$(".hbub").forEach(b => b.remove()); $$(".hring").forEach(e => e.classList.remove("hring"));
  item.el.classList.add("hring"); item.el.scrollIntoView({ behavior: "smooth", block: "center" });
  const b = document.createElement("div"); b.className = "hbub"; b.innerHTML = `<b>${item.t}</b><p>${item.x}</p><div class="row">${foot}</div>`;
  document.body.append(b);
  setTimeout(() => { const r = item.el.getBoundingClientRect(), w = Math.min(320, innerWidth - 20);
    let top = r.bottom + 10; if (top + b.offsetHeight > innerHeight - 10) top = Math.max(10, r.top - b.offsetHeight - 10);
    b.style.cssText = `top:${top}px;left:${Math.max(10, Math.min(r.left, innerWidth - w - 10))}px;width:${w}px`; }, 350);
  return b;
}
function endHelp() { $$(".hbub,.hbar").forEach(b => b.remove()); $$(".hring,.hspot").forEach(e => e.classList.remove("hring", "hspot")); document.body.classList.remove("helping"); document.removeEventListener("click", helpClick, true); }
function tour() {
  const items = helpItems(); if (!items.length) return toast("No tour for this page yet");
  document.body.classList.add("helping"); let i = 0;
  const show = () => { const b = bubble(items[i], `<span class="muted">${i + 1} of ${items.length}</span><span class="sp"></span><button class="btn sm" data-h="x">End tour</button>${i ? `<button class="btn sm" data-h="b">Back</button>` : ""}<button class="btn sm p" data-h="n">${i < items.length - 1 ? "Next" : "Done"}</button>`);
    b.insertAdjacentHTML("afterbegin", `<button class="hclose" data-h="x" title="End tour">${ic("x", 14)}</button>`);
    $$("[data-h]", b).forEach(x => x.onclick = () => { if (x.dataset.h === "x") return endHelp(); if (x.dataset.h === "b") i--; else i++; if (i >= items.length) endHelp(); else show(); }); };
  show();
}
let helpList = [];
function helpClick(e) {
  if (e.target.closest(".hbar,.hbub")) { if (e.target.closest("[data-hx]")) endHelp(); return; }
  e.preventDefault(); e.stopPropagation();
  const it = helpList.find(x => x.el.contains(e.target));
  if (it) bubble(it, `<span class="sp"></span><button class="btn sm" data-hx>Done</button>`); else $$(".hbub").forEach(b => b.remove());
}
function helpPick() {
  helpList = helpItems(); if (!helpList.length) return toast("Nothing to explain on this page yet");
  document.body.classList.add("helping"); helpList.forEach(i => i.el.classList.add("hspot"));
  const bar = document.createElement("div"); bar.className = "aimbar hbar"; bar.innerHTML = `${ic("help")} Tap any highlighted part to see what it does.<span class="sp"></span><button class="btn sm" data-hx>Done</button>`;
  document.body.append(bar);
  setTimeout(() => document.addEventListener("click", helpClick, true), 0);
}
document.addEventListener("keydown", e => { if (e.key === "Escape" && document.body.classList.contains("helping")) endHelp(); });
window.addEventListener("hashchange", () => endHelp());

// ---------------- supervisor & team rules ----------------
const sha = async t => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("rn:" + t)))].map(b => b.toString(16).padStart(2, "0")).join("");
const isSup = () => !!S.store?.demo || S.user?.role === "supervisor" || !!S.user?.admin;
const users = () => S.settings.users || [];
const providerNames = () => { const p = users().filter(u => u.role === "provider").map(u => u.name); return p.length ? p : PROVIDERS; };
const scribeNames = () => users().filter(u => u.role !== "provider").map(u => u.name);
const pinHash = (u, pin) => sha(u.id + ":" + pin);
async function saveSettings() { await S.store.setShared("settings.json", S.settings); }
async function addUser(name, role) {
  const u = { id: uid(), name, role, mustReset: true }; u.pin = await pinHash(u, "1234");
  (S.settings.users ||= []).push(u); await saveSettings(); return u;
}
async function setPin(u, pin) { u.pin = await pinHash(u, pin); u.mustReset = false; await saveSettings(); }
function signIn(u) { S.user = { id: u.id, name: u.name, role: u.role, admin: !!u.admin }; try { sessionStorage.setItem("rn-user", u.id); } catch {} }
function signOut() { S.user = null; try { sessionStorage.removeItem("rn-user"); } catch {} route(); }
function newPinModal(u, title = "Choose your own PIN") {
  return new Promise(res => {
    const m = modal(title, `<p class="muted">You're signed in with the starting PIN. Pick a new one (4+ digits) that only you know.</p>
      <div class="f"><span>New PIN</span><input id="n1" type="password" inputmode="numeric"></div><div class="f"><span>Type it again</span><input id="n2" type="password" inputmode="numeric"></div>`,
      `<button class="btn p" id="nGo2">Save PIN</button>`);
    setTimeout(() => $("#n1", m)?.focus(), 50);
    $("#nGo2", m).onclick = async () => { const a = $("#n1", m).value, b = $("#n2", m).value;
      if (a.length < 4) return toast("Use at least 4 digits"); if (a !== b) return toast("The two PINs don't match"); if (a === "1234") return toast("Pick something other than 1234");
      await setPin(u, a); m.close(true); toast("PIN saved"); res(); };
  });
}
function loginScreen() {
  const list = users();
  $("#main").innerHTML = `<div class="card welcome">
    <img class="logo" src="icons/favicon.svg" alt=""><h1>${list.length ? "Sign in" : "Set up the supervisor"}</h1>
    ${list.length ? `<div class="f" style="margin-top:12px"><span>Who are you?</span><select id="lU" class="btn" style="text-align:left">${list.slice().sort((a, b) => a.name.localeCompare(b.name)).map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join("")}</select></div>
      <div class="f"><span>PIN</span><input id="lP" type="password" inputmode="numeric" autocomplete="off"></div>
      <button class="btn p" id="lGo" style="width:100%;margin-top:6px">Sign in</button>
      <p class="muted" style="margin-top:10px">New here? Your starting PIN is 1234. Forgot it? Ask the supervisor to reset it.</p>`
    : `<p class="muted" style="margin:6px 0 12px">First time in this team folder. Make the supervisor account: they add everyone else and manage the rules.</p>
      <div class="f"><span>Your name (as it should show)</span><input id="sN" placeholder="e.g. B. Olsen"></div>
      <div class="f"><span>PIN (4+ digits)</span><input id="sP" type="password" inputmode="numeric"></div>
      <button class="btn p" id="sGo" style="width:100%;margin-top:6px">Create supervisor</button>`}
    <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--paperLine)" class="row"><button class="btn sm" id="lSite">${ic("hospital", 13)} ${S.site}</button><button class="btn sm" id="lDemo">Demo</button><span class="sp"></span><button class="btn sm" id="lFold">Change team folder</button></div></div>`;
  const go = async () => {
    const u = list.find(x => x.id === $("#lU").value);
    if (await pinHash(u, $("#lP").value) !== u.pin) { toast("Wrong PIN"); $("#lP").select(); return; }
    signIn(u); if (u.mustReset) await newPinModal(u);
    location.hash = "home"; route();
  };
  $("#lGo")?.addEventListener("click", go);
  $("#lP")?.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
  setTimeout(() => $("#lP")?.focus(), 50);
  $("#sGo")?.addEventListener("click", async () => {
    const name = $("#sN").value.trim(), pin = $("#sP").value; if (!name) return toast("Add your name"); if (pin.length < 4) return toast("Use at least 4 digits");
    const u = await addUser(name, "supervisor"); await setPin(u, pin); signIn(u); location.hash = "home"; route();
  });
  $("#lDemo").onclick = async () => { S.store = await Store.demoStore(); await load(); };
  $("#lSite")?.addEventListener("click", () => { setSite(null); route(); });
  $("#lFold").onclick = async () => { await Store.forget(); S.store = null; S.pts = []; route(); };
}
async function suggest(item) {
  S.rules.pending ||= []; S.rules.pending.push({ id: uid(), date: S.today, ...item }); await saveRules();
  toast("Sent to the supervisor for approval");
}
function wordDiff(a, b) {           // the part that changed between what the app wrote and what the scribe wrote
  const A = a.split(" "), B = b.split(" "); let i = 0; while (i < A.length && i < B.length && A[i] === B[i]) i++;
  let j = 0; while (j < A.length - i && j < B.length - i && A[A.length - 1 - j] === B[B.length - 1 - j]) j++;
  return { find: A.slice(i, A.length - j).join(" "), replace: B.slice(i, B.length - j).join(" ") };
}
function teachModal(pt, p, hE, pE) {
  const pick = (hE && hE.auto && hE.text !== hE.auto) ? ["hpi", hE] : (pE && pE.auto && pE.text !== pE.auto) ? ["plan", pE] : ["hpi", hE || {}];
  const [field, e] = pick; const d = e.auto ? wordDiff(e.auto, e.text) : { find: "", replace: "" };
  const after = (hE?.text || "").split(",").slice(1).join(",").trim().replace(/\.$/, "");
  const m = modal(`${ic("teach")} Make this a rule`, `
    <p class="muted">Rules teach the app to stop repeating a mistake. ${isSup() ? "You're the supervisor, so it starts working right away." : "The supervisor approves it first, then it works on every computer."}</p>
    ${e.auto ? `<div class="lbl">The app wrote</div><div class="card" style="padding:8px 10px;box-shadow:none;font-family:var(--serif)">${esc(e.auto)}</div>
    <div class="lbl">You changed it to</div><div class="card" style="padding:8px 10px;box-shadow:none;font-family:var(--serif)">${esc(e.text)}</div>` : ""}
    <label class="chk"><input type="radio" name="tk" value="swap" checked><div><b>Swap words every time</b><small>Whenever the app would write the first part, write the second instead.</small></div></label>
    <div class="grid2" style="margin:4px 0 6px 27px"><div class="f"><span>Instead of</span><input id="tF" value="${esc(d.find)}"></div><div class="f"><span>Write</span><input id="tR" value="${esc(d.replace)}"></div></div>
    <div class="row" style="margin-left:27px"><select id="tS" class="btn sm"><option value="dx">Only for ${esc(p.name)}</option><option value="all">For every diagnosis</option></select>
      <select id="tW" class="btn sm"><option value="${field}">${field === "hpi" ? "In the HPI" : "In the plan"}</option><option value="both">HPI and plan</option></select></div>
    <label class="chk"><input type="radio" name="tk" value="status"><div><b>Standard wording for ${esc(p.name)}</b><small>What goes after "Patient taking ___," on normal days.</small></div></label>
    <div class="f" style="margin-left:27px"><input id="tP" value="${esc(after)}" placeholder="denies acid reflux today"></div>
    <label class="chk"><input type="radio" name="tk" value="flag"><div><b>Change how ${esc(p.name)} is flagged</b></div></label>
    <div style="margin-left:27px"><select id="tG" class="btn sm"><option value="routine">Routine (never flag)</option><option value="alwaysFlag">Always flag</option></select></div>`,
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="tGo">${isSup() ? "Save rule" : "Send to supervisor"}</button>`);
  $("#tGo", m).onclick = async () => {
    const kind = $('input[name="tk"]:checked', m).value;
    let item;
    if (kind === "swap") { const f = $("#tF", m).value; if (!f) return toast("Fill in what to replace");
      item = { type: "wording", rule: { id: uid(), find: f, replace: $("#tR", m).value, dx: $("#tS", m).value === "dx" ? p.name : "", field: $("#tW", m).value, from: S.today } }; }
    else if (kind === "status") item = { type: "dx", dx: p.name, change: { status: $("#tP", m).value.trim() }, note: "Standard wording" };
    else item = { type: "dx", dx: p.name, change: { [$("#tG", m).value]: true, ...( $("#tG", m).value === "routine" ? { alwaysFlag: false } : { routine: false }) }, note: "Flag setting" };
    m.close();
    if (isSup()) { applySuggestion(item); await saveRules(); toast("Rule saved for everyone"); route(); } else await suggest(item);
  };
}
function applySuggestion(it) {
  if (it.type === "wording") { S.rules.wording.push({ ...it.rule, status: "active" }); }
  if (it.type === "dx") S.rules.dx[it.dx] = { ...(S.rules.dx[it.dx] || {}), ...it.change };
}
async function rulesPage() {
  await loadRules(); S.settings = await S.store.getShared("settings.json", S.settings);
  const sup = isSup(), rb = rulebook();
  const names = Object.keys(rb).sort((a, b) => (rb[b].seen || 0) - (rb[a].seen || 0) || a.localeCompare(b));
  const pend = S.rules.pending || [];
  const desc = it => it.type === "wording" ? `Write “${esc(it.rule.replace)}” instead of “${esc(it.rule.find)}”${it.rule.dx ? ` (${esc(it.rule.dx)})` : " (all)"}`
    : `${esc(it.dx)}: ${esc(it.note || "")} ${it.change.status ? `“${esc(it.change.status)}”` : ""}`;
  const ROLE = { scribe: "Scribe", provider: "Provider", supervisor: "Supervisor" };
  const edits = S.pts.flatMap(pt => (pt.log || []).map(l => ({ ...l, pt }))).sort((a, b) => b.at - a.at);
  const who = S.supWho || ""; const shown = edits.filter(e => !who || e.by === who).slice(0, 80);
  const counts = Object.entries(S.days || {}).filter(([, d]) => d.count).sort((a, b) => a[0] < b[0] ? 1 : -1);
  $("#main").innerHTML = `<div class="row" style="margin-bottom:10px"><h1>${sup ? "Supervisor tools" : "Team rules"}</h1><span class="sp"></span>${sup ? `<span class="pill ok">${esc(S.user?.name || "")}</span>` : ""}</div>
    ${sup ? `<div class="segtabs">${[["people", "people", "People"], ["edits", "history", "Who edited what"], ["counts", "count", "Daily counts"], ["rules", "rule", "Rules"]].map(([k, i, n]) => `<button class="${(S.supTab || "people") === k ? "on" : ""}" data-tab="${k}">${ic(i, 14)} ${n}</button>`).join("")}</div>` : ""}
    <section data-sec="people" ${sup && (S.supTab || "people") === "people" ? "" : "hidden"}>
  
      <div class="card" style="overflow:auto;margin-top:8px"><table class="ovt"><tr><th>Name</th><th>Role</th><th>PIN</th><th title="Can read the Feedback list">Feedback list</th><th></th></tr>
        ${users().slice().sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name)).map(u => `<tr data-u="${u.id}"><td class="nm"><input class="cell wide" data-uname value="${esc(u.name)}"></td>
          <td><select class="cell wide" data-urole>${Object.entries(ROLE).map(([k, n]) => `<option value="${k}" ${u.role === k ? "selected" : ""}>${n}</option>`).join("")}</select></td>
          <td>${u.mustReset ? `<span class="muted">starting PIN (1234)</span>` : "set"}${u.admin ? ` <span class="muted" title="Same access as a supervisor">· full access</span>` : ""}</td>
          <td style="text-align:center"><input type="checkbox" data-ufb ${u.feedback || u.role === "supervisor" ? "checked" : ""} ${u.role === "supervisor" ? "disabled" : ""}></td>
          <td style="text-align:right"><button class="btn sm" data-reset>Reset PIN</button> ${u.id === S.user?.id ? "" : `<button class="btn sm warn" data-urm>Remove</button>`}</td></tr>`).join("")}</table></div>
      <div class="row" style="margin-top:10px"><input id="nuN" class="btn" style="flex:1;min-width:160px;text-align:left" placeholder="New person's name"><select id="nuR" class="btn">${Object.entries(ROLE).map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select><button class="btn p" id="nuGo">${ic("plus", 14)} Add person</button></div>
    </section>
    <section data-sec="edits" ${sup && S.supTab === "edits" ? "" : "hidden"}>
      <div class="row"><span class="sp"></span>
        <select id="wFil" class="btn sm"><option value="">Everyone</option>${[...new Set(edits.map(e => e.by))].map(n => `<option ${who === n ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></div>
      <div class="card" style="overflow:auto;margin-top:8px"><table class="ovt zebra"><tr><th>When</th><th>Who</th><th>Patient</th><th>What</th></tr>
        ${shown.map(e => `<tr data-go="${e.pt.id}" style="cursor:pointer"><td>${new Date(e.at).toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}</td><td><b>${esc(e.by)}</b></td><td>${esc(e.pt.name)} <span class="muted">${e.pt.unit}</span></td><td>${esc(e.what)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">No edits yet.</td></tr>`}</table></div>
    </section>
    <section data-sec="counts" ${sup && S.supTab === "counts" ? "" : "hidden"}>
      <div class="countgrid">${counts.map(([d, x]) => `<div class="sticky count"><div class="sh"><b>${md(d)}</b><span class="muted">saved by ${esc(x.count.by || "")}</span></div><pre>${esc(x.count.text)}</pre></div>`).join("") || `<p class="muted">No counts saved yet. Generate one from Home at the end of the day.</p>`}</div>
    </section>
    <section data-sec="rules" ${!sup || S.supTab === "rules" ? "" : "hidden"}>

    ${pend.length ? `<h2>Waiting for approval (${pend.length})</h2><div class="card list">${pend.map(it => `<div class="it" style="cursor:default"><span class="nm" style="font-family:var(--sans);font-size:14px">${desc(it)}<br><small class="muted">suggested ${md(it.date)}</small></span>
      ${sup ? `<button class="btn sm go" data-ok="${it.id}">Approve</button><button class="btn sm" data-no="${it.id}">Decline</button>` : `<span class="muted">pending</span>`}</div>`).join("")}</div>` : ""}
    <h2>Wording rules</h2>
    <div class="card list">${S.rules.wording.length ? S.rules.wording.map(r => `<div class="it" style="cursor:default"><span class="nm" style="font-family:var(--sans);font-size:14px">Write “${esc(r.replace)}” instead of “${esc(r.find)}”<br><small class="muted">${r.dx ? esc(r.dx) : "All diagnoses"} · ${r.field === "both" ? "HPI and plan" : r.field === "plan" ? "Plan" : "HPI"}${r.from ? " · since " + md(r.from) : ""}</small></span>
      ${sup ? `<button class="btn sm warn" data-delw="${r.id}">Remove</button>` : ""}</div>`).join("") : `<div class="it"><span class="muted">No wording rules yet. Use “Make this a rule” in a note after fixing something the app wrote.</span></div>`}</div>
    <h2>Diagnoses</h2>

    <div class="card" style="overflow:auto"><table class="ovt rules"><tr><th>Diagnosis</th><th>Seen</th><th>Flag</th><th>Standard wording</th><th>Auto number</th></tr>
      ${names.map(n => { const r = rb[n] || {}; const mode = r.alwaysFlag ? "always" : r.routine ? "routine" : "auto";
        return `<tr data-dx="${esc(n)}"><td class="nm">${esc(n)}</td><td>${r.seen || 0}</td>
          <td><select data-k="flag" ${sup ? "" : "disabled"}><option value="auto" ${mode === "auto" ? "selected" : ""}>Auto</option><option value="routine" ${mode === "routine" ? "selected" : ""}>Routine</option><option value="always" ${mode === "always" ? "selected" : ""}>Always flag</option></select></td>
          <td><input data-k="status" value="${esc(r.status || "")}" placeholder="reports ___ managed well with medications" ${sup ? "" : "disabled"}></td>
          <td><select data-k="autoVital" ${sup ? "" : "disabled"}>${["", "bp", "hr", "bg"].map(k => `<option value="${k}" ${(r.autoVital || "") === k ? "selected" : ""}>${k ? k.toUpperCase() : "—"}</option>`).join("")}</select></td></tr>`; }).join("")}</table></div>
    </section>`;
  $$("[data-tab]").forEach(b => b.onclick = () => { S.supTab = b.dataset.tab; rulesPage(); });
  $$("[data-go]").forEach(tr => tr.onclick = () => { location.hash = "pt-" + tr.dataset.go; });
  $("#wFil")?.addEventListener("change", e => { S.supWho = e.target.value; rulesPage(); });
  $("#nuGo")?.addEventListener("click", async () => { const n = $("#nuN").value.trim(); if (!n) return toast("Type their name"); await addUser(n, $("#nuR").value); toast(`${n} added. Starting PIN 1234`); rulesPage(); });
  $$("tr[data-u]").forEach(tr => {
    const u = users().find(x => x.id === tr.dataset.u);
    $("[data-uname]", tr).onchange = async e => { u.name = e.target.value.trim() || u.name; await saveSettings(); toast("Saved"); };
    $("[data-urole]", tr).onchange = async e => {
      if (u.role === "supervisor" && e.target.value !== "supervisor" && users().filter(x => x.role === "supervisor").length < 2) { e.target.value = "supervisor"; return toast("Keep at least one supervisor"); }
      u.role = e.target.value; await saveSettings(); toast("Saved"); };
    $("[data-ufb]", tr).onchange = async e => { u.feedback = e.target.checked; await saveSettings(); toast("Saved"); };
    $("[data-reset]", tr).onclick = async () => { if (await ask("Reset PIN?", `${esc(u.name)}'s PIN goes back to 1234, and they'll pick a new one next time they sign in.`, "Reset")) { u.pin = await pinHash(u, "1234"); u.mustReset = true; await saveSettings(); toast("PIN reset to 1234"); rulesPage(); } };
    $("[data-urm]", tr)?.addEventListener("click", async () => { if (await ask("Remove person?", `${esc(u.name)} won't be able to sign in. Their past edits stay in the history.`, "Remove")) { S.settings.users = users().filter(x => x !== u); await saveSettings(); rulesPage(); } });
  });
  $$("[data-ok]").forEach(b => b.onclick = async () => { const it = pend.find(x => x.id === b.dataset.ok); applySuggestion(it); S.rules.pending = pend.filter(x => x !== it); await saveRules(); toast("Approved"); rulesPage(); });
  $$("[data-no]").forEach(b => b.onclick = async () => { S.rules.pending = pend.filter(x => x.id !== b.dataset.no); await saveRules(); rulesPage(); });
  $$("[data-delw]").forEach(b => b.onclick = async () => { S.rules.wording = S.rules.wording.filter(r => r.id !== b.dataset.delw); await saveRules(); rulesPage(); });
  if (sup) $$("tr[data-dx] [data-k]").forEach(el => el.onchange = async () => {
    const n = el.closest("tr").dataset.dx, r = (S.rules.dx[n] ||= {});
    if (el.dataset.k === "flag") { r.routine = el.value === "routine"; r.alwaysFlag = el.value === "always"; }
    if (el.dataset.k === "status") r.status = el.value.trim() || undefined;
    if (el.dataset.k === "autoVital") r.autoVital = el.value || undefined;
    await saveRules(); toast("Saved for everyone");
  });
}

// ---------------- start ----------------
function medDatalist() { if ($("#medList")) return; const d = document.createElement("datalist"); d.id = "medList"; d.innerHTML = MED_NAMES.map(n => `<option value="${esc(n)}">`).join(""); document.body.append(d); }
async function boot() {
  medDatalist();
  window.__rnStarted = true;
  applyTheme();
  const r = supported() ? await Store.restore() : {};
  if (r.store) { S.store = r.store; try { await load(); return; } catch (e) { console.warn(e); S.store = null; } }
  if (r.needsClick) S.regrant = r.needsClick;
  route();
}
boot();
document.addEventListener("keydown", e => { if (e.key !== "Escape") return; const t = $(".tray"); if (t) { t.remove(); $("#gear")?.classList.remove("open"); return; } const m = $$(".scrim").at(-1); if (m) m.close(); });
// Hooks for presentation mode (lib/present.js). It only ever uses the demo store.
const DEMO_SEED = d => ({
  board: [{ id: uid(), text: "Gray, Sam: family meeting tomorrow at 1300. Provider wants an updated weight first.", by: "Demo scribe", date: d },
    { id: uid(), text: "Doe, Jane: check the R calf wound before the Augmentin course ends.", by: "Demo provider", date: d }],
  ann: [{ id: uid(), text: "New H&P template is live. Use the adolescent version for anyone under 18.", by: "Supervisor", byId: "sup", to: "everyone", date: d, seen: [] }],
});
initPresent({
  S, route,
  async toStart() {
    endHelp(); $$(".scrim").forEach(x => x.close?.(true)); $(".tray")?.remove();
    setSite(null); S.store = null; S.user = null; S.pts = []; S.viewDate = null; S.open = null; S.snap = null; S.formDirty = false;
    history.replaceState(null, "", location.pathname + location.search); lastHash = ""; route();
  },
  async enterDemo() {
    await Store.wipeDemo(); setSite("AGBH");
    const st = await Store.demoStore(), seed = DEMO_SEED(localToday());
    await st.setShared("board.json", seed.board); await st.setShared("announce.json", seed.ann);
    S.store = st; S.ovAll = false; S.expanded = new Set(); S.provider = ""; S.viewDate = null;
    history.replaceState(null, "", location.pathname + location.search); lastHash = "";
    await load();
  },
  closeModals() { $$(".scrim").forEach(x => x.close?.(true)); },
  unitPdfUrl(u) {
    const list = unitPts(u); if (!list.length) return null;
    const pdf = toPdf(window.jspdf.jsPDF, list.map(pt => blocksFor(pt, S.today, popts({ provider: S.provider || S.days?.[S.today]?.provider || "" }))));
    return URL.createObjectURL(pdf.output("blob"));
  },
});
window.RN = { S, E, Store, load: () => load(), saveNow: (...a) => saveNow(...a), pendingLabs: (...a) => pendingLabs(...a) };   // for debugging in the console
