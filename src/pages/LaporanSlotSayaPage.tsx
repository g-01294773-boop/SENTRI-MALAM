import heic2any from 'heic2any';
import {
  AlertCircle,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
  UploadCloud,
  Wand2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { ProtectedImage } from '../components/ProtectedImage';
import {
  ApiError,
  apiFetch,
  fetchProtectedBlob,
  triggerBlobDownload,
  uploadPhotoWithProgress,
} from '../lib/api';
import {
  HANDOVER_STATUS_OPTIONS,
  LEADER_INSTRUCTION,
  MONITORING_QUESTIONS,
  type AttendanceEntry,
  type AuthUserDTO,
  type HandoverStatus,
  type IncidentEntry,
  type ReportDTO,
} from '../shared/constants';
import { MALAYSIA_TZ } from '../shared/dates';

interface LaporanSlotSayaPageProps {
  campNightId: number;
  currentUser: AuthUserDTO | null;
  onOpenAuth: (mode?: 'teacher' | 'coordinator') => void;
  onGoToCoordinator: () => void;
  onRefreshSchedule: () => Promise<void>;
}

interface PhotoSlotState {
  uploading: boolean;
  progress: number;
  generatingObservation: boolean;
  observationNotice: string | null;
  error: string | null;
  retryFile: File | null;
  takenTime: string;
  location: string;
  caption: string;
}

const QUICK_LOCATIONS = [
  'Kawasan khemah',
  'Laluan ke tandas',
  'Kawasan urus setia',
  'Pintu masuk tapak',
];

function getCurrentTimeLabelMY(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MALAYSIA_TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const h24 = Number(parts.find((p) => p.type === 'hour')?.value ?? '23');
  const min = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const period =
    h24 >= 19
      ? 'malam'
      : h24 >= 12
      ? 'tengah hari'
      : h24 >= 0
      ? 'pagi'
      : 'malam';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}.${min} ${period}`;
}

const emptyIncident = (): IncidentEntry => ({
  time: '',
  location: '',
  description: '',
  actionTaken: '',
  notifiedParty: '',
  followUpAction: '',
});

const initialPhotoState = (): PhotoSlotState => ({
  uploading: false,
  progress: 0,
  generatingObservation: false,
  observationNotice: null,
  error: null,
  retryFile: null,
  takenTime: '',
  location: '',
  caption: '',
});

export function LaporanSlotSayaPage({
  campNightId,
  currentUser,
  onOpenAuth,
  onGoToCoordinator,
  onRefreshSchedule,
}: LaporanSlotSayaPageProps) {
  const [report, setReport] = useState<ReportDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);

  // Editable form state
  const [attendance, setAttendance] = useState<AttendanceEntry[]>([]);
  const [extraOfficers, setExtraOfficers] = useState('');
  const [q1, setQ1] = useState<string | null>(null);
  const [q2, setQ2] = useState<string | null>(null);
  const [q3, setQ3] = useState<string | null>(null);
  const [q4, setQ4] = useState<string | null>(null);
  const [q5, setQ5] = useState<string | null>(null);
  const [q6, setQ6] = useState<string | null>(null);
  const [hasIncident, setHasIncident] = useState<'Ya' | 'Tidak' | null>(null);
  const [incidents, setIncidents] = useState<IncidentEntry[]>([]);
  const [handoverStatus, setHandoverStatus] = useState<HandoverStatus | null>(null);
  const [handoverReceiver, setHandoverReceiver] = useState('');
  const [handoverTime, setHandoverTime] = useState('');
  const [handoverNote, setHandoverNote] = useState('');

  const [photo1State, setPhoto1State] = useState<PhotoSlotState>(initialPhotoState);
  const [photo2State, setPhoto2State] = useState<PhotoSlotState>(initialPhotoState);

  const [isReviewMode, setIsReviewMode] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [submittingReport, setSubmittingReport] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [extractingFromImage, setExtractingFromImage] = useState(false);
  const [extractNotice, setExtractNotice] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);

  const hydrateFormFromReport = useCallback((r: ReportDTO) => {
    setReport(r);
    setAttendance(r.attendance);
    setExtraOfficers(r.extraOfficers);
    setQ1(r.q1);
    setQ2(r.q2);
    setQ3(r.q3);
    setQ4(r.q4);
    setQ5(r.q5);
    setQ6(r.q6);
    setHasIncident(r.hasIncident);
    setIncidents(r.incidents.length > 0 ? r.incidents : []);
    setHandoverStatus(r.handoverStatus);
    setHandoverReceiver(r.handoverReceiver);
    setHandoverTime(r.handoverTime);
    setHandoverNote(r.handoverNote);
    setPhoto1State((prev) => ({
      ...prev,
      takenTime: r.photos[1]?.takenTime ?? prev.takenTime,
      location: r.photos[1]?.location ?? prev.location,
      caption: r.photos[1]?.caption ?? prev.caption,
    }));
    setPhoto2State((prev) => ({
      ...prev,
      takenTime: r.photos[2]?.takenTime ?? prev.takenTime,
      location: r.photos[2]?.location ?? prev.location,
      caption: r.photos[2]?.caption ?? prev.caption,
    }));
  }, []);

  const userId = currentUser?.id ?? null;
  const userRole = currentUser?.role ?? null;

  const loadMyReport = useCallback(async () => {
    if (!userId || userRole !== 'teacher') {
      setReport(null);
      setAccessError(null);
      return;
    }
    setLoading(true);
    setAccessError(null);
    try {
      const data = await apiFetch<{ report: ReportDTO }>(
        `/api/my-report?campNightId=${campNightId}`
      );
      hydrateFormFromReport(data.report);
      setIsReviewMode(false);
    } catch (err) {
      setReport(null);
      setAccessError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [campNightId, userId, userRole, hydrateFormFromReport]);

  useEffect(() => {
    void loadMyReport();
  }, [loadMyReport]);

  // Section completion summary for neat guidance
  const completionStats = useMemo(() => {
    const secA = attendance.some((a) => a.present);
    const answeredCount = [q1, q2, q3, q4, q5, q6].filter(Boolean).length;
    const secB = answeredCount === 6;
    const secCIncidentOk =
      hasIncident === 'Tidak' ||
      (hasIncident === 'Ya' &&
        incidents.length > 0 &&
        incidents.every(
          (i) =>
            i.time.trim() &&
            i.location.trim() &&
            i.description.trim() &&
            i.actionTaken.trim() &&
            i.notifiedParty.trim() &&
            i.followUpAction.trim()
        ));
    const secCHandoverOk =
      handoverStatus === 'Belum selesai.'
        ? Boolean(handoverNote.trim())
        : Boolean(
            handoverStatus && handoverReceiver.trim() && handoverTime.trim()
          );
    const secC = secCIncidentOk && secCHandoverOk;

    const p1Ready = Boolean(
      report?.photos[1] &&
        photo1State.takenTime.trim() &&
        photo1State.location.trim() &&
        photo1State.caption.trim()
    );
    const p2Ready = Boolean(
      report?.photos[2] &&
        photo2State.takenTime.trim() &&
        photo2State.location.trim() &&
        photo2State.caption.trim()
    );
    const uploadedCount = (report?.photos[1] ? 1 : 0) + (report?.photos[2] ? 1 : 0);
    const secD = p1Ready && p2Ready;

    return { secA, answeredCount, secB, secC, uploadedCount, secD };
  }, [
    attendance,
    q1,
    q2,
    q3,
    q4,
    q5,
    q6,
    hasIncident,
    incidents,
    handoverStatus,
    handoverNote,
    handoverReceiver,
    handoverTime,
    report?.photos,
    photo1State,
    photo2State,
  ]);

  const buildPayload = () => ({
    campNightId,
    attendance,
    extraOfficers,
    q1,
    q2,
    q3,
    q4,
    q5,
    q6,
    hasIncident,
    incidents: hasIncident === 'Ya' ? incidents : [],
    handoverStatus,
    handoverReceiver,
    handoverTime,
    handoverNote,
    photoMeta: {
      1: {
        takenTime: photo1State.takenTime,
        location: photo1State.location,
        caption: photo1State.caption,
      },
      2: {
        takenTime: photo2State.takenTime,
        location: photo2State.location,
        caption: photo2State.caption,
      },
    },
  });

  const handleSaveDraft = async () => {
    setFormError(null);
    setStatusMessage(null);
    setSavingDraft(true);
    try {
      const data = await apiFetch<{ message: string; report: ReportDTO }>(
        '/api/my-report/draft',
        {
          method: 'PUT',
          body: JSON.stringify(buildPayload()),
        }
      );
      hydrateFormFromReport(data.report);
      setStatusMessage(data.message);
      await onRefreshSchedule();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSavingDraft(false);
    }
  };

  const generateObservationForPhoto = async (
    photoIndex: 1 | 2,
    photoId: number
  ) => {
    const setPhotoState = photoIndex === 1 ? setPhoto1State : setPhoto2State;
    setPhotoState((prev) => ({
      ...prev,
      generatingObservation: true,
      observationNotice: null,
    }));

    try {
      const res = await apiFetch<{
        caption: string;
        suggestedLocation: string;
        report: ReportDTO;
      }>(`/api/my-report/photos/${photoId}/generate-observation`, {
        method: 'POST',
      });

      setReport((prev) =>
        prev
          ? {
              ...prev,
              id: res.report.id ?? prev.id,
              photos: {
                ...prev.photos,
                [photoIndex]: res.report.photos[photoIndex],
              },
            }
          : res.report
      );
      setPhotoState((prev) => ({
        ...prev,
        generatingObservation: false,
        caption: res.caption,
        location: prev.location.trim()
          ? prev.location
          : res.suggestedLocation || prev.location,
        observationNotice:
          'Pemerhatian ringkas berjaya dijana daripada gambar. Anda boleh menyunting teks ini jika perlu.',
      }));
    } catch (err) {
      setPhotoState((prev) => ({
        ...prev,
        generatingObservation: false,
        observationNotice: `Auto-jana pemerhatian tidak tersedia (${(err as Error).message}). Sila taip pemerhatian ringkas secara manual.`,
      }));
    }
  };

  const handlePhotoUpload = async (photoIndex: 1 | 2, rawFile: File) => {
    const setPhotoState = photoIndex === 1 ? setPhoto1State : setPhoto2State;
    const currentPhotoState = photoIndex === 1 ? photo1State : photo2State;

    const autoTakenTime = currentPhotoState.takenTime.trim()
      ? currentPhotoState.takenTime
      : getCurrentTimeLabelMY();

    setPhotoState((prev) => ({
      ...prev,
      uploading: true,
      progress: 5,
      error: null,
      observationNotice: null,
      retryFile: rawFile,
      takenTime: autoTakenTime,
    }));
    setFormError(null);

    let fileToUpload: File = rawFile;
    const lowerName = rawFile.name.toLowerCase();
    const isHeic =
      rawFile.type === 'image/heic' ||
      rawFile.type === 'image/heif' ||
      lowerName.endsWith('.heic') ||
      lowerName.endsWith('.heif');

    if (isHeic) {
      try {
        const converted = await heic2any({
          blob: rawFile,
          toType: 'image/jpeg',
          quality: 0.9,
        });
        const resultBlob = Array.isArray(converted) ? converted[0] : converted;
        const baseName = rawFile.name.replace(/\.(heic|heif)$/i, '');
        fileToUpload = new File([resultBlob], `${baseName}.jpg`, {
          type: 'image/jpeg',
        });
      } catch {
        // Fall back to sending rawFile to the server; sharp will attempt server-side decode
        fileToUpload = rawFile;
      }
    }

    const formData = new FormData();
    formData.append('campNightId', String(campNightId));
    formData.append('photoIndex', String(photoIndex));
    formData.append('takenTime', autoTakenTime);
    formData.append('location', currentPhotoState.location);
    formData.append('caption', currentPhotoState.caption);
    formData.append('photo', fileToUpload);

    try {
      const data = await uploadPhotoWithProgress<{
        message: string;
        photo: { id: number };
        report: ReportDTO;
      }>('/api/my-report/photos', formData, (pct) => {
        setPhotoState((prev) => ({ ...prev, progress: pct }));
      });

      setReport((prev) =>
        prev
          ? {
              ...prev,
              id: data.report.id ?? prev.id,
              status: data.report.status,
              photos: {
                ...prev.photos,
                [photoIndex]: data.report.photos[photoIndex],
              },
            }
          : data.report
      );
      setPhotoState((prev) => ({
        ...prev,
        uploading: false,
        progress: 100,
        error: null,
        retryFile: null,
      }));
      setStatusMessage(data.message);
      void onRefreshSchedule();

      // Auto-generate brief observation from the uploaded photo
      if (data.photo?.id) {
        void generateObservationForPhoto(photoIndex, data.photo.id);
      }
    } catch (err) {
      setPhotoState((prev) => ({
        ...prev,
        uploading: false,
        progress: 0,
        error:
          err instanceof ApiError
            ? err.message
            : 'Muat naik gambar gagal. Sila cuba semula.',
      }));
    }
  };

  const handleFileInput = (photoIndex: 1 | 2) => (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void handlePhotoUpload(photoIndex, file);
  };

  const validateBeforeReviewOrSubmit = (): string | null => {
    if (!attendance.some((a) => a.present)) {
      return 'Sila tandakan sekurang-kurangnya seorang guru yang benar-benar hadir dalam Bahagian A.';
    }
    const answerMap = { q1, q2, q3, q4, q5, q6 };
    for (const q of MONITORING_QUESTIONS) {
      if (!answerMap[q.key]) {
        return `Sila jawab Soalan ${q.number} dalam Bahagian B.`;
      }
    }
    if (!hasIncident) {
      return 'Sila pilih Ya atau Tidak bagi soalan kejadian dalam Bahagian C.';
    }
    if (hasIncident === 'Ya') {
      if (incidents.length === 0) {
        return 'Sila isi sekurang-kurangnya satu catatan kejadian dalam Bahagian C.';
      }
      for (let i = 0; i < incidents.length; i++) {
        const inc = incidents[i];
        if (
          !inc.time.trim() ||
          !inc.location.trim() ||
          !inc.description.trim() ||
          !inc.actionTaken.trim() ||
          !inc.notifiedParty.trim() ||
          !inc.followUpAction.trim()
        ) {
          return `Sila lengkapkan semua medan pada Catatan Kejadian ${i + 1}.`;
        }
      }
    }
    if (!handoverStatus) {
      return 'Sila pilih status serahan tugas dalam Bahagian C.';
    }
    if (handoverStatus === 'Belum selesai.') {
      if (!handoverNote.trim()) {
        return 'Sila isi catatan ringkas bagi status serahan "Belum selesai.".';
      }
    } else if (!handoverReceiver.trim() || !handoverTime.trim()) {
      return 'Sila isi nama penerima dan masa serahan dalam Bahagian C.';
    }
    if (!report?.photos[1] || !report?.photos[2]) {
      return 'Kedua-dua gambar wajib (Gambar 1 dan Gambar 2) mesti dimuat naik sebelum semakan akhir atau penghantaran.';
    }
    if (
      !photo1State.takenTime.trim() ||
      !photo1State.location.trim() ||
      !photo1State.caption.trim()
    ) {
      return 'Sila lengkapkan masa diambil, lokasi dan pemerhatian ringkas bagi Gambar 1.';
    }
    if (
      !photo2State.takenTime.trim() ||
      !photo2State.location.trim() ||
      !photo2State.caption.trim()
    ) {
      return 'Sila lengkapkan masa diambil, lokasi dan pemerhatian ringkas bagi Gambar 2.';
    }
    return null;
  };

  const handleOpenReview = async () => {
    setFormError(null);
    setStatusMessage(null);
    const validationErr = validateBeforeReviewOrSubmit();
    if (validationErr) {
      setFormError(validationErr);
      return;
    }
    try {
      setSavingDraft(true);
      const data = await apiFetch<{ message: string; report: ReportDTO }>(
        '/api/my-report/draft',
        {
          method: 'PUT',
          body: JSON.stringify(buildPayload()),
        }
      );
      hydrateFormFromReport(data.report);
      setIsReviewMode(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSavingDraft(false);
    }
  };

  const handleSubmitReport = async () => {
    if (submittingReport) return;
    setFormError(null);
    setStatusMessage(null);
    const validationErr = validateBeforeReviewOrSubmit();
    if (validationErr) {
      setFormError(validationErr);
      return;
    }

    setSubmittingReport(true);
    try {
      const data = await apiFetch<{ message: string; report: ReportDTO }>(
        '/api/my-report/submit',
        {
          method: 'POST',
          body: JSON.stringify(buildPayload()),
        }
      );
      hydrateFormFromReport(data.report);
      setIsReviewMode(false);
      setStatusMessage(data.message);
      await onRefreshSchedule();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSubmittingReport(false);
    }
  };

  const handleDownloadPdf = async (allowDraft = false) => {
    if (!report?.id) return;
    setDownloadingPdf(true);
    setFormError(null);
    try {
      const qs = allowDraft ? '?allowDraft=1' : '';
      const { blob, filename } = await fetchProtectedBlob(
        `/api/reports/${report.id}/pdf${qs}`
      );
      const slotPad = String(report.slotNumber).padStart(2, '0');
      const fallback = allowDraft
        ? `Draf_Laporan_Slot_${slotPad}.pdf`
        : `Laporan_Slot_${slotPad}.pdf`;
      triggerBlobDownload(blob, filename || fallback);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleExtractFromImage = async (rawFile: File) => {
    setExtractingFromImage(true);
    setExtractError(null);
    setExtractNotice(null);
    setFormError(null);

    let fileToUpload: File = rawFile;
    const lowerName = rawFile.name.toLowerCase();
    const isHeic =
      rawFile.type === 'image/heic' ||
      rawFile.type === 'image/heif' ||
      lowerName.endsWith('.heic') ||
      lowerName.endsWith('.heif');

    if (isHeic) {
      try {
        const converted = await heic2any({
          blob: rawFile,
          toType: 'image/jpeg',
          quality: 0.9,
        });
        const resultBlob = Array.isArray(converted) ? converted[0] : converted;
        const baseName = rawFile.name.replace(/\.(heic|heif)$/i, '');
        fileToUpload = new File([resultBlob], `${baseName}.jpg`, {
          type: 'image/jpeg',
        });
      } catch {
        // Fall back to sending rawFile to the server; sharp will attempt server-side decode
        fileToUpload = rawFile;
      }
    }

    const formData = new FormData();
    formData.append('campNightId', String(campNightId));
    formData.append('image', fileToUpload);

    try {
      const res = await apiFetch<{
        message: string;
        extracted: {
          q1: string;
          q2: string;
          q3: string;
          q4: string;
          q5: string;
          q6: string;
          hasIncident: 'Ya' | 'Tidak' | '';
          incidents: IncidentEntry[];
          extraOfficers: string;
          handoverNote: string;
          observationSummary: string;
        };
      }>('/api/my-report/extract-from-image', {
        method: 'POST',
        body: formData,
      });

      const ext = res.extracted;
      let filledCount = 0;
      if (ext.q1) {
        setQ1(ext.q1);
        filledCount++;
      }
      if (ext.q2) {
        setQ2(ext.q2);
        filledCount++;
      }
      if (ext.q3) {
        setQ3(ext.q3);
        filledCount++;
      }
      if (ext.q4) {
        setQ4(ext.q4);
        filledCount++;
      }
      if (ext.q5) {
        setQ5(ext.q5);
        filledCount++;
      }
      if (ext.q6) {
        setQ6(ext.q6);
        filledCount++;
      }
      if (ext.hasIncident === 'Ya' || ext.hasIncident === 'Tidak') {
        setHasIncident(ext.hasIncident);
        filledCount++;
        if (ext.hasIncident === 'Ya' && ext.incidents.length > 0) {
          setIncidents(ext.incidents);
        }
      }
      if (ext.extraOfficers) {
        setExtraOfficers(ext.extraOfficers);
        filledCount++;
      }
      if (ext.handoverNote) {
        setHandoverNote(ext.handoverNote);
        filledCount++;
      }

      setExtractNotice(
        `${ext.observationSummary} (${filledCount} medan laporan dipadankan secara automatik — sila semak dan lengkapkan baki ruang sebelum menghantar).`
      );
    } catch (err) {
      setExtractError((err as Error).message);
    } finally {
      setExtractingFromImage(false);
    }
  };

  // Unauthenticated View
  if (!currentUser) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
          <Lock className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-xl font-bold text-slate-900">
          Akses Laporan Slot Saya
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Hanya Ketua Slot yang dilantik oleh Penyelaras boleh mengesahkan kehadiran, mengisi dapatan pemantauan, memuat naik gambar, dan menghantar laporan slotnya.
        </p>
        <button
          type="button"
          onClick={() => onOpenAuth('teacher')}
          className="mt-6 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-teal-700 px-6 py-2.5 text-sm font-semibold text-white hover:bg-teal-800"
        >
          <span>Log Masuk Akses Peribadi Guru</span>
        </button>
      </div>
    );
  }

  if (currentUser.role === 'coordinator') {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 text-center">
        <h1 className="text-xl font-bold text-slate-900">
          Anda Sedang Log Masuk sebagai Penyelaras
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Halaman Laporan Slot Saya dikhaskan untuk Ketua Slot yang dilantik. Sila gunakan Paparan Penyelaras untuk menyemak laporan, gambar serta memuat turun PDF dan ZIP.
        </p>
        <button
          type="button"
          onClick={onGoToCoordinator}
          className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Buka Paparan Penyelaras
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
        Memuatkan maklumat laporan slot anda...
      </div>
    );
  }

  if (accessError || !report) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-amber-200 bg-amber-50/70 p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-6 w-6 shrink-0 text-amber-700" />
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              Akses Laporan Slot Tidak Tersedia
            </h1>
            <p className="mt-2 text-sm text-slate-700">
              {accessError ||
                'Hanya Ketua Slot yang dilantik dibenarkan mengisi laporan.'}
            </p>
            <p className="mt-2 text-xs text-slate-600">
              Log masuk semasa: <strong>{currentUser.name}</strong>
              {currentUser.registeredSlotNumber
                ? ` · Berdaftar dalam Slot ${currentUser.registeredSlotNumber}`
                : ''}
            </p>
            <div className="mt-4 flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => void loadMyReport()}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Cuba Muat Semula</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenAuth('teacher')}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800"
              >
                <span>Log Masuk Semula</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const receiverLabel =
    report.slotNumber === 6
      ? 'Penyelaras penerima laporan akhir'
      : 'Penerima daripada slot berikutnya';

  // Submitted Report View
  if (report.status === 'submitted') {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700" />
              <div>
                <h1 className="text-xl font-bold text-emerald-950">
                  Laporan Slot {report.slotNumber} berjaya dihantar
                </h1>
                <p className="mt-1 text-sm text-emerald-900">
                  Dihantar oleh <strong>{report.submittedByName}</strong> pada{' '}
                  <span className="font-mono tabular-nums">
                    {report.submittedAtDisplay}
                  </span>
                  .
                </p>
                {report.reopenedAt && report.updatedAtDisplay && (
                  <p className="mt-1 font-mono text-xs text-emerald-800 tabular-nums">
                    Kemas kini terakhir: {report.updatedAtDisplay}
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleDownloadPdf(false)}
              disabled={downloadingPdf}
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              <span>
                {downloadingPdf ? 'Menjana PDF...' : 'Muat Turun Laporan PDF'}
              </span>
            </button>
          </div>
        </div>

        {formError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {formError}
          </div>
        )}

        <ReportReadOnlySummary report={report} />
      </div>
    );
  }

  // Review Screen before Submit
  if (isReviewMode) {
    const draftPreview: ReportDTO = {
      ...report,
      attendance,
      extraOfficers,
      q1,
      q2,
      q3,
      q4,
      q5,
      q6,
      hasIncident,
      incidents: hasIncident === 'Ya' ? incidents : [],
      handoverStatus,
      handoverReceiver,
      handoverTime,
      handoverNote,
      photos: {
        1: report.photos[1]
          ? {
              ...report.photos[1],
              takenTime: photo1State.takenTime,
              location: photo1State.location,
              caption: photo1State.caption,
            }
          : null,
        2: report.photos[2]
          ? {
              ...report.photos[2],
              takenTime: photo2State.takenTime,
              location: photo2State.location,
              caption: photo2State.caption,
            }
          : null,
      },
    };

    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h1 className="text-xl font-bold text-slate-900">
            Semakan Akhir Laporan — Slot {report.slotNumber}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Sila semak semua maklumat, jawapan pemantauan, catatan serahan dan kedua-dua gambar sebelum menghantar laporan rasmi.
          </p>
        </div>

        {formError && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800"
          >
            {formError}
          </div>
        )}

        <ReportReadOnlySummary report={draftPreview} />

        <div className="flex flex-col-reverse gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => setIsReviewMode(false)}
            disabled={submittingReport}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Kembali Betulkan Bahagian
          </button>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {report.id && (
              <button
                type="button"
                onClick={() => handleDownloadPdf(true)}
                disabled={downloadingPdf || submittingReport}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                <span>
                  {downloadingPdf ? 'Menjana Draf PDF...' : 'Muat Turun Draf PDF'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={handleSubmitReport}
              disabled={submittingReport}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-teal-700 px-6 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
            >
              <Send className="h-4 w-4" />
              <span>
                {submittingReport ? 'Menghantar Laporan...' : 'Hantar Laporan'}
              </span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Main Editable Form
  const renderPhotoCard = (
    photoIndex: 1 | 2,
    state: PhotoSlotState,
    setState: React.Dispatch<React.SetStateAction<PhotoSlotState>>
  ) => {
    const uploaded = report.photos[photoIndex];

    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Gambar {photoIndex}
            </h3>
            <p className="text-xs text-slate-500">
              {photoIndex === 1
                ? 'Gambar pertama semasa pemantauan'
                : 'Gambar kedua (berbeza daripada Gambar 1)'}
            </p>
          </div>
          <span
            className={`text-xs font-semibold ${
              uploaded ? 'text-emerald-700' : 'text-amber-700'
            }`}
          >
            {uploaded ? 'Berjaya disimpan' : 'Wajib dimuat naik'}
          </span>
        </div>

        {/* Upload buttons */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <label className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800">
            <Camera className="h-4 w-4 shrink-0" />
            <span>{uploaded ? 'Ganti (Ambil Gambar)' : 'Ambil Gambar'}</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileInput(photoIndex)}
              className="sr-only"
            />
          </label>

          <label className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50">
            <ImageIcon className="h-4 w-4 shrink-0" />
            <span>
              {uploaded ? 'Ganti (Galeri)' : 'Pilih daripada Galeri'}
            </span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
              onChange={handleFileInput(photoIndex)}
              className="sr-only"
            />
          </label>
        </div>

        {state.uploading && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <UploadCloud className="h-3.5 w-3.5" />
                Memuat naik gambar...
              </span>
              <span className="font-mono tabular-nums">{state.progress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-teal-700 transition-all"
                style={{ width: `${state.progress}%` }}
              />
            </div>
          </div>
        )}

        {state.error && (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{state.error}</span>
            {state.retryFile && (
              <button
                type="button"
                onClick={() => handlePhotoUpload(photoIndex, state.retryFile!)}
                className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-md bg-red-700 px-3 py-1.5 font-semibold text-white hover:bg-red-800"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Cuba Semula</span>
              </button>
            )}
          </div>
        )}

        {uploaded && (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
            <ProtectedImage
              photoId={uploaded.id}
              alt={`Pratonton Gambar ${photoIndex} Slot ${report.slotNumber}`}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 font-mono tabular-nums">
              <span>
                {uploaded.originalName} · {uploaded.width}×{uploaded.height}px
              </span>
              <span>{(uploaded.sizeBytes / 1024).toFixed(0)} KB</span>
            </div>
          </div>
        )}

        {/* Structured Metadata Fields */}
        <div className="space-y-3 pt-1">
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="block text-xs font-semibold text-slate-700">
                Masa Gambar Diambil *
              </label>
              <button
                type="button"
                onClick={() =>
                  setState((prev) => ({
                    ...prev,
                    takenTime: getCurrentTimeLabelMY(),
                  }))
                }
                className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900"
              >
                <Clock className="h-3 w-3" />
                <span>Isi Masa Sekarang</span>
              </button>
            </div>
            <input
              type="text"
              value={state.takenTime}
              onChange={(e) =>
                setState((prev) => ({ ...prev, takenTime: e.target.value }))
              }
              placeholder="Cth: 11.25 malam"
              className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">
              Lokasi *
            </label>
            <input
              type="text"
              value={state.location}
              onChange={(e) =>
                setState((prev) => ({ ...prev, location: e.target.value }))
              }
              placeholder="Cth: Laluan khemah ke tandas"
              className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {QUICK_LOCATIONS.map((loc) => (
                <button
                  key={loc}
                  type="button"
                  onClick={() => setState((prev) => ({ ...prev, location: loc }))}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-teal-600 hover:text-teal-800"
                >
                  {loc}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="block text-xs font-semibold text-slate-700">
                Pemerhatian Ringkas / Kapsyen *
              </label>
              {uploaded && (
                <button
                  type="button"
                  disabled={state.generatingObservation}
                  onClick={() => generateObservationForPhoto(photoIndex, uploaded.id)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:text-teal-900 disabled:opacity-50"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  <span>
                    {state.generatingObservation
                      ? 'Sedang menjana...'
                      : 'Jana daripada Gambar'}
                  </span>
                </button>
              )}
            </div>

            {state.generatingObservation && (
              <p className="mt-1 text-xs font-medium text-teal-700">
                Sedang menganalisis gambar untuk menjana pemerhatian ringkas secara automatik...
              </p>
            )}

            <textarea
              rows={2}
              value={state.caption}
              onChange={(e) =>
                setState((prev) => ({ ...prev, caption: e.target.value }))
              }
              placeholder="Pemerhatian ringkas akan dijana secara automatik selepas gambar dimuat naik, atau taip terus di sini."
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
            />

            {state.observationNotice && (
              <p className="mt-1 text-xs text-slate-600">
                {state.observationNotice}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header & Official Instructions */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold text-teal-700">
              Ketua Slot Disahkan · {report.leaderName}
            </p>
            <h1 className="mt-1 text-xl font-bold text-slate-900 sm:text-2xl">
              Laporan Pemantauan Sentri Malam — Slot {report.slotNumber}
            </h1>
          </div>
          <span className="text-xs font-semibold text-slate-600 font-mono tabular-nums">
            Status: {report.status === 'draft' ? 'Draf Disimpan' : 'Belum Diisi'}
          </span>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-800">
          {LEADER_INSTRUCTION}
        </div>

        {/* Clean 4-Section Progress Jump Strip */}
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <a
            href="#bahagian-a"
            className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-3 hover:border-teal-600"
          >
            <span className="text-xs font-semibold text-slate-500">Bahagian A</span>
            <span
              className={`mt-1 inline-flex items-center gap-1 text-xs font-bold ${
                completionStats.secA ? 'text-emerald-700' : 'text-slate-800'
              }`}
            >
              {completionStats.secA && <Check className="h-3.5 w-3.5" />}
              <span>Kehadiran</span>
            </span>
          </a>

          <a
            href="#bahagian-b"
            className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-3 hover:border-teal-600"
          >
            <span className="text-xs font-semibold text-slate-500">Bahagian B</span>
            <span
              className={`mt-1 inline-flex items-center gap-1 text-xs font-bold font-mono tabular-nums ${
                completionStats.secB ? 'text-emerald-700' : 'text-slate-800'
              }`}
            >
              {completionStats.secB && <Check className="h-3.5 w-3.5" />}
              <span>{completionStats.answeredCount}/6 Soalan</span>
            </span>
          </a>

          <a
            href="#bahagian-c"
            className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-3 hover:border-teal-600"
          >
            <span className="text-xs font-semibold text-slate-500">Bahagian C</span>
            <span
              className={`mt-1 inline-flex items-center gap-1 text-xs font-bold ${
                completionStats.secC ? 'text-emerald-700' : 'text-slate-800'
              }`}
            >
              {completionStats.secC && <Check className="h-3.5 w-3.5" />}
              <span>Kejadian &amp; Serahan</span>
            </span>
          </a>

          <a
            href="#bahagian-d"
            className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-3 hover:border-teal-600"
          >
            <span className="text-xs font-semibold text-slate-500">Bahagian D</span>
            <span
              className={`mt-1 inline-flex items-center gap-1 text-xs font-bold font-mono tabular-nums ${
                completionStats.secD ? 'text-emerald-700' : 'text-slate-800'
              }`}
            >
              {completionStats.secD && <Check className="h-3.5 w-3.5" />}
              <span>{completionStats.uploadedCount}/2 Gambar</span>
            </span>
          </a>
        </div>
      </section>

      {/* Auto-extract structured report data from an example / handwritten log / scene photo */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Wand2 className="h-4 w-4 text-teal-700" />
              <span>Jana Maklumat daripada Gambar Contoh atau Catatan</span>
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Muat naik gambar contoh borang pelaporan, nota bertulis tangan, atau foto situasi tapak untuk mengisi jawapan Bahagian B dan C secara tersusun sebelum dimuat turun sebagai PDF.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <label className="inline-flex min-h-[42px] cursor-pointer items-center justify-center gap-2 rounded-lg border border-teal-700 bg-teal-50 px-4 py-2 text-xs font-semibold text-teal-900 hover:bg-teal-100">
              <ImageIcon className="h-4 w-4 shrink-0" />
              <span>
                {extractingFromImage
                  ? 'Menjana Maklumat...'
                  : 'Pilih Gambar untuk Dijana'}
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/heic,image/heif,image/webp,.jpg,.jpeg,.png,.heic,.heif,.webp"
                disabled={extractingFromImage}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void handleExtractFromImage(f);
                }}
                className="sr-only"
              />
            </label>
          </div>
        </div>

        {extractNotice && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-900">
            {extractNotice}
          </div>
        )}

        {extractError && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800"
          >
            {extractError}
          </div>
        )}
      </section>

      {statusMessage && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
          {statusMessage}
        </div>
      )}

      {formError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
        >
          {formError}
        </div>
      )}

      {/* BAHAGIAN A */}
      <section
        id="bahagian-a"
        className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-5 scroll-mt-20"
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <h2 className="text-base font-bold text-slate-900">
            BAHAGIAN A — MAKLUMAT BERTUGAS
          </h2>
          <span className="text-xs text-slate-500">Diisi automatik &amp; kehadiran</span>
        </div>

        <dl className="grid grid-cols-1 gap-4 rounded-xl border border-slate-100 bg-slate-50/70 p-4 sm:grid-cols-2 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Nombor Slot &amp; Waktu Bertugas</dt>
            <dd className="mt-0.5 font-semibold text-slate-900 font-mono tabular-nums">
              Slot {report.slotNumber} · {report.displayTime}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Tarikh Tugas Sebenar</dt>
            <dd className="mt-0.5 font-semibold text-slate-900 font-mono tabular-nums">
              {report.startDate === report.endDate
                ? report.startDateDisplay
                : `${report.startDateDisplay} hingga ${report.endDateDisplay}`}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Ketua Slot</dt>
            <dd className="mt-0.5 font-semibold text-slate-900">{report.leaderName}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Malam Perkhemahan</dt>
            <dd className="mt-0.5 font-semibold text-slate-900">{report.campNightTitle}</dd>
          </div>
        </dl>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                Kehadiran Sebenar Guru Berdaftar
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Tandakan guru yang benar-benar hadir bertugas semasa slot ini.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setAttendance((prev) => prev.map((a) => ({ ...a, present: true })))
              }
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              <Check className="h-3.5 w-3.5 text-teal-700" />
              <span>Tandakan Semua Hadir</span>
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {attendance.map((item) => (
              <label
                key={item.teacherId}
                className={`flex min-h-[48px] cursor-pointer items-center justify-between gap-3 rounded-lg border px-4 py-2.5 transition-colors ${
                  item.present
                    ? 'border-teal-600 bg-teal-50/50'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={item.present}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setAttendance((prev) =>
                        prev.map((a) =>
                          a.teacherId === item.teacherId
                            ? { ...a, present: checked }
                            : a
                        )
                      );
                    }}
                    className="h-5 w-5 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                  />
                  <span className="text-sm font-medium text-slate-900">
                    {item.name}
                    {item.teacherId === report.leaderTeacherId ? ' (Ketua Slot)' : ''}
                  </span>
                </div>
                <span
                  className={`text-xs font-semibold ${
                    item.present ? 'text-emerald-700' : 'text-slate-400'
                  }`}
                >
                  {item.present ? 'Hadir' : 'Tidak ditandakan'}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label
            htmlFor="extra-officers"
            className="block text-sm font-semibold text-slate-800"
          >
            Nama petugas tambahan atau pengganti (pilihan)
          </label>
          <input
            id="extra-officers"
            type="text"
            value={extraOfficers}
            onChange={(e) => setExtraOfficers(e.target.value)}
            placeholder="Tinggalkan kosong jika tiada petugas tambahan atau pengganti"
            className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
          />
        </div>
      </section>

      {/* BAHAGIAN B */}
      <section
        id="bahagian-b"
        className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-6 scroll-mt-20"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              BAHAGIAN B — DAPATAN PEMANTAUAN
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Semua enam soalan wajib dijawab dengan memilih satu jawapan sahaja.
            </p>
          </div>
          <span className="font-mono text-xs font-semibold text-slate-600 tabular-nums">
            {completionStats.answeredCount}/6 dijawab
          </span>
        </div>

        <div className="space-y-6 divide-y divide-slate-100">
          {MONITORING_QUESTIONS.map((q) => {
            const valMap = { q1, q2, q3, q4, q5, q6 };
            const setterMap = {
              q1: setQ1,
              q2: setQ2,
              q3: setQ3,
              q4: setQ4,
              q5: setQ5,
              q6: setQ6,
            };
            const selectedValue = valMap[q.key];
            const setValue = setterMap[q.key];

            return (
              <fieldset key={q.key} className="pt-5 first:pt-0 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <legend className="text-sm font-semibold text-slate-900 leading-snug">
                    {q.prompt}
                  </legend>
                  <span
                    className={`shrink-0 text-xs font-semibold ${
                      selectedValue ? 'text-emerald-700' : 'text-slate-400'
                    }`}
                  >
                    {selectedValue ? 'Dijawab' : 'Wajib'}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {q.options.map((opt) => (
                    <label
                      key={opt}
                      className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-2 text-sm transition-colors ${
                        selectedValue === opt
                          ? 'border-teal-700 bg-teal-50/70 font-medium text-teal-950'
                          : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`question-${q.key}`}
                        checked={selectedValue === opt}
                        onChange={() => setValue(opt)}
                        className="h-4 w-4 shrink-0 text-teal-700 focus:ring-teal-700"
                      />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>
      </section>

      {/* BAHAGIAN C */}
      <section
        id="bahagian-c"
        className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-6 scroll-mt-20"
      >
        <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
          BAHAGIAN C — CATATAN KEJADIAN DAN SERAHAN TUGAS
        </h2>

        <fieldset className="space-y-2.5">
          <legend className="text-sm font-semibold text-slate-900">
            Adakah terdapat kejadian atau perkara yang memerlukan tindakan susulan?
          </legend>
          <div className="flex flex-wrap gap-3">
            {(['Ya', 'Tidak'] as const).map((choice) => (
              <label
                key={choice}
                className={`flex min-h-[44px] min-w-[120px] cursor-pointer items-center gap-3 rounded-lg border px-4 py-2 text-sm ${
                  hasIncident === choice
                    ? 'border-teal-700 bg-teal-50/70 font-semibold text-teal-950'
                    : 'border-slate-200 bg-white text-slate-800'
                }`}
              >
                <input
                  type="radio"
                  name="has-incident"
                  checked={hasIncident === choice}
                  onChange={() => {
                    setHasIncident(choice);
                    if (choice === 'Ya' && incidents.length === 0) {
                      setIncidents([emptyIncident()]);
                    }
                  }}
                  className="h-4 w-4 text-teal-700"
                />
                <span>{choice}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {hasIncident === 'Ya' && (
          <div className="space-y-4">
            {incidents.map((inc, index) => (
              <div
                key={index}
                className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">
                    Catatan Kejadian {index + 1}
                  </h3>
                  {incidents.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setIncidents((prev) => prev.filter((_, i) => i !== index))
                      }
                      className="inline-flex min-h-[36px] items-center gap-1 text-xs font-semibold text-red-700 hover:text-red-900"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Padam</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Masa *
                    </label>
                    <input
                      type="text"
                      value={inc.time}
                      onChange={(e) => {
                        const val = e.target.value;
                        setIncidents((prev) =>
                          prev.map((item, i) =>
                            i === index ? { ...item, time: val } : item
                          )
                        );
                      }}
                      placeholder="Cth: 12.15 pagi"
                      className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Lokasi *
                    </label>
                    <input
                      type="text"
                      value={inc.location}
                      onChange={(e) => {
                        const val = e.target.value;
                        setIncidents((prev) =>
                          prev.map((item, i) =>
                            i === index ? { ...item, location: val } : item
                          )
                        );
                      }}
                      placeholder="Cth: Blok Khemah Lelaki B"
                      className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Perkara yang berlaku *
                  </label>
                  <textarea
                    rows={2}
                    value={inc.description}
                    onChange={(e) => {
                      const val = e.target.value;
                      setIncidents((prev) =>
                        prev.map((item, i) =>
                          i === index ? { ...item, description: val } : item
                        )
                      );
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Tindakan yang telah diambil *
                  </label>
                  <textarea
                    rows={2}
                    value={inc.actionTaken}
                    onChange={(e) => {
                      const val = e.target.value;
                      setIncidents((prev) =>
                        prev.map((item, i) =>
                          i === index ? { ...item, actionTaken: val } : item
                        )
                      );
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Pihak yang dimaklumkan *
                    </label>
                    <input
                      type="text"
                      value={inc.notifiedParty}
                      onChange={(e) => {
                        const val = e.target.value;
                        setIncidents((prev) =>
                          prev.map((item, i) =>
                            i === index ? { ...item, notifiedParty: val } : item
                          )
                        );
                      }}
                      placeholder="Cth: Kem Komandan / Penyelaras"
                      className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Tindakan lanjut yang diperlukan *
                    </label>
                    <input
                      type="text"
                      value={inc.followUpAction}
                      onChange={(e) => {
                        const val = e.target.value;
                        setIncidents((prev) =>
                          prev.map((item, i) =>
                            i === index ? { ...item, followUpAction: val } : item
                          )
                        );
                      }}
                      placeholder="Cth: Pembaikan lampu laluan pagi esok"
                      className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={() => setIncidents((prev) => [...prev, emptyIncident()])}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              <Plus className="h-4 w-4" />
              <span>Tambah Catatan</span>
            </button>
          </div>
        )}

        <fieldset className="space-y-2.5 pt-2 border-t border-slate-100">
          <legend className="text-sm font-semibold text-slate-900">
            Status Serahan Tugas
          </legend>
          <div className="space-y-2">
            {HANDOVER_STATUS_OPTIONS.map((opt) => (
              <label
                key={opt}
                className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-4 py-2.5 text-sm ${
                  handoverStatus === opt
                    ? 'border-teal-700 bg-teal-50/70 font-medium text-teal-950'
                    : 'border-slate-200 bg-white text-slate-800'
                }`}
              >
                <input
                  type="radio"
                  name="handover-status"
                  checked={handoverStatus === opt}
                  onChange={() => setHandoverStatus(opt)}
                  className="h-4 w-4 text-teal-700"
                />
                <span>{opt}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {handoverStatus === 'Belum selesai.' ? (
          <div>
            <label
              htmlFor="handover-note"
              className="block text-sm font-semibold text-slate-800"
            >
              Catatan ringkas *
            </label>
            <textarea
              id="handover-note"
              rows={2}
              value={handoverNote}
              onChange={(e) => setHandoverNote(e.target.value)}
              placeholder="Nyatakan sebab serahan tugas belum selesai"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        ) : handoverStatus ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="handover-receiver"
                className="block text-sm font-semibold text-slate-800"
              >
                {receiverLabel} *
              </label>
              <input
                id="handover-receiver"
                type="text"
                value={handoverReceiver}
                onChange={(e) => setHandoverReceiver(e.target.value)}
                placeholder="Nama penuh penerima"
                className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {report.nextSlotMembers.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {report.nextSlotMembers.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setHandoverReceiver(name)}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-teal-600 hover:text-teal-800"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="handover-time"
                  className="block text-sm font-semibold text-slate-800"
                >
                  Masa Serahan *
                </label>
                <button
                  type="button"
                  onClick={() => setHandoverTime(getCurrentTimeLabelMY())}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900"
                >
                  <Clock className="h-3 w-3" />
                  <span>Isi Masa Sekarang</span>
                </button>
              </div>
              <input
                id="handover-time"
                type="text"
                value={handoverTime}
                onChange={(e) => setHandoverTime(e.target.value)}
                placeholder="Cth: 11.50 malam"
                className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
        ) : null}
      </section>

      {/* BAHAGIAN D */}
      <section
        id="bahagian-d"
        className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-5 scroll-mt-20"
      >
        <div className="border-b border-slate-100 pb-3">
          <h2 className="text-base font-bold text-slate-900">
            BAHAGIAN D — DUA GAMBAR WAJIB
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Lampirkan dua gambar berbeza yang diambil semasa slot bertugas. Pemerhatian ringkas akan dijana secara automatik daripada gambar dan boleh disunting sebelum penghantaran.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {renderPhotoCard(1, photo1State, setPhoto1State)}
          {renderPhotoCard(2, photo2State, setPhoto2State)}
        </div>
      </section>

      {/* Form Action Bar */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={handleSaveDraft}
          disabled={savingDraft}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          <span>{savingDraft ? 'Menyimpan Draf...' : 'Simpan Draf'}</span>
        </button>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={handleOpenReview}
            disabled={savingDraft}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-teal-700 bg-teal-50 px-5 py-2.5 text-sm font-semibold text-teal-900 hover:bg-teal-100"
          >
            <Eye className="h-4 w-4" />
            <span>Semak Laporan</span>
          </button>

          <button
            type="button"
            onClick={handleSubmitReport}
            disabled={submittingReport}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-teal-700 px-6 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
            <span>
              {submittingReport ? 'Menghantar...' : 'Hantar Laporan'}
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}

export function ReportReadOnlySummary({ report }: { report: ReportDTO }) {
  const receiverLabel =
    report.slotNumber === 6
      ? 'Penyelaras penerima laporan akhir'
      : 'Penerima daripada slot berikutnya';

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-4">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
          <FileText className="h-4 w-4 text-teal-700" />
          <span>BAHAGIAN A — MAKLUMAT BERTUGAS</span>
        </h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
          <div>
            <span className="text-slate-500">Slot &amp; Waktu: </span>
            <span className="font-semibold text-slate-900 font-mono tabular-nums">
              Slot {report.slotNumber} · {report.displayTime}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Tarikh Sebenar: </span>
            <span className="font-semibold text-slate-900 font-mono tabular-nums">
              {report.startDate === report.endDate
                ? report.startDateDisplay
                : `${report.startDateDisplay} – ${report.endDateDisplay}`}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Ketua Slot: </span>
            <span className="font-semibold text-slate-900">
              {report.submittedByName || report.leaderName}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Petugas Tambahan/Pengganti: </span>
            <span className="font-semibold text-slate-900">
              {report.extraOfficers.trim() || 'Tiada'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Senarai Guru Berdaftar
            </h3>
            <ul className="mt-1.5 space-y-1 text-sm text-slate-800">
              {report.registeredMembers.map((m) => (
                <li key={m.teacherId}>
                  • {m.name} {m.isLeader ? '(Ketua Slot)' : '(Petugas)'}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Kehadiran Sebenar
            </h3>
            <ul className="mt-1.5 space-y-1 text-sm text-slate-800">
              {report.attendance.map((a) => (
                <li key={a.teacherId}>
                  • {a.name} —{' '}
                  <span
                    className={
                      a.present
                        ? 'font-semibold text-emerald-700'
                        : 'text-slate-500'
                    }
                  >
                    {a.present ? 'Hadir' : 'Tidak hadir'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-4">
        <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
          BAHAGIAN B — DAPATAN PEMANTAUAN
        </h2>
        <div className="space-y-3 text-sm">
          {MONITORING_QUESTIONS.map((q) => (
            <div key={q.key} className="border-b border-slate-100 pb-2.5 last:border-b-0">
              <p className="font-semibold text-slate-900">{q.prompt}</p>
              <p className="mt-1 text-teal-800 font-medium">
                Jawapan: {report[q.key] || '-'}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-4">
        <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
          BAHAGIAN C — CATATAN KEJADIAN DAN SERAHAN TUGAS
        </h2>
        <div className="text-sm space-y-3">
          <p>
            <span className="font-semibold text-slate-800">
              Kejadian memerlukan tindakan susulan:{' '}
            </span>
            <span className="font-bold text-slate-900">{report.hasIncident || '-'}</span>
          </p>
          {report.hasIncident === 'Ya' &&
            report.incidents.map((inc, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-1.5"
              >
                <p className="font-bold text-slate-900">Catatan Kejadian {idx + 1}</p>
                <p>Masa: {inc.time} · Lokasi: {inc.location}</p>
                <p>Perkara: {inc.description}</p>
                <p>Tindakan diambil: {inc.actionTaken}</p>
                <p>Pihak dimaklumkan: {inc.notifiedParty}</p>
                <p>Tindakan lanjut: {inc.followUpAction}</p>
              </div>
            ))}
          <p>
            <span className="font-semibold text-slate-800">Status Serahan: </span>
            <span className="font-medium text-slate-900">{report.handoverStatus}</span>
          </p>
          {report.handoverStatus === 'Belum selesai.' ? (
            <p>
              <span className="font-semibold text-slate-800">Catatan Ringkas: </span>
              {report.handoverNote}
            </p>
          ) : (
            <p>
              <span className="font-semibold text-slate-800">{receiverLabel}: </span>
              {report.handoverReceiver} ·{' '}
              <span className="font-semibold text-slate-800">Masa Serahan: </span>
              {report.handoverTime}
            </p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-4">
        <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
          BAHAGIAN D — DUA GAMBAR WAJIB
        </h2>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {([1, 2] as const).map((idx) => {
            const photo = report.photos[idx];
            return (
              <div
                key={idx}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3"
              >
                <h3 className="text-sm font-bold text-slate-900">Gambar {idx}</h3>
                {photo ? (
                  <>
                    <ProtectedImage
                      photoId={photo.id}
                      alt={`Gambar ${idx} Slot ${report.slotNumber}`}
                    />
                    <div className="space-y-1 text-xs text-slate-700">
                      <p>
                        <strong>Masa diambil:</strong> {photo.takenTime || '-'} ·{' '}
                        <strong>Lokasi:</strong> {photo.location || '-'}
                      </p>
                      <p>
                        <strong>Pemerhatian / Kapsyen:</strong> {photo.caption || '-'}
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">Tiada gambar.</p>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
