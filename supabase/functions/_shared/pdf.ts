// ═══════════════════════════════════════════════════════════════
//  Shared PDF helpers — pdf-lib
// ═══════════════════════════════════════════════════════════════
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "https://esm.sh/pdf-lib@1.17.1";

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
};

const MARGIN = 40;
const PAGE_W = 595;
const PAGE_H = 842;
const LINE_H = 13;

export async function generatePdf(input: PdfReportInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(input.title);
  doc.setProducer("Lumied");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
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
      ensure(LINE_H + 4);
      if (fill) {
        page.drawRectangle({
          x: MARGIN, y: y - 3, width: MAX_W, height: LINE_H + 2,
          color: rgb(fill[0], fill[1], fill[2]),
        });
      }
      let x = MARGIN + 4;
      for (let i = 0; i < t.columns.length; i++) {
        const col = t.columns[i];
        const cell = String(cells[i] ?? "");
        const lines = wrap(cell, f, size, col.width - 8);
        const line = lines[0] + (lines.length > 1 ? "…" : "");
        let drawX = x;
        if (col.align === "right") drawX = x + col.width - 8 - f.widthOfTextAtSize(line, size);
        else if (col.align === "center") drawX = x + (col.width - f.widthOfTextAtSize(line, size)) / 2;
        page.drawText(line, { x: drawX, y: y + 1, size, font: f });
        x += col.width;
      }
      y -= LINE_H + 2;
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
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}
