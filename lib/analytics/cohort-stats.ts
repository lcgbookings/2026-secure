import { createAdminClient } from '@/lib/supabase/admin';
import {
  labelReferralSource,
  labelExperienceLevel,
  labelResponsibilityLevel,
  labelRelevance,
  labelCoachingInterest,
} from '@/lib/format';

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
  // Conversion (post-event)
  hotLeads: number;
  signedUp: number;
  inConversation: number;
  conversionRate: number | null;
};

type BookingRow = {
  id: string;
  event_id: string | null;
  confirmation_status: string | null;
  attendance_status: string | null;
  coaching_interest: string | null;
  pricing_disclosed: boolean | null;
  pricing_response: string | null;
  masterclass_outcome: string | null;
};

const COHORT_BOOKING_COLUMNS =
  'id, event_id, confirmation_status, attendance_status, coaching_interest, pricing_disclosed, pricing_response, masterclass_outcome';

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
    hotLeads: 0,
    signedUp: 0,
    inConversation: 0,
    conversionRate: null,
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
    if (
      b.attendance_status === 'attended' &&
      b.coaching_interest === 'speak_before_leaving'
    ) {
      stats.hotLeads += 1;
    }
    if (b.masterclass_outcome === 'signed_up') stats.signedUp += 1;
    if (b.masterclass_outcome === 'in_conversation') stats.inConversation += 1;
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
  stats.conversionRate = ratePct(stats.signedUp, stats.hotLeads);

  return stats;
}

export async function getCohortStats(eventId: string): Promise<CohortStats> {
  const admin = createAdminClient();

  const { data: bookings } = await admin
    .from('bookings')
    .select(COHORT_BOOKING_COLUMNS)
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
    .select(COHORT_BOOKING_COLUMNS)
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

// ============================================================
// Channel funnel
// ============================================================

export type ChannelFunnel = {
  channel: string;
  booked: number;
  confirmed: number;
  attended: number;
  hotLeads: number;
  signedUp: number;
  confirmRate: number | null;
  showUpRate: number | null;
  signUpRate: number | null;
};

type ChannelBookingRow = {
  referral_source: string | null;
  confirmation_status: string | null;
  attendance_status: string | null;
  coaching_interest: string | null;
  masterclass_outcome: string | null;
};

export async function getChannelFunnels(opts?: {
  eventId?: string;
}): Promise<ChannelFunnel[]> {
  const admin = createAdminClient();

  let query = admin
    .from('bookings')
    .select(
      'referral_source, confirmation_status, attendance_status, coaching_interest, masterclass_outcome'
    );
  if (opts?.eventId) query = query.eq('event_id', opts.eventId);

  const { data } = await query;
  const rows = (data ?? []) as ChannelBookingRow[];

  type Bucket = {
    booked: number;
    confirmed: number;
    attended: number;
    hotLeads: number;
    signedUp: number;
  };
  const buckets = new Map<string, Bucket>();

  for (const r of rows) {
    const key = r.referral_source && r.referral_source.length > 0
      ? r.referral_source
      : 'unknown';
    const bucket =
      buckets.get(key) ?? {
        booked: 0,
        confirmed: 0,
        attended: 0,
        hotLeads: 0,
        signedUp: 0,
      };
    bucket.booked += 1;
    if (r.confirmation_status === 'confirmed' || r.attendance_status === 'attended') {
      bucket.confirmed += 1;
    }
    if (r.attendance_status === 'attended') bucket.attended += 1;
    if (
      r.attendance_status === 'attended' &&
      r.coaching_interest === 'speak_before_leaving'
    ) {
      bucket.hotLeads += 1;
    }
    if (r.masterclass_outcome === 'signed_up') bucket.signedUp += 1;
    buckets.set(key, bucket);
  }

  const funnels: ChannelFunnel[] = [];
  for (const [key, b] of buckets.entries()) {
    const channel = key === 'unknown' ? 'Unknown' : labelReferralSource(key);
    funnels.push({
      channel,
      booked: b.booked,
      confirmed: b.confirmed,
      attended: b.attended,
      hotLeads: b.hotLeads,
      signedUp: b.signedUp,
      confirmRate: ratePct(b.confirmed, b.booked),
      showUpRate: ratePct(b.attended, b.confirmed),
      signUpRate: ratePct(b.signedUp, b.attended),
    });
  }

  funnels.sort((a, b) => b.booked - a.booked);
  return funnels;
}

// ============================================================
// Survey insights
// ============================================================

export type SurveyInsights = {
  experienceLevelDistribution: Record<string, number>;
  responsibilityLevelDistribution: Record<string, number>;
  avgSessionValueRating: number | null;
  relevanceDistribution: Record<string, number>;
  coachingInterestDistribution: Record<string, number>;
  reflectionCount: number;
  goalsProvidedCount: number;
  mostUsefulInsightCount: number;
  hardestUnderPressureCount: number;
};

type SurveyBookingRow = {
  experience_level: string | null;
  responsibility_level: string | null;
  session_value_rating: number | null;
  session_relevance: string | null;
  coaching_interest: string | null;
  goals: string | null;
  most_useful_insight: string | null;
  hardest_under_pressure: string | null;
  post_session_submitted_at: string | null;
};

function bump(dist: Record<string, number>, key: string) {
  dist[key] = (dist[key] ?? 0) + 1;
}

function hasText(v: string | null | undefined): boolean {
  return !!v && v.trim().length > 0;
}

export async function getSurveyInsights(opts?: {
  eventId?: string;
}): Promise<SurveyInsights> {
  const admin = createAdminClient();

  let query = admin
    .from('bookings')
    .select(
      'experience_level, responsibility_level, session_value_rating, session_relevance, coaching_interest, goals, most_useful_insight, hardest_under_pressure, post_session_submitted_at'
    );
  if (opts?.eventId) query = query.eq('event_id', opts.eventId);

  const { data } = await query;
  const rows = (data ?? []) as SurveyBookingRow[];

  const experienceLevelDistribution: Record<string, number> = {};
  const responsibilityLevelDistribution: Record<string, number> = {};
  const relevanceDistribution: Record<string, number> = {};
  const coachingInterestDistribution: Record<string, number> = {};

  let ratingSum = 0;
  let ratingCount = 0;
  let reflectionCount = 0;
  let goalsProvidedCount = 0;
  let mostUsefulInsightCount = 0;
  let hardestUnderPressureCount = 0;

  for (const r of rows) {
    if (r.experience_level) {
      bump(experienceLevelDistribution, labelExperienceLevel(r.experience_level));
    }
    if (r.responsibility_level) {
      bump(
        responsibilityLevelDistribution,
        labelResponsibilityLevel(r.responsibility_level)
      );
    }
    if (r.session_relevance) {
      bump(relevanceDistribution, labelRelevance(r.session_relevance));
    }
    if (r.coaching_interest) {
      bump(coachingInterestDistribution, labelCoachingInterest(r.coaching_interest));
    }
    if (typeof r.session_value_rating === 'number') {
      ratingSum += r.session_value_rating;
      ratingCount += 1;
    }
    if (r.post_session_submitted_at) reflectionCount += 1;
    if (hasText(r.goals)) goalsProvidedCount += 1;
    if (hasText(r.most_useful_insight)) mostUsefulInsightCount += 1;
    if (hasText(r.hardest_under_pressure)) hardestUnderPressureCount += 1;
  }

  return {
    experienceLevelDistribution,
    responsibilityLevelDistribution,
    avgSessionValueRating: ratingCount === 0 ? null : ratingSum / ratingCount,
    relevanceDistribution,
    coachingInterestDistribution,
    reflectionCount,
    goalsProvidedCount,
    mostUsefulInsightCount,
    hardestUnderPressureCount,
  };
}
