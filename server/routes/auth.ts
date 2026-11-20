import { Router } from 'express';
import {
  authenticateOptional,
  createSession,
  requireAuth,
  revokeSession,
} from '../auth.ts';
import {
  db,
  encryptAccessCode,
  hashAccessCode,
  verifyAccessCode,
} from '../db.ts';
import { getCampNightById } from '../queries.ts';

const router = Router();

function buildUserProfile(userId: number) {
  const user = db
    .prepare('SELECT id, name, role FROM users WHERE id = ? AND active = 1')
    .get(userId) as { id: number; name: string; role: 'teacher' | 'coordinator' } | undefined;

  if (!user) return null;

  let registeredSlotNumber: number | null = null;
  let leaderSlotNumber: number | null = null;

  if (user.role === 'teacher') {
    const campNight = getCampNightById();
    if (campNight) {
      const reg = db
        .prepare(
          'SELECT slot_number FROM slot_registrations WHERE camp_night_id = ? AND teacher_id = ?'
        )
        .get(campNight.id, user.id) as { slot_number: number } | undefined;
      registeredSlotNumber = reg?.slot_number ?? null;

      const leaderSlot = db
        .prepare(
          'SELECT slot_number FROM slots WHERE camp_night_id = ? AND leader_teacher_id = ?'
        )
        .get(campNight.id, user.id) as { slot_number: number } | undefined;
      leaderSlotNumber = leaderSlot?.slot_number ?? null;
    }
  }

  return {
    id: user.id,
    name: user.name,
    role: user.role,
    registeredSlotNumber,
    leaderSlotNumber,
  };
}

router.post('/login', (req, res) => {
  const { mode, teacherId, accessCode } = req.body as {
    mode?: 'teacher' | 'coordinator';
    teacherId?: number;
    accessCode?: string;
  };

  if (!accessCode || typeof accessCode !== 'string' || !accessCode.trim()) {
    res.status(400).json({ error: 'Sila masukkan kod akses peribadi anda.' });
    return;
  }

  let userRow:
    | {
        id: number;
        name: string;
        role: 'teacher' | 'coordinator';
        access_code_hash: string;
        active: number;
      }
    | undefined;

  if (mode === 'coordinator') {
    userRow = db
      .prepare("SELECT id, name, role, access_code_hash, active FROM users WHERE role = 'coordinator' LIMIT 1")
      .get() as typeof userRow;
  } else {
    if (!teacherId || !Number.isInteger(Number(teacherId))) {
      res.status(400).json({ error: 'Sila pilih nama guru anda daripada senarai.' });
      return;
    }
    userRow = db
      .prepare("SELECT id, name, role, access_code_hash, active FROM users WHERE id = ? AND role = 'teacher'")
      .get(Number(teacherId)) as typeof userRow;
  }

  if (!userRow || userRow.active !== 1) {
    res.status(401).json({ error: 'Akaun pengguna tidak aktif atau tidak ditemui.' });
    return;
  }

  const valid = verifyAccessCode(accessCode, userRow.access_code_hash);
  if (!valid) {
    res.status(401).json({
      error: 'Kod akses peribadi tidak sah. Pemilihan nama sahaja tidak memberikan akses.',
    });
    return;
  }

  const { token } = createSession(userRow.id);
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const isHttps = req.secure || forwardedProto.includes('https');

  res.cookie('sentri_session', token, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });

  const profile = buildUserProfile(userRow.id);
  res.json({ token, user: profile });
});

router.post('/logout', authenticateOptional, (req, res) => {
  if (req.sessionToken) {
    revokeSession(req.sessionToken);
  }
  res.clearCookie('sentri_session', { path: '/' });
  res.json({ ok: true });
});

router.get('/me', authenticateOptional, (req, res) => {
  if (!req.user) {
    res.json({ user: null });
    return;
  }
  const profile = buildUserProfile(req.user.id);
  res.json({ user: profile });
});

router.post('/change-code', authenticateOptional, requireAuth, (req, res) => {
  const { currentCode, newCode } = req.body as {
    currentCode?: string;
    newCode?: string;
  };

  if (!currentCode || !newCode || newCode.trim().length < 4) {
    res.status(400).json({
      error: 'Kod akses baharu mesti mengandungi sekurang-kurangnya 4 aksara.',
    });
    return;
  }

  const user = db
    .prepare('SELECT id, role, access_code_hash FROM users WHERE id = ?')
    .get(req.user!.id) as
    | { id: number; role: 'teacher' | 'coordinator'; access_code_hash: string }
    | undefined;

  if (!user || !verifyAccessCode(currentCode, user.access_code_hash)) {
    res.status(401).json({ error: 'Kod akses semasa tidak sepadan.' });
    return;
  }

  const trimmed = newCode.trim();
  db.prepare('UPDATE users SET access_code_hash = ?, access_code_enc = ? WHERE id = ?').run(
    hashAccessCode(trimmed),
    user.role === 'teacher' ? encryptAccessCode(trimmed) : null,
    user.id
  );

  res.json({ ok: true, message: 'Kod akses peribadi berjaya dikemas kini.' });
});

export default router;
