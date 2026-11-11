// Run: node lib/merge.test.mjs  (fake data only)
import assert from "node:assert/strict";
import { mergePatient, applyTheirs } from "./merge.js";
let pass = 0; const t = (n, f) => { try { f(); pass++; console.log("ok  ", n); } catch (e) { console.log("FAIL", n, "\n   ", e.message); process.exitCode = 1; } };
const base = () => ({ id: "p1", name: "Doe, Jane", unit: "Nebo", rev: 3, labs: [{ date: "2026-11-10", text: "CMP Reviewed 11/10." }], notes: [], vitals: { "2026-11-11": { bp: "130/80" } }, bill: {},
  log: [{ by: "A", at: 1, what: "x" }],
  problems: [{ id: "htn", name: "Hypertension", planOpen: "Will treat with Lisinopril", meds: [{ id: "m1", name: "Lisinopril", dose: "20mg" }],
    hpi: [{ date: "2026-11-10", text: "old" }, { date: "2026-11-11", text: "Patient taking Lisinopril, BP today is 130/80." }],
    plan: [{ date: "2026-11-11", text: "Cont. Lisinopril." }] }] });
const C = x => structuredClone(x);

t("edits to different problems/fields both survive, no clash", () => {
  const b = base(), m = C(b), th = C(b);
  m.problems[0].hpi[1].text = "Patient taking Lisinopril, reports headache today.";        // scribe edits HPI
  th.problems[0].plan[0].text = "Increase Lisinopril to 40mg.";                             // provider edits plan
  th.labs.push({ date: "2026-11-11", text: "TSH Reviewed 11/11." });
  m.bill = { "2026-11-11": "2" };
  const { merged, clashes } = mergePatient(b, m, th);
  assert.equal(clashes.length, 0);
  assert.equal(merged.problems[0].hpi[1].text, "Patient taking Lisinopril, reports headache today.");
  assert.equal(merged.problems[0].plan[0].text, "Increase Lisinopril to 40mg.");
  assert.equal(merged.labs.length, 2); assert.equal(merged.bill["2026-11-11"], "2");
});
t("same entry changed two ways = one clash, mine kept until picked; picking theirs applies it", () => {
  const b = base(), m = C(b), th = C(b);
  m.problems[0].plan[0].text = "Cont. Lisinopril, recheck BP."; th.problems[0].plan[0].text = "Increase Lisinopril to 40mg.";
  const { merged, clashes } = mergePatient(b, m, th);
  assert.equal(clashes.length, 1); assert.match(clashes[0].label, /Hypertension: Plan 11\/11/);
  assert.equal(merged.problems[0].plan[0].text, "Cont. Lisinopril, recheck BP.");
  applyTheirs(merged, clashes[0]); assert.equal(merged.problems[0].plan[0].text, "Increase Lisinopril to 40mg.");
});
t("a diagnosis added on one side and a note added on the other both stay; deletes stick", () => {
  const b = base(), m = C(b), th = C(b);
  m.problems.push({ id: "uti", name: "UTI", hpi: [], plan: [], meds: [] });
  th.notes.push({ id: "n1", kind: "quick", text: "check K" });
  th.labs = [];                                                   // provider removed the old lab line
  const { merged, clashes } = mergePatient(b, m, th);
  assert.equal(clashes.length, 0); assert.equal(merged.problems.length, 2); assert.equal(merged.notes.length, 1); assert.equal(merged.labs.length, 0);
});
t("vitals per day: one side typed them, other didn't touch", () => {
  const b = base(), m = C(b), th = C(b);
  th.vitals["2026-11-12"] = { bp: "Refused" };
  const { merged, clashes } = mergePatient(b, m, th);
  assert.equal(clashes.length, 0); assert.equal(merged.vitals["2026-11-12"].bp, "Refused");
});
t("medication dose changed on both sides differently = clash on that med", () => {
  const b = base(), m = C(b), th = C(b);
  m.problems[0].meds[0].dose = "40mg"; th.problems[0].meds[0].dose = "30mg";
  const { clashes } = mergePatient(b, m, th);
  assert.equal(clashes.length, 1); assert.match(clashes[0].label, /Lisinopril/);
});
t("no base available: identical sides still merge cleanly", () => {
  const m = base(), th = base(); const { clashes } = mergePatient(null, m, th); assert.equal(clashes.length, 0);
});
console.log(`\n${pass} passed`);
