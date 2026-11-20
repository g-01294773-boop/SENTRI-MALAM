export interface SlotDefinition {
  slotNumber: number;
  startTime24: string;
  endTime24: string;
  displayTime: string;
  durationMinutes: number;
  zipSuffix: string;
}

export const SLOT_DEFINITIONS: SlotDefinition[] = [
  {
    slotNumber: 1,
    startTime24: '22:50',
    endTime24: '23:50',
    displayTime: '10.50 malam – 11.50 malam',
    durationMinutes: 60,
    zipSuffix: '2250-2350',
  },
  {
    slotNumber: 2,
    startTime24: '23:50',
    endTime24: '00:50',
    displayTime: '11.50 malam – 12.50 pagi',
    durationMinutes: 60,
    zipSuffix: '2350-0050',
  },
  {
    slotNumber: 3,
    startTime24: '00:50',
    endTime24: '01:50',
    displayTime: '12.50 pagi – 1.50 pagi',
    durationMinutes: 60,
    zipSuffix: '0050-0150',
  },
  {
    slotNumber: 4,
    startTime24: '01:50',
    endTime24: '02:50',
    displayTime: '1.50 pagi – 2.50 pagi',
    durationMinutes: 60,
    zipSuffix: '0150-0250',
  },
  {
    slotNumber: 5,
    startTime24: '02:50',
    endTime24: '03:50',
    displayTime: '2.50 pagi – 3.50 pagi',
    durationMinutes: 60,
    zipSuffix: '0250-0350',
  },
  {
    slotNumber: 6,
    startTime24: '03:50',
    endTime24: '04:30',
    displayTime: '3.50 pagi – 4.30 pagi',
    durationMinutes: 40,
    zipSuffix: '0350-0430',
  },
];

export const LEADER_INSTRUCTION =
  'Pada akhir waktu bertugas, ketua slot hendaklah berbincang dengan guru yang bertugas dalam slot yang sama. Hanya ketua mengisi dan menghantar satu laporan bagi pihak kumpulan. Lampirkan dua gambar sebenar yang diambil semasa slot masing-masing.';

export interface MonitoringQuestion {
  key: 'q1' | 'q2' | 'q3' | 'q4' | 'q5' | 'q6';
  number: number;
  prompt: string;
  options: string[];
}

export const MONITORING_QUESTIONS: MonitoringQuestion[] = [
  {
    key: 'q1',
    number: 1,
    prompt: '1. Bagaimanakah keadaan kawasan khemah ketika peserta berehat?',
    options: [
      'Sangat bising',
      'Bising',
      'Sederhana tenang',
      'Tenang',
      'Sangat tenang',
      'Tidak dapat dinilai',
    ],
  },
  {
    key: 'q2',
    number: 2,
    prompt:
      '2. Berapa kali petugas melihat peserta keluar dari kawasan khemah tanpa memaklumkan guru bertugas?',
    options: [
      'Tiada kejadian diperhatikan',
      'Sekali',
      'Dua kali',
      'Tiga kali atau lebih',
      'Tidak dapat dipastikan',
    ],
  },
  {
    key: 'q3',
    number: 3,
    prompt: '3. Bagaimanakah pencahayaan di laluan antara kawasan khemah dengan tandas?',
    options: [
      'Sangat gelap',
      'Gelap',
      'Sederhana terang',
      'Terang',
      'Sangat terang',
      'Tidak diperiksa',
    ],
  },
  {
    key: 'q4',
    number: 4,
    prompt: '4. Apakah keadaan laluan yang diperiksa semasa rondaan?',
    options: [
      'Semua laluan yang diperiksa bebas daripada halangan',
      'Terdapat halangan, tetapi semua laluan masih boleh digunakan',
      'Sekurang-kurangnya satu laluan terhalang sepenuhnya',
      'Tidak diperiksa',
    ],
  },
  {
    key: 'q5',
    number: 5,
    prompt: '5. Berapa banyak kawasan yang ditetapkan untuk rondaan telah diperiksa?',
    options: [
      'Tiada',
      'Kurang daripada separuh',
      'Separuh',
      'Lebih daripada separuh tetapi belum semuanya',
      'Semua kawasan',
    ],
  },
  {
    key: 'q6',
    number: 6,
    prompt: '6. Apakah keadaan khemah peserta yang diperhatikan semasa rondaan?',
    options: [
      'Semua khemah yang diperiksa berada dalam keadaan baik',
      'Terdapat khemah yang memerlukan pembaikan dan semua pembaikan telah selesai',
      'Terdapat khemah yang masih memerlukan pembaikan pada akhir slot',
      'Keadaan khemah tidak diperiksa',
    ],
  },
];

export const LEGACY_Q6_OPTIONS = [
  'Tiada permintaan diterima',
  'Semua permintaan telah ditangani',
  'Sebahagian masih memerlukan tindakan',
  'Semua masih memerlukan tindakan',
] as const;

export const LEGACY_MONITORING_QUESTIONS: MonitoringQuestion[] = [
  MONITORING_QUESTIONS[0],
  MONITORING_QUESTIONS[1],
  {
    key: 'q3',
    number: 3,
    prompt: '3. Bagaimanakah pencahayaan di laluan antara khemah dengan tandas?',
    options: MONITORING_QUESTIONS[2].options,
  },
  {
    key: 'q4',
    number: 4,
    prompt: '4. Bagaimanakah keadaan laluan yang diperiksa?',
    options: [
      'Semua laluan bebas daripada halangan',
      'Terdapat halangan tetapi laluan masih boleh digunakan',
      'Terdapat laluan yang terhalang sepenuhnya',
      'Tidak diperiksa',
    ],
  },
  {
    key: 'q5',
    number: 5,
    prompt: '5. Berapa banyakkah kawasan yang ditetapkan telah diperiksa oleh kumpulan?',
    options: MONITORING_QUESTIONS[4].options,
  },
  {
    key: 'q6',
    number: 6,
    prompt: '6. Apakah status permintaan bantuan daripada peserta pada akhir slot?',
    options: [...LEGACY_Q6_OPTIONS],
  },
];

export const TENT_REPAIR_Q6_OPTIONS = [
  'Terdapat khemah yang memerlukan pembaikan dan semua pembaikan telah selesai',
  'Terdapat khemah yang masih memerlukan pembaikan pada akhir slot',
] as const;

export function q6RequiresTentRepair(q6: string | null | undefined): boolean {
  if (!q6) return false;
  return (TENT_REPAIR_Q6_OPTIONS as readonly string[]).includes(q6);
}

export function isLegacyReport(
  report: Pick<ReportDTO, 'formVersion' | 'q6' | 'status'>
): boolean {
  if (report.q6 && (LEGACY_Q6_OPTIONS as readonly string[]).includes(report.q6)) {
    return true;
  }
  if (report.status === 'submitted' && report.formVersion === 1) {
    return true;
  }
  return false;
}

export function getMonitoringQuestionsForReport(
  report: Pick<ReportDTO, 'formVersion' | 'q6' | 'status'>
): MonitoringQuestion[] {
  return isLegacyReport(report) ? LEGACY_MONITORING_QUESTIONS : MONITORING_QUESTIONS;
}

export interface PublicTeacherSlotMember {
  teacherId: number;
  name: string;
  isLeader: boolean;
  isSubstitute: boolean;
}

export interface SlotSummaryDTO {
  slotNumber: number;
  startTime24: string;
  endTime24: string;
  displayTime: string;
  durationMinutes: number;
  startDate: string;
  endDate: string;
  startDateDisplay: string;
  endDateDisplay: string;
  quota: number | null;
  registeredCount: number;
  remainingSeats: number | null;
  statusLabel: string;
  isOpenForRegistration: boolean;
  leaderTeacherId: number | null;
  leaderName: string | null;
  members: PublicTeacherSlotMember[];
  reportStatus:
    | 'Belum diisi'
    | 'Draf'
    | 'Menunggu pengesahan'
    | 'Diterima oleh penyelaras';
  isSubmitted: boolean;
  reportId: number | null;
  photoCount: number;
  followUpStatus: string;
  submittedAt: string | null;
  submittedAtDisplay: string | null;
  submittedByName: string | null;
  acknowledgedAt: string | null;
  acknowledgedAtDisplay: string | null;
  acknowledgedByName: string | null;
  acknowledgementDateStr: string | null;
  acknowledgementTimeStr: string | null;
  updatedAt: string | null;
}

export interface CampNightDTO {
  id: number;
  title: string;
  startDate: string;
  startDateDisplay: string;
  isActive: boolean;
}

export interface EligibleTeacherDTO {
  id: number;
  name: string;
  registeredSlotNumber: number | null;
  isLeader: boolean;
}

export interface AuthUserDTO {
  id: number;
  name: string;
  role: 'teacher' | 'coordinator';
  registeredSlotNumber: number | null;
  leaderSlotNumber: number | null;
}

export interface AttendanceEntry {
  teacherId: number;
  name: string;
  present: boolean;
}

export interface IncidentEntry {
  time: string;
  location: string;
  description: string;
  actionTaken: string;
  notifiedParty: string;
  followUpAction: string;
}

export interface ReportPhotoDTO {
  id: number;
  photoIndex: 1 | 2;
  originalName: string;
  mimeType: string;
  ext: string;
  width: number;
  height: number;
  sizeBytes: number;
  takenTime: string;
  location: string;
  caption: string;
  uploadedAt: string;
}

export interface ReportDTO {
  id: number | null;
  formVersion: number;
  campNightId: number;
  campNightTitle: string;
  campStartDate: string;
  slotNumber: number;
  displayTime: string;
  durationMinutes: number;
  startDate: string;
  endDate: string;
  startDateDisplay: string;
  endDateDisplay: string;
  leaderTeacherId: number | null;
  leaderName: string | null;
  registeredMembers: PublicTeacherSlotMember[];
  status: 'unfilled' | 'draft' | 'submitted';
  attendance: AttendanceEntry[];
  extraOfficers: string;
  q1: string | null;
  q2: string | null;
  q3: string | null;
  q4: string | null;
  q5: string | null;
  q6: string | null;
  hasIncident: 'Ya' | 'Tidak' | null;
  observationNotes: string;
  incidents: IncidentEntry[];
  submittedByTeacherId: number | null;
  submittedByName: string | null;
  submittedAt: string | null;
  submittedAtDisplay: string | null;
  acknowledgedByTeacherId: number | null;
  acknowledgedByName: string | null;
  acknowledgedAt: string | null;
  acknowledgedAtDisplay: string | null;
  acknowledgementDateStr: string | null;
  acknowledgementTimeStr: string | null;
  updatedAt: string | null;
  updatedAtDisplay: string | null;
  reopenedAt: string | null;
  photos: {
    1: ReportPhotoDTO | null;
    2: ReportPhotoDTO | null;
  };
}
