import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatEventDateTime } from '@/lib/format';
import { getCohortStats, type CohortStats } from '@/lib/analytics/cohort-stats';

export const dynamic = 'force-dynamic';

type EventRow = {
  id: string;
  session_label: string | null;
  start_time: string | null;
  end_time: string | null;
  venue: string | null;
  status: string | null;
};

function pctOrDash(num: number, denom: number): string {
  if (denom === 0) return '–';
  return Math.round((num / denom) * 100).toString();
}

function calibrationVerdict(attended: number, confirmed: number): string {
  if (confirmed === 0) return 'No data';
  const rate = (attended / confirmed) * 100;
  if (rate >= 80) return "Strong — keep doing what you're doing";
  if (rate >= 60) return 'Solid — small room to improve';
  if (rate >= 40) return 'Mixed — worth a debrief';
  return "Below target — let's review approach";
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ eventId?: string }>;
}) {
  const { eventId: queryEventId } = await searchParams;
  const supabase = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: eventsRaw } = await supabase
    .from('events')
    .select('id, session_label, start_time, end_time, venue, status')
    .in('status', ['scheduled', 'completed'])
    .order('start_time', { ascending: false })
    .limit(20);

  const events = (eventsRaw ?? []) as EventRow[];

  let selectedEventId = queryEventId ?? null;
  if (!selectedEventId) {
    const nextUpcoming = [...events]
      .filter((e) => e.status === 'scheduled' && e.end_time && e.end_time > nowIso)
      .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''))[0];
    selectedEventId = nextUpcoming?.id ?? events[0]?.id ?? null;
  }

  return (
    <main className="max-w-7xl mx-auto px-6 py-8">
      <header className="mb-8">
        <div className="flex items-center gap-4 mb-2">
          <Link
            href="/admin"
            className="text-sm text-lcg-body-muted hover:text-lcg-deep-teal inline-block"
          >
            ← Back to dashboard
          </Link>
          {queryEventId && (
            <Link
              href={`/admin/events/${queryEventId}`}
              className="text-sm text-lcg-body-muted hover:text-lcg-deep-teal inline-block"
            >
              ← View attendee list
            </Link>
          )}
        </div>
        <span className="lcg-eyebrow mb-2 mt-2 block">Operational analytics</span>
        <h1 className="font-serif text-3xl text-lcg-deep-teal">Cohort performance</h1>
        <p className="text-sm text-lcg-body-muted mt-1">
          How well your pre-event work translates to attendance and engagement
        </p>
      </header>

      {events.length === 0 ? (
        <p className="text-sm text-lcg-body-muted italic">
          No scheduled or completed events yet.
        </p>
      ) : (
        <>
          <CohortPicker events={events} selectedEventId={selectedEventId} />
          {selectedEventId && (
            <CohortAnalytics
              event={events.find((e) => e.id === selectedEventId) ?? events[0]}
            />
          )}
        </>
      )}
    </main>
  );
}

function CohortPicker({
  events,
  selectedEventId,
}: {
  events: EventRow[];
  selectedEventId: string | null;
}) {
  return (
    <div className="flex flex-wrap gap-2 mb-8">
      {events.map((ev) => {
        const active = ev.id === selectedEventId;
        return (
          <Link
            key={ev.id}
            href={`/admin/analytics?eventId=${ev.id}`}
            className={active ? 'lcg-btn-primary' : 'lcg-btn-secondary'}
          >
            {ev.session_label ?? '(untitled)'}
          </Link>
        );
      })}
    </div>
  );
}

async function CohortAnalytics({ event }: { event: EventRow }) {
  const supabase = createAdminClient();
  const stats = await getCohortStats(event.id);

  const eventHasEnded =
    !!event.end_time && new Date(event.end_time).getTime() < Date.now();

  const { data: reflectionsRaw } = await supabase
    .from('bookings')
    .select('session_value_rating')
    .eq('event_id', event.id)
    .not('session_value_rating', 'is', null);

  const reflectionCount = reflectionsRaw?.length ?? 0;
  const avgRating =
    reflectionCount > 0
      ? (reflectionsRaw ?? []).reduce(
          (sum, r) => sum + (r.session_value_rating ?? 0),
          0
        ) / reflectionCount
      : null;

  const eventWhen =
    event.start_time && event.end_time
      ? formatEventDateTime(event.start_time, event.end_time)
      : '(time TBC)';

  return (
    <>
      <div className="mb-6">
        <h2 className="font-serif text-2xl text-lcg-deep-teal">
          {event.session_label ?? '(untitled)'}
        </h2>
        <p className="text-sm text-lcg-body-muted mt-1">
          {event.venue ?? 'Venue TBC'} · {eventWhen} · Status: {event.status}
        </p>
      </div>

      <PreEventFunnel stats={stats} />
      <Attendance
        stats={stats}
        eventHasEnded={eventHasEnded}
        avgRating={avgRating}
        reflectionCount={reflectionCount}
        eventWhen={eventWhen}
      />
      {eventHasEnded && stats.confirmed > 0 && <Calibration stats={stats} />}
    </>
  );
}

function PreEventFunnel({ stats }: { stats: CohortStats }) {
  return (
    <section className="lcg-card p-6 mb-6">
      <div className="lcg-eyebrow mb-1 text-lcg-deep-teal/60">Pre-event funnel</div>
      <h3 className="font-serif text-xl text-lcg-deep-teal mb-5">
        From booking to confirmation
      </h3>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Booked"
          value={stats.booked}
          sub="customers via Systeme"
        />
        <MetricCard
          label="Pricing disclosed"
          value={stats.pricingDisclosed}
          sub={`${pctOrDash(stats.pricingDisclosed, stats.booked)}% of bookings`}
        />
        <MetricCard
          label="Confirmed"
          value={stats.confirmed}
          sub={`${pctOrDash(stats.confirmed, stats.booked)}% confirmation`}
        />
        <MetricCard
          label="WhatsApp video sent"
          value={stats.whatsappVideoSent}
          sub={`${pctOrDash(stats.whatsappVideoSent, stats.callsAnswered)}% of answered calls`}
        />
      </div>

      {stats.pricingDisclosed > 0 && (
        <div className="mt-6 pt-6 border-t border-lcg-deep-teal/10">
          <div className="text-xs text-lcg-body-muted uppercase tracking-wide mb-3">
            Pricing response distribution
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MiniPill
              label="Open to investing"
              count={stats.pricingResponseDistribution.open_to_invest}
              total={stats.pricingDisclosed}
              accent="green"
            />
            <MiniPill
              label="Undecided"
              count={stats.pricingResponseDistribution.undecided}
              total={stats.pricingDisclosed}
              accent="amber"
            />
            <MiniPill
              label="Not in a position"
              count={stats.pricingResponseDistribution.not_in_position}
              total={stats.pricingDisclosed}
              accent="red"
            />
            <MiniPill
              label="Not asked yet"
              count={stats.pricingResponseDistribution.not_asked}
              total={stats.pricingDisclosed}
              accent="neutral"
            />
          </div>
        </div>
      )}

      <div className="mt-6 pt-6 border-t border-lcg-deep-teal/10">
        <div className="text-xs text-lcg-body-muted uppercase tracking-wide mb-3">
          Call effort
        </div>
        <div className="flex items-baseline gap-6 flex-wrap">
          <div>
            <span className="font-serif text-2xl text-lcg-deep-teal">
              {stats.callsMade}
            </span>
            <span className="text-sm text-lcg-body-muted ml-2">total calls made</span>
          </div>
          <div>
            <span className="font-serif text-2xl text-lcg-deep-teal">
              {stats.callsAnswered}
            </span>
            <span className="text-sm text-lcg-body-muted ml-2">
              answered ({pctOrDash(stats.callsAnswered, stats.callsMade)}%)
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Attendance({
  stats,
  eventHasEnded,
  avgRating,
  reflectionCount,
  eventWhen,
}: {
  stats: CohortStats;
  eventHasEnded: boolean;
  avgRating: number | null;
  reflectionCount: number;
  eventWhen: string;
}) {
  return (
    <section className="lcg-card p-6 mb-6">
      <div className="lcg-eyebrow mb-1 text-lcg-deep-teal/60">Attendance</div>
      <h3 className="font-serif text-xl text-lcg-deep-teal mb-5">
        What actually happened
      </h3>

      {eventHasEnded ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard
              label="Attended"
              value={stats.attended}
              sub={`${pctOrDash(stats.attended, stats.confirmed)}% show-up rate`}
            />
            <MetricCard
              label="No-shows"
              value={stats.noShows}
              sub={`${pctOrDash(stats.noShows, stats.confirmed)}% of confirmed`}
            />
            <MetricCard
              label="Hot coaching"
              value={stats.hotCoaching}
              sub={`${pctOrDash(stats.hotCoaching, stats.attended)}% of attended`}
            />
            <MetricCard
              label="Show-up rate"
              value={`${pctOrDash(stats.attended, stats.confirmed)}%`}
              sub="of confirmed bookings"
            />
          </div>

          {avgRating !== null && (
            <div className="mt-6 pt-6 border-t border-lcg-deep-teal/10">
              <div className="text-xs text-lcg-body-muted uppercase tracking-wide mb-3">
                Reflection feedback
              </div>
              <div className="flex items-baseline gap-6 flex-wrap">
                <div>
                  <span className="font-serif text-3xl text-lcg-deep-teal">
                    {avgRating.toFixed(1)}
                  </span>
                  <span className="text-sm text-lcg-body-muted ml-2">
                    avg session value rating
                  </span>
                </div>
                <div>
                  <span className="font-serif text-2xl text-lcg-deep-teal">
                    {reflectionCount}
                  </span>
                  <span className="text-sm text-lcg-body-muted ml-2">
                    reflections submitted
                  </span>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">⏳</div>
          <p className="text-lg font-serif text-lcg-deep-teal mb-1">
            Session hasn&apos;t happened yet
          </p>
          <p className="text-sm text-lcg-body-muted">
            Attendance metrics appear after the event ends.
          </p>
          <p className="text-xs text-lcg-body-muted mt-2">{eventWhen}</p>
        </div>
      )}
    </section>
  );
}

function Calibration({ stats }: { stats: CohortStats }) {
  return (
    <section className="lcg-card-dark p-6 mb-6">
      <div className="lcg-eyebrow text-lcg-blue mb-1">Your calibration</div>
      <h3 className="font-serif text-xl text-lcg-cream mb-5">
        How well does &quot;confirmed&quot; predict attendance?
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <div className="text-xs text-lcg-cream/50 uppercase tracking-wide mb-2">
            You confirmed
          </div>
          <div className="font-serif text-4xl text-lcg-cream">{stats.confirmed}</div>
          <div className="text-sm text-lcg-cream/70 mt-1">
            customers for this session
          </div>
        </div>
        <div>
          <div className="text-xs text-lcg-cream/50 uppercase tracking-wide mb-2">
            Actually showed up
          </div>
          <div className="font-serif text-4xl text-lcg-blue">{stats.attended}</div>
          <div className="text-sm text-lcg-cream/70 mt-1">attended the session</div>
        </div>
        <div>
          <div className="text-xs text-lcg-cream/50 uppercase tracking-wide mb-2">
            Calibration
          </div>
          <div className="font-serif text-4xl text-lcg-cream">
            {pctOrDash(stats.attended, stats.confirmed)}%
          </div>
          <div className="text-sm text-lcg-cream/70 mt-1">
            {calibrationVerdict(stats.attended, stats.confirmed)}
          </div>
        </div>
      </div>

      <p className="text-xs text-lcg-cream/40 mt-6 italic">
        A high % means your &quot;confirmed&quot; calls predict real attendance well.
        If this drops over time, talk to Gordon — your judgement may need
        recalibrating against new customer behaviour.
      </p>
    </section>
  );
}

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <div className="border-l-2 border-lcg-teal/40 pl-4">
      <div className="text-xs text-lcg-body-muted uppercase tracking-wide">{label}</div>
      <div className="font-serif text-3xl text-lcg-deep-teal mt-1">{value}</div>
      {sub && <div className="text-xs text-lcg-body-muted mt-1">{sub}</div>}
    </div>
  );
}

function MiniPill({
  label,
  count,
  total,
  accent,
}: {
  label: string;
  count: number;
  total: number;
  accent: 'green' | 'amber' | 'red' | 'neutral';
}) {
  const colour: Record<typeof accent, string> = {
    green: 'border-green-200 bg-green-50 text-green-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    red: 'border-red-200 bg-red-50 text-red-900',
    neutral: 'border-neutral-200 bg-neutral-50 text-neutral-900',
  };
  return (
    <div className={`border ${colour[accent]} rounded-lg p-3`}>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="font-serif text-2xl">{count}</span>
        <span className="text-xs opacity-60">/ {total}</span>
      </div>
    </div>
  );
}
