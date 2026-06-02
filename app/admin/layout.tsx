import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import SidebarNav from './_components/sidebar-nav';

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

  const links = [
    { href: '/admin', label: 'Today' },
    { href: '/admin/cohorts', label: 'Cohorts' },
    { href: '/admin/analytics', label: 'Analytics' },
  ];

  if (adminRow.role === 'super_admin') {
    links.push({ href: '/admin/privacy', label: 'Privacy' });
  }

  return (
    <SidebarNav email={adminRow.email} links={links}>
      {children}
    </SidebarNav>
  );
}
