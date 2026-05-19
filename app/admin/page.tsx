import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatEventDateTime, formatEventDate } from '@/lib/format';
import MarkInviteUpdatedButton from './mark-invite-updated-button';

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
  last_contact_at?: string | null;
  rescheduled_from_booking_id?: string | null;
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

function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

export default async function AdminHome() {
  const supabase = createAdminClient();
  const nowIso = new Date().toISOString();
  const now = Date.now();
  const in24hMs = now + 24 * 60 * 60 * 1000;
  const in2daysMs = now + 2 * 24 * 60 * 60 * 1000;
  const tenDaysAgoMs = now - 10 * 24 * 60 * 60 * 1000;
  const sixHoursAgoIso = new Date(now - 6 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgoMs = now - 14 * 24 * 60 * 60 * 1000;

  // ---------- Auto-flip pending attendance to no_show for sessions that ended 6h+ ago ----------
  // Idempotent: runs on every dashboard load. Bookings already at 'no_show' don't change.
  try {
    const { data: endedEvents } = await supabase
      .from('events')
      .select('id')
      .eq('status', 'scheduled')
      .lt('end_time', sixHoursAgoIso);

    const endedIds = (endedEvents ?? []).map((e) => e.id);
    if (endedIds.length > 0) {
      const { error: autoFlipError } = await supabase
        .from('bookings')
        .update({ attendance_status: 'no_show' })
        .eq('confirmation_status', 'confirmed')
        .eq('attendance_status', 'pending')
        .is('signed_in_at', null)
        .is('post_session_submitted_at', null)
        .in('event_id', endedIds);

      if (autoFlipError) {
        console.error('[dashboard auto-flip] update failed', autoFlipError);
      }
    }
  } catch (err) {
    console.error('[dashboard auto-flip] threw', err);
  }

  // ---------- upcoming events list (drafts excluded) ----------
  const { data: events } = await supabase
    .from('events')
    .select('id, session_label, start_time, end_time, venue, capacity, status')
    .eq('status', 'scheduled')
    .gte('end_time', nowIso)
    .order('start_time', { ascending: true });

  const { count: draftCount } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'draft');

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

  // ---------- QUEUE 1: 24-hour reminders ----------
  // Bookings with status in ('confirmed','pending') AND event scheduled AND event.start_time in [now, now+24h)
  // AND (last_contact_at is null OR last_contact_at < event.start_time - 24h)
  const { data: reminderCandidatesRaw } = await supabase
    .from('bookings')
    .select(
      `id, last_contact_at,
       attendee:attendees!inner (first_name, last_name, email, phone),
       event:events!inner (id, session_label, start_time, end_time, status)`
    )
    .in('confirmation_status', ['confirmed', 'pending']);

  const reminderCandidates = (reminderCandidatesRaw ?? []) as unknown as BookingRow[];
  const twentyFourHourReminders = reminderCandidates
    .filter((b) => {
      const ev = unwrapEvent(b.event) as
        | (EventEmbed & { status?: string })
        | null;
      if (!ev || ev.status !== 'scheduled' || !ev.start_time) return false;
      const startTs = new Date(ev.start_time).getTime();
      if (startTs < now || startTs > in24hMs) return false;
      const lc = b.last_contact_at;
      if (!lc) return true;
      const lcTs = new Date(lc).getTime();
      return lcTs < startTs - 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => {
      const aT = new Date(unwrapEvent(a.event)?.start_time ?? 0).getTime();
      const bT = new Date(unwrapEvent(b.event)?.start_time ?? 0).getTime();
      return aT - bT;
    });

  // ---------- QUEUE 2: new bookings to call ----------
  // confirmation_status='pending', last_contact_at IS NULL, event scheduled AND future
  const { data: newToCallRaw } = await supabase
    .from('bookings')
    .select(
      `id, created_at, last_contact_at,
       attendee:attendees!inner (first_name, last_name, email, phone),
       event:events!inner (id, session_label, start_time, end_time, status)`
    )
    .eq('confirmation_status', 'pending')
    .is('last_contact_at', null)
    .order('created_at', { ascending: true });

  const newToCall = ((newToCallRaw ?? []) as unknown as BookingRow[]).filter((b) => {
    const ev = unwrapEvent(b.event) as (EventEmbed & { status?: string }) | null;
    if (!ev || ev.status !== 'scheduled' || !ev.start_time) return false;
    return new Date(ev.start_time).getTime() > now;
  });

  // ---------- QUEUE 3: 10-day stale follow-ups ----------
  // confirmation_status='confirmed', last_contact_at < now - 10 days, event > now + 2 days, event scheduled
  const { data: staleCandidatesRaw } = await supabase
    .from('bookings')
    .select(
      `id, last_contact_at,
       attendee:attendees!inner (first_name, last_name, email, phone),
       event:events!inner (id, session_label, start_time, end_time, status)`
    )
    .eq('confirmation_status', 'confirmed')
    .lt('last_contact_at', new Date(tenDaysAgoMs).toISOString())
    .order('last_contact_at', { ascending: true });

  const staleFollowups = ((staleCandidatesRaw ?? []) as unknown as BookingRow[]).filter(
    (b) => {
      const ev = unwrapEvent(b.event) as (EventEmbed & { status?: string }) | null;
      if (!ev || ev.status !== 'scheduled' || !ev.start_time) return false;
      return new Date(ev.start_time).getTime() > in2daysMs;
    }
  );

  // ---------- QUEUE 5: post-event no-show recovery ----------
  const { data: noShowRecoveryRaw } = await supabase
    .from('bookings')
    .select(
      `id, last_contact_at,
       attendee:attendees!inner (first_name, last_name, email, phone),
       event:events!inner (id, session_label, start_time, end_time)`
    )
    .eq('attendance_status', 'no_show');

  const noShowRecovery = ((noShowRecoveryRaw ?? []) as unknown as BookingRow[])
    .filter((b) => {
      const ev = unwrapEvent(b.event);
      if (!ev?.end_time) return false;
      const endTs = new Date(ev.end_time).getTime();
      if (!(endTs > fourteenDaysAgoMs && endTs < now)) return false;
      // Exclude bookings where Abel has already had a post-event conversation
      if (b.last_contact_at) {
        const contactTs = new Date(b.last_contact_at).getTime();
        if (contactTs > endTs) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aT = new Date(unwrapEvent(a.event)?.end_time ?? 0).getTime();
      const bT = new Date(unwrapEvent(b.event)?.end_time ?? 0).getTime();
      return bT - aT; // DESC — most recent sessions first
    });

  // ---------- QUEUE 4: calendar invites to update ----------
  const { data: invitesToUpdateRaw } = await supabase
    .from('bookings')
    .select(
      `id, rescheduled_from_booking_id,
       attendee:attendees!inner (first_name, last_name, email, phone),
       event:events!inner (id, session_label, start_time)`
    )
    .eq('calendar_invite_pending_update', true);

  const invitesToUpdateBase = ((invitesToUpdateRaw ?? []) as unknown as BookingRow[]).sort(
    (a, b) => {
      const aT = new Date(unwrapEvent(a.event)?.start_time ?? 0).getTime();
      const bT = new Date(unwrapEvent(b.event)?.start_time ?? 0).getTime();
      return aT - bT;
    }
  );

  // Resolve "Rescheduled from <session_label>" by fetching the original booking's event
  const fromIds = invitesToUpdateBase
    .map((b) => b.rescheduled_from_booking_id)
    .filter((id): id is string => !!id);

  const fromLabelByOriginalId = new Map<string, string>();
  if (fromIds.length > 0) {
    const { data: origRows } = await supabase
      .from('bookings')
      .select('id, event:events ( session_label )')
      .in('id', fromIds);
    for (const r of origRows ?? []) {
      const ev = Array.isArray(r.event) ? r.event[0] : r.event;
      if (ev?.session_label) {
        fromLabelByOriginalId.set(r.id as string, ev.session_label as string);
      }
    }
  }

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

      {draftCount && draftCount > 0 ? (
        <div className="border border-yellow-200 bg-yellow-50 rounded-lg p-3 flex items-center justify-between">
          <div className="text-sm">
            <span className="font-semibold text-yellow-900">
              {draftCount} draft event{draftCount === 1 ? '' : 's'}
            </span>
            <span className="text-yellow-800">
              {' '}auto-created from radio clicks. Review to add venue and confirm details.
            </span>
          </div>
          <Link
            href="/admin/events?status=draft"
            className="text-xs underline text-yellow-900 whitespace-nowrap ml-3"
          >
            Review →
          </Link>
        </div>
      ) : null}

      {/* QUEUE 1: 24-hour reminders */}
      <QueueSection
        title="24-hour reminders"
        accent="red"
        rows={twentyFourHourReminders}
        tail="Tap to call"
      />

      {/* QUEUE 2: new bookings to call */}
      <QueueSection
        title="New bookings to call"
        accent="neutral"
        rows={newToCall}
        tail="Tap to call"
      />

      {/* QUEUE 3: 10-day stale follow-ups */}
      <QueueSection
        title="10-day stale follow-ups"
        accent="blue"
        rows={staleFollowups}
        tail="Tap to call"
        renderExtra={(b) => {
          const d = daysAgo(b.last_contact_at);
          return d !== null ? `Last contact: ${d} days ago` : null;
        }}
      />

      {/* QUEUE 5: post-event no-show recovery */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold uppercase text-neutral-500">
            Post-event no-show recovery
          </h2>
          <CountBadge n={noShowRecovery.length} accent="amber" />
        </div>

        {noShowRecovery.length === 0 ? (
          <div className="border rounded-lg p-4 text-sm text-neutral-500 text-center">
            No outstanding no-shows.
          </div>
        ) : (
          <div className="border rounded-lg divide-y">
            {noShowRecovery.map((b) => {
              const a = unwrapAttendee(b.attendee);
              const ev = unwrapEvent(b.event);
              if (!a || !ev) return null;
              const sinceDays = ev.end_time ? daysAgo(ev.end_time) : null;
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
                    {sinceDays !== null && (
                      <p className="text-neutral-400">{sinceDays} days ago</p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* QUEUE 4: calendar invites to update */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold uppercase text-neutral-500">
            Calendar invites to update
          </h2>
          <CountBadge n={invitesToUpdateBase.length} accent="amber" />
        </div>

        {invitesToUpdateBase.length === 0 ? (
          <div className="border rounded-lg p-4 text-sm text-neutral-500 text-center">
            All caught up.
          </div>
        ) : (
          <div className="border rounded-lg divide-y">
            {invitesToUpdateBase.map((b) => {
              const a = unwrapAttendee(b.attendee);
              const ev = unwrapEvent(b.event);
              if (!a || !ev) return null;
              const fromLabel = b.rescheduled_from_booking_id
                ? fromLabelByOriginalId.get(b.rescheduled_from_booking_id)
                : null;
              return (
                <div
                  key={b.id}
                  className="flex items-center justify-between gap-4 p-3"
                >
                  <Link
                    href={`/admin/bookings/${b.id}`}
                    className="flex-1 min-w-0 hover:bg-neutral-50 -m-3 p-3 rounded transition"
                  >
                    <p className="font-medium text-sm">
                      {a.first_name} {a.last_name}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {ev.start_time ? formatEventDate(ev.start_time) : '—'}
                      {ev.session_label ? ` · ${ev.session_label}` : ''}
                    </p>
                    {fromLabel && (
                      <p className="text-xs text-neutral-500 italic mt-0.5">
                        ↺ Rescheduled from {fromLabel}
                      </p>
                    )}
                  </Link>
                  <MarkInviteUpdatedButton bookingId={b.id} />
                </div>
              );
            })}
          </div>
        )}
      </div>

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
type Accent = 'red' | 'amber' | 'blue' | 'neutral';

function QueueSection({
  title,
  rows,
  tail,
  accent,
  renderExtra,
}: {
  title: string;
  rows: BookingRow[];
  tail: string;
  accent: Accent;
  renderExtra?: (b: BookingRow) => string | null;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold uppercase text-neutral-500">{title}</h2>
        <CountBadge n={rows.length} accent={accent} />
      </div>

      {rows.length === 0 ? (
        <div className="border rounded-lg p-4 text-sm text-neutral-500 text-center">
          All caught up.
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {rows.map((b) => {
            const a = unwrapAttendee(b.attendee);
            const ev = unwrapEvent(b.event);
            if (!a || !ev) return null;
            const extra = renderExtra ? renderExtra(b) : null;
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
                  {extra && (
                    <p className="text-xs text-neutral-500 mt-0.5">{extra}</p>
                  )}
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
      )}
    </div>
  );
}

function CountBadge({ n, accent }: { n: number; accent: Accent }) {
  const cls =
    accent === 'red'
      ? 'bg-red-100 text-red-800'
      : accent === 'amber'
      ? 'bg-amber-100 text-amber-800'
      : accent === 'blue'
      ? 'bg-blue-100 text-blue-800'
      : 'bg-neutral-200 text-neutral-700';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      {n}
    </span>
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
