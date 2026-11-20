import { KeyRound, ShieldCheck, UserCheck, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { apiFetch, setStoredToken } from '../lib/api';
import type { AuthUserDTO, EligibleTeacherDTO } from '../shared/constants';

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: 'teacher' | 'coordinator';
  teachers: EligibleTeacherDTO[];
  onClose: () => void;
  onSuccess: (user: AuthUserDTO) => void;
}

export function AuthModal({
  isOpen,
  initialMode = 'teacher',
  teachers,
  onClose,
  onSuccess,
}: AuthModalProps) {
  const [mode, setMode] = useState<'teacher' | 'coordinator'>(initialMode);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('');
  const [accessCode, setAccessCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const payload =
        mode === 'coordinator'
          ? { mode: 'coordinator', accessCode }
          : {
              mode: 'teacher',
              teacherId: selectedTeacherId ? Number(selectedTeacherId) : undefined,
              accessCode,
            };

      const data = await apiFetch<{ token: string; user: AuthUserDTO }>(
        '/api/auth/login',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      );

      setStoredToken(data.token);
      setAccessCode('');
      onSuccess(data.user);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="auth-modal-title"
              className="text-lg font-bold text-slate-900"
            >
              Log Masuk Akses Peribadi
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              Pemilihan nama sahaja tidak memberikan kuasa sebagai Ketua Slot atau
              Penyelaras. Sahkan identiti menggunakan kod akses peribadi anda.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Tutup tetingkap log masuk"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => {
              setMode('teacher');
              setError(null);
            }}
            className={`min-h-[40px] rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
              mode === 'teacher'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Guru / Ketua Slot
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('coordinator');
              setError(null);
            }}
            className={`min-h-[40px] rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
              mode === 'coordinator'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Penyelaras
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {mode === 'teacher' ? (
            <div>
              <label
                htmlFor="auth-teacher-select"
                className="block text-sm font-semibold text-slate-800"
              >
                Nama Guru
              </label>
              <select
                id="auth-teacher-select"
                value={selectedTeacherId}
                onChange={(e) => setSelectedTeacherId(e.target.value)}
                required
                className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-base sm:text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              >
                <option value="">-- Pilih nama anda --</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.registeredSlotNumber
                      ? ` (Slot ${t.registeredSlotNumber}${t.isLeader ? ' · Ketua' : ''})`
                      : ' (Belum berdaftar)'}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs text-slate-700">
              <ShieldCheck className="h-5 w-5 shrink-0 text-teal-700" />
              <span>
                Akses Penyelaras Perkhemahan untuk pengurusan tarikh, kuota,
                pelantikan ketua serta muat turun laporan PDF dan ZIP.
              </span>
            </div>
          )}

          <div>
            <label
              htmlFor="auth-access-code"
              className="block text-sm font-semibold text-slate-800"
            >
              {mode === 'coordinator'
                ? 'Kod Akses Penyelaras'
                : 'Kod Akses Peribadi Guru'}
            </label>
            <div className="relative mt-1.5">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="auth-access-code"
                type="password"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                placeholder="Masukkan kod akses anda"
                required
                autoComplete="current-password"
                className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-3 text-base sm:text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </div>
            {mode === 'teacher' && (
              <p className="mt-1.5 text-xs text-slate-500">
                Hubungi Penyelaras sekiranya anda belum menerima atau terlupa kod akses peribadi anda.
              </p>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800"
            >
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-teal-700 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
            >
              <UserCheck className="h-4 w-4" />
              <span>{submitting ? 'Mengesahkan...' : 'Sahkan Akses'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
