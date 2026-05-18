import { createAdminClient } from '@/lib/supabase/admin';
import { fromZonedTime } from 'date-fns-tz';

interface ParsedLabel {
  day: number;
  monthIndex: number; // 0-11
  matchedYear: number;
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

export function parseMasterclassDateLabel(label: string): ParsedLabel | null {
  if (!label) return null;
  const normalised = label.toLowerCase();

  // Match day: "13th", "27th", "1st", "2nd", "3rd", "30th"
  const dayMatch = normalised.match(/(\d{1,2})(st|nd|rd|th)/);
  if (!dayMatch) return null;
  const day = parseInt(dayMatch[1], 10);

  // Match month name
  let monthIndex = -1;
  for (let i = 0; i < MONTHS.length; i++) {
    if (normalised.includes(MONTHS[i])) {
      monthIndex = i;
      break;
    }
  }
  if (monthIndex === -1) return null;

  // Year disambiguation: pick the upcoming occurrence. If the date has already
  // passed this year, assume next year.
  const now = new Date();
  let candidateYear = now.getFullYear();
  const candidateDate = new Date(candidateYear, monthIndex, day);
  if (candidateDate < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
    candidateYear += 1;
  }

  return { day, monthIndex, matchedYear: candidateYear };
}

export async function findEventIdForLabel(label: string): Promise<string | null> {
  const parsed = parseMasterclassDateLabel(label);
  if (!parsed) return null;

  const monthString = String(parsed.monthIndex + 1).padStart(2, '0');
  const dayString = String(parsed.day).padStart(2, '0');
  const sessionDate = `${parsed.matchedYear}-${monthString}-${dayString}`;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from('events')
    .select('id')
    .eq('session_date', sessionDate)
    .order('start_time', { ascending: true })
    .maybeSingle();

  return data?.id ?? null;
}

// ---------- parseFullEventLabel ----------
// Parses radio button labels of the form:
//   "Saturday 13th June – London – 1:30pm to 5pm"
// (en dash separators, lowercase US times, day with ordinal suffix.)

const LONDON_TZ = 'Europe/London';

export interface ParsedEventCandidate {
  location: string;
  start_time: string;
  end_time: string;
  session_label: string;
  session_date: string;
}

export type ParseResult =
  | { success: true; candidate: ParsedEventCandidate }
  | { success: false; reason: string; raw_label: string };

function parseClockTime(
  raw: string
): { hour: number; minute: number } | { error: string } {
  const trimmed = raw.toLowerCase().trim();
  const m = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return { error: trimmed };
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3];
  if (hour > 23 || minute > 59) return { error: trimmed };
  if (ampm === 'am') {
    if (hour === 12) hour = 0;
  } else if (ampm === 'pm') {
    if (hour !== 12) hour += 12;
  }
  if (hour > 23) return { error: trimmed };
  return { hour, minute };
}

export function parseFullEventLabel(label: string): ParseResult {
  const raw = (label ?? '').trim();

  try {
    if (!raw) {
      return { success: false, reason: 'empty label', raw_label: raw };
    }

    const parsedDate = parseMasterclassDateLabel(raw);
    if (!parsedDate) {
      return { success: false, reason: 'unable to parse date components', raw_label: raw };
    }

    // Split into 3 parts: date – location – times. Accept en dash or hyphen.
    const parts = raw.split(/\s+[–-]\s+/);
    if (parts.length < 3) {
      return {
        success: false,
        reason: 'unexpected separator pattern, need date – location – times',
        raw_label: raw,
      };
    }

    const location = parts[1].trim();
    if (!location) {
      return { success: false, reason: 'empty location', raw_label: raw };
    }

    const timesPart = parts[2].trim();
    const timeBits = timesPart.split(/\s+to\s+/i);
    if (timeBits.length !== 2) {
      return { success: false, reason: 'cannot split times on "to"', raw_label: raw };
    }

    const startParsed = parseClockTime(timeBits[0]);
    if ('error' in startParsed) {
      return {
        success: false,
        reason: `unable to parse start time: ${startParsed.error}`,
        raw_label: raw,
      };
    }
    const endParsed = parseClockTime(timeBits[1]);
    if ('error' in endParsed) {
      return {
        success: false,
        reason: `unable to parse end time: ${endParsed.error}`,
        raw_label: raw,
      };
    }

    const monthString = String(parsedDate.monthIndex + 1).padStart(2, '0');
    const dayString = String(parsedDate.day).padStart(2, '0');
    const session_date = `${parsedDate.matchedYear}-${monthString}-${dayString}`;

    const pad = (n: number) => String(n).padStart(2, '0');
    const startWall = `${session_date}T${pad(startParsed.hour)}:${pad(startParsed.minute)}:00`;
    const endWall = `${session_date}T${pad(endParsed.hour)}:${pad(endParsed.minute)}:00`;

    const start_time = fromZonedTime(startWall, LONDON_TZ).toISOString();
    const end_time = fromZonedTime(endWall, LONDON_TZ).toISOString();

    return {
      success: true,
      candidate: {
        location,
        start_time,
        end_time,
        session_label: raw,
        session_date,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, reason: `unexpected error: ${message}`, raw_label: raw };
  }
}
