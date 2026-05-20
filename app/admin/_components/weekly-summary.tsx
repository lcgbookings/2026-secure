import { getWeeklySummary } from '@/lib/analytics/weekly-summary';

export async function WeeklySummary() {
  const summary = await getWeeklySummary();
  return (
    <section className="lcg-card-dark p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <span className="lcg-eyebrow text-lcg-blue mb-1">This week</span>
          <h2 className="font-serif text-xl text-lcg-cream">Your work, at a glance</h2>
        </div>
        <div className="text-xs text-lcg-cream/50">Rolling 7 days</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Tile label="Calls made" value={summary.callsMadeThisWeek} />
        <Tile label="Customers confirmed" value={summary.confirmedThisWeek} />
        <Tile
          label={summary.sessionsNextWeek === 1 ? 'Session next week' : 'Sessions next week'}
          value={summary.sessionsNextWeek}
          sub={
            summary.bookingsInUpcomingSessions > 0
              ? `${summary.bookingsInUpcomingSessions} bookings`
              : undefined
          }
        />
      </div>
    </section>
  );
}

function Tile({
  label,
  value,
  sub,
}: {
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div className="border-l-2 border-lcg-blue/30 pl-4">
      <div className="text-xs text-lcg-cream/50 uppercase tracking-wide">{label}</div>
      <div className="font-serif text-3xl text-lcg-cream mt-1">{value}</div>
      {sub && <div className="text-xs text-lcg-cream/50 mt-1">{sub}</div>}
    </div>
  );
}
