export const MALAYSIA_TZ = 'Asia/Kuala_Lumpur';

export function getTodayMY(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MALAYSIA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const month = parts.find((p) => p.type === 'month')?.value ?? '11';
  const day = parts.find((p) => p.type === 'day')?.value ?? '20';
  return `${year}-${month}-${day}`;
}

export function addDaysYYYYMMDD(yyyyMmDd: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd);
  if (!match) return yyyyMmDd;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcDate = new Date(Date.UTC(year, month - 1, day + days));
  const y = utcDate.getUTCFullYear();
  const m = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utcDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getSlotDates(campStartDate: string, slotNumber: number): {
  startDate: string;
  endDate: string;
} {
  if (slotNumber === 1) {
    return { startDate: campStartDate, endDate: campStartDate };
  }
  if (slotNumber === 2) {
    return {
      startDate: campStartDate,
      endDate: addDaysYYYYMMDD(campStartDate, 1),
    };
  }
  const nextDay = addDaysYYYYMMDD(campStartDate, 1);
  return { startDate: nextDay, endDate: nextDay };
}

export function formatDateDisplayMY(yyyyMmDd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd);
  if (!match) return yyyyMmDd;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatTimestampMY(isoString: string | null | undefined): string | null {
  if (!isoString) return null;
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return new Intl.DateTimeFormat('ms-MY', {
    timeZone: MALAYSIA_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}
