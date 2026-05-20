import { createAdminClient } from '@/lib/supabase/admin';

export type WeeklySummary = {
  callsMadeThisWeek: number;
  confirmedThisWeek: number;
  sessionsNextWeek: number;
  bookingsInUpcomingSessions: number;
};

export async function getWeeklySummary(): Promise<WeeklySummary> {
  const supabase = createAdminClient();
  const now = new Date();
  const sevenDaysAgoIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAheadIso = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  const [callsRes, confirmedRes, eventsRes] = await Promise.all([
    supabase
      .from('call_attempts')
      .select('id', { count: 'exact', head: true })
      .gte('attempted_at', sevenDaysAgoIso),
    supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('confirmation_status', 'confirmed')
      .gte('last_contact_at', sevenDaysAgoIso),
    supabase
      .from('events')
      .select('id')
      .eq('status', 'scheduled')
      .gte('start_time', nowIso)
      .lt('start_time', sevenDaysAheadIso),
  ]);

  const callsMadeThisWeek = callsRes.count ?? 0;
  const confirmedThisWeek = confirmedRes.count ?? 0;
  const upcomingEventIds = (eventsRes.data ?? []).map((e) => e.id);
  const sessionsNextWeek = upcomingEventIds.length;

  let bookingsInUpcomingSessions = 0;
  if (upcomingEventIds.length > 0) {
    const { count } = await supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .in('event_id', upcomingEventIds);
    bookingsInUpcomingSessions = count ?? 0;
  }

  return {
    callsMadeThisWeek,
    confirmedThisWeek,
    sessionsNextWeek,
    bookingsInUpcomingSessions,
  };
}
