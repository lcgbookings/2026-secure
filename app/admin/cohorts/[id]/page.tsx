import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatEventDateTime } from '@/lib/format';
import AttendeeFilters from './attendee-filters';
import CalendarInvite from './calendar-invite';

export const dynamic = 'force-dynamic';

export default async function CohortDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; confirmation?: string; attendance?: string }>;
}) {
  const { id: eventId } = await params;
  const { q, confirmation, attendance } = await searchParams;

  const supabase = createAdminClient();

  const { data: event } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .maybeSingle();

  if (!event) notFound();

  let query = supabase
    .from('bookings')
    .select(
      `
      id,
      external_booking_id,
      booking_status,
      confirmation_status,
      attendance_status,
      coaching_interest,
      masterclass_outcome,
      session_value_rating,
      goals,
      venue_override,
      pre_event_notes,
      created_at,
      attendee:attendees!inner (
        id,
        first_name,
        last_name,
        email,
        phone
      )
    `
    )
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });

  if (confirmation && confirmation !== 'all') {
    query = query.eq('confirmation_status', confirmation);
  }
  if (attendance && attendance !== 'all') {
    query = query.eq('attendance_status', attendance);
  }

  const { data: bookings } = await query;

  const { count: radioClicks } = await supabase
    .from('pending_event_selections')
    .select('id', { count: 'exact', head: true })
    .eq('matched_event_id', event.id);

  const { count: paidBookings } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', event.id);

  const clicks = radioClicks ?? 0;
  const bookingsCount = paidBookings ?? 0;
  const abandoned = clicks > bookingsCount ? clicks - bookingsCount : 0;

  type BookingRow = NonNullable<typeof bookings>[number];
  const search = (q ?? '').trim().toLowerCase();
  const filtered = (bookings ?? []).filter((b: BookingRow) => {
    if (!search) return true;
    const a = Array.isArray(b.attendee) ? b.attendee[0] : b.attendee;
    if (!a) return false;
    return (
      a.email.toLowerCase().includes(search) ||
      `${a.first_name} ${a.last_name}`.toLowerCase().includes(search) ||
      (a.phone ?? '').toLowerCase().includes(search)
    );
  });

  const totalBooked = (bookings ?? []).length;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <header className="mb-6">
        <Link
          href="/admin/cohorts"
          className="text-sm text-lcg-body-muted hover:text-lcg-deep-teal mb-2 inline-block"
        >
          ← Back to cohorts
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4 mt-2">
          <div className="min-w-0">
            <span className="lcg-eyebrow mb-2 block">{event.status}</span>
            <h1 className="font-serif text-3xl text-lcg-deep-teal">
              {event.session_label}
            </h1>
            <p className="text-sm text-lcg-body-muted mt-1">
              {event.venue ?? 'Venue TBC'}
              {event.start_time && event.end_time
                ? ` · ${formatEventDateTime(event.start_time, event.end_time)}`
                : ''}
              {event.capacity ? ` · capacity ${event.capacity}` : ''}
            </p>
          </div>
          <Link
            href={`/admin/analytics?eventId=${event.id}`}
            className="lcg-btn-secondary"
          >
            View analytics for this cohort →
          </Link>
        </div>
      </header>

      {event.status === 'draft' && (
        <div className="lcg-card-dark p-5 mb-6">
          <div className="lcg-eyebrow text-lcg-blue mb-1">This event is in draft</div>
          <p className="text-lcg-cream/80 text-sm mb-3">
            Promote to scheduled once you&apos;ve confirmed the date and venue.
          </p>
          <form action={`/api/admin/events/${event.id}/promote`} method="post">
            <button type="submit" className="lcg-btn-primary">
              Promote to scheduled →
            </button>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatTile label="Radio clicks" value={clicks} />
        <StatTile label="Paid bookings" value={bookingsCount} />
        <StatTile label="Clicked but didn't pay" value={abandoned} />
      </div>

      <CalendarInvite eventId={event.id} initialUrl={event.calendar_url ?? null} />

      <AttendeeFilters
        currentQuery={q ?? ''}
        currentConfirmation={confirmation ?? 'all'}
        currentAttendance={attendance ?? 'all'}
      />

      <section className="lcg-card p-6">
        <h2 className="font-serif text-xl text-lcg-deep-teal mb-4">
          Bookings ({totalBooked})
        </h2>

        {filtered.length === 0 ? (
          <p className="text-sm text-lcg-body-muted italic">
            {totalBooked === 0
              ? 'No bookings for this event yet.'
              : 'No bookings match your filters.'}
          </p>
        ) : (
          <div className="space-y-2">
            {filtered.map((b: BookingRow) => {
              const a = Array.isArray(b.attendee) ? b.attendee[0] : b.attendee;
              if (!a) return null;
              return (
                <Link
                  key={b.id}
                  href={`/admin/bookings/${b.id}`}
                  className="block p-4 rounded-lg border border-lcg-deep-teal/10 hover:border-lcg-teal hover:bg-lcg-cream/30 transition"
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-lcg-deep-teal">
                          {a.first_name} {a.last_name}
                        </span>

                        {b.coaching_interest === 'speak_before_leaving' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-lcg-blue text-lcg-deep-teal">
                            Hot
                          </span>
                        )}
                        {b.coaching_interest === 'apply_via_website' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-amber-500/80 text-lcg-deep-teal">
                            Warm
                          </span>
                        )}
                        {b.coaching_interest === 'not_at_this_time' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-lcg-deep-teal/10 text-lcg-deep-teal/60">
                            Parked
                          </span>
                        )}

                        {b.masterclass_outcome === 'signed_up' && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-green-100 text-green-800">
                            ✓ Signed up
                          </span>
                        )}
                        {b.masterclass_outcome === 'in_conversation' && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-lcg-blue/15 text-lcg-deep-teal">
                            In conversation
                          </span>
                        )}
                        {b.masterclass_outcome === 'declined' && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-red-50 text-red-700">
                            Declined
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-lcg-body-muted mt-1 truncate">
                        {a.email}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      {b.session_value_rating !== null && (
                        <div className="text-sm text-lcg-deep-teal font-medium">
                          {b.session_value_rating}/10
                        </div>
                      )}
                      <div className="text-xs text-lcg-body-muted">
                        {b.attendance_status === 'attended'
                          ? 'Attended'
                          : b.attendance_status === 'no_show'
                            ? 'No-show'
                            : 'Pending'}
                      </div>
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

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="lcg-card p-5">
      <div className="lcg-eyebrow mb-3 text-lcg-deep-teal/60">{label}</div>
      <div className="font-serif text-3xl text-lcg-deep-teal">{value}</div>
    </div>
  );
}

