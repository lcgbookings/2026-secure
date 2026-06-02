import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildTodayQueue } from '@/lib/today/build-queue';
import { runTodayMaintenance } from '@/lib/today/maintenance';
import UpNextCard, { CategoryPill } from './up-next-card';

export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  // Idempotent maintenance: auto-flip pending → no_show for ended sessions,
  // and fire any pending no-show recovery webhooks. Runs before the queue is
  // built so newly-flipped bookings show up in this render.
  await runTodayMaintenance();

  const queue = await buildTodayQueue();

  const supabase = createAdminClient();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const { count: signupsToday } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', startOfToday.toISOString());

  const callsToday = queue.length;
  const hotLeadsCount = queue.filter((q) => q.priority === 'hot').length;

  const formattedToday = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const previewCount = Math.min(queue.length, 11);
  const preview = queue.slice(1, previewCount);
  const remaining = Math.max(queue.length - previewCount, 0);

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <header className="mb-10">
        <p className="text-sm text-lcg-body-muted mb-1">{formattedToday}</p>
        <h1 className="font-serif text-3xl text-lcg-deep-teal">Today</h1>

        <div className="flex gap-10 mt-8">
          <div>
            <div className="font-serif text-3xl text-lcg-deep-teal">{callsToday}</div>
            <div className="text-sm text-lcg-body-muted mt-1">calls</div>
          </div>
          <div>
            <div className="font-serif text-3xl text-lcg-deep-teal">{hotLeadsCount}</div>
            <div className="text-sm text-lcg-body-muted mt-1">hot leads</div>
          </div>
          <div>
            <div className="font-serif text-3xl text-lcg-deep-teal">
              {signupsToday ?? 0}
            </div>
            <div className="text-sm text-lcg-body-muted mt-1">sign-ups today</div>
          </div>
        </div>
      </header>

      {queue.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-2xl font-serif text-lcg-deep-teal mb-2">
            All done for today.
          </p>
          <p className="text-sm text-lcg-body-muted">
            New calls will appear here as bookings come in.
          </p>
        </div>
      ) : (
        <>
          <section className="mb-8">
            <div className="lcg-eyebrow mb-3 text-lcg-deep-teal/60">Up next</div>
            <UpNextCard item={queue[0]} />
          </section>

          {preview.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <div className="lcg-eyebrow text-lcg-deep-teal/60">Then today</div>
                <span className="text-xs text-lcg-body-muted">
                  {queue.length - 1} more
                </span>
              </div>

              <ul className="divide-y divide-lcg-deep-teal/5">
                {preview.map((item) => (
                  <li key={item.id} className="py-3">
                    <Link
                      href={`/admin/bookings/${item.id}`}
                      className="group flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-lcg-deep-teal group-hover:text-lcg-teal transition">
                            {item.first_name} {item.last_name}
                          </span>
                          <CategoryPill priority={item.priority} subtle />
                        </div>
                        <p className="text-xs text-lcg-body-muted truncate mt-0.5">
                          {item.email}
                        </p>
                      </div>
                      <span className="text-xs text-lcg-body-muted shrink-0">
                        {item.session_label_short}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>

              {remaining > 0 && (
                <button
                  type="button"
                  className="text-sm text-lcg-deep-teal/70 hover:text-lcg-deep-teal mt-3"
                >
                  View all {queue.length} →
                </button>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
