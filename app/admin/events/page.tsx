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

export default async function EventsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: rawStatus } = await searchParams;
  const status = normaliseStatus(rawStatus);

  const supabase = createAdminClient();
  const { data: events } = await supabase
    .from('events')
    .select(
      'id, session_label, session_date, start_time, end_time, location, venue, status, auto_created'
    )
    .eq('status', status)
    .order('start_time', { ascending: true });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin"
          className="text-sm text-neutral-500 hover:text-neutral-900"
        >
          ← Back to dashboard
        </Link>
        <h1 className="text-2xl font-bold mt-2">Events</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {VALID.map((s) => {
          const active = s === status;
          return (
            <Link
              key={s}
              href={`/admin/events?status=${s}`}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                active
                  ? 'border-neutral-900 text-neutral-900'
                  : 'border-transparent text-neutral-500 hover:text-neutral-900'
              }`}
            >
              {TAB_LABELS[s]}
            </Link>
          );
        })}
      </div>

      {(events?.length ?? 0) === 0 ? (
        <div className="border rounded-lg p-8 text-center text-neutral-500">
          No {TAB_LABELS[status].toLowerCase()} events.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 border-b">
              <tr>
                <th className="text-left p-3 font-medium">Session</th>
                <th className="text-left p-3 font-medium">Location</th>
                <th className="text-left p-3 font-medium">Venue</th>
                <th className="text-left p-3 font-medium">When</th>
                <th className="text-left p-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {(events ?? []).map((ev) => (
                <tr key={ev.id} className="border-b last:border-b-0 hover:bg-neutral-50">
                  <td className="p-3">
                    <Link
                      href={`/admin/events/${ev.id}`}
                      className="font-medium hover:underline"
                    >
                      {ev.session_label}
                    </Link>
                    {ev.auto_created && (
                      <span className="ml-2 inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-neutral-200 text-neutral-700">
                        Auto-created
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-neutral-700">{ev.location ?? '-'}</td>
                  <td className="p-3 text-neutral-700">
                    {ev.venue ?? (
                      <span className="text-neutral-400 italic">Not set</span>
                    )}
                  </td>
                  <td className="p-3 text-neutral-700">
                    {ev.start_time && ev.end_time
                      ? formatEventDateTime(ev.start_time, ev.end_time)
                      : '-'}
                  </td>
                  <td className="p-3 text-right">
                    {ev.status === 'draft' && (
                      <form action={`/api/admin/events/${ev.id}/promote`} method="post">
                        <button
                          type="submit"
                          className="px-3 py-1.5 bg-neutral-900 text-white rounded-md text-xs font-medium hover:bg-neutral-800"
                        >
                          Promote to live
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
