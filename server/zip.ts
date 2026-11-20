import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { SLOT_DEFINITIONS, type ReportDTO } from '../src/shared/constants.ts';
import { db, UPLOADS_DIR } from './db.ts';
import { generateSlotReportPdfBuffer, generateSummaryPdfBuffer } from './pdf.ts';
import { getCampNightById, getReportDTO } from './queries.ts';

export interface ZipExportFailure {
  slotNumber?: number;
  fileName: string;
  message: string;
}

export async function generateBulkZipArchive(
  campNightId: number,
  selectedSlots?: number[]
): Promise<{
  filename: string;
  buffer: Buffer;
  includedSlots: number[];
  fileCount: number;
}> {
  const campNight = getCampNightById(campNightId);
  if (!campNight) {
    throw new Error('Malam perkhemahan tidak ditemui.');
  }

  const submittedRows = db
    .prepare(
      `SELECT slot_number
       FROM reports
       WHERE camp_night_id = ? AND status = 'submitted'
       ORDER BY slot_number ASC`
    )
    .all(campNightId) as Array<{ slot_number: number }>;

  const submittedSlotNumbers = submittedRows.map((r) => r.slot_number);

  const targetSlots =
    selectedSlots && selectedSlots.length > 0
      ? [...new Set(selectedSlots)]
          .filter((n) => submittedSlotNumbers.includes(n))
          .sort((a, b) => a - b)
      : submittedSlotNumbers;

  if (targetSlots.length === 0) {
    throw new Error('Tiada laporan berstatus "Telah dihantar" yang dipilih untuk dimuat turun.');
  }

  const zip = new JSZip();
  const reports: ReportDTO[] = [];

  for (const slotNum of targetSlots) {
    const report = getReportDTO(campNightId, slotNum);
    if (report.status !== 'submitted' || !report.id) {
      const err: ZipExportFailure = {
        slotNumber: slotNum,
        fileName: `Laporan_Slot_${String(slotNum).padStart(2, '0')}.pdf`,
        message: `Laporan Slot ${slotNum} belum dihantar.`,
      };
      throw Object.assign(new Error(err.message), { detail: err });
    }
    reports.push(report);
  }

  // 1. Generate Ringkasan_Laporan.pdf
  let summaryBuffer: Buffer;
  try {
    summaryBuffer = await generateSummaryPdfBuffer(campNight, reports);
  } catch (e) {
    const err: ZipExportFailure = {
      fileName: 'Ringkasan_Laporan.pdf',
      message: `Gagal menjana Ringkasan_Laporan.pdf: ${(e as Error).message}`,
    };
    throw Object.assign(new Error(err.message), { detail: err });
  }
  zip.file('Ringkasan_Laporan.pdf', summaryBuffer);
  let fileCount = 1;

  // 2. Generate per-slot folders and embed PDF + 2 images
  for (const report of reports) {
    const def = SLOT_DEFINITIONS.find((d) => d.slotNumber === report.slotNumber)!;
    const slotPad = String(report.slotNumber).padStart(2, '0');
    const folderName = `Slot_${slotPad}_${def.zipSuffix}`;
    const pdfName = `Laporan_Slot_${slotPad}.pdf`;

    let slotPdfBuffer: Buffer;
    try {
      slotPdfBuffer = await generateSlotReportPdfBuffer(report);
    } catch (e) {
      const err: ZipExportFailure = {
        slotNumber: report.slotNumber,
        fileName: `${folderName}/${pdfName}`,
        message: `Gagal menjana PDF bagi Slot ${report.slotNumber} (${pdfName}): ${(e as Error).message}`,
      };
      throw Object.assign(new Error(err.message), { detail: err });
    }

    const folder = zip.folder(folderName)!;
    folder.file(pdfName, slotPdfBuffer);
    fileCount++;

    const photoRows = db
      .prepare(
        `SELECT photo_index, file_name, ext
         FROM report_photos
         WHERE report_id = ?
         ORDER BY photo_index ASC`
      )
      .all(report.id!) as Array<{
      photo_index: 1 | 2;
      file_name: string;
      ext: string;
    }>;

    for (const idx of [1, 2] as const) {
      const photo = photoRows.find((p) => p.photo_index === idx);
      const expectedImgName = `Gambar_0${idx}.${photo?.ext || 'jpg'}`;
      if (!photo) {
        const err: ZipExportFailure = {
          slotNumber: report.slotNumber,
          fileName: `${folderName}/${expectedImgName}`,
          message: `Gambar ${idx} bagi Slot ${report.slotNumber} tiada dalam pangkalan data.`,
        };
        throw Object.assign(new Error(err.message), { detail: err });
      }

      const fullPath = path.join(UPLOADS_DIR, photo.file_name);
      if (!fs.existsSync(fullPath)) {
        const err: ZipExportFailure = {
          slotNumber: report.slotNumber,
          fileName: `${folderName}/${expectedImgName}`,
          message: `Fail Gambar ${idx} bagi Slot ${report.slotNumber} (${expectedImgName}) gagal diperoleh daripada storan.`,
        };
        throw Object.assign(new Error(err.message), { detail: err });
      }

      const imgBuf = fs.readFileSync(fullPath);
      if (imgBuf.length === 0) {
        const err: ZipExportFailure = {
          slotNumber: report.slotNumber,
          fileName: `${folderName}/${expectedImgName}`,
          message: `Fail Gambar ${idx} bagi Slot ${report.slotNumber} (${expectedImgName}) kosong atau rosak.`,
        };
        throw Object.assign(new Error(err.message), { detail: err });
      }

      folder.file(`Gambar_0${idx}.${photo.ext}`, imgBuf);
      fileCount++;
    }
  }

  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const filename = `Sentri_Malam_SK_Tudan_2026_${campNight.startDate}.zip`;

  return {
    filename,
    buffer: zipBuffer,
    includedSlots: targetSlots,
    fileCount,
  };
}
