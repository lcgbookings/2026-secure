import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  formatEventDateTime,
  formatMoney,
  labelConfirmationStatus,
  labelAttendanceStatus,
  colourAttendanceStatus,
} from '@/lib/format';
import AttendeeFilters from './attendee-filters';
import CalendarInvite from './calendar-invite';

export const dynamic = 'force-dynamic';

type ConfirmationStatus = 'confirmed' | 'pending' | 'unreachable' | 'cancelled';

export default async function EventDetailPage({
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
      ticket_type,
      booking_status,
      confirmation_status,
      attendance_status,
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
      ),
      payments (amount_gross, currency, status)
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
          href="/admin/events"
          className="text-sm text-lcg-body-muted hover:text-lcg-deep-teal mb-2 inline-block"
        >
          ← Back to events
        </Link>
        <span className="lcg-eyebrow mb-2 mt-2 block">{event.status}</span>
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
          <ul className="divide-y divide-lcg-deep-teal/10">
            {filtered.map((b: BookingRow) => {
              const a = Array.isArray(b.attendee) ? b.attendee[0] : b.attendee;
              if (!a) return null;
              const pay = Array.isArray(b.payments) ? b.payments[0] : null;
              return (
                <li key={b.id} className="py-3 first:pt-0 last:pb-0">
                  <Link
                    href={`/admin/bookings/${b.id}`}
                    className="group flex justify-between items-center gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-lcg-deep-teal group-hover:text-lcg-teal transition">
                        {a.first_name} {a.last_name}
                      </div>
                      <div className="text-xs text-lcg-body-muted truncate">
                        {a.email}
                        {a.phone ? ` · ${a.phone}` : ''}
                      </div>
                      {pay && (
                        <div className="text-xs text-lcg-body-muted mt-0.5">
                          {b.ticket_type ?? 'Ticket'} ·{' '}
                          {formatMoney(pay.amount_gross, pay.currency)}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      <ConfirmationBadge
                        status={b.confirmation_status as ConfirmationStatus}
                      />
                      {b.attendance_status && b.attendance_status !== 'pending' && (
                        <div>
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colourAttendanceStatus(
                              b.attendance_status
                            )}`}
                          >
                            {labelAttendanceStatus(b.attendance_status)}
                          </span>
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

function ConfirmationBadge({ status }: { status: ConfirmationStatus }) {
  const colours: Record<ConfirmationStatus, string> = {
    confirmed: 'bg-green-100 text-green-800',
    pending: 'bg-amber-100 text-amber-800',
    unreachable: 'bg-neutral-100 text-neutral-700',
    cancelled: 'bg-red-100 text-red-700',
  };
  return (
    <span
      className={`inline-block ${
        colours[status] ?? 'bg-neutral-100 text-neutral-700'
      } text-xs font-medium px-2 py-0.5 rounded uppercase tracking-wide`}
    >
      {labelConfirmationStatus(status)}
    </span>
  );
}
