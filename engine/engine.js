// Note Prep engine: the "brain" of the app. No screens here, just the rules.
// Works in the browser and in Node. Patient data only ever lives in memory
// or in files the scribe controls; this file never sends anything anywhere.

// ---------- dates ----------
export const addDays = (iso, n) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const md = iso => { const [, m, d] = iso.split("-"); return `${+m}/${+d}`; };
const join = list => list.length < 2 ? (list[0] || "") :
  list.slice(0, -1).join(", ") + (list.length > 2 ? "," : "") + " and " + list[list.length - 1];
const end = s => /[.!?]$/.test(s.trim()) ? s.trim() : s.trim() + ".";

// ---------- medications ----------
export const medFull = m =>
  [m.name, m.dose, m.route, m.freq, m.prn ? "PRN" : ""].filter(Boolean).join(" ");
const doseText = m => [m.dose, m.route, m.freq].filter(Boolean).join(" ");

// Active on a date: started, not discontinued yet. A med ending today is still active today.
export const medActive = (m, date) =>
  m.start <= date && !(m.discontinued && m.discontinued <= date) && !(m.end && m.end < date);

const activeMeds = (p, date) => p.meds.filter(m => medActive(m, date));
const refused = (patient, p, date) => activeMeds(p, date).filter(m => (patient.refusing || []).includes(m.id));

// Was this med already named in an earlier HPI entry (or the opening line)?
const mentionedBefore = (p, m, date) =>
  (m.home && p.hpiOpen) ||
  p.hpi.some(e => e.date < date && e.date >= m.start && e.text.includes(m.name));

const vitalLabel = { bp: "BP", hr: "HR", bg: "BG" };

// ---------- default wording ----------
// What the HPI should say for this problem on this date if nothing new happened.
// Problems imported from old Word notes (no structured meds yet) copy yesterday's
// wording forward, like the team does by hand, swapping in today's vital numbers.
// "start X 50 mg BID" becomes "Cont. X" the next day and doses drop after the first mention,
// but dates on a course (antibiotics, tapers) always stay.
const lastEntry = (list, date) => list.filter(e => e.date < date).sort((a, b) => a.date < b.date ? -1 : 1).pop();
// Refused / UTO typed in the vitals box reads as words, not "BP today is Refused".
export const vitalWords = (label, v) => /^refused$/i.test(String(v)) ? "refused vitals today"
  : /^uto$/i.test(String(v)) ? `${label} unable to obtain today` : `${label} today is ${v}`;
const swapVitals = (patient, text, date) => text.replace(/\b(BP|HR|BG) today is (?:\[\s*(?:\.\.\.|…)?\s*\]|X\b|\d+(?:\/\d+)?(?:\.\d+)?)?/g, (m, k) => {
  const v = patient.vitals?.[date]?.[k.toLowerCase()];
  return v == null ? `${k} today is [...]` : vitalWords(k, v);
});
const DOSE = /\s+\d[\d.,]*\s*(?:mg|mcg|g|units?|ml|%|puffs?)(?:\s*\/\s*(?:hr|hour)|\s+hr)?\b(?:\s+(?:PO|IV|IM|SQ|SL|INH|topical|TD|pt\s*72\s*TD|gel|per inhalation))*(?:\s*,?\s*(?:QD|BID|TID|QID|Q\d+H|QHS|QAM|QPM|daily|nightly|PRN)\b)*/gi;
// "x7 days" / "x2 more days" -> "(last dose M/D)" counted from the day it was first written.
// If the course already has dates ("(10/27-10/30)", "last dose 11/3"), just drop the "x7 days".
const HAS_DATES = /\(\s*\d{1,2}\/\d{1,2}\s*-\s*\d{1,2}\/\d{1,2}\s*\)|last dose/i;
function courseDays(t, from) {
  if (HAS_DATES.test(t)) return t.replace(/\s*x\s*\d+\s*(?:more\s+)?days?\b/gi, "");
  return t.replace(/\s*x\s*(\d+)\s*(more\s+)?days?\b/gi, (m, n, more) =>
    from ? ` (last dose ${md(addDays(from, +n - (more ? 0 : 1)))})` : "");
}
// The day an "xN days" course was first written for this problem (so repeats don't push the end date).
function courseStart(p) {
  if (p.planOpen && /x\s*\d+\s*(?:more\s+)?days?\b/i.test(p.planOpen)) return p.start;
  const first = [...(p.plan || []), ...(p.hpi || [])].filter(e => /x\s*\d+\s*(?:more\s+)?days?\b/i.test(e.text)).sort((a, b) => a.date < b.date ? -1 : 1)[0];
  return first?.date || null;
}
const tidy = t => t.replace(/\(\s*\(/g, "(").replace(/\s{2,}/g, " ").replace(/\s+([,.)])/g, "$1").replace(/,\s*,/g, ",")
  .replace(/(?:,\s*)?\band\s+and\b/g, " and").replace(/\(\s*\)/g, "").trim();
export const medsInText = t => [...String(t || "").matchAll(/\b(?:with|taking|using|continue|start(?:ing)?|on)\s+([A-Z][A-Za-z-]+(?:\s+(?:HFA|XR|ER|SR|DR))?)/g)].map(m => m[1]);
export function forwardPlan(text, from, open) {
  let t = " " + text.trim();
  t = courseDays(t, from);
  t = t.replace(/,?\s*(?:and\s+)?will order [^,.;]*/gi, "");                  // orders happen once
  t = t.replace(/\b(?:will\s+)?treat(?:ed)?\s+with\s+/gi, "").replace(/\bwill continue to monitor\b|\bcontinue to monitor\b/gi, "CTM");
  t = t.replace(/\bPatient\s+(?=will\b)/gi, "");
  t = t.replace(/\b(?:will\s+)?(?:start(?:ing)?|add(?:ing)?|begin|increase|decrease)\s+(?:taking\s+|using\s+)?/gi, "");
  t = t.replace(/\bfrom\s+[\d.]+\s*\w+(?:\/\w+)?\s+to\s+[\d.]+\s*\w+(?:\/\w+)?/gi, "");
  t = t.replace(/\bnow\s+[\d.]+\s*\w+(?:\/\w+)?(?:\s+(?:QD|BID|TID|QID|Q\d+H|PRN))*/gi, "");
  t = t.replace(DOSE, "");
  t = t.replace(/\b(?:Cont\.|Continue|will continue)\s+/gi, "");
  t = tidy(t).replace(/^(?:and\s+|[,.\s]+)+|[,\s]+$/gi, "");
  if (!t || /^CTM\.?$/i.test(t) || /^[\d\s./()mcghour-]*$/i.test(t)) {
    if (/^\s*CTM\.?\s*$/i.test(text)) return "CTM.";
    const names = medsInText(open); return names.length ? end("Cont. " + names.join(" and ")) : "CTM.";
  }
  if (/^(Discontinue|CTM)/i.test(t)) return end(t);
  return end("Cont. " + t);
}
export function forwardHpi(text, from) {
  let t = text.trim();
  t = courseDays(t, from);
  t = t.replace(/^Started on\s+/i, "Patient taking ").replace(/\bnow\s+(taking\s+)?/gi, (m, g) => g || "");
  t = t.replace(/\b(?:will\s+)?start(?:ing|ed)?\s+(?:taking\s+|using\s+)?/gi, "");
  t = tidy(t.replace(DOSE, ""));
  return end(t);
}
// Latest course end written anywhere in a problem's plan: "(last dose 11/3)", "(10/27-10/30)", "x7 days".
export function courseEnd(p) {
  let best = null;
  const mx = (a, b) => (!a || (b && b > a)) ? b : a;
  const year = (p.start || "2026").slice(0, 4);
  const iso = (m, d, ref) => { let y = +(ref || year).slice(0, 4); if (ref && +m < +ref.slice(5, 7) - 6) y++; return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };
  const scan = (t, ref) => {
    if (!t) return;
    for (const m of t.matchAll(/last dose (?:on )?(\d{1,2})\/(\d{1,2})/gi)) best = mx(best, iso(m[1], m[2], ref));
    for (const m of t.matchAll(/\(\s*\d{1,2}\/\d{1,2}\s*-\s*(\d{1,2})\/(\d{1,2})\s*\)/g)) best = mx(best, iso(m[1], m[2], ref));
  };
  const cs = courseStart(p);
  if (cs) {
    const src = p.planOpen && p.start === cs && /x\s*\d+/i.test(p.planOpen) ? p.planOpen : [...(p.plan || []), ...(p.hpi || [])].find(e => e.date === cs && /x\s*\d+/i.test(e.text))?.text || "";
    if (!HAS_DATES.test(src)) for (const m of src.matchAll(/x\s*(\d+)\s*(more\s+)?days?\b/gi)) best = mx(best, addDays(cs, +m[1] - (m[2] ? 0 : 1)));
  }
  scan(p.planOpen, p.start);
  for (const e of p.plan || []) scan(e.text, e.date);
  return best;
}

export function defaultHpi(patient, p, date, rules) {
  if (p.copy && !p.meds.length) {
    const last = lastEntry(p.hpi, date);
    if (last) return end(swapVitals(patient, forwardHpi(last.text, courseStart(p) || last.date), date));
  }
  const meds = activeMeds(p, date);
  const refusing = refused(patient, p, date);
  const taking = meds.filter(m => !refusing.includes(m));
  const stoppedToday = p.meds.filter(m => m.discontinued === date);
  const v = p.autoVital ? (patient.vitals?.[date]?.[p.autoVital] ?? "[...]") : null;

  const name = m => {
    if (m.changedOn === date) return `${m.name} now ${doseText(m)}`;
    const base = mentionedBefore(p, m, date) ? m.name : medFull(m);
    return m.end ? `${base} (last dose ${md(m.end)})` : base;
  };
  const parts = [];
  if (taking.length) {
    const fresh = taking.filter(m => m.start === addDays(date, -1) && !m.home);
    const old = taking.filter(m => !fresh.includes(m));
    const bits = [];
    if (old.length) bits.push(`taking ${join(old.map(name))}`);
    if (fresh.length) bits.push(`now taking ${join(fresh.map(name))}`);
    parts.push(`Patient ${bits.join(" and ")}`);
  }
  if (stoppedToday.length) parts.push(`no longer taking ${join(stoppedToday.map(m => m.name))}`);
  if (refusing.length) parts.push(`${parts.length ? "" : "Patient "}refusing ${join(refusing.map(m => m.name))}`.trim());

  let status;
  const custom = rules?.dx?.[p.name]?.status;               // team rule: preferred wording for this diagnosis
  if (v !== null) status = vitalWords(vitalLabel[p.autoVital], v);
  else if (custom && taking.length) status = custom;
  else if (taking.length) status = `reports ${p.symptom || p.name.toLowerCase()} managed well with medications`;
  else status = `reports baseline ${p.symptom || p.name.toLowerCase()} symptoms today`;

  if (!parts.length) return end(`Patient ${status}`);
  return end(`${parts.join(" and ")}, ${status}`);
}

// What the plan should say for this problem on this date.
export function defaultPlan(patient, p, date) {
  if (p.copy && !p.meds.length) {
    const last = lastEntry(p.plan, date);
    const src = last ? last.text : p.planOpen;
    if (src) {
      let t = forwardPlan(src.replace(/\(last dose today\)/i, ""), courseStart(p) || last?.date || p.start, p.planOpen);
      const ce = courseEnd(p);                                  // antibiotics always carry their date
      if (ce && !HAS_DATES.test(t) && /^Cont\. [A-Za-z-]+(?: [A-Z]{2,4})?\.$/.test(t)) t = t.replace(/\.$/, ` (last dose ${md(ce)}).`);
      return t;
    }
  }
  const meds = activeMeds(p, date);
  const stopped = p.meds.filter(m => m.discontinued === date);
  if (!meds.length && !stopped.length) return "CTM.";
  const label = m => {
    let s = m.changedOn === date ? `${m.name} now ${doseText(m)}` : m.name;
    if (m.end) s += ` (last dose ${md(m.end)})`;
    return s;
  };
  const starts = meds.filter(m => m.start === date && !m.home);
  const cont = meds.filter(m => !starts.includes(m));
  const startTxt = starts.map(m => medFull(m) + (m.end ? ` (last dose ${md(m.end)})` : ""));
  if (stopped.length) {
    const rest = cont.length ? ` and continue ${join(cont.map(label))}` : "";
    const st = starts.length ? ` and start ${join(startTxt)}` : "";
    return end(`Discontinue ${join(stopped.map(m => m.name))}${rest}${st}`);
  }
  const bits = [];
  if (cont.length) bits.push(`Cont. ${join(cont.map(label))}`);
  if (starts.length) bits.push(`${cont.length ? "start" : "Start"} ${join(startTxt)}`);
  return end(bits.join(" and "));
}

export const planOpening = p => {
  const ms = p.meds.filter(m => m.start <= p.start);
  return ms.length ? `Will treat with ${join(ms.map(m => medFull(m) + (m.end ? ` (last dose ${md(m.end)})` : "")))}` : "Will continue to monitor";
};

// Team wording rules ("always write X instead of Y"), approved by the supervisor.
export function applyRules(text, p, field, rules) {
  const n = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const r of rules?.wording || []) {
    if (r.status !== "active" || !r.find) continue;
    if (r.field && r.field !== "both" && r.field !== field) continue;
    if (r.dx && n(r.dx) !== n(p.name)) continue;
    text = text.split(r.find).join(r.replace ?? "");
  }
  return text.replace(/\s{2,}/g, " ").trim();
}

// ---------- flags ----------
// Each flag: { level: "red" | "amber" | "blue" | "soft", text, problemId? }
export function flags(patient, date, rulebook = {}) {
  const out = [];
  if (patient.type === "admit") out.push({ level: "blue", text: "New admit: convert H&P tomorrow" });
  for (const p of patient.problems) {
    if (p.start > date || (p.resolved && p.resolved < date)) continue;
    for (const m of p.meds) {
      if (m.end && date >= m.end && !m.addressed && !m.discontinued) {
        out.push({ level: "red", problemId: p.id,
          text: date === m.end ? `${m.name} last dose today` : `${m.name} ended ${md(m.end)}: needs a decision` });
      }
    }
    if (p.copy && !p.meds.length) {
      const ce = courseEnd(p);
      if (ce && date >= ce && !p.courseAddressed && ce >= addDays(date, -14))
        out.push({ level: "red", problemId: p.id, text: date === ce ? `${p.name}: last dose today` : `${p.name}: course ended ${md(ce)}, needs a decision` });
      const lp = lastEntry(p.plan, addDays(date, 1));
      const seg = lp && lp.text.split(/[,;.]/).find(x => /\bpending\b/i.test(x));
      if (seg) out.push({ level: "amber", problemId: p.id, text: `${seg.replace(/\s*(?:still\s+)?pending.*$/i, "").replace(/^\s*(?:and|cont\.?)\s+/i, "").trim()} pending` });
    }
    if (p.alwaysFlag || rulebook[p.name]?.alwaysFlag) out.push({ level: "red", problemId: p.id, text: p.name });
    else if ((rulebook[p.name]?.seen ?? 0) < 3 && !rulebook[p.name]?.routine)
      out.push({ level: "amber", problemId: p.id, text: `Uncommon: ${p.name}` });
    if (!activeMeds(p, date).length && !p.copy) out.push({ level: "soft", problemId: p.id, text: `${p.name}: no medication` });
    if (p.peLine) out.push({ level: "soft", problemId: p.id, text: `Exam changed by ${p.name}` });
  }
  const refusingNames = patient.problems.flatMap(p => refused(patient, p, date)).map(m => m.name);
  if (refusingNames.length) out.push({ level: "amber", text: `Refusing ${join(refusingNames)}` });
  for (const l of patient.pendingLabs || []) out.push({ level: "amber", text: `${l} pending` });
  return out;
}

// ---------- prep for tomorrow ----------
// Adds tomorrow's HPI and plan entry to every active problem.
// Quiet when nothing changed today; returns a review list for anything that did.
export function prep(patient, today, rules) {
  const tomorrow = addDays(today, 1);
  const review = [];
  for (const p of patient.problems) {
    if (p.resolved && p.resolved <= today) continue;   // resolves -> moves to Resolved, no new entries
    if (p.start > tomorrow) continue;
    const reasons = [];
    const tHpi = p.hpi.find(e => e.date === today);
    const tPlan = p.plan.find(e => e.date === today);
    if (p.start === today && !p.copy) reasons.push("new problem today");
    if (tHpi && tHpi.text !== tHpi.auto) reasons.push("HPI edited today");
    if (tPlan && tPlan.text !== tPlan.auto) reasons.push("plan edited today");
    if (p.copy && !p.meds.length) {
      const key = e => e && forwardHpi(e.text).replace(/\b(BP|HR|BG) today is (?:\[[^\]]*\]|X\b|\d+(?:\/\d+)?(?:\.\d+)?)?/g, "");
      const h = p.hpi.filter(e => e.date <= today).sort((x, y) => x.date < y.date ? -1 : 1);
      if (h.length >= 2 && h.at(-1).date === today && key(h.at(-1)) !== key(h.at(-2))) reasons.push("wording changed today");
      const pl = p.plan.filter(e => e.date <= today).sort((x, y) => x.date < y.date ? -1 : 1);
      if (pl.length >= 2 && pl.at(-1).date === today && forwardPlan(pl.at(-1).text) !== forwardPlan(pl.at(-2).text)) reasons.push("plan changed today");
      const ce = courseEnd(p); if (ce === tomorrow || ce === today) reasons.push(`course ends ${md(ce)}`);
    }
    for (const m of p.meds) {
      if (m.start === today && !m.home) reasons.push(`new med: ${m.name}`);
      if (m.changedOn === today) reasons.push(`dose change: ${m.name}`);
      if (m.discontinued === today) reasons.push(`stopped: ${m.name}`);
      if (m.end === today) reasons.push(`${m.name} ends today`);
    }
    const skipHpi = p.planOnly, skipPlan = p.hpiOnly;
    const hpi = applyRules(defaultHpi(patient, p, tomorrow, rules), p, "hpi", rules);
    const plan = applyRules(defaultPlan(patient, p, tomorrow), p, "plan", rules);
    if (!skipHpi && !p.hpi.some(e => e.date === tomorrow)) p.hpi.push({ date: tomorrow, text: hpi, auto: hpi });
    if (!skipPlan && !p.plan.some(e => e.date === tomorrow)) p.plan.push({ date: tomorrow, text: plan, auto: plan });
    if (reasons.length) { p.needsReview = true; review.push({ problemId: p.id, name: p.name, reasons, hpi, plan }); }
  }
  return { tomorrow, review };
}

// Put today's vital numbers into lines like "BP today is [...]".
export function fillVitals(patient, date) {
  for (const p of patient.problems) {
    if (!p.autoVital) continue;
    const v = patient.vitals?.[date]?.[p.autoVital];
    const e = p.hpi.find(x => x.date === date);
    if (v && e && e.text.includes("[...]")) {
      const wasAuto = e.text === e.auto;
      const lab = vitalLabel[p.autoVital];
      e.text = e.text.includes(`${lab} today is [...]`) ? e.text.replace(`${lab} today is [...]`, vitalWords(lab, v)) : e.text.replace("[...]", v);
      if (wasAuto) e.auto = e.text;
    }
  }
}

// ---------- render the note text (also used for reprinting any past day) ----------
const para = (p, open, entries, asOf, firstDated) => {
  const list = entries.filter(e => e.date <= asOf).sort((a, b) => a.date < b.date ? -1 : 1);
  const bits = list.map(e => `${md(e.date)}: ${end(e.text)}`);
  const head = open ? end(open) + " " : "";
  return `${p.name}: ${head}${bits.join(" ")}`.trim();
};

export function render(patient, asOf) {
  const visible = patient.problems.filter(p => p.start <= asOf);
  const active = visible.filter(p => !(p.resolved && p.resolved < asOf));
  const done = visible.filter(p => p.resolved && p.resolved < asOf);
  const psych = patient.psych || {};
  const tapers = { ciwa: "CIWA protocol and Valium taper in place, CTM",
    cows: "COWS protocol and Subutex taper in place, CTM",
    both: "CIWA and COWS protocols have both been implemented. Will monitor" };
  const psychLine = psych.dx
    ? `${psych.dx}: Q15 min safety checks in place, monitor for extrapyramidal symptoms and signs of serotonin syndrome` +
      (tapers[psych.taper] ? `\n${tapers[psych.taper]}` : "")
    : null;
  return {
    blurb: patient.blurb || "",
    hpi: active.filter(p => !p.planOnly).map(p => para(p, p.hpiOpen, p.hpi, asOf)),
    resolvedHpi: done.filter(p => !p.planOnly).map(p => para(p, p.hpiOpen, p.hpi, asOf) + " RESOLVED."),
    vitals: patient.vitals?.[asOf] || {},
    labs: (patient.labs || []).filter(l => l.date <= asOf),
    standing: ["Diet is regular.", "Activity is as tolerated."],
    plan: [psychLine, ...active.filter(p => !p.hpiOnly).map(p => para(p, p.planOpen, p.plan, asOf))].filter(Boolean),
    resolvedPlan: done.filter(p => !p.hpiOnly).map(p => para(p, p.planOpen, p.plan, asOf) + " RESOLVED."),
    pcp: patient.problems.filter(p => p.pcp && p.start <= asOf).map(p => p.name),
    pe: active.filter(p => p.peLine).map(p => p.peLine),
    dateOfService: md(asOf) + "/" + asOf.slice(0, 4),
    time: patient.times?.[asOf] || null,
  };
}

// ---------- date-of-service times: random 0930-1500, different for every note ----------
export function assignTimes(patients, date, seed = date) {
  let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rand = () => (h = (h * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const used = new Set();
  for (const pt of patients) {
    let t;
    do { const mins = 570 + Math.floor(rand() * 331); t = String(Math.floor(mins / 60)).padStart(2, "0") + String(mins % 60).padStart(2, "0"); }
    while (used.has(t));
    used.add(t);
    (pt.times ||= {})[date] = t;
  }
}

// ---------- day 2: turn an H&P into a progress note ----------
export function convertAdmit(admit) {
  const pt = structuredClone(admit);
  pt.type = "progress";
  pt.status = "active";
  pt.converted = pt.admitDate;
  pt.file = (pt.file || pt.name).replace(/\s*ADMIT\s*$/, "");
  return pt;
}

// ---------- the rulebook "learns" which diagnoses are common ----------
export function learn(rulebook, patients) {
  for (const pt of patients) for (const p of pt.problems) {
    const r = (rulebook[p.name] ||= { seen: 0 });
    r.seen++;
  }
  return rulebook;
}
