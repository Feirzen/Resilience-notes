// Reads an existing progress note (.docx made by hand in Word) and turns it into a
// patient record the app can keep prepping. Best effort: imported problems copy
// yesterday's wording forward until a scribe adds their meds in the app.
import { PE_LINES, UNITS } from "./layout.js";

const decode = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
export function paragraphs(xml) {
  const out = [];
  for (const m of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)) {
    let t = "";
    for (const r of m[0].matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)) t += r[1] !== undefined ? decode(r[1]) : r[0].startsWith("<w:tab") ? "\t" : " ";
    out.push(t.replace(/ /g, " ").trim());
  }
  return out;
}

// "10/30: ..." and also "10/30 Cont. ..." (colon forgotten), but not dates inside "(10/27-10/30)"
const DATE_RE = /(?:^|\s|\.|,)(\d{1,2})\/(\d{1,2})(?::\s*|\s+(?=[A-Z]))/g;
function toIso(m, d, ref) {
  let y = +ref.slice(0, 4);
  if (+m > +ref.slice(5, 7) + 1) y--;              // a December entry seen in January
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function splitEntries(text, ref) {
  const hits = [...text.matchAll(DATE_RE)];
  if (!hits.length) return { open: text.trim(), entries: [] };
  const open = text.slice(0, hits[0].index).trim();
  const entries = hits.map((h, i) => {
    const s = h.index + h[0].length, e = i + 1 < hits.length ? hits[i + 1].index : text.length;
    return { date: toIso(h[1], h[2], ref), text: text.slice(s, e).trim().replace(/\s+/g, " ") };
  });
  return { open, entries };
}
const PROB_RE = /^(?![-–•·\u2022]|\d{1,2}\/\d{1,2})([A-Z0-9+][^:]{1,90}?):\s*([\s\S]*)$/;
const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = s => norm(s).split(" ").map(w => w.replace(/s$/, "").replace(/e$/, "")).filter(w => w.length > 1 && !["on", "of", "the", "and", "with"].includes(w));
// "Migraine" vs "Migraines", "Dog bite on bilateral calfs" vs "Dog Bite on Right Calf": same problem
function similar(a, b) {
  const A = words(a), B = words(b); if (!A.length || !B.length) return 0;
  const hit = A.filter(w => B.includes(w)).length;
  return hit / Math.max(A.length, B.length) + (A[0] === B[0] ? 0.25 : 0);
}
const slug = s => norm(s).replace(/ /g, "-");

export async function readDocx(JSZip, data, fileName = "") {
  const zip = await JSZip.loadAsync(data);
  const body = paragraphs(await zip.file("word/document.xml").async("string"));
  const hf = [];
  for (const f of Object.keys(zip.files).filter(f => /word\/(header|footer)\d*\.xml$/.test(f)))
    hf.push(...paragraphs(await zip.file(f).async("string")));
  return parseNote(body, hf, fileName);
}

export function parseNote(body, hf, fileName = "") {
  const all = [...hf, ...body];
  const field = re => { for (const t of all) { const m = t.match(re); if (m) return m[1].trim(); } return ""; };
  const name = field(/Patient Name:\s*([^\t]+)/i) || fileName.replace(/\.docx$/i, "").replace(/\s*ADMIT$/i, "");
  const dosM = all.join(" ").match(/Date of service:\s*(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*Time:\s*(\d{3,4})/i);
  const dos = dosM ? `${dosM[3]}-${dosM[1].padStart(2, "0")}-${dosM[2].padStart(2, "0")}` : new Date().toISOString().slice(0, 10);
  const unitRaw = field(/Unit:\s*([A-Za-z]+)/);
  const unit = UNITS.find(u => u.toLowerCase() === unitRaw.toLowerCase()) || unitRaw;
  const adm = field(/Admit Date:\s*([\d/]+)/i);
  const admitDate = adm && adm.split("/").length === 3
    ? `${adm.split("/")[2].padStart(4, "20")}-${adm.split("/")[0].padStart(2, "0")}-${adm.split("/")[1].padStart(2, "0")}` : "";

  // cut the body into sections
  const marks = [["hpi", /^CHIEF COMPLAINT/i], ["rhpi", /^RESOLVED HPI/i], ["ros", /^REVIEW OF SYSTEMS/i], ["pe", /^PHYSICAL EXAM/i],
    ["labs", /^LABORATORY DATA/i], ["plan", /^ASSESSMENT/i], ["rplan", /^RESOLVED PLAN/i], ["sign", /^Signed:/i], ["pcp", /^FOLLOW UP WITH PRIMARY/i]];
  const sec = {}; let cur = "top";
  for (const t of body) {
    const hit = marks.find(([, re]) => re.test(t));
    if (hit) { cur = hit[0]; sec[cur] ||= []; continue; }
    (sec[cur] ||= []).push(t);
  }
  const HF = /^(Patient Name|Date of Birth|MRN|Medical Record|Admit(?:ted)? Date|Admission Date|Unit|Page\s*\d|Date of service|Signed|Scribe|BC|EKG|History and Physical)\b|^\{?\s*Last name/i;
  const clean = list => (list || []).filter(t => t && !HF.test(t));

  const problems = []; const byName = {};
  let blurb = "";
  const addHpi = (t, resolved) => {
    const m = t.match(PROB_RE);
    const isNoConcerns = /^[-–•·\u2022\uf0b7*\s]*\d{1,2}\/\d{1,2}\b/.test(t) || /\bno (?:\w+ )?(?:medical|physical)?\s*(?:or (?:medical|physical) )?concerns\b/i.test(t);
    if (isNoConcerns) return;
    if (!m || /^patient\b/i.test(m[1])) { if (!resolved && !problems.length) blurb += (blurb ? " " : "") + t; return; }
    const { open, entries } = splitEntries(m[2].replace(/\s*RESOLVED\.?\s*$/i, ""), dos);
    const p = { id: slug(m[1]) + "-" + problems.length, name: m[1].trim(), copy: true, meds: [], hpiOpen: open || null, planOpen: null,
      hpi: entries.map(e => ({ ...e, auto: e.text })), plan: [], start: entries[0]?.date || admitDate || dos };
    if (resolved) p.resolved = entries.at(-1)?.date || dos;
    problems.push(p); byName[norm(p.name)] = p;
  };
  clean(sec.hpi).forEach(t => addHpi(t, false));
  clean(sec.rhpi).forEach(t => addHpi(t, true));

  const psych = { dx: "", taper: "none" };
  const addPlan = (t, resolved) => {
    if (/^(Diet is regular|Activity is as tolerated)/i.test(t)) return;
    if (/Q15|safety checks/i.test(t)) {
      psych.dx = t.split(/[:.]/)[0].trim();
      psych.taper = /CIWA/i.test(t) && /COWS/i.test(t) ? "both" : /CIWA/i.test(t) ? "ciwa" : /COWS/i.test(t) ? "cows" : "none";
      return;
    }
    if (/^(CIWA|COWS)/i.test(t)) { psych.taper = /CIWA/i.test(t) && /COWS/i.test(t) ? "both" : /CIWA/i.test(t) ? "ciwa" : "cows"; return; }
    const m = t.match(PROB_RE); if (!m || /^\d{1,2}\/\d{1,2}/.test(m[1].trim())) return;
    const { open, entries } = splitEntries(m[2].replace(/\s*RESOLVED\.?\s*$/i, ""), dos);
    let p = byName[norm(m[1])];
    if (!p) {
      const best = problems.filter(q => !q.plan.length && !q.planOnly).map(q => [q, similar(q.name, m[1])]).sort((x, y) => y[1] - x[1])[0];
      if (best && best[1] >= 0.75) p = best[0];
    }
    if (!p) {
      p = { id: slug(m[1]) + "-" + problems.length, name: m[1].trim(), copy: true, planOnly: true, meds: [], hpiOpen: null, hpi: [], start: entries[0]?.date || admitDate || dos };
      if (resolved) p.resolved = entries.at(-1)?.date || dos;
      problems.push(p); byName[norm(p.name)] = p;
    }
    p.planOpen = open || null; p.plan = entries.map(e => ({ ...e, auto: e.text }));
  };
  clean(sec.plan).forEach(t => addPlan(t, false));
  clean(sec.rplan).forEach(t => addPlan(t, true));

  for (const p of problems) if (!p.planOnly && !p.plan.length && !p.planOpen) p.hpiOnly = true;

  // vitals: the six values after the "BG:" header cell
  const pe = sec.pe || []; const vitals = {};
  const bgI = pe.findIndex(t => /^BG:?$/i.test(t));
  if (bgI >= 0) {
    const vals = pe.slice(bgI + 1, bgI + 8).filter((t, i) => i > 0 || t !== "");
    const [bp, hr, rr, temp, o2, bg] = vals;
    vitals[dos] = { bp, hr, rr, temp, o2, bg: bg && bg !== "N/A" ? bg : undefined };
  }
  const peExtra = {};
  for (const [k, def] of PE_LINES) {
    const line = pe.find(t => t.toUpperCase().startsWith(k + ":"));
    if (line) { const v = line.slice(k.length + 1).trim(); if (norm(v) !== norm(def)) peExtra[k] = v; }
  }

  const labs = []; let lab = null;
  for (const t of clean(sec.labs)) {
    if (/^-\s*/.test(t) && lab) lab.bullets.push(t.replace(/^-\s*/, ""));
    else if (!/^All Labs Pending/i.test(t)) { lab = { date: dos, text: t, bullets: [] }; labs.push(lab); }
  }
  const pcp = clean(sec.pcp).map(t => t.replace(/^-\s*/, "")).filter(t => !/^N\/A$/i.test(t));
  for (const n of pcp) { const p = byName[norm(n)]; if (p) p.pcp = true; }

  return {
    id: slug(name) + "-" + (field(/MRN:\s*(\S+)/i) || "x"),
    name, file: name, unit, status: /ADMIT\s*(\.docx)?$/i.test(fileName) ? "admit" : "active",
    dob: field(/Date of Birth:\s*([^\t]+)/i), mrn: field(/MRN:\s*(\S+)/i), admitDate,
    blurb, psych, problems, labs, pendingLabs: [], vitals, times: dosM ? { [dos]: dosM[4].padStart(4, "0") } : {},
    refusing: [], peExtra, imported: dos, pcpExtra: pcp.filter(n => !byName[norm(n)]),
  };
}
