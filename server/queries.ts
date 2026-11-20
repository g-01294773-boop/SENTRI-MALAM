import {
  type AttendanceEntry,
  type CampNightDTO,
  type EligibleTeacherDTO,
  type IncidentEntry,
  type PublicTeacherSlotMember,
  type ReportDTO,
  type ReportPhotoDTO,
  type SlotSummaryDTO,
} from '../src/shared/constants.ts';
import {
  formatDateDisplayMY,
  formatDateTimePartsMY,
  formatTimestampMY,
  getSlotDates,
} from '../src/shared/dates.ts';
import { db } from './db.ts';

export function listCampNights(): CampNightDTO[] {
  const rows = db
    .prepare(
      `SELECT id, title, start_date, is_active
       FROM camp_nights
       ORDER BY start_date DESC, id DESC`
    )
    .all() as Array<{ id: number; title: string; start_date: string; is_active: number }>;

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    startDate: r.start_date,
    startDateDisplay: formatDateDisplayMY(r.start_date),
    isActive: r.is_active === 1,
  }));
}

export function getCampNightById(campNightId?: number): CampNightDTO | null {
  const row = campNightId
    ? (db
        .prepare('SELECT id, title, start_date, is_active FROM camp_nights WHERE id = ?')
        .get(campNightId) as
        | { id: number; title: string; start_date: string; is_active: number }
        | undefined)
    : (db
        .prepare(
          'SELECT id, title, start_date, is_active FROM camp_nights ORDER BY is_active DESC, id ASC LIMIT 1'
        )
        .get() as
        | { id: number; title: string; start_date: string; is_active: number }
        | undefined);

  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    startDate: row.start_date,
    startDateDisplay: formatDateDisplayMY(row.start_date),
    isActive: row.is_active === 1,
  };
}

export function getScheduleForCampNight(campNightId: number): {
  campNight: CampNightDTO;
  slots: SlotSummaryDTO[];
  eligibleTeachers: EligibleTeacherDTO[];
} {
  const campNight = getCampNightById(campNightId);
  if (!campNight) {
    throw new Error('Malam perkhemahan tidak ditemui.');
  }

  const slotRows = db
    .prepare(
      `SELECT s.slot_number, s.start_time_24, s.end_time_24, s.display_time, s.duration_minutes,
              s.quota, s.leader_teacher_id, u.name AS leader_name
       FROM slots s
       LEFT JOIN users u ON u.id = s.leader_teacher_id
       WHERE s.camp_night_id = ?
       ORDER BY s.slot_number ASC`
    )
    .all(campNightId) as Array<{
    slot_number: number;
    start_time_24: string;
    end_time_24: string;
    display_time: string;
    duration_minutes: number;
    quota: number | null;
    leader_teacher_id: number | null;
    leader_name: string | null;
  }>;

  const regRows = db
    .prepare(
      `SELECT r.slot_number, r.teacher_id, r.is_substitute, u.name
       FROM slot_registrations r
       JOIN users u ON u.id = r.teacher_id
       WHERE r.camp_night_id = ?
       ORDER BY r.id ASC`
    )
    .all(campNightId) as Array<{
    slot_number: number;
    teacher_id: number;
    is_substitute: number;
    name: string;
  }>;

  const reportRows = db
    .prepare(
      `SELECT rep.id, rep.slot_number, rep.status, rep.q6, rep.has_incident, rep.handover_status,
              rep.form_version, rep.submitted_at, rep.submitted_by_name,
              rep.acknowledged_at, rep.acknowledged_by_name, rep.updated_at,
              (SELECT COUNT(*) FROM report_photos p WHERE p.report_id = rep.id) AS photo_count
       FROM reports rep
       WHERE rep.camp_night_id = ?`
    )
    .all(campNightId) as Array<{
    id: number;
    slot_number: number;
    status: 'draft' | 'submitted';
    q6: string | null;
    has_incident: string | null;
    handover_status: string | null;
    form_version: number;
    submitted_at: string | null;
    submitted_by_name: string | null;
    acknowledged_at: string | null;
    acknowledged_by_name: string | null;
    updated_at: string;
    photo_count: number;
  }>;

  const reportBySlot = new Map(reportRows.map((r) => [r.slot_number, r]));

  const slots: SlotSummaryDTO[] = slotRows.map((s) => {
    const { startDate, endDate } = getSlotDates(campNight.startDate, s.slot_number);
    const members: PublicTeacherSlotMember[] = regRows
      .filter((r) => r.slot_number === s.slot_number)
      .map((r) => ({
        teacherId: r.teacher_id,
        name: r.name,
        isLeader: s.leader_teacher_id === r.teacher_id,
        isSubstitute: r.is_substitute === 1,
      }));

    const registeredCount = members.length;
    let remainingSeats: number | null = null;
    let statusLabel = 'Kuota belum ditetapkan';
    let isOpenForRegistration = false;

    if (s.quota !== null) {
      remainingSeats = Math.max(0, s.quota - registeredCount);
      if (remainingSeats === 0) {
        statusLabel = 'Penuh';
        isOpenForRegistration = false;
      } else {
        statusLabel = 'Dibuka';
        isOpenForRegistration = true;
      }
    }

    const rep = reportBySlot.get(s.slot_number);
    let reportStatus:
      | 'Belum diisi'
      | 'Draf'
      | 'Menunggu pengesahan'
      | 'Diterima oleh penyelaras' = 'Belum diisi';
    let followUpStatus = 'Tiada laporan';

    if (rep) {
      if (rep.status === 'submitted') {
        reportStatus = rep.acknowledged_at
          ? 'Diterima oleh penyelaras'
          : 'Menunggu pengesahan';
      } else {
        reportStatus = 'Draf';
      }
      const isLegacy = rep.form_version === 1;
      const needsFollowUp =
        rep.has_incident === 'Ya' ||
        rep.q6 === 'Terdapat khemah yang masih memerlukan pembaikan pada akhir slot' ||
        (isLegacy &&
          (rep.q6 === 'Sebahagian masih memerlukan tindakan' ||
            rep.q6 === 'Semua masih memerlukan tindakan' ||
            rep.handover_status === 'Selesai dengan perkara untuk tindakan susulan.' ||
            rep.handover_status === 'Belum selesai.'));
      if (rep.status === 'submitted') {
        followUpStatus = needsFollowUp ? 'Perlu tindakan susulan' : 'Tiada susulan';
      } else {
        followUpStatus = needsFollowUp ? 'Dalam draf (ada catatan susulan)' : 'Dalam draf';
      }
    }

    const ackParts = formatDateTimePartsMY(rep?.acknowledged_at);

    return {
      slotNumber: s.slot_number,
      startTime24: s.start_time_24,
      endTime24: s.end_time_24,
      displayTime: s.display_time,
      durationMinutes: s.duration_minutes,
      startDate,
      endDate,
      startDateDisplay: formatDateDisplayMY(startDate),
      endDateDisplay: formatDateDisplayMY(endDate),
      quota: s.quota,
      registeredCount,
      remainingSeats,
      statusLabel,
      isOpenForRegistration,
      leaderTeacherId: s.leader_teacher_id,
      leaderName: s.leader_name,
      members,
      reportStatus,
      isSubmitted: rep?.status === 'submitted',
      reportId: rep?.id ?? null,
      photoCount: rep?.photo_count ?? 0,
      followUpStatus,
      submittedAt: rep?.submitted_at ?? null,
      submittedAtDisplay: formatTimestampMY(rep?.submitted_at),
      submittedByName: rep?.submitted_by_name ?? null,
      acknowledgedAt: rep?.acknowledged_at ?? null,
      acknowledgedAtDisplay: formatTimestampMY(rep?.acknowledged_at),
      acknowledgedByName: rep?.acknowledged_by_name ?? null,
      acknowledgementDateStr: ackParts?.date ?? null,
      acknowledgementTimeStr: ackParts?.time ?? null,
      updatedAt: rep?.updated_at ?? null,
    };
  });

  const teacherRows = db
    .prepare(
      `SELECT u.id, u.name, r.slot_number AS registered_slot_number,
              CASE WHEN s.leader_teacher_id = u.id THEN 1 ELSE 0 END AS is_leader
       FROM users u
       LEFT JOIN slot_registrations r
         ON r.teacher_id = u.id AND r.camp_night_id = ?
       LEFT JOIN slots s
         ON s.camp_night_id = ? AND s.slot_number = r.slot_number
       WHERE u.role = 'teacher' AND u.active = 1
       ORDER BY u.name COLLATE NOCASE ASC`
    )
    .all(campNightId, campNightId) as Array<{
    id: number;
    name: string;
    registered_slot_number: number | null;
    is_leader: number;
  }>;

  const eligibleTeachers: EligibleTeacherDTO[] = teacherRows.map((t) => ({
    id: t.id,
    name: t.name,
    registeredSlotNumber: t.registered_slot_number,
    isLeader: t.is_leader === 1,
  }));

  return { campNight, slots, eligibleTeachers };
}

export function getReportDTO(campNightId: number, slotNumber: number): ReportDTO {
  const campNight = getCampNightById(campNightId);
  if (!campNight) {
    throw new Error('Malam perkhemahan tidak ditemui.');
  }

  const slotRow = db
    .prepare(
      `SELECT s.slot_number, s.display_time, s.duration_minutes, s.leader_teacher_id, u.name AS leader_name
       FROM slots s
       LEFT JOIN users u ON u.id = s.leader_teacher_id
       WHERE s.camp_night_id = ? AND s.slot_number = ?`
    )
    .get(campNightId, slotNumber) as
    | {
        slot_number: number;
        display_time: string;
        duration_minutes: number;
        leader_teacher_id: number | null;
        leader_name: string | null;
      }
    | undefined;

  if (!slotRow) {
    throw new Error('Slot tidak ditemui.');
  }

  const regRows = db
    .prepare(
      `SELECT r.teacher_id, r.is_substitute, u.name
       FROM slot_registrations r
       JOIN users u ON u.id = r.teacher_id
       WHERE r.camp_night_id = ? AND r.slot_number = ?
       ORDER BY r.id ASC`
    )
    .all(campNightId, slotNumber) as Array<{
    teacher_id: number;
    is_substitute: number;
    name: string;
  }>;

  const registeredMembers: PublicTeacherSlotMember[] = regRows.map((r) => ({
    teacherId: r.teacher_id,
    name: r.name,
    isLeader: slotRow.leader_teacher_id === r.teacher_id,
    isSubstitute: r.is_substitute === 1,
  }));

  const reportRow = db
    .prepare('SELECT * FROM reports WHERE camp_night_id = ? AND slot_number = ?')
    .get(campNightId, slotNumber) as
    | {
        id: number;
        status: 'draft' | 'submitted';
        attendance_json: string;
        extra_officers: string;
        q1: string | null;
        q2: string | null;
        q3: string | null;
        q4: string | null;
        q5: string | null;
        q6: string | null;
        has_incident: 'Ya' | 'Tidak' | null;
        incidents_json: string;
        observation_notes: string;
        form_version: number;
        submitted_by_teacher_id: number | null;
        submitted_by_name: string | null;
        submitted_at: string | null;
        acknowledged_by_teacher_id: number | null;
        acknowledged_by_name: string | null;
        acknowledged_at: string | null;
        updated_at: string;
        reopened_at: string | null;
      }
    | undefined;

  const { startDate, endDate } = getSlotDates(campNight.startDate, slotNumber);

  let attendance: AttendanceEntry[] = [];
  if (reportRow) {
    let savedAttendance: AttendanceEntry[] = [];
    try {
      savedAttendance = JSON.parse(reportRow.attendance_json);
    } catch {
      savedAttendance = [];
    }
    const savedMap = new Map(savedAttendance.map((a) => [a.teacherId, a.present]));
    if (reportRow.status === 'submitted' && savedAttendance.length > 0) {
      attendance = savedAttendance;
    } else {
      attendance = registeredMembers.map((m) => ({
        teacherId: m.teacherId,
        name: m.name,
        present: savedMap.get(m.teacherId) ?? false,
      }));
    }
  } else {
    attendance = registeredMembers.map((m) => ({
      teacherId: m.teacherId,
      name: m.name,
      present: false,
    }));
  }

  let incidents: IncidentEntry[] = [];
  if (reportRow) {
    try {
      incidents = JSON.parse(reportRow.incidents_json);
    } catch {
      incidents = [];
    }
  }

  const photos: { 1: ReportPhotoDTO | null; 2: ReportPhotoDTO | null } = {
    1: null,
    2: null,
  };

  if (reportRow) {
    const photoRows = db
      .prepare(
        `SELECT id, photo_index, original_name, mime_type, ext, width, height, size_bytes,
                taken_time, location, caption, uploaded_at
         FROM report_photos
         WHERE report_id = ?
         ORDER BY photo_index ASC`
      )
      .all(reportRow.id) as Array<{
      id: number;
      photo_index: 1 | 2;
      original_name: string;
      mime_type: string;
      ext: string;
      width: number;
      height: number;
      size_bytes: number;
      taken_time: string;
      location: string;
      caption: string;
      uploaded_at: string;
    }>;

    for (const p of photoRows) {
      photos[p.photo_index] = {
        id: p.id,
        photoIndex: p.photo_index,
        originalName: p.original_name,
        mimeType: p.mime_type,
        ext: p.ext,
        width: p.width,
        height: p.height,
        sizeBytes: p.size_bytes,
        takenTime: p.taken_time,
        location: p.location,
        caption: p.caption,
        uploadedAt: p.uploaded_at,
      };
    }
  }

  const ackParts = formatDateTimePartsMY(reportRow?.acknowledged_at);

  return {
    id: reportRow?.id ?? null,
    formVersion: reportRow?.form_version ?? 2,
    campNightId,
    campNightTitle: campNight.title,
    campStartDate: campNight.startDate,
    slotNumber,
    displayTime: slotRow.display_time,
    durationMinutes: slotRow.duration_minutes,
    startDate,
    endDate,
    startDateDisplay: formatDateDisplayMY(startDate),
    endDateDisplay: formatDateDisplayMY(endDate),
    leaderTeacherId: slotRow.leader_teacher_id,
    leaderName: slotRow.leader_name,
    registeredMembers,
    status: reportRow ? reportRow.status : 'unfilled',
    attendance,
    extraOfficers: reportRow?.extra_officers ?? '',
    q1: reportRow?.q1 ?? null,
    q2: reportRow?.q2 ?? null,
    q3: reportRow?.q3 ?? null,
    q4: reportRow?.q4 ?? null,
    q5: reportRow?.q5 ?? null,
    q6: reportRow?.q6 ?? null,
    hasIncident: reportRow?.has_incident ?? null,
    observationNotes: reportRow?.observation_notes ?? '',
    incidents,
    submittedByTeacherId: reportRow?.submitted_by_teacher_id ?? null,
    submittedByName: reportRow?.submitted_by_name ?? null,
    submittedAt: reportRow?.submitted_at ?? null,
    submittedAtDisplay: formatTimestampMY(reportRow?.submitted_at),
    acknowledgedByTeacherId: reportRow?.acknowledged_by_teacher_id ?? null,
    acknowledgedByName: reportRow?.acknowledged_by_name ?? null,
    acknowledgedAt: reportRow?.acknowledged_at ?? null,
    acknowledgedAtDisplay: formatTimestampMY(reportRow?.acknowledged_at),
    acknowledgementDateStr: ackParts?.date ?? null,
    acknowledgementTimeStr: ackParts?.time ?? null,
    updatedAt: reportRow?.updated_at ?? null,
    updatedAtDisplay: formatTimestampMY(reportRow?.updated_at),
    reopenedAt: reportRow?.reopened_at ?? null,
    photos,
  };
}
