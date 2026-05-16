import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatEventDateTime, formatEventDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

// ---------- types ----------
type Attendee = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
};
type EventEmbed = {
  id?: string | null;
  session_label?: string | null;
  start_time?: string | null;
  end_time?: string | null;
};
type BookingRow = {
  id: string;
  created_at?: string;
  attendee: Attendee | Attendee[] | null;
  event: EventEmbed | EventEmbed[] | null;
};

function unwrapAttendee(a: Attendee | Attendee[] | null): Attendee | null {
  if (!a) return null;
  return Array.isArray(a) ? a[0] ?? null : a;
}
function unwrapEvent(e: EventEmbed | EventEmbed[] | null): EventEmbed | null {
  if (!e) return null;
  return Array.isArray(e) ? e[0] ?? null : e;
}

export default async function AdminHome() {
  const supabase = createAdminClient();
  const nowIso = new Date().toISOString();
  const now = Date.now();

  // ---------- upcoming events list (unchanged) ----------
  const { data: events } = await supabase
    .from('events')
    .select('id, session_label, start_time, end_time, venue, capacity, status')
    .gte('end_time', nowIso)
    .order('start_time', { ascending: true });

  const eventIds = (events ?? []).map((e) => e.id);
  const { data: bookings } = await supabase
    .from('bookings')
    .select('event_id, confirmation_status')
    .in('event_id', eventIds.length ? eventIds : ['00000000-0000-0000-0000-000000000000']);

  const totalPending = (bookings ?? []).filter(
    (b) => b.confirmation_status === 'pending'
  ).length;
  const totalConfirmed = (bookings ?? []).filter(
    (b) => b.confirmation_status === 'confirmed'
  ).length;
  const totalBookings = (bookings ?? []).length;

  const statsByEvent = new Map<string, { booked: number; confirmed: number; pending: number }>();
  for (const b of bookings ?? []) {
    if (!b.event_id) continue;
    const s = statsByEvent.get(b.event_id) ?? { booked: 0, confirmed: 0, pending: 0 };
    s.booked += 1;
    if (b.confirmation_status === 'confirmed') s.confirmed += 1;
    if (b.confirmation_status === 'pending') s.pending += 1;
    statsByEvent.set(b.event_id, s);
  }

  // ---------- QUEUE 1: post-event no-show reschedules ----------
  const { data: postEventNoShowsRaw } = await supabase
    .from('bookings')
    .select(
      `id,
       attendee:attendees!inner (first_name, last_name, email, phone),
       event:events!inner (session_label, start_time, end_time)`
    )
    .eq('attendance_status', 'no_show')
    .is('no_show_lost_at', null);

  const postEventNoShows = ((postEventNoShowsRaw ?? []) as unknown as BookingRow[])
    .filter((b) => {
      const ev = unwrapEvent(b.event);
      return ev?.end_time && new Date(ev.end_time).getTime() < now;
    })
    .sort((a, b) => {
      const aT = new Date(unwrapEvent(a.event)?.start_time ?? 0).getTime();
      const bT = new Date(unwrapEvent(b.event)?.start_time ?? 0).getTime();
      return bT - aT; // DESC
    });

  // ---------- QUEUE 2: 24-hour reminders ----------
  const next24hIso = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  const { data: confirmedSoonRaw } = await supabase
    .from('bookings')
    .select(
      `id,
       confirmation_status,
       attendee:attendees!inner (first_name, last_name, email, phone),
       event:events!inner (id, session_label, start_time)`
    )
    .eq('confirmation_status', 'confirmed')
    .gte('event.start_time', nowIso)
    .lte('event.start_time', next24hIso);

  const confirmedSoon = (confirmedSoonRaw ?? []) as unknown as BookingRow[];
  const confirmedSoonIds = confirmedSoon.map((b) => b.id);

  const { data: reminderAttempts } = await supabase
    .from('call_attempts')
    .select('booking_id')
    .in(
      'booking_id',
      confirmedSoonIds.length ? confirmedSoonIds : ['00000000-0000-0000-0000-000000000000']
    )
    .eq('attempt_type', '24h_reminder');
  const remindedIds = new Set((reminderAttempts ?? []).map((a) => a.booking_id));

  const twentyFourHourReminders = confirmedSoon
    .filter((b) => !remindedIds.has(b.id))
    .sort((a, b) => {
      const aT = new Date(unwrapEvent(a.event)?.start_time ?? 0).getTime();
      const bT = new Date(unwrapEvent(b.event)?.start_time ?? 0).getTime();
      return aT - bT; // ASC
    });

  // ---------- QUEUE 3: new bookings to call ----------
  const { data: pendingBookingsRaw } = await supabase
    .from('bookings')
    .select(
      `id,
       created_at,
       attendee:attendees!inner (first_name, last_name, email, phone),
       event:events!inner (id, session_label, start_time, end_time)`
    )
    .eq('confirmation_status', 'pending')
    .order('created_at', { ascending: true });

  const pendingBookings = (pendingBookingsRaw ?? []) as unknown as BookingRow[];
  const pendingIds = pendingBookings.map((b) => b.id);

  const { data: attemptedAlready } = await supabase
    .from('call_attempts')
    .select('booking_id')
    .in(
      'booking_id',
      pendingIds.length ? pendingIds : ['00000000-0000-0000-0000-000000000000']
    );
  const attemptedIds = new Set((attemptedAlready ?? []).map((a) => a.booking_id));

  const newToCall = pendingBookings.filter((b) => {
    if (attemptedIds.has(b.id)) return false;
    const ev = unwrapEvent(b.event);
    return ev?.end_time ? new Date(ev.end_time).getTime() > now : false;
  });

  // ---------- QUEUE 4: stale follow-ups ----------
  const { data: activeBookingsRaw } = await supabase
    .from('bookings')
    .select(
      `id,
       confirmation_status,
       attendee:attendees!inner (first_name, last_name, email, phone),
       event:events!inner (id, session_label, start_time, end_time)`
    )
    .neq('confirmation_status', 'cancelled');

  const activeBookings = (activeBookingsRaw ?? []) as unknown as BookingRow[];
  const activeIds = activeBookings
    .filter((b) => {
      const ev = unwrapEvent(b.event);
      return ev?.end_time ? new Date(ev.end_time).getTime() > now : false;
    })
    .map((b) => b.id);

  const { data: latestAttempts } = await supabase
    .from('call_attempts')
    .select('booking_id, created_at')
    .in(
      'booking_id',
      activeIds.length ? activeIds : ['00000000-0000-0000-0000-000000000000']
    )
    .order('created_at', { ascending: false });

  const latestMap = new Map<string, string>();
  for (const a of latestAttempts ?? []) {
    if (!latestMap.has(a.booking_id)) latestMap.set(a.booking_id, a.created_at);
  }

  const tenDaysAgoMs = now - 10 * 24 * 60 * 60 * 1000;
  const staleFollowups = activeBookings
    .filter((b) => {
      const ev = unwrapEvent(b.event);
      if (!ev?.end_time || new Date(ev.end_time).getTime() <= now) return false;
      const latest = latestMap.get(b.id);
      if (!latest) return false;
      return new Date(latest).getTime() < tenDaysAgoMs;
    })
    .sort((a, b) => {
      const aT = new Date(latestMap.get(a.id) ?? 0).getTime();
      const bT = new Date(latestMap.get(b.id) ?? 0).getTime();
      return aT - bT; // most stale first (oldest latest-attempt)
    });

  // ---------- QUEUE 5: calendar invites to update ----------
  const { data: invitesToUpdateRaw } = await supabase
    .from('bookings')
    .select(
      `id,
       attendee:attendees!inner (first_name, last_name, email, phone),
       event:events!inner (id, session_label, start_time)`
    )
    .eq('calendar_invite_pending_update', true);

  const invitesToUpdate = ((invitesToUpdateRaw ?? []) as unknown as BookingRow[]).sort(
    (a, b) => {
      const aT = new Date(unwrapEvent(a.event)?.start_time ?? 0).getTime();
      const bT = new Date(unwrapEvent(b.event)?.start_time ?? 0).getTime();
      return aT - bT;
    }
  );

  // ---------- Auto-created events needing review ----------
  const { data: autoCreatedNeedingReview } = await supabase
    .from('events')
    .select('id, session_label, start_time')
    .eq('auto_created', true)
    .is('calendar_url', null)
    .gte('end_time', nowIso)
    .order('start_time', { ascending: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-neutral-500 mt-1">Upcoming events and bookings.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatTile label="Upcoming bookings" value={totalBookings} />
        <StatTile label="Confirmed" value={totalConfirmed} accent="green" />
        <StatTile label="Pending calls" value={totalPending} accent="amber" />
      </div>

      <QueueSection
        title="Post-event no-show reschedule"
        rows={postEventNoShows}
        tail="Tap to call"
      />
      <QueueSection
        title="24-hour reminders"
        rows={twentyFourHourReminders}
        tail="Tap to call"
      />
      <QueueSection title="New bookings to call" rows={newToCall} tail="Tap to call" />
      <QueueSection title="Stale follow-ups" rows={staleFollowups} tail="Tap to call" />
      <QueueSection
        title="Calendar invites to update"
        rows={invitesToUpdate}
        tail="Update invite"
      />

      {(autoCreatedNeedingReview?.length ?? 0) > 0 && (
        <div>
          <h2 className="text-sm font-semibold uppercase text-neutral-500 mb-3">
            Auto-created events needing review ({autoCreatedNeedingReview?.length ?? 0})
          </h2>
          <div className="border rounded-lg divide-y">
            {(autoCreatedNeedingReview ?? []).map((ev) => (
              <Link
                key={ev.id}
                href={`/admin/events/${ev.id}`}
                className="flex items-center justify-between gap-4 p-3 hover:bg-neutral-50 transition"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{ev.session_label}</p>
                  <p className="text-xs text-neutral-500">{formatEventDate(ev.start_time)}</p>
                </div>
                <div className="text-right text-xs text-neutral-600 whitespace-nowrap">
                  <p className="text-neutral-400">Set up</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold uppercase text-neutral-500 mb-3">
          Upcoming events
        </h2>

        {(events?.length ?? 0) === 0 ? (
          <div className="border rounded-lg p-8 text-center text-neutral-500">
            No upcoming events scheduled.
          </div>
        ) : (
          <div className="space-y-3">
            {(events ?? []).map((event) => {
              const stats = statsByEvent.get(event.id) ?? {
                booked: 0,
                confirmed: 0,
                pending: 0,
              };
              return (
                <Link
                  key={event.id}
                  href={`/admin/events/${event.id}`}
                  className="block border rounded-lg p-4 hover:bg-neutral-50 transition"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <p className="font-semibold">
                        {formatEventDateTime(event.start_time, event.end_time)}
                      </p>
                      <p className="text-sm text-neutral-600 mt-1">
                        {event.venue ?? 'Venue TBC'}
                        {event.capacity ? ` · capacity ${event.capacity}` : ''}
                      </p>
                    </div>
                    <div className="flex gap-4 text-sm">
                      <Stat label="Booked" value={stats.booked} />
                      <Stat label="Confirmed" value={stats.confirmed} accent="green" />
                      <Stat label="Pending" value={stats.pending} accent="amber" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- shared queue section ----------
function QueueSection({
  title,
  rows,
  tail,
}: {
  title: string;
  rows: BookingRow[];
  tail: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h2 className="text-sm font-semibold uppercase text-neutral-500 mb-3">
        {title} ({rows.length})
      </h2>
      <div className="border rounded-lg divide-y">
        {rows.map((b) => {
          const a = unwrapAttendee(b.attendee);
          const ev = unwrapEvent(b.event);
          if (!a || !ev) return null;
          return (
            <Link
              key={b.id}
              href={`/admin/bookings/${b.id}`}
              className="flex items-center justify-between gap-4 p-3 hover:bg-neutral-50 transition"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">
                  {a.first_name} {a.last_name}
                </p>
                <p className="text-xs text-neutral-500 truncate">
                  {a.email ?? 'no email'} · {a.phone ?? 'no phone'}
                </p>
              </div>
              <div className="text-right text-xs text-neutral-600 whitespace-nowrap">
                <p>{ev.start_time ? formatEventDate(ev.start_time) : '—'}</p>
                <p className="text-neutral-500 truncate max-w-[180px]">
                  {ev.session_label ?? ''}
                </p>
                <p className="text-neutral-400">{tail}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  accent = 'neutral',
}: {
  label: string;
  value: number;
  accent?: 'neutral' | 'green' | 'amber';
}) {
  const colour =
    accent === 'green'
      ? 'text-green-700'
      : accent === 'amber'
      ? 'text-amber-700'
      : 'text-neutral-900';
  return (
    <div className="border rounded-lg p-4">
      <p className="text-xs uppercase text-neutral-500">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${colour}`}>{value}</p>
    </div>
  );
}

function Stat({
  label,
  value,
  accent = 'neutral',
}: {
  label: string;
  value: number;
  accent?: 'neutral' | 'green' | 'amber';
}) {
  const colour =
    accent === 'green'
      ? 'text-green-700'
      : accent === 'amber'
      ? 'text-amber-700'
      : 'text-neutral-900';
  return (
    <div className="text-right">
      <p className="text-xs uppercase text-neutral-500">{label}</p>
      <p className={`font-bold ${colour}`}>{value}</p>
    </div>
  );
}
