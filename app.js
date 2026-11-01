// Resilience Notes: the screens. Rules live in engine/, Word/PDF/folders in lib/.
import * as E from "./engine/engine.js";
import { UNITS, PROVIDERS, PE_LINES, TAPERS, blocksFor, progressBlocks } from "./lib/layout.js";
import { toDocx } from "./lib/docx-out.js";
import { readDocx } from "./lib/docx-in.js";
import { toPdf } from "./lib/pdf-out.js";
import { Store, supported } from "./lib/store.js";
import { startPairing } from "./lib/pair.js";
import { demoPatients } from "./lib/demo.js";

// ---------------- state & helpers ----------------
const localToday = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const S = { store: null, pts: [], date: localToday(), overrides: {}, settings: { scribes: [] }, provider: "", open: null, pending: null, regrant: null };
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
  const close = () => { s.remove(); s.onclose?.(); };
  s.addEventListener("click", e => { if (e.target === s || e.target.closest("[data-x]")) close(); });
  document.body.append(s); s.close = close; return s;
}
const ask = (title, text, yes = "OK") => new Promise(res => {
  const m = modal(title, `<p class="muted" style="font-size:14px">${text}</p>`, `<button class="btn" data-x>Cancel</button><button class="btn p" data-yes>${yes}</button>`);
  m.onclose = () => res(false); $("[data-yes]", m).onclick = () => { m.onclose = null; m.remove(); res(true); };
});

// ---------------- rulebook & flags ----------------
function rulebook() {
  const rb = E.learn({}, S.pts.filter(active));
  for (const [k, v] of Object.entries(S.overrides)) rb[k] = { ...(rb[k] || { seen: 0 }), ...v };
  return rb;
}
function flagsFor(pt, date = S.date) {
  const done = pt.addressed?.[date] || [];
  return E.flags(pt, date, rulebook()).filter(f => !done.includes(f.text));
}
const loud = fs => fs.filter(f => f.level === "red" || f.level === "amber");
const editedToday = (pt, p) => [...p.hpi, ...p.plan].some(e => e.date === S.date && e.text !== e.auto);

// ---------------- saving ----------------
const timers = {};
function save(pt, { docx = true } = {}) {
  clearTimeout(timers[pt.id]);
  timers[pt.id] = setTimeout(async () => {
    pt.updated = Date.now();
    const r = await S.store.savePatient(pt);
    if (r === "conflict") return conflict(pt);
    if (docx) writeDocx(pt).catch(e => console.warn("docx", e));
  }, 350);
}
async function saveNow(pt) {
  clearTimeout(timers[pt.id]); pt.updated = Date.now();
  const r = await S.store.savePatient(pt); if (r === "conflict") return conflict(pt);
  await writeDocx(pt);
}
function conflict(pt) {
  const m = modal("Changed on another computer", `<p class="muted" style="font-size:14px">${esc(pt.name)}'s note was saved from another computer after you opened it. Load their version, or keep yours (this overwrites theirs)?</p>`,
    `<button class="btn" data-load>Load theirs</button><button class="btn p" data-keep>Keep mine</button>`);
  $("[data-load]", m).onclick = async () => { const fresh = await S.store.reloadPatient(pt.id); Object.assign(pt, fresh); m.close(); route(); };
  $("[data-keep]", m).onclick = async () => { await S.store.savePatient(pt, true); await writeDocx(pt); m.close(); toast("Saved"); };
}
const lastDate = pt => pt.problems.flatMap(p => [...p.hpi, ...p.plan]).reduce((a, e) => e.date > a ? e.date : a, S.date);
async function docxTarget(pt) {
  const unitDir = await S.store.unitDir(pt.unit, true);
  if (pt.status === "admit") return { dir: S.store.root, name: `${pt.file} ADMIT.docx` };
  return { dir: unitDir, name: `${pt.file}.docx` };
}
async function writeDocx(pt) {
  if (pt.status === "discharged") return;
  const { dir, name } = await docxTarget(pt);
  if (pt.imported && !pt.backedUp && await S.store.exists(dir, name)) {     // keep the hand-made original once
    const bdir = await S.store.dir(await S.store.data(), "originals", true);
    const f = await (await dir.getFileHandle(name)).getFile();
    await S.store.write(bdir, `${pt.unit} - ${name}`, await f.arrayBuffer());
    pt.backedUp = true; S.store.savePatient(pt, true);
  }
  const blob = await toDocx(window.docx, blocksFor(pt, pt.status === "admit" ? pt.admitDate : lastDate(pt), {}));
  await S.store.write(dir, name, blob);
}

// ---------------- theme (Look) ----------------
const LOOKS = { light: ["Light", "#efebe3", "#0f1726"], dark: ["Dark", "#0b111d", "#22c9a0"], sepia: ["Sepia", "#e9dfcb", "#3b2f1e"], chameleon: ["Chameleon", "", ""] };
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
      <img class="logo" src="icons/favicon.svg" alt="">
      <span class="brand">RESILIENCE NOTES</span>
      ${S.store?.demo ? `<span class="pill a" style="font-size:10px">DEMO</span>` : ""}
      <span class="sp"></span>
      <input type="date" class="datebox" id="workDate" value="${S.date}" title="Working date">
      <button class="gear" id="gear" aria-label="Settings"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button>
    </div>
    ${S.store ? `<nav class="tabs"><a href="#home" class="${!curUnit && !hash.startsWith("pt-") ? "on" : ""}">HOME</a>${UNITS.map(u => {
      const red = counts[u].some(p => flagsFor(p).some(f => f.level === "red"));
      return `<a href="#unit-${u}" class="${curUnit === u ? "on" : ""}">${u.toUpperCase()}<i>${counts[u].length}</i>${red ? `<span class="rd"></span>` : ""}</a>`;
    }).join("")}</nav>` : ""}`;
  $("#workDate").onchange = e => { if (e.target.value) { S.date = e.target.value; route(); } };
  $("#gear").onclick = toggleTray;
}
function toggleTray() {
  const old = $(".tray"); if (old) { old.remove(); $("#gear").classList.remove("open"); return; }
  $("#gear").classList.add("open");
  const cur = ls.get("rn-theme") || "light";
  const t = document.createElement("div"); t.className = "tray";
  t.innerHTML = `<h4>Look</h4><div class="looks">${Object.entries(LOOKS).map(([k, [n, bg, fg]]) =>
    `<button data-look="${k}" class="${cur === k ? "on" : ""}"><span class="sw" style="background:${k === "chameleon" ? "conic-gradient(#e5484d,#f0a020,#22c9a0,#4f7cff,#a855f7,#e5484d)" : `linear-gradient(135deg,${bg} 55%,${fg} 55%)`}"></span>${n}</button>`).join("")}</div>
    ${cur === "chameleon" ? `<button class="item" data-reroll>🦎 New colors</button>` : ""}
    <h4>Feedback</h4>
    <button class="item" data-flag>⚑ Raise a flag</button>
    <button class="item" data-hub>📋 Flag list</button>
    ${S.store ? `<h4>Team</h4><button class="item" data-scribes>✎ Scribe names</button>
    <button class="item" data-folder>📁 ${S.store.demo ? "Leave demo" : "Change team folder"}</button>` : ""}`;
  document.body.append(t);
  const close = () => { t.remove(); $("#gear")?.classList.remove("open"); };
  $$("[data-look]", t).forEach(b => b.onclick = () => { ls.set("rn-theme", b.dataset.look); applyTheme(b.dataset.look); close(); toggleTray(); });
  $("[data-reroll]", t)?.addEventListener("click", () => { ls.set("rn-hue", String(Math.floor(Math.random() * 360))); applyTheme("chameleon"); });
  $("[data-flag]", t).onclick = () => { close(); raiseFlag(); };
  $("[data-hub]", t).onclick = () => { close(); location.hash = "flags"; };
  $("[data-scribes]", t)?.addEventListener("click", () => { close(); editScribes(); });
  $("[data-folder]", t)?.addEventListener("click", async () => { close(); await Store.forget(); S.store = null; S.pts = []; location.hash = ""; boot(); });
  setTimeout(() => document.addEventListener("click", function off(e) { if (!t.contains(e.target) && e.target.id !== "gear" && !e.target.closest("#gear")) { close(); document.removeEventListener("click", off); } }), 0);
}

// ---------------- routing ----------------
function route() {
  shell();
  const h = location.hash.slice(1), main = $("#main");
  main.style.animation = "none"; void main.offsetWidth; main.style.animation = "";
  if (!S.store) return welcome();
  if (h.startsWith("unit-")) return unitView(h.slice(5));
  if (h.startsWith("pt-")) return ptView(h.slice(3));
  if (h === "hp-new") return hpForm();
  if (h.startsWith("hp-")) return hpForm(h.slice(3));
  if (h === "flags") return flagHub();
  return home();
}
window.addEventListener("hashchange", () => { S.open = null; route(); });

// ---------------- welcome / folder ----------------
function welcome() {
  $("#main").innerHTML = `<div class="card welcome">
    <img class="logo" src="icons/favicon.svg" alt="">
    <h1>Resilience Notes</h1>
    <p class="muted" style="margin:6px 0 16px">Preps tomorrow's notes, flags what needs you, and prints a whole unit at once. Everything stays in your team folder; nothing is sent anywhere.</p>
    ${S.regrant ? `<button class="btn go" id="regrant">Reconnect to ${esc(S.regrant.name)}</button><p class="muted" style="margin-top:8px">Edge asks once per visit before the app can use the folder again.</p>` : ""}
    ${supported() ? `<button class="btn p" id="pick" style="margin-top:10px">Choose team folder</button>
      <p class="muted" style="margin-top:8px">Pick <b>U:\\Scans\\Tomco</b> (the folder with the unit folders inside).</p>`
      : `<p class="warnbox">Choosing a folder needs Microsoft Edge or Chrome on a computer. You can still try the demo.</p>`}
    <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--paperLine)">
      <button class="btn" id="demo">Try the demo (fake patients)</button>
    </div>
  </div>`;
  $("#pick")?.addEventListener("click", async () => { try { S.store = await Store.pick(); await load(); } catch (e) { if (e.name !== "AbortError") toast("Couldn't open that folder: " + e.message); } });
  $("#regrant")?.addEventListener("click", async () => { const s = await Store.regrant(S.regrant); if (s) { S.store = s; S.regrant = null; await load(); } });
  $("#demo").onclick = async () => { S.store = await Store.demoStore(); await load(); };
}

async function load() {
  S.pts = await S.store.loadPatients();
  S.pts.forEach(p => p.file ||= p.name);
  if (S.store.demo && !S.pts.length) {
    toast("Setting up fake patients…");
    S.pts = demoPatients(S.date);
    for (const pt of S.pts) { await S.store.savePatient(pt, true); await writeDocx(pt); }
  }
  S.overrides = await S.store.getShared("rulebook.json", {});
  S.settings = await S.store.getShared("settings.json", { scribes: [] });
  if (!location.hash || location.hash === "#") location.hash = "home"; else route();
}
window.addEventListener("focus", async () => {        // pick up other computers' changes
  if (!S.store || S.open || $(".scrim")) return;
  try { S.pts = await S.store.loadPatients(); route(); } catch {}
});

// ---------------- home dashboard ----------------
function home() {
  const live = S.pts.filter(active);
  const admitsToday = S.pts.filter(p => p.admitDate === S.date).length;
  const dcToday = S.pts.filter(p => p.dischargedOn === S.date).length;
  const red = live.reduce((n, p) => n + flagsFor(p).filter(f => f.level === "red").length, 0);
  const waiting = live.filter(p => p.status === "admit");
  const tomorrow = E.addDays(S.date, 1);
  const prepped = u => { const l = unitPts(u).filter(p => p.status !== "admit"); return l.length && l.every(p => p.problems.every(q => (q.resolved && q.resolved <= S.date) || q.hpi.some(e => e.date === tomorrow)) ); };
  const day = new Date(S.date + "T12:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  $("#main").innerHTML = `
    <div class="row"><h1>${day}</h1><span class="sp"></span>
      <button class="btn" id="imp">Import notes</button><a class="btn p" href="#hp-new" style="text-decoration:none">+ New H&amp;P</a></div>
    <div class="stats">
      <div class="card stat"><b>${live.length}</b><span>In the hospital</span></div>
      <div class="card stat"><b>${admitsToday}</b><span>Admits today</span></div>
      <div class="card stat"><b>${dcToday}</b><span>Discharges today</span></div>
      <div class="card stat ${red ? "r" : ""}"><b>${red}</b><span>Urgent flags</span></div>
    </div>
    <h2>Units</h2>
    <div class="units">${UNITS.map(u => {
      const l = unitPts(u), fs = l.flatMap(p => flagsFor(p)), r = fs.filter(f => f.level === "red").length, a = fs.filter(f => f.level === "amber").length;
      return `<a class="card unit" href="#unit-${u}"><div class="row"><span class="nm">${u.toUpperCase()}</span><span class="sp"></span>
        ${r ? `<span class="pill r">${r}</span>` : ""}${a ? `<span class="pill a">${a}</span>` : ""}${!r && !a ? `<span class="pill ok">clear</span>` : ""}</div>
        <div class="ln">${l.length} patient${l.length === 1 ? "" : "s"}${l.some(p => p.status === "admit") ? ` · ${l.filter(p => p.status === "admit").length} admit` : ""}</div>
        <div class="ln">${prepped(u) ? "✓ Prepped for " + md(tomorrow) : "Not prepped for " + md(tomorrow) + " yet"}</div></a>`;
    }).join("")}</div>
    ${waiting.length ? `<h2>New admits (H&amp;P)</h2><div class="card list">${waiting.map(p => `<a class="it" href="#pt-${p.id}"><span class="nm">${esc(p.name)}<span class="tag">ADMIT</span></span><span class="mk q">${p.unit} · admitted ${md(p.admitDate)}</span></a>`).join("")}</div>` : ""}
    ${S.store.demo ? `<p class="warnbox">Demo mode: every patient here is fake, and nothing touches the U: drive.</p>` : ""}`;
  $("#imp").onclick = importNotes;
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
  const found = [];
  for (const s of sources) {
    const file = s.e.name.replace(/\.docx$/i, "");
    if (S.pts.some(p => p.file === file && active(p))) continue;
    try {
      const pt = await readDocx(window.JSZip, await (await s.e.h.getFile()).arrayBuffer(), s.e.name);
      found.push({ ...s, file, pt, unit: s.unit || UNITS.find(u => u.toLowerCase() === String(pt.unit).toLowerCase()) || "" });
    } catch (err) { found.push({ ...s, file, bad: true }); }
  }
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
    $("#doImp").disabled = true; $("#doImp").textContent = "Importing…";
    let n = 0, bad = [];
    for (const f of pick) {
      try {
        const pt = f.pt; pt.unit = f.unit; pt.file = f.file; pt.id = (pt.id + "-" + uid()).replace(/[^a-z0-9-]/gi, "");
        const target = await S.store.unitDir(f.unit, true);
        if (!(await target.isSameEntry(f.dir))) {
          if (await S.store.exists(target, f.e.name)) await f.dir.removeEntry(f.e.name);   // a copy is already in the unit folder
          else await S.store.move(f.dir, f.e.name, target);
        }
        await S.store.savePatient(pt, true); S.pts.push(pt); n++;
      } catch (err) { bad.push(f.file); console.warn(err); }
    }
    m.close(); toast(`Imported ${n}${bad.length ? `, couldn't import ${bad.length}` : ""}`); route();
  };
}

// ---------------- unit view ----------------
function unitView(u) {
  if (!UNITS.includes(u)) return home();
  const l = unitPts(u), y = E.addDays(S.date, -1);
  const behind = l.filter(p => p.status !== "admit" && p.problems.some(q => !(q.resolved && q.resolved < S.date) && q.start < S.date && !q.hpi.some(e => e.date === S.date)));
  $("#main").innerHTML = `
    <div class="row" style="margin-bottom:12px"><h1>${u}</h1><span class="muted">${l.length} patients</span><span class="sp"></span>
      <button class="btn" id="vit">Vitals</button><button class="btn" id="prn">Print unit</button><button class="btn go" id="prep">Prep tomorrow</button></div>
    ${behind.length ? `<div class="al amber" style="margin-bottom:10px">${behind.length} note${behind.length > 1 ? "s aren't" : " isn't"} prepped for today (${md(S.date)}).<span class="sp"></span><button class="btn sm" id="catch">Prep from ${md(y)}</button></div>` : ""}
    <div class="card list">${l.length ? l.map(p => {
      const fs = loud(flagsFor(p)); const top = fs.find(f => f.level === "red") || fs[0];
      return `<a class="it" href="#pt-${p.id}"><span class="nm">${esc(p.name)}${p.status === "admit" ? `<span class="tag">ADMIT</span>` : ""}</span>
        <span class="mk ${top ? (top.level === "red" ? "r" : "a") : "q"}">${top ? esc(top.text) + (fs.length > 1 ? ` +${fs.length - 1}` : "") : "ready"}</span></a>`;
    }).join("") : `<div class="it"><span class="muted">No patients on ${u}.</span></div>`}</div>`;
  $("#vit").onclick = () => vitalsModal(u);
  $("#prn").onclick = () => printModal(unitPts(u));
  $("#prep").onclick = () => prepUnit(u);
  $("#catch")?.addEventListener("click", async () => { for (const p of behind) { E.prep(p, y); await saveNow(p); } toast("Caught up"); route(); });
}

// ---------------- patient view ----------------
const val = (pt, k) => pt.vitals?.[S.date]?.[k];
function entriesHtml(list, date) {
  return list.filter(e => e.date <= date).sort((a, b) => a.date < b.date ? -1 : 1)
    .map(e => { const t = `${md(e.date)}: ${esc(/[.!?]$/.test(e.text.trim()) || !e.text.trim() ? e.text.trim() : e.text.trim() + ".")}`; return e.date === date ? `<span class="new">${t}</span>` : t; }).join(" ");
}
function probPara(pt, p, kind, fs) {
  const open = kind === "hpi" ? p.hpiOpen : p.planOpen;
  const ent = entriesHtml(kind === "hpi" ? p.hpi : p.plan, S.date);
  const chips = kind === "hpi" ? fs.filter(f => f.problemId === p.id).map(f => `<span class="mf ${f.level}">${esc(f.text.replace(p.name + ": ", ""))}</span>`).join("") : "";
  return `${esc(p.name)}: ${open ? esc(open.replace(/\.?$/, ".")) + " " : ""}${ent}${chips}`;
}
function ptView(id) {
  const pt = findPt(id); if (!pt) return home();
  const date = S.date, fs = flagsFor(pt);
  const live = pt.problems.filter(p => p.start <= date && !(p.resolved && p.resolved < date));
  const done = pt.problems.filter(p => p.resolved && p.resolved < date);
  const peOver = { ...(pt.peExtra || {}) }, peBy = {};
  live.filter(p => p.peLine).forEach(p => { peOver[p.peLine.key] = p.peLine.text; peBy[p.peLine.key] = p.name; });
  const v = pt.vitals?.[date] || {};
  const n = E.render(pt, date);
  const sideList = unitPts(pt.unit);
  const alerts = loud(fs).filter(f => !f.problemId || !f.text.startsWith("Uncommon") || true);
  $("#main").innerHTML = `<div class="ptwrap">
    <nav class="side">${sideList.map(p => { const c = loud(flagsFor(p)); const r = c.filter(f => f.level === "red").length;
      return `<a href="#pt-${p.id}" class="${p.id === id ? "on" : ""}"><span>${esc(p.name)}</span>${p.status === "admit" ? `<small class="ok">ADMIT</small>` : c.length ? `<span class="pill ${r ? "r" : "a"}">${c.length}</span>` : `<small class="ok">ready</small>`}</a>`; }).join("")}</nav>
    <div style="min-width:0">
      <div class="alerts">${alerts.map(f => `<div class="al ${f.level}"><span>${esc(f.text)}</span><span class="sp"></span>
        ${f.text.startsWith("Uncommon: ") ? `<button class="btn sm" data-routine="${esc(f.text.slice(10))}">Mark routine</button><button class="btn sm" data-always="${esc(f.text.slice(10))}">Always flag</button>` : ""}
        <button class="btn sm" data-addr="${esc(f.text)}">Addressed</button></div>`).join("")}</div>
      <div class="tools">
        <button class="btn sm" id="addP">+ Problem</button><button class="btn sm" id="vit1">Vitals</button><button class="btn sm" id="labs">Labs</button>
        <button class="btn sm" id="psy">Psych line</button><button class="btn sm" id="info">Patient info</button>
        ${pt.status === "admit" ? `<a class="btn sm" href="#hp-${pt.id}" style="text-decoration:none">Edit H&amp;P</a>` : ""}
        <span class="sp"></span><button class="btn sm" id="reprint">Print / reprint</button><button class="btn sm" id="dl">Word file</button>
        <button class="btn sm warn" id="dc">Discharge</button></div>
      <div class="paper" id="paper">
        <div class="hdr"><span>${esc(pt.name)}</span><span>DOB ${esc(pt.dob || "—")} · MRN ${esc(pt.mrn || "—")}</span><span>Unit: ${pt.unit}</span><span>${md(date)}/${date.slice(0, 4)}</span></div>
        <div class="ttl">${pt.status === "admit" ? "HISTORY AND PHYSICAL EXAMINATION" : "MEDICAL PROGRESS NOTE:"}</div>
        <div class="box">CHIEF COMPLAINT/HISTORY OF PRESENT ILLNESS:</div>
        <div class="pp click" data-edit="blurb">${esc(pt.blurb) || `<span class="muted">Add the patient history blurb…</span>`}</div>
        ${live.map(p => `<div class="pp click" data-prob="${p.id}" id="h-${p.id}">${probPara(pt, p, "hpi", fs)}</div><div data-slot="${p.id}"></div>`).join("") ||
          `<div class="pp">- ${md(date)}: Patient denies any physical or medical concerns today.</div>`}
        <div class="boxed"><div class="bl">RESOLVED HPI:</div><div class="bc">${n.resolvedHpi.map(esc).join("<br>")}</div></div>
        <div class="box">REVIEW OF SYSTEMS: <em>Systems were reviewed and normal, except as noted in the HPI.</em></div>
        <div class="box">PHYSICAL EXAMINATION:</div>
        <table class="vs pp click" data-edit="vitals"><tr><th>BP</th><th>Pulse</th><th>RR</th><th>Temp</th><th>O2 Sat</th><th>BG</th></tr>
          <tr><td>${esc(v.bp || "—")}</td><td>${esc(v.hr || "—")}</td><td>${esc(v.rr || "—")}</td><td>${esc(v.temp || "—")}</td><td>${esc(v.o2 || "—")}</td><td>${esc(v.bg || "N/A")}</td></tr></table>
        <div class="pl">${PE_LINES.map(([k, d]) => `<div>${k}: ${esc(peOver[k] || d)}${peOver[k] ? `<span class="mf soft">${peBy[k] ? "changed by " + esc(peBy[k]) : "not template"}</span>` : ""}</div>`).join("")}</div>
        <div class="box">LABORATORY DATA:</div>
        <div class="pp click" data-edit="labs">${(pt.labs || []).length ? pt.labs.map(l => `${esc(l.text)}${(l.bullets || []).map(b => `<br>&nbsp;&nbsp;- ${esc(b)}`).join("")}`).join("<br>") : "All Labs Pending"}${(pt.pendingLabs || []).length ? `<span class="mf amber">${esc(pt.pendingLabs.join(", "))} pending</span>` : ""}</div>
        <div class="box">ASSESSMENT/PLAN:</div>
        <div class="pp">Diet is regular.<br>Activity is as tolerated.</div>
        <div class="pp click" data-edit="psych">${n.plan[0] && pt.psych?.dx ? esc(n.plan[0]).replace(/\n/g, "<br>") : `<span class="muted">Add the primary (psych) diagnosis…</span>`}</div>
        ${live.map(p => `<div class="pp click" data-prob="${p.id}" id="p-${p.id}">${probPara(pt, p, "plan", fs)}</div>`).join("")}
        <div class="boxed"><div class="bl">RESOLVED PLAN:</div><div class="bc">${n.resolvedPlan.map(esc).join("<br>")}</div></div>
        <div class="box">FOLLOW UP WITH PRIMARY CARE PROVIDER FOR THE FOLLOWING:</div>
        <div class="pp">- ${esc([...n.pcp, ...(pt.pcpExtra || [])].join(", ") || "N/A")}</div>
        <div class="mini">Click any paragraph to edit · yellow = today's entry · saves automatically</div>
      </div>
    </div></div>`;
  $$("[data-addr]").forEach(b => b.onclick = () => address(pt, b.dataset.addr));
  $$("[data-routine]").forEach(b => b.onclick = () => setRule(b.dataset.routine, { routine: true }));
  $$("[data-always]").forEach(b => b.onclick = () => setRule(b.dataset.always, { alwaysFlag: true }));
  $$("[data-prob]").forEach(el => el.onclick = e => { if (!e.target.closest(".ed")) openEditor(pt, el.dataset.prob); });
  $('[data-edit="blurb"]').onclick = () => infoModal(pt);
  $('[data-edit="vitals"]').onclick = () => vitalsModal(pt.unit, pt.id);
  $('[data-edit="labs"]').onclick = () => labsModal(pt);
  $('[data-edit="psych"]').onclick = () => psychModal(pt);
  $("#addP").onclick = () => addProblem(pt);
  $("#vit1").onclick = () => vitalsModal(pt.unit, pt.id);
  $("#labs").onclick = () => labsModal(pt);
  $("#psy").onclick = () => psychModal(pt);
  $("#info").onclick = () => infoModal(pt);
  $("#reprint").onclick = () => reprintModal(pt);
  $("#dl").onclick = async () => { await saveNow(pt); const { name } = await docxTarget(pt); toast(`Saved ${name} in the ${pt.status === "admit" ? "team" : pt.unit} folder`); };
  $("#dc").onclick = () => discharge(pt);
  if (S.open) openEditor(pt, S.open);
}
async function address(pt, text) {
  const f = flagsFor(pt).find(x => x.text === text);
  const p = f?.problemId && pt.problems.find(q => q.id === f.problemId);
  const med = p && p.meds.find(m => text.startsWith(m.name) && m.end);
  if (med) med.addressed = true;
  else ((pt.addressed ||= {})[S.date] ||= []).push(text);
  await saveNow(pt); route();
}
async function setRule(name, rule) { S.overrides[name] = { ...(S.overrides[name] || {}), ...rule }; await S.store.setShared("rulebook.json", S.overrides); toast(rule.routine ? `${name} marked routine` : `${name} will always be flagged`); route(); }

// ---------------- problem editor ----------------
function todayEntry(pt, p, kind) {
  const list = kind === "hpi" ? p.hpi : p.plan;
  let e = list.find(x => x.date === S.date);
  if (!e) {
    const text = kind === "hpi" ? E.defaultHpi(pt, p, S.date) : E.defaultPlan(pt, p, S.date);
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
  if (p.start === S.date) { p.planOpen = E.planOpening(p); return; }
  const e = todayEntry(pt, p, "plan");
  if (e.text === e.auto) { e.text = e.auto = E.defaultPlan(pt, p, S.date); }
}
function medRow(pt, p, m) {
  const ref = (pt.refusing || []).includes(m.id);
  return `<div class="med" data-med="${m.id}">
    <input data-k="name" value="${esc(m.name)}" placeholder="Medication">
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
    <div class="x" data-dates ${m.end ? "" : "hidden"}>Start <input type="date" data-k="start" value="${m.start}" style="width:auto">
      Last dose <input type="date" data-k="end" value="${m.end || ""}" style="width:auto"> or <input data-days placeholder="# days" style="width:80px"></div>
  </div>`;
}
function openEditor(pt, pid) {
  const p = pt.problems.find(q => q.id === pid); if (!p) return;
  $$(".ed").forEach(e => e.remove()); $$(".pp.open").forEach(e => e.classList.remove("open"));
  S.open = pid;
  const firstDay = p.start === S.date;
  const hE = firstDay && !p.hpiOpen ? (p.hpi.find(e => e.date === S.date) || (p.hpi.push({ date: S.date, text: "", auto: "" }), p.hpi.at(-1))) : todayEntry(pt, p, "hpi");
  const pE = firstDay ? null : todayEntry(pt, p, "plan");
  const meds = p.meds.filter(m => !m.discontinued || m.discontinued >= S.date);
  const slot = $(`[data-slot="${pid}"]`); $(`#h-${pid}`)?.classList.add("open");
  const ed = document.createElement("div"); ed.className = "ed";
  ed.innerHTML = `
    <div class="grid2"><div><label>Diagnosis</label><input id="eName" value="${esc(p.name)}"></div>
      <div><label>Symptom word (for "reports ___ managed well")</label><input id="eSym" value="${esc(p.symptom || "")}" placeholder="e.g. acid reflux"></div></div>
    <label>HPI ${md(S.date)}${firstDay && !p.hpiOpen ? " (first day: what the patient reports)" : ""}</label>
    <textarea id="eH">${esc(hE.text)}</textarea>
    <label>${firstDay ? "Plan (first day)" : "Plan " + md(S.date)}</label>
    <textarea id="eP">${esc(firstDay ? (p.planOpen || E.planOpening(p)) : pE.text)}</textarea>
    <div class="row" style="margin-top:6px"><button class="btn sm" id="eReset">Reset to suggested wording</button>
      <span class="muted">Auto number:</span><select id="eVit" style="width:auto">${["", "bp", "hr", "bg"].map(k => `<option value="${k}" ${p.autoVital === k || (!p.autoVital && !k) ? "selected" : ""}>${k ? k.toUpperCase() : "none"}</option>`).join("")}</select></div>
    <label>Medications</label>
    <div class="meds" id="eMeds">${meds.map(m => medRow(pt, p, m)).join("")}</div>
    <button class="btn sm" id="eAdd" style="margin-top:6px">+ Add medication</button>
    <label>Options</label>
    <div class="row">
      <span class="chip ${p.alwaysFlag ? "on" : ""}" data-o="alwaysFlag">Always flag</span>
      <span class="chip ${p.pcp ? "on" : ""}" data-o="pcp">PCP follow-up</span>
      <span class="chip ${p.peLine ? "on" : ""}" data-o="pe">Affects exam</span>
      <span class="chip ${p.resolved === S.date ? "on" : ""}" data-o="resolve">${p.resolved === S.date ? "Resolving today" : "Resolve today"}</span>
    </div>
    <div id="ePe" ${p.peLine ? "" : "hidden"} style="margin-top:6px"><div class="grid2"><select id="ePeK">${PE_LINES.map(([k]) => `<option ${p.peLine?.key === k ? "selected" : ""}>${k}</option>`).join("")}</select>
      <input id="ePeT" value="${esc(p.peLine?.text || "")}" placeholder="New exam line"></div></div>
    <div class="row" style="margin-top:12px"><button class="btn sm warn" id="eDel">Delete problem</button><span class="sp"></span><button class="btn p" id="eDone">Done</button></div>`;
  slot.append(ed);
  ed.scrollIntoView({ behavior: "smooth", block: "nearest" });
  const changed = (docx = true) => { refreshParas(pt, p); save(pt, { docx }); };
  $("#eName", ed).oninput = e => { p.name = e.target.value; changed(); };
  $("#eSym", ed).oninput = e => { p.symptom = e.target.value; const t = todayEntry(pt, p, "hpi"); if (t.text === t.auto && !firstDay) { t.text = t.auto = E.defaultHpi(pt, p, S.date); $("#eH", ed).value = t.text; } changed(); };
  $("#eH", ed).oninput = e => { hE.text = e.target.value; changed(); };
  $("#eP", ed).oninput = e => { if (firstDay) p.planOpen = e.target.value; else pE.text = e.target.value; changed(); };
  $("#eVit", ed).onchange = e => { p.autoVital = e.target.value || undefined; $("#eReset", ed).click(); };
  $("#eReset", ed).onclick = () => {
    if (!(firstDay && !p.hpiOpen)) { hE.text = hE.auto = E.defaultHpi(pt, p, S.date); $("#eH", ed).value = hE.text; }
    if (firstDay) { p.planOpen = E.planOpening(p); $("#eP", ed).value = p.planOpen; } else { pE.text = pE.auto = E.defaultPlan(pt, p, S.date); $("#eP", ed).value = pE.text; }
    changed();
  };
  const wireMed = row => {
    const m = p.meds.find(x => x.id === row.dataset.med);
    $$("input[data-k]", row).forEach(inp => inp.oninput = () => {
      const k = inp.dataset.k; m[k] = inp.value || undefined;
      if ((k === "dose" || k === "freq") && m.start < S.date && !m.home) m.changedOn = S.date;
      if ((k === "dose" || k === "freq") && m.start < S.date && m.home) m.changedOn = S.date;
      if (k === "end" && m.end) m.addressed = false;
      syncPlan(pt, p); $("#eP", ed).value = firstDay ? p.planOpen : pE.text; changed();
    });
    $("[data-days]", row).oninput = e => { const d = parseInt(e.target.value); if (d > 0) { m.end = E.addDays(m.start, d - 1); $('[data-k="end"]', row).value = m.end; m.addressed = false; syncPlan(pt, p); $("#eP", ed).value = firstDay ? p.planOpen : pE.text; changed(); } };
    $$("[data-t]", row).forEach(c => c.onclick = () => {
      const t = c.dataset.t;
      if (t === "prn") m.prn = !m.prn;
      if (t === "home") m.home = !m.home;
      if (t === "refuse") { pt.refusing ||= []; pt.refusing = pt.refusing.includes(m.id) ? pt.refusing.filter(x => x !== m.id) : [...pt.refusing, m.id];
        const t2 = todayEntry(pt, p, "hpi"); if (t2.text === t2.auto) { t2.text = t2.auto = E.defaultHpi(pt, p, S.date); $("#eH", ed).value = t2.text; } }
      if (t === "dates") { $("[data-dates]", row).hidden = false; if (!m.end) return; }
      if (t === "stop") m.discontinued = m.discontinued === S.date ? undefined : S.date;
      syncPlan(pt, p); changed(); openEditor(pt, pid);
    });
    $("[data-del]", row).onclick = () => { p.meds = p.meds.filter(x => x !== m); syncPlan(pt, p); changed(); openEditor(pt, pid); };
  };
  $$(".med", ed).forEach(wireMed);
  $("#eAdd", ed).onclick = () => { p.meds.push({ id: uid(), name: "", start: S.date }); changed(false); openEditor(pt, pid); setTimeout(() => $$(".med input", ed.isConnected ? ed : document).at(-5)?.focus(), 50); };
  $$("[data-o]", ed).forEach(c => c.onclick = () => {
    const o = c.dataset.o;
    if (o === "alwaysFlag") p.alwaysFlag = !p.alwaysFlag;
    if (o === "pcp") p.pcp = !p.pcp;
    if (o === "pe") { if (p.peLine) delete p.peLine; else p.peLine = { key: "SKIN", text: "" }; }
    if (o === "resolve") p.resolved = p.resolved === S.date ? undefined : S.date;
    changed(); openEditor(pt, pid);
  });
  $("#ePeK", ed).onchange = e => { p.peLine.key = e.target.value; changed(); };
  $("#ePeT", ed).oninput = e => { p.peLine.text = e.target.value; changed(); };
  $("#eDel", ed).onclick = async () => { if (await ask("Delete problem?", `Remove <b>${esc(p.name)}</b> and all its entries from this note? Use Resolve instead if it got better.`, "Delete")) { pt.problems = pt.problems.filter(q => q !== p); S.open = null; await saveNow(pt); route(); } };
  $("#eDone", ed).onclick = async () => { S.open = null; await saveNow(pt); route(); };
}
function addProblem(pt) {
  const m = modal("New problem", `<div class="f"><span>Diagnosis</span><input id="nN" placeholder="e.g. Cellulitis, left forearm"></div>
    <div class="f"><span>What the patient reports today</span><textarea id="nH" rows="3" placeholder="Patient presents with…"></textarea></div>
    <div class="f"><span>Symptom word</span><input id="nS" placeholder="e.g. cellulitis"></div>
    <p class="muted">Add medications in the next step. The first HPI entry is dated ${md(S.date)}.</p>`,
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="nGo">Add</button>`);
  $("#nN", m).focus();
  $("#nGo", m).onclick = async () => {
    const name = $("#nN", m).value.trim(); if (!name) return;
    const p = { id: uid(), name, symptom: $("#nS", m).value.trim() || name.toLowerCase(), start: S.date, hpiOpen: null, planOpen: "Will continue to monitor", meds: [],
      hpi: [{ date: S.date, text: $("#nH", m).value.trim(), auto: "" }], plan: [] };
    pt.problems.push(p); m.close(); await saveNow(pt); S.open = p.id; route();
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
    pt.unit = newUnit; m.close(); await saveNow(pt); route();
  };
}
function psychModal(pt) {
  const ps = pt.psych ||= { dx: "", taper: "none" };
  const m = modal("Primary diagnosis line", `<div class="f"><span>Primary (psych) diagnosis from HCS</span><textarea id="yD" rows="2">${esc(ps.dx)}</textarea></div>
    <div class="f"><span>Taper line (only if psychiatry started one)</span><select id="yT">${[["none", "None"], ["ciwa", "CIWA / Valium"], ["cows", "COWS / Subutex"], ["both", "CIWA and COWS"]].map(([k, n]) => `<option value="${k}" ${ps.taper === k ? "selected" : ""}>${n}</option>`).join("")}</select></div>`,
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="yGo">Save</button>`);
  $("#yGo", m).onclick = async () => { ps.dx = $("#yD", m).value.trim(); ps.taper = $("#yT", m).value; m.close(); await saveNow(pt); route(); };
}
function labsModal(pt) {
  pt.labs ||= []; pt.pendingLabs ||= [];
  const m = modal("Labs", `
    <div id="lList">${pt.labs.map((l, i) => `<div class="card" style="padding:10px;margin-bottom:8px;box-shadow:none"><div class="row"><b style="flex:1">${esc(l.text)}</b><button class="btn sm warn" data-rm="${i}">Remove</button></div>${(l.bullets || []).map(b => `<div class="muted">- ${esc(b)}</div>`).join("")}</div>`).join("") || `<p class="muted">No results yet (prints "All Labs Pending").</p>`}</div>
    <div class="lbl">Add a result</div>
    <div class="f"><span>Line</span><input id="lT" placeholder="CMP reviewed ${md(S.date)}."></div>
    <div class="f"><span>Abnormal values (one per line, become bullets)</span><textarea id="lB" rows="3" placeholder="Potassium 5.6 (H)"></textarea></div>
    <div class="f"><span>Still pending (one per line, flagged until removed)</span><textarea id="lP" rows="2">${esc(pt.pendingLabs.join("\n"))}</textarea></div>
    ${pt.problems.length ? `<p class="warnbox">New results can change a diagnosis. Check: ${pt.problems.filter(p => !p.resolved).map(p => esc(p.name)).join(", ")}.</p>` : ""}`,
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="lGo">Save</button>`);
  $$("[data-rm]", m).forEach(b => b.onclick = async () => { pt.labs.splice(+b.dataset.rm, 1); m.close(); await saveNow(pt); labsModal(pt); route(); });
  $("#lGo", m).onclick = async () => {
    const t = $("#lT", m).value.trim();
    if (t) pt.labs.push({ date: S.date, text: t, bullets: $("#lB", m).value.split("\n").map(s => s.trim()).filter(Boolean) });
    pt.pendingLabs = $("#lP", m).value.split("\n").map(s => s.trim()).filter(Boolean);
    m.close(); await saveNow(pt); route();
  };
}
function reprintModal(pt) {
  const m = modal("Print or reprint", `<div class="f"><span>Print the note as it was on</span><input type="date" id="rD" value="${S.date}" max="${lastDate(pt)}"></div>
    <div class="f"><span>Provider</span><select id="rP"><option value="">(none)</option>${PROVIDERS.map(p => `<option ${S.provider === p ? "selected" : ""}>${p}</option>`).join("")}</select></div>
    <p class="muted">Anything added after that date is left off, so old days reprint exactly.</p>`,
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="rGo">Print</button>`);
  $("#rGo", m).onclick = () => { const d = $("#rD", m).value; S.provider = $("#rP", m).value; m.close(); printPdf([pt.status === "admit" ? blocksFor(pt, d, { provider: S.provider }) : progressBlocks(pt, d, { provider: S.provider })], `${pt.file} ${md(d).replace("/", "-")}.pdf`); };
}
async function discharge(pt) {
  const m = modal(`Discharge ${esc(pt.name)}`, `<p class="muted" style="font-size:14px">Moves the note into ${pt.unit}'s discharge folder and takes them off the list.</p>
    <label class="chk"><input type="checkbox" id="dSeen"><div>We saw them today<small>Print today's note before moving it</small></div></label>`,
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="dGo">Discharge</button>`);
  $("#dGo", m).onclick = async () => {
    if ($("#dSeen", m).checked) await printPdf([progressBlocks(pt, S.date, { provider: S.provider })], `${pt.file}.pdf`);
    await saveNow(pt);
    try {
      const { dir, name } = await docxTarget(pt);
      const to = pt.status === "admit" ? await S.store.subDir(await S.store.unitDir(pt.unit, true), "admit") : await S.store.subDir(dir, "discharge");
      await S.store.move(dir, name, to);
    } catch (e) { toast("Couldn't move the Word file: " + e.message); }
    pt.status = "discharged"; pt.dischargedOn = S.date; await S.store.savePatient(pt, true);
    m.close(); toast(`${pt.name} discharged`); location.hash = `unit-${pt.unit}`;
  };
}

// ---------------- vitals (grid + phone camera) ----------------
function vitalsModal(unit, focusId) {
  const list = unitPts(unit), K = [["bp", "BP"], ["hr", "Pulse"], ["rr", "RR"], ["temp", "Temp"], ["o2", "O2"], ["bg", "BG"]];
  const m = modal(`Vitals · ${unit} · ${md(S.date)}`, `<div class="vwrap">
    <div class="card" style="padding:12px;box-shadow:none">
      <b>Phone camera</b><p class="muted" style="margin:4px 0">Scan with your phone, then capture the vitals sheet. Pictures show here only and vanish when you close this.</p>
      <div class="row"><span class="status"><span class="dot" id="vDot"></span><span id="vSt">Not started</span></span><span class="sp"></span><span class="code" id="vCode"></span></div>
      <div class="qr" id="vQr" hidden></div>
      <button class="btn sm" id="vPair" style="margin-top:6px">Show QR code</button>
      <div class="shots" id="vShots"></div>
    </div>
    <div style="overflow:auto"><table class="vgrid"><tr><th>Patient</th>${K.map(([, n]) => `<th>${n}</th>`).join("")}<th></th></tr>
      ${list.map(p => `<tr data-id="${p.id}"><td class="nm">${esc(p.name)}</td>${K.map(([k]) => `<td><input data-k="${k}" value="${esc(p.vitals?.[S.date]?.[k] || "")}" inputmode="${k === "bp" ? "text" : "decimal"}"></td>`).join("")}<td><button class="btn sm" data-clr>Clear</button></td></tr>`).join("")}
    </table></div></div>`,
    `<button class="btn warn" id="vAll">Clear all</button><span class="sp"></span><button class="btn" data-x>Cancel</button><button class="btn p" id="vSave">Save vitals</button>`, true);
  let pair = null; m.onclose = () => pair?.stop();
  $("#vPair", m).onclick = () => {
    pair?.stop();
    pair = startPairing({ qrEl: $("#vQr", m), onCode: c => $("#vCode", m).textContent = c,
      onStatus: (t, st) => { $("#vSt", m).textContent = t; $("#vDot", m).className = "dot " + (st || ""); },
      onImage: blob => { const url = URL.createObjectURL(blob); const img = document.createElement("img"); img.src = url; img.onclick = () => window.open(url); $("#vShots", m).prepend(img); } });
    $("#vPair", m).textContent = "New code";
  };
  $$("[data-clr]", m).forEach(b => b.onclick = () => $$("input", b.closest("tr")).forEach(i => i.value = ""));
  $("#vAll", m).onclick = () => $$(".vgrid input", m).forEach(i => i.value = "");
  if (focusId) setTimeout(() => $(`tr[data-id="${focusId}"] input`, m)?.focus(), 80);
  $("#vSave", m).onclick = async () => {
    for (const tr of $$("tr[data-id]", m)) {
      const pt = findPt(tr.dataset.id), v = {};
      $$("input", tr).forEach(i => { if (i.value.trim()) v[i.dataset.k] = i.value.trim(); });
      (pt.vitals ||= {})[S.date] = v; E.fillVitals(pt, S.date);
      for (const p of pt.problems) if (p.autoVital) { const e = p.hpi.find(x => x.date === S.date); if (e && e.text === e.auto) e.text = e.auto = E.defaultHpi(pt, p, S.date); }
      await saveNow(pt);
    }
    m.close(); toast("Vitals saved"); route();
  };
}

// ---------------- prep ----------------
async function prepUnit(u) {
  const list = unitPts(u), review = [], tomorrow = E.addDays(S.date, 1);
  let quiet = 0, converted = [];
  for (const pt of list) {
    if (pt.status === "admit") {                       // day 2: H&P becomes the running progress note
      if (pt.admitDate > S.date) continue;
      const { dir, name } = await docxTarget(pt);
      try { await S.store.move(dir, name, await S.store.subDir(await S.store.unitDir(pt.unit, true), "admit")); } catch {}
      Object.assign(pt, E.convertAdmit(pt));
      converted.push(pt.name);
    }
    const r = E.prep(pt, S.date);
    if (r.review.length) review.push({ pt, items: r.review }); else quiet++;
    await saveNow(pt);
  }
  const m = modal(`Prep ${u} for ${md(tomorrow)}`, `
    <div class="lbl">Copied forward quietly</div><p class="muted">${quiet} patient${quiet === 1 ? "" : "s"} with no changes today.</p>
    ${converted.length ? `<div class="lbl">H&amp;P converted to follow-up</div><p class="muted">${converted.map(esc).join(", ")}</p>` : ""}
    ${review.length ? `<div class="lbl">Changed today: check tomorrow's wording</div>${review.map(({ pt, items }) => items.map(it => `
      <div class="chk"><input type="checkbox" checked><div><b>${esc(pt.name)} · ${esc(it.name)}</b> <span class="muted">(${esc(it.reasons.join(", "))})</span>
      <small>HPI ${md(tomorrow)}: ${esc(it.hpi)}</small><small>Plan ${md(tomorrow)}: ${esc(it.plan)}</small>
      <button class="btn sm" data-open="${pt.id}" style="margin-top:6px">Edit</button></div></div>`).join("")).join("")}` : `<p class="muted" style="margin-top:8px">Nothing needs review.</p>`}`,
    `<button class="btn p" data-x>Approve all</button>`);
  $$("[data-open]", m).forEach(b => b.onclick = () => { m.close(); S.date = tomorrow; location.hash = "pt-" + b.dataset.open; });
  m.onclose = async () => { for (const { pt } of review) { pt.problems.forEach(p => p.needsReview = false); await S.store.savePatient(pt, true); } route(); };
}

// ---------------- print ----------------
async function printPdf(notes, name = "notes.pdf") {
  const pdf = toPdf(window.jspdf.jsPDF, notes);
  const url = URL.createObjectURL(pdf.output("blob"));
  const f = document.createElement("iframe"); f.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0";
  f.src = url; document.body.append(f);
  f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { window.open(url); } setTimeout(() => f.remove(), 60000); };
  const t = document.createElement("div"); t.className = "toast"; t.innerHTML = `Print window opening… <a href="${url}" target="_blank" download="${esc(name)}" style="color:inherit;margin-left:8px">Open PDF</a>`;
  document.body.append(t); setTimeout(() => t.remove(), 8000);
}
function printModal(list) {
  if (!list.length) return toast("No notes to print");
  const items = list.flatMap(pt => loud(flagsFor(pt)).map(f => {
    const p = f.problemId && pt.problems.find(q => q.id === f.problemId);
    return { pt, f, auto: !!(p && editedToday(pt, p)) };
  }));
  const m = modal(`Print ${list[0].unit} · ${list.length} notes`, `
    <div class="lbl">Provider (prints on every note, not saved)</div>
    <select id="pP" class="btn" style="width:100%;text-align:left"><option value="">(none)</option>${PROVIDERS.map(p => `<option ${S.provider === p ? "selected" : ""}>${p}</option>`).join("")}</select>
    <div class="lbl">Before you print: open flags</div>
    ${items.length ? items.map((x, i) => `<label class="chk"><input type="checkbox" data-c="${i}" ${x.auto ? "checked" : ""}><div>${esc(x.pt.name)}: ${esc(x.f.text)}<small>${x.auto ? "Edited today, checked for you" : "Not addressed yet"}</small></div></label>`).join("") : `<p class="muted">No open flags. Nice.</p>`}
    <div class="lbl">Printer</div><p class="muted">You'll pick the printer in the next window. Edge remembers the last one.</p>`,
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="pGo">Print ${list.length} notes</button>`);
  const upd = () => { const left = $$("[data-c]", m).filter(c => !c.checked).length; $("#pGo", m).textContent = left ? `Print anyway (${left} unchecked)` : `Print ${list.length} notes`; };
  $$("[data-c]", m).forEach(c => c.onchange = upd); upd();
  $("#pGo", m).onclick = async () => {
    S.provider = $("#pP", m).value; m.close();
    for (const pt of list) await writeDocx(pt).catch(() => {});
    printPdf(list.map(pt => blocksFor(pt, S.date, { provider: S.provider })), `${list[0].unit} ${md(S.date).replace("/", "-")}.pdf`);
  };
}

// ---------------- H&P form ----------------
function hpForm(id) {
  const pt = id ? findPt(id) : null, h = pt?.hp || {};
  const v = pt?.vitals?.[pt.admitDate] || {};
  const probs = pt?.problems || [];
  const scribes = S.settings.scribes || [];
  const probRow = (p = {}) => { const m = p.meds?.[0] || {}; return `<div class="card hpP" style="padding:10px;margin-bottom:8px;box-shadow:none">
    <div class="grid2"><div class="f"><span>Diagnosis</span><input data-f="name" value="${esc(p.name || "")}"></div><div class="f"><span>Symptom word</span><input data-f="symptom" value="${esc(p.symptom || "")}" placeholder="e.g. acid reflux"></div></div>
    <div class="f"><span>HPI (what they report / take at home)</span><input data-f="hpi" value="${esc(p.hpiOpen || "")}" placeholder="Patient reports taking Omeprazole 40mg BID PRN at home to manage acid reflux"></div>
    <div class="grid2"><div class="f"><span>Medication</span><input data-f="mname" value="${esc(m.name || "")}"></div><div class="f"><span>Dose · route · freq</span><input data-f="mdose" value="${esc([m.dose, m.route, m.freq].filter(Boolean).join(" "))}" placeholder="40mg PO BID"></div></div>
    <div class="row"><label class="chip ${m.home !== false && m.name ? "on" : ""}"><input type="checkbox" data-f="home" ${m.home !== false ? "checked" : ""} hidden>Home med</label><label class="chip"><input type="checkbox" data-f="prn" ${m.prn ? "checked" : ""}> PRN</label><span class="sp"></span><button class="btn sm warn" data-rmp>Remove</button></div></div>`; };
  $("#main").innerHTML = `<div class="row" style="margin-bottom:10px"><h1>${pt ? "Edit H&amp;P" : "New H&amp;P"}</h1><span class="sp"></span><a class="btn" href="${pt ? "#pt-" + pt.id : "#home"}" style="text-decoration:none">Cancel</a><button class="btn p" id="hSave">Save H&amp;P</button></div>
    <div class="card" style="padding:16px">
      <div class="grid2">
        <div class="f"><span>Name (Last, First)</span><input id="hN" value="${esc(pt?.name || "")}"></div>
        <div class="f"><span>Unit</span><select id="hU">${UNITS.map(u => `<option ${pt?.unit === u ? "selected" : ""}>${u}</option>`).join("")}</select></div>
        <div class="f"><span>Date of birth</span><input id="hD" value="${esc(pt?.dob || "")}" placeholder="MM/DD/YYYY"></div>
        <div class="f"><span>MRN (no zeros)</span><input id="hM" value="${esc(pt?.mrn || "")}"></div>
        <div class="f"><span>Admit date</span><input type="date" id="hA" value="${pt?.admitDate || S.date}"></div>
        <div class="f"><span>Admit time (hours)</span><input id="hT" value="${esc(pt?.admitTime || "")}" placeholder="2215"></div>
        <div class="f"><span>Age</span><input id="hAge" value="${esc(pt?.age || "")}" inputmode="numeric"></div>
        <div class="f"><span>Sex</span><select id="hSex">${["female", "male"].map(s => `<option ${pt?.sex === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      </div>
      <p class="muted" id="hAdol"></p>
      <div class="f"><span>Chief complaint (#1)</span><input id="hCC" value="${esc(h.cc || "")}"></div>
      <div class="f"><span>Primary / admitting diagnosis (from HCS)</span><input id="hDx" value="${esc(pt?.psych?.dx || "")}"></div>
      <div class="f"><span>Taper (from HCS)</span><select id="hTap">${Object.entries({ safety: "Q15 safety checks only", ciwa: "CIWA / Valium", cows: "COWS / Subutex", both: "CIWA and COWS" }).map(([k, n]) => `<option value="${k}" ${pt?.psych?.taper === k ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      <div class="lbl">Diagnoses (indications)</div>
      <div id="hProbs">${probs.map(probRow).join("")}</div>
      <button class="btn sm" id="hAddP">+ Add diagnosis</button>
      <div class="grid2" style="margin-top:12px">
        <div class="f"><span>Allergies</span><input id="hAl" value="${esc(h.allergies || "NKA")}"></div>
        <div class="f"><span>Scribe</span><select id="hScr"><option value="">—</option>${scribes.map(s => `<option ${h.scribe === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
      </div>
      <div class="f"><span>Home medications (one per line)</span><textarea id="hMeds" rows="3">${esc((h.meds || []).join("\n"))}</textarea></div>
      <div class="f"><span>Past surgical history</span><input id="hSurg" value="${esc(h.surgical || "No surgical history.")}"></div>
      <div class="grid2"><div class="f"><span>Alcohol</span><input id="hAlc" value="${esc(h.alcohol || "Patient denies use.")}"></div><div class="f"><span>Nicotine</span><input id="hNic" value="${esc(h.nicotine || "Patient denies use.")}"></div>
        <div class="f"><span>Illicit drugs</span><input id="hDr" value="${esc(h.drugs || "Patient denies use.")}"></div><div class="f"><span>General (objective description)</span><input id="hGen" value="${esc(h.general || "")}" placeholder="Patient appears stated age"></div></div>
      <div class="lbl">Vitals</div>
      <div class="grid2">${[["bp", "BP"], ["hr", "Pulse"], ["rr", "Resp"], ["temp", "Temp"], ["o2", "O2 %"], ["ht", "Height (in)"], ["wt", "Weight (lb)"]].map(([k, n]) => `<div class="f"><span>${n}</span><input data-v="${k}" value="${esc(v[k] || "")}"></div>`).join("")}</div>
      <div class="f"><span>Labs (blank = All Labs Pending)</span><input id="hLab" value="${esc(pt?.labs?.[0]?.text || "")}"></div>
    </div>`;
  const adol = () => { const a = parseInt($("#hAge").value); $("#hAdol").textContent = a && a < 18 ? "Under 18: uses the adolescent GU/rectal line." : ""; };
  $("#hAge").oninput = adol; adol();
  const wireRows = () => $$(".hpP").forEach(r => { $("[data-rmp]", r).onclick = () => r.remove(); $$("label.chip", r).forEach(l => l.onclick = () => setTimeout(() => l.classList.toggle("on", $("input", l).checked))); });
  wireRows();
  $("#hAddP").onclick = () => { $("#hProbs").insertAdjacentHTML("beforeend", probRow()); wireRows(); };
  $("#hSave").onclick = async () => {
    const name = $("#hN").value.trim(); if (!name) return toast("Add the patient's name");
    const admit = $("#hA").value || S.date, age = parseInt($("#hAge").value) || "";
    const rec = pt || { id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + uid(), status: "admit", problems: [], vitals: {}, times: {}, refusing: [], labs: [], pendingLabs: [] };
    const oldFile = pt ? `${pt.file} ADMIT.docx` : null;
    Object.assign(rec, { name, file: name, unit: $("#hU").value, dob: $("#hD").value, mrn: $("#hM").value, admitDate: admit, admitTime: $("#hT").value,
      age, sex: $("#hSex").value, adolescent: !!age && age < 18, psych: { dx: $("#hDx").value.trim(), taper: $("#hTap").value } });
    rec.hp = { cc: $("#hCC").value, allergies: $("#hAl").value, scribe: $("#hScr").value, meds: $("#hMeds").value.split("\n").map(s => s.trim()).filter(Boolean),
      surgical: $("#hSurg").value, alcohol: $("#hAlc").value, nicotine: $("#hNic").value, drugs: $("#hDr").value, general: $("#hGen").value };
    rec.blurb = rec.blurb || `Patient is a ${age} year-old ${rec.sex} who admitted to Aspen Grove Behavioral Hospital for inpatient treatment due to ${rec.psych.dx}.`;
    const vv = {}; $$("[data-v]").forEach(i => { if (i.value.trim()) vv[i.dataset.v] = i.value.trim(); }); rec.vitals[admit] = vv;
    rec.labs = $("#hLab").value.trim() ? [{ date: admit, text: $("#hLab").value.trim(), bullets: [] }] : [];
    rec.problems = $$(".hpP").map(r => {
      const g = k => $(`[data-f="${k}"]`, r); const nm = g("name").value.trim(); if (!nm) return null;
      const old = probs.find(p => p.name === nm);
      const [dose, route, ...freq] = g("mdose").value.trim().split(/\s+/);
      const meds = g("mname").value.trim() ? [{ id: old?.meds?.[0]?.id || uid(), name: g("mname").value.trim(), dose, route, freq: freq.join(" ") || undefined, prn: g("prn").checked, home: g("home").checked, start: admit }] : [];
      const p = { ...(old || {}), id: old?.id || uid(), name: nm, symptom: g("symptom").value.trim() || nm.toLowerCase(), start: admit, hpiOpen: g("hpi").value.trim() || null, meds, hpi: old?.hpi || [], plan: old?.plan || [] };
      p.planOpen = E.planOpening(p); return p;
    }).filter(Boolean);
    if (!rec.times[admit]) E.assignTimes([rec], admit, rec.id + admit);
    if (!pt) S.pts.push(rec);
    if (oldFile && oldFile !== `${rec.file} ADMIT.docx`) { try { await S.store.root.removeEntry(oldFile); } catch {} }
    await saveNow(rec); toast(`Saved "${rec.file} ADMIT.docx" in the team folder`); location.hash = "pt-" + rec.id;
  };
}
function editScribes() {
  const m = modal("Scribe names", `<div class="f"><span>One name per line (shows in the H&amp;P scribe dropdown)</span><textarea id="sc" rows="6">${esc((S.settings.scribes || []).join("\n"))}</textarea></div>`,
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="scGo">Save</button>`);
  $("#scGo", m).onclick = async () => { S.settings.scribes = $("#sc", m).value.split("\n").map(s => s.trim()).filter(Boolean); await S.store.setShared("settings.json", S.settings); m.close(); toast("Saved"); };
}

// ---------------- flags (this project's own hub, saved in the team folder) ----------------
async function getFlags() { return S.store ? S.store.getShared("feedback.json", []) : JSON.parse(ls.get("rn-flags") || "[]"); }
async function setFlags(list) { return S.store ? S.store.setShared("feedback.json", list) : ls.set("rn-flags", JSON.stringify(list)); }
function raiseFlag() {
  const where = location.hash.startsWith("#pt-") ? "Patient note screen" : location.hash.slice(1) || "Home";
  const m = modal("⚑ Raise a flag", `<div class="f"><span>What should change or what broke?</span><textarea id="fT" rows="4" placeholder="e.g. Prep should keep the antibiotic dates for UTIs too"></textarea></div>
    <div class="row">${["Bug", "Idea", "Wording"].map((k, i) => `<span class="chip ${i ? "" : "on"}" data-k="${k}">${k}</span>`).join("")}</div>
    <p class="warnbox"><b>No patient info.</b> Describe the problem without names, MRNs, or anything that identifies a patient. Use fake details if you need an example.</p>`,
    `<button class="btn" data-x>Cancel</button><button class="btn p" id="fGo">Save flag</button>`);
  let kind = "Bug"; $$("[data-k]", m).forEach(c => c.onclick = () => { kind = c.dataset.k; $$("[data-k]", m).forEach(x => x.classList.toggle("on", x === c)); });
  $("#fGo", m).onclick = async () => {
    const text = $("#fT", m).value.trim(); if (!text) return;
    if (/\b\d{5,}\b/.test(text) && !(await ask("Possible patient info", "That flag has a long number in it (like an MRN). Save anyway?", "Save anyway"))) return;
    const list = await getFlags(); list.push({ id: uid(), kind, text, where, date: S.date, status: "open" }); await setFlags(list);
    m.close(); toast("Flag saved to the team's flag list");
  };
}
async function flagHub() {
  const list = await getFlags();
  $("#main").innerHTML = `<div class="row" style="margin-bottom:10px"><h1>Flag list</h1><span class="sp"></span><button class="btn" id="fCopy">Copy open flags for Claude</button><button class="btn p" id="fNew">⚑ Raise a flag</button></div>
    <p class="muted" style="margin-bottom:10px">Saved in the team folder, separate from any other app. When you're ready, copy them into a chat with Claude to work through them.</p>
    <div class="card list">${list.length ? list.slice().reverse().map(f => `<div class="it" style="cursor:default"><span class="nm" style="font-family:var(--sans);font-size:14px">${f.status === "done" ? "<s>" : ""}${esc(f.text)}${f.status === "done" ? "</s>" : ""}<br><small class="muted">${esc(f.kind)} · ${esc(f.where)} · ${md(f.date)}</small></span>
      <button class="btn sm" data-tog="${f.id}">${f.status === "done" ? "Reopen" : "Done"}</button></div>`).join("") : `<div class="it"><span class="muted">No flags yet.</span></div>`}</div>`;
  $("#fNew").onclick = raiseFlag;
  $("#fCopy").onclick = async () => {
    const open = list.filter(f => f.status !== "done");
    const txt = `Resilience Notes flags (${open.length}):\n` + open.map((f, i) => `${i + 1}. [${f.kind}] ${f.text} (${f.where}, ${f.date})`).join("\n");
    try { await navigator.clipboard.writeText(txt); toast("Copied"); } catch { modal("Copy these", `<textarea style="width:100%" rows="10">${esc(txt)}</textarea>`); }
  };
  $$("[data-tog]").forEach(b => b.onclick = async () => { const f = list.find(x => x.id === b.dataset.tog); f.status = f.status === "done" ? "open" : "done"; await setFlags(list); flagHub(); });
}

// ---------------- start ----------------
async function boot() {
  window.__rnStarted = true;
  applyTheme();
  const r = supported() ? await Store.restore() : {};
  if (r.store) { S.store = r.store; try { await load(); return; } catch (e) { console.warn(e); S.store = null; } }
  if (r.needsClick) S.regrant = r.needsClick;
  route();
}
boot();
document.addEventListener("keydown", e => { if (e.key !== "Escape") return; const t = $(".tray"); if (t) { t.remove(); $("#gear")?.classList.remove("open"); return; } const m = $$(".scrim").at(-1); if (m) m.close(); });
window.RN = { S, E };   // for debugging in the console
