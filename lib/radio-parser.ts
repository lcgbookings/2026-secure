import { fromZonedTime } from 'date-fns-tz';

const LONDON_TZ = 'Europe/London';

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

// "Sat 13 June, 13:30–17:00"
//  weekday day  month   comma  HH:MM  separator HH:MM
const LABEL_RE =
  /^[A-Za-z]{3,}\s+(\d{1,2})\s+([A-Za-z]+),\s*(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})$/;

export interface ParsedRadioLabel {
  start_time: string;
  end_time: string;
  parsed_day: number;
  parsed_month: number;
  parsed_year: number;
}

export function parseRadioLabel(label: string): ParsedRadioLabel | null {
  if (!label) return null;

  const match = label.trim().match(LABEL_RE);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const monthKey = match[2].toLowerCase();
  const month = MONTHS[monthKey];
  if (!month) return null;

  const startH = parseInt(match[3], 10);
  const startM = parseInt(match[4], 10);
  const endH = parseInt(match[5], 10);
  const endM = parseInt(match[6], 10);

  // Year disambiguation: if month/day in the current calendar year has already
  // passed (compared to today in London), roll to next year.
  const now = new Date();
  const todayLondon = new Date(
    now.toLocaleString('en-US', { timeZone: LONDON_TZ })
  );
  const thisYear = todayLondon.getFullYear();

  const candidateThisYear = new Date(thisYear, month - 1, day);
  const todayDateOnly = new Date(
    todayLondon.getFullYear(),
    todayLondon.getMonth(),
    todayLondon.getDate()
  );
  const year =
    candidateThisYear < todayDateOnly ? thisYear + 1 : thisYear;

  const pad = (n: number) => String(n).padStart(2, '0');
  const startWall = `${year}-${pad(month)}-${pad(day)}T${pad(startH)}:${pad(startM)}:00`;
  const endWall = `${year}-${pad(month)}-${pad(day)}T${pad(endH)}:${pad(endM)}:00`;

  const start = fromZonedTime(startWall, LONDON_TZ);
  const end = fromZonedTime(endWall, LONDON_TZ);

  return {
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    parsed_day: day,
    parsed_month: month,
    parsed_year: year,
  };
}
