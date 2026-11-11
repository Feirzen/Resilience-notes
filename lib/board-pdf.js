// Bedboard -> one landscape page: a square per unit (fold it up and keep a unit in your pocket).
// units: [{ name, color: [r,g,b], rows: [{ name, status: "admit"|"attn"|"fu"|"ok", text, bill }] }]
export const STATUS = {
  admit: { label: "ADMIT", color: [42, 98, 201] },
  attn: { label: "Needs attention", color: [229, 72, 77] },
  fu: { label: "Follow up", color: [240, 160, 32] },
  ok: { label: "Nothing abnormal", color: [34, 170, 120] },
};
export function boardPdf(jsPDF, units, { title = "", showBill = true, showSeen = true, showText = true } = {}) {
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  const PW = 792, PH = 612, M = 24, GAP = 10, cols = 3;
  const rowsN = Math.max(1, Math.ceil(units.length / cols));
  const CW = (PW - 2 * M - GAP * (cols - 1)) / cols, CH = (PH - 2 * M - 18 - GAP * (rowsN - 1)) / rowsN;
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(30);
  doc.text(title, M, M + 6);
  // legend
  let lx = PW - M; doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  for (const k of ["ok", "fu", "attn", "admit"].reverse()) {
    const s = STATUS[k], w = doc.getTextWidth(s.label) + 14; lx -= w;
    doc.setFillColor(...s.color); doc.circle(lx + 3, M + 3.5, 3, "F"); doc.setTextColor(60); doc.text(s.label, lx + 9, M + 6);
    lx -= 6;
  }
  units.forEach((u, i) => {
    const x = M + (i % cols) * (CW + GAP), y = M + 18 + Math.floor(i / cols) * (CH + GAP);
    doc.setDrawColor(170); doc.setLineWidth(0.6); doc.roundedRect(x, y, CW, CH, 6, 6, "S");
    doc.setFillColor(...u.color); doc.roundedRect(x, y, CW, 20, 6, 6, "F"); doc.rect(x, y + 12, CW, 8, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
    doc.text(u.name.toUpperCase(), x + 8, y + 14); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    doc.text(`${u.rows.length} patient${u.rows.length === 1 ? "" : "s"}`, x + CW - 8, y + 14, { align: "right" });
    const avail = CH - 26, n = Math.max(u.rows.length, 1);
    const lh = Math.max(9, Math.min(showText ? 24 : 16, avail / n)), fs = Math.min(9.5, lh * (showText ? 0.42 : 0.62));
    let yy = y + 26;
    u.rows.forEach((r, j) => {
      if (j) { doc.setDrawColor(225); doc.setLineWidth(0.4); doc.line(x + 6, yy - 1, x + CW - 6, yy - 1); }
      const s = STATUS[r.status] || STATUS.ok;
      doc.setFillColor(...s.color); doc.circle(x + 10, yy + fs * 0.75, 2.6, "F");
      let rx = x + CW - 8;
      if (showSeen) { doc.setDrawColor(120); doc.setLineWidth(0.6); doc.rect(rx - 8, yy + 1, 8, 8); rx -= 14; }
      if (showBill) { doc.setDrawColor(120); doc.line(rx - 16, yy + 9, rx, yy + 9); doc.setTextColor(30); doc.setFontSize(fs); if (r.bill) doc.text(String(r.bill), rx - 8, yy + 8, { align: "center" }); rx -= 22; }
      doc.setTextColor(25); doc.setFont("helvetica", "bold"); doc.setFontSize(fs);
      doc.text(doc.splitTextToSize(r.name, rx - x - 18)[0], x + 17, yy + fs * 0.95);
      if (showText && r.text) {
        doc.setFont("helvetica", "normal"); doc.setTextColor(95); doc.setFontSize(fs * 0.85);
        doc.text(doc.splitTextToSize(r.text, rx - x - 18)[0], x + 17, yy + fs * 0.95 + fs * 0.95);
      }
      yy += lh;
    });
  });
  return doc;
}
