import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  formatEventDateTime,
  formatMoney,
  labelConfirmationStatus,
  labelAttendanceStatus,
  colourConfirmationStatus,
  colourAttendanceStatus,
} from '@/lib/format';
import AttendeeFilters from './attendee-filters';
import CalendarInvite from './calendar-invite';

export const dynamic = 'force-dynamic';

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

  // Load all bookings + attendee data for this event
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

  // Funnel snapshot
  const { count: radioClicks } = await supabase
    .from('pending_event_selections')
    .select('id', { count: 'exact', head: true })
    .eq('matched_event_id', event.id);

  const { count: paidBookings } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', event.id);

  const dropOff =
    radioClicks && radioClicks > 0
      ? Math.round(((radioClicks - (paidBookings ?? 0)) / radioClicks) * 100)
      : null;

  // Filter by search term locally (Postgres ILIKE across joined tables is messier than client-side filter on small lists)
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

  // Stats
  const totalBooked = (bookings ?? []).length;
  const confirmedCount = (bookings ?? []).filter(
    (b: BookingRow) => b.confirmation_status === 'confirmed'
  ).length;
  const pendingCount = (bookings ?? []).filter(
    (b: BookingRow) => b.confirmation_status === 'pending'
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin"
          className="text-sm text-neutral-500 hover:text-neutral-900"
        >
          ← Back to dashboard
        </Link>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold">
            {formatEventDateTime(event.start_time, event.end_time)}
          </h1>
          {event.auto_created && (
            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-neutral-200 text-neutral-700">
              Auto-created
            </span>
          )}
        </div>
        <p className="text-sm text-neutral-600 mt-1">
          {event.venue ?? 'Venue TBC'}
          {event.capacity ? ` · capacity ${event.capacity}` : ''} ·{' '}
          {event.event_type}
        </p>
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase text-neutral-500 mb-3">
          Funnel snapshot
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatBox label="Radio clicks" value={radioClicks ?? 0} />
          <StatBox label="Paid bookings" value={paidBookings ?? 0} />
          <StatBox label="Drop-off" value={dropOff === null ? '—' : `${dropOff}%`} />
        </div>
      </div>

      <CalendarInvite eventId={event.id} initialUrl={event.calendar_url ?? null} />

      <div className="grid grid-cols-3 gap-4">
        <StatBox label="Booked" value={totalBooked} />
        <StatBox label="Confirmed" value={confirmedCount} accent="green" />
        <StatBox label="Pending calls" value={pendingCount} accent="amber" />
      </div>

      <AttendeeFilters
        currentQuery={q ?? ''}
        currentConfirmation={confirmation ?? 'all'}
        currentAttendance={attendance ?? 'all'}
      />

      <div className="border rounded-lg overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-neutral-500">
            {totalBooked === 0
              ? 'No bookings for this event yet.'
              : 'No bookings match your filters.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 border-b">
              <tr>
                <th className="text-left p-3 font-medium">Name</th>
                <th className="text-left p-3 font-medium">Email</th>
                <th className="text-left p-3 font-medium">Phone</th>
                <th className="text-left p-3 font-medium">Ticket</th>
                <th className="text-left p-3 font-medium">Confirmation</th>
                <th className="text-left p-3 font-medium">Attendance</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b: BookingRow) => {
                const a = Array.isArray(b.attendee) ? b.attendee[0] : b.attendee;
                if (!a) return null;
                const pay = Array.isArray(b.payments) ? b.payments[0] : null;
                return (
                  <tr
                    key={b.id}
                    className="border-b last:border-b-0 hover:bg-neutral-50 cursor-pointer"
                  >
                    <td className="p-3">
                      <Link
                        href={`/admin/bookings/${b.id}`}
                        className="font-medium hover:underline"
                      >
                        {a.first_name} {a.last_name}
                      </Link>
                    </td>
                    <td className="p-3 text-neutral-600">{a.email}</td>
                    <td className="p-3 text-neutral-600">{a.phone ?? '-'}</td>
                    <td className="p-3 text-neutral-600">
                      {b.ticket_type ?? '-'}
                      {pay ? ` · ${formatMoney(pay.amount_gross, pay.currency)}` : ''}
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colourConfirmationStatus(
                          b.confirmation_status
                        )}`}
                      >
                        {labelConfirmationStatus(b.confirmation_status)}
                      </span>
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colourAttendanceStatus(
                          b.attendance_status
                        )}`}
                      >
                        {labelAttendanceStatus(b.attendance_status)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatBox({
  label,
  value,
  accent = 'neutral',
}: {
  label: string;
  value: number | string;
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
