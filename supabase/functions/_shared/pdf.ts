// ═══════════════════════════════════════════════════════════════
//  Shared PDF helpers — pdf-lib
// ═══════════════════════════════════════════════════════════════
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "pdf-lib";

export type PdfSection = { heading: string; lines: string[] };

export type PdfTable = {
  heading?: string;
  columns: Array<{ label: string; width: number; align?: "left" | "right" | "center" }>;
  rows: string[][];
  footer?: string[];
};

export type PdfReportInput = {
  title: string;
  subtitle?: string;
  sections?: PdfSection[];
  tables?: PdfTable[];
  landscape?: boolean;
};

const MARGIN = 40;
const LINE_H = 13;

export async function generatePdf(input: PdfReportInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(input.title);
  doc.setProducer("Lumied");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = input.landscape ? 842 : 595;
  const PAGE_H = input.landscape ? 595 : 842;
  const MAX_W = PAGE_W - MARGIN * 2;

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const newPage = () => { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; };
  const ensure = (needed: number) => { if (y - needed < MARGIN + 20) newPage(); };

  const wrap = (text: string, f: PDFFont, size: number, maxWidth = MAX_W): string[] => {
    const words = String(text ?? "").split(/\s+/);
    const out: string[] = []; let cur = "";
    for (const w of words) {
      const test = cur ? cur + " " + w : w;
      if (f.widthOfTextAtSize(test, size) > maxWidth) {
        if (cur) out.push(cur);
        cur = w;
      } else cur = test;
    }
    if (cur) out.push(cur);
    return out.length ? out : [""];
  };

  // Header
  page.drawText(input.title, { x: MARGIN, y, size: 16, font: bold, color: rgb(0.1, 0.2, 0.5) });
  y -= 22;
  if (input.subtitle) {
    for (const ln of wrap(input.subtitle, font, 10)) {
      page.drawText(ln, { x: MARGIN, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
      y -= LINE_H;
    }
  }
  page.drawLine({ start: { x: MARGIN, y: y - 4 }, end: { x: PAGE_W - MARGIN, y: y - 4 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  y -= 16;

  // Sections
  for (const sec of input.sections ?? []) {
    ensure(LINE_H * 2);
    page.drawText(sec.heading, { x: MARGIN, y, size: 12, font: bold });
    y -= LINE_H + 4;
    for (const raw of sec.lines) {
      for (const ln of wrap(raw, font, 10)) {
        ensure(LINE_H);
        page.drawText(ln, { x: MARGIN, y, size: 10, font });
        y -= LINE_H;
      }
    }
    y -= 8;
  }

  // Tables
  for (const t of input.tables ?? []) {
    ensure(LINE_H * 3);
    if (t.heading) {
      page.drawText(t.heading, { x: MARGIN, y, size: 12, font: bold });
      y -= LINE_H + 4;
    }
    const drawRow = (cells: string[], f: PDFFont, size: number, fill?: [number, number, number]) => {
      // Pre-compute wrapped lines for all cells to determine row height
      const cellLines: string[][] = t.columns.map((col, i) => {
        const cell = String(cells[i] ?? "");
        return wrap(cell, f, size, col.width - 8);
      });
      const maxLines = Math.max(...cellLines.map(l => l.length));
      const rowH = maxLines * (LINE_H) + 4;
      ensure(rowH);
      if (fill) {
        page.drawRectangle({
          x: MARGIN, y: y - rowH + LINE_H + 1, width: MAX_W, height: rowH,
          color: rgb(fill[0], fill[1], fill[2]),
        });
      }
      let x = MARGIN + 4;
      for (let i = 0; i < t.columns.length; i++) {
        const col = t.columns[i];
        const lines = cellLines[i];
        for (let li = 0; li < lines.length; li++) {
          const line = lines[li];
          const lineY = y - li * LINE_H;
          let drawX = x;
          if (col.align === "right") drawX = x + col.width - 8 - f.widthOfTextAtSize(line, size);
          else if (col.align === "center") drawX = x + (col.width - f.widthOfTextAtSize(line, size)) / 2;
          page.drawText(line, { x: drawX, y: lineY + 1, size, font: f });
        }
        x += col.width;
      }
      y -= rowH;
    };
    drawRow(t.columns.map(c => c.label), bold, 9, [0.92, 0.94, 0.98]);
    for (const row of t.rows) drawRow(row, font, 9);
    if (t.footer) drawRow(t.footer, bold, 9, [0.97, 0.97, 0.97]);
    y -= 10;
  }

  // Footer per page
  const pages = doc.getPages();
  const stamp = `Gerado em ${new Date().toLocaleString("pt-BR")} — Lumied`;
  pages.forEach((p, i) => {
    p.drawText(`${stamp}  ·  Página ${i + 1}/${pages.length}`, {
      x: MARGIN, y: 20, size: 8, font, color: rgb(0.5, 0.5, 0.5),
    });
  });

  return await doc.save();
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export function pdfResponse(bytes: Uint8Array, filename: string): Response {
  return new Response(bytes as BlobPart as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}

// ═══════════════════════════════════════════════════════════════
//  Simple XLSX generator (no external deps)
// ═══════════════════════════════════════════════════════════════

function escXml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function colLetter(i: number): string {
  let s = "";
  i++;
  while (i > 0) { i--; s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26); }
  return s;
}

export function generateXlsx(headers: string[], rows: string[][]): Uint8Array {
  const sheetRows: string[] = [];
  const writeRow = (cells: string[], row: number, bold: boolean) => {
    const cs = cells.map((c, ci) => {
      const ref = colLetter(ci) + row;
      const v = escXml(c);
      const s = bold ? ' s="1"' : "";
      if (/^-?\d+(\.\d+)?$/.test(c.replace(/[R$\s]/g, "").replace(",", "."))) {
        const num = c.replace(/[R$\s]/g, "").replace(",", ".");
        return `<c r="${ref}"${s}><v>${num}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"${s}><is><t>${v}</t></is></c>`;
    });
    sheetRows.push(`<row r="${row}">${cs.join("")}</row>`);
  };

  writeRow(headers, 1, true);
  rows.forEach((r, i) => writeRow(r, i + 2, false));

  const lastCol = colLetter(headers.length - 1);
  const lastRow = rows.length + 1;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows.join("")}</sheetData></worksheet>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
</styleSheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Relatório" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  // Build ZIP manually (store-only, no compression — simple & reliable)
  const enc = new TextEncoder();
  const files: Array<{ path: string; data: Uint8Array }> = [
    { path: "[Content_Types].xml", data: enc.encode(contentTypes) },
    { path: "_rels/.rels", data: enc.encode(rels) },
    { path: "xl/workbook.xml", data: enc.encode(workbook) },
    { path: "xl/_rels/workbook.xml.rels", data: enc.encode(wbRels) },
    { path: "xl/styles.xml", data: enc.encode(styles) },
    { path: "xl/worksheets/sheet1.xml", data: enc.encode(sheet) },
  ];

  return buildZip(files);
}

function buildZip(files: Array<{ path: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.path);
    const crc = crc32(f.data);
    // Local file header
    const lh = new Uint8Array(30 + name.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); // sig
    lv.setUint16(4, 20, true); // version
    lv.setUint16(8, 0, true); // method: store
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true); // compressed
    lv.setUint32(22, f.data.length, true); // uncompressed
    lv.setUint16(26, name.length, true);
    lh.set(name, 30);

    // Central directory
    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    ch.set(name, 46);

    parts.push(lh, f.data);
    central.push(ch);
    offset += lh.length + f.data.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const c of central) cdSize += c.length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdOffset, true);

  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  for (const c of central) { out.set(c, pos); pos += c.length; }
  out.set(eocd, pos);
  return out;
}

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export function xlsxResponse(bytes: Uint8Array, filename: string): Response {
  return new Response(bytes as BlobPart as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}
