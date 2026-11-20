import {
  Calendar,
  CheckCircle2,
  Clock,
  Lock,
  Search,
  UserCheck,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import type {
  AuthUserDTO,
  CampNightDTO,
  EligibleTeacherDTO,
  SlotSummaryDTO,
} from '../shared/constants';

interface PendaftaranGuruPageProps {
  campNights: CampNightDTO[];
  campNight: CampNightDTO;
  slots: SlotSummaryDTO[];
  eligibleTeachers: EligibleTeacherDTO[];
  currentUser: AuthUserDTO | null;
  onSelectCampNight: (id: number) => void;
  onOpenAuth: (mode?: 'teacher' | 'coordinator') => void;
  onRefresh: () => Promise<void>;
}

export function PendaftaranGuruPage({
  campNights,
  campNight,
  slots,
  eligibleTeachers,
  currentUser,
  onSelectCampNight,
  onOpenAuth,
  onRefresh,
}: PendaftaranGuruPageProps) {
  const [lookupTeacherId, setLookupTeacherId] = useState<string>('');
  const [selectedSlotNumber, setSelectedSlotNumber] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    teacherName: string;
    slotNumber: number;
    displayTime: string;
    startDateDisplay: string;
    endDateDisplay: string;
  } | null>(null);

  const openSlots = useMemo(
    () => slots.filter((s) => s.isOpenForRegistration),
    [slots]
  );

  const inspectedTeacher = useMemo(() => {
    if (currentUser?.role === 'teacher') {
      return eligibleTeachers.find((t) => t.id === currentUser.id) || null;
    }
    if (lookupTeacherId) {
      return eligibleTeachers.find((t) => t.id === Number(lookupTeacherId)) || null;
    }
    return null;
  }, [currentUser, eligibleTeachers, lookupTeacherId]);

  const inspectedSlot = useMemo(() => {
    if (!inspectedTeacher?.registeredSlotNumber) return null;
    return slots.find((s) => s.slotNumber === inspectedTeacher.registeredSlotNumber) || null;
  }, [inspectedTeacher, slots]);

  const totalRegistered = useMemo(
    () => slots.reduce((sum, s) => sum + s.registeredCount, 0),
    [slots]
  );

  const handleConfirmRegistration = async () => {
    if (!currentUser || currentUser.role !== 'teacher') {
      onOpenAuth('teacher');
      return;
    }
    if (!selectedSlotNumber) {
      setError('Sila pilih satu slot yang masih mempunyai kekosongan.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<{
        message: string;
        registration: {
          teacherName: string;
          slotNumber: number;
          displayTime: string;
          startDateDisplay: string;
          endDateDisplay: string;
        };
      }>('/api/registrations', {
        method: 'POST',
        body: JSON.stringify({
          campNightId: campNight.id,
          slotNumber: selectedSlotNumber,
        }),
      });
      setConfirmation(res.registration);
      setSelectedSlotNumber(null);
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
      await onRefresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Hero Banner */}
      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-900">
        <div className="relative grid grid-cols-1 lg:grid-cols-12 items-stretch">
          <div className="relative z-10 flex flex-col justify-between p-6 sm:p-8 lg:col-span-7 lg:p-10 text-white">
            <div>
              <p className="text-xs font-semibold tracking-wide text-teal-300">
                Perkhemahan Bersepadu Badan Beruniform SK Tudan 2026
              </p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl [text-wrap:balance]">
                Pendaftaran dan Pelaporan Sentri Malam
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-200">
                Semak jadual bertugas sentri malam mengikut slot, pastikan status pendaftaran nama anda, dan sahkan giliran pada slot yang masih dibuka.
              </p>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/15 pt-4 text-xs text-slate-200">
              <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
                <Calendar className="h-3.5 w-3.5 text-teal-300" />
                Malam Perkhemahan: {campNight.startDateDisplay}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                Zon Waktu: Asia/Kuala_Lumpur
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {totalRegistered} guru berdaftar
              </span>
            </div>
          </div>

          <div className="relative min-h-[200px] lg:col-span-5 lg:min-h-[280px]">
            <img
              src="/src/assets/images/sk_tudan_camp_hero_1795142373487.jpg"
              alt="Suasana tapak perkhemahan Badan Beruniform SK Tudan pada waktu senja"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/25 to-transparent lg:bg-gradient-to-r lg:from-slate-900 lg:via-slate-900/25 lg:to-transparent"
            />
          </div>
        </div>
      </section>

      {/* Personal Status Check & Registration Card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Semak Nama &amp; Pendaftaran Slot
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Guru yang sudah tersenarai boleh terus menyemak slot masing-masing tanpa perlu mendaftar semula.
            </p>
          </div>

          {campNights.length > 1 && (
            <div className="shrink-0">
              <label htmlFor="camp-night-filter" className="sr-only">
                Pilih Malam Perkhemahan
              </label>
              <select
                id="camp-night-filter"
                value={campNight.id}
                onChange={(e) => onSelectCampNight(Number(e.target.value))}
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-teal-700 focus:outline-none"
              >
                {campNights.map((cn) => (
                  <option key={cn.id} value={cn.id}>
                    {cn.title} ({cn.startDateDisplay})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: Check Name */}
          <div className="lg:col-span-6 space-y-4">
            {currentUser?.role === 'teacher' ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-3">
                <div className="flex items-center gap-2.5 text-sm text-teal-950">
                  <UserCheck className="h-5 w-5 shrink-0 text-teal-700" />
                  <div>
                    <span className="font-semibold">Akses Disahkan: </span>
                    <span>{currentUser.name}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenAuth('teacher')}
                  className="min-h-[36px] shrink-0 text-xs font-semibold text-teal-800 underline underline-offset-4 hover:text-teal-950"
                >
                  Tukar Akaun
                </button>
              </div>
            ) : (
              <div>
                <label
                  htmlFor="check-teacher-name"
                  className="block text-sm font-semibold text-slate-800"
                >
                  Semak Nama Anda dalam Jadual
                </label>
                <div className="relative mt-1.5">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <select
                    id="check-teacher-name"
                    value={lookupTeacherId}
                    onChange={(e) => {
                      setLookupTeacherId(e.target.value);
                      setError(null);
                    }}
                    className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                  >
                    <option value="">-- Pilih nama guru untuk semakan --</option>
                    {eligibleTeachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {inspectedTeacher && inspectedSlot && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-950">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                  <div>
                    <p className="font-bold">
                      Anda telah berdaftar dalam Slot {inspectedSlot.slotNumber}
                    </p>
                    <p className="mt-1 text-slate-700">
                      Nama: <span className="font-semibold text-slate-900">{inspectedTeacher.name}</span>
                      {inspectedTeacher.isLeader ? ' (Ketua Slot)' : ' (Petugas)'}
                    </p>
                    <p className="mt-1 font-mono text-xs text-slate-700 tabular-nums">
                      Tarikh: {inspectedSlot.startDateDisplay}
                      {inspectedSlot.endDate !== inspectedSlot.startDate
                        ? ` – ${inspectedSlot.endDateDisplay}`
                        : ''}{' '}
                      · Waktu: {inspectedSlot.displayTime}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {inspectedTeacher && !inspectedSlot && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-950">
                <p className="font-semibold">
                  {inspectedTeacher.name} belum berdaftar dalam mana-mana slot.
                </p>
                <p className="mt-1 text-xs text-amber-900">
                  {currentUser?.role === 'teacher' && currentUser.id === inspectedTeacher.id
                    ? 'Sila pilih slot yang masih mempunyai kekosongan di sebelah dan tekan "Sahkan Pendaftaran".'
                    : 'Untuk mendaftar slot bagi nama ini, sila sahkan identiti melalui Log Masuk Akses Peribadi.'}
                </p>
              </div>
            )}
          </div>

          {/* Right: Registration Action */}
          <div className="lg:col-span-6">
            {confirmation ? (
              <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-5">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                  <div>
                    <h3 className="text-base font-bold text-emerald-950">
                      Pendaftaran Disahkan
                    </h3>
                    <dl className="mt-2 space-y-1 text-sm text-emerald-900">
                      <div>
                        <dt className="inline font-semibold">Nama: </dt>
                        <dd className="inline">{confirmation.teacherName}</dd>
                      </div>
                      <div>
                        <dt className="inline font-semibold">Slot: </dt>
                        <dd className="inline">Slot {confirmation.slotNumber}</dd>
                      </div>
                      <div>
                        <dt className="inline font-semibold">Tarikh &amp; Waktu Bertugas: </dt>
                        <dd className="inline font-mono text-xs tabular-nums">
                          {confirmation.startDateDisplay}
                          {confirmation.endDateDisplay !== confirmation.startDateDisplay
                            ? ` hingga ${confirmation.endDateDisplay}`
                            : ''}{' '}
                          ({confirmation.displayTime})
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </div>
            ) : currentUser?.role === 'teacher' && !currentUser.registeredSlotNumber ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                <h3 className="text-sm font-bold text-slate-900">
                  Pilih Slot Terbuka untuk {currentUser.name}
                </h3>
                {openSlots.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">
                    Tiada slot yang mempunyai kekosongan buat masa ini. Sila rujuk Penyelaras sekiranya kuota Slot 6 belum ditetapkan.
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    <div className="space-y-2">
                      {openSlots.map((s) => (
                        <label
                          key={s.slotNumber}
                          className={`flex min-h-[48px] cursor-pointer items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-sm transition-colors ${
                            selectedSlotNumber === s.slotNumber
                              ? 'border-teal-700 bg-teal-50/60 text-slate-900'
                              : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="radio"
                              name="register-slot"
                              checked={selectedSlotNumber === s.slotNumber}
                              onChange={() => {
                                setSelectedSlotNumber(s.slotNumber);
                                setError(null);
                              }}
                              className="h-4 w-4 text-teal-700 focus:ring-teal-700"
                            />
                            <div>
                              <div className="font-semibold">
                                Slot {s.slotNumber} · {s.displayTime}
                              </div>
                              <div className="font-mono text-xs text-slate-500 tabular-nums">
                                {s.startDateDisplay}
                                {s.endDate !== s.startDate ? ` – ${s.endDateDisplay}` : ''}
                              </div>
                            </div>
                          </div>
                          <span className="shrink-0 font-mono text-xs font-semibold text-teal-800 tabular-nums">
                            {s.remainingSeats} kekosongan
                          </span>
                        </label>
                      ))}
                    </div>

                    {error && (
                      <div
                        role="alert"
                        className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800"
                      >
                        {error}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleConfirmRegistration}
                      disabled={submitting || !selectedSlotNumber}
                      className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {submitting ? 'Menyimpan Pendaftaran...' : 'Sahkan Pendaftaran'}
                    </button>
                  </div>
                )}
              </div>
            ) : currentUser?.role === 'teacher' && currentUser.registeredSlotNumber ? (
              <div className="flex h-full items-center rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
                <p>
                  Pendaftaran anda telah lengkap untuk malam perkhemahan ini. Sekiranya memerlukan pertukaran slot, sila hubungi Penyelaras Perkhemahan.
                </p>
              </div>
            ) : (
              <div className="flex h-full flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-5">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Pendaftaran Guru Baharu / Akses Peribadi
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Guru yang belum berdaftar perlu log masuk menggunakan kod akses peribadi untuk memilih slot yang masih dibuka dan mengesahkan pendaftaran.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenAuth('teacher')}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 self-start rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  <Lock className="h-4 w-4" />
                  <span>Log Masuk untuk Daftar / Semak Akses</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Slot Schedule Grid (Responsive Cards, No Horizontal Scroll on Mobile) */}
      <section className="space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              Jadual Slot Sentri Malam
            </h2>
            <p className="text-sm text-slate-600">
              Enam giliran pemantauan bagi {campNight.title} bermula {campNight.startDateDisplay}.
            </p>
          </div>
          <div className="font-mono text-xs text-slate-500 tabular-nums">
            {openSlots.length} daripada 6 slot dibuka untuk pendaftaran
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {slots.map((slot) => {
            const isFull = slot.statusLabel === 'Penuh';
            const isUnset = slot.quota === null;
            const statusTextColor = isUnset
              ? 'text-amber-800'
              : isFull
              ? 'text-slate-600'
              : 'text-emerald-800';

            return (
              <article
                key={slot.slotNumber}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5"
              >
                <div>
                  {/* Card Top Metadata Line (Zero-Pill Rule) */}
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        Slot {slot.slotNumber}
                      </h3>
                      <p className="mt-0.5 flex items-center gap-1.5 font-mono text-xs text-slate-600 tabular-nums">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        <span>
                          {slot.displayTime} · {slot.durationMinutes} minit
                        </span>
                      </p>
                    </div>
                    <span className={`text-xs font-bold whitespace-nowrap ${statusTextColor}`}>
                      {slot.statusLabel}
                    </span>
                  </div>

                  {/* Date & Leader Info */}
                  <div className="mt-3 space-y-1.5 text-xs text-slate-600">
                    <div className="flex items-center justify-between gap-2">
                      <span>Tarikh Bertugas</span>
                      <span className="font-mono font-medium text-slate-800 tabular-nums">
                        {slot.startDate === slot.endDate
                          ? slot.startDateDisplay
                          : `${slot.startDateDisplay} → ${slot.endDateDisplay}`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span>Ketua Slot</span>
                      <span
                        className={`font-semibold text-right ${
                          slot.leaderName ? 'text-teal-800' : 'text-amber-700'
                        }`}
                      >
                        {slot.leaderName || 'Ketua belum ditetapkan'}
                      </span>
                    </div>
                  </div>

                  {/* Registered Teachers List */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 text-slate-400" />
                        <span>Senarai Petugas</span>
                      </span>
                      <span className="font-mono tabular-nums text-slate-500">
                        {slot.registeredCount}
                        {slot.quota !== null ? ` / ${slot.quota}` : ''} orang
                      </span>
                    </div>

                    {slot.members.length === 0 ? (
                      <p className="mt-2 text-xs italic text-slate-400">
                        Belum ada guru berdaftar.
                      </p>
                    ) : (
                      <ul className="mt-2 divide-y divide-slate-100 border-t border-slate-100">
                        {slot.members.map((m) => (
                          <li
                            key={m.teacherId}
                            className="flex items-center justify-between gap-2 py-2 text-sm"
                          >
                            <span className="text-slate-900 break-words">
                              {m.name}
                            </span>
                            <span
                              className={`shrink-0 text-xs font-semibold ${
                                m.isLeader ? 'text-teal-700' : 'text-slate-500'
                              }`}
                            >
                              {m.isLeader ? 'Ketua Slot' : 'Petugas'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {/* Quota & Vacancy Footer */}
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-600 font-mono tabular-nums">
                  <span>
                    Kuota:{' '}
                    <strong className="font-semibold text-slate-900">
                      {slot.quota !== null ? `${slot.quota} orang` : 'Kuota belum ditetapkan'}
                    </strong>
                  </span>
                  <span>
                    Baki:{' '}
                    <strong
                      className={`font-semibold ${
                        slot.remainingSeats && slot.remainingSeats > 0
                          ? 'text-emerald-700'
                          : 'text-slate-800'
                      }`}
                    >
                      {slot.quota === null
                        ? '-'
                        : slot.remainingSeats === 0
                        ? '0 tempat'
                        : `${slot.remainingSeats} tempat`}
                    </strong>
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
