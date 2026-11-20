import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import {
  HANDOVER_STATUS_OPTIONS,
  MONITORING_QUESTIONS,
  type AttendanceEntry,
  type HandoverStatus,
  type IncidentEntry,
} from '../../src/shared/constants.ts';
import {
  extractReportInfoFromImageBuffer,
  generatePhotoObservationFromBuffer,
} from '../ai.ts';
import { authenticateOptional, requireAuth, requireTeacher } from '../auth.ts';
import { db, UPLOADS_DIR } from '../db.ts';
import { generateSlotReportPdfBuffer } from '../pdf.ts';
import { getCampNightById, getReportDTO } from '../queries.ts';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

function handleMulterSingle(fieldName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    upload.single(fieldName)(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({
            error: 'Saiz fail gambar terlalu besar (melebihi had 25 MB). Sila pilih gambar yang lebih kecil.',
          });
          return;
        }
        res.status(400).json({
          error: `Ralat muat naik fail gambar (${err.code}). Sila cuba semula.`,
        });
        return;
      }
      res.status(400).json({
        error: `Muat naik fail gagal: ${(err as Error).message || 'Format permintaan tidak sah.'}`,
      });
    });
  };
}

function verifySlotLeader(
  teacherId: number,
  campNightId: number
):
  | { ok: true; slotNumber: number }
  | { ok: false; status: number; error: string; registeredSlotNumber?: number; leaderName?: string | null } {
  const reg = db
    .prepare(
      'SELECT slot_number FROM slot_registrations WHERE camp_night_id = ? AND teacher_id = ?'
    )
    .get(campNightId, teacherId) as { slot_number: number } | undefined;

  if (!reg) {
    return {
      ok: false,
      status: 403,
      error: 'Anda belum berdaftar dalam mana-mana slot untuk malam perkhemahan ini.',
    };
  }

  const slot = db
    .prepare(
      `SELECT s.slot_number, s.leader_teacher_id, u.name AS leader_name
       FROM slots s
       LEFT JOIN users u ON u.id = s.leader_teacher_id
       WHERE s.camp_night_id = ? AND s.slot_number = ?`
    )
    .get(campNightId, reg.slot_number) as
    | { slot_number: number; leader_teacher_id: number | null; leader_name: string | null }
    | undefined;

  if (!slot || slot.leader_teacher_id !== teacherId) {
    return {
      ok: false,
      status: 403,
      registeredSlotNumber: reg.slot_number,
      leaderName: slot?.leader_name ?? null,
      error: slot?.leader_name
        ? `Anda berdaftar sebagai Petugas dalam Slot ${reg.slot_number}. Hanya Ketua Slot yang dilantik (${slot.leader_name}) dibenarkan mengisi dan menghantar laporan.`
        : `Anda berdaftar dalam Slot ${reg.slot_number}, tetapi Ketua Slot belum ditetapkan oleh Penyelaras.`,
    };
  }

  return { ok: true, slotNumber: slot.slot_number };
}

function ensureDraftReportRow(campNightId: number, slotNumber: number): {
  id: number;
  status: 'draft' | 'submitted';
} {
  const existing = db
    .prepare('SELECT id, status FROM reports WHERE camp_night_id = ? AND slot_number = ?')
    .get(campNightId, slotNumber) as { id: number; status: 'draft' | 'submitted' } | undefined;

  if (existing) return existing;

  const now = new Date().toISOString();
  const res = db
    .prepare(
      `INSERT INTO reports (camp_night_id, slot_number, status, updated_at)
       VALUES (?, ?, 'draft', ?)`
    )
    .run(campNightId, slotNumber, now);
  return { id: Number(res.lastInsertRowid), status: 'draft' };
}

router.get('/my-report', authenticateOptional, requireTeacher, (req, res) => {
  const campNightIdParam = req.query.campNightId ? Number(req.query.campNightId) : undefined;
  const campNight = getCampNightById(campNightIdParam);
  if (!campNight) {
    res.status(404).json({ error: 'Malam perkhemahan tidak ditemui.' });
    return;
  }

  const check = verifySlotLeader(req.user!.id, campNight.id);
  if (!check.ok) {
    res.status(check.status).json({
      error: check.error,
      registeredSlotNumber: check.registeredSlotNumber ?? null,
      leaderName: check.leaderName ?? null,
    });
    return;
  }

  const report = getReportDTO(campNight.id, check.slotNumber);
  res.json({ report });
});

router.put('/my-report/draft', authenticateOptional, requireTeacher, (req, res) => {
  const body = req.body as {
    campNightId?: number;
    attendance?: AttendanceEntry[];
    extraOfficers?: string;
    q1?: string | null;
    q2?: string | null;
    q3?: string | null;
    q4?: string | null;
    q5?: string | null;
    q6?: string | null;
    hasIncident?: 'Ya' | 'Tidak' | null;
    incidents?: IncidentEntry[];
    handoverStatus?: HandoverStatus | null;
    handoverReceiver?: string;
    handoverTime?: string;
    handoverNote?: string;
    photoMeta?: {
      1?: { takenTime?: string; location?: string; caption?: string };
      2?: { takenTime?: string; location?: string; caption?: string };
    };
  };

  const campNight = getCampNightById(body.campNightId);
  if (!campNight) {
    res.status(404).json({ error: 'Malam perkhemahan tidak ditemui.' });
    return;
  }

  const check = verifySlotLeader(req.user!.id, campNight.id);
  if (!check.ok) {
    res.status(check.status).json({ error: check.error });
    return;
  }

  const row = ensureDraftReportRow(campNight.id, check.slotNumber);
  if (row.status === 'submitted') {
    res.status(409).json({
      error: 'Laporan ini telah dihantar. Sila minta Penyelaras membuka semula laporan sekiranya perlu membuat pembetulan.',
    });
    return;
  }

  const now = new Date().toISOString();
  const attendanceJson = JSON.stringify(Array.isArray(body.attendance) ? body.attendance : []);
  const incidentsJson = JSON.stringify(Array.isArray(body.incidents) ? body.incidents : []);

  db.prepare(
    `UPDATE reports
     SET attendance_json = ?,
         extra_officers = ?,
         q1 = ?,
         q2 = ?,
         q3 = ?,
         q4 = ?,
         q5 = ?,
         q6 = ?,
         has_incident = ?,
         incidents_json = ?,
         handover_status = ?,
         handover_receiver = ?,
         handover_time = ?,
         handover_note = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(
    attendanceJson,
    (body.extraOfficers ?? '').toString(),
    body.q1 ?? null,
    body.q2 ?? null,
    body.q3 ?? null,
    body.q4 ?? null,
    body.q5 ?? null,
    body.q6 ?? null,
    body.hasIncident ?? null,
    incidentsJson,
    body.handoverStatus ?? null,
    (body.handoverReceiver ?? '').toString(),
    (body.handoverTime ?? '').toString(),
    (body.handoverNote ?? '').toString(),
    now,
    row.id
  );

  if (body.photoMeta) {
    for (const idx of [1, 2] as const) {
      const meta = body.photoMeta[idx];
      if (meta) {
        db.prepare(
          `UPDATE report_photos
           SET taken_time = ?, location = ?, caption = ?
           WHERE report_id = ? AND photo_index = ?`
        ).run(
          (meta.takenTime ?? '').toString(),
          (meta.location ?? '').toString(),
          (meta.caption ?? '').toString(),
          row.id,
          idx
        );
      }
    }
  }

  const updatedReport = getReportDTO(campNight.id, check.slotNumber);
  res.json({ message: 'Draf laporan berjaya disimpan.', report: updatedReport });
});

router.post(
  '/my-report/photos',
  authenticateOptional,
  requireTeacher,
  handleMulterSingle('photo'),
  async (req, res) => {
    const campNightId = req.body.campNightId ? Number(req.body.campNightId) : undefined;
    const photoIndex = Number(req.body.photoIndex) as 1 | 2;

    if (photoIndex !== 1 && photoIndex !== 2) {
      res.status(400).json({ error: 'Indeks gambar mestilah 1 atau 2.' });
      return;
    }

    const campNight = getCampNightById(campNightId);
    if (!campNight) {
      res.status(404).json({ error: 'Malam perkhemahan tidak ditemui.' });
      return;
    }

    const check = verifySlotLeader(req.user!.id, campNight.id);
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }

    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      res.status(400).json({ error: 'Sila pilih fail gambar untuk dimuat naik.' });
      return;
    }

    const reportRow = ensureDraftReportRow(campNight.id, check.slotNumber);
    if (reportRow.status === 'submitted') {
      res.status(409).json({
        error: 'Laporan telah dihantar dan gambar tidak boleh diubah kecuali dibuka semula oleh Penyelaras.',
      });
      return;
    }

    try {
      const image = sharp(req.file.buffer, { failOn: 'none' });
      const metadata = await image.metadata();
      const format = metadata.format;

      if (
        !format ||
        !['jpeg', 'png', 'webp', 'heif', 'gif', 'tiff'].includes(format)
      ) {
        res.status(400).json({
          error:
            'Format gambar tidak disokong. Sila pilih fail gambar JPEG, PNG atau WEBP.',
        });
        return;
      }

      // Verify full image decode + compute raw perceptual pixel hash to detect duplicate files
      let pixelBuffer: Buffer;
      let normalizedOutput: { data: Buffer; info: { width: number; height: number } };
      let targetExt: 'jpg' | 'png';
      let targetMime: 'image/jpeg' | 'image/png';

      try {
        if (format === 'png') {
          targetExt = 'png';
          targetMime = 'image/png';
          normalizedOutput = await sharp(req.file.buffer, { failOn: 'none' })
            .rotate()
            .png()
            .toBuffer({ resolveWithObject: true });
        } else {
          targetExt = 'jpg';
          targetMime = 'image/jpeg';
          normalizedOutput = await sharp(req.file.buffer, { failOn: 'none' })
            .rotate()
            .flatten({ background: '#ffffff' })
            .jpeg({ quality: 92 })
            .toBuffer({ resolveWithObject: true });
        }

        pixelBuffer = await sharp(normalizedOutput.data)
          .resize(128, 128, { fit: 'fill' })
          .removeAlpha()
          .raw()
          .toBuffer();
      } catch {
        res.status(400).json({
          error:
            format === 'heif'
              ? 'Fail HEIC gagal diproses. Sila pilih gambar dalam format JPEG atau PNG.'
              : 'Fail gambar tidak dapat dibuka atau telah rosak. Sila pilih fail JPEG atau PNG yang sah.',
        });
        return;
      }

      const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
      const pixelHash = crypto.createHash('sha256').update(pixelBuffer).digest('hex');

      // Detect duplicate against the other photo slot even if filename differs
      const otherIndex = photoIndex === 1 ? 2 : 1;
      const otherPhoto = db
        .prepare(
          'SELECT file_hash, pixel_hash FROM report_photos WHERE report_id = ? AND photo_index = ?'
        )
        .get(reportRow.id, otherIndex) as
        | { file_hash: string; pixel_hash: string }
        | undefined;

      if (otherPhoto && (otherPhoto.file_hash === fileHash || otherPhoto.pixel_hash === pixelHash)) {
        res.status(400).json({
          error: `Gambar ${photoIndex} tidak boleh sama dengan Gambar ${otherIndex} walaupun nama fail berbeza. Sila muat naik dua gambar yang berlainan.`,
        });
        return;
      }

      const existingSame = db
        .prepare(
          'SELECT id, file_name, taken_time, location, caption FROM report_photos WHERE report_id = ? AND photo_index = ?'
        )
        .get(reportRow.id, photoIndex) as
        | {
            id: number;
            file_name: string;
            taken_time: string;
            location: string;
            caption: string;
          }
        | undefined;

      // Save original buffer if already upright JPEG/PNG, or normalized upright buffer if converted/rotated
      const needsRotationOrConvert =
        (format !== 'jpeg' && format !== 'png') ||
        (metadata.orientation !== undefined && metadata.orientation > 1);
      const finalBuffer = needsRotationOrConvert ? normalizedOutput.data : req.file.buffer;
      const finalWidth = normalizedOutput.info.width;
      const finalHeight = normalizedOutput.info.height;

      const storedFileName = `slot_${check.slotNumber}_p${photoIndex}_${crypto.randomUUID()}.${targetExt}`;
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      fs.writeFileSync(path.join(UPLOADS_DIR, storedFileName), finalBuffer);

      const takenTime = (req.body.takenTime ?? existingSame?.taken_time ?? '').toString();
      const location = (req.body.location ?? existingSame?.location ?? '').toString();
      const caption = (req.body.caption ?? existingSame?.caption ?? '').toString();
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO report_photos
          (report_id, photo_index, file_name, original_name, mime_type, ext, file_hash, pixel_hash,
           width, height, size_bytes, taken_time, location, caption, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(report_id, photo_index) DO UPDATE SET
           file_name = excluded.file_name,
           original_name = excluded.original_name,
           mime_type = excluded.mime_type,
           ext = excluded.ext,
           file_hash = excluded.file_hash,
           pixel_hash = excluded.pixel_hash,
           width = excluded.width,
           height = excluded.height,
           size_bytes = excluded.size_bytes,
           taken_time = excluded.taken_time,
           location = excluded.location,
           caption = excluded.caption,
           uploaded_at = excluded.uploaded_at`
      ).run(
        reportRow.id,
        photoIndex,
        storedFileName,
        req.file.originalname || storedFileName,
        targetMime,
        targetExt,
        fileHash,
        pixelHash,
        finalWidth,
        finalHeight,
        finalBuffer.length,
        takenTime,
        location,
        caption,
        now
      );

      db.prepare('UPDATE reports SET updated_at = ? WHERE id = ?').run(now, reportRow.id);

      if (existingSame?.file_name && existingSame.file_name !== storedFileName) {
        const oldPath = path.join(UPLOADS_DIR, existingSame.file_name);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }

      const updatedReport = getReportDTO(campNight.id, check.slotNumber);
      res.status(201).json({
        message: `Gambar ${photoIndex} berjaya dimuat naik.`,
        photo: updatedReport.photos[photoIndex],
        report: updatedReport,
      });
    } catch (err) {
      res.status(400).json({
        error: `Fail gambar gagal diproses: ${(err as Error).message}`,
      });
    }
  }
);

router.post(
  '/my-report/photos/:photoId/generate-observation',
  authenticateOptional,
  requireTeacher,
  async (req, res) => {
    const photoId = Number(req.params.photoId);
    if (!Number.isInteger(photoId)) {
      res.status(400).json({ error: 'ID gambar tidak sah.' });
      return;
    }

    const row = db
      .prepare(
        `SELECT p.id, p.photo_index, p.file_name, p.location, p.caption,
                r.id AS report_id, r.camp_night_id, r.slot_number, r.status,
                s.leader_teacher_id, s.display_time
         FROM report_photos p
         JOIN reports r ON r.id = p.report_id
         JOIN slots s ON s.camp_night_id = r.camp_night_id AND s.slot_number = r.slot_number
         WHERE p.id = ?`
      )
      .get(photoId) as
      | {
          id: number;
          photo_index: 1 | 2;
          file_name: string;
          location: string;
          caption: string;
          report_id: number;
          camp_night_id: number;
          slot_number: number;
          status: 'draft' | 'submitted';
          leader_teacher_id: number | null;
          display_time: string;
        }
      | undefined;

    if (!row) {
      res.status(404).json({ error: 'Gambar tidak ditemui.' });
      return;
    }

    if (row.leader_teacher_id !== req.user!.id) {
      res.status(403).json({
        error: 'Hanya Ketua Slot yang dilantik boleh menjana pemerhatian bagi gambar ini.',
      });
      return;
    }

    if (row.status === 'submitted') {
      res.status(409).json({
        error: 'Laporan telah dihantar dan kapsyen tidak boleh diubah.',
      });
      return;
    }

    const filePath = path.join(UPLOADS_DIR, row.file_name);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Fail gambar tidak ditemui dalam storan pelayan.' });
      return;
    }

    try {
      const fileBuffer = fs.readFileSync(filePath);
      const generated = await generatePhotoObservationFromBuffer(
        fileBuffer,
        row.slot_number,
        row.display_time
      );

      const now = new Date().toISOString();
      const nextLocation = row.location.trim()
        ? row.location
        : generated.suggestedLocation;

      db.prepare(
        `UPDATE report_photos
         SET caption = ?, location = ?
         WHERE id = ?`
      ).run(generated.caption, nextLocation, row.id);

      db.prepare('UPDATE reports SET updated_at = ? WHERE id = ?').run(
        now,
        row.report_id
      );

      const updatedReport = getReportDTO(row.camp_night_id, row.slot_number);
      res.json({
        caption: generated.caption,
        suggestedLocation: generated.suggestedLocation,
        report: updatedReport,
      });
    } catch (err) {
      res.status(502).json({
        error: `Gagal menjana pemerhatian ringkas daripada gambar: ${(err as Error).message}`,
      });
    }
  }
);

router.post(
  '/my-report/extract-from-image',
  authenticateOptional,
  requireTeacher,
  handleMulterSingle('image'),
  async (req, res) => {
    const campNightId = req.body.campNightId ? Number(req.body.campNightId) : undefined;
    const campNight = getCampNightById(campNightId);
    if (!campNight) {
      res.status(404).json({ error: 'Malam perkhemahan tidak ditemui.' });
      return;
    }

    const check = verifySlotLeader(req.user!.id, campNight.id);
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }

    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      res.status(400).json({ error: 'Sila pilih fail gambar untuk dijana.' });
      return;
    }

    try {
      const meta = await sharp(req.file.buffer, { failOn: 'none' }).metadata();
      if (
        !meta.format ||
        !['jpeg', 'png', 'heif', 'webp', 'gif', 'tiff'].includes(meta.format)
      ) {
        res.status(400).json({
          error: 'Format gambar tidak disokong. Sila pilih fail JPEG, PNG atau WEBP.',
        });
        return;
      }
    } catch {
      res.status(400).json({
        error: 'Fail gambar tidak dapat dibaca atau telah rosak.',
      });
      return;
    }

    const slot = db
      .prepare('SELECT display_time FROM slots WHERE camp_night_id = ? AND slot_number = ?')
      .get(campNight.id, check.slotNumber) as { display_time: string } | undefined;

    try {
      const extracted = await extractReportInfoFromImageBuffer(
        req.file.buffer,
        check.slotNumber,
        slot?.display_time || ''
      );
      res.json({
        message: 'Maklumat berjaya dijana daripada gambar.',
        extracted,
      });
    } catch (err) {
      res.status(502).json({
        error: `Gagal menjana maklumat daripada gambar: ${(err as Error).message}`,
      });
    }
  }
);

router.post('/my-report/submit', authenticateOptional, requireTeacher, (req, res) => {
  const body = req.body as {
    campNightId?: number;
    attendance?: AttendanceEntry[];
    extraOfficers?: string;
    q1?: string;
    q2?: string;
    q3?: string;
    q4?: string;
    q5?: string;
    q6?: string;
    hasIncident?: 'Ya' | 'Tidak';
    incidents?: IncidentEntry[];
    handoverStatus?: HandoverStatus;
    handoverReceiver?: string;
    handoverTime?: string;
    handoverNote?: string;
    photoMeta?: {
      1?: { takenTime?: string; location?: string; caption?: string };
      2?: { takenTime?: string; location?: string; caption?: string };
    };
  };

  const campNight = getCampNightById(body.campNightId);
  if (!campNight) {
    res.status(404).json({ error: 'Malam perkhemahan tidak ditemui.' });
    return;
  }

  const check = verifySlotLeader(req.user!.id, campNight.id);
  if (!check.ok) {
    res.status(check.status).json({ error: check.error });
    return;
  }

  const attendance = Array.isArray(body.attendance) ? body.attendance : [];
  if (!attendance.some((a) => a.present)) {
    res.status(400).json({
      error: 'Sila tandakan sekurang-kurangnya seorang guru yang benar-benar hadir dalam Bahagian A.',
    });
    return;
  }

  for (const q of MONITORING_QUESTIONS) {
    const val = body[q.key];
    if (!val || !q.options.includes(val)) {
      res.status(400).json({
        error: `Soalan ${q.number} dalam Bahagian B wajib dijawab.`,
      });
      return;
    }
  }

  if (body.hasIncident !== 'Ya' && body.hasIncident !== 'Tidak') {
    res.status(400).json({
      error: 'Sila nyatakan sama ada terdapat kejadian atau perkara yang memerlukan tindakan susulan.',
    });
    return;
  }

  const incidents = Array.isArray(body.incidents) ? body.incidents : [];
  if (body.hasIncident === 'Ya') {
    if (incidents.length === 0) {
      res.status(400).json({
        error: 'Sila lengkapkan sekurang-kurangnya satu catatan kejadian.',
      });
      return;
    }
    for (let i = 0; i < incidents.length; i++) {
      const inc = incidents[i];
      if (
        !inc.time?.trim() ||
        !inc.location?.trim() ||
        !inc.description?.trim() ||
        !inc.actionTaken?.trim() ||
        !inc.notifiedParty?.trim() ||
        !inc.followUpAction?.trim()
      ) {
        res.status(400).json({
          error: `Sila lengkapkan semua ruang pada Catatan Kejadian ${i + 1}.`,
        });
        return;
      }
    }
  }

  if (
    !body.handoverStatus ||
    !HANDOVER_STATUS_OPTIONS.includes(body.handoverStatus)
  ) {
    res.status(400).json({ error: 'Sila pilih status serahan tugas dalam Bahagian C.' });
    return;
  }

  if (body.handoverStatus === 'Belum selesai.') {
    if (!body.handoverNote?.trim()) {
      res.status(400).json({
        error: 'Sila masukkan catatan ringkas bagi status serahan "Belum selesai.".',
      });
      return;
    }
  } else {
    if (!body.handoverReceiver?.trim() || !body.handoverTime?.trim()) {
      res.status(400).json({
        error: 'Sila lengkapkan nama penerima dan masa serahan dalam Bahagian C.',
      });
      return;
    }
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db
      .prepare('SELECT id, status, submitted_at FROM reports WHERE camp_night_id = ? AND slot_number = ?')
      .get(campNight.id, check.slotNumber) as
      | { id: number; status: 'draft' | 'submitted'; submitted_at: string | null }
      | undefined;

    if (!existing) {
      db.exec('ROLLBACK');
      res.status(400).json({
        error: 'Sila muat naik Gambar 1 dan Gambar 2 sebelum menghantar laporan.',
      });
      return;
    }

    if (existing.status === 'submitted') {
      db.exec('COMMIT');
      const alreadyReport = getReportDTO(campNight.id, check.slotNumber);
      res.json({
        message: `Laporan Slot ${check.slotNumber} telah pun dihantar.`,
        report: alreadyReport,
      });
      return;
    }

    if (body.photoMeta) {
      for (const idx of [1, 2] as const) {
        const meta = body.photoMeta[idx];
        if (meta) {
          db.prepare(
            `UPDATE report_photos
             SET taken_time = ?, location = ?, caption = ?
             WHERE report_id = ? AND photo_index = ?`
          ).run(
            (meta.takenTime ?? '').toString(),
            (meta.location ?? '').toString(),
            (meta.caption ?? '').toString(),
            existing.id,
            idx
          );
        }
      }
    }

    const photos = db
      .prepare(
        `SELECT photo_index, file_name, file_hash, pixel_hash, taken_time, location, caption
         FROM report_photos
         WHERE report_id = ?
         ORDER BY photo_index ASC`
      )
      .all(existing.id) as Array<{
      photo_index: 1 | 2;
      file_name: string;
      file_hash: string;
      pixel_hash: string;
      taken_time: string;
      location: string;
      caption: string;
    }>;

    const p1 = photos.find((p) => p.photo_index === 1);
    const p2 = photos.find((p) => p.photo_index === 2);

    if (!p1 || !p2) {
      db.exec('ROLLBACK');
      res.status(400).json({
        error: 'Kedua-dua gambar wajib (Gambar 1 dan Gambar 2) mesti dimuat naik sebelum menghantar laporan.',
      });
      return;
    }

    if (p1.file_hash === p2.file_hash || p1.pixel_hash === p2.pixel_hash) {
      db.exec('ROLLBACK');
      res.status(400).json({
        error: 'Gambar 1 dan Gambar 2 adalah salinan yang sama. Sila ganti salah satu gambar sebelum menghantar laporan.',
      });
      return;
    }

    for (const p of [p1, p2]) {
      if (!fs.existsSync(path.join(UPLOADS_DIR, p.file_name))) {
        db.exec('ROLLBACK');
        res.status(400).json({
          error: `Fail Gambar ${p.photo_index} tidak ditemui dalam storan. Sila muat naik semula.`,
        });
        return;
      }
      if (!p.taken_time.trim() || !p.location.trim() || !p.caption.trim()) {
        db.exec('ROLLBACK');
        res.status(400).json({
          error: `Sila lengkapkan masa gambar diambil, lokasi dan kapsyen ringkas bagi Gambar ${p.photo_index}.`,
        });
        return;
      }
    }

    const now = new Date().toISOString();
    const submittedAt = existing.submitted_at || now;

    db.prepare(
      `UPDATE reports
       SET status = 'submitted',
           attendance_json = ?,
           extra_officers = ?,
           q1 = ?,
           q2 = ?,
           q3 = ?,
           q4 = ?,
           q5 = ?,
           q6 = ?,
           has_incident = ?,
           incidents_json = ?,
           handover_status = ?,
           handover_receiver = ?,
           handover_time = ?,
           handover_note = ?,
           submitted_by_teacher_id = ?,
           submitted_by_name = ?,
           submitted_at = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(
      JSON.stringify(attendance),
      (body.extraOfficers ?? '').toString(),
      body.q1!,
      body.q2!,
      body.q3!,
      body.q4!,
      body.q5!,
      body.q6!,
      body.hasIncident!,
      JSON.stringify(body.hasIncident === 'Ya' ? incidents : []),
      body.handoverStatus!,
      body.handoverStatus === 'Belum selesai.' ? '' : (body.handoverReceiver ?? '').trim(),
      body.handoverStatus === 'Belum selesai.' ? '' : (body.handoverTime ?? '').trim(),
      body.handoverStatus === 'Belum selesai.' ? (body.handoverNote ?? '').trim() : '',
      req.user!.id,
      req.user!.name,
      submittedAt,
      now,
      existing.id
    );

    db.exec('COMMIT');

    const finalReport = getReportDTO(campNight.id, check.slotNumber);
    res.json({
      message: `Laporan Slot ${check.slotNumber} berjaya dihantar`,
      report: finalReport,
    });
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    res.status(500).json({
      error: `Gagal menghantar laporan: ${(err as Error).message}`,
    });
  }
});

router.get('/uploads/:photoId', authenticateOptional, requireAuth, (req, res) => {
  const photoId = Number(req.params.photoId);
  if (!Number.isInteger(photoId)) {
    res.status(400).json({ error: 'ID gambar tidak sah.' });
    return;
  }

  const row = db
    .prepare(
      `SELECT p.file_name, p.mime_type, r.camp_night_id, r.slot_number, r.submitted_by_teacher_id,
              s.leader_teacher_id
       FROM report_photos p
       JOIN reports r ON r.id = p.report_id
       JOIN slots s ON s.camp_night_id = r.camp_night_id AND s.slot_number = r.slot_number
       WHERE p.id = ?`
    )
    .get(photoId) as
    | {
        file_name: string;
        mime_type: string;
        camp_night_id: number;
        slot_number: number;
        submitted_by_teacher_id: number | null;
        leader_teacher_id: number | null;
      }
    | undefined;

  if (!row) {
    res.status(404).json({ error: 'Gambar tidak ditemui.' });
    return;
  }

  const isCoordinator = req.user!.role === 'coordinator';
  const isSlotLeader = row.leader_teacher_id === req.user!.id;
  const isSubmitter = row.submitted_by_teacher_id === req.user!.id;

  if (!isCoordinator && !isSlotLeader && !isSubmitter) {
    res.status(403).json({
      error: 'Akses ditolak. Anda tidak mempunyai kebenaran untuk melihat gambar ini.',
    });
    return;
  }

  const filePath = path.join(UPLOADS_DIR, row.file_name);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Fail gambar tiada dalam storan pelayan.' });
    return;
  }

  res.setHeader('Content-Type', row.mime_type);
  res.setHeader('Cache-Control', 'private, no-store');
  fs.createReadStream(filePath).pipe(res);
});

router.get('/reports/:reportId/pdf', authenticateOptional, requireAuth, async (req, res) => {
  const reportId = Number(req.params.reportId);
  if (!Number.isInteger(reportId)) {
    res.status(400).json({ error: 'ID laporan tidak sah.' });
    return;
  }

  const row = db
    .prepare(
      `SELECT r.camp_night_id, r.slot_number, r.status, r.submitted_by_teacher_id, s.leader_teacher_id
       FROM reports r
       JOIN slots s ON s.camp_night_id = r.camp_night_id AND s.slot_number = r.slot_number
       WHERE r.id = ?`
    )
    .get(reportId) as
    | {
        camp_night_id: number;
        slot_number: number;
        status: 'draft' | 'submitted';
        submitted_by_teacher_id: number | null;
        leader_teacher_id: number | null;
      }
    | undefined;

  if (!row) {
    res.status(404).json({ error: 'Laporan tidak ditemui.' });
    return;
  }

  const isCoordinator = req.user!.role === 'coordinator';
  const isSlotLeader = row.leader_teacher_id === req.user!.id;
  const isSubmitter = row.submitted_by_teacher_id === req.user!.id;

  if (!isCoordinator && !isSlotLeader && !isSubmitter) {
    res.status(403).json({
      error: 'Akses ditolak. Anda tidak mempunyai kebenaran untuk memuat turun laporan ini.',
    });
    return;
  }

  const allowDraft = req.query.allowDraft === '1' || req.query.allowDraft === 'true';

  if (row.status !== 'submitted' && !allowDraft) {
    res.status(400).json({
      error: 'Hanya laporan yang telah dihantar boleh dimuat turun sebagai PDF rasmi.',
    });
    return;
  }

  try {
    const report = getReportDTO(row.camp_night_id, row.slot_number);
    const pdfBuffer = await generateSlotReportPdfBuffer(report);
    const slotPad = String(report.slotNumber).padStart(2, '0');
    const filename =
      row.status === 'submitted'
        ? `Laporan_Slot_${slotPad}.pdf`
        : `Draf_Laporan_Slot_${slotPad}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({
      error: `Gagal menjana PDF laporan: ${(err as Error).message}`,
    });
  }
});

export default router;
