import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatEventDateTime, formatEventDate } from '@/lib/format';
import { fireNoShowRecoveryWebhook } from '@/lib/webhooks/outbound/no-show-recovery';
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
  flagged_repeat_no_show?: boolean | null;
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

  // Process any no-show bookings that haven't had their webhook fired yet.
  // This is idempotent: bookings with no_show_recovery_webhook_fired_at set are filtered out.
  try {
    const { data: pendingWebhookBookings } = await supabase
      .from('bookings')
      .select('id')
      .eq('attendance_status', 'no_show')
      .is('no_show_recovery_webhook_fired_at', null);

    if (pendingWebhookBookings && pendingWebhookBookings.length > 0) {
      for (const booking of pendingWebhookBookings) {
        try {
          await fireNoShowRecoveryWebhook(booking.id);
        } catch (err) {
          console.error('[dashboard pending-webhook] failed for', booking.id, err);
        }
      }
    }
  } catch (err) {
    console.error('[dashboard pending-webhook] outer error', err);
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
  const { data: newToCallRaw } = await supabase
    .from('bookings')
    .select(
      `id, created_at, last_contact_at, flagged_repeat_no_show,
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
      if (b.last_contact_at) {
        const contactTs = new Date(b.last_contact_at).getTime();
        if (contactTs > endTs) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aT = new Date(unwrapEvent(a.event)?.end_time ?? 0).getTime();
      const bT = new Date(unwrapEvent(b.event)?.end_time ?? 0).getTime();
      return bT - aT;
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
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
      <header className="mb-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="lcg-eyebrow mb-2">Events Hub</span>
            <h1 className="font-serif text-3xl text-lcg-deep-teal">Dashboard</h1>
            <p className="text-sm text-lcg-body-muted mt-1">Upcoming events and bookings</p>
          </div>
          <a
            href="/api/admin/export/cohorts"
            download
            className="lcg-btn-primary"
          >
            <span>↓</span>
            <span className="ml-2">Export to Excel</span>
          </a>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatTile label="Upcoming bookings" value={totalBookings} tint="cream" />
        <StatTile label="Confirmed" value={totalConfirmed} tint="cream" />
        <StatTile label="Pending calls" value={totalPending} tint="cream" />
      </div>

      {draftCount && draftCount > 0 ? (
        <div className="lcg-card-dark p-4 border border-lcg-blue/30">
          <div className="flex items-center gap-3">
            <span className="lcg-eyebrow text-lcg-blue">Drafts needing review</span>
            <span className="text-sm text-lcg-cream">
              {draftCount} new from radio clicks
            </span>
            <Link
              href="/admin/events?status=draft"
              className="ml-auto text-sm font-medium text-lcg-blue hover:underline"
            >
              Review →
            </Link>
          </div>
        </div>
      ) : null}

      <QueueSection
        title="24-hour reminders"
        accent="red"
        rows={twentyFourHourReminders}
      />

      <QueueSection
        title="New bookings to call"
        accent="neutral"
        rows={newToCall}
        showRepeatBadge
      />

      <QueueSection
        title="10-day stale follow-ups"
        accent="blue"
        rows={staleFollowups}
        renderExtra={(b) => {
          const d = daysAgo(b.last_contact_at);
          return d !== null ? `Last contact: ${d} days ago` : null;
        }}
      />

      <section className="lcg-card p-6">
        <header className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="font-serif text-lg text-lcg-deep-teal">
              Post-event no-show recovery
            </h2>
            <CountBadge n={noShowRecovery.length} accent="amber" />
          </div>
        </header>

        {noShowRecovery.length === 0 ? (
          <p className="text-sm text-lcg-body-muted italic">No outstanding no-shows.</p>
        ) : (
          <ul className="divide-y divide-lcg-deep-teal/10">
            {noShowRecovery.map((b) => {
              const a = unwrapAttendee(b.attendee);
              const ev = unwrapEvent(b.event);
              if (!a || !ev) return null;
              const sinceDays = ev.end_time ? daysAgo(ev.end_time) : null;
              return (
                <li key={b.id} className="py-3 first:pt-0 last:pb-0">
                  <Link
                    href={`/admin/bookings/${b.id}`}
                    className="group flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-lcg-deep-teal group-hover:text-lcg-teal transition">
                        {a.first_name} {a.last_name}
                      </div>
                      <div className="text-xs text-lcg-body-muted truncate mt-0.5">
                        {a.email ?? 'no email'} · {a.phone ?? 'no phone'}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-medium text-lcg-deep-teal">
                        {ev.start_time ? formatEventDate(ev.start_time) : '—'}
                      </div>
                      {sinceDays !== null && (
                        <div className="text-xs text-lcg-body-muted mt-0.5">
                          {sinceDays} days ago
                        </div>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="lcg-card p-6">
        <header className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="font-serif text-lg text-lcg-deep-teal">
              Calendar invites to update
            </h2>
            <CountBadge n={invitesToUpdateBase.length} accent="amber" />
          </div>
        </header>

        {invitesToUpdateBase.length === 0 ? (
          <p className="text-sm text-lcg-body-muted italic">All caught up.</p>
        ) : (
          <ul className="divide-y divide-lcg-deep-teal/10">
            {invitesToUpdateBase.map((b) => {
              const a = unwrapAttendee(b.attendee);
              const ev = unwrapEvent(b.event);
              if (!a || !ev) return null;
              const fromLabel = b.rescheduled_from_booking_id
                ? fromLabelByOriginalId.get(b.rescheduled_from_booking_id)
                : null;
              return (
                <li key={b.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-4">
                  <Link
                    href={`/admin/bookings/${b.id}`}
                    className="group flex-1 min-w-0"
                  >
                    <div className="font-medium text-lcg-deep-teal group-hover:text-lcg-teal transition">
                      {a.first_name} {a.last_name}
                    </div>
                    <div className="text-xs text-lcg-body-muted mt-0.5">
                      {ev.start_time ? formatEventDate(ev.start_time) : '—'}
                      {ev.session_label ? ` · ${ev.session_label}` : ''}
                    </div>
                    {fromLabel && (
                      <div className="text-xs text-lcg-body-muted italic mt-0.5">
                        ↺ Rescheduled from {fromLabel}
                      </div>
                    )}
                  </Link>
                  <MarkInviteUpdatedButton bookingId={b.id} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {(autoCreatedNeedingReview?.length ?? 0) > 0 && (
        <section className="lcg-card p-6">
          <header className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2 className="font-serif text-lg text-lcg-deep-teal">
                Auto-created events needing review
              </h2>
              <CountBadge n={autoCreatedNeedingReview?.length ?? 0} accent="neutral" />
            </div>
          </header>
          <ul className="divide-y divide-lcg-deep-teal/10">
            {(autoCreatedNeedingReview ?? []).map((ev) => (
              <li key={ev.id} className="py-3 first:pt-0 last:pb-0">
                <Link
                  href={`/admin/events/${ev.id}`}
                  className="group flex items-center justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-lcg-deep-teal group-hover:text-lcg-teal transition">
                      {ev.session_label}
                    </div>
                    <div className="text-xs text-lcg-body-muted mt-0.5">
                      {formatEventDate(ev.start_time)}
                    </div>
                  </div>
                  <span className="text-xs font-medium text-lcg-teal opacity-0 group-hover:opacity-100 transition shrink-0">
                    Set up →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="lcg-card p-6">
        <h2 className="font-serif text-lg text-lcg-deep-teal mb-4">Upcoming events</h2>

        {(events?.length ?? 0) === 0 ? (
          <p className="text-sm text-lcg-body-muted italic">No upcoming events scheduled.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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
                  className="block border border-lcg-deep-teal/10 rounded-xl p-4 hover:border-lcg-teal/40 transition"
                >
                  <div className="font-medium text-lcg-deep-teal text-sm">
                    {formatEventDateTime(event.start_time, event.end_time)}
                  </div>
                  <div className="text-xs text-lcg-body-muted mt-1">
                    {event.venue ?? 'Venue TBC'}
                    {event.capacity ? ` · capacity ${event.capacity}` : ''}
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <div>
                      <div className="text-xs text-lcg-body-muted">Booked</div>
                      <div className="font-serif text-lg text-lcg-deep-teal">{stats.booked}</div>
                    </div>
                    <div>
                      <div className="text-xs text-lcg-body-muted">Confirmed</div>
                      <div className="font-serif text-lg text-lcg-deep-teal">{stats.confirmed}</div>
                    </div>
                    <div>
                      <div className="text-xs text-lcg-body-muted">Pending</div>
                      <div className="font-serif text-lg text-lcg-deep-teal">{stats.pending}</div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- shared queue section ----------
type Accent = 'red' | 'amber' | 'blue' | 'neutral';

function QueueSection({
  title,
  rows,
  accent,
  renderExtra,
  showRepeatBadge,
}: {
  title: string;
  rows: BookingRow[];
  accent: Accent;
  renderExtra?: (b: BookingRow) => string | null;
  showRepeatBadge?: boolean;
}) {
  return (
    <section className="lcg-card p-6">
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="font-serif text-lg text-lcg-deep-teal">{title}</h2>
          <CountBadge n={rows.length} accent={accent} />
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-lcg-body-muted italic">All caught up.</p>
      ) : (
        <ul className="divide-y divide-lcg-deep-teal/10">
          {rows.map((b) => {
            const a = unwrapAttendee(b.attendee);
            const ev = unwrapEvent(b.event);
            if (!a || !ev) return null;
            const extra = renderExtra ? renderExtra(b) : null;
            return (
              <li key={b.id} className="py-3 first:pt-0 last:pb-0">
                <Link
                  href={`/admin/bookings/${b.id}`}
                  className="group flex items-center justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-lcg-deep-teal group-hover:text-lcg-teal transition">
                      {a.first_name} {a.last_name}
                      {showRepeatBadge && b.flagged_repeat_no_show && (
                        <span className="ml-2 inline-block px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-800 rounded uppercase tracking-wide">
                          Repeat no-show
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-lcg-body-muted truncate mt-0.5">
                      {a.email ?? 'no email'} · {a.phone ?? 'no phone'}
                    </div>
                    {extra && (
                      <div className="text-xs text-lcg-body-muted mt-0.5">{extra}</div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-medium text-lcg-deep-teal">
                      {ev.start_time ? formatEventDate(ev.start_time) : '—'}
                    </div>
                    <div className="text-xs text-lcg-body-muted mt-0.5 truncate max-w-[180px]">
                      {ev.session_label ?? ''}
                    </div>
                  </div>
                  <span className="text-xs font-medium text-lcg-teal opacity-0 group-hover:opacity-100 transition shrink-0">
                    Tap to call →
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CountBadge({ n, accent }: { n: number; accent: Accent }) {
  if (n === 0) {
    return (
      <span className="inline-flex items-center justify-center rounded-full bg-lcg-deep-teal/5 text-lcg-deep-teal/40 text-xs font-semibold px-2 py-0.5 min-w-[2rem]">
        0
      </span>
    );
  }
  const styles: Record<Accent, string> = {
    red: 'bg-red-50 text-red-700',
    amber: 'bg-amber-50 text-amber-700',
    blue: 'bg-lcg-blue-tint text-lcg-blue',
    neutral: 'bg-lcg-deep-teal/10 text-lcg-deep-teal',
  };
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full ${styles[accent]} text-xs font-semibold px-2 py-0.5 min-w-[2rem]`}
    >
      {n}
    </span>
  );
}

function StatTile({
  label,
  value,
  tint,
}: {
  label: string;
  value: number | string;
  tint: 'cream' | 'teal';
}) {
  if (tint === 'teal') {
    return (
      <div className="lcg-card-dark p-5">
        <div className="lcg-eyebrow mb-3">{label}</div>
        <div className="font-serif text-3xl text-lcg-cream">{value}</div>
      </div>
    );
  }
  return (
    <div className="lcg-card p-5">
      <div className="lcg-eyebrow mb-3 text-lcg-deep-teal/60">{label}</div>
      <div className="font-serif text-3xl text-lcg-deep-teal">{value}</div>
    </div>
  );
}
