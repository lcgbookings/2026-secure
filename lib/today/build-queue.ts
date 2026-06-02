import { createAdminClient } from '@/lib/supabase/admin';

export type QueuePriority =
  | 'hot'
  | 'reminder_24h'
  | 'no_show_recovery'
  | 'new_pre_event'
  | 'stale_followup';

export type QueueItem = {
  id: string;
  priority: QueuePriority;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  session_label_short: string;
  event_start_time: string;
  context_quote: string | null;
};

type AttendeeEmbed = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
};
type EventEmbed = {
  session_label?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  status?: string | null;
};

function unwrap<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

// Skip filtering: applied in JS so the query never references skipped_until,
// which means the page works before the migration adds the column. Once the
// column exists, rows will carry the field and this filters them out.
function isSkippedNow(row: Record<string, unknown>): boolean {
  const v = row.skipped_until;
  if (v == null) return false;
  if (typeof v !== 'string') return false;
  return new Date(v).getTime() > Date.now();
}

function toItem(
  bookingId: string,
  priority: QueuePriority,
  attendee: AttendeeEmbed | null,
  event: EventEmbed | null,
  contextQuote: string | null,
): QueueItem | null {
  if (!attendee || !event?.start_time) return null;
  return {
    id: bookingId,
    priority,
    first_name: attendee.first_name ?? '',
    last_name: attendee.last_name ?? '',
    email: attendee.email ?? '',
    phone: attendee.phone ?? null,
    session_label_short: event.session_label ?? '',
    event_start_time: event.start_time,
    context_quote: contextQuote,
  };
}

export async function buildTodayQueue(): Promise<QueueItem[]> {
  const supabase = createAdminClient();
  const now = Date.now();
  const in24hMs = now + 24 * 60 * 60 * 1000;
  const in2daysMs = now + 2 * 24 * 60 * 60 * 1000;
  const tenDaysAgoIso = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgoMs = now - 14 * 24 * 60 * 60 * 1000;

  const seen = new Set<string>();
  const out: QueueItem[] = [];
  const push = (item: QueueItem | null) => {
    if (!item) return;
    if (seen.has(item.id)) return;
    seen.add(item.id);
    out.push(item);
  };

  // 1. HOT LEADS
  const { data: hotRaw } = await supabase
    .from('bookings')
    .select(
      `id, hardest_under_pressure, most_useful_insight,
       attendee:attendees!inner ( first_name, last_name, email, phone ),
       event:events!inner ( session_label, start_time, end_time )`,
    )
    .eq('attendance_status', 'attended')
    .eq('coaching_interest', 'speak_before_leaving')
    .or('masterclass_outcome.is.null,masterclass_outcome.in.(not_yet_reached,in_conversation)');

  const hotItems = (hotRaw ?? [])
    .filter((row) => !isSkippedNow(row as Record<string, unknown>))
    .map((row) => {
      const ev = unwrap<EventEmbed>(
        row.event as unknown as EventEmbed | EventEmbed[] | null,
      );
      const att = unwrap<AttendeeEmbed>(
        row.attendee as unknown as AttendeeEmbed | AttendeeEmbed[] | null,
      );
      const quote =
        (row.hardest_under_pressure as string | null) ||
        (row.most_useful_insight as string | null) ||
        null;
      return { item: toItem(row.id as string, 'hot', att, ev, quote), ev };
    })
    .filter((x): x is { item: QueueItem; ev: EventEmbed | null } => x.item !== null)
    .sort((a, b) => {
      const aT = new Date(a.ev?.end_time ?? a.item.event_start_time).getTime();
      const bT = new Date(b.ev?.end_time ?? b.item.event_start_time).getTime();
      return bT - aT;
    })
    .map((x) => x.item);

  for (const it of hotItems) push(it);

  // 2. 24-HOUR REMINDERS
  const { data: reminderRaw } = await supabase
    .from('bookings')
    .select(
      `id, last_contact_at,
       attendee:attendees!inner ( first_name, last_name, email, phone ),
       event:events!inner ( session_label, start_time, end_time, status )`,
    )
    .in('confirmation_status', ['confirmed', 'pending']);

  const reminderItems = (reminderRaw ?? [])
    .filter((row) => !isSkippedNow(row as Record<string, unknown>))
    .map((row) => {
      const ev = unwrap<EventEmbed>(
        row.event as unknown as EventEmbed | EventEmbed[] | null,
      );
      const att = unwrap<AttendeeEmbed>(
        row.attendee as unknown as AttendeeEmbed | AttendeeEmbed[] | null,
      );
      if (!ev || ev.status !== 'scheduled' || !ev.start_time) return null;
      const startTs = new Date(ev.start_time).getTime();
      if (startTs < now || startTs > in24hMs) return null;
      const lc = (row.last_contact_at as string | null) ?? null;
      if (lc) {
        const lcTs = new Date(lc).getTime();
        if (lcTs >= startTs - 24 * 60 * 60 * 1000) return null;
      }
      return toItem(row.id as string, 'reminder_24h', att, ev, null);
    })
    .filter((x): x is QueueItem => x !== null)
    .sort(
      (a, b) =>
        new Date(a.event_start_time).getTime() - new Date(b.event_start_time).getTime(),
    );

  for (const it of reminderItems) push(it);

  // 3. NO-SHOW RECOVERY
  const { data: noShowRaw } = await supabase
    .from('bookings')
    .select(
      `id, last_contact_at,
       attendee:attendees!inner ( first_name, last_name, email, phone ),
       event:events!inner ( session_label, start_time, end_time )`,
    )
    .eq('attendance_status', 'no_show');

  const noShowItems = (noShowRaw ?? [])
    .filter((row) => !isSkippedNow(row as Record<string, unknown>))
    .map((row) => {
      const ev = unwrap<EventEmbed>(
        row.event as unknown as EventEmbed | EventEmbed[] | null,
      );
      const att = unwrap<AttendeeEmbed>(
        row.attendee as unknown as AttendeeEmbed | AttendeeEmbed[] | null,
      );
      if (!ev?.end_time) return null;
      const endTs = new Date(ev.end_time).getTime();
      if (!(endTs > fourteenDaysAgoMs && endTs < now)) return null;
      const lc = (row.last_contact_at as string | null) ?? null;
      if (lc) {
        const lcTs = new Date(lc).getTime();
        if (lcTs > endTs) return null;
      }
      return { item: toItem(row.id as string, 'no_show_recovery', att, ev, null), ev };
    })
    .filter((x): x is { item: QueueItem; ev: EventEmbed } => !!x && x.item !== null)
    .sort((a, b) => new Date(b.ev.end_time!).getTime() - new Date(a.ev.end_time!).getTime())
    .map((x) => x.item);

  for (const it of noShowItems) push(it);

  // 4. NEW PRE-EVENT CALLS
  const { data: newCallRaw } = await supabase
    .from('bookings')
    .select(
      `id, created_at,
       attendee:attendees!inner ( first_name, last_name, email, phone ),
       event:events!inner ( session_label, start_time, end_time, status )`,
    )
    .eq('confirmation_status', 'pending')
    .is('last_contact_at', null)
    .order('created_at', { ascending: true });

  const newCallItems = (newCallRaw ?? [])
    .filter((row) => !isSkippedNow(row as Record<string, unknown>))
    .map((row) => {
      const ev = unwrap<EventEmbed>(
        row.event as unknown as EventEmbed | EventEmbed[] | null,
      );
      const att = unwrap<AttendeeEmbed>(
        row.attendee as unknown as AttendeeEmbed | AttendeeEmbed[] | null,
      );
      if (!ev || ev.status !== 'scheduled' || !ev.start_time) return null;
      if (new Date(ev.start_time).getTime() <= now) return null;
      return toItem(row.id as string, 'new_pre_event', att, ev, null);
    })
    .filter((x): x is QueueItem => x !== null);

  for (const it of newCallItems) push(it);

  // 5. STALE 10-DAY FOLLOW-UPS
  const { data: staleRaw } = await supabase
    .from('bookings')
    .select(
      `id, last_contact_at,
       attendee:attendees!inner ( first_name, last_name, email, phone ),
       event:events!inner ( session_label, start_time, end_time, status )`,
    )
    .eq('confirmation_status', 'confirmed')
    .lt('last_contact_at', tenDaysAgoIso)
    .order('last_contact_at', { ascending: true });

  const staleItems = (staleRaw ?? [])
    .filter((row) => !isSkippedNow(row as Record<string, unknown>))
    .map((row) => {
      const ev = unwrap<EventEmbed>(
        row.event as unknown as EventEmbed | EventEmbed[] | null,
      );
      const att = unwrap<AttendeeEmbed>(
        row.attendee as unknown as AttendeeEmbed | AttendeeEmbed[] | null,
      );
      if (!ev || ev.status !== 'scheduled' || !ev.start_time) return null;
      if (new Date(ev.start_time).getTime() <= in2daysMs) return null;
      return toItem(row.id as string, 'stale_followup', att, ev, null);
    })
    .filter((x): x is QueueItem => x !== null);

  for (const it of staleItems) push(it);

  return out;
}
