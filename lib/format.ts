import { formatInTimeZone } from 'date-fns-tz';
import { formatDistanceToNowStrict } from 'date-fns';

const LONDON_TZ = 'Europe/London';

export function formatMoney(pence: number, currency = 'gbp'): string {
  const symbol = currency.toLowerCase() === 'gbp' ? '£' : '$';
  return `${symbol}${(pence / 100).toFixed(2)}`;
}

export function formatEventDateTime(startIso: string, endIso: string): string {
  const datePart = formatInTimeZone(new Date(startIso), LONDON_TZ, 'EEEE, MMMM d');
  const startTime = formatInTimeZone(new Date(startIso), LONDON_TZ, 'h:mma').toLowerCase();
  const endTime = formatInTimeZone(new Date(endIso), LONDON_TZ, 'h:mma').toLowerCase();
  return `${datePart}, ${startTime} to ${endTime}`;
}

export function formatEventDate(startIso: string): string {
  return formatInTimeZone(new Date(startIso), LONDON_TZ, 'EEE, MMM d');
}

export function formatRelativeTime(iso: string): string {
  return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
}

export function labelConfirmationStatus(s: string): string {
  return {
    pending: 'Pending',
    confirmed: 'Confirmed',
    cancelled: 'Cancelled',
    unreachable: 'Unreachable',
  }[s] ?? s;
}

export function labelAttendanceStatus(s: string): string {
  return {
    pending: 'Pending',
    attended: 'Attended',
    no_show: 'No-show',
    excused: 'Excused',
  }[s] ?? s;
}

export function colourConfirmationStatus(s: string): string {
  return {
    pending: 'bg-amber-100 text-amber-800',
    confirmed: 'bg-green-100 text-green-800',
    cancelled: 'bg-neutral-200 text-neutral-700',
    unreachable: 'bg-red-100 text-red-800',
  }[s] ?? 'bg-neutral-100 text-neutral-700';
}

export function colourAttendanceStatus(s: string): string {
  return {
    pending: 'bg-neutral-100 text-neutral-700',
    attended: 'bg-green-100 text-green-800',
    no_show: 'bg-red-100 text-red-800',
    excused: 'bg-blue-100 text-blue-800',
  }[s] ?? 'bg-neutral-100 text-neutral-700';
}

export function labelExperienceLevel(s: string | null): string {
  if (!s) return '-';
  return {
    under_1: 'Less than 1 year',
    '1_to_3': '1 to 3 years',
    '3_to_5': '3 to 5 years',
    '5_plus': '5+ years',
    other: 'Other',
  }[s] ?? s;
}

export function labelResponsibilityLevel(s: string | null): string {
  if (!s) return '-';
  return {
    influence_strategy: 'Influences leadership/strategy',
    manage_teams: 'Manages teams + external rep',
    aspiring_leader: 'Aspiring to leadership',
    other: 'Other',
  }[s] ?? s;
}

export function labelReferralSource(s: string | null): string {
  if (!s) return '-';
  return {
    instagram: 'Instagram',
    word_of_mouth: 'Word of mouth',
    eventbrite: 'Eventbrite',
    tiktok: 'TikTok',
    organisation_employer: 'Organisation / Employer',
    search: 'Search (Google)',
    other: 'Other',
  }[s] ?? s;
}

export function labelRelevance(s: string | null): string {
  if (!s) return '-';
  return {
    very_relevant: 'Very relevant',
    somewhat_relevant: 'Somewhat relevant',
    interesting_not_priority: 'Interesting, not a priority',
    not_relevant: 'Not relevant at this time',
    other: 'Other',
  }[s] ?? s;
}

export function labelCoachingInterest(s: string | null): string {
  if (!s) return '-';
  return {
    speak_before_leaving: 'Wants to join at masterclass rate (hot)',
    apply_via_website: 'Will apply via website later (warm)',
    not_at_this_time: 'Not at this time',
    other: 'Other',
  }[s] ?? s;
}
