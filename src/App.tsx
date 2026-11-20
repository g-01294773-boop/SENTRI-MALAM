import {
  ClipboardCheck,
  ClipboardList,
  LogIn,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AuthModal } from './components/AuthModal';
import { apiFetch, setStoredToken } from './lib/api';
import { LaporanSlotSayaPage } from './pages/LaporanSlotSayaPage';
import { PaparanPenyelarasPage } from './pages/PaparanPenyelarasPage';
import { PendaftaranGuruPage } from './pages/PendaftaranGuruPage';
import type {
  AuthUserDTO,
  CampNightDTO,
  EligibleTeacherDTO,
  SlotSummaryDTO,
} from './shared/constants';

type ActivePage = 'pendaftaran' | 'laporan' | 'penyelaras';

interface ScheduleResponse {
  campNights: CampNightDTO[];
  campNight: CampNightDTO;
  slots: SlotSummaryDTO[];
  eligibleTeachers: EligibleTeacherDTO[];
}

export default function App() {
  const [activePage, setActivePage] = useState<ActivePage>('pendaftaran');
  const [selectedCampNightId, setSelectedCampNightId] = useState<number | undefined>(
    undefined
  );
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [currentUser, setCurrentUser] = useState<AuthUserDTO | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authInitialMode, setAuthInitialMode] = useState<'teacher' | 'coordinator'>(
    'teacher'
  );

  const loadSchedule = useCallback(async (campNightId?: number) => {
    try {
      const qs = campNightId ? `?campNightId=${campNightId}` : '';
      const data = await apiFetch<ScheduleResponse>(`/api/schedule${qs}`);
      setSchedule(data);
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCurrentUser = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: AuthUserDTO | null }>('/api/auth/me');
      setCurrentUser((prev) => {
        const next = data.user;
        if (!next) return null;
        if (
          prev &&
          prev.id === next.id &&
          prev.name === next.name &&
          prev.role === next.role &&
          prev.registeredSlotNumber === next.registeredSlotNumber &&
          prev.leaderSlotNumber === next.leaderSlotNumber
        ) {
          return prev;
        }
        return next;
      });
    } catch {
      // Do not forcibly log out the user on transient network errors during background refresh
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadSchedule(selectedCampNightId), loadCurrentUser()]);
  }, [loadSchedule, loadCurrentUser, selectedCampNightId]);

  const handleRefreshAll = useCallback(async () => {
    await Promise.all([loadSchedule(selectedCampNightId), loadCurrentUser()]);
  }, [loadSchedule, loadCurrentUser, selectedCampNightId]);

  const handleOpenAuth = (mode: 'teacher' | 'coordinator' = 'teacher') => {
    setAuthInitialMode(mode);
    setAuthModalOpen(true);
  };

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setStoredToken(null);
    setCurrentUser(null);
    await loadSchedule(selectedCampNightId);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-24 md:pb-10">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 py-3 sm:px-6 lg:px-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActivePage('pendaftaran')}
            className="text-left text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 hover:text-teal-800"
          >
            Sentri Malam SK Tudan
          </button>

          {/* Zone 2: Clean Single-Line Nav Links */}
          <nav
            aria-label="Navigasi Utama"
            className="hidden md:flex items-center gap-6 text-sm font-medium"
          >
            <button
              type="button"
              onClick={() => setActivePage('pendaftaran')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activePage === 'pendaftaran'
                  ? 'border-teal-700 font-semibold text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Pendaftaran Guru
            </button>
            <button
              type="button"
              onClick={() => setActivePage('laporan')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activePage === 'laporan'
                  ? 'border-teal-700 font-semibold text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Laporan Slot Saya
            </button>
            <button
              type="button"
              onClick={() => setActivePage('penyelaras')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activePage === 'penyelaras'
                  ? 'border-teal-700 font-semibold text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Paparan Penyelaras
            </button>
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="flex items-center shrink-0">
            {currentUser ? (
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
                title={`Log masuk sebagai ${currentUser.name}`}
              >
                <LogOut className="h-3.5 w-3.5 text-slate-500" />
                <span className="max-w-[140px] truncate">{currentUser.name}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleOpenAuth('teacher')}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>Log Masuk</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8">
        {loading && !schedule ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-600">
            Memuatkan jadual dan data Perkhemahan SK Tudan 2026...
          </div>
        ) : loadError || !schedule ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-800">
            <p className="font-semibold">
              {loadError || 'Gagal memuatkan data daripada pelayan.'}
            </p>
            <button
              type="button"
              onClick={() => loadSchedule(selectedCampNightId)}
              className="mt-4 min-h-[44px] rounded-lg bg-red-700 px-5 py-2 text-xs font-semibold text-white hover:bg-red-800"
            >
              Cuba Semula
            </button>
          </div>
        ) : (
          <>
            {activePage === 'pendaftaran' && (
              <PendaftaranGuruPage
                campNights={schedule.campNights}
                campNight={schedule.campNight}
                slots={schedule.slots}
                eligibleTeachers={schedule.eligibleTeachers}
                currentUser={currentUser}
                onSelectCampNight={(id) => setSelectedCampNightId(id)}
                onOpenAuth={handleOpenAuth}
                onRefresh={handleRefreshAll}
              />
            )}

            {activePage === 'laporan' && (
              <LaporanSlotSayaPage
                campNightId={schedule.campNight.id}
                currentUser={currentUser}
                onOpenAuth={handleOpenAuth}
                onGoToCoordinator={() => setActivePage('penyelaras')}
                onRefreshSchedule={handleRefreshAll}
              />
            )}

            {activePage === 'penyelaras' && (
              <PaparanPenyelarasPage
                campNights={schedule.campNights}
                campNight={schedule.campNight}
                slots={schedule.slots}
                eligibleTeachers={schedule.eligibleTeachers}
                currentUser={currentUser}
                onSelectCampNight={(id) => setSelectedCampNightId(id)}
                onOpenAuth={handleOpenAuth}
                onRefresh={handleRefreshAll}
              />
            )}
          </>
        )}
      </main>

      {/* Mobile Fixed Bottom Tab Bar (Thumb Zone Ergonomics, <= 15% Viewport Cap) */}
      <nav
        aria-label="Navigasi Mudah Alih"
        className="fixed bottom-0 left-0 right-0 z-30 grid grid-cols-3 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        <button
          type="button"
          onClick={() => setActivePage('pendaftaran')}
          className={`flex min-h-[56px] flex-col items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold ${
            activePage === 'pendaftaran'
              ? 'text-teal-700'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <ClipboardList className="h-5 w-5" />
          <span className="truncate">Pendaftaran</span>
        </button>

        <button
          type="button"
          onClick={() => setActivePage('laporan')}
          className={`flex min-h-[56px] flex-col items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold ${
            activePage === 'laporan'
              ? 'text-teal-700'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <ClipboardCheck className="h-5 w-5" />
          <span className="truncate">Laporan Saya</span>
        </button>

        <button
          type="button"
          onClick={() => setActivePage('penyelaras')}
          className={`flex min-h-[56px] flex-col items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold ${
            activePage === 'penyelaras'
              ? 'text-teal-700'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <ShieldCheck className="h-5 w-5" />
          <span className="truncate">Penyelaras</span>
        </button>
      </nav>

      {/* Personal Access Auth Modal */}
      {schedule && (
        <AuthModal
          isOpen={authModalOpen}
          initialMode={authInitialMode}
          teachers={schedule.eligibleTeachers}
          onClose={() => setAuthModalOpen(false)}
          onSuccess={(user) => {
            setCurrentUser(user);
            void handleRefreshAll();
          }}
        />
      )}
    </div>
  );
}
