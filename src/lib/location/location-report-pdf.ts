import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { buildFreeReportInterpretedContent } from './free-report-content';
import { buildLocationReportStructureViewModel } from './location-report-structure';
import type { GeneratedLocationReportDocument } from './location-report-engine';

type PdfFonts = {
  regular: string;
  bold: string;
};

function bundledFontPath(fileName: string): string {
  return path.join(process.cwd(), 'node_modules', 'dejavu-fonts-ttf', 'ttf', fileName);
}

function existingFontPath(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolvePdfFonts(): PdfFonts {
  const regular = existingFontPath([
    bundledFontPath('DejaVuSans.ttf'),
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
    'C:\\Windows\\Fonts\\arial.ttf',
  ]);
  const bold = existingFontPath([
    bundledFontPath('DejaVuSans-Bold.ttf'),
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf',
    'C:\\Windows\\Fonts\\arialbd.ttf',
  ]);

  if (!regular || !bold) {
    throw new Error('pdf_font_missing');
  }
  return { regular, bold };
}

function calculatedAtRu(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function ensureSpace(doc: PDFKit.PDFDocument, minHeight = 90): void {
  if (doc.y > doc.page.height - doc.page.margins.bottom - minHeight) {
    doc.addPage();
  }
}

function addHeading(doc: PDFKit.PDFDocument, text: string, fonts: PdfFonts): void {
  ensureSpace(doc, 80);
  doc.moveDown(0.8);
  doc.font(fonts.bold).fontSize(15).fillColor('#0f172a').text(text);
  doc.moveDown(0.25);
}

function addParagraph(doc: PDFKit.PDFDocument, text: string, fonts: PdfFonts): void {
  if (!text) return;
  ensureSpace(doc, 50);
  doc.font(fonts.regular).fontSize(10.5).fillColor('#1e293b').text(text, {
    lineGap: 3,
  });
  doc.moveDown(0.35);
}

function addList(doc: PDFKit.PDFDocument, items: string[], fonts: PdfFonts): void {
  const visibleItems = items.length ? items : ['Нет данных для этого раздела.'];
  for (const item of visibleItems) {
    ensureSpace(doc, 42);
    doc.font(fonts.regular).fontSize(10.5).fillColor('#1e293b').text(`- ${item}`, {
      indent: 10,
      lineGap: 3,
    });
    doc.moveDown(0.2);
  }
}

export async function buildLocationReportPdf(docData: GeneratedLocationReportDocument): Promise<Buffer> {
  const fonts = resolvePdfFonts();
  const structure = docData.reportMode === 'free'
    ? buildLocationReportStructureViewModel('free')
    : buildLocationReportStructureViewModel('paid');
  const freeReport = docData.freeReport;
  const verdictSummary = freeReport?.verdictSummary ?? docData.freeSummary.conclusionRu;
  const score = freeReport?.score ?? docData.freeSummary.publicScore;
  const rawEvidenceBullets = freeReport?.evidenceBullets ?? docData.freeSummary.keyFactorsRu;
  const content = buildFreeReportInterpretedContent({
    evidenceBullets: rawEvidenceBullets,
    score,
  });

  const pdf = new PDFDocument({
    size: 'A4',
    margins: { top: 48, right: 48, bottom: 56, left: 48 },
    info: {
      Title: `${structure.titleRu} - ${docData.inputAddress}`,
      Author: 'ASI',
      Subject: 'Location report',
    },
    bufferPages: true,
  });

  pdf.registerFont('DejaVu', fonts.regular);
  pdf.registerFont('DejaVu-Bold', fonts.bold);

  pdf.font('DejaVu-Bold').fontSize(22).fillColor('#0f172a').text(structure.titleRu, {
    lineGap: 2,
  });
  pdf.moveDown(0.35);
  pdf.font('DejaVu').fontSize(9.5).fillColor('#475569').text(`Номер отчёта: ${docData.reportId}`);
  pdf.text(`Адрес: ${docData.inputAddress}`);
  pdf.text(`Дата расчёта: ${calculatedAtRu(docData.calculatedAt)}`);
  if (docData.dataFreshness?.summaryRu) {
    pdf.moveDown(0.2);
    pdf.text(docData.dataFreshness.summaryRu);
  }

  addHeading(pdf, 'Вывод', fonts);
  addParagraph(pdf, verdictSummary, fonts);
  addParagraph(pdf, content.summaryReasonRu, fonts);
  if (score != null) addParagraph(pdf, `Оценка: ${score} / 100`, fonts);

  addHeading(pdf, 'Сигналы спроса', fonts);
  addList(pdf, content.demandSignalsRu, fonts);

  addHeading(pdf, 'Риски и ограничения', fonts);
  addList(pdf, content.risksAndLimitationsRu, fonts);

  addHeading(pdf, 'Дополнительный потенциал', fonts);
  addParagraph(pdf, content.commercialPreview.leadRu, fonts);
  addList(pdf, content.commercialPreview.itemsRu, fonts);

  addHeading(pdf, 'Что входит в подробный отчёт', fonts);
  addList(pdf, content.paidPreviewItemsRu, fonts);

  addHeading(pdf, content.ctaTitleRu, fonts);
  addParagraph(pdf, content.ctaTextRu, fonts);
  addParagraph(pdf, content.recommendationRu, fonts);

  if (docData.reportMode === 'paid' && docData.paidSections?.length) {
    addHeading(pdf, 'Разделы подробного отчёта', fonts);
    for (const section of docData.paidSections) {
      ensureSpace(pdf, 56);
      pdf.font('DejaVu-Bold').fontSize(11).fillColor('#0f172a').text(section.titleRu);
      addParagraph(pdf, section.summaryRu, fonts);
    }
  }

  const pageRange = pdf.bufferedPageRange();
  for (let i = pageRange.start; i < pageRange.start + pageRange.count; i += 1) {
    pdf.switchToPage(i);
    pdf.font('DejaVu').fontSize(8).fillColor('#64748b').text(
      `ASI · ${docData.reportId} · ${i + 1}/${pageRange.count}`,
      pdf.page.margins.left,
      pdf.page.height - 34,
      { align: 'center', width: pdf.page.width - pdf.page.margins.left - pdf.page.margins.right },
    );
  }

  return collectPdf(pdf);
}
