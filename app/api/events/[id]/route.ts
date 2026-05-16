import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PatchBody {
  calendar_url?: string | null;
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await context.params;

  // Verify the user is an authenticated admin
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

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (body.calendar_url !== undefined) {
    const raw = body.calendar_url;
    if (raw === null || (typeof raw === 'string' && raw.trim() === '')) {
      updates.calendar_url = null;
    } else if (typeof raw === 'string') {
      try {
        new URL(raw.trim());
      } catch {
        return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
      }
      updates.calendar_url = raw.trim();
    } else {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No allowed fields in body' }, { status: 400 });
  }

  const { error } = await admin
    .from('events')
    .update(updates)
    .eq('id', eventId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
