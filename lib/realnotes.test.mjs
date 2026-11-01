// Wording from the real example pages (patient details removed), run through import + prep.
// Run: node lib/realnotes.test.mjs   Prints what tomorrow's entries would say.
import { parseNote } from "./docx-in.js";
import * as E from "../engine/engine.js";

const HDR = d => ["Patient Name: Test, Pat", "Unit: Zion", `Date of service: ${d}, Time: 1250 hours`];
const notes = {
  zion: [
    "CHIEF COMPLAINT/HISTORY OF PRESENT ILLNESS:", "Patient is a 40 year-old female who admitted to Aspen Grove Behavioral Hospital for inpatient treatment. Patient expresses high anxiety.",
    "Leg pain: The patient reports taking Mobic 15 mg PO QD at home for generalized pain. 10/25: Patient taking Mobic 15 mg PO QD, reports baseline pain today. 10/26: Patient taking Mobic 15 mg PO QD, reports baseline pain today. 10/27: Patient taking Mobic, reports baseline pain today. 10/28: Patient taking Mobic, reports baseline pain today. 10/29: Patient taking Mobic, reports leg pain from surgery four weeks ago, Patient reports that Subutex is discontinued by psychiatrist requested increase on ibuprofen. 10/30: Patient taking Mobic and Ibuprofen, reports pain today 10/31: Patient taking Mobic and Ibuprofen, reports baseline pain today 11/1: Patient taking Mobic and Ibuprofen and now Tramadol 50 mg BID PRN x2 days, reports baseline pain today",
    "Migraines: The patient reports taking Imitrex 25mg PO QD PRN at home for migraines. 10/25: Patient taking Imitrex 25mg PO QD PRN, reports baseline headaches today. 10/26: Patient taking Imitrex 25mg PO QD PRN, reports baseline headaches today. 10/27: Patient taking Imitrex, reports baseline headaches today. 10/31: Patient taking Imitrex, reports baseline headaches today. 11/1: Patient taking Imitrex, reports baseline headaches today.",
    "Pulmonary Fibrosis: Patient reports using Atrovent HFA 1 puff INH QD at home for Pulmonary fibrosis. 10/25: Patient using Atrovent HFA inhaler, denies SOB today. 10/28: Patient using Atrovent HFA inhaler, patient reports mild difficulty breathing. 10/30: Patient using Atrovent HFA inhaler and Albuterol inhaler, denies SOB today. 10/31: Patient using Atrovent HFA inhaler and Albuterol inhaler, denies SOB today. 11/1: Patient using Atrovent HFA inhaler and Albuterol inhaler, denies SOB today.",
    "Constipation: Patient reports last bowel movement 4 days ago. 10/25: Patient taking Linzess 72mcg PO QD, denies bowel movement today. 10/27: Patient taking Linzess, denies issues with bowel movement today. 10/29: Patient taking Linzess, reports no bowel movement for the last 4 days. 10/30: Patient taking Linzess, denies bowel movement today. 10/31: Patient taking Linzess, denies bowel movement today. 11/1: Patient taking Linzess, denies bowel movement today.",
    "RESOLVED HPI:", "", "REVIEW OF SYSTEMS: Systems were reviewed and normal, except as noted in the HPI.", "PHYSICAL EXAMINATION:", "LABORATORY DATA:", "EKG Reviewed 10/31.",
    "ASSESSMENT/PLAN:", "Diet is regular.", "Activity is as tolerated.",
    "Leg Pain: Will treat with Mobic 15 mg PO QD. 10/25: Cont. Mobic. 10/29: Cont. Mobic. 10/30: Cont. Mobic, increase Tylenol 975mg, will order right knee X-ray. 10/31: Cont. Mobic and Tylenol, and start Tramadol 50 mg BID PRN x2 days. 11/1: Cont. Mobic, Tylenol, and Tramadol x2 days.",
    "Migraines: Will treat with Imitrex 25mg PO QD PRN. 10/25: Cont. Imitrex. 10/31: Cont. Imitrex. 11/1: Cont. Imitrex.",
    "Pulmonary Fibrosis: Will treat with Atrovent HFA 1 puff INH QD. 10/25: Cont. Atrovent HFA inhaler. 10/28: Cont. Atrovent HFA inhaler, will add Albuterol 2 puffs Q6H PRN. 10/29: Cont. Atrovent HFA inhaler, will add Albuterol 2 puffs Q6H PRN. 10/30: Cont. Albuterol and Atrovent HFA. 10/31: Cont. Albuterol and Atrovent HFA. 11/1: Cont. Albuterol and Atrovent HFA.",
    "Constipation: Will treat with Linzess 72mcg PO QD, 10/25: Cont. Linzess. 10/29: Will order a miralax and Cont. Linzess. 10/30: Cont. Linzess. 10/31: Cont. Linzess. 11/1: Cont. Linzess.",
    "Major depressive disorder, recurrent severe without psychotic features, Opioid dependence, uncomplicated. Safety checks will be performed every 15 minutes throughout the patient's stay. Will monitor for extrapyramidal symptoms, and signs of serotonin syndrome. COWS protocol has been implemented, and a Subutex taper was started.",
    "RESOLVED PLAN:", "", "Signed:"],
  nebo: [
    "CHIEF COMPLAINT/HISTORY OF PRESENT ILLNESS:", "Patient is a 52 year-old female who admitted for inpatient treatment.",
    "Hypertension: Patient reports taking Lisinopril 40mg QD at home to manage blood pressure. 10/30: Patient taking Lisinopril 40mg QD, BP today is 136/100 10/31: Patient taking Lisinopril 40mg QD, BP today is 150/74. 11/1: Patient taking Lisinopril, BP today is [...].",
    "Constipation: Patient reports not having a bowel movement in 4 days 10/30: Patient reports improved symptoms today 10/31: Patient reports improved symptoms today 11/1: Patient reports improved symptoms today",
    "Dog bite on Bilateral Calfs: Patient presents with dog bites on both calves, wound on R calf still open. 10/30: Patient reports less swelling and wound healing well 10/31: Patient reports less swelling and wound healing well 11/1: Patient reports less swelling and wound healing well",
    "RESOLVED HPI:", "", "PHYSICAL EXAMINATION:", "LABORATORY DATA:", "All Labs Pending", "ASSESSMENT/PLAN:",
    "Major depressive disorder, recurrent, severe with psychotic symptoms: Q15 min safety checks in place, monitor for extrapyramidal symptoms and signs of serotonin syndrome",
    "Hypertension: Will treat with Lisinopril 40mg QD. 10/30: Cont. Lisinopril. 10/31: Cont. Lisinopril. 11/1: Cont. Lisinopril.",
    "Dog Bite on Right Calf: Will continue Augmentin 875 mg PO BID x7 more days. 10/30: Cont. Augmentin 10/31: Cont. Augmentin 11/1: Cont. Augmentin",
    "Constipation: Patient will start taking Docusate 100 mg PO BID PRN 10/30 Cont. Docusate 10/31 Cont. Docusate. 11/1 Cont. Docusate.",
    "Vertigo: Etiology unclear, stroke or other intracranial abnormalities unlikely, continue to monitor. 11/1: CTM",
    "RESOLVED PLAN:", "", "Signed:"],
  long: [
    "CHIEF COMPLAINT/HISTORY OF PRESENT ILLNESS:", "Patient is a 30 year-old female who admitted for inpatient treatment.",
    "Migraine: Patient is taking Fentanyl 75 mcg hr pt 72 TD at home. 10/29: Patient taking Fentanyl, denies migraine today. 10/30: Patient taking Fentanyl, denies migraines today. 10/31: Patient taking Fentanyl, denies migraines today. 11/1: Patient taking Fentanyl, denies migraines today.",
    "RESOLVED HPI:", "", "PHYSICAL EXAMINATION:", "LABORATORY DATA:", "All Labs Pending", "ASSESSMENT/PLAN:",
    "Major depressive disorder, recurrent severe without psychotic features. Q15 min safety checks in place, monitor for extrapyramidal symptoms and signs of serotonin syndrome",
    "Migraine: Patient will continue taking Fentanyl 75 mcg hr pt 72 TD. 10/23: Cont. Fentanyl. 10/24: Decrease from 75mcg/hour to 50mcg/hour. 10/25: Decrease from 75mcg/hour to 50mcg/hour.",
    "Vitamin D deficiency: Will treat with Ergocalciferol 50,000 units x1 dose. 10/30: CTM. 10/31: CTM. 11/1: CTM.",
    "2+ Pitting Edema: Will order CMP, TSH w/ and NT-proBNP reflex to T4. Will order wedge to elevate feet at night. 10/27: CMP and TSH pending, cont. Wedge pillow. Will order Lasix 20mg QD x3days (10/27-10/30). 10/30: Cont. Lasix (last dose 11/3) and wedge pillow, CMP and TSH pending. 10/31: Cont. Lasix (last dose 11/3) and wedge pillow, CMP and TSH pending. 11/1: Cont. Lasix (last dose 11/3) and wedge pillow, CMP and TSH pending.",
    "RESOLVED PLAN:", "Pneumonia: Will treat with Doxycycline 100mg BID x 10 days (10/12 - 10/22), Albuterol Inhaler 90mcg per Inhalation, 2 inhalations Q6H PRN. 10/20: Cont. Doxycycline (Last dose 10/22) and Albuterol, CTM. RESOLVED.", "Signed:"],
  asthma: [
    "CHIEF COMPLAINT/HISTORY OF PRESENT ILLNESS:", "Patient is a 45 year-old female who admitted for inpatient treatment.",
    "Asthma: Patient reports a history of asthma at home and requested an inhaler. 11/1: Started on Albuterol 2 puffs Q6H PRN, reports no SOB or wheezing today.",
    "Arthritis Pain: Patient reports a diagnosis of arthritis in the past, and reports pain in her shoulder and hips. 11/1: Taking Ibuprofen 400mg, Tylenol 650mg Q6H PRN, and Prednisone 40 mg QD x5 days (10/31- 11/4), reports pain managed well with medications.",
    "RESOLVED HPI:", "", "PHYSICAL EXAMINATION:", "LABORATORY DATA:", "EKG Reviewed 10/31.", "ASSESSMENT/PLAN:",
    "Asthma: Will treat with Albuterol 2 puffs Q6H PRN.",
    "Arthritis Pain: Will treat with Ibuprofen 400mg, Tylenol 650mg Q6H PRN, and Prednisone 40 mg QD x5 days (10/31- 11/4).",
    "RESOLVED PLAN:", "", "Signed:"],
  none: [
    "CHIEF COMPLAINT/HISTORY OF PRESENT ILLNESS:", "Patient is a 25 year-old male who admitted for inpatient treatment. Patient meets criteria for in-patient hospitalization in a more restrictive environment.",
    "- 11/1: Patient reports no medical or physical concerns today.",
    "RESOLVED HPI:", "", "PHYSICAL EXAMINATION:", "Patient Name: Test, Pat", "Date of Birth: 01/01/1990", "MRN: 1234", "Admit Date: 10/25/2026", "Page 2 / 2",
    "LABORATORY DATA:", "All Labs Pending", "ASSESSMENT/PLAN:", "Diet is regular.", "Activity is as tolerated.",
    "Schizophrenia: Q15 min safety checks in place, monitor for extrapyramidal symptoms and signs of serotonin syndrome", "RESOLVED PLAN:", "", "Signed:"],
};

for (const [k, body] of Object.entries(notes)) {
  const pt = parseNote(body, HDR("11/1/2026"), "Test, Pat.docx");
  pt.vitals["2026-11-02"] = { bp: "128/80" };
  const { review } = E.prep(pt, "2026-11-01");
  console.log(`\n===== ${k}  (problems: ${pt.problems.length}, psych: "${pt.psych.dx.slice(0, 40)}", taper: ${pt.psych.taper})`);
  for (const p of pt.problems) {
    if (p.resolved) { console.log(`  [resolved] ${p.name}`); continue; }
    const h = p.hpi.find(e => e.date === "2026-11-02"), pl = p.plan.find(e => e.date === "2026-11-02");
    console.log(`  ${p.name}${p.planOnly ? " [plan only]" : ""}${p.hpiOnly ? " [hpi only]" : ""}`);
    console.log(`     HPI  11/2: ${h ? h.text : "(none)"}`);
    console.log(`     Plan 11/2: ${pl ? pl.text : "(none)"}`);
  }
  const fl = E.flags(pt, "2026-11-02", {}).filter(f => f.level !== "amber" || !f.text.startsWith("Uncommon"));
  console.log("  flags 11/2:", fl.map(f => f.text).join(" | ") || "(none)");
  console.log("  review:", review.map(r => `${r.name} (${r.reasons.join(", ")})`).join(" | ") || "(none)");
  const n = E.render(pt, "2026-11-02");
  if (!n.hpi.length) console.log("  HPI prints bullet: - 11/2: Patient reports no medical or physical concerns today.");
}
