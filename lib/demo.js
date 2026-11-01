// Fake patients for Demo mode and tests. Every name and detail here is made up.
import { addDays, prep, assignTimes } from "../engine/engine.js";

const FIRST = ["Jane", "Sam", "Lee", "Ana", "Max", "Ty", "Kai", "Ivy", "Rex", "Mia", "Zoe", "Eli", "Ada", "Gus", "Liv", "Ned", "Ora", "Paz", "Quin", "Rhea"];
const LAST = ["Doe", "Roe", "Park", "Gray", "Cole", "Vance", "West", "Hale", "Moss", "Reed", "Lane", "Pike", "Ford", "Snow", "Bell", "Dunn", "Ames", "Cruz", "Hart", "Kemp"];
const PSY = ["Major depressive disorder, recurrent severe without psychotic features", "Alcohol dependence, uncomplicated", "Opioid dependence, uncomplicated", "Bipolar I disorder, current episode depressed"];

const homeMed = (id, name, dose, route, freq, prn) => ({ id, name, dose, route, freq, prn, home: true });
const LIB = {
  htn: d => ({ name: "Hypertension", symptom: "blood pressure", autoVital: "bp", med: homeMed("lis", "Lisinopril", "40mg", "", "QD"), open: "Patient reports taking Lisinopril 40mg QD at home to manage blood pressure" }),
  gerd: d => ({ name: "Gastroesophageal reflux disease", symptom: "acid reflux", med: homeMed("ome", "Omeprazole", "40mg", "", "BID", true), open: "Patient reports taking Omeprazole 40mg BID PRN at home to manage acid reflux" }),
  allergy: d => ({ name: "Seasonal allergies", symptom: "allergy", med: { id: "clar", name: "Claritin", dose: "10mg", route: "PO", freq: "QD" }, open: "Patient reports having seasonal allergies and would like medication for it" }),
  mig: d => ({ name: "Migraines", symptom: "headache", med: homeMed("imi", "Imitrex", "25mg", "PO", "QD", true), open: "Patient reports taking Imitrex 25mg PO QD PRN at home for migraines" }),
  const: d => ({ name: "Constipation", symptom: "constipation", open: "Patient reports not having a bowel movement in 4 days" }),
  bite: d => ({ name: "Dog bite on right calf", symptom: "wound", alwaysFlag: true, newMed: { id: "aug", name: "Augmentin", dose: "875 mg", route: "PO", freq: "BID", end: d }, first: "Patient presents with dog bite on right calf, wound open, mild serous drainage", peLine: { key: "SKIN", text: "wound on R calf healing, no erythema." } }),
  uti: d => ({ name: "Urinary tract infection", symptom: "dysuria", alwaysFlag: true, newMed: { id: "macro", name: "Macrobid", dose: "100mg", route: "PO", freq: "BID", end: addDays(d, 3) }, first: "Patient reports burning with urination for 3 days" }),
  dm: d => ({ name: "Type 2 diabetes", symptom: "blood sugar", autoVital: "bg", med: homeMed("met", "Metformin", "500mg", "PO", "BID"), open: "Patient reports taking Metformin 500mg PO BID at home for diabetes" }),
  pain: d => ({ name: "Generalized pain", symptom: "pain", med: homeMed("gaba", "Gabapentin", "300mg", "PO", "TID"), open: "Patient reports taking Gabapentin 300mg PO TID to manage pain at home" }),
};
const SETS = [["htn", "gerd", "bite", "const"], ["allergy"], ["mig", "gerd"], ["htn", "dm"], ["pain", "uti", "const"], ["gerd"], ["htn", "allergy", "pain"], []];

export function demoPatients(today) {
  const units = ["TIMP", "Arches", "Nebo", "Zion", "Canyons", "Bryce"];
  const counts = [5, 4, 6, 5, 3, 3];
  const out = []; let k = 0;
  units.forEach((unit, ui) => {
    for (let i = 0; i < counts[ui]; i++, k++) {
      const stay = 2 + (k * 3) % 9, admit = addDays(today, -stay);
      const pt = {
        id: `demo-${k}`, name: `${LAST[k % 20]}, ${FIRST[(k * 7) % 20]}`, file: `${LAST[k % 20]}, ${FIRST[(k * 7) % 20]}`, unit, status: "active",
        dob: `0${1 + (k % 9)}/1${k % 10}/19${80 + (k % 19)}`, mrn: String(40000 + k * 37), admitDate: admit, admitTime: "2215",
        age: 22 + (k * 5) % 40, sex: k % 2 ? "male" : "female", adolescent: false,
        blurb: `Patient is a ${22 + (k * 5) % 40} year-old ${k % 2 ? "male" : "female"} who admitted to Aspen Grove Behavioral Hospital for inpatient treatment due to ${PSY[k % 4]}.`,
        psych: { dx: PSY[k % 4], taper: ["none", "ciwa", "cows", "none"][k % 4] },
        problems: [], labs: [], pendingLabs: k % 5 === 1 ? ["CMP and TSH"] : [], vitals: {}, times: {}, refusing: [],
      };
      for (const key of SETS[k % SETS.length]) {
        const L = LIB[key](addDays(today, k % 3 === 0 ? 0 : 2));
        const start = L.newMed ? addDays(admit, 1) : admit;
        const p = { id: key, name: L.name, symptom: L.symptom, autoVital: L.autoVital, alwaysFlag: L.alwaysFlag, start,
          hpiOpen: L.open || null, planOpen: null, meds: [], hpi: [], plan: [], peLine: L.peLine };
        const m = L.med || L.newMed;
        if (m) { p.meds.push({ ...m, start }); p.planOpen = `Will treat with ${[m.name, m.dose, m.route, m.freq, m.prn ? "PRN" : ""].filter(Boolean).join(" ")}${m.end ? ` (last dose ${+m.end.slice(5, 7)}/${+m.end.slice(8)})` : ""}`; }
        if (L.first) p.hpi.push({ date: start, text: L.first, auto: "" });
        pt.problems.push(p);
      }
      if (k % 7 === 2) pt.refusing = ["ome"];
      for (let d = admit; d <= today; d = addDays(d, 1))
        pt.vitals[d] = { bp: `${110 + (k * 7 + d.charCodeAt(9)) % 40}/${68 + (k * 3) % 20}`, hr: String(60 + (k * 11) % 40), rr: "16", temp: "98.2", o2: String(95 + k % 4), bg: pt.problems.some(p => p.autoVital === "bg") ? String(100 + k * 9 % 60) : undefined };
      for (let d = admit; d < today; d = addDays(d, 1)) { prep(pt, d); pt.problems.forEach(p => p.needsReview = false); }
      out.push(pt);
    }
  });
  // one new admit waiting at the root
  out.push({ id: "demo-admit", name: "Snow, Ivy", file: "Snow, Ivy", unit: "Nebo", status: "admit", dob: "04/12/2009", mrn: "48812", admitDate: today, admitTime: "0140",
    age: 17, sex: "female", adolescent: true, blurb: "", psych: { dx: PSY[0], taper: "safety" },
    hp: { cc: "Suicidal ideation", allergies: "NKA", meds: ["Zoloft 50mg PO QD"], scribe: "" },
    problems: [{ id: "acne", name: "Acne", symptom: "acne", start: today, hpiOpen: "Patient reports acne on face and back", planOpen: "Will treat with Benzoyl peroxide 5% gel topical QD", meds: [{ id: "bp5", name: "Benzoyl peroxide", dose: "5% gel", route: "topical", freq: "QD", start: today }], hpi: [], plan: [] }],
    labs: [], pendingLabs: [], vitals: { [today]: { bp: "112/70", hr: "84", rr: "16", temp: "98.4", o2: "99", wt: "128", ht: "64" } }, times: {}, refusing: [] });
  assignTimes(out, today);
  return out;
}
