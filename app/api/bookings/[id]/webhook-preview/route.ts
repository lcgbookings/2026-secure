import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildBookingPayload } from '@/lib/webhooks/outbound/booking-payload';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: bookingId } = await context.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  const result = await buildBookingPayload(bookingId);
  if (!result.success) {
    if (result.reason === 'booking not found') {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }
    return NextResponse.json(
      { error: 'Database error', detail: result.reason },
      { status: 500 }
    );
  }

  return NextResponse.json(result.payload);
}
