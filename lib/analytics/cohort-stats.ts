import { createAdminClient } from '@/lib/supabase/admin';

export type CohortStats = {
  eventId: string;
  booked: number;
  confirmed: number;
  confirmedRate: number | null;
  attended: number;
  showUpRate: number | null;
  hotCoaching: number;
  coachingRate: number | null;
  noShows: number;
  noShowRate: number | null;
  callsMade: number;
  callsAnswered: number;
  whatsappVideoSent: number;
  pricingDisclosed: number;
  pricingResponseDistribution: {
    open_to_invest: number;
    not_in_position: number;
    undecided: number;
    not_asked: number;
  };
};

type BookingRow = {
  id: string;
  event_id: string | null;
  confirmation_status: string | null;
  attendance_status: string | null;
  coaching_interest: string | null;
  pricing_disclosed: boolean | null;
  pricing_response: string | null;
};

type CallAttemptRow = {
  booking_id: string | null;
  outcome: string | null;
  whatsapp_video_sent: boolean | null;
};

function ratePct(num: number, den: number): number | null {
  if (den === 0) return null;
  return Math.round((num / den) * 100);
}

function emptyStats(eventId: string): CohortStats {
  return {
    eventId,
    booked: 0,
    confirmed: 0,
    confirmedRate: null,
    attended: 0,
    showUpRate: null,
    hotCoaching: 0,
    coachingRate: null,
    noShows: 0,
    noShowRate: null,
    callsMade: 0,
    callsAnswered: 0,
    whatsappVideoSent: 0,
    pricingDisclosed: 0,
    pricingResponseDistribution: {
      open_to_invest: 0,
      not_in_position: 0,
      undecided: 0,
      not_asked: 0,
    },
  };
}

export function computeCohortStats(
  eventId: string,
  bookings: BookingRow[],
  calls: CallAttemptRow[]
): CohortStats {
  const stats = emptyStats(eventId);
  stats.booked = bookings.length;

  const bookingIds = new Set<string>();
  const bookingsWithWhatsapp = new Set<string>();

  for (const b of bookings) {
    bookingIds.add(b.id);
    if (b.confirmation_status === 'confirmed' || b.attendance_status === 'attended') {
      stats.confirmed += 1;
    }
    if (b.attendance_status === 'attended') stats.attended += 1;
    if (b.coaching_interest === 'speak_before_leaving') stats.hotCoaching += 1;
    if (b.attendance_status === 'no_show') stats.noShows += 1;
    if (b.pricing_disclosed) stats.pricingDisclosed += 1;
    if (b.pricing_response && b.pricing_response in stats.pricingResponseDistribution) {
      const key = b.pricing_response as keyof CohortStats['pricingResponseDistribution'];
      stats.pricingResponseDistribution[key] += 1;
    }
  }

  for (const c of calls) {
    if (!c.booking_id || !bookingIds.has(c.booking_id)) continue;
    stats.callsMade += 1;
    if (c.outcome && c.outcome.startsWith('answered_')) stats.callsAnswered += 1;
    if (c.whatsapp_video_sent) bookingsWithWhatsapp.add(c.booking_id);
  }
  stats.whatsappVideoSent = bookingsWithWhatsapp.size;

  stats.confirmedRate = ratePct(stats.confirmed, stats.booked);
  stats.showUpRate = ratePct(stats.attended, stats.confirmed);
  stats.coachingRate = ratePct(stats.hotCoaching, stats.attended);
  stats.noShowRate = ratePct(stats.noShows, stats.confirmed);

  return stats;
}

export async function getCohortStats(eventId: string): Promise<CohortStats> {
  const admin = createAdminClient();

  const { data: bookings } = await admin
    .from('bookings')
    .select(
      'id, event_id, confirmation_status, attendance_status, coaching_interest, pricing_disclosed, pricing_response'
    )
    .eq('event_id', eventId);

  const rows = (bookings ?? []) as BookingRow[];
  if (rows.length === 0) return emptyStats(eventId);

  const { data: calls } = await admin
    .from('call_attempts')
    .select('booking_id, outcome, whatsapp_video_sent')
    .in(
      'booking_id',
      rows.map((r) => r.id)
    );

  return computeCohortStats(eventId, rows, (calls ?? []) as CallAttemptRow[]);
}

export async function getCohortStatsBatch(
  eventIds: string[]
): Promise<Map<string, CohortStats>> {
  const result = new Map<string, CohortStats>();
  if (eventIds.length === 0) return result;

  for (const id of eventIds) result.set(id, emptyStats(id));

  const admin = createAdminClient();

  const { data: bookings } = await admin
    .from('bookings')
    .select(
      'id, event_id, confirmation_status, attendance_status, coaching_interest, pricing_disclosed, pricing_response'
    )
    .in('event_id', eventIds);

  const allBookings = (bookings ?? []) as BookingRow[];
  if (allBookings.length === 0) return result;

  const { data: calls } = await admin
    .from('call_attempts')
    .select('booking_id, outcome, whatsapp_video_sent')
    .in(
      'booking_id',
      allBookings.map((b) => b.id)
    );

  const allCalls = (calls ?? []) as CallAttemptRow[];

  const bookingsByEvent = new Map<string, BookingRow[]>();
  for (const b of allBookings) {
    if (!b.event_id) continue;
    const arr = bookingsByEvent.get(b.event_id) ?? [];
    arr.push(b);
    bookingsByEvent.set(b.event_id, arr);
  }

  const bookingToEvent = new Map<string, string>();
  for (const b of allBookings) {
    if (b.event_id) bookingToEvent.set(b.id, b.event_id);
  }
  const callsByEvent = new Map<string, CallAttemptRow[]>();
  for (const c of allCalls) {
    if (!c.booking_id) continue;
    const eventId = bookingToEvent.get(c.booking_id);
    if (!eventId) continue;
    const arr = callsByEvent.get(eventId) ?? [];
    arr.push(c);
    callsByEvent.set(eventId, arr);
  }

  for (const eventId of eventIds) {
    const eBookings = bookingsByEvent.get(eventId) ?? [];
    const eCalls = callsByEvent.get(eventId) ?? [];
    result.set(eventId, computeCohortStats(eventId, eBookings, eCalls));
  }

  return result;
}
