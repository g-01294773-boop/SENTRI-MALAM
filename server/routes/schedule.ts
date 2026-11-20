import { Router } from 'express';
import { authenticateOptional, requireTeacher } from '../auth.ts';
import { db } from '../db.ts';
import {
  getCampNightById,
  getScheduleForCampNight,
  listCampNights,
} from '../queries.ts';
import { formatDateDisplayMY, getSlotDates } from '../../src/shared/dates.ts';

const router = Router();

router.get('/schedule', (req, res) => {
  const campNightIdParam = req.query.campNightId
    ? Number(req.query.campNightId)
    : undefined;

  const campNights = listCampNights();
  const targetNight = getCampNightById(
    Number.isInteger(campNightIdParam) ? campNightIdParam : undefined
  );

  if (!targetNight) {
    res.status(404).json({ error: 'Tiada malam perkhemahan ditemui.' });
    return;
  }

  const schedule = getScheduleForCampNight(targetNight.id);
  res.json({
    campNights,
    ...schedule,
  });
});

router.post('/registrations', authenticateOptional, requireTeacher, (req, res) => {
  const { campNightId, slotNumber } = req.body as {
    campNightId?: number;
    slotNumber?: number;
  };

  const targetNight = getCampNightById(
    campNightId ? Number(campNightId) : undefined
  );
  if (!targetNight) {
    res.status(404).json({ error: 'Malam perkhemahan tidak ditemui.' });
    return;
  }

  const slotNum = Number(slotNumber);
  if (!Number.isInteger(slotNum) || slotNum < 1 || slotNum > 6) {
    res.status(400).json({ error: 'Nombor slot tidak sah.' });
    return;
  }

  const teacherId = req.user!.id;
  const teacherName = req.user!.name;

  db.exec('BEGIN IMMEDIATE');
  try {
    const existingReg = db
      .prepare(
        `SELECT r.slot_number, s.display_time
         FROM slot_registrations r
         JOIN slots s ON s.camp_night_id = r.camp_night_id AND s.slot_number = r.slot_number
         WHERE r.camp_night_id = ? AND r.teacher_id = ?`
      )
      .get(targetNight.id, teacherId) as
      | { slot_number: number; display_time: string }
      | undefined;

    if (existingReg) {
      db.exec('ROLLBACK');
      res.status(409).json({
        error: `Anda telah berdaftar dalam Slot ${existingReg.slot_number} (${existingReg.display_time}). Seorang guru hanya boleh berdaftar dalam satu slot bagi malam perkhemahan yang sama.`,
        slotNumber: existingReg.slot_number,
        displayTime: existingReg.display_time,
      });
      return;
    }

    const slot = db
      .prepare(
        `SELECT slot_number, display_time, quota
         FROM slots
         WHERE camp_night_id = ? AND slot_number = ?`
      )
      .get(targetNight.id, slotNum) as
      | { slot_number: number; display_time: string; quota: number | null }
      | undefined;

    if (!slot) {
      db.exec('ROLLBACK');
      res.status(404).json({ error: 'Slot tidak ditemui.' });
      return;
    }

    if (slot.quota === null) {
      db.exec('ROLLBACK');
      res.status(400).json({
        error: `Kuota bagi Slot ${slotNum} belum ditetapkan oleh penyelaras.`,
      });
      return;
    }

    const countRow = db
      .prepare(
        'SELECT COUNT(*) AS cnt FROM slot_registrations WHERE camp_night_id = ? AND slot_number = ?'
      )
      .get(targetNight.id, slotNum) as { cnt: number };

    if (countRow.cnt >= slot.quota) {
      db.exec('ROLLBACK');
      res.status(409).json({
        error: `Harap maaf, Slot ${slotNum} telah penuh. Tempat terakhir telah diisi.`,
      });
      return;
    }

    db.prepare(
      `INSERT INTO slot_registrations (camp_night_id, slot_number, teacher_id, is_substitute, note, registered_at)
       VALUES (?, ?, ?, 0, '', ?)`
    ).run(targetNight.id, slotNum, teacherId, new Date().toISOString());

    db.exec('COMMIT');

    const { startDate, endDate } = getSlotDates(targetNight.startDate, slotNum);
    res.status(201).json({
      message: 'Pendaftaran berjaya disahkan.',
      registration: {
        teacherId,
        teacherName,
        slotNumber: slotNum,
        displayTime: slot.display_time,
        startDate,
        endDate,
        startDateDisplay: formatDateDisplayMY(startDate),
        endDateDisplay: formatDateDisplayMY(endDate),
      },
    });
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    res.status(500).json({
      error: `Gagal menyimpan pendaftaran: ${(err as Error).message}`,
    });
  }
});

export default router;
