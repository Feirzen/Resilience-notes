// Blocks -> Word file (.docx). `D` is the docx library (window.docx in the browser).
// Times New Roman 12, 1" margins, boxed section headings, like the hospital templates.
export async function toDocx(D, note) {
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle,
    AlignmentType, TabStopType, Header, Footer, PageNumber } = D;
  const FONT = "Times New Roman";
  const run = (text, o = {}) => new TextRun({ text, font: FONT, size: o.size || 24, bold: o.bold, italics: o.italic });
  const line = { style: BorderStyle.SINGLE, size: 6, color: "000000" };
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const boxBorder = { top: line, bottom: line, left: line, right: line };
  const P = (children, o = {}) => new Paragraph({ children, spacing: { before: o.before ?? 0, after: o.after ?? 0 }, ...o.extra });
  const W = 9360; // text width in twips (6.5")

  const cell = (children, o = {}) => new TableCell({
    children, width: { size: o.w, type: WidthType.DXA },
    borders: o.borders || { top: line, bottom: line, left: line, right: line },
  });
  const out = [];
  for (const b of note.blocks) {
    switch (b.t) {
      case "title": out.push(P([run(b.text, { bold: true })], { before: 240, after: 240, extra: { alignment: AlignmentType.CENTER } })); break;
      case "box": out.push(P([run("", { size: 8 })]), new Table({ width: { size: W, type: WidthType.DXA }, rows: [new TableRow({ children: [
        cell([P([run(b.label, { bold: true }), ...(b.text ? [run(" " + b.text, { size: 22 })] : [])])], { w: W })] })] }),
        P([run("", { size: 8 })])); break;
      case "boxed": out.push(new Table({ width: { size: W, type: WidthType.DXA }, rows: [
        new TableRow({ children: [cell([P([run(b.label, { bold: true })])], { w: W })] }),
        new TableRow({ children: [cell(b.paras.length ? b.paras.map(t => P([run(t)], { after: 80 })) : [P([run("")])], { w: W })] }),
      ] }), P([run("")])); break;
      case "p": out.push(P([run(b.text)], { before: b.tight ? 0 : 160 })); break;
      case "line": out.push(P([run(b.text)])); break;
      case "bullet": out.push(P([run(b.text)], { before: 80, extra: { numbering: { reference: "dash", level: 0 } } })); break;
      case "head": out.push(P([run(b.text, { bold: true })], { before: 200 })); break;
      case "center": out.push(P([run(b.text, { bold: b.bold, italic: b.italic, size: b.size ? b.size * 2 : 24 })],
        { before: b.gap ? 240 : 0, after: b.gap ? 200 : 0, extra: { alignment: AlignmentType.CENTER } })); break;
      case "kv": {
        const lw = b.indent ? 2000 : 3000;
        out.push(new Table({ width: { size: W, type: WidthType.DXA }, rows: b.rows.map(([k, v]) => new TableRow({ children: [
          cell([P([run(k, { bold: b.bold })])], { w: lw, borders: { top: none, bottom: none, left: none, right: none } }),
          cell([P([run(v)])], { w: W - lw, borders: { top: none, bottom: none, left: none, right: none } }),
        ] })) }));
        break;
      }
      case "num": b.items.forEach((t, i) => out.push(P([run(`${i + 1}.\t${t}`)], { extra: { indent: { left: 720, hanging: 720 } } }))); break;
      case "vitals": {
        const v = b.v || {}, cols = ["VS:", "BP:", "Pulse", "RR", "Temp", "O2 Sat (% RA)", "BG:"];
        const ws = [1100, 1300, 1300, 1200, 1300, 1860, 1300];
        const vals = ["", v.bp || "", v.hr || "", v.rr || "", v.temp || "", v.o2 || "", v.bg || "N/A"];
        const c = (t, i, bold) => cell([P([run(t, { bold, size: 22 })], { extra: { alignment: AlignmentType.CENTER } })], { w: ws[i] });
        out.push(new Table({ width: { size: W, type: WidthType.DXA }, rows: [
          new TableRow({ children: cols.map((t, i) => c(t, i, i === 0)) }),
          new TableRow({ children: vals.map((t, i) => c(t, i)) }),
        ] }), P([run("")]));
        break;
      }
      case "sign": out.push(P([run(b.left + "\t"), run("_______________________"), run("\t" + b.right + "\t"), run("_______________________")],
        { before: 480, extra: { tabStops: [{ type: TabStopType.LEFT, position: 1100 }, { type: TabStopType.LEFT, position: 4900 }, { type: TabStopType.LEFT, position: 5900 }] } }));
        if (b.sub) out.push(P([run(b.sub)]));
        break;
      case "providers": {
        const rows = []; for (let i = 0; i < b.names.length; i += 4) rows.push(b.names.slice(i, i + 4));
        rows.forEach(r => out.push(P([run(r.join("\t"))], { before: 240,
          extra: { tabStops: [2340, 4680, 7020].map(position => ({ type: TabStopType.LEFT, position })) } })));
        break;
      }
      case "codes": out.push(P([run(b.label + "\t" + b.items.join("\t"))], { before: 240,
        extra: { tabStops: [1100, 2700, 4300, 5900].map(position => ({ type: TabStopType.LEFT, position })) } })); break;
    }
  }

  const page = [run("Page "), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 22 }), run(" / ", { size: 22 }),
    new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 22 })];
  const h = note.header;
  const headerParas = [
    P([run(h.lines[0])]),
    P([run(h.lines[1], { size: 22 })]),
    P([run(h.lines[2], { size: 22 }), ...(h.firstPageDifferent ? [] : [run("\tUnit: " + h.unit, { bold: true, size: 22 })])], { extra: { tabStops: [{ type: TabStopType.LEFT, position: 4000 }] } }),
    P([run(h.lines[3], { size: 22 }), run("\t"), ...page], { after: 240, extra: { tabStops: [{ type: TabStopType.LEFT, position: 6300 }] } }),
  ];
  const headers = h.firstPageDifferent
    ? { first: new Header({ children: [P(page, { extra: { alignment: AlignmentType.RIGHT } })] }), default: new Header({ children: headerParas }) }
    : { default: new Header({ children: headerParas }) };
  const footers = note.footer ? { default: new Footer({ children: [P([run(note.footer, { size: 22 })], { extra: { alignment: AlignmentType.CENTER } })] }) } : undefined;

  const doc = new Document({
    numbering: { config: [{ reference: "dash", levels: [{ level: 0, format: D.LevelFormat.BULLET, text: "-", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 1080, hanging: 360 } }, run: { font: FONT, size: 24 } } }] }] },
    sections: [{
    properties: { titlePage: !!h.firstPageDifferent, page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
    headers, footers, children: out,
  }] });
  return Packer.toBlob ? Packer.toBlob(doc) : Packer.toBuffer(doc);
}
