import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatEventDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Status = 'scheduled' | 'draft' | 'completed' | 'cancelled';
const VALID: readonly Status[] = ['scheduled', 'draft', 'completed', 'cancelled'];

const TAB_LABELS: Record<Status, string> = {
  scheduled: 'Scheduled',
  draft: 'Draft',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function normaliseStatus(raw: string | undefined): Status {
  if (!raw) return 'scheduled';
  return (VALID as readonly string[]).includes(raw) ? (raw as Status) : 'scheduled';
}

export default async function CohortsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: rawStatus } = await searchParams;
  const status = normaliseStatus(rawStatus);

  const supabase = createAdminClient();
  const { data: cohorts } = await supabase
    .from('events')
    .select(
      'id, session_label, session_date, start_time, end_time, location, venue, status, auto_created'
    )
    .eq('status', status)
    .order('start_time', { ascending: true });

  const cohortList = cohorts ?? [];
  const cohortIds = cohortList.map((e) => e.id);

  const { data: bookingRows } = await supabase
    .from('bookings')
    .select('event_id, confirmation_status')
    .in('event_id', cohortIds.length ? cohortIds : ['00000000-0000-0000-0000-000000000000']);

  const statsByCohort = new Map<
    string,
    { booked: number; confirmed: number; pending: number }
  >();
  for (const b of bookingRows ?? []) {
    if (!b.event_id) continue;
    const s = statsByCohort.get(b.event_id) ?? { booked: 0, confirmed: 0, pending: 0 };
    s.booked += 1;
    if (b.confirmation_status === 'confirmed') s.confirmed += 1;
    if (b.confirmation_status === 'pending') s.pending += 1;
    statsByCohort.set(b.event_id, s);
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      <header className="mb-6">
        <span className="lcg-eyebrow mb-2">Events Hub</span>
        <h1 className="font-serif text-3xl text-lcg-deep-teal">Cohorts</h1>
        <p className="text-sm text-lcg-body-muted mt-1">
          All scheduled, draft, and completed sessions
        </p>
      </header>

      <div className="flex gap-2 mb-6">
        {VALID.map((s) => {
          const active = s === status;
          return (
            <Link
              key={s}
              href={`/admin/cohorts?status=${s}`}
              className={active ? 'lcg-btn-primary' : 'lcg-btn-secondary'}
            >
              {TAB_LABELS[s]}
            </Link>
          );
        })}
      </div>

      {cohortList.length === 0 ? (
        <div className="lcg-card p-8 text-center text-lcg-body-muted text-sm">
          No {TAB_LABELS[status].toLowerCase()} cohorts.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cohortList.map((ev) => {
            const stats = statsByCohort.get(ev.id) ?? {
              booked: 0,
              confirmed: 0,
              pending: 0,
            };
            const when =
              ev.start_time && ev.end_time
                ? formatEventDateTime(ev.start_time, ev.end_time)
                : null;
            return (
              <Link
                key={ev.id}
                href={`/admin/cohorts/${ev.id}`}
                className="lcg-card p-5 hover:border-lcg-teal/40 transition group block"
              >
                {ev.status === 'draft' && (
                  <span className="lcg-eyebrow text-amber-700 mb-2">
                    Draft — needs review
                  </span>
                )}
                <div className="font-serif text-lg text-lcg-deep-teal mb-1 group-hover:text-lcg-teal transition">
                  {ev.session_label}
                </div>
                <div className="text-sm text-lcg-body-muted mb-1">
                  {ev.venue ?? (
                    <span className="italic">Venue not set</span>
                  )}
                  {ev.location ? ` · ${ev.location}` : ''}
                </div>
                {when && (
                  <div className="text-xs text-lcg-body-muted">{when}</div>
                )}
                <div className="grid grid-cols-3 gap-2 mt-4">
                  <Mini label="Booked" value={stats.booked} />
                  <Mini label="Confirmed" value={stats.confirmed} />
                  <Mini label="Pending" value={stats.pending} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-lcg-body-muted">{label}</div>
      <div className="font-serif text-xl text-lcg-deep-teal">{value}</div>
    </div>
  );
}
