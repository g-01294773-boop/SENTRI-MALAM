import heic2any from 'heic2any';
import {
  AlertCircle,
  Bell,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  Lock,
  RefreshCw,
  Save,
  Send,
  UploadCloud,
  Wand2,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { ProtectedImage } from '../components/ProtectedImage';
import {
  ApiError,
  apiFetch,
  fetchProtectedBlob,
  triggerBlobDownload,
  uploadPhotoWithProgress,
} from '../lib/api';
import {
  getMonitoringQuestionsForReport,
  LEADER_INSTRUCTION,
  MONITORING_QUESTIONS,
  q6RequiresTentRepair,
  type AttendanceEntry,
  type AuthUserDTO,
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

const LEGACY_Q4_REMAP: Record<string, string> = {
  'Semua laluan bebas daripada halangan':
    'Semua laluan yang diperiksa bebas daripada halangan',
  'Terdapat halangan tetapi laluan masih boleh digunakan':
    'Terdapat halangan, tetapi semua laluan masih boleh digunakan',
  'Terdapat laluan yang terhalang sepenuhnya':
    'Sekurang-kurangnya satu laluan terhalang sepenuhnya',
};

function sanitizeDraftOption(
  key: 'q1' | 'q2' | 'q3' | 'q4' | 'q5' | 'q6',
  value: string | null
): string | null {
  if (!value) return null;
  const qDef = MONITORING_QUESTIONS.find((q) => q.key === key);
  if (!qDef) return null;
  if (qDef.options.includes(value)) return value;
  if (key === 'q4' && LEGACY_Q4_REMAP[value]) {
    return LEGACY_Q4_REMAP[value];
  }
  return null;
}

function formatLegacyIncidentsToNotes(incidents: IncidentEntry[]): string {
  return incidents
    .map((inc, idx) => {
      const parts = [
        inc.description && `Perkara: ${inc.description}`,
        inc.time && `Masa: ${inc.time}`,
        inc.location && `Lokasi: ${inc.location}`,
        inc.actionTaken && `Tindakan diambil: ${inc.actionTaken}`,
        inc.followUpAction && `Tindakan diperlukan: ${inc.followUpAction}`,
      ].filter(Boolean);
      return parts.length > 0 ? `Catatan ${idx + 1}: ${parts.join(' | ')}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

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
  const [observationNotes, setObservationNotes] = useState('');
  const [showValidationErrors, setShowValidationErrors] = useState(false);

  const [photo1State, setPhoto1State] = useState<PhotoSlotState>(initialPhotoState);
  const [photo2State, setPhoto2State] = useState<PhotoSlotState>(initialPhotoState);

  const [isReviewMode, setIsReviewMode] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [submittingReport, setSubmittingReport] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [missingItems, setMissingItems] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [extractingFromImage, setExtractingFromImage] = useState(false);
  const [extractNotice, setExtractNotice] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [ackNotification, setAckNotification] = useState<string | null>(null);

  const submissionKeyRef = useRef<string | null>(null);

  const hydrateFormFromReport = useCallback((r: ReportDTO) => {
    setReport(r);
    setAttendance(r.attendance);
    setExtraOfficers(r.extraOfficers);
    if (r.status === 'submitted') {
      setQ1(r.q1);
      setQ2(r.q2);
      setQ3(r.q3);
      setQ4(r.q4);
      setQ5(r.q5);
      setQ6(r.q6);
    } else {
      setQ1(sanitizeDraftOption('q1', r.q1));
      setQ2(sanitizeDraftOption('q2', r.q2));
      setQ3(sanitizeDraftOption('q3', r.q3));
      setQ4(sanitizeDraftOption('q4', r.q4));
      setQ5(sanitizeDraftOption('q5', r.q5));
      setQ6(sanitizeDraftOption('q6', r.q6));
    }
    setHasIncident(r.hasIncident);
    const legacyNotes =
      r.incidents.length > 0 ? formatLegacyIncidentsToNotes(r.incidents) : '';
    setObservationNotes(r.observationNotes || legacyNotes);
    setShowValidationErrors(false);
    setPhoto1State((prev) => ({
      ...prev,
      error: r.status === 'unfilled' ? null : prev.error,
      observationNotice: r.status === 'unfilled' ? null : prev.observationNotice,
      takenTime: r.photos[1]?.takenTime ?? (r.status === 'unfilled' ? '' : prev.takenTime),
      location: r.photos[1]?.location ?? (r.status === 'unfilled' ? '' : prev.location),
      caption: r.photos[1]?.caption ?? (r.status === 'unfilled' ? '' : prev.caption),
    }));
    setPhoto2State((prev) => ({
      ...prev,
      error: r.status === 'unfilled' ? null : prev.error,
      observationNotice: r.status === 'unfilled' ? null : prev.observationNotice,
      takenTime: r.photos[2]?.takenTime ?? (r.status === 'unfilled' ? '' : prev.takenTime),
      location: r.photos[2]?.location ?? (r.status === 'unfilled' ? '' : prev.location),
      caption: r.photos[2]?.caption ?? (r.status === 'unfilled' ? '' : prev.caption),
    }));
    if (r.status === 'submitted' && r.acknowledgedAt && r.acknowledgementDateStr && r.acknowledgementTimeStr) {
      setAckNotification(
        `Laporan Slot ${r.slotNumber} telah diterima oleh penyelaras pada ${r.acknowledgementDateStr}, ${r.acknowledgementTimeStr}.`
      );
    } else {
      setAckNotification(null);
    }
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
    setSubmitFailed(false);
    setMissingItems([]);
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

  const silentRefreshReportStatus = useCallback(async () => {
    if (!userId || userRole !== 'teacher') return;
    try {
      const data = await apiFetch<{ report: ReportDTO }>(
        `/api/my-report?campNightId=${campNightId}`
      );
      const next = data.report;
      setReport((prev) => {
        if (!prev) return next;
        // If report was acknowledged, deleted, or status changed on server, sync cleanly
        if (
          prev.status !== next.status ||
          prev.acknowledgedAt !== next.acknowledgedAt ||
          prev.id !== next.id
        ) {
          if (next.status === 'unfilled' && prev.status !== 'unfilled') {
            hydrateFormFromReport(next);
            setIsReviewMode(false);
          } else if (next.status === 'submitted') {
            hydrateFormFromReport(next);
          } else {
            return { ...prev, acknowledgedAt: next.acknowledgedAt, acknowledgedAtDisplay: next.acknowledgedAtDisplay };
          }
          return next;
        }
        return prev;
      });
    } catch {
      // ignore silent polling errors
    }
  }, [campNightId, userId, userRole, hydrateFormFromReport]);

  useEffect(() => {
    if (!userId || userRole !== 'teacher') return;
    const intervalMs = report?.status === 'submitted' && !report.acknowledgedAt ? 8000 : 15000;
    const timer = window.setInterval(() => {
      void silentRefreshReportStatus();
    }, intervalMs);
    const onFocusOrVisible = () => {
      if (document.visibilityState === 'visible') {
        void silentRefreshReportStatus();
      }
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
  }, [userId, userRole, report?.status, report?.acknowledgedAt, silentRefreshReportStatus]);

  // Section completion summary for neat guidance
  const completionStats = useMemo(() => {
    const secA = attendance.some((a) => a.present);
    const answeredCount = [q1, q2, q3, q4, q5, q6].filter(Boolean).length;
    const secB = answeredCount === 6;
    const q6RequiresRepair = q6RequiresTentRepair(q6);
    const requiresObservationNotes = hasIncident === 'Ya' || q6RequiresRepair;
    const secC =
      (hasIncident === 'Ya' || hasIncident === 'Tidak') &&
      (!requiresObservationNotes || observationNotes.trim().length > 0);

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

    return {
      secA,
      answeredCount,
      secB,
      q6RequiresRepair,
      requiresObservationNotes,
      secC,
      uploadedCount,
      secD,
    };
  }, [
    attendance,
    q1,
    q2,
    q3,
    q4,
    q5,
    q6,
    hasIncident,
    observationNotes,
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
    observationNotes,
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

  const collectMissingItems = (): string[] => {
    const missing: string[] = [];
    if (!attendance.some((a) => a.present)) {
      missing.push('Bahagian A: Tandakan sekurang-kurangnya seorang petugas yang hadir.');
    }
    const answerMap = { q1, q2, q3, q4, q5, q6 };
    for (const q of MONITORING_QUESTIONS) {
      if (!answerMap[q.key]) {
        missing.push(`Bahagian B: Jawab Soalan ${q.number}.`);
      }
    }
    if (!hasIncident) {
      missing.push(
        'Bahagian C: Pilih Ya atau Tidak bagi soalan sama ada terdapat kejadian, kerosakan atau keadaan yang perlu dicatat.'
      );
    }
    const needTentRepairNotes = q6RequiresTentRepair(q6);
    if ((hasIncident === 'Ya' || needTentRepairNotes) && !observationNotes.trim()) {
      missing.push(
        needTentRepairNotes
          ? 'Bahagian C: Lengkapkan ruangan wajib Catatan pemerhatian (nyatakan lokasi khemah, kerosakan yang dilihat dan tindakan yang diambil atau masih diperlukan).'
          : 'Bahagian C: Lengkapkan ruangan wajib Catatan pemerhatian.'
      );
    }
    if (!report?.photos[1]) {
      missing.push('Bahagian D: Muat naik Gambar 1 wajib.');
    } else if (
      !photo1State.takenTime.trim() ||
      !photo1State.location.trim() ||
      !photo1State.caption.trim()
    ) {
      missing.push('Bahagian D: Lengkapkan masa, lokasi dan pemerhatian Gambar 1.');
    }
    if (!report?.photos[2]) {
      missing.push('Bahagian D: Muat naik Gambar 2 wajib.');
    } else if (
      !photo2State.takenTime.trim() ||
      !photo2State.location.trim() ||
      !photo2State.caption.trim()
    ) {
      missing.push('Bahagian D: Lengkapkan masa, lokasi dan pemerhatian Gambar 2.');
    }
    return missing;
  };

  const handleOpenReview = async () => {
    setFormError(null);
    setStatusMessage(null);
    setSubmitFailed(false);
    const missing = collectMissingItems();
    if (missing.length > 0) {
      setShowValidationErrors(true);
      setMissingItems(missing);
      setFormError('Sila lengkapkan maklumat wajib berikut sebelum semakan akhir:');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setShowValidationErrors(false);
    setMissingItems([]);
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
    setSubmitFailed(false);
    const missing = collectMissingItems();
    if (missing.length > 0) {
      setShowValidationErrors(true);
      setMissingItems(missing);
      setFormError('Laporan belum lengkap. Sila lengkapkan perkara berikut sebelum menghantar:');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setShowValidationErrors(false);
    setMissingItems([]);

    if (!submissionKeyRef.current) {
      submissionKeyRef.current =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `sub_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }

    setSubmittingReport(true);
    try {
      const data = await apiFetch<{ message: string; report: ReportDTO }>(
        '/api/my-report/submit',
        {
          method: 'POST',
          body: JSON.stringify({
            ...buildPayload(),
            submissionKey: submissionKeyRef.current,
          }),
        }
      );
      submissionKeyRef.current = null;
      hydrateFormFromReport(data.report);
      setIsReviewMode(false);
      setSubmitFailed(false);
      setStatusMessage(data.message);
      void onRefreshSchedule();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setSubmitFailed(true);
      setFormError(
        err instanceof Error && err.message
          ? err.message
          : 'Sambungan terganggu semasa menghantar laporan. Maklumat anda dikekalkan; sila cuba lagi.'
      );
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
          observationNotes: string;
          extraOfficers: string;
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
      }
      if (ext.observationNotes) {
        setObservationNotes(ext.observationNotes);
        filledCount++;
      }
      if (ext.extraOfficers) {
        setExtraOfficers(ext.extraOfficers);
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

  // Submitted Report View
  if (report.status === 'submitted') {
    const isAcknowledged = Boolean(report.acknowledgedAt);

    return (
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Status Laporan Saya */}
        <section
          aria-label="Status Laporan Saya"
          className={`rounded-2xl border p-5 sm:p-6 ${
            isAcknowledged
              ? 'border-emerald-300 bg-emerald-50'
              : 'border-teal-200 bg-teal-50/70'
          }`}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              {isAcknowledged ? (
                <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700" />
              ) : (
                <Clock className="mt-0.5 h-6 w-6 shrink-0 text-teal-700" />
              )}
              <div className="space-y-1.5">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-600">
                  Status Laporan Saya — Slot {report.slotNumber}
                </p>
                <h1 className="text-xl font-bold text-slate-900">
                  {isAcknowledged
                    ? 'Diterima oleh penyelaras'
                    : 'Berjaya dihantar'}
                </h1>
                <p className="text-sm text-slate-800">
                  {isAcknowledged
                    ? ackNotification ||
                      `Laporan Slot ${report.slotNumber} telah diterima oleh penyelaras pada ${report.acknowledgementDateStr}, ${report.acknowledgementTimeStr}.`
                    : 'Laporan anda telah dihantar dan sedang menunggu pengesahan penyelaras.'}
                </p>
                <div className="pt-1 text-xs text-slate-700 font-mono tabular-nums space-y-0.5">
                  <p>
                    Nombor Slot: Slot {report.slotNumber} ({report.displayTime})
                  </p>
                  <p>
                    Tarikh &amp; Masa Hantar: {report.submittedAtDisplay} · Oleh{' '}
                    {report.submittedByName}
                  </p>
                  {isAcknowledged && report.acknowledgedAtDisplay && (
                    <p>
                      Disahkan Oleh: {report.acknowledgedByName || 'Penyelaras'} pada{' '}
                      {report.acknowledgedAtDisplay}
                    </p>
                  )}
                  {report.reopenedAt && report.updatedAtDisplay && (
                    <p>Kemas kini terakhir: {report.updatedAtDisplay}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:items-end shrink-0">
              <button
                type="button"
                onClick={() => handleDownloadPdf(false)}
                disabled={downloadingPdf}
                className="inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                <span>
                  {downloadingPdf ? 'Menjana PDF...' : 'Muat Turun Laporan PDF'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void silentRefreshReportStatus()}
                className="inline-flex min-h-[40px] w-full sm:w-auto items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Semak Status Terkini</span>
              </button>
            </div>
          </div>
        </section>

        {ackNotification && !isAcknowledged && (
          <div className="flex items-start gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm font-medium text-emerald-950">
            <Bell className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
            <span>{ackNotification}</span>
          </div>
        )}

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
      formVersion: 2,
      attendance,
      extraOfficers,
      q1,
      q2,
      q3,
      q4,
      q5,
      q6,
      hasIncident,
      observationNotes,
      incidents: [],
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
            Sila semak semua maklumat, jawapan pemantauan, catatan hasil pemantauan dan kedua-dua gambar sebelum menghantar laporan rasmi.
          </p>
        </div>

        {formError && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 space-y-2"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-medium">{formError}</span>
              {submitFailed && (
                <button
                  type="button"
                  onClick={handleSubmitReport}
                  disabled={submittingReport}
                  className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-60"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>{submittingReport ? 'Sedang menghantar…' : 'Cuba Lagi'}</span>
                </button>
              )}
            </div>
            {missingItems.length > 0 && (
              <ul className="list-disc pl-5 text-xs space-y-1">
                {missingItems.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            )}
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
                {submittingReport ? 'Sedang menghantar…' : 'Hantar Laporan'}
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
              accept="image/*"
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
              className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-base sm:text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
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
              className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-base sm:text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
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
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base sm:text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
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
          <div className="flex flex-col items-start sm:items-end gap-1.5">
            <span className="text-xs font-semibold text-slate-700 font-mono tabular-nums">
              Status Laporan Saya:{' '}
              {report.status === 'draft'
                ? 'Draf Disimpan (Belum Dihantar)'
                : 'Belum Diisi'}
            </span>
            <span className="text-[11px] text-slate-500 font-mono tabular-nums">
              Slot {report.slotNumber} · {report.displayTime}
            </span>
          </div>
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
              <span>Hasil Pemantauan</span>
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
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 space-y-2"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-medium">{formError}</span>
            {submitFailed && (
              <button
                type="button"
                onClick={handleSubmitReport}
                disabled={submittingReport}
                className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-60"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>{submittingReport ? 'Sedang menghantar…' : 'Cuba Lagi'}</span>
              </button>
            )}
          </div>
          {missingItems.length > 0 && (
            <ul className="list-disc pl-5 text-xs space-y-1">
              {missingItems.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          )}
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
            className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
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
            <p className="mt-0.5 text-xs text-slate-600">
              Jawab semua enam soalan berdasarkan pemerhatian sepanjang slot bertugas. Pilih satu jawapan bagi setiap soalan.
            </p>
          </div>
          <span
            className={`font-mono text-xs font-semibold tabular-nums ${
              completionStats.secB
                ? 'text-emerald-700'
                : showValidationErrors
                ? 'text-red-700'
                : 'text-slate-600'
            }`}
          >
            {completionStats.answeredCount}/6 dijawab
          </span>
        </div>

        <div className="space-y-5">
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
            const isMissing = showValidationErrors && !selectedValue;

            return (
              <fieldset
                key={q.key}
                className={`rounded-xl border p-4 space-y-3 transition-colors ${
                  isMissing
                    ? 'border-red-300 bg-red-50/60'
                    : 'border-slate-200/80 bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <legend className="text-sm font-semibold text-slate-900 leading-snug">
                    {q.prompt}
                  </legend>
                  <span
                    className={`shrink-0 text-xs font-semibold ${
                      selectedValue
                        ? 'text-emerald-700'
                        : isMissing
                        ? 'text-red-700'
                        : 'text-slate-400'
                    }`}
                  >
                    {selectedValue
                      ? 'Dijawab'
                      : isMissing
                      ? 'Wajib dijawab'
                      : 'Wajib'}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {q.options.map((opt) => (
                    <label
                      key={opt}
                      className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-2.5 text-sm transition-colors ${
                        selectedValue === opt
                          ? 'border-teal-700 bg-teal-50/70 font-medium text-teal-950'
                          : isMissing
                          ? 'border-red-200 bg-white text-slate-800 hover:border-red-300'
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
        className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 space-y-5 scroll-mt-20"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <h2 className="text-base font-bold text-slate-900">
            BAHAGIAN C — CATATAN HASIL PEMANTAUAN
          </h2>
          <span
            className={`text-xs font-semibold ${
              completionStats.secC
                ? 'text-emerald-700'
                : showValidationErrors
                ? 'text-red-700'
                : 'text-slate-500'
            }`}
          >
            {completionStats.secC ? 'Lengkap' : 'Wajib dijawab'}
          </span>
        </div>

        <fieldset
          className={`rounded-xl border p-4 space-y-3 transition-colors ${
            showValidationErrors && !hasIncident
              ? 'border-red-300 bg-red-50/60'
              : 'border-slate-200/80 bg-white'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <legend className="text-sm font-semibold text-slate-900 leading-snug">
              Adakah terdapat kejadian, kerosakan atau keadaan yang perlu dicatat sepanjang slot bertugas?
            </legend>
            <span
              className={`shrink-0 text-xs font-semibold ${
                hasIncident
                  ? 'text-emerald-700'
                  : showValidationErrors
                  ? 'text-red-700'
                  : 'text-slate-400'
              }`}
            >
              {hasIncident
                ? 'Dijawab'
                : showValidationErrors
                ? 'Wajib dijawab'
                : 'Wajib'}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:max-w-xs">
            {(['Ya', 'Tidak'] as const).map((choice) => (
              <label
                key={choice}
                className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-4 py-2.5 text-sm transition-colors ${
                  hasIncident === choice
                    ? 'border-teal-700 bg-teal-50/70 font-semibold text-teal-950'
                    : showValidationErrors && !hasIncident
                    ? 'border-red-200 bg-white text-slate-800 hover:border-red-300'
                    : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="has-incident"
                  checked={hasIncident === choice}
                  onChange={() => setHasIncident(choice)}
                  className="h-4 w-4 shrink-0 text-teal-700 focus:ring-teal-700"
                />
                <span>{choice}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {completionStats.requiresObservationNotes ? (
          <div
            className={`rounded-xl border p-4 space-y-2.5 ${
              showValidationErrors && !observationNotes.trim()
                ? 'border-red-300 bg-red-50/60'
                : completionStats.q6RequiresRepair
                ? 'border-amber-300 bg-amber-50/60'
                : 'border-slate-200 bg-slate-50/70'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <label
                htmlFor="observation-notes"
                className="block text-sm font-semibold text-slate-900"
              >
                Catatan pemerhatian *
              </label>
              <span
                className={`shrink-0 text-xs font-semibold ${
                  observationNotes.trim()
                    ? 'text-emerald-700'
                    : showValidationErrors
                    ? 'text-red-700'
                    : 'text-amber-800'
                }`}
              >
                {observationNotes.trim() ? 'Diisi' : 'Wajib diisi'}
              </span>
            </div>

            {completionStats.q6RequiresRepair && (
              <p className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-medium text-amber-950">
                Soalan 6 menunjukkan khemah memerlukan pembaikan. Sila rekodkan{' '}
                <strong>
                  lokasi khemah, kerosakan yang dilihat dan tindakan yang diambil atau masih diperlukan
                </strong>
                .
              </p>
            )}

            {hasIncident === 'Ya' && (
              <p className="text-xs text-slate-700">
                Nyatakan perkara yang diperhatikan, masa, lokasi dan tindakan yang diambil, jika berkenaan.
              </p>
            )}

            <textarea
              id="observation-notes"
              rows={4}
              value={observationNotes}
              onChange={(e) => setObservationNotes(e.target.value)}
              placeholder={
                completionStats.q6RequiresRepair
                  ? 'Nyatakan lokasi khemah, kerosakan yang dilihat dan tindakan yang diambil atau masih diperlukan...'
                  : 'Nyatakan perkara yang diperhatikan, masa, lokasi dan tindakan yang diambil, jika berkenaan.'
              }
              className={`w-full rounded-lg border bg-white px-3.5 py-2.5 text-base sm:text-sm text-slate-900 focus:outline-none ${
                showValidationErrors && !observationNotes.trim()
                  ? 'border-red-400 focus:border-red-600'
                  : 'border-slate-300 focus:border-teal-700'
              }`}
            />

            {showValidationErrors && !observationNotes.trim() && (
              <p className="text-xs font-medium text-red-700">
                Ruangan Catatan pemerhatian wajib diisi sebelum laporan dihantar.
              </p>
            )}
          </div>
        ) : hasIncident === 'Tidak' ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-xs text-slate-700">
            Tiada kejadian atau kerosakan khemah dilaporkan. Anda boleh meneruskan laporan ke Bahagian D tanpa catatan tambahan.
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
              {submittingReport ? 'Sedang menghantar…' : 'Hantar Laporan'}
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}

export function ReportReadOnlySummary({ report }: { report: ReportDTO }) {
  const monitoringQuestions = getMonitoringQuestionsForReport(report);
  const showNotes = Boolean(
    report.observationNotes.trim() ||
      report.hasIncident === 'Ya' ||
      q6RequiresTentRepair(report.q6)
  );

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
          {monitoringQuestions.map((q) => (
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
          BAHAGIAN C — CATATAN HASIL PEMANTAUAN
        </h2>
        <div className="text-sm space-y-3">
          <p>
            <span className="font-semibold text-slate-800">
              Adakah terdapat kejadian, kerosakan atau keadaan yang perlu dicatat sepanjang slot bertugas?:{' '}
            </span>
            <span className="font-bold text-slate-900">{report.hasIncident || '-'}</span>
          </p>

          {showNotes && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-1.5">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-600">
                Catatan Pemerhatian
              </p>
              <p className="whitespace-pre-wrap text-slate-900">
                {report.observationNotes.trim() || '-'}
              </p>
            </div>
          )}

          {report.hasIncident === 'Ya' &&
            report.incidents.length > 0 &&
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
