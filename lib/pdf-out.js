// Blocks -> printable PDF (one file for a whole unit, each note starting on a new page).
// `jsPDF` is the jsPDF constructor. Letter size, 1" margins, Times.
export function toPdf(jsPDF, notes) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const PW = 612, PH = 792, M = 72, W = PW - 2 * M, LH = 14.5;
  let y, first = true, noteStart = 1;
  const ranges = [];

  const font = (style = "normal", size = 12) => { doc.setFont("times", style); doc.setFontSize(size); };
  const top = note => note.header.firstPageDifferent ? M + 6 : M + 66;   // room for the header block

  function newPage(note) {
    if (!first) doc.addPage();
    first = false; y = top(note) ;
  }
  function ensure(h, note) {
    if (y + h > PH - M - (note.footer ? 18 : 0)) { doc.addPage(); y = note.header.firstPageDifferent ? M + 66 : M + 66; }
  }
  function text(str, x, width, note, o = {}) {
    font(o.bold ? "bold" : o.italic ? "italic" : "normal", o.size || 12);
    const lines = doc.splitTextToSize(String(str ?? ""), width);
    for (const l of lines) { ensure(LH, note); doc.text(l, x, y + 10, o.align ? { align: o.align } : undefined); y += LH; }
  }

  for (const note of notes) {
    newPage(note);
    noteStart = doc.getNumberOfPages();
    for (const b of note.blocks) {
      switch (b.t) {
        case "title": y += 10; text(b.text, PW / 2, W, note, { bold: true, align: "center" }); y += 10; break;
        case "box": {
          y += 10; ensure(22, note);
          doc.setLineWidth(0.8); doc.rect(M, y, W, 20);
          font("bold"); doc.text(b.label, M + 6, y + 14);
          if (b.text) { const lw = doc.getTextWidth(b.label + " "); font("normal", 11); doc.text(b.text, M + 6 + lw, y + 14); }
          y += 26; break;
        }
        case "boxed": {
          y += 6; ensure(44, note);
          const y0 = y; doc.setLineWidth(0.8); doc.rect(M, y0, W, 20); font("bold"); doc.text(b.label, M + 6, y0 + 14);
          y = y0 + 22;
          if (!b.paras.length) { doc.rect(M, y0 + 20, W, 16); y = y0 + 40; break; }
          const startPage = doc.getNumberOfPages(), cy = y;
          b.paras.forEach(p => { text(p, M + 6, W - 12, note); y += 4; });
          if (doc.getNumberOfPages() === startPage) doc.rect(M, y0 + 20, W, y - cy + 4);
          y += 10; break;
        }
        case "p": y += b.tight ? 0 : 8; text(b.text, M, W, note); break;
        case "line": text(b.text, M, W, note); break;
        case "head": y += 10; text(b.text, M, W, note, { bold: true }); break;
        case "bullet": { y += 4; ensure(LH, note); font(); doc.text("-", M + 18, y + 10); text(b.text, M + 36, W - 36, note); break; }
        case "center": y += b.gap ? 12 : 0; text(b.text, PW / 2, W, note, { bold: b.bold, italic: b.italic && !b.bold, size: b.size || 12, align: "center" }); y += b.gap ? 10 : 0; break;
        case "kv": {
          const lw = b.indent ? 110 : 175, x0 = b.indent ? M + 40 : M;
          for (const [k, v] of b.rows) {
            ensure(LH, note); const y0 = y;
            font(b.bold ? "bold" : "normal"); doc.splitTextToSize(k, lw - 6).forEach((l, i) => doc.text(l, x0, y0 + 10 + i * LH));
            const kh = doc.splitTextToSize(k, lw - 6).length * LH;
            text(v, x0 + lw, W - lw - (x0 - M), note);
            y = Math.max(y, y0 + kh);
          }
          break;
        }
        case "num": b.items.forEach((t, i) => { ensure(LH, note); font(); doc.text(`${i + 1}.`, M, y + 10); if (String(t || "").trim()) text(t, M + 36, W - 36, note); else y += LH; }); break;
        case "vitals": {
          y += 4; ensure(36, note);
          const v = b.v || {}, cols = ["VS:", "BP:", "Pulse", "RR", "Temp", "O2 Sat (% RA)", "BG:"];
          const vals = ["", v.bp || "", v.hr || "", v.rr || "", v.temp || "", v.o2 || "", v.bg || "N/A"];
          const ws = [56, 66, 66, 60, 66, 92, 62]; let x = M;
          doc.setLineWidth(0.6);
          cols.forEach((c, i) => {
            doc.rect(x, y, ws[i], 16); if (i) doc.rect(x, y + 16, ws[i], 16);
            font(i ? "normal" : "bold", 11); doc.text(c, x + ws[i] / 2, y + 12, { align: "center" });
            font("normal", 11); doc.text(String(vals[i]), x + ws[i] / 2, y + 28, { align: "center" });
            x += ws[i];
          });
          y += 42; break;
        }
        case "sign": {
          y += 30; ensure(LH * (b.sub ? 3 : 2), note); font();
          const lx1 = M + 52, lx2 = M + 225, rx1 = M + 300, rx2 = M + W;
          doc.text(b.left, M, y + 10); doc.setLineWidth(0.7); doc.line(lx1, y + 12, lx2, y + 12);
          doc.text(b.right, M + 255, y + 10); doc.line(rx1, y + 12, rx2, y + 12);
          if (b.leftName) doc.text(b.leftName, (lx1 + lx2) / 2, y + 9, { align: "center" });
          if (b.rightName) doc.text(b.rightName, (rx1 + rx2) / 2, y + 9, { align: "center" });
          y += LH + 4; if (b.sub) text(b.sub, M, W, note); break;
        }
        case "providers": {
          const colW = W / 4;
          for (let i = 0; i < b.names.length; i += 4) {
            y += 16; ensure(LH, note); font();
            b.names.slice(i, i + 4).forEach((n, j) => {
              const x = M + j * colW; doc.text(n, x, y + 10);
              if (n === b.chosen) { const tw = doc.getTextWidth(n); doc.setLineWidth(1.1); doc.ellipse(x + tw / 2, y + 6, tw / 2 + 8, 11); }
            });
            y += LH;
          }
          break;
        }
        case "codes": { y += 12; ensure(LH, note); font(); doc.text(b.label, M, y + 10);
          const x0 = Math.max(M + 70, M + doc.getTextWidth(b.label) + 24); b.items.forEach((c, i) => doc.text(c, x0 + i * 80, y + 10)); y += LH; break; }
      }
    }
    ranges.push([noteStart, doc.getNumberOfPages(), note]);
  }

  // headers, page numbers, footers
  for (const [a, z, note] of ranges) {
    const total = z - a + 1;
    for (let p = a; p <= z; p++) {
      doc.setPage(p); const i = p - a + 1, h = note.header;
      font("normal", 11);
      if (!(h.firstPageDifferent && i === 1)) {
        font("normal", 12); doc.text(h.lines[0], M, M - 6);
        font("normal", 11); doc.text(h.lines[1], M, M + 8); doc.text(h.lines[2], M, M + 22); doc.text(h.lines[3], M, M + 36);
        if (h.unit && !h.firstPageDifferent) { font("bold", 11); doc.text(`Unit: ${h.unit}`, M + 230, M + 22); }
      }
      font("normal", 11); doc.text(`Page ${i} / ${total}`, PW - M, h.firstPageDifferent && i === 1 ? M - 6 : M + 36, { align: "right" });
      if (note.footer) { font("normal", 11); doc.text(note.footer, PW / 2, PH - M + 24, { align: "center" }); }
    }
  }
  return doc;
}
