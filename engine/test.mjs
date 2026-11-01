// Run with: node engine/test.mjs   (fake patients only)
import * as E from "./engine.js";
import assert from "node:assert/strict";

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("ok  ", name); } catch (e) { console.log("FAIL", name, "\n   ", e.message); process.exitCode = 1; } };

const fake = () => ({
  name: "Doe, Jane", room: "22A", unit: "Nebo", type: "progress",
  psych: { dx: "Major depressive disorder, recurrent severe", taper: "none" },
  vitals: { "2026-10-30": { bp: "136/100" }, "2026-10-31": { bp: "150/74" } },
  refusing: [], pendingLabs: [],
  problems: [
    { id: "htn", name: "Hypertension", symptom: "blood pressure", autoVital: "bp", start: "2026-10-29",
      hpiOpen: "Patient reports taking Lisinopril 40mg QD at home to manage blood pressure",
      planOpen: "Will treat with Lisinopril 40mg QD",
      meds: [{ id: "m1", name: "Lisinopril", dose: "40mg", freq: "QD", start: "2026-10-29", home: true }],
      hpi: [], plan: [] },
    { id: "gerd", name: "Gastroesophageal reflux disease", symptom: "acid reflux", start: "2026-10-29",
      hpiOpen: "Patient reports taking Omeprazole 40mg BID PRN at home to manage acid reflux",
      planOpen: "Will treat with Omeprazole 40mg BID PRN",
      meds: [{ id: "m2", name: "Omeprazole", dose: "40mg", freq: "BID", prn: true, start: "2026-10-29", home: true }],
      hpi: [], plan: [] },
    { id: "bite", name: "Dog bite on right calf", symptom: "wound", alwaysFlag: true, start: "2026-10-29",
      planOpen: "Will treat with Augmentin 875 mg PO BID x7 days",
      meds: [{ id: "m3", name: "Augmentin", dose: "875 mg", route: "PO", freq: "BID", start: "2026-10-29", end: "2026-11-01" }],
      hpi: [{ date: "2026-10-29", text: "Patient presents with dog bite, wound open, mild serous drainage", auto: "" }],
      plan: [] },
    { id: "const", name: "Constipation", symptom: "constipation", start: "2026-10-29",
      hpiOpen: "Patient reports not having a bowel movement in 4 days", meds: [], hpi: [], plan: [] },
  ],
});

t("routine home med copies forward quietly", () => {
  const pt = fake(); E.prep(pt, "2026-10-29");
  const { review } = E.prep(pt, "2026-10-30");
  const p = pt.problems[1];
  assert.equal(p.hpi[0].text, "Patient taking Omeprazole, reports acid reflux managed well with medications.");
  assert.equal(p.plan[0].text, "Cont. Omeprazole.");
  assert.ok(!review.find(r => r.problemId === "gerd"));
});

t("hypertension pulls in the day's BP, placeholder when unknown", () => {
  const pt = fake(); E.prep(pt, "2026-10-29");
  assert.equal(pt.problems[0].hpi[0].text, "Patient taking Lisinopril, BP today is 136/100.");
  E.prep(pt, "2026-10-30"); E.prep(pt, "2026-10-31");
  assert.equal(pt.problems[0].hpi[2].text, "Patient taking Lisinopril, BP today is [...].");
  pt.vitals["2026-11-01"] = { bp: "128/82" }; E.fillVitals(pt, "2026-11-01");
  assert.equal(pt.problems[0].hpi[2].text, "Patient taking Lisinopril, BP today is 128/82.");
});

t("no medication: baseline wording, CTM, soft flag", () => {
  const pt = fake(); E.prep(pt, "2026-10-29");
  assert.equal(pt.problems[3].hpi[0].text, "Patient reports baseline constipation symptoms today.");
  assert.equal(pt.problems[3].plan[0].text, "CTM.");
  assert.ok(E.flags(pt, "2026-10-30").some(f => f.text === "Constipation: no medication"));
});

t("antibiotic: full name first time, then short, last dose shown", () => {
  const pt = fake(); E.prep(pt, "2026-10-29");
  const b = pt.problems[2];
  assert.equal(b.hpi[1].text, "Patient now taking Augmentin 875 mg PO BID (last dose 11/1), reports wound managed well with medications.");
  assert.equal(b.plan[0].text, "Cont. Augmentin (last dose 11/1).");
  E.prep(pt, "2026-10-30");
  assert.equal(b.hpi[2].text, "Patient taking Augmentin (last dose 11/1), reports wound managed well with medications.");
});

t("antibiotic flags on last day and every day after until addressed", () => {
  const pt = fake();
  assert.ok(E.flags(pt, "2026-11-01").some(f => f.text === "Augmentin last dose today"));
  assert.ok(E.flags(pt, "2026-11-03").some(f => f.text === "Augmentin ended 11/1: needs a decision"));
  pt.problems[2].meds[0].addressed = true;
  assert.ok(!E.flags(pt, "2026-11-03").some(f => f.text.startsWith("Augmentin")));
});

t("med ending today goes to review", () => {
  const pt = fake(); for (const d of ["2026-10-29", "2026-10-30", "2026-10-31"]) E.prep(pt, d);
  const { review } = E.prep(pt, "2026-11-01");
  assert.ok(review.find(r => r.problemId === "bite" && r.reasons.includes("Augmentin ends today")));
});

t("dose change wording in plan and next-day HPI", () => {
  const pt = fake(); const m = pt.problems[1].meds[0];
  m.dose = "20mg"; m.freq = "QD"; m.changedOn = "2026-10-30"; delete m.prn;
  assert.equal(E.defaultPlan(pt, pt.problems[1], "2026-10-30"), "Cont. Omeprazole now 20mg QD.");
  const { review } = E.prep(pt, "2026-10-30");
  assert.ok(review.find(r => r.reasons.includes("dose change: Omeprazole")));
});

t("discontinue: said once, then dropped", () => {
  const pt = fake(); const p = pt.problems[1];
  p.meds.push({ id: "m9", name: "Pepcid", dose: "20mg", freq: "BID", start: "2026-10-30" });
  p.meds[0].discontinued = "2026-10-31";
  assert.equal(E.defaultPlan(pt, p, "2026-10-31"), "Discontinue Omeprazole and continue Pepcid.");
  assert.match(E.defaultHpi(pt, p, "2026-10-31"), /no longer taking Omeprazole/);
  assert.equal(E.defaultPlan(pt, p, "2026-11-01"), "Cont. Pepcid.");
});

t("refusing meds: HPI wording and flag", () => {
  const pt = fake(); pt.refusing = ["m2"];
  assert.equal(E.defaultHpi(pt, pt.problems[1], "2026-10-31"), "Patient refusing Omeprazole, reports baseline acid reflux symptoms today.");
  assert.ok(E.flags(pt, "2026-10-31").some(f => f.text === "Refusing Omeprazole"));
});

t("edited entry gets sent to review", () => {
  const pt = fake(); E.prep(pt, "2026-10-29");
  pt.problems[1].hpi[0].text = "Patient taking Omeprazole, reports mild acid reflux overnight.";
  const { review } = E.prep(pt, "2026-10-30");
  assert.ok(review.find(r => r.problemId === "gerd" && r.reasons.includes("HPI edited today")));
});

t("plan order: standing lines, then psych line, then problems", () => {
  const n = E.render(fake(), "2026-10-30");
  assert.deepEqual(n.standing, ["Diet is regular.", "Activity is as tolerated."]);
  assert.match(n.plan[0], /^Major depressive/);
});

t("render: dated entries, psych line first, resolved moves next day", () => {
  const pt = fake(); for (const d of ["2026-10-29", "2026-10-30"]) E.prep(pt, d);
  pt.problems[3].resolved = "2026-10-31";
  let n = E.render(pt, "2026-10-31");
  assert.match(n.plan[0], /^Major depressive disorder.*Q15 min safety checks/);
  assert.equal(n.resolvedHpi.length, 0);
  n = E.render(pt, "2026-11-01");
  assert.ok(n.resolvedPlan[0].endsWith("RESOLVED."));
  assert.equal(n.hpi.length, 3);
  assert.match(n.hpi[2], /^Dog bite on right calf: 10\/29: Patient presents/);
});

t("reprint an old day: nothing after that date shows up", () => {
  const pt = fake(); for (const d of ["2026-10-29", "2026-10-30", "2026-10-31"]) E.prep(pt, d);
  const n = E.render(pt, "2026-10-30");
  assert.ok(!n.hpi.join(" ").includes("11/1:") && !n.hpi.join(" ").includes("10/31:"));
  assert.ok(n.hpi[0].includes("10/30: Patient taking Lisinopril, BP today is 136/100."));
});

t("times: 0930-1500 and all different", () => {
  const pts = Array.from({ length: 15 }, fake); E.assignTimes(pts, "2026-11-01");
  const ts = pts.map(p => p.times["2026-11-01"]);
  assert.equal(new Set(ts).size, 15);
  assert.ok(ts.every(x => x >= "0930" && x <= "1500"));
});

t("H&P converts to progress note and drops ADMIT from the name", () => {
  const a = { ...fake(), type: "admit", file: "Doe, Jane ADMIT" };
  const p = E.convertAdmit(a);
  assert.equal(p.file, "Doe, Jane"); assert.equal(p.status, "active");
});

t("rulebook flags uncommon diagnoses until seen a few times", () => {
  const pt = fake(); const rb = {};
  assert.ok(E.flags(pt, "2026-10-30", rb).some(f => f.text === "Uncommon: Hypertension"));
  E.learn(rb, [pt, pt, pt]);
  assert.ok(!E.flags(pt, "2026-10-30", rb).some(f => f.text === "Uncommon: Hypertension"));
});

t("imported problem copies yesterday's wording with today's BP", () => {
  const pt = fake();
  pt.problems = [{ id: "x", name: "Hypertension", copy: true, start: "2026-10-01", meds: [],
    hpi: [{ date: "2026-10-30", text: "Patient taking Lisinopril, BP today is 136/100", auto: "" }],
    plan: [{ date: "2026-10-30", text: "Cont. Lisinopril", auto: "" }] }];
  E.prep(pt, "2026-10-30");
  assert.equal(pt.problems[0].hpi[1].text, "Patient taking Lisinopril, BP today is 150/74.");
  assert.equal(pt.problems[0].plan[1].text, "Cont. Lisinopril.");
});

t("med started today: plan says start with full name", () => {
  const pt = fake(); const p = pt.problems[1];
  p.meds.push({ id: "t1", name: "Pepcid", dose: "20mg", route: "PO", freq: "BID", start: "2026-10-31" });
  assert.equal(E.defaultPlan(pt, p, "2026-10-31"), "Cont. Omeprazole and start Pepcid 20mg PO BID.");
  assert.equal(E.defaultPlan(pt, p, "2026-11-01"), "Cont. Omeprazole and Pepcid.");
});

t("copied wording: start -> Cont., doses dropped after first mention", () => {
  assert.equal(E.forwardPlan("Patient will start taking Docusate 100 mg PO BID PRN"), "Cont. Docusate.");
  assert.equal(E.forwardPlan("Cont. Mobic and Tylenol, and start Tramadol 50 mg BID PRN x2 days"), "Cont. Mobic and Tylenol, and Tramadol.");
  assert.equal(E.forwardPlan("Cont. Mobic, increase Tylenol 975mg, will order right knee X-ray"), "Cont. Mobic, Tylenol.");
  assert.equal(E.forwardPlan("Cont. Atrovent HFA inhaler, will add Albuterol 2 puffs Q6H PRN"), "Cont. Atrovent HFA inhaler, Albuterol.");
  assert.equal(E.forwardPlan("Cont. Lasix (last dose 11/3) and wedge pillow, CMP and TSH pending"), "Cont. Lasix (last dose 11/3) and wedge pillow, CMP and TSH pending.");
  assert.equal(E.forwardPlan("CTM"), "CTM.");
  assert.equal(E.forwardPlan("Cont. Protein supplement"), "Cont. Protein supplement.");
  assert.equal(E.forwardHpi("Patient taking Mobic and Ibuprofen and now Tramadol 50 mg BID PRN x2 days, reports baseline pain today"), "Patient taking Mobic and Ibuprofen and Tramadol, reports baseline pain today.");
  assert.equal(E.forwardHpi("Started on Albuterol 2 puffs Q6H PRN, reports no SOB or wheezing today"), "Patient taking Albuterol, reports no SOB or wheezing today.");
  assert.equal(E.forwardHpi("Patient taking Imitrex 25mg PO QD PRN, reports baseline headaches today"), "Patient taking Imitrex, reports baseline headaches today.");
});

t("imported problem with an undated plan copies its opening as Cont./CTM", () => {
  const pt = fake();
  pt.problems = [{ id: "v", name: "Vertigo", copy: true, start: "2026-10-01", meds: [], hpiOpen: "Patient reports dizziness", planOpen: "Continue to monitor",
    hpi: [{ date: "2026-10-30", text: "Patient reports no dizziness today", auto: "" }], plan: [] }];
  E.prep(pt, "2026-10-30");
  assert.equal(pt.problems[0].plan[0].text, "CTM.");
  assert.equal(pt.problems[0].hpi.length, 2);
});

t("team wording rules apply during prep", () => {
  const pt = fake(); E.prep(pt, "2026-10-29");
  const rules = { dx: { "Gastroesophageal reflux disease": { status: "denies acid reflux today" } },
    wording: [{ status: "active", field: "plan", find: "Cont.", replace: "Continue" }, { status: "pending", find: "Patient", replace: "Pt" }] };
  E.prep(pt, "2026-10-30", rules);
  const g = pt.problems[1];
  assert.equal(g.hpi.at(-1).text, "Patient taking Omeprazole, denies acid reflux today.");
  assert.equal(g.plan.at(-1).text, "Continue Omeprazole.");
});

console.log(`\n${pass} passed`);
