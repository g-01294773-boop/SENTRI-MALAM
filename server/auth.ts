import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.ts';

export interface AuthenticatedUser {
  id: number;
  name: string;
  role: 'teacher' | 'coordinator';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      sessionToken?: string;
    }
  }
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSession(userId: number): { token: string; expiresAt: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(tokenHash, userId, expires.toISOString(), now.toISOString());
  return { token, expiresAt: expires.toISOString() };
}

export function revokeSession(token: string): void {
  const tokenHash = hashToken(token);
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function extractTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  const cookieToken = req.cookies?.sentri_session;
  if (typeof cookieToken === 'string' && cookieToken.trim()) {
    return cookieToken.trim();
  }
  return null;
}

export function authenticateOptional(req: Request, _res: Response, next: NextFunction): void {
  const token = extractTokenFromRequest(req);
  if (!token) {
    next();
    return;
  }
  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.role, u.active, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(tokenHash) as
    | {
        id: number;
        name: string;
        role: 'teacher' | 'coordinator';
        active: number;
        expires_at: string;
      }
    | undefined;

  if (!row || row.active !== 1 || new Date(row.expires_at).getTime() <= Date.now()) {
    if (row) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    }
    next();
    return;
  }

  req.user = { id: row.id, name: row.name, role: row.role };
  req.sessionToken = token;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      error: 'Sesi pengesahan diperlukan. Sila log masuk menggunakan akses peribadi anda.',
    });
    return;
  }
  next();
}

export function requireCoordinator(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      error: 'Sila log masuk sebagai Penyelaras menggunakan kod akses peribadi.',
    });
    return;
  }
  if (req.user.role !== 'coordinator') {
    res.status(403).json({
      error: 'Akses ditolak. Hanya Penyelaras dibenarkan melakukan tindakan ini.',
    });
    return;
  }
  next();
}

export function requireTeacher(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      error: 'Sila log masuk menggunakan nama dan kod akses peribadi guru anda.',
    });
    return;
  }
  if (req.user.role !== 'teacher') {
    res.status(403).json({
      error: 'Tindakan ini khusus untuk akaun guru.',
    });
    return;
  }
  next();
}
