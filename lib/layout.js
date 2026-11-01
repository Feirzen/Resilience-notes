// Turns a patient record into an ordered list of "blocks" that look like the
// hospital's Word templates. Both the Word writer and the PDF (print) writer
// read these same blocks, so the saved file and the printout always match.
import { render, md } from "../engine/engine.js";

export const PROVIDERS = ["A. Tomco MD", "J. McGovern DNP", "K. Packer, NP", "T. Seamons, PA-C", "J. Hoyt MD"];
export const UNITS = ["TIMP", "Arches", "Nebo", "Zion", "Canyons", "Bryce"];

export const PE_LINES = [
  ["GENERAL", "no acute distress."],
  ["HEENT", "head is normocephalic and atraumatic."],
  ["CARDIO", "N/A"],
  ["RESP", "work of breathing is normal."],
  ["SKIN", "skin is without rash or lesions."],
  ["NEURO", "alert and oriented."],
  ["ABD/GI", "N/A"],
  ["MUSKULOSKELETAL", "patient is ambulatory, gait is normal for patient."],
  ["OTHER", "N/A"],
];

const fullDate = iso => iso ? `${md(iso)}/${iso.slice(0, 4)}` : "";
const labBlocks = labs => labs.length
  ? labs.flatMap(l => [{ t: "p", text: l.text }, ...(l.bullets || []).map(b => ({ t: "bullet", text: b }))])
  : [{ t: "p", text: "All Labs Pending" }];

// ---------------- progress note ----------------
export function progressBlocks(pt, date, opts = {}) {
  const n = render(pt, date);
  const peOver = { ...(pt.peExtra || {}), ...Object.fromEntries(pt.problems
    .filter(p => p.peLine && p.start <= date && !(p.resolved && p.resolved < date))
    .map(p => [p.peLine.key, p.peLine.text])) };
  const hpi = n.hpi.length ? n.hpi.map(text => ({ t: "p", text }))
    : [{ t: "bullet", text: `${md(date)}: Patient reports no medical or physical concerns today.` }];
  return {
    kind: "progress",
    header: { lines: [`Patient Name: ${pt.name}`, `Date of Birth: ${pt.dob || ""}`, `MRN: ${pt.mrn || ""}`, `Admit Date: ${fullDate(pt.admitDate)}`], unit: pt.unit },
    footer: `Date of service: ${n.dateOfService}, Time: ${n.time || "1030"} hours`,
    blocks: [
      { t: "title", text: "MEDICAL PROGRESS NOTE:" },
      { t: "box", label: "CHIEF COMPLAINT/HISTORY OF PRESENT ILLNESS:" },
      ...(n.blurb ? [{ t: "p", text: n.blurb }] : []),
      ...hpi,
      { t: "boxed", label: "RESOLVED HPI:", paras: n.resolvedHpi },
      { t: "box", label: "REVIEW OF SYSTEMS:", text: "Systems were reviewed and normal, except as noted in the HPI." },
      { t: "box", label: "PHYSICAL EXAMINATION:" },
      { t: "vitals", v: n.vitals },
      ...PE_LINES.map(([k, v]) => ({ t: "line", text: `${k}: ${peOver[k] || v}` })),
      { t: "box", label: "LABORATORY DATA:" },
      ...labBlocks(n.labs),
      { t: "box", label: "ASSESSMENT/PLAN:" },
      { t: "line", text: n.standing[0] }, { t: "line", text: n.standing[1] },
      ...n.plan.flatMap(text => text.split("\n").map((s, i) => ({ t: i ? "line" : "p", text: s }))),
      { t: "boxed", label: "RESOLVED PLAN:", paras: n.resolvedPlan },
      { t: "sign", left: "Signed:", right: "Scribe:" },
      { t: "providers", names: PROVIDERS, chosen: opts.provider || null },
      { t: "codes", label: "BC:", items: ["99231", "99232", "99233"] },
      { t: "codes", label: "EKG:", items: ["93010"] },
      { t: "box", label: "FOLLOW UP WITH PRIMARY CARE PROVIDER FOR THE FOLLOWING:" },
      ...([...n.pcp, ...(pt.pcpExtra || [])].length ? [...n.pcp, ...(pt.pcpExtra || [])] : ["N/A"]).map(text => ({ t: "bullet", text })),
    ],
  };
}

// ---------------- H&P ----------------
export const TAPERS = {
  safety: "Safety checks will be performed every 15 minutes throughout the patient's stay. Will monitor for extrapyramidal symptoms, and signs of serotonin syndrome.",
  ciwa: "CIWA protocol has been implemented, and a Valium taper was started. Will monitor symptoms daily and treat as needed.",
  cows: "COWS protocol has been implemented, and a Subutex taper was started. Will monitor symptoms daily and treat as needed.",
  both: "CIWA and COWS protocols have both been implemented. Will monitor symptoms daily and treat as needed.",
};
const ROS = [
  ["CONSTITUTIONAL:", "Denies fever, chills, weight loss, or change in appetite."],
  ["EYES:", "Denies vision changes or eye pain."],
  ["EARS/NOSE/THROAT:", "Denies ear pain, sore throat, sinus pain or drainage."],
  ["CARDIOVASCULAR:", "Denies chest pain or palpitations."],
  ["RESPIRATORY:", "Denies cough, wheeze, and shortness of breath."],
  ["GASTROINTESTINAL:", "Denies abdominal pain, diarrhea, constipation, hematochezia, nausea or vomiting."],
  ["GENITOURINARY:", "Denies dysuria, hematuria, and polyuria."],
  ["MUSCULOSKELETAL:", "Denies pain, stiffness, and arthritis."],
  ["NEUROLOGICAL:", "Denies change in sensory, seizures, syncope, and dizziness."],
  ["INTEGUMENTARY:", "Denies wounds, lesions, rash, or eczema."],
];
const CN = [
  ["CN II:", "Visual fields are full to confrontation. Pupils are symmetrical and reactive to light and accommodation."],
  ["CN III, IV, VI:", "At primary gaze, there is no eye deviation. Extraocular muscles intact."],
  ["CN V:", "Facial sensation is intact to light touch in all 3 divisions bilaterally."],
  ["CN VII:", "Face is symmetric with normal eye closure and smile."],
  ["CN VIII:", "Hearing is normal to rubbing fingers."],
  ["CN IX, X:", "Palate elevates symmetrically. Phonation is normal."],
  ["CN XI:", "Head turning and shoulder shrug are intact."],
  ["CN XII:", "Tongue is midline with normal movements and no atrophy."],
];

export function hpBlocks(pt, opts = {}) {
  const h = pt.hp || {};
  const date = pt.admitDate;
  const v = pt.vitals?.[date] || {};
  const n = render(pt, date);
  const dx = pt.psych?.dx || "";
  const problems = pt.problems.filter(p => p.start <= date);
  const pe = (k, def) => problems.find(p => p.peLine?.key === k)?.peLine.text || def;
  const gu = pt.adolescent
    ? "Exam deferred due to patient being a minor. Follow up with PCP about GU/rectal exam."
    : "Exam deferred due to patient preferring exam by PCP. Follow up with PCP about GU/rectal exam.";
  const meds = (h.meds && h.meds.length) ? h.meds : ["No home medications"];
  const ap = [
    "Diet is regular.", "Activity is as tolerated.",
    ...n.plan.slice(dx ? 1 : 0),
    `${dx}. Patient has been evaluated and labs were reviewed and included in the medical decision making. Patient will additionally be evaluated and treated by the inpatient psychiatric team.`,
  ];
  return {
    kind: "hp",
    header: { lines: [pt.name, `Medical Record #: ${pt.mrn || ""}`, "History and Physical Examination", `Date of Service: ${fullDate(date)}`], unit: pt.unit, firstPageDifferent: true },
    footer: null,
    blocks: [
      { t: "center", text: `Unit: ${pt.unit}` },
      { t: "center", text: "ASPEN GROVE BEHAVIORAL HOSPITAL", bold: true, italic: true, size: 14 },
      { t: "center", text: "1350 East 750 North", bold: true, italic: true },
      { t: "center", text: "Orem, UT  84097", bold: true, italic: true },
      { t: "center", text: "HISTORY AND PHYSICAL EXAMINATION", bold: true, gap: true },
      { t: "kv", bold: true, rows: [
        ["Client Name:", pt.name], ["Date of Birth:", pt.dob || ""], ["Medical Record Number:", pt.mrn || ""],
        ["Admission Date:", `${fullDate(date)} @ ${pt.admitTime || ""} hours`],
        ["Date of Service:", `${fullDate(date)} @ ${pt.times?.[date] || ""} hours`]] },
      { t: "head", text: "CHIEF COMPLAINT:" },
      { t: "num", items: [h.cc || "", "Complete physical examination prior to psychiatric treatment", dx] },
      { t: "head", text: "HISTORY OF PRESENT ILLNESS:" },
      { t: "p", text: `Patient is a ${pt.age || ""} year-old ${pt.sex || ""} who admitted to Aspen Grove Behavioral Hospital for inpatient treatment due to ${dx}.`, tight: true },
      ...(n.hpi.length ? n.hpi.map(text => ({ t: "p", text })) : [{ t: "p", text: "Physical Exam Normal" }]),
      { t: "head", text: "ALLERGIES:" }, { t: "line", text: h.allergies || "NKA" },
      { t: "head", text: "MEDICATIONS:" }, { t: "num", items: meds },
      { t: "head", text: "PAST MEDICAL HISTORY:" }, { t: "line", text: "See HPI." },
      { t: "head", text: "PAST SURGICAL HISTORY:" }, { t: "line", text: h.surgical || "No surgical history." },
      { t: "head", text: "SOCIAL HISTORY:" },
      { t: "kv", indent: true, rows: [["Alcohol:", h.alcohol || "Patient denies use."], ["Nicotine:", h.nicotine || "Patient denies use."], ["Illicit Drugs:", h.drugs || "Patient denies use."]] },
      { t: "head", text: "FAMILY HISTORY:" }, { t: "line", text: h.family || "Patient denies having any pertinent family medical history." },
      { t: "head", text: "REVIEW OF SYSTEMS:" }, { t: "kv", rows: ROS },
      { t: "head", text: "PHYSICAL EXAMINATION:" },
      { t: "kv", rows: [
        ["VITAL SIGNS:", `Blood pressure is ${v.bp || "___"}, pulse ${v.hr || "___"}, respirations ${v.rr || "___"}, temperature ${v.temp || "___"}, oxygen saturation is ${v.o2 || "___"} % on room air. Height is ${v.ht || "___"} inches. Weight is ${v.wt || "___"} pounds.`],
        ["GENERAL:", `${h.general || "Patient appears stated age"}. The patient shows no bizarre behavior and is in no acute distress.`],
        ["HEENT:", pe("HEENT", "The head is normocephalic and atraumatic. The eyes are clear without injection or icterus. The extraocular muscles are intact. The pupils are equally responsive and reactive to light and accommodation. The ears show bilateral tympanic membranes are clear. The nose is normal without drainage. The throat is without erythema or exudate.")],
        ["NECK:", "The neck is supple without lymphadenopathy or thyromegaly."],
        ["BACK:", "The back is nontender."],
        ["RESPIRATORY:", pe("RESP", "The lungs are clear to auscultation bilaterally, no wheezes, rales or rhonchi. Work of breathing is normal.")],
        ["CARDIAC:", pe("CARDIO", "The heart has a regular rate and rhythm, no murmurs, rubs or gallops. No cyanosis. Symmetrical pulses.")],
        ["ABDOMEN:", pe("ABD/GI", "The abdomen is soft, nontender, nondistended, no hepatosplenomegaly. No rebound, no guarding.")],
        ["EXTREMITIES:", "The extremities are without edema or cyanosis."],
        ["SKIN:", pe("SKIN", "The skin is without rash or lesions.")],
        ["MUSCULOSKELETAL:", pe("MUSKULOSKELETAL", "Patient is ambulatory. Gait is normal for patient.")],
        ["NEUROLOGICAL:", ""]] },
      { t: "kv", indent: true, rows: CN },
      { t: "kv", rows: [["GENITOURINARY/RECTAL:", gu]] },
      { t: "head", text: "LABORATORY DATA:" }, ...labBlocks(n.labs),
      { t: "head", text: "ASSESSMENT AND PLAN:" }, { t: "num", items: ap },
      { t: "p", text: TAPERS[pt.psych?.taper || "safety"] },
      { t: "sign", left: `Signed: ${opts.provider || ""}`, right: `Scribe: ${h.scribe || ""}`, sub: `${fullDate(date)} @ ${pt.times?.[date] || ""} hours` },
      { t: "codes", label: "", items: ["99222", "99223"] },
      { t: "codes", label: "EKG Interpretation:", items: ["93010"] },
    ],
  };
}

export const blocksFor = (pt, date, opts) =>
  pt.status === "admit" ? hpBlocks(pt, opts) : progressBlocks(pt, date, opts);
