// Run with: node lib/test.mjs  (needs node_modules with docx, jszip, jspdf; fake patients only)
import * as D from "docx";
import JSZip from "jszip";
import { jsPDF } from "jspdf";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import * as E from "../engine/engine.js";
import { progressBlocks, hpBlocks } from "./layout.js";
import { toDocx } from "./docx-out.js";
import { readDocx } from "./docx-in.js";
import { toPdf } from "./pdf-out.js";
import { demoPatients } from "./demo.js";

let pass = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log("ok  ", name); } catch (e) { console.log("FAIL", name, "\n   ", e.stack); process.exitCode = 1; } };
const today = "2026-11-01";
const pts = demoPatients(today);

await t("progress note -> docx -> read back keeps problems and entries", async () => {
  const pt = pts.find(p => p.status === "active");
  const blob = await toDocx(D, progressBlocks(pt, today));
  const buf = Buffer.from(await blob.arrayBuffer());
  writeFileSync("/tmp/sample-progress.docx", buf);
  const back = await readDocx(JSZip, buf, pt.name + ".docx");
  assert.equal(back.name, pt.name);
  assert.equal(back.unit, pt.unit);
  const visible = pt.problems.filter(p => p.start <= today && !(p.resolved && p.resolved < today));
  assert.equal(back.problems.filter(p => !p.resolved).length, visible.length);
  const htn = back.problems.find(p => p.name === "Hypertension");
  assert.ok(htn.hpi.length >= 2, "entries split by date");
  assert.equal(back.psych.dx, pt.psych.dx);
  assert.ok(back.times[today]);
});

await t("imported note preps forward like copy-paste", async () => {
  const pt = pts.find(p => p.status === "active");
  const buf = Buffer.from(await (await toDocx(D, progressBlocks(pt, today))).arrayBuffer());
  const back = await readDocx(JSZip, buf, pt.name + ".docx");
  back.vitals["2026-11-02"] = { bp: "120/80" };
  E.prep(back, today);
  const htn = back.problems.find(p => p.name === "Hypertension");
  assert.match(htn.hpi.at(-1).text, /BP today is 120\/80/);
});

await t("H&P docx builds (adult and adolescent GU line)", async () => {
  const a = pts.find(p => p.status === "admit");
  const blob = await toDocx(D, hpBlocks(a, { provider: "A. Tomco MD" }));
  writeFileSync("/tmp/sample-hp.docx", Buffer.from(await blob.arrayBuffer()));
  const kid = { ...a, adolescent: true };
  const b = hpBlocks(kid); assert.ok(JSON.stringify(b).includes("patient being a minor"));
});

await t("unit PDF with circled provider builds, page numbers per note", async () => {
  const notes = pts.filter(p => p.unit === "Nebo").map(p => p.status === "admit" ? hpBlocks(p) : progressBlocks(p, today, { provider: "A. Tomco MD" }));
  const pdf = toPdf(jsPDF, notes);
  writeFileSync("/tmp/sample-unit.pdf", Buffer.from(pdf.output("arraybuffer")));
  assert.ok(pdf.getNumberOfPages() >= notes.length);
});

import { parseNote } from "./docx-in.js";
await t("import: plan names matched loosely, one-sided problems don't grow new paragraphs", async () => {
  const body = ["MEDICAL PROGRESS NOTE:", "CHIEF COMPLAINT/HISTORY OF PRESENT ILLNESS:", "Patient is a 30 year-old female who admitted...",
    "Migraines: Patient reports constant headaches. 10/30: Patient reports no headaches today. 10/31: Patient reports no headaches today. 11/1: Patient reports no headaches today.",
    "Dog bite on Bilateral Calfs: Patient presents with dog bites. 10/30: wound healing well 10/31: wound healing well 11/1: wound healing well",
    "Anxiety note only: Patient reports stress 11/1: stress",
    "RESOLVED HPI:", "", "REVIEW OF SYSTEMS: Systems were reviewed", "PHYSICAL EXAMINATION:", "LABORATORY DATA:", "All Labs Pending", "ASSESSMENT/PLAN:",
    "Diet is regular.", "Activity is as tolerated.", "Major depressive disorder: Q15 min safety checks in place",
    "Migraine: Patient will start using Tylenol 650 mg PO Q6H PRN 10/30: Cont. Tylenol 10/31: Cont. Tylenol. 11/1: Cont. Tylenol.",
    "Dog Bite on Right Calf: Will continue Augmentin 875 mg PO BID x7 more days. 10/30: Cont. Augmentin 10/31: Cont. Augmentin 11/1: Cont. Augmentin",
    "Vitamin D deficiency: Will treat with Ergocalciferol 50,000 units x1 dose. 10/31: CTM. 11/1: CTM.",
    "RESOLVED PLAN:", "", "Signed:"];
  const pt = parseNote(body, ["Patient Name: Test, Amy", "Unit: Bryce", "Date of service: 11/1/2026, Time: 1046 hours"], "Test, Amy.docx");
  const names = pt.problems.map(p => p.name + (p.planOnly ? "[plan]" : "") + (p.hpiOnly ? "[hpi]" : ""));
  assert.deepEqual(names, ["Migraines", "Dog bite on Bilateral Calfs", "Anxiety note only[hpi]", "Vitamin D deficiency[plan]"]);
  const none = parseNote(["CHIEF COMPLAINT/HISTORY OF PRESENT ILLNESS:", "Patient is a 30 year-old male who admitted for treatment.", "\u2022\t11/1: Patient reports no medical or physical concerns today.",
    "RESOLVED HPI:", "PHYSICAL EXAMINATION:", "Patient Name: Test, Bob", "Date of Birth: 01/01/1990", "MRN: 123", "Admit Date: 10/20/2026", "Page 2 / 2",
    "ASSESSMENT/PLAN:", "Diet is regular.", "Activity is as tolerated.", "MDD: Q15 min safety checks in place", "RESOLVED PLAN:"], ["Date of service: 11/1/2026, Time: 1000 hours"], "Test, Bob.docx");
  assert.equal(none.problems.length, 0, "no stray problems from page headers or the no-concerns bullet");
  assert.equal(none.blurb, "Patient is a 30 year-old male who admitted for treatment.");
  E.prep(pt, "2026-11-01");
  assert.equal(pt.problems[3].hpi.length, 0);
  assert.equal(pt.problems[2].plan.length, 0);
  const n = E.render(pt, "2026-11-02");
  assert.equal(n.hpi.length, 3); assert.equal(n.plan.length, 4);
});


await t("signing block stays on one page; signed page comes off the printer on top", async () => {
  const base = pts.find(p => p.status === "active" && p.problems.length >= 2);
  const findSig = doc => { const out = []; for (let i = 1; i <= doc.getNumberOfPages(); i++) { const txt = doc.internal.pages[i].join("\n"); out.push({ i, sign: txt.includes("(Signed:)"), bc: txt.includes("(BC:)"), ekg: txt.includes("(EKG:)") }); } return out; };
  // pad the note so the signing block lands at many different spots on the page
  for (let extra = 0; extra < 40; extra += 3) {
    const pt = structuredClone(base);
    pt.problems[0].hpi.push(...Array.from({ length: extra }, (_, k) => ({ date: today, text: "Filler line number " + k + " ".repeat(5) + "x".repeat(120), auto: "" })));
    const note = progressBlocks(pt, today);
    const plain = toPdf(jsPDF, [note]), pages = findSig(plain);
    const sp = pages.find(p => p.sign);
    assert.ok(sp && sp.bc && sp.ekg, `signing block split (extra ${extra}): ${JSON.stringify(pages)}`);
    const flipped = toPdf(jsPDF, [note, note], { sigFirst: true });
    const info = flipped.noteInfo[0], n = info.pages, s = info.sigPage;
    const want = [...Array.from({ length: n - s + 1 }, (_, k) => s + k), ...Array.from({ length: s - 1 }, (_, k) => k + 1)];
    assert.deepEqual(info.order, want);
    const fp = findSig(flipped);
    assert.ok(fp[0].sign, "first printed page has the signature");
    assert.ok(fp[n].sign, "second note's first printed page has the signature too");
    if (extra === 39) writeFileSync("/tmp/sigfirst.pdf", Buffer.from(flipped.output("arraybuffer")));
  }
});

await t("Word file keeps the signing block together", async () => {
  const pt = pts.find(p => p.status === "active");
  const blob = await toDocx(D, progressBlocks(pt, today));
  const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
  const xml = await zip.file("word/document.xml").async("string");
  const tail = xml.slice(xml.indexOf("Signed:") - 2000, xml.indexOf("93010"));
  assert.ok((tail.match(/<w:keepNext\/>/g) || []).length >= 5, "keepNext on the signing block");
  assert.ok(/<w:cantSplit\/>/.test(tail), "signature row can't split");
});

console.log(`\n${pass} passed`);
