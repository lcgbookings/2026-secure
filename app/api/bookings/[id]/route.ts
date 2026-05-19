import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PatchBody {
  event_id?: string | null;
  confirmation_status?: 'pending' | 'confirmed' | 'cancelled' | 'unreachable';
  goals?: string;
  experience_level?: string | null;
  responsibility_level?: string | null;
  venue_override?: string;
  pre_event_notes?: string;
  pricing_disclosed?: boolean;
  pricing_response?: 'open_to_invest' | 'not_in_position' | 'undecided' | 'not_asked' | null;
  calendar_invite_pending_update?: boolean;
}

const VALID_PRICING_RESPONSES = [
  'open_to_invest',
  'not_in_position',
  'undecided',
  'not_asked',
] as const;

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: bookingId } = await context.params;

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

  // Parse body
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Build update payload (only allowed fields)
  const updates: Record<string, unknown> = {};
  if (body.event_id !== undefined) updates.event_id = body.event_id;
  if (body.goals !== undefined) updates.goals = body.goals;
  if (body.experience_level !== undefined) {
    updates.experience_level = body.experience_level || null;
  }
  if (body.responsibility_level !== undefined) {
    updates.responsibility_level = body.responsibility_level || null;
  }
  if (body.venue_override !== undefined) updates.venue_override = body.venue_override;
  if (body.pre_event_notes !== undefined)
    updates.pre_event_notes = body.pre_event_notes;

  if (body.pricing_disclosed !== undefined) {
    if (typeof body.pricing_disclosed !== 'boolean') {
      return NextResponse.json({ error: 'pricing_disclosed must be boolean' }, { status: 400 });
    }
    updates.pricing_disclosed = body.pricing_disclosed;
  }
  if (body.pricing_response !== undefined) {
    const v = body.pricing_response;
    if (v !== null && !(VALID_PRICING_RESPONSES as readonly string[]).includes(v)) {
      return NextResponse.json({ error: 'Invalid pricing_response' }, { status: 400 });
    }
    updates.pricing_response = v;
  }
  if (body.calendar_invite_pending_update !== undefined) {
    if (typeof body.calendar_invite_pending_update !== 'boolean') {
      return NextResponse.json(
        { error: 'calendar_invite_pending_update must be boolean' },
        { status: 400 }
      );
    }
    updates.calendar_invite_pending_update = body.calendar_invite_pending_update;
  }

  if (body.confirmation_status !== undefined) {
    updates.confirmation_status = body.confirmation_status;
    // Stamp the call time if the status is moving away from pending
    if (body.confirmation_status !== 'pending') {
      updates.confirmation_called_at = new Date().toISOString();
      updates.confirmation_called_by = adminRow.id;
    }
  }

  const { error } = await admin
    .from('bookings')
    .update(updates)
    .eq('id', bookingId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
