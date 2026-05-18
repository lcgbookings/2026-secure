import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await context.params;

  // Verify the user is an authenticated admin (same pattern as /api/events/[id])
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const admin = createAdminClient();
  const { data: adminRow } = await admin
    .from('admin_users')
    .select('id, status')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!adminRow || adminRow.status !== 'active') {
    return NextResponse.json({ error: 'Not authorised' }, { status: 403 });
  }

  // Guard: event must currently be a draft
  const { data: event, error: fetchErr } = await admin
    .from('events')
    .select('id, status')
    .eq('id', eventId)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }
  if (event.status !== 'draft') {
    return NextResponse.json(
      { error: `Cannot promote: event is ${event.status}, not draft` },
      { status: 400 }
    );
  }

  const { error: updateErr } = await admin
    .from('events')
    .update({ status: 'scheduled' })
    .eq('id', eventId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Redirect back to the drafts list so the page refreshes and the promoted
  // event drops off. 303 forces GET on the redirect target.
  const redirectUrl = new URL('/admin/events?status=draft', req.url);
  return NextResponse.redirect(redirectUrl, { status: 303 });
}
