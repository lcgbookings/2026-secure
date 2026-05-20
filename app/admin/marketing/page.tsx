import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getChannelFunnels,
  getSurveyInsights,
  type ChannelFunnel,
  type SurveyInsights,
} from '@/lib/analytics/cohort-stats';

export const dynamic = 'force-dynamic';

type EventRow = {
  id: string;
  session_label: string | null;
  start_time: string | null;
  status: string | null;
};

function pctOrDash(num: number, denom: number): string {
  if (denom === 0) return '–';
  return Math.round((num / denom) * 100).toString();
}

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ eventId?: string }>;
}) {
  const { eventId } = await searchParams;
  const scope = eventId && eventId.length > 0 ? eventId : null;

  const supabase = createAdminClient();
  const { data: eventsRaw } = await supabase
    .from('events')
    .select('id, session_label, start_time, status')
    .in('status', ['scheduled', 'completed'])
    .order('start_time', { ascending: false })
    .limit(20);
  const events = (eventsRaw ?? []) as EventRow[];

  const [channels, insights, conversion] = await Promise.all([
    getChannelFunnels(scope ? { eventId: scope } : undefined),
    getSurveyInsights(scope ? { eventId: scope } : undefined),
    getConversionTotals(scope),
  ]);

  return (
    <main className="max-w-7xl mx-auto px-6 py-8">
      <header className="mb-8">
        <Link
          href="/admin"
          className="text-sm text-lcg-body-muted hover:text-lcg-deep-teal mb-2 inline-block"
        >
          ← Back to dashboard
        </Link>
        <span className="lcg-eyebrow mb-2 mt-2 block">Marketing intelligence</span>
        <h1 className="font-serif text-3xl text-lcg-deep-teal">
          Where the revenue comes from
        </h1>
        <p className="text-sm text-lcg-body-muted mt-1">
          Channel performance, conversion, and what the surveys tell us
        </p>
      </header>

      <ScopeToggle events={events} selectedEventId={scope} />

      <ConversionPanel
        totalHotLeads={conversion.hotLeads}
        totalInConversation={conversion.inConversation}
        totalSignedUp={conversion.signedUp}
      />
      <ChannelIntelligencePanel channels={channels} />
      <SurveyInsightsPanel insights={insights} />
    </main>
  );
}

async function getConversionTotals(eventId: string | null): Promise<{
  hotLeads: number;
  inConversation: number;
  signedUp: number;
}> {
  const admin = createAdminClient();
  let query = admin
    .from('bookings')
    .select('attendance_status, coaching_interest, masterclass_outcome');
  if (eventId) query = query.eq('event_id', eventId);

  const { data } = await query;
  const rows = (data ?? []) as Array<{
    attendance_status: string | null;
    coaching_interest: string | null;
    masterclass_outcome: string | null;
  }>;

  let hotLeads = 0;
  let inConversation = 0;
  let signedUp = 0;
  for (const r of rows) {
    if (
      r.attendance_status === 'attended' &&
      r.coaching_interest === 'speak_before_leaving'
    ) {
      hotLeads += 1;
    }
    if (r.masterclass_outcome === 'in_conversation') inConversation += 1;
    if (r.masterclass_outcome === 'signed_up') signedUp += 1;
  }
  return { hotLeads, inConversation, signedUp };
}

function ScopeToggle({
  events,
  selectedEventId,
}: {
  events: EventRow[];
  selectedEventId: string | null;
}) {
  return (
    <div className="flex flex-wrap gap-2 mb-8">
      <Link
        href="/admin/marketing"
        className={selectedEventId === null ? 'lcg-btn-primary' : 'lcg-btn-secondary'}
      >
        All cohorts
      </Link>
      {events.map((ev) => {
        const active = ev.id === selectedEventId;
        return (
          <Link
            key={ev.id}
            href={`/admin/marketing?eventId=${ev.id}`}
            className={active ? 'lcg-btn-primary' : 'lcg-btn-secondary'}
          >
            {ev.session_label ?? '(untitled)'}
          </Link>
        );
      })}
    </div>
  );
}

function ConversionPanel({
  totalHotLeads,
  totalInConversation,
  totalSignedUp,
}: {
  totalHotLeads: number;
  totalInConversation: number;
  totalSignedUp: number;
}) {
  return (
    <section className="lcg-card-dark p-6 mb-6">
      <div className="lcg-eyebrow text-lcg-blue mb-1">The relationship that matters</div>
      <h2 className="font-serif text-2xl text-lcg-cream mb-5">
        Hot interest → programme sign-up
      </h2>

      {totalHotLeads === 0 ? (
        <div className="text-center py-10">
          <p className="text-lg font-serif text-lcg-cream mb-1">
            No completed cohorts yet
          </p>
          <p className="text-sm text-lcg-cream/60">
            This fills in after your first session, when attendees flag interest and Abel records outcomes.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div>
              <div className="text-xs text-lcg-cream/50 uppercase tracking-wide mb-2">
                Flagged interest
              </div>
              <div className="font-serif text-4xl text-lcg-cream">{totalHotLeads}</div>
              <div className="text-sm text-lcg-cream/60 mt-1">
                said &quot;I want to speak&quot;
              </div>
            </div>
            <div>
              <div className="text-xs text-lcg-cream/50 uppercase tracking-wide mb-2">
                In conversation
              </div>
              <div className="font-serif text-4xl text-lcg-cream">
                {totalInConversation}
              </div>
              <div className="text-sm text-lcg-cream/60 mt-1">still being worked</div>
            </div>
            <div>
              <div className="text-xs text-lcg-cream/50 uppercase tracking-wide mb-2">
                Signed up
              </div>
              <div className="font-serif text-4xl text-lcg-blue">{totalSignedUp}</div>
              <div className="text-sm text-lcg-cream/60 mt-1">joined the programme</div>
            </div>
            <div>
              <div className="text-xs text-lcg-cream/50 uppercase tracking-wide mb-2">
                Conversion
              </div>
              <div className="font-serif text-4xl text-lcg-cream">
                {pctOrDash(totalSignedUp, totalHotLeads)}%
              </div>
              <div className="text-sm text-lcg-cream/60 mt-1">
                of hot leads convert
              </div>
            </div>
          </div>
          <p className="text-xs text-lcg-cream/40 mt-6 italic">
            This is the core funnel economics. If conversion is high, the masterclass is doing its job as a lead source. If hot leads aren&apos;t converting, the gap is in the follow-up, not the marketing.
          </p>
        </>
      )}
    </section>
  );
}

function ChannelIntelligencePanel({ channels }: { channels: ChannelFunnel[] }) {
  return (
    <section className="lcg-card p-6 mb-6">
      <div className="lcg-eyebrow mb-1 text-lcg-deep-teal/60">Channel performance</div>
      <h2 className="font-serif text-xl text-lcg-deep-teal mb-1">
        Which channels deliver customers, not just clicks
      </h2>
      <p className="text-sm text-lcg-body-muted mb-5">
        Full funnel by referral source. The signedUp column is what matters for spend decisions.
      </p>

      {channels.length === 0 ? (
        <p className="text-sm text-lcg-body-muted italic">No referral data yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-lcg-body-muted uppercase tracking-wide border-b border-lcg-deep-teal/10">
                <th className="pb-3 pr-4">Channel</th>
                <th className="pb-3 px-3 text-right">Booked</th>
                <th className="pb-3 px-3 text-right">Confirmed</th>
                <th className="pb-3 px-3 text-right">Attended</th>
                <th className="pb-3 px-3 text-right">Hot leads</th>
                <th className="pb-3 px-3 text-right">Signed up</th>
                <th className="pb-3 pl-3 text-right">Sign-up rate</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((ch) => (
                <tr key={ch.channel} className="border-b border-lcg-deep-teal/5">
                  <td className="py-3 pr-4 font-medium text-lcg-deep-teal">{ch.channel}</td>
                  <td className="py-3 px-3 text-right">{ch.booked}</td>
                  <td className="py-3 px-3 text-right">{ch.confirmed}</td>
                  <td className="py-3 px-3 text-right">{ch.attended}</td>
                  <td className="py-3 px-3 text-right">{ch.hotLeads}</td>
                  <td className="py-3 px-3 text-right font-semibold text-lcg-teal">
                    {ch.signedUp}
                  </td>
                  <td className="py-3 pl-3 text-right">
                    {ch.signUpRate === null ? '–' : `${ch.signUpRate}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-lcg-body-muted mt-4 italic">
        Tip: a channel with fewer bookings but higher sign-up rate may deserve more spend than a high-volume, low-conversion channel.
      </p>
    </section>
  );
}

function SurveyInsightsPanel({ insights }: { insights: SurveyInsights }) {
  return (
    <section className="lcg-card p-6 mb-6">
      <div className="lcg-eyebrow mb-1 text-lcg-deep-teal/60">Audience insight</div>
      <h2 className="font-serif text-xl text-lcg-deep-teal mb-5">
        What the surveys tell us
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <div className="text-xs text-lcg-body-muted uppercase tracking-wide mb-3">
            Experience level (pre-event)
          </div>
          <DistributionBars data={insights.experienceLevelDistribution} accent="teal" />
        </div>
        <div>
          <div className="text-xs text-lcg-body-muted uppercase tracking-wide mb-3">
            Responsibility level (pre-event)
          </div>
          <DistributionBars
            data={insights.responsibilityLevelDistribution}
            accent="teal"
          />
        </div>
        {insights.reflectionCount > 0 && (
          <>
            <div>
              <div className="text-xs text-lcg-body-muted uppercase tracking-wide mb-3">
                Session relevance (post-event)
              </div>
              <DistributionBars data={insights.relevanceDistribution} accent="blue" />
            </div>
            <div>
              <div className="text-xs text-lcg-body-muted uppercase tracking-wide mb-3">
                Coaching interest (post-event)
              </div>
              <DistributionBars
                data={insights.coachingInterestDistribution}
                accent="blue"
              />
            </div>
          </>
        )}
      </div>

      {insights.avgSessionValueRating !== null && (
        <div className="mt-6 pt-6 border-t border-lcg-deep-teal/10 flex items-baseline gap-6 flex-wrap">
          <div>
            <span className="font-serif text-3xl text-lcg-deep-teal">
              {insights.avgSessionValueRating.toFixed(1)}
            </span>
            <span className="text-sm text-lcg-body-muted ml-2">
              avg session value (of 10)
            </span>
          </div>
          <div>
            <span className="font-serif text-2xl text-lcg-deep-teal">
              {insights.reflectionCount}
            </span>
            <span className="text-sm text-lcg-body-muted ml-2">reflections</span>
          </div>
        </div>
      )}

      <div className="mt-6 pt-6 border-t border-lcg-deep-teal/10">
        <div className="text-xs text-lcg-body-muted uppercase tracking-wide mb-2">
          Free-text responses (for manual review in the export)
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-lcg-body-muted">
          <span>{insights.goalsProvidedCount} goals shared</span>
          <span>·</span>
          <span>{insights.mostUsefulInsightCount} insights captured</span>
          <span>·</span>
          <span>{insights.hardestUnderPressureCount} pressure-point reflections</span>
        </div>
      </div>
    </section>
  );
}

function DistributionBars({
  data,
  accent,
}: {
  data: Record<string, number>;
  accent: 'teal' | 'blue';
}) {
  const entries = Object.entries(data)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return <p className="text-sm text-lcg-body-muted italic">No data yet.</p>;
  }
  const max = Math.max(...entries.map(([, v]) => v));
  const barColour = accent === 'teal' ? 'bg-lcg-teal' : 'bg-lcg-blue';
  return (
    <div className="space-y-2">
      {entries.map(([label, count]) => (
        <div key={label}>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-lcg-body">{label}</span>
            <span className="text-lcg-body-muted">{count}</span>
          </div>
          <div className="h-2 bg-lcg-deep-teal/5 rounded-full overflow-hidden">
            <div
              className={`h-full ${barColour} rounded-full`}
              style={{ width: `${(count / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
