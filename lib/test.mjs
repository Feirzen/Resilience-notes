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

console.log(`\n${pass} passed`);
