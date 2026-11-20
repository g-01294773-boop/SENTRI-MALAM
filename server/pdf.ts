import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import {
  MONITORING_QUESTIONS,
  type CampNightDTO,
  type ReportDTO,
} from '../src/shared/constants.ts';
import { formatDateDisplayMY } from '../src/shared/dates.ts';
import { db, UPLOADS_DIR } from './db.ts';

const FONT_REGULAR = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf';
const FONT_BOLD = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf';
const FONT_ITALIC = '/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf';

interface PdfFonts {
  regular: string;
  bold: string;
  italic: string;
}

interface PreparedPdfImage {
  photoIndex: 1 | 2;
  buffer: Buffer;
  width: number;
  height: number;
  takenTime: string;
  location: string;
  caption: string;
}

function registerFonts(doc: PDFKit.PDFDocument): PdfFonts {
  if (fs.existsSync(FONT_REGULAR) && fs.existsSync(FONT_BOLD)) {
    doc.registerFont('Arial', FONT_REGULAR);
    doc.registerFont('Arial-Bold', FONT_BOLD);
    if (fs.existsSync(FONT_ITALIC)) {
      doc.registerFont('Arial-Italic', FONT_ITALIC);
    }
    return {
      regular: 'Arial',
      bold: 'Arial-Bold',
      italic: fs.existsSync(FONT_ITALIC) ? 'Arial-Italic' : 'Arial',
    };
  }
  return {
    regular: 'Helvetica',
    bold: 'Helvetica-Bold',
    italic: 'Helvetica-Oblique',
  };
}

function ensureSpace(doc: PDFKit.PDFDocument, neededHeight: number): void {
  const bottomLimit = doc.page.height - doc.page.margins.bottom - 24;
  if (doc.y + neededHeight > bottomLimit) {
    doc.addPage();
  }
}

async function loadPreparedImagesForReport(
  report: ReportDTO
): Promise<PreparedPdfImage[]> {
  const photoRecords = report.id
    ? (db
        .prepare(
          `SELECT id, photo_index, file_name, taken_time, location, caption
           FROM report_photos
           WHERE report_id = ?
           ORDER BY photo_index ASC`
        )
        .all(report.id) as Array<{
        id: number;
        photo_index: 1 | 2;
        file_name: string;
        taken_time: string;
        location: string;
        caption: string;
      }>)
    : [];

  const prepared: PreparedPdfImage[] = [];
  for (const p of photoRecords) {
    const filePath = path.join(UPLOADS_DIR, p.file_name);
    if (!fs.existsSync(filePath)) {
      throw new Error(
        `Fail gambar ${p.photo_index} bagi Slot ${report.slotNumber} (${p.file_name}) tidak ditemui dalam storan.`
      );
    }
    const rawBuffer = fs.readFileSync(filePath);
    // Flatten alpha & convert to baseline sRGB JPEG for universal PDFKit embedding
    const normalized = await sharp(rawBuffer)
      .rotate()
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 90 })
      .toBuffer({ resolveWithObject: true });

    prepared.push({
      photoIndex: p.photo_index,
      buffer: normalized.data,
      width: normalized.info.width,
      height: normalized.info.height,
      takenTime: p.taken_time,
      location: p.location,
      caption: p.caption,
    });
  }
  return prepared;
}

function drawSectionHeader(
  doc: PDFKit.PDFDocument,
  fonts: PdfFonts,
  title: string,
  contentWidth: number
): void {
  ensureSpace(doc, 46);
  const startX = doc.page.margins.left;
  const startY = doc.y;

  doc
    .save()
    .rect(startX, startY, contentWidth, 24)
    .fillAndStroke('#F1F5F9', '#CBD5E1')
    .restore();

  doc
    .font(fonts.bold)
    .fontSize(11)
    .fillColor('#000000')
    .text(title, startX + 10, startY + 6, {
      width: contentWidth - 20,
      lineGap: 2,
    });

  doc.x = startX;
  doc.y = startY + 32;
}

function renderSlotReportIntoDoc(
  doc: PDFKit.PDFDocument,
  fonts: PdfFonts,
  report: ReportDTO,
  preparedImages: PreparedPdfImage[]
): void {
  const left = doc.page.margins.left;
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const LINE_GAP = 5;

  // Title Header Block
  const headerY = doc.y;
  doc
    .save()
    .rect(left, headerY, contentWidth, 56)
    .fillAndStroke('#F8FAFC', '#0F172A')
    .restore();

  doc
    .font(fonts.bold)
    .fontSize(14)
    .fillColor('#000000')
    .text(`Laporan Pemantauan Sentri Malam — Slot ${report.slotNumber}`, left + 12, headerY + 10, {
      width: contentWidth - 24,
    });

  doc
    .font(fonts.bold)
    .fontSize(11)
    .fillColor('#1E293B')
    .text('Perkhemahan Bersepadu Badan Beruniform SK Tudan 2026', left + 12, headerY + 31, {
      width: contentWidth - 24,
    });

  doc.x = left;
  doc.y = headerY + 68;

  // BAHAGIAN A — MAKLUMAT BERTUGAS
  drawSectionHeader(doc, fonts, 'BAHAGIAN A — MAKLUMAT BERTUGAS', contentWidth);

  const dateSpan =
    report.startDate === report.endDate
      ? report.startDateDisplay
      : `${report.startDateDisplay} hingga ${report.endDateDisplay}`;

  const metaRows: Array<[string, string]> = [
    ['Nombor Slot', `Slot ${report.slotNumber}`],
    [
      'Malam Perkhemahan',
      `${report.campNightTitle} (Mula: ${formatDateDisplayMY(report.campStartDate)})`,
    ],
    ['Tarikh Tugas Sebenar', dateSpan],
    ['Waktu Bertugas', `${report.displayTime} (${report.durationMinutes} minit)`],
    ['Ketua Slot', report.submittedByName || report.leaderName || 'Belum ditetapkan'],
  ];

  if (report.submittedAtDisplay) {
    metaRows.push(['Tarikh & Masa Penghantaran', report.submittedAtDisplay]);
  }
  if (report.updatedAtDisplay && report.reopenedAt) {
    metaRows.push(['Masa Kemas Kini Terakhir', report.updatedAtDisplay]);
  }

  const labelColW = 175;
  const valColW = contentWidth - labelColW;

  for (let i = 0; i < metaRows.length; i++) {
    const [k, v] = metaRows[i];
    doc.font(fonts.regular).fontSize(11);
    const valH = doc.heightOfString(v, { width: valColW - 16, lineGap: LINE_GAP });
    const rowH = Math.max(24, valH + 10);
    ensureSpace(doc, rowH);

    const rowY = doc.y;
    doc
      .save()
      .rect(left, rowY, labelColW, rowH)
      .fillAndStroke('#F8FAFC', '#CBD5E1')
      .rect(left + labelColW, rowY, valColW, rowH)
      .fillAndStroke('#FFFFFF', '#CBD5E1')
      .restore();

    doc
      .font(fonts.bold)
      .fontSize(11)
      .fillColor('#000000')
      .text(k, left + 8, rowY + 6, { width: labelColW - 14 });

    doc
      .font(fonts.regular)
      .fontSize(11)
      .fillColor('#000000')
      .text(v, left + labelColW + 8, rowY + 6, {
        width: valColW - 16,
        lineGap: LINE_GAP,
      });

    doc.x = left;
    doc.y = rowY + rowH;
  }

  doc.moveDown(0.5);

  // Registered vs Actual Attendance Table
  const halfW = contentWidth / 2;
  const regLines =
    report.registeredMembers.length > 0
      ? report.registeredMembers.map(
          (m) => `• ${m.name}${m.isLeader ? ' (Ketua Slot)' : ' (Petugas)'}`
        )
      : ['Tiada guru berdaftar.'];

  const attLines =
    report.attendance.length > 0
      ? report.attendance.map(
          (a) => `• ${a.name} — ${a.present ? 'Hadir' : 'Tidak hadir'}`
        )
      : ['Tiada rekod kehadiran.'];

  const regText = regLines.join('\n');
  const attText = attLines.join('\n');
  doc.font(fonts.regular).fontSize(11);
  const regH = doc.heightOfString(regText, { width: halfW - 16, lineGap: LINE_GAP });
  const attH = doc.heightOfString(attText, { width: halfW - 16, lineGap: LINE_GAP });
  const listRowH = Math.max(32, Math.max(regH, attH) + 14);

  // Keep table header and body together on the same page
  ensureSpace(doc, 22 + listRowH);
  const regHeaderY = doc.y;
  doc
    .save()
    .rect(left, regHeaderY, halfW, 22)
    .fillAndStroke('#F1F5F9', '#CBD5E1')
    .rect(left + halfW, regHeaderY, halfW, 22)
    .fillAndStroke('#F1F5F9', '#CBD5E1')
    .restore();

  doc
    .font(fonts.bold)
    .fontSize(11)
    .fillColor('#000000')
    .text('Senarai Guru Berdaftar', left + 8, regHeaderY + 5, { width: halfW - 16 })
    .text('Kehadiran Sebenar', left + halfW + 8, regHeaderY + 5, { width: halfW - 16 });

  const actualListY = regHeaderY + 22;

  doc
    .save()
    .rect(left, actualListY, halfW, listRowH)
    .stroke('#CBD5E1')
    .rect(left + halfW, actualListY, halfW, listRowH)
    .stroke('#CBD5E1')
    .restore();

  doc
    .font(fonts.regular)
    .fontSize(11)
    .fillColor('#000000')
    .text(regText, left + 8, actualListY + 7, { width: halfW - 16, lineGap: LINE_GAP })
    .text(attText, left + halfW + 8, actualListY + 7, {
      width: halfW - 16,
      lineGap: LINE_GAP,
    });

  doc.x = left;
  doc.y = actualListY + listRowH + 6;

  // Extra officers row
  const extraText = report.extraOfficers.trim() || 'Tiada';
  doc.font(fonts.regular).fontSize(11);
  const extraH = Math.max(
    24,
    doc.heightOfString(extraText, { width: valColW - 16, lineGap: LINE_GAP }) + 10
  );
  ensureSpace(doc, extraH);
  const extraY = doc.y;
  doc
    .save()
    .rect(left, extraY, labelColW, extraH)
    .fillAndStroke('#F8FAFC', '#CBD5E1')
    .rect(left + labelColW, extraY, valColW, extraH)
    .fillAndStroke('#FFFFFF', '#CBD5E1')
    .restore();
  doc
    .font(fonts.bold)
    .fontSize(11)
    .fillColor('#000000')
    .text('Petugas Tambahan / Pengganti', left + 8, extraY + 6, {
      width: labelColW - 14,
    });
  doc
    .font(fonts.regular)
    .fontSize(11)
    .text(extraText, left + labelColW + 8, extraY + 6, {
      width: valColW - 16,
      lineGap: LINE_GAP,
    });

  doc.x = left;
  doc.y = extraY + extraH + 14;

  // BAHAGIAN B — DAPATAN PEMANTAUAN (Structured Table)
  drawSectionHeader(doc, fonts, 'BAHAGIAN B — DAPATAN PEMANTAUAN', contentWidth);

  const qColW = contentWidth * 0.58;
  const aColW = contentWidth - qColW;

  ensureSpace(doc, 26);
  const bHeadY = doc.y;
  doc
    .save()
    .rect(left, bHeadY, qColW, 22)
    .fillAndStroke('#E2E8F0', '#94A3B8')
    .rect(left + qColW, bHeadY, aColW, 22)
    .fillAndStroke('#E2E8F0', '#94A3B8')
    .restore();

  doc
    .font(fonts.bold)
    .fontSize(11)
    .fillColor('#000000')
    .text('Perkara Pemantauan', left + 8, bHeadY + 5, { width: qColW - 16 })
    .text('Dapatan / Jawapan', left + qColW + 8, bHeadY + 5, { width: aColW - 16 });

  doc.y = bHeadY + 22;

  for (let i = 0; i < MONITORING_QUESTIONS.length; i++) {
    const q = MONITORING_QUESTIONS[i];
    const ans = report[q.key] || 'Tidak dijawab';

    doc.font(fonts.regular).fontSize(11);
    const qH = doc.heightOfString(q.prompt, { width: qColW - 16, lineGap: LINE_GAP });
    doc.font(fonts.bold).fontSize(11);
    const aH = doc.heightOfString(ans, { width: aColW - 16, lineGap: LINE_GAP });
    const rowH = Math.max(28, Math.max(qH, aH) + 12);

    ensureSpace(doc, rowH);
    const rY = doc.y;
    const bg = i % 2 === 0 ? '#FFFFFF' : '#F8FAFC';

    doc
      .save()
      .rect(left, rY, qColW, rowH)
      .fillAndStroke(bg, '#CBD5E1')
      .rect(left + qColW, rY, aColW, rowH)
      .fillAndStroke(bg, '#CBD5E1')
      .restore();

    doc
      .font(fonts.regular)
      .fontSize(11)
      .fillColor('#000000')
      .text(q.prompt, left + 8, rY + 6, { width: qColW - 16, lineGap: LINE_GAP });

    doc
      .font(fonts.bold)
      .fontSize(11)
      .fillColor('#000000')
      .text(ans, left + qColW + 8, rY + 6, { width: aColW - 16, lineGap: LINE_GAP });

    doc.x = left;
    doc.y = rY + rowH;
  }

  doc.y += 14;

  // BAHAGIAN C — CATATAN KEJADIAN DAN SERAHAN TUGAS
  drawSectionHeader(
    doc,
    fonts,
    'BAHAGIAN C — CATATAN KEJADIAN DAN SERAHAN TUGAS',
    contentWidth
  );

  const incidentAnswer = report.hasIncident || '-';
  const cRows: Array<[string, string]> = [
    ['Kejadian Memerlukan Tindakan Susulan?', incidentAnswer],
  ];

  cRows.push(['Status Serahan Tugas', report.handoverStatus || '-']);
  if (report.handoverStatus === 'Belum selesai.') {
    cRows.push(['Catatan Ringkas Serahan', report.handoverNote || '-']);
  } else if (report.handoverStatus) {
    const receiverLabel =
      report.slotNumber === 6
        ? 'Penyelaras Penerima Laporan Akhir'
        : 'Penerima Daripada Slot Berikutnya';
    cRows.push([receiverLabel, report.handoverReceiver || '-']);
    cRows.push(['Masa Serahan', report.handoverTime || '-']);
  }

  for (const [k, v] of cRows) {
    doc.font(fonts.regular).fontSize(11);
    const kH = doc.heightOfString(k, { width: labelColW - 14, lineGap: LINE_GAP });
    const vH = doc.heightOfString(v, { width: valColW - 16, lineGap: LINE_GAP });
    const rowH = Math.max(26, Math.max(kH, vH) + 10);
    ensureSpace(doc, rowH);
    const rY = doc.y;

    doc
      .save()
      .rect(left, rY, labelColW, rowH)
      .fillAndStroke('#F8FAFC', '#CBD5E1')
      .rect(left + labelColW, rY, valColW, rowH)
      .fillAndStroke('#FFFFFF', '#CBD5E1')
      .restore();

    doc
      .font(fonts.bold)
      .fontSize(11)
      .fillColor('#000000')
      .text(k, left + 8, rY + 6, { width: labelColW - 14, lineGap: LINE_GAP });

    doc
      .font(fonts.regular)
      .fontSize(11)
      .fillColor('#000000')
      .text(v, left + labelColW + 8, rY + 6, {
        width: valColW - 16,
        lineGap: LINE_GAP,
      });

    doc.x = left;
    doc.y = rY + rowH;
  }

  if (report.hasIncident === 'Ya' && report.incidents.length > 0) {
    doc.y += 8;
    report.incidents.forEach((inc, idx) => {
      const lines = [
        `Masa: ${inc.time || '-'}   |   Lokasi: ${inc.location || '-'}`,
        `Perkara yang berlaku: ${inc.description || '-'}`,
        `Tindakan yang telah diambil: ${inc.actionTaken || '-'}`,
        `Pihak yang dimaklumkan: ${inc.notifiedParty || '-'}`,
        `Tindakan lanjut yang diperlukan: ${inc.followUpAction || '-'}`,
      ];
      const textBlock = lines.join('\n');
      doc.font(fonts.regular).fontSize(11);
      const bodyH = doc.heightOfString(textBlock, {
        width: contentWidth - 20,
        lineGap: LINE_GAP,
      });
      const boxH = bodyH + 34;

      ensureSpace(doc, boxH);
      const bY = doc.y;
      doc
        .save()
        .rect(left, bY, contentWidth, boxH)
        .fillAndStroke('#FFFBEB', '#F59E0B')
        .restore();

      doc
        .font(fonts.bold)
        .fontSize(11)
        .fillColor('#000000')
        .text(`Catatan Kejadian ${idx + 1}`, left + 10, bY + 7, {
          width: contentWidth - 20,
        });

      doc
        .font(fonts.regular)
        .fontSize(11)
        .fillColor('#000000')
        .text(textBlock, left + 10, bY + 24, {
          width: contentWidth - 20,
          lineGap: LINE_GAP,
        });

      doc.x = left;
      doc.y = bY + boxH + 8;
    });
  }

  doc.y += 14;

  // BAHAGIAN D — DUA GAMBAR WAJIB
  drawSectionHeader(doc, fonts, 'BAHAGIAN D — DUA GAMBAR WAJIB', contentWidth);

  if (preparedImages.length === 0) {
    ensureSpace(doc, 28);
    doc.font(fonts.regular).fontSize(11).fillColor('#000000').text('Tiada gambar dilampirkan.', {
      lineGap: LINE_GAP,
    });
    return;
  }

  for (const img of preparedImages) {
    const innerPad = 12;
    const maxImgWidth = contentWidth - innerPad * 2;
    const maxImgHeight = 235;
    const scale = Math.min(maxImgWidth / img.width, maxImgHeight / img.height, 1);
    const renderWidth = Math.round(img.width * scale);
    const renderHeight = Math.round(img.height * scale);

    const metaText = `Masa Diambil: ${img.takenTime || '-'}   |   Lokasi: ${img.location || '-'}`;
    const captionText = `Pemerhatian Ringkas / Kapsyen: ${img.caption || '-'}`;

    doc.font(fonts.regular).fontSize(11);
    const metaH = doc.heightOfString(metaText, {
      width: contentWidth - innerPad * 2,
      lineGap: LINE_GAP,
    });
    const capH = doc.heightOfString(captionText, {
      width: contentWidth - innerPad * 2,
      lineGap: LINE_GAP,
    });

    const headerBarH = 22;
    const cardHeight = headerBarH + 12 + renderHeight + 10 + metaH + capH + 16;

    // Guarantee image + metadata + caption remain framed together on the same page
    ensureSpace(doc, cardHeight);

    const cardY = doc.y;
    doc
      .save()
      .rect(left, cardY, contentWidth, cardHeight)
      .fillAndStroke('#FFFFFF', '#94A3B8')
      .rect(left, cardY, contentWidth, headerBarH)
      .fillAndStroke('#F1F5F9', '#94A3B8')
      .restore();

    doc
      .font(fonts.bold)
      .fontSize(11)
      .fillColor('#000000')
      .text(`Gambar ${img.photoIndex}`, left + 10, cardY + 5, {
        width: contentWidth - 20,
      });

    const imgX = left + (contentWidth - renderWidth) / 2;
    const imgY = cardY + headerBarH + 10;
    doc.image(img.buffer, imgX, imgY, {
      width: renderWidth,
      height: renderHeight,
    });

    const textY = imgY + renderHeight + 10;
    doc
      .font(fonts.regular)
      .fontSize(11)
      .fillColor('#000000')
      .text(metaText, left + innerPad, textY, {
        width: contentWidth - innerPad * 2,
        lineGap: LINE_GAP,
      });

    doc
      .font(fonts.bold)
      .fontSize(11)
      .fillColor('#000000')
      .text(captionText, left + innerPad, doc.y + 2, {
        width: contentWidth - innerPad * 2,
        lineGap: LINE_GAP,
      });

    doc.x = left;
    doc.y = cardY + cardHeight + 14;
  }
}

function addPageFooters(doc: PDFKit.PDFDocument, fonts: PdfFonts, footerPrefix: string): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const footerY = doc.page.height - doc.page.margins.bottom + 8;
    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc
      .font(fonts.regular)
      .fontSize(9)
      .fillColor('#64748B')
      .text(
        `${footerPrefix}   |   Muka surat ${i - range.start + 1} daripada ${range.count}`,
        left,
        footerY,
        { width, align: 'center', lineBreak: false }
      );
  }
}

export async function generateSlotReportPdfBuffer(report: ReportDTO): Promise<Buffer> {
  const preparedImages = await loadPreparedImagesForReport(report);

  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'portrait',
      margins: { top: 44, bottom: 52, left: 48, right: 48 },
      bufferPages: true,
      info: {
        Title: `Laporan Pemantauan Sentri Malam — Slot ${report.slotNumber}`,
        Author: 'SK Tudan 2026',
        Subject: 'Perkhemahan Bersepadu Badan Beruniform SK Tudan 2026',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    const fonts = registerFonts(doc);
    renderSlotReportIntoDoc(doc, fonts, report, preparedImages);
    addPageFooters(
      doc,
      fonts,
      `Perkhemahan Bersepadu Badan Beruniform SK Tudan 2026 — Slot ${report.slotNumber}`
    );

    doc.end();
  });
}

function renderSummarySectionIntoDoc(
  doc: PDFKit.PDFDocument,
  fonts: PdfFonts,
  campNight: CampNightDTO,
  reports: ReportDTO[]
): void {
  const left = doc.page.margins.left;
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const LINE_GAP = 5;

  const headerY = doc.y;
  doc
    .save()
    .rect(left, headerY, contentWidth, 56)
    .fillAndStroke('#F8FAFC', '#0F172A')
    .restore();

  doc
    .font(fonts.bold)
    .fontSize(14)
    .fillColor('#000000')
    .text('Ringkasan Laporan Pemantauan Sentri Malam', left + 12, headerY + 10, {
      width: contentWidth - 24,
    });
  doc
    .font(fonts.bold)
    .fontSize(11)
    .fillColor('#1E293B')
    .text('Perkhemahan Bersepadu Badan Beruniform SK Tudan 2026', left + 12, headerY + 31, {
      width: contentWidth - 24,
    });

  doc.x = left;
  doc.y = headerY + 68;

  const slotNumbersList = reports.map((r) => `Slot ${r.slotNumber}`).join(', ');
  doc
    .font(fonts.bold)
    .fontSize(11)
    .fillColor('#000000')
    .text('Malam Perkhemahan: ', { continued: true, lineGap: LINE_GAP })
    .font(fonts.regular)
    .text(`${campNight.title} (Tarikh Mula: ${campNight.startDateDisplay})`, {
      lineGap: LINE_GAP,
    });

  doc
    .font(fonts.bold)
    .fontSize(11)
    .text('Slot Disertakan: ', { continued: true, lineGap: LINE_GAP })
    .font(fonts.regular)
    .text(`${slotNumbersList} (Jumlah: ${reports.length} laporan)`, {
      lineGap: LINE_GAP,
    });

  doc.moveDown(0.7);

  for (const r of reports) {
    const dateSpan =
      r.startDate === r.endDate
        ? r.startDateDisplay
        : `${r.startDateDisplay} hingga ${r.endDateDisplay}`;

    const followUpNotes: string[] = [];
    if (r.hasIncident === 'Ya' && r.incidents.length > 0) {
      r.incidents.forEach((inc, idx) => {
        followUpNotes.push(
          `Kejadian ${idx + 1} (${inc.time || '-'}, ${inc.location || '-'}): ${
            inc.description || '-'
          } | Tindakan lanjut: ${inc.followUpAction || '-'}`
        );
      });
    }
    if (r.handoverStatus === 'Belum selesai.' && r.handoverNote.trim()) {
      followUpNotes.push(`Serahan belum selesai: ${r.handoverNote.trim()}`);
    }
    if (
      r.q6 === 'Sebahagian masih memerlukan tindakan' ||
      r.q6 === 'Semua masih memerlukan tindakan'
    ) {
      followUpNotes.push(`Permintaan bantuan peserta: ${r.q6}`);
    }

    const bodyLines = [
      `Tarikh & Waktu Bertugas: ${dateSpan} (${r.displayTime})`,
      `Ketua Slot: ${r.submittedByName || r.leaderName || '-'}`,
      `Masa Penghantaran: ${r.submittedAtDisplay || '-'}`,
      `Status Serahan: ${r.handoverStatus || '-'}`,
      `Perkara Tindakan Lanjut: ${
        followUpNotes.length === 0
          ? 'Tiada perkara yang memerlukan tindakan lanjut.'
          : '\n• ' + followUpNotes.join('\n• ')
      }`,
    ].join('\n');

    doc.font(fonts.regular).fontSize(11);
    const bodyH = doc.heightOfString(bodyLines, {
      width: contentWidth - 20,
      lineGap: LINE_GAP,
    });
    const cardH = bodyH + 36;

    ensureSpace(doc, cardH);
    const cY = doc.y;
    doc
      .save()
      .rect(left, cY, contentWidth, cardH)
      .fillAndStroke('#FFFFFF', '#CBD5E1')
      .rect(left, cY, contentWidth, 22)
      .fillAndStroke('#F1F5F9', '#CBD5E1')
      .restore();

    doc
      .font(fonts.bold)
      .fontSize(11)
      .fillColor('#000000')
      .text(`Slot ${r.slotNumber} — ${r.displayTime}`, left + 10, cY + 5, {
        width: contentWidth - 20,
      });

    doc
      .font(fonts.regular)
      .fontSize(11)
      .fillColor('#000000')
      .text(bodyLines, left + 10, cY + 28, {
        width: contentWidth - 20,
        lineGap: LINE_GAP,
      });

    doc.x = left;
    doc.y = cY + cardH + 10;
  }
}

export async function generateSummaryPdfBuffer(
  campNight: CampNightDTO,
  reports: ReportDTO[]
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'portrait',
      margins: { top: 44, bottom: 52, left: 48, right: 48 },
      bufferPages: true,
      info: {
        Title: `Ringkasan Laporan Sentri Malam — ${campNight.startDate}`,
        Author: 'SK Tudan 2026',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    const fonts = registerFonts(doc);
    renderSummarySectionIntoDoc(doc, fonts, campNight, reports);
    addPageFooters(
      doc,
      fonts,
      'Perkhemahan Bersepadu Badan Beruniform SK Tudan 2026 — Ringkasan Laporan'
    );

    doc.end();
  });
}

export async function generateBulkPdfBuffer(
  campNight: CampNightDTO,
  reports: ReportDTO[]
): Promise<Buffer> {
  const imagesBySlot = new Map<number, PreparedPdfImage[]>();
  for (const r of reports) {
    imagesBySlot.set(r.slotNumber, await loadPreparedImagesForReport(r));
  }

  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'portrait',
      margins: { top: 44, bottom: 52, left: 48, right: 48 },
      bufferPages: true,
      info: {
        Title: `Laporan Pukal Sentri Malam SK Tudan 2026 (${campNight.startDate})`,
        Author: 'SK Tudan 2026',
        Subject: 'Perkhemahan Bersepadu Badan Beruniform SK Tudan 2026',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    const fonts = registerFonts(doc);

    // Page 1: Executive Summary
    renderSummarySectionIntoDoc(doc, fonts, campNight, reports);

    // Each Slot Report starts neatly on its own page
    for (const r of reports) {
      doc.addPage();
      renderSlotReportIntoDoc(doc, fonts, r, imagesBySlot.get(r.slotNumber) ?? []);
    }

    addPageFooters(
      doc,
      fonts,
      `Perkhemahan Bersepadu Badan Beruniform SK Tudan 2026 (${campNight.startDateDisplay})`
    );

    doc.end();
  });
}
