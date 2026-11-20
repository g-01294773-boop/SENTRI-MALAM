import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SLOT_DEFINITIONS } from '../src/shared/constants.ts';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'sentri.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS system_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('teacher', 'coordinator')),
    access_code_hash TEXT NOT NULL,
    access_code_enc TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS camp_nights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    start_date TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    camp_night_id INTEGER NOT NULL REFERENCES camp_nights(id) ON DELETE CASCADE,
    slot_number INTEGER NOT NULL CHECK(slot_number BETWEEN 1 AND 6),
    start_time_24 TEXT NOT NULL,
    end_time_24 TEXT NOT NULL,
    display_time TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    quota INTEGER,
    leader_teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(camp_night_id, slot_number)
  );

  CREATE TABLE IF NOT EXISTS slot_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    camp_night_id INTEGER NOT NULL REFERENCES camp_nights(id) ON DELETE CASCADE,
    slot_number INTEGER NOT NULL CHECK(slot_number BETWEEN 1 AND 6),
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_substitute INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    registered_at TEXT NOT NULL,
    UNIQUE(camp_night_id, teacher_id)
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    camp_night_id INTEGER NOT NULL REFERENCES camp_nights(id) ON DELETE CASCADE,
    slot_number INTEGER NOT NULL CHECK(slot_number BETWEEN 1 AND 6),
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'submitted')),
    attendance_json TEXT NOT NULL DEFAULT '[]',
    extra_officers TEXT NOT NULL DEFAULT '',
    q1 TEXT,
    q2 TEXT,
    q3 TEXT,
    q4 TEXT,
    q5 TEXT,
    q6 TEXT,
    has_incident TEXT,
    incidents_json TEXT NOT NULL DEFAULT '[]',
    handover_status TEXT,
    handover_receiver TEXT NOT NULL DEFAULT '',
    handover_time TEXT NOT NULL DEFAULT '',
    handover_note TEXT NOT NULL DEFAULT '',
    observation_notes TEXT NOT NULL DEFAULT '',
    form_version INTEGER NOT NULL DEFAULT 2,
    submitted_by_teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    submitted_by_name TEXT,
    submitted_at TEXT,
    updated_at TEXT NOT NULL,
    reopened_at TEXT,
    UNIQUE(camp_night_id, slot_number)
  );

  CREATE TABLE IF NOT EXISTS report_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    photo_index INTEGER NOT NULL CHECK(photo_index IN (1, 2)),
    file_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    ext TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    pixel_hash TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    size_bytes INTEGER NOT NULL,
    taken_time TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    caption TEXT NOT NULL DEFAULT '',
    uploaded_at TEXT NOT NULL,
    UNIQUE(report_id, photo_index)
  );
`);

const reportCols = db.prepare('PRAGMA table_info(reports)').all() as Array<{ name: string }>;
const reportColNames = new Set(reportCols.map((c) => c.name));
if (!reportColNames.has('acknowledged_by_teacher_id')) {
  db.exec(
    'ALTER TABLE reports ADD COLUMN acknowledged_by_teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL'
  );
}
if (!reportColNames.has('acknowledged_by_name')) {
  db.exec('ALTER TABLE reports ADD COLUMN acknowledged_by_name TEXT');
}
if (!reportColNames.has('acknowledged_at')) {
  db.exec('ALTER TABLE reports ADD COLUMN acknowledged_at TEXT');
}
if (!reportColNames.has('submission_key')) {
  db.exec('ALTER TABLE reports ADD COLUMN submission_key TEXT');
}
if (!reportColNames.has('observation_notes')) {
  db.exec("ALTER TABLE reports ADD COLUMN observation_notes TEXT NOT NULL DEFAULT ''");
}
if (!reportColNames.has('form_version')) {
  db.exec('ALTER TABLE reports ADD COLUMN form_version INTEGER NOT NULL DEFAULT 1');
}

function getServerSecret(): Buffer {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    return crypto.createHash('sha256').update(process.env.SESSION_SECRET).digest();
  }
  const existing = db
    .prepare('SELECT value FROM system_meta WHERE key = ?')
    .get('server_secret') as { value: string } | undefined;
  if (existing?.value) {
    return Buffer.from(existing.value, 'hex');
  }
  const generated = crypto.randomBytes(32);
  db.prepare('INSERT OR REPLACE INTO system_meta (key, value) VALUES (?, ?)').run(
    'server_secret',
    generated.toString('hex')
  );
  return generated;
}

const SERVER_SECRET = getServerSecret();

export function hashAccessCode(code: string): string {
  const normalized = code.trim();
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(normalized, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyAccessCode(code: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHex] = parts;
  const derived = crypto.scryptSync(code.trim(), salt, 64);
  const original = Buffer.from(originalHex, 'hex');
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

export function encryptAccessCode(code: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SERVER_SECRET, iv);
  const encrypted = Buffer.concat([cipher.update(code.trim(), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptAccessCode(payload: string | null): string | null {
  if (!payload) return null;
  try {
    const [ivHex, tagHex, encHex] = payload.split(':');
    if (!ivHex || !tagHex || !encHex) return null;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      SERVER_SECRET,
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(encHex, 'hex')),
      decipher.final(),
    ]);
    return plain.toString('utf8');
  } catch {
    return null;
  }
}

export function generatePersonalAccessCode(): string {
  return '1234';
}

const INITIAL_SLOT_TEACHERS: Array<{
  slotNumber: number;
  quota: number | null;
  teachers: string[];
}> = [
  {
    slotNumber: 1,
    quota: 3,
    teachers: [
      'Watson anak Satot',
      'Hanani Irdina binti Che Mood',
      'Nurmarzlia binti Mataip',
    ],
  },
  {
    slotNumber: 2,
    quota: 3,
    teachers: [
      'Najwa Amni binti Mohamad',
      'Munirah binti Mohamad Nasir',
      'Nuradibah binti Nordin',
    ],
  },
  {
    slotNumber: 3,
    quota: 3,
    teachers: [
      'Nawwarah binti Abdullah',
      'Emmy Erniesha Ellyn binti Jumari',
      'Yohana Unyang Juren',
    ],
  },
  {
    slotNumber: 4,
    quota: 4,
    teachers: [
      'Nur Izzah Athirah binti Hasmadi',
      'Linaambigai A/P G Sandrasageran',
      'Su Meo Chong',
      'Khalijah binti Ekhsan',
    ],
  },
  {
    slotNumber: 5,
    quota: 4,
    teachers: ['Khairunnisa binti A. Halim', 'Isma bin Abdullah'],
  },
  {
    slotNumber: 6,
    quota: null,
    teachers: ['Melissa Bulan Gau', 'Nur Amira Tey Abdullah'],
  },
];

export function seedInitialDataOnce(): void {
  const alreadySeeded = db
    .prepare('SELECT value FROM system_meta WHERE key = ?')
    .get('seed_completed') as { value: string } | undefined;

  if (alreadySeeded?.value === '1') {
    const unified = db
      .prepare('SELECT value FROM system_meta WHERE key = ?')
      .get('unified_code_1234') as { value: string } | undefined;
    if (unified?.value !== '1') {
      const code = '1234';
      const hashed = hashAccessCode(code);
      const enc = encryptAccessCode(code);
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare("UPDATE users SET access_code_hash = ?, access_code_enc = ? WHERE role = 'teacher'").run(
          hashed,
          enc
        );
        db.prepare("UPDATE users SET access_code_hash = ?, access_code_enc = NULL WHERE role = 'coordinator'").run(
          hashAccessCode((process.env.COORDINATOR_ACCESS_CODE || '1234').trim())
        );
        db.prepare('INSERT OR REPLACE INTO system_meta (key, value) VALUES (?, ?)').run(
          'unified_code_1234',
          '1'
        );
        db.exec('COMMIT');
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // ignore
        }
        throw err;
      }
    }
    return;
  }

  const now = new Date().toISOString();
  const coordinatorCode = (process.env.COORDINATOR_ACCESS_CODE || '1234').trim();

  db.exec('BEGIN IMMEDIATE');
  try {
    const checkAgain = db
      .prepare('SELECT value FROM system_meta WHERE key = ?')
      .get('seed_completed') as { value: string } | undefined;
    if (checkAgain?.value === '1') {
      db.exec('COMMIT');
      return;
    }

    db.prepare(
      `INSERT INTO users (name, role, access_code_hash, access_code_enc, active, created_at)
       VALUES (?, 'coordinator', ?, NULL, 1, ?)`
    ).run('Penyelaras Perkhemahan', hashAccessCode(coordinatorCode), now);

    const campNightRes = db
      .prepare(
        `INSERT INTO camp_nights (title, start_date, is_active, created_at)
         VALUES (?, ?, 1, ?)`
      )
      .run('Malam Perkhemahan 1', '2026-11-20', now);

    const campNightId = Number(campNightRes.lastInsertRowid);

    const insertSlot = db.prepare(
      `INSERT INTO slots (camp_night_id, slot_number, start_time_24, end_time_24, display_time, duration_minutes, quota, leader_teacher_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
    );

    const insertUser = db.prepare(
      `INSERT INTO users (name, role, access_code_hash, access_code_enc, active, created_at)
       VALUES (?, 'teacher', ?, ?, 1, ?)`
    );

    const insertReg = db.prepare(
      `INSERT INTO slot_registrations (camp_night_id, slot_number, teacher_id, is_substitute, note, registered_at)
       VALUES (?, ?, ?, 0, '', ?)`
    );

    for (const def of SLOT_DEFINITIONS) {
      const seedGroup = INITIAL_SLOT_TEACHERS.find((g) => g.slotNumber === def.slotNumber)!;
      insertSlot.run(
        campNightId,
        def.slotNumber,
        def.startTime24,
        def.endTime24,
        def.displayTime,
        def.durationMinutes,
        seedGroup.quota
      );

      for (const teacherName of seedGroup.teachers) {
        const personalCode = generatePersonalAccessCode();
        const userRes = insertUser.run(
          teacherName,
          hashAccessCode(personalCode),
          encryptAccessCode(personalCode),
          now
        );
        const teacherId = Number(userRes.lastInsertRowid);
        insertReg.run(campNightId, def.slotNumber, teacherId, now);
      }
    }

    db.prepare('INSERT INTO system_meta (key, value) VALUES (?, ?)').run('seed_completed', '1');
    db.prepare('INSERT OR REPLACE INTO system_meta (key, value) VALUES (?, ?)').run(
      'unified_code_1234',
      '1'
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function createSlotsForCampNight(campNightId: number): void {
  const insertSlot = db.prepare(
    `INSERT INTO slots (camp_night_id, slot_number, start_time_24, end_time_24, display_time, duration_minutes, quota, leader_teacher_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
  );
  for (const def of SLOT_DEFINITIONS) {
    const defaultQuota = def.slotNumber <= 3 ? 3 : def.slotNumber <= 5 ? 4 : null;
    insertSlot.run(
      campNightId,
      def.slotNumber,
      def.startTime24,
      def.endTime24,
      def.displayTime,
      def.durationMinutes,
      defaultQuota
    );
  }
}
