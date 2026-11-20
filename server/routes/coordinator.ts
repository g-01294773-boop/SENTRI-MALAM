import { Router } from 'express';
import { authenticateOptional, requireCoordinator } from '../auth.ts';
import {
  createSlotsForCampNight,
  db,
  decryptAccessCode,
  encryptAccessCode,
  generatePersonalAccessCode,
  hashAccessCode,
} from '../db.ts';
import { generateBulkPdfBuffer } from '../pdf.ts';
import {
  getCampNightById,
  getReportDTO,
  getScheduleForCampNight,
  listCampNights,
} from '../queries.ts';
import { generateBulkZipArchive, type ZipExportFailure } from '../zip.ts';

const router = Router();

router.use(authenticateOptional, requireCoordinator);

router.get('/teachers', (req, res) => {
  const campNightId = req.query.campNightId ? Number(req.query.campNightId) : undefined;
  const campNight = getCampNightById(campNightId);
  if (!campNight) {
    res.status(404).json({ error: 'Malam perkhemahan tidak ditemui.' });
    return;
  }

  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.access_code_enc, u.active, r.slot_number AS registered_slot_number,
              r.is_substitute,
              CASE WHEN s.leader_teacher_id = u.id THEN 1 ELSE 0 END AS is_leader
       FROM users u
       LEFT JOIN slot_registrations r ON r.teacher_id = u.id AND r.camp_night_id = ?
       LEFT JOIN slots s ON s.camp_night_id = ? AND s.slot_number = r.slot_number
       WHERE u.role = 'teacher'
       ORDER BY u.name COLLATE NOCASE ASC`
    )
    .all(campNight.id, campNight.id) as Array<{
    id: number;
    name: string;
    access_code_enc: string | null;
    active: number;
    registered_slot_number: number | null;
    is_substitute: number | null;
    is_leader: number;
  }>;

  const teachers = rows.map((r) => ({
    id: r.id,
    name: r.name,
    accessCode: decryptAccessCode(r.access_code_enc),
    active: r.active === 1,
    registeredSlotNumber: r.registered_slot_number,
    isSubstitute: r.is_substitute === 1,
    isLeader: r.is_leader === 1,
  }));

  res.json({ teachers });
});

router.put('/camp-nights/:id', (req, res) => {
  const campNightId = Number(req.params.id);
  const { startDate, title } = req.body as { startDate?: string; title?: string };

  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    res.status(400).json({ error: 'Format tarikh mula mestilah YYYY-MM-DD.' });
    return;
  }

  const existing = getCampNightById(campNightId);
  if (!existing) {
    res.status(404).json({ error: 'Malam perkhemahan tidak ditemui.' });
    return;
  }

  db.prepare('UPDATE camp_nights SET start_date = ?, title = ? WHERE id = ?').run(
    startDate,
    title?.trim() || existing.title,
    campNightId
  );

  res.json({
    message: 'Tarikh mula malam perkhemahan berjaya dikemas kini.',
    campNights: listCampNights(),
    ...getScheduleForCampNight(campNightId),
  });
});

router.post('/camp-nights', (req, res) => {
  const { startDate, title } = req.body as { startDate?: string; title?: string };
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    res.status(400).json({ error: 'Format tarikh mula mestilah YYYY-MM-DD.' });
    return;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE camp_nights SET is_active = 0').run();
    const resInsert = db
      .prepare(
        `INSERT INTO camp_nights (title, start_date, is_active, created_at)
         VALUES (?, ?, 1, ?)`
      )
      .run(
        title?.trim() || `Malam Perkhemahan (${startDate})`,
        startDate,
        new Date().toISOString()
      );
    const newId = Number(resInsert.lastInsertRowid);
    createSlotsForCampNight(newId);
    db.exec('COMMIT');

    res.status(201).json({
      message: 'Malam perkhemahan baharu berjaya dicipta.',
      campNights: listCampNights(),
      ...getScheduleForCampNight(newId),
    });
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    res.status(500).json({ error: `Gagal mencipta malam perkhemahan: ${(err as Error).message}` });
  }
});

router.post('/teachers', (req, res) => {
  const { name } = req.body as { name?: string };
  const trimmed = (name || '').trim();
  if (!trimmed) {
    res.status(400).json({ error: 'Sila masukkan nama penuh guru.' });
    return;
  }

  const existing = db
    .prepare('SELECT id FROM users WHERE LOWER(name) = LOWER(?)')
    .get(trimmed) as { id: number } | undefined;

  if (existing) {
    res.status(409).json({ error: `Nama "${trimmed}" telah pun wujud dalam senarai guru.` });
    return;
  }

  const personalCode = generatePersonalAccessCode();
  const insertRes = db
    .prepare(
      `INSERT INTO users (name, role, access_code_hash, access_code_enc, active, created_at)
       VALUES (?, 'teacher', ?, ?, 1, ?)`
    )
    .run(trimmed, hashAccessCode(personalCode), encryptAccessCode(personalCode), new Date().toISOString());

  res.status(201).json({
    message: `Guru "${trimmed}" berjaya ditambah.`,
    teacher: {
      id: Number(insertRes.lastInsertRowid),
      name: trimmed,
      accessCode: personalCode,
    },
  });
});

router.patch('/teachers/:id', (req, res) => {
  const teacherId = Number(req.params.id);
  const { name, resetCode } = req.body as { name?: string; resetCode?: boolean };

  const user = db
    .prepare("SELECT id, name FROM users WHERE id = ? AND role = 'teacher'")
    .get(teacherId) as { id: number; name: string } | undefined;

  if (!user) {
    res.status(404).json({ error: 'Guru tidak ditemui.' });
    return;
  }

  if (name !== undefined) {
    const trimmed = name.trim();
    if (!trimmed) {
      res.status(400).json({ error: 'Nama guru tidak boleh kosong.' });
      return;
    }
    const conflict = db
      .prepare('SELECT id FROM users WHERE LOWER(name) = LOWER(?) AND id != ?')
      .get(trimmed, teacherId) as { id: number } | undefined;
    if (conflict) {
      res.status(409).json({ error: `Nama "${trimmed}" telah digunakan oleh guru lain.` });
      return;
    }
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(trimmed, teacherId);
  }

  let newCode: string | undefined;
  if (resetCode) {
    newCode = generatePersonalAccessCode();
    db.prepare('UPDATE users SET access_code_hash = ?, access_code_enc = ? WHERE id = ?').run(
      hashAccessCode(newCode),
      encryptAccessCode(newCode),
      teacherId
    );
  }

  res.json({
    message: resetCode
      ? 'Kod akses peribadi baharu berjaya dijana.'
      : 'Maklumat guru berjaya dikemas kini.',
    accessCode: newCode,
  });
});

router.put('/slots/:slotNumber/quota', (req, res) => {
  const slotNumber = Number(req.params.slotNumber);
  const { campNightId, quota } = req.body as { campNightId?: number; quota?: number };

  const campNight = getCampNightById(campNightId);
  if (!campNight) {
    res.status(404).json({ error: 'Malam perkhemahan tidak ditemui.' });
    return;
  }

  const parsedQuota = Number(quota);
  if (!Number.isInteger(parsedQuota) || parsedQuota < 1) {
    res.status(400).json({ error: 'Kuota mestilah nombor bulat positif.' });
    return;
  }

  const countRow = db
    .prepare(
      'SELECT COUNT(*) AS cnt FROM slot_registrations WHERE camp_night_id = ? AND slot_number = ?'
    )
    .get(campNight.id, slotNumber) as { cnt: number };

  if (parsedQuota < countRow.cnt) {
    res.status(400).json({
      error: `Kuota baharu (${parsedQuota}) mesti sekurang-kurangnya sama dengan bilangan guru yang sudah berdaftar (${countRow.cnt} orang).`,
    });
    return;
  }

  db.prepare(
    'UPDATE slots SET quota = ? WHERE camp_night_id = ? AND slot_number = ?'
  ).run(parsedQuota, campNight.id, slotNumber);

  res.json({
    message: `Kuota Slot ${slotNumber} ditetapkan kepada ${parsedQuota} orang.`,
    ...getScheduleForCampNight(campNight.id),
  });
});

router.put('/slots/:slotNumber/leader', (req, res) => {
  const slotNumber = Number(req.params.slotNumber);
  const { campNightId, leaderTeacherId } = req.body as {
    campNightId?: number;
    leaderTeacherId?: number | null;
  };

  const campNight = getCampNightById(campNightId);
  if (!campNight) {
    res.status(404).json({ error: 'Malam perkhemahan tidak ditemui.' });
    return;
  }

  if (leaderTeacherId === null || leaderTeacherId === undefined) {
    db.prepare(
      'UPDATE slots SET leader_teacher_id = NULL WHERE camp_night_id = ? AND slot_number = ?'
    ).run(campNight.id, slotNumber);
    res.json({
      message: `Pelantikan ketua bagi Slot ${slotNumber} telah dikosongkan.`,
      ...getScheduleForCampNight(campNight.id),
    });
    return;
  }

  const reg = db
    .prepare(
      'SELECT id FROM slot_registrations WHERE camp_night_id = ? AND slot_number = ? AND teacher_id = ?'
    )
    .get(campNight.id, slotNumber, Number(leaderTeacherId)) as { id: number } | undefined;

  if (!reg) {
    res.status(400).json({
      error: 'Ketua Slot hanya boleh dilantik daripada kalangan guru yang berdaftar dalam slot tersebut.',
    });
    return;
  }

  db.prepare(
    'UPDATE slots SET leader_teacher_id = ? WHERE camp_night_id = ? AND slot_number = ?'
  ).run(Number(leaderTeacherId), campNight.id, slotNumber);

  res.json({
    message: `Ketua bagi Slot ${slotNumber} berjaya disahkan.`,
    ...getScheduleForCampNight(campNight.id),
  });
});

router.post('/registrations/assign', (req, res) => {
  const { campNightId, slotNumber, teacherId, isSubstitute } = req.body as {
    campNightId?: number;
    slotNumber?: number;
    teacherId?: number;
    isSubstitute?: boolean;
  };

  const campNight = getCampNightById(campNightId);
  if (!campNight) {
    res.status(404).json({ error: 'Malam perkhemahan tidak ditemui.' });
    return;
  }

  const slotNum = Number(slotNumber);
  const tId = Number(teacherId);
  if (!Number.isInteger(slotNum) || slotNum < 1 || slotNum > 6 || !Number.isInteger(tId)) {
    res.status(400).json({ error: 'Maklumat slot atau guru tidak sah.' });
    return;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db
      .prepare(
        'SELECT slot_number FROM slot_registrations WHERE camp_night_id = ? AND teacher_id = ?'
      )
      .get(campNight.id, tId) as { slot_number: number } | undefined;

    if (existing) {
      db.exec('ROLLBACK');
      res.status(409).json({
        error: `Guru ini sudah berdaftar dalam Slot ${existing.slot_number}. Gunakan fungsi pindah slot sekiranya ingin menukar slot.`,
      });
      return;
    }

    const slot = db
      .prepare('SELECT quota FROM slots WHERE camp_night_id = ? AND slot_number = ?')
      .get(campNight.id, slotNum) as { quota: number | null } | undefined;

    if (!slot || slot.quota === null) {
      db.exec('ROLLBACK');
      res.status(400).json({ error: `Sila tetapkan kuota Slot ${slotNum} terlebih dahulu.` });
      return;
    }

    const cnt = (
      db
        .prepare(
          'SELECT COUNT(*) AS cnt FROM slot_registrations WHERE camp_night_id = ? AND slot_number = ?'
        )
        .get(campNight.id, slotNum) as { cnt: number }
    ).cnt;

    if (cnt >= slot.quota) {
      db.exec('ROLLBACK');
      res.status(409).json({ error: `Slot ${slotNum} sudah penuh.` });
      return;
    }

    db.prepare(
      `INSERT INTO slot_registrations (camp_night_id, slot_number, teacher_id, is_substitute, note, registered_at)
       VALUES (?, ?, ?, ?, '', ?)`
    ).run(campNight.id, slotNum, tId, isSubstitute ? 1 : 0, new Date().toISOString());

    db.exec('COMMIT');
    res.status(201).json({
      message: 'Petugas berjaya didaftarkan ke dalam slot.',
      ...getScheduleForCampNight(campNight.id),
    });
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    res.status(500).json({ error: `Gagal mendaftarkan petugas: ${(err as Error).message}` });
  }
});

router.post('/registrations/move', (req, res) => {
  const { campNightId, teacherId, targetSlotNumber, replacementLeaderTeacherId } = req.body as {
    campNightId?: number;
    teacherId?: number;
    targetSlotNumber?: number;
    replacementLeaderTeacherId?: number | null;
  };

  const campNight = getCampNightById(campNightId);
  if (!campNight) {
    res.status(404).json({ error: 'Malam perkhemahan tidak ditemui.' });
    return;
  }

  const tId = Number(teacherId);
  const targetSlot = Number(targetSlotNumber);

  db.exec('BEGIN IMMEDIATE');
  try {
    const reg = db
      .prepare(
        'SELECT id, slot_number FROM slot_registrations WHERE camp_night_id = ? AND teacher_id = ?'
      )
      .get(campNight.id, tId) as { id: number; slot_number: number } | undefined;

    if (!reg) {
      db.exec('ROLLBACK');
      res.status(404).json({ error: 'Pendaftaran guru tidak ditemui.' });
      return;
    }

    if (reg.slot_number === targetSlot) {
      db.exec('ROLLBACK');
      res.status(400).json({ error: 'Guru sudah berada dalam slot tersebut.' });
      return;
    }

    const dstSlot = db
      .prepare('SELECT quota FROM slots WHERE camp_night_id = ? AND slot_number = ?')
      .get(campNight.id, targetSlot) as { quota: number | null } | undefined;

    if (!dstSlot || dstSlot.quota === null) {
      db.exec('ROLLBACK');
      res.status(400).json({
        error: `Kuota bagi Slot ${targetSlot} belum ditetapkan oleh penyelaras.`,
      });
      return;
    }

    const dstCount = (
      db
        .prepare(
          'SELECT COUNT(*) AS cnt FROM slot_registrations WHERE camp_night_id = ? AND slot_number = ?'
        )
        .get(campNight.id, targetSlot) as { cnt: number }
    ).cnt;

    if (dstCount >= dstSlot.quota) {
      db.exec('ROLLBACK');
      res.status(409).json({
        error: `Slot ${targetSlot} sudah penuh dan tiada kekosongan.`,
      });
      return;
    }

    const srcSlot = db
      .prepare('SELECT leader_teacher_id FROM slots WHERE camp_night_id = ? AND slot_number = ?')
      .get(campNight.id, reg.slot_number) as { leader_teacher_id: number | null };

    // Move teacher registration
    db.prepare('UPDATE slot_registrations SET slot_number = ? WHERE id = ?').run(
      targetSlot,
      reg.id
    );

    // Handle leader reassignment if moved teacher was leader of source slot
    if (srcSlot.leader_teacher_id === tId) {
      let nextLeader: number | null = null;
      if (replacementLeaderTeacherId) {
        const validReplacement = db
          .prepare(
            'SELECT id FROM slot_registrations WHERE camp_night_id = ? AND slot_number = ? AND teacher_id = ?'
          )
          .get(campNight.id, reg.slot_number, Number(replacementLeaderTeacherId));
        if (!validReplacement) {
          db.exec('ROLLBACK');
          res.status(400).json({
            error: 'Ketua pengganti mestilah guru yang masih berada dalam slot asal.',
          });
          return;
        }
        nextLeader = Number(replacementLeaderTeacherId);
      }
      db.prepare(
        'UPDATE slots SET leader_teacher_id = ? WHERE camp_night_id = ? AND slot_number = ?'
      ).run(nextLeader, campNight.id, reg.slot_number);
    }

    db.exec('COMMIT');
    res.json({
      message: `Petugas berjaya dipindahkan dari Slot ${reg.slot_number} ke Slot ${targetSlot}.`,
      ...getScheduleForCampNight(campNight.id),
    });
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    res.status(500).json({ error: `Gagal memindahkan petugas: ${(err as Error).message}` });
  }
});

router.delete('/registrations', (req, res) => {
  const { campNightId, teacherId, replacementLeaderTeacherId } = req.body as {
    campNightId?: number;
    teacherId?: number;
    replacementLeaderTeacherId?: number | null;
  };

  const campNight = getCampNightById(campNightId);
  if (!campNight) {
    res.status(404).json({ error: 'Malam perkhemahan tidak ditemui.' });
    return;
  }

  const tId = Number(teacherId);
  db.exec('BEGIN IMMEDIATE');
  try {
    const reg = db
      .prepare(
        'SELECT id, slot_number FROM slot_registrations WHERE camp_night_id = ? AND teacher_id = ?'
      )
      .get(campNight.id, tId) as { id: number; slot_number: number } | undefined;

    if (!reg) {
      db.exec('ROLLBACK');
      res.status(404).json({ error: 'Pendaftaran guru tidak ditemui.' });
      return;
    }

    const srcSlot = db
      .prepare('SELECT leader_teacher_id FROM slots WHERE camp_night_id = ? AND slot_number = ?')
      .get(campNight.id, reg.slot_number) as { leader_teacher_id: number | null };

    db.prepare('DELETE FROM slot_registrations WHERE id = ?').run(reg.id);

    if (srcSlot.leader_teacher_id === tId) {
      let nextLeader: number | null = null;
      if (replacementLeaderTeacherId) {
        const validReplacement = db
          .prepare(
            'SELECT id FROM slot_registrations WHERE camp_night_id = ? AND slot_number = ? AND teacher_id = ?'
          )
          .get(campNight.id, reg.slot_number, Number(replacementLeaderTeacherId));
        if (!validReplacement) {
          db.exec('ROLLBACK');
          res.status(400).json({
            error: 'Ketua pengganti mestilah guru yang masih berada dalam slot tersebut.',
          });
          return;
        }
        nextLeader = Number(replacementLeaderTeacherId);
      }
      db.prepare(
        'UPDATE slots SET leader_teacher_id = ? WHERE camp_night_id = ? AND slot_number = ?'
      ).run(nextLeader, campNight.id, reg.slot_number);
    }

    db.exec('COMMIT');
    res.json({
      message: 'Petugas berjaya dikeluarkan daripada slot.',
      ...getScheduleForCampNight(campNight.id),
    });
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    res.status(500).json({ error: `Gagal mengeluarkan petugas: ${(err as Error).message}` });
  }
});

router.get('/reports/:slotNumber', (req, res) => {
  const slotNumber = Number(req.params.slotNumber);
  const campNightId = req.query.campNightId ? Number(req.query.campNightId) : undefined;
  const campNight = getCampNightById(campNightId);
  if (!campNight) {
    res.status(404).json({ error: 'Malam perkhemahan tidak ditemui.' });
    return;
  }

  const report = getReportDTO(campNight.id, slotNumber);
  res.json({ report });
});

router.post('/reports/:slotNumber/reopen', (req, res) => {
  const slotNumber = Number(req.params.slotNumber);
  const { campNightId } = req.body as { campNightId?: number };
  const campNight = getCampNightById(campNightId);
  if (!campNight) {
    res.status(404).json({ error: 'Malam perkhemahan tidak ditemui.' });
    return;
  }

  const existing = db
    .prepare('SELECT id, status FROM reports WHERE camp_night_id = ? AND slot_number = ?')
    .get(campNight.id, slotNumber) as { id: number; status: 'draft' | 'submitted' } | undefined;

  if (!existing || existing.status !== 'submitted') {
    res.status(400).json({ error: 'Hanya laporan yang telah dihantar boleh dibuka semula.' });
    return;
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE reports
     SET status = 'draft', reopened_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(now, now, existing.id);

  res.json({
    message: `Laporan Slot ${slotNumber} telah dibuka semula untuk pembetulan oleh Ketua Slot.`,
    ...getScheduleForCampNight(campNight.id),
  });
});

router.post('/export-zip', async (req, res) => {
  const { campNightId, slotNumbers } = req.body as {
    campNightId?: number;
    slotNumbers?: number[];
  };

  const campNight = getCampNightById(campNightId);
  if (!campNight) {
    res.status(404).json({ error: 'Malam perkhemahan tidak ditemui.' });
    return;
  }

  try {
    const result = await generateBulkZipArchive(campNight.id, slotNumbers);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-Included-Slots', result.includedSlots.join(','));
    res.setHeader('X-File-Count', String(result.fileCount));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(result.buffer);
  } catch (err) {
    const detail = (err as { detail?: ZipExportFailure }).detail;
    res.status(500).json({
      error: (err as Error).message,
      detail: detail ?? null,
    });
  }
});

router.post('/export-pdf', async (req, res) => {
  const { campNightId, slotNumbers } = req.body as {
    campNightId?: number;
    slotNumbers?: number[];
  };

  const campNight = getCampNightById(campNightId);
  if (!campNight) {
    res.status(404).json({ error: 'Malam perkhemahan tidak ditemui.' });
    return;
  }

  const submittedRows = db
    .prepare(
      `SELECT slot_number
       FROM reports
       WHERE camp_night_id = ? AND status = 'submitted'
       ORDER BY slot_number ASC`
    )
    .all(campNight.id) as Array<{ slot_number: number }>;

  const submittedSlotNumbers = submittedRows.map((r) => r.slot_number);
  const targetSlots =
    Array.isArray(slotNumbers) && slotNumbers.length > 0
      ? [...new Set(slotNumbers)]
          .filter((n) => submittedSlotNumbers.includes(n))
          .sort((a, b) => a - b)
      : submittedSlotNumbers;

  if (targetSlots.length === 0) {
    res.status(400).json({
      error: 'Tiada laporan berstatus "Telah dihantar" yang dipilih untuk dimuat turun sebagai PDF pukal.',
    });
    return;
  }

  try {
    const reports = targetSlots.map((slotNum) => getReportDTO(campNight.id, slotNum));
    const pdfBuffer = await generateBulkPdfBuffer(campNight, reports);
    const filename = `Laporan_Sentri_Malam_SK_Tudan_2026_${campNight.startDate}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Included-Slots', targetSlots.join(','));
    res.setHeader('X-Report-Count', String(reports.length));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({
      error: `Gagal menjana PDF pukal: ${(err as Error).message}`,
    });
  }
});

export default router;
