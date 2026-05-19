import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import SignOutButton from './sign-out-button';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const admin = createAdminClient();
  const { data: adminRow } = await admin
    .from('admin_users')
    .select('id, full_name, email, role, status')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!adminRow || adminRow.status !== 'active') {
    redirect('/login?error=not_authorised');
  }

  return (
    <div className="min-h-screen">
      <nav className="bg-lcg-deep-teal text-lcg-cream py-3 px-6 border-b border-lcg-deep-teal-dark">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link
            href="/admin"
            className="font-serif text-lg hover:text-lcg-teal transition"
          >
            Events Hub
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-lcg-cream/60 hidden md:inline">
              Leadership Communication Group
            </span>
            <div className="flex items-center gap-2">
              <span className="font-medium">{adminRow.email}</span>
              <span className="text-xs text-lcg-cream/40 uppercase tracking-wide">
                {adminRow.role}
              </span>
            </div>
            <SignOutButton />
          </div>
        </div>
      </nav>
      <main>{children}</main>
    </div>
  );
}
