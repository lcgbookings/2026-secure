import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

type ErasureLogRow = {
  id: string;
  erased_by_admin_id: string | null;
  reason: string | null;
  bookings_affected: number | null;
  erased_at: string | null;
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export default async function PrivacyLogPage() {
  const sessionClient = await createClient();
  const {
    data: { user: authUser },
  } = await sessionClient.auth.getUser();

  const admin = createAdminClient();

  let isSuperAdmin = false;
  if (authUser) {
    const { data: currentAdmin } = await admin
      .from('admin_users')
      .select('role')
      .eq('auth_user_id', authUser.id)
      .maybeSingle();
    isSuperAdmin = currentAdmin?.role === 'super_admin';
  }

  if (!isSuperAdmin) {
    return (
      <main className="max-w-5xl mx-auto px-6 py-8">
        <p className="text-sm text-lcg-body-muted">
          This page is restricted to super_admin.
        </p>
      </main>
    );
  }

  const { data: logRaw } = await admin
    .from('data_erasure_log')
    .select('id, erased_by_admin_id, reason, bookings_affected, erased_at')
    .order('erased_at', { ascending: false });

  const logRows = (logRaw ?? []) as ErasureLogRow[];

  const actionerIds = Array.from(
    new Set(logRows.map((r) => r.erased_by_admin_id).filter((v): v is string => !!v))
  );

  const actionerById = new Map<string, { name: string; email: string | null }>();
  if (actionerIds.length > 0) {
    const { data: admins } = await admin
      .from('admin_users')
      .select('id, full_name, email')
      .in('id', actionerIds);
    for (const a of admins ?? []) {
      actionerById.set(a.id as string, {
        name: (a.full_name as string | null) ?? '',
        email: (a.email as string | null) ?? null,
      });
    }
  }

  function actionerLabel(id: string | null): string {
    if (!id) return '—';
    const entry = actionerById.get(id);
    if (!entry) return 'Unknown';
    return entry.name || entry.email || 'Unknown';
  }

  return (
    <main className="max-w-5xl mx-auto px-6 py-8">
      <header className="mb-8">
        <Link
          href="/admin"
          className="text-sm text-lcg-body-muted hover:text-lcg-deep-teal mb-2 inline-block"
        >
          ← Back to dashboard
        </Link>
        <span className="lcg-eyebrow mb-2 mt-2 block">Data &amp; privacy</span>
        <h1 className="font-serif text-3xl text-lcg-deep-teal">Erasure log</h1>
        <p className="text-sm text-lcg-body-muted mt-1">
          Every right-to-be-forgotten action taken on this database.
        </p>
      </header>

      <section className="lcg-card p-6">
        {logRows.length === 0 ? (
          <p className="text-sm text-lcg-body-muted italic">
            No erasures recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-lcg-body-muted uppercase tracking-wide border-b border-lcg-deep-teal/10">
                  <th className="pb-3 pr-4">Date</th>
                  <th className="pb-3 px-3">By</th>
                  <th className="pb-3 px-3 text-right">Bookings affected</th>
                  <th className="pb-3 pl-3">Reason</th>
                </tr>
              </thead>
              <tbody>
                {logRows.map((row) => (
                  <tr key={row.id} className="border-b border-lcg-deep-teal/5">
                    <td className="py-3 pr-4 text-lcg-body whitespace-nowrap">
                      {formatTimestamp(row.erased_at)}
                    </td>
                    <td className="py-3 px-3 text-lcg-body">
                      {actionerLabel(row.erased_by_admin_id)}
                    </td>
                    <td className="py-3 px-3 text-right text-lcg-body">
                      {row.bookings_affected ?? 0}
                    </td>
                    <td className="py-3 pl-3 text-lcg-body-muted">
                      {row.reason ? row.reason : <span className="italic">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
