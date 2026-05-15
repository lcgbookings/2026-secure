import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatEventDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const supabase = createAdminClient();

  // Get upcoming events with booking counts
  const { data: events } = await supabase
    .from('events')
    .select('id, session_label, start_time, end_time, venue, capacity, status')
    .gte('end_time', new Date().toISOString())
    .order('start_time', { ascending: true });

  // Get booking counts per event
  const eventIds = (events ?? []).map((e) => e.id);
  const { data: bookings } = await supabase
    .from('bookings')
    .select('event_id, confirmation_status')
    .in('event_id', eventIds.length ? eventIds : ['00000000-0000-0000-0000-000000000000']);

  // Get total pending calls across all upcoming events
  const totalPending = (bookings ?? []).filter(
    (b) => b.confirmation_status === 'pending'
  ).length;
  const totalConfirmed = (bookings ?? []).filter(
    (b) => b.confirmation_status === 'confirmed'
  ).length;
  const totalBookings = (bookings ?? []).length;

  // Aggregate by event
  const statsByEvent = new Map<string, { booked: number; confirmed: number; pending: number }>();
  for (const b of bookings ?? []) {
    if (!b.event_id) continue;
    const s = statsByEvent.get(b.event_id) ?? { booked: 0, confirmed: 0, pending: 0 };
    s.booked += 1;
    if (b.confirmation_status === 'confirmed') s.confirmed += 1;
    if (b.confirmation_status === 'pending') s.pending += 1;
    statsByEvent.set(b.event_id, s);
  }

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
