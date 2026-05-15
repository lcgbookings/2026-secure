import { createAdminClient } from '@/lib/supabase/admin';

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
