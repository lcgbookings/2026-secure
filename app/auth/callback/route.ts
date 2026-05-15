import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/admin';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data?.user) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error?.message ?? 'unknown')}`
    );
  }

  // Link the auth user to the admin_users row (idempotent).
  const admin = createAdminClient();
  const { data: adminRow, error: adminError } = await admin
    .from('admin_users')
    .select('id, auth_user_id, status')
    .eq('email', data.user.email!.toLowerCase())
    .maybeSingle();

  if (adminError || !adminRow) {
    // Email not in admin_users — sign out and reject.
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=not_authorised`);
  }

  if (adminRow.status !== 'active') {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=account_suspended`);
  }

  // Set auth_user_id on first login.
  if (!adminRow.auth_user_id) {
    await admin
      .from('admin_users')
      .update({ auth_user_id: data.user.id })
      .eq('id', adminRow.id);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
