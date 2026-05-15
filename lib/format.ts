import { format, formatDistanceToNowStrict } from 'date-fns';

export function formatMoney(pence: number, currency = 'gbp'): string {
  const symbol = currency.toLowerCase() === 'gbp' ? '£' : '$';
  return `${symbol}${(pence / 100).toFixed(2)}`;
}

export function formatEventDateTime(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const datePart = format(start, 'EEEE, MMMM d');
  const startTime = format(start, 'h:mma').toLowerCase();
  const endTime = format(end, 'h:mma').toLowerCase();
  return `${datePart}, ${startTime} to ${endTime}`;
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
