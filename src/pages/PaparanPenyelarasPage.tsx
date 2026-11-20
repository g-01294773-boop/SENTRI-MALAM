import {
  AlertTriangle,
  Archive,
  ArrowRightLeft,
  Calendar,
  CheckCircle2,
  Cloud,
  Copy,
  Download,
  Edit3,
  Eye,
  FileArchive,
  FileText,
  Image as ImageIcon,
  KeyRound,
  Lock,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useFirebase } from '../components/FirebaseProvider';
import { ProtectedImage } from '../components/ProtectedImage';
import {
  ApiError,
  apiFetch,
  fetchProtectedBlob,
  triggerBlobDownload,
} from '../lib/api';
import type {
  AuthUserDTO,
  CampNightDTO,
  EligibleTeacherDTO,
  ReportDTO,
  SlotSummaryDTO,
} from '../shared/constants';
import { ReportReadOnlySummary } from './LaporanSlotSayaPage';

interface CoordinatorTeacherRow {
  id: number;
  name: string;
  accessCode: string | null;
  active: boolean;
  registeredSlotNumber: number | null;
  isSubstitute: boolean;
  isLeader: boolean;
}

interface PaparanPenyelarasPageProps {
  campNights: CampNightDTO[];
  campNight: CampNightDTO;
  slots: SlotSummaryDTO[];
  eligibleTeachers: EligibleTeacherDTO[];
  currentUser: AuthUserDTO | null;
  onSelectCampNight: (id: number) => void;
  onOpenAuth: (mode?: 'teacher' | 'coordinator') => void;
  onRefresh: () => Promise<void>;
}

export function PaparanPenyelarasPage({
  campNights,
  campNight,
  slots,
  eligibleTeachers,
  currentUser,
  onSelectCampNight,
  onOpenAuth,
  onRefresh,
}: PaparanPenyelarasPageProps) {
  const {
    firebaseUser,
    syncing: firebaseSyncing,
    lastSyncedAt,
    syncError,
    signInWithGoogle,
    signOutFirebase,
    syncScheduleNow,
  } = useFirebase();
  const [subTab, setSubTab] = useState<'dashboard' | 'slots' | 'teachers'>('dashboard');
  const [slotFilter, setSlotFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedZipSlots, setSelectedZipSlots] = useState<number[]>([]);

  // Coordinator teachers list (with personal codes)
  const [teachersList, setTeachersList] = useState<CoordinatorTeacherRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Camp night date editor
  const [editStartDate, setEditStartDate] = useState(campNight.startDate);
  const [editTitle, setEditTitle] = useState(campNight.title);
  const [newNightDate, setNewNightDate] = useState('');
  const [newNightTitle, setNewNightTitle] = useState('');
  const [showNewNightForm, setShowNewNightForm] = useState(false);

  // Slot quota editing
  const [quotaInputs, setQuotaInputs] = useState<Record<number, string>>({});

  // Leader appointment modal/inline
  const [leaderModalSlot, setLeaderModalSlot] = useState<SlotSummaryDTO | null>(null);
  const [leaderChoiceId, setLeaderChoiceId] = useState<string>('');

  // Assign teacher to slot
  const [assignSlotNumber, setAssignSlotNumber] = useState<number | null>(null);
  const [assignTeacherId, setAssignTeacherId] = useState<string>('');
  const [assignIsSubstitute, setAssignIsSubstitute] = useState(false);

  // Move / Remove teacher modal (handles leader replacement)
  const [moveModal, setMoveModal] = useState<{
    teacherId: number;
    teacherName: string;
    fromSlotNumber: number;
    isLeader: boolean;
    action: 'move' | 'remove';
  } | null>(null);
  const [moveTargetSlot, setMoveTargetSlot] = useState<string>('');
  const [replacementLeaderId, setReplacementLeaderId] = useState<string>('');

  // Teacher create / edit
  const [newTeacherName, setNewTeacherName] = useState('');
  const [editingTeacherId, setEditingTeacherId] = useState<number | null>(null);
  const [editingTeacherName, setEditingTeacherName] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Report & photo viewing modals
  const [viewingReport, setViewingReport] = useState<ReportDTO | null>(null);
  const [viewingPhotosReport, setViewingPhotosReport] = useState<ReportDTO | null>(null);

  // Bulk PDF & ZIP export confirmation & progress
  const [exportConfirm, setExportConfirm] = useState<{
    format: 'pdf' | 'zip';
    mode: 'selected' | 'all';
    slotNumbers: number[];
  } | null>(null);
  const [exportState, setExportState] = useState<{
    format: 'pdf' | 'zip';
    generating: boolean;
    progressLabel: string;
    error: { message: string; slotNumber?: number; fileName?: string } | null;
    successMessage: string | null;
    lastSlotNumbers: number[];
  }>({
    format: 'pdf',
    generating: false,
    progressLabel: '',
    error: null,
    successMessage: null,
    lastSlotNumbers: [],
  });

  useEffect(() => {
    setEditStartDate(campNight.startDate);
    setEditTitle(campNight.title);
  }, [campNight]);

  useEffect(() => {
    const q: Record<number, string> = {};
    for (const s of slots) {
      q[s.slotNumber] = s.quota !== null ? String(s.quota) : '';
    }
    setQuotaInputs(q);
  }, [slots]);

  const loadCoordinatorTeachers = useCallback(async () => {
    if (currentUser?.role !== 'coordinator') return;
    try {
      const data = await apiFetch<{ teachers: CoordinatorTeacherRow[] }>(
        `/api/coordinator/teachers?campNightId=${campNight.id}`
      );
      setTeachersList(data.teachers);
    } catch {
      // handled on action
    }
  }, [campNight.id, currentUser?.role]);

  useEffect(() => {
    void loadCoordinatorTeachers();
  }, [loadCoordinatorTeachers]);

  const submittedSlots = useMemo(
    () => slots.filter((s) => s.reportStatus === 'Telah dihantar'),
    [slots]
  );

  const pendingReportSlots = useMemo(
    () => slots.filter((s) => s.reportStatus !== 'Telah dihantar'),
    [slots]
  );

  const appointedLeaderCount = useMemo(
    () => slots.filter((s) => s.leaderTeacherId !== null).length,
    [slots]
  );

  const followUpCount = useMemo(
    () => slots.filter((s) => s.followUpStatus === 'Perlu tindakan susulan').length,
    [slots]
  );

  const filteredSlots = useMemo(() => {
    return slots.filter((s) => {
      if (slotFilter !== 'all' && s.slotNumber !== Number(slotFilter)) {
        return false;
      }
      if (statusFilter !== 'all' && s.reportStatus !== statusFilter) {
        return false;
      }
      return true;
    });
  }, [slots, slotFilter, statusFilter]);

  const unregisteredTeachers = useMemo(
    () => eligibleTeachers.filter((t) => t.registeredSlotNumber === null),
    [eligibleTeachers]
  );

  if (currentUser?.role !== 'coordinator') {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-800">
          <Lock className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-xl font-bold text-slate-900">
          Paparan Penyelaras Perkhemahan
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Halaman ini memerlukan pengesahan kod akses peribadi Penyelaras untuk mengurus tarikh perkhemahan, kuota slot, pelantikan ketua, serta muat turun laporan PDF dan ZIP.
        </p>
        <button
          type="button"
          onClick={() => onOpenAuth('coordinator')}
          className="mt-6 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
        >
          <ShieldCheck className="h-4 w-4" />
          <span>Log Masuk Sebagai Penyelaras</span>
        </button>
      </div>
    );
  }

  const clearAlerts = () => {
    setNotice(null);
    setError(null);
  };

  const handleSaveCampDate = async (e: FormEvent) => {
    e.preventDefault();
    clearAlerts();
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/coordinator/camp-nights/${campNight.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({ startDate: editStartDate, title: editTitle }),
        }
      );
      setNotice(res.message);
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleCreateCampNight = async (e: FormEvent) => {
    e.preventDefault();
    clearAlerts();
    try {
      const res = await apiFetch<{ message: string; campNight: CampNightDTO }>(
        '/api/coordinator/camp-nights',
        {
          method: 'POST',
          body: JSON.stringify({
            startDate: newNightDate,
            title: newNightTitle,
          }),
        }
      );
      setNotice(res.message);
      setShowNewNightForm(false);
      setNewNightDate('');
      setNewNightTitle('');
      onSelectCampNight(res.campNight.id);
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleSaveQuota = async (slotNumber: number) => {
    clearAlerts();
    const raw = quotaInputs[slotNumber];
    if (!raw || !raw.trim()) {
      setError(`Sila masukkan nombor kuota untuk Slot ${slotNumber}.`);
      return;
    }
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/coordinator/slots/${slotNumber}/quota`,
        {
          method: 'PUT',
          body: JSON.stringify({
            campNightId: campNight.id,
            quota: Number(raw),
          }),
        }
      );
      setNotice(res.message);
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleConfirmLeader = async (e: FormEvent) => {
    e.preventDefault();
    if (!leaderModalSlot) return;
    clearAlerts();
    if (!leaderChoiceId) {
      setError('Sila pilih seorang guru berdaftar daripada slot ini.');
      return;
    }
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/coordinator/slots/${leaderModalSlot.slotNumber}/leader`,
        {
          method: 'PUT',
          body: JSON.stringify({
            campNightId: campNight.id,
            leaderTeacherId: Number(leaderChoiceId),
          }),
        }
      );
      setNotice(res.message);
      setLeaderModalSlot(null);
      setLeaderChoiceId('');
      await Promise.all([onRefresh(), loadCoordinatorTeachers()]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleAssignTeacher = async (e: FormEvent) => {
    e.preventDefault();
    if (!assignSlotNumber || !assignTeacherId) return;
    clearAlerts();
    try {
      const res = await apiFetch<{ message: string }>(
        '/api/coordinator/registrations/assign',
        {
          method: 'POST',
          body: JSON.stringify({
            campNightId: campNight.id,
            slotNumber: assignSlotNumber,
            teacherId: Number(assignTeacherId),
            isSubstitute: assignIsSubstitute,
          }),
        }
      );
      setNotice(res.message);
      setAssignSlotNumber(null);
      setAssignTeacherId('');
      setAssignIsSubstitute(false);
      await Promise.all([onRefresh(), loadCoordinatorTeachers()]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleMoveOrRemoveSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!moveModal) return;
    clearAlerts();
    try {
      if (moveModal.action === 'move') {
        if (!moveTargetSlot) {
          setError('Sila pilih slot destinasi yang mempunyai kekosongan.');
          return;
        }
        const res = await apiFetch<{ message: string }>(
          '/api/coordinator/registrations/move',
          {
            method: 'POST',
            body: JSON.stringify({
              campNightId: campNight.id,
              teacherId: moveModal.teacherId,
              targetSlotNumber: Number(moveTargetSlot),
              replacementLeaderTeacherId: replacementLeaderId
                ? Number(replacementLeaderId)
                : null,
            }),
          }
        );
        setNotice(res.message);
      } else {
        const res = await apiFetch<{ message: string }>(
          '/api/coordinator/registrations',
          {
            method: 'DELETE',
            body: JSON.stringify({
              campNightId: campNight.id,
              teacherId: moveModal.teacherId,
              replacementLeaderTeacherId: replacementLeaderId
                ? Number(replacementLeaderId)
                : null,
            }),
          }
        );
        setNotice(res.message);
      }
      setMoveModal(null);
      setMoveTargetSlot('');
      setReplacementLeaderId('');
      await Promise.all([onRefresh(), loadCoordinatorTeachers()]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleAddTeacher = async (e: FormEvent) => {
    e.preventDefault();
    clearAlerts();
    if (!newTeacherName.trim()) return;
    try {
      const res = await apiFetch<{
        message: string;
        teacher: { id: number; name: string; accessCode: string };
      }>('/api/coordinator/teachers', {
        method: 'POST',
        body: JSON.stringify({ name: newTeacherName }),
      });
      setNotice(
        `${res.message} Kod akses peribadi: ${res.teacher.accessCode}`
      );
      setNewTeacherName('');
      await Promise.all([onRefresh(), loadCoordinatorTeachers()]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleSaveTeacherSpelling = async (teacherId: number) => {
    clearAlerts();
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/coordinator/teachers/${teacherId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ name: editingTeacherName }),
        }
      );
      setNotice(res.message);
      setEditingTeacherId(null);
      await Promise.all([onRefresh(), loadCoordinatorTeachers()]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleResetTeacherCode = async (teacherId: number, teacherName: string) => {
    clearAlerts();
    try {
      const res = await apiFetch<{ message: string; accessCode: string }>(
        `/api/coordinator/teachers/${teacherId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ resetCode: true }),
        }
      );
      setNotice(`Kod akses baharu untuk ${teacherName}: ${res.accessCode}`);
      await loadCoordinatorTeachers();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleOpenReportModal = async (slotNumber: number, mode: 'report' | 'photos') => {
    clearAlerts();
    try {
      const data = await apiFetch<{ report: ReportDTO }>(
        `/api/coordinator/reports/${slotNumber}?campNightId=${campNight.id}`
      );
      if (mode === 'report') {
        setViewingReport(data.report);
      } else {
        setViewingPhotosReport(data.report);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleReopenReport = async (slotNumber: number) => {
    clearAlerts();
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/coordinator/reports/${slotNumber}/reopen`,
        {
          method: 'POST',
          body: JSON.stringify({ campNightId: campNight.id }),
        }
      );
      setNotice(res.message);
      setViewingReport(null);
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDownloadSlotPdf = async (
    reportId: number,
    slotNumber: number,
    allowDraft = false
  ) => {
    clearAlerts();
    try {
      const qs = allowDraft ? '?allowDraft=1' : '';
      const { blob, filename } = await fetchProtectedBlob(
        `/api/reports/${reportId}/pdf${qs}`
      );
      const slotPad = String(slotNumber).padStart(2, '0');
      const fallback = allowDraft
        ? `Draf_Laporan_Slot_${slotPad}.pdf`
        : `Laporan_Slot_${slotPad}.pdf`;
      triggerBlobDownload(blob, filename || fallback);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const executeBulkExport = async (
    format: 'pdf' | 'zip',
    slotNumbers: number[]
  ) => {
    setExportConfirm(null);
    setExportState({
      format,
      generating: true,
      progressLabel:
        format === 'pdf'
          ? `Menjana dokumen PDF lengkap tersusun bagi ${slotNumbers.length} slot...`
          : `Menjana Ringkasan_Laporan.pdf dan fail ZIP bagi ${slotNumbers.length} slot...`,
      error: null,
      successMessage: null,
      lastSlotNumbers: slotNumbers,
    });

    try {
      const endpoint =
        format === 'pdf'
          ? '/api/coordinator/export-pdf'
          : '/api/coordinator/export-zip';

      const { blob, filename, headers } = await fetchProtectedBlob(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          campNightId: campNight.id,
          slotNumbers,
        }),
      });

      const finalName =
        filename ||
        (format === 'pdf'
          ? `Laporan_Sentri_Malam_SK_Tudan_2026_${campNight.startDate}.pdf`
          : `Sentri_Malam_SK_Tudan_2026_${campNight.startDate}.zip`);
      triggerBlobDownload(blob, finalName);

      if (format === 'pdf') {
        setExportState({
          format: 'pdf',
          generating: false,
          progressLabel: '',
          error: null,
          successMessage: `Muat turun PDF pukal berjaya (${finalName} · ${slotNumbers.length} slot digabungkan mengikut susunan).`,
          lastSlotNumbers: slotNumbers,
        });
      } else {
        const fileCount = headers.get('X-File-Count');
        setExportState({
          format: 'zip',
          generating: false,
          progressLabel: '',
          error: null,
          successMessage: `Eksport ZIP berjaya (${finalName} · ${slotNumbers.length} slot, ${fileCount || ''} fail dimasukkan).`,
          lastSlotNumbers: slotNumbers,
        });
      }
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      const detail = apiErr?.data?.detail as
        | { slotNumber?: number; fileName?: string; message?: string }
        | undefined;
      setExportState({
        format,
        generating: false,
        progressLabel: '',
        error: {
          message: (err as Error).message,
          slotNumber: detail?.slotNumber,
          fileName: detail?.fileName,
        },
        successMessage: null,
        lastSlotNumbers: slotNumbers,
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header + Sub-Navigation */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold text-teal-700">
              Akses Penyelaras Perkhemahan
            </p>
            <h1 className="mt-1 text-xl font-bold text-slate-900 sm:text-2xl">
              Paparan Penyelaras — Sentri Malam SK Tudan 2026
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1">
            {(
              [
                { id: 'dashboard', label: 'Papan Pemuka & Muat Turun' },
                { id: 'slots', label: 'Slot, Kuota & Ketua' },
                { id: 'teachers', label: 'Guru & Kod Akses' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id)}
                className={`min-h-[40px] rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                  subTab === tab.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* 4-column KPI Strip */}
        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-5 lg:grid-cols-4">
          <div>
            <span className="text-xs text-slate-500">Status Laporan</span>
            <p className="mt-1 text-lg font-bold text-slate-900 font-mono tabular-nums">
              {submittedSlots.length} daripada 6 laporan telah dihantar
            </p>
          </div>
          <div>
            <span className="text-xs text-slate-500">Pelantikan Ketua</span>
            <p className="mt-1 text-lg font-bold text-slate-900 font-mono tabular-nums">
              Ketua telah ditetapkan bagi {appointedLeaderCount} daripada 6 slot
            </p>
          </div>
          <div>
            <span className="text-xs text-slate-500">Perkara Tindakan Susulan</span>
            <p className="mt-1 text-lg font-bold text-slate-900 font-mono tabular-nums">
              {followUpCount} slot
            </p>
          </div>
          <div>
            <span className="text-xs text-slate-500">Malam Perkhemahan</span>
            <p className="mt-1 text-lg font-bold text-slate-900 font-mono tabular-nums">
              {campNight.startDateDisplay}
            </p>
          </div>
        </div>
      </section>

      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-emerald-700 hover:text-emerald-950"
            aria-label="Tutup notis"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-700 hover:text-red-950"
            aria-label="Tutup mesej ralat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* TAB 1: DASHBOARD & EXPORTS */}
      {subTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Pending slots notice */}
          {pendingReportSlots.length > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-950">
              <span className="font-semibold">Slot belum menghantar laporan: </span>
              <span>
                {pendingReportSlots
                  .map((s) => `Slot ${s.slotNumber} (${s.reportStatus})`)
                  .join(', ')}
              </span>
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
              Semua enam slot bagi malam perkhemahan ini telah menghantar laporan lengkap.
            </div>
          )}

          {/* Firebase Google Auth & Firestore Cloud Backup */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <Cloud className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" />
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Sandaran Awan Firebase Firestore
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {firebaseUser
                      ? `Log masuk Google disahkan (${firebaseUser.email})${
                          lastSyncedAt ? ` · Diselaraskan pada ${lastSyncedAt}` : ''
                        }`
                      : 'Sambungkan akaun Google untuk menyimpan sandaran jadual slot dan ringkasan laporan ke Firebase Firestore.'}
                  </p>
                  {syncError && (
                    <p className="mt-1 text-xs font-medium text-red-700">{syncError}</p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {firebaseUser ? (
                  <>
                    <button
                      type="button"
                      disabled={firebaseSyncing}
                      onClick={() => void syncScheduleNow(campNight, slots)}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${firebaseSyncing ? 'animate-spin' : ''}`}
                      />
                      <span>
                        {firebaseSyncing ? 'Menyelaras...' : 'Selaras ke Firestore'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void signOutFirebase()}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      <span>Putus Google</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => void signInWithGoogle()}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    <LogIn className="h-3.5 w-3.5" />
                    <span>Log Masuk Google (Firebase)</span>
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Filters & Bulk ZIP Toolbar */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600">
                  Tapis Malam Perkhemahan
                </label>
                <select
                  value={campNight.id}
                  onChange={(e) => {
                    setSelectedZipSlots([]);
                    onSelectCampNight(Number(e.target.value));
                  }}
                  className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {campNights.map((cn) => (
                    <option key={cn.id} value={cn.id}>
                      {cn.title} ({cn.startDateDisplay})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600">
                  Tapis Slot
                </label>
                <select
                  value={slotFilter}
                  onChange={(e) => setSlotFilter(e.target.value)}
                  className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="all">Semua Slot (1 – 6)</option>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      Slot {n}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600">
                  Tapis Status Laporan
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="all">Semua Status</option>
                  <option value="Belum diisi">Belum diisi</option>
                  <option value="Draf">Draf</option>
                  <option value="Telah dihantar">Telah dihantar</option>
                </select>
              </div>
            </div>

            <div className="space-y-3 border-t border-slate-100 pt-4">
              <div className="text-xs text-slate-600">
                Tandakan kotak pilihan pada slot yang sudah menghantar laporan untuk muat turun pukal PDF atau ZIP mengikut slot terpilih, atau muat turun semua laporan yang telah dihantar sekaligus.
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={selectedZipSlots.length === 0 || exportState.generating}
                  onClick={() =>
                    setExportConfirm({
                      format: 'pdf',
                      mode: 'selected',
                      slotNumbers: [...selectedZipSlots].sort((a, b) => a - b),
                    })
                  }
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-teal-700 bg-teal-50 px-4 py-2 text-xs font-semibold text-teal-950 hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FileText className="h-4 w-4" />
                  <span>
                    Muat Turun PDF Pukal (Terpilih) ({selectedZipSlots.length})
                  </span>
                </button>

                <button
                  type="button"
                  disabled={submittedSlots.length === 0 || exportState.generating}
                  onClick={() =>
                    setExportConfirm({
                      format: 'pdf',
                      mode: 'all',
                      slotNumbers: submittedSlots.map((s) => s.slotNumber),
                    })
                  }
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  <span>
                    Muat Turun Semua Laporan PDF (Pukal) ({submittedSlots.length})
                  </span>
                </button>

                <button
                  type="button"
                  disabled={selectedZipSlots.length === 0 || exportState.generating}
                  onClick={() =>
                    setExportConfirm({
                      format: 'zip',
                      mode: 'selected',
                      slotNumbers: [...selectedZipSlots].sort((a, b) => a - b),
                    })
                  }
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Archive className="h-4 w-4" />
                  <span>
                    Muat Turun Slot Terpilih (ZIP) ({selectedZipSlots.length})
                  </span>
                </button>

                <button
                  type="button"
                  disabled={submittedSlots.length === 0 || exportState.generating}
                  onClick={() =>
                    setExportConfirm({
                      format: 'zip',
                      mode: 'all',
                      slotNumbers: submittedSlots.map((s) => s.slotNumber),
                    })
                  }
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FileArchive className="h-4 w-4" />
                  <span>
                    Muat Turun Semua Laporan (ZIP) ({submittedSlots.length})
                  </span>
                </button>
              </div>
            </div>

            {/* Bulk Export Progress / Result */}
            {exportState.generating && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
                <div className="flex items-center gap-2 font-medium">
                  <RefreshCw className="h-4 w-4 animate-spin text-teal-700" />
                  <span>{exportState.progressLabel}</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full w-2/3 animate-pulse bg-teal-700" />
                </div>
              </div>
            )}

            {exportState.error && (
              <div
                role="alert"
                className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-bold">
                    {exportState.format === 'pdf'
                      ? 'Penjanaan PDF Pukal Gagal'
                      : 'Penjanaan Fail ZIP Gagal'}
                  </p>
                  <p className="mt-0.5 text-xs">
                    {exportState.error.slotNumber
                      ? `Slot ${exportState.error.slotNumber} · `
                      : ''}
                    {exportState.error.fileName
                      ? `Fail: ${exportState.error.fileName} — `
                      : ''}
                    {exportState.error.message}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    executeBulkExport(
                      exportState.format,
                      exportState.lastSlotNumbers
                    )
                  }
                  className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Cuba Semula</span>
                </button>
              </div>
            )}

            {exportState.successMessage && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-medium text-emerald-900">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
                <span>{exportState.successMessage}</span>
              </div>
            )}
          </section>

          {/* Bulk Export Confirmation Dialog */}
          {exportConfirm && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
            >
              <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
                <h2 className="text-lg font-bold text-slate-900">
                  {exportConfirm.format === 'pdf'
                    ? 'Sahkan Muat Turun PDF Pukal'
                    : 'Sahkan Muat Turun Fail ZIP'}
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  {exportConfirm.format === 'pdf'
                    ? 'Satu dokumen PDF rasmi akan dijana dengan Ringkasan Laporan diikuti laporan lengkap tersusun bagi setiap slot terpilih (termasuk dua gambar setiap slot).'
                    : 'Arkib ZIP akan dijana mengikut struktur folder rasmi bersama Ringkasan_Laporan.pdf dan fail PDF serta gambar bagi setiap slot.'}
                </p>
                <dl className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Nombor Slot Disertakan</dt>
                    <dd className="font-semibold text-slate-900">
                      {exportConfirm.slotNumbers.map((n) => `Slot ${n}`).join(', ')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Jumlah Laporan</dt>
                    <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                      {exportConfirm.slotNumbers.length} laporan lengkap
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">
                      {exportConfirm.format === 'pdf'
                        ? 'Nama Fail PDF'
                        : 'Nama Fail ZIP'}
                    </dt>
                    <dd className="font-mono text-xs text-slate-800 break-all">
                      {exportConfirm.format === 'pdf'
                        ? `Laporan_Sentri_Malam_SK_Tudan_2026_${campNight.startDate}.pdf`
                        : `Sentri_Malam_SK_Tudan_2026_${campNight.startDate}.zip`}
                    </dd>
                  </div>
                </dl>
                <div className="mt-5 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setExportConfirm(null)}
                    className="min-h-[44px] rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      executeBulkExport(
                        exportConfirm.format,
                        exportConfirm.slotNumbers
                      )
                    }
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-teal-700 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-800"
                  >
                    <Download className="h-4 w-4" />
                    <span>
                      {exportConfirm.format === 'pdf'
                        ? 'Jana & Muat Turun PDF'
                        : 'Jana & Muat Turun ZIP'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Desktop Table View + Mobile Cards View */}
          <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            {/* Desktop table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Pilih</th>
                    <th className="px-4 py-3">Slot &amp; Waktu</th>
                    <th className="px-4 py-3">Ketua Slot</th>
                    <th className="px-4 py-3 text-right">Petugas</th>
                    <th className="px-4 py-3">Status Laporan</th>
                    <th className="px-4 py-3 text-right">Gambar</th>
                    <th className="px-4 py-3">Susulan</th>
                    <th className="px-4 py-3">Masa Hantar</th>
                    <th className="px-4 py-3 text-right">Tindakan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSlots.map((s) => {
                    const isSubmitted = s.reportStatus === 'Telah dihantar';
                    const isDraft = s.reportStatus === 'Draf';
                    const checked = selectedZipSlots.includes(s.slotNumber);

                    return (
                      <tr key={s.slotNumber} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3.5">
                          <input
                            type="checkbox"
                            disabled={!isSubmitted}
                            checked={checked}
                            aria-label={`Pilih Slot ${s.slotNumber} untuk muat turun ZIP`}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedZipSlots((prev) => [...prev, s.slotNumber]);
                              } else {
                                setSelectedZipSlots((prev) =>
                                  prev.filter((n) => n !== s.slotNumber)
                                );
                              }
                            }}
                            className="h-4 w-4 rounded border-slate-300 text-teal-700 disabled:opacity-30"
                          />
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="font-bold text-slate-900">
                            Slot {s.slotNumber}
                          </div>
                          <div className="font-mono text-xs text-slate-500 tabular-nums">
                            {s.displayTime}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-slate-800">
                          {s.leaderName || (
                            <span className="text-amber-700">Ketua belum ditetapkan</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono tabular-nums text-slate-800">
                          {s.registeredCount}
                          {s.quota !== null ? `/${s.quota}` : ''}
                        </td>
                        <td className="px-4 py-3.5 font-semibold">
                          <span
                            className={
                              isSubmitted
                                ? 'text-emerald-700'
                                : isDraft
                                ? 'text-amber-700'
                                : 'text-slate-500'
                            }
                          >
                            {s.reportStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono tabular-nums text-slate-800">
                          {s.photoCount}/2
                        </td>
                        <td className="px-4 py-3.5 text-xs">
                          <span
                            className={
                              s.followUpStatus === 'Perlu tindakan susulan'
                                ? 'font-semibold text-red-700'
                                : 'text-slate-600'
                            }
                          >
                            {s.followUpStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 font-mono text-xs text-slate-600 tabular-nums">
                          {s.submittedAtDisplay || '-'}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <div className="inline-flex items-center gap-2">
                            {(isSubmitted || isDraft) && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleOpenReportModal(s.slotNumber, 'report')}
                                  className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  <span>Lihat Laporan</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleOpenReportModal(s.slotNumber, 'photos')}
                                  className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap"
                                >
                                  <ImageIcon className="h-3.5 w-3.5" />
                                  <span>Lihat Gambar</span>
                                </button>
                              </>
                            )}
                            {isSubmitted && s.reportId && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleDownloadSlotPdf(s.reportId!, s.slotNumber)
                                }
                                className="inline-flex min-h-[36px] items-center gap-1 rounded-md bg-teal-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 whitespace-nowrap"
                              >
                                <Download className="h-3.5 w-3.5" />
                                <span>Muat Turun PDF Slot Ini</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="divide-y divide-slate-200 lg:hidden">
              {filteredSlots.map((s) => {
                const isSubmitted = s.reportStatus === 'Telah dihantar';
                const isDraft = s.reportStatus === 'Draf';
                const checked = selectedZipSlots.includes(s.slotNumber);

                return (
                  <div key={s.slotNumber} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          disabled={!isSubmitted}
                          checked={checked}
                          aria-label={`Pilih Slot ${s.slotNumber}`}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedZipSlots((prev) => [...prev, s.slotNumber]);
                            } else {
                              setSelectedZipSlots((prev) =>
                                prev.filter((n) => n !== s.slotNumber)
                              );
                            }
                          }}
                          className="mt-1 h-5 w-5 rounded border-slate-300 text-teal-700 disabled:opacity-30"
                        />
                        <div>
                          <div className="font-bold text-slate-900">
                            Slot {s.slotNumber} · {s.displayTime}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-600">
                            Ketua: {s.leaderName || 'Ketua belum ditetapkan'}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`text-xs font-bold ${
                          isSubmitted
                            ? 'text-emerald-700'
                            : isDraft
                            ? 'text-amber-700'
                            : 'text-slate-500'
                        }`}
                      >
                        {s.reportStatus}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 font-mono tabular-nums">
                      <span>Petugas: {s.registeredCount}</span>
                      <span>Gambar: {s.photoCount}/2</span>
                      <span>Susulan: {s.followUpStatus}</span>
                      {s.submittedAtDisplay && <span>Hantar: {s.submittedAtDisplay}</span>}
                    </div>

                    {(isSubmitted || isDraft) && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleOpenReportModal(s.slotNumber, 'report')}
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>Lihat Laporan</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenReportModal(s.slotNumber, 'photos')}
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800"
                        >
                          <ImageIcon className="h-3.5 w-3.5" />
                          <span>Lihat Gambar</span>
                        </button>
                        {isSubmitted && s.reportId && (
                          <button
                            type="button"
                            onClick={() => handleDownloadSlotPdf(s.reportId!, s.slotNumber)}
                            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white"
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span>Muat Turun PDF Slot Ini</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* TAB 2: SLOTS, QUOTA, LEADER APPOINTMENT & TRANSFERS */}
      {subTab === 'slots' && (
        <div className="space-y-6">
          {/* Camp Date Setup Card */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Tarikh Mula Malam Perkhemahan (Zon Waktu Malaysia)
                </h2>
                <p className="mt-0.5 text-xs text-slate-600">
                  Slot 1 tamat pada tarikh D, Slot 2 merentas tengah malam (D → D+1), manakala Slot 3 hingga Slot 6 jatuh pada tarikh D+1.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewNightForm((v) => !v)}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Tambah Malam Perkhemahan Baharu</span>
              </button>
            </div>

            <form
              onSubmit={handleSaveCampDate}
              className="grid grid-cols-1 gap-3 sm:grid-cols-3 items-end"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Nama Malam Perkhemahan
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  required
                  className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Tarikh mula malam perkhemahan
                </label>
                <input
                  type="date"
                  value={editStartDate}
                  onChange={(e) => setEditStartDate(e.target.value)}
                  required
                  className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <button
                type="submit"
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <Calendar className="h-4 w-4" />
                <span>Simpan Tarikh</span>
              </button>
            </form>

            {showNewNightForm && (
              <form
                onSubmit={handleCreateCampNight}
                className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3 items-end"
              >
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Tajuk Malam Baharu
                  </label>
                  <input
                    type="text"
                    value={newNightTitle}
                    onChange={(e) => setNewNightTitle(e.target.value)}
                    placeholder="Cth: Malam Perkhemahan 2"
                    required
                    className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Tarikh Mula Baharu
                  </label>
                  <input
                    type="date"
                    value={newNightDate}
                    onChange={(e) => setNewNightDate(e.target.value)}
                    required
                    className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <button
                  type="submit"
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
                >
                  Cipta Malam Perkhemahan
                </button>
              </form>
            )}
          </section>

          {/* Slots Management Cards */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {slots.map((slot) => (
              <article
                key={slot.slotNumber}
                className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Slot {slot.slotNumber} · {slot.displayTime}
                    </h3>
                    <p className="font-mono text-xs text-slate-500 tabular-nums">
                      {slot.startDate === slot.endDate
                        ? slot.startDateDisplay
                        : `${slot.startDateDisplay} → ${slot.endDateDisplay}`}{' '}
                      · Berdaftar: {slot.registeredCount} orang
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setLeaderModalSlot(slot);
                      setLeaderChoiceId(
                        slot.leaderTeacherId ? String(slot.leaderTeacherId) : ''
                      );
                    }}
                    className="min-h-[40px] rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-800 whitespace-nowrap"
                  >
                    {slot.leaderTeacherId ? 'Tukar Ketua' : 'Tetapkan Ketua'}
                  </button>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Ketua Slot Semasa:</span>
                  <span
                    className={`font-semibold ${
                      slot.leaderName ? 'text-teal-800' : 'text-amber-700'
                    }`}
                  >
                    {slot.leaderName || 'Ketua belum ditetapkan'}
                  </span>
                </div>

                {/* Quota control */}
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-slate-700">
                      Kuota Slot (minimum {slot.registeredCount})
                    </label>
                    <input
                      type="number"
                      min={Math.max(1, slot.registeredCount)}
                      value={quotaInputs[slot.slotNumber] ?? ''}
                      onChange={(e) =>
                        setQuotaInputs((prev) => ({
                          ...prev,
                          [slot.slotNumber]: e.target.value,
                        }))
                      }
                      placeholder="Belum ditetapkan"
                      className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSaveQuota(slot.slotNumber)}
                    className="min-h-[40px] rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                  >
                    Simpan Kuota
                  </button>
                </div>

                {/* Members in slot with Transfer / Remove */}
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      Petugas Slot
                    </span>
                    {slot.isOpenForRegistration && unregisteredTeachers.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setAssignSlotNumber(slot.slotNumber);
                          setAssignTeacherId('');
                          setAssignIsSubstitute(false);
                        }}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        <span>Daftar / Pengganti</span>
                      </button>
                    )}
                  </div>

                  {slot.members.length === 0 ? (
                    <p className="text-xs italic text-slate-400">
                      Tiada guru berdaftar dalam slot ini.
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {slot.members.map((m) => (
                        <li
                          key={m.teacherId}
                          className="flex items-center justify-between gap-2 py-2 text-sm"
                        >
                          <div>
                            <span className="font-medium text-slate-900">{m.name}</span>
                            {m.isLeader && (
                              <span className="ml-2 text-xs font-semibold text-teal-700">
                                (Ketua Slot)
                              </span>
                            )}
                            {m.isSubstitute && (
                              <span className="ml-2 text-xs text-slate-500">
                                (Pengganti)
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setMoveModal({
                                  teacherId: m.teacherId,
                                  teacherName: m.name,
                                  fromSlotNumber: slot.slotNumber,
                                  isLeader: m.isLeader,
                                  action: 'move',
                                });
                                setMoveTargetSlot('');
                                setReplacementLeaderId('');
                              }}
                              className="inline-flex min-h-[34px] items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <ArrowRightLeft className="h-3 w-3" />
                              <span>Pindah</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setMoveModal({
                                  teacherId: m.teacherId,
                                  teacherName: m.name,
                                  fromSlotNumber: slot.slotNumber,
                                  isLeader: m.isLeader,
                                  action: 'remove',
                                });
                                setReplacementLeaderId('');
                              }}
                              className="inline-flex min-h-[34px] items-center rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                            >
                              Keluarkan
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: TEACHERS & PERSONAL ACCESS CODES */}
      {subTab === 'teachers' && (
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <h2 className="text-base font-bold text-slate-900">
              Tambah Guru Baharu ke Senarai Layak
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              Setiap guru yang ditambah akan menerima kod akses peribadi unik untuk log masuk dan pendaftaran slot.
            </p>
            <form
              onSubmit={handleAddTeacher}
              className="mt-4 flex flex-col gap-3 sm:flex-row"
            >
              <input
                type="text"
                value={newTeacherName}
                onChange={(e) => setNewTeacherName(e.target.value)}
                placeholder="Nama penuh guru baharu"
                required
                className="flex-1 min-h-[44px] rounded-lg border border-slate-300 px-3.5 py-2 text-sm"
              />
              <button
                type="submit"
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-teal-700 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-800"
              >
                <UserPlus className="h-4 w-4" />
                <span>Tambah Guru</span>
              </button>
            </form>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-bold text-slate-900">
                Senarai Guru &amp; Kod Akses Peribadi ({teachersList.length} orang)
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Edarkan kod akses peribadi kepada guru masing-masing bagi tujuan pengesahan identiti.
              </p>
            </div>

            <div className="divide-y divide-slate-100">
              {teachersList.map((t) => (
                <div
                  key={t.id}
                  className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    {editingTeacherId === t.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={editingTeacherName}
                          onChange={(e) => setEditingTeacherName(e.target.value)}
                          className="min-h-[38px] flex-1 rounded-lg border border-slate-300 px-3 py-1 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveTeacherSpelling(t.id)}
                          className="min-h-[38px] rounded-lg bg-teal-700 px-3 py-1 text-xs font-semibold text-white"
                        >
                          Simpan
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTeacherId(null)}
                          className="min-h-[38px] rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700"
                        >
                          Batal
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900">{t.name}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTeacherId(t.id);
                            setEditingTeacherName(t.name);
                          }}
                          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
                          title="Betulkan ejaan nama"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    <p className="mt-0.5 text-xs text-slate-500">
                      {t.registeredSlotNumber
                        ? `Slot ${t.registeredSlotNumber}${t.isLeader ? ' · Ketua Slot' : ' · Petugas'}`
                        : 'Belum berdaftar dalam slot'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-xs text-slate-900">
                      <KeyRound className="h-3.5 w-3.5 text-slate-400" />
                      <span>{t.accessCode || '—'}</span>
                    </div>

                    {t.accessCode && (
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(t.accessCode!);
                          setCopiedId(t.id);
                          setTimeout(() => setCopiedId(null), 1500);
                        }}
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        <span>{copiedId === t.id ? 'Disalin' : 'Salin'}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleResetTeacherCode(t.id, t.name)}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>Jana Semula</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* MODAL: Appoint Leader */}
      {leaderModalSlot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-slate-900">
              Tetapkan Ketua — Slot {leaderModalSlot.slotNumber}
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              Pilihan hanya memaparkan guru yang berdaftar dalam Slot {leaderModalSlot.slotNumber}. Ketua termasuk dalam kuota slot.
            </p>
            <form onSubmit={handleConfirmLeader} className="mt-4 space-y-4">
              {leaderModalSlot.members.length === 0 ? (
                <p className="text-sm text-amber-800">
                  Tiada guru berdaftar dalam slot ini.
                </p>
              ) : (
                <div className="space-y-2">
                  {leaderModalSlot.members.map((m) => (
                    <label
                      key={m.teacherId}
                      className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3.5 py-2 text-sm hover:bg-slate-50"
                    >
                      <input
                        type="radio"
                        name="leader-choice"
                        checked={leaderChoiceId === String(m.teacherId)}
                        onChange={() => setLeaderChoiceId(String(m.teacherId))}
                        className="h-4 w-4 text-teal-700"
                      />
                      <span className="font-medium text-slate-900">{m.name}</span>
                    </label>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setLeaderModalSlot(null)}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={leaderModalSlot.members.length === 0 || !leaderChoiceId}
                  className="min-h-[44px] rounded-lg bg-teal-700 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  Sahkan Ketua Slot
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Assign / Substitute Teacher */}
      {assignSlotNumber && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-slate-900">
              Daftar Guru / Pengganti ke Slot {assignSlotNumber}
            </h2>
            <form onSubmit={handleAssignTeacher} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-800">
                  Pilih Guru Belum Berdaftar
                </label>
                <select
                  value={assignTeacherId}
                  onChange={(e) => setAssignTeacherId(e.target.value)}
                  required
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">-- Pilih guru --</option>
                  {unregisteredTeachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex min-h-[40px] cursor-pointer items-center gap-2.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={assignIsSubstitute}
                  onChange={(e) => setAssignIsSubstitute(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-teal-700"
                />
                <span>Rekodkan sebagai guru pengganti</span>
              </label>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setAssignSlotNumber(null)}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] rounded-lg bg-teal-700 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-800"
                >
                  Sahkan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Move / Remove Teacher (with Leader Replacement option) */}
      {moveModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-slate-900">
              {moveModal.action === 'move' ? 'Pindah Petugas' : 'Keluarkan Petugas'}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Guru: <strong>{moveModal.teacherName}</strong> (Slot {moveModal.fromSlotNumber})
            </p>

            <form onSubmit={handleMoveOrRemoveSubmit} className="mt-4 space-y-4">
              {moveModal.action === 'move' && (
                <div>
                  <label className="block text-sm font-semibold text-slate-800">
                    Pilih Slot Baharu (Mempunyai Kekosongan)
                  </label>
                  <select
                    value={moveTargetSlot}
                    onChange={(e) => setMoveTargetSlot(e.target.value)}
                    required
                    className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">-- Pilih slot destinasi --</option>
                    {slots
                      .filter(
                        (s) =>
                          s.slotNumber !== moveModal.fromSlotNumber &&
                          s.isOpenForRegistration
                      )
                      .map((s) => (
                        <option key={s.slotNumber} value={s.slotNumber}>
                          Slot {s.slotNumber} ({s.displayTime}) — {s.remainingSeats} tempat kosong
                        </option>
                      ))}
                  </select>
                </div>
              )}

              {moveModal.isLeader && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 space-y-2">
                  <div className="flex items-start gap-2 text-xs text-amber-950">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                    <span>
                      Guru ini ialah <strong>Ketua Slot {moveModal.fromSlotNumber}</strong>. Pilih pengganti daripada petugas yang tinggal atau biarkan belum ditetapkan.
                    </span>
                  </div>
                  <select
                    value={replacementLeaderId}
                    onChange={(e) => setReplacementLeaderId(e.target.value)}
                    className="w-full min-h-[40px] rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm"
                  >
                    <option value="">Biarkan Ketua belum ditetapkan</option>
                    {slots
                      .find((s) => s.slotNumber === moveModal.fromSlotNumber)
                      ?.members.filter((m) => m.teacherId !== moveModal.teacherId)
                      .map((m) => (
                        <option key={m.teacherId} value={m.teacherId}>
                          Lantik: {m.name}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setMoveModal(null)}
                  className="min-h-[44px] rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  {moveModal.action === 'move' ? 'Sahkan Pindahan' : 'Sahkan Keluarkan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: View Full Report */}
      {viewingReport && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="mx-auto my-6 max-w-4xl rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:p-6 shadow-2xl space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Laporan Pemantauan — Slot {viewingReport.slotNumber}
                </h2>
                <p className="text-xs text-slate-600 font-mono tabular-nums">
                  Status: {viewingReport.status === 'submitted' ? 'Telah dihantar' : 'Draf'}
                  {viewingReport.submittedAtDisplay
                    ? ` · Dihantar: ${viewingReport.submittedAtDisplay}`
                    : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {viewingReport.status === 'submitted' && (
                  <button
                    type="button"
                    onClick={() => handleReopenReport(viewingReport.slotNumber)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Buka Semula untuk Pembetulan</span>
                  </button>
                )}
                {viewingReport.id && (
                  <button
                    type="button"
                    onClick={() =>
                      handleDownloadSlotPdf(
                        viewingReport.id!,
                        viewingReport.slotNumber,
                        viewingReport.status !== 'submitted'
                      )
                    }
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-800"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>
                      {viewingReport.status === 'submitted'
                        ? 'Muat Turun PDF Slot Ini'
                        : 'Muat Turun Draf PDF'}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setViewingReport(null)}
                  className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                  aria-label="Tutup laporan"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <ReportReadOnlySummary report={viewingReport} />
          </div>
        </div>
      )}

      {/* MODAL: View Photos Only */}
      {viewingPhotosReport && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="mx-auto my-8 max-w-4xl rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Gambar Pemantauan — Slot {viewingPhotosReport.slotNumber}
                </h2>
                <p className="text-xs text-slate-600">
                  Ketua Slot: {viewingPhotosReport.submittedByName || viewingPhotosReport.leaderName || '-'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingPhotosReport(null)}
                className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
                aria-label="Tutup paparan gambar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {([1, 2] as const).map((idx) => {
                const p = viewingPhotosReport.photos[idx];
                return (
                  <div
                    key={idx}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3"
                  >
                    <h3 className="text-sm font-bold text-slate-900">Gambar {idx}</h3>
                    {p ? (
                      <>
                        <ProtectedImage
                          photoId={p.id}
                          alt={`Gambar ${idx} Slot ${viewingPhotosReport.slotNumber}`}
                        />
                        <div className="space-y-1 text-xs text-slate-700">
                          <p>
                            <strong>Masa diambil:</strong> {p.takenTime || '-'}
                          </p>
                          <p>
                            <strong>Lokasi:</strong> {p.location || '-'}
                          </p>
                          <p>
                            <strong>Kapsyen:</strong> {p.caption || '-'}
                          </p>
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-slate-500">Tiada gambar dimuat naik.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
