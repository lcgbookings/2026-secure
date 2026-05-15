import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export default async function AdminHome() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const admin = createAdminClient();
  const { data: adminRow } = await admin
    .from('admin_users')
    .select('full_name, role')
    .eq('auth_user_id', user!.id)
    .single();

  // Pull some quick stats to prove DB access works under the authed session.
  const { count: attendeesCount } = await admin
    .from('attendees')
    .select('*', { count: 'exact', head: true });
  const { count: bookingsCount } = await admin
    .from('bookings')
    .select('*', { count: 'exact', head: true });
  const { count: pendingCalls } = await admin
    .from('bookings')
    .select('*', { count: 'exact', head: true })
    .eq('confirmation_status', 'pending');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Welcome, {adminRow?.full_name}</h1>
        <p className="text-sm text-neutral-500 mt-1">
          You are signed in as {adminRow?.role}.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="border rounded-lg p-4">
          <p className="text-xs uppercase text-neutral-500">Attendees</p>
          <p className="text-3xl font-bold mt-1">{attendeesCount ?? 0}</p>
        </div>
        <div className="border rounded-lg p-4">
          <p className="text-xs uppercase text-neutral-500">Bookings</p>
          <p className="text-3xl font-bold mt-1">{bookingsCount ?? 0}</p>
        </div>
        <div className="border rounded-lg p-4">
          <p className="text-xs uppercase text-neutral-500">Pending calls</p>
          <p className="text-3xl font-bold mt-1">{pendingCalls ?? 0}</p>
        </div>
      </div>

      <p className="text-sm text-neutral-500">
        The full dashboard ships in Session 5. This screen confirms authentication works.
      </p>
    </div>
  );
}
