import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: attendeeId } = await context.params;

  // 1. Auth — must be authenticated AND super_admin
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: adminRow } = await admin
    .from('admin_users')
    .select('id, role, status')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!adminRow || adminRow.status !== 'active' || adminRow.role !== 'super_admin') {
    return NextResponse.json(
      { error: 'Erasure requires super_admin. Contact Gordon.' },
      { status: 403 }
    );
  }

  // Optional body
  let body: { reason?: string } = {};
  try {
    const raw = await req.text();
    if (raw) body = JSON.parse(raw) as { reason?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // 2. Fetch attendee
  const { data: attendee, error: attendeeErr } = await admin
    .from('attendees')
    .select('id, email, anonymised_at')
    .eq('id', attendeeId)
    .maybeSingle();

  if (attendeeErr) {
    return NextResponse.json(
      { error: 'Database error', detail: attendeeErr.message },
      { status: 500 }
    );
  }
  if (!attendee) {
    return NextResponse.json({ error: 'Attendee not found' }, { status: 404 });
  }

  // 3. Already anonymised?
  if ((attendee as { anonymised_at: string | null }).anonymised_at) {
    return NextResponse.json(
      { error: 'This attendee has already been anonymised.' },
      { status: 409 }
    );
  }

  // 4. Hash original email for the audit log
  const originalEmail = (attendee as { email: string | null }).email ?? '';
  const emailHash = createHash('sha256')
    .update(originalEmail.toLowerCase().trim())
    .digest('hex');

  // 5. Capture bookings affected
  const { data: bookings } = await admin
    .from('bookings')
    .select('id')
    .eq('attendee_id', attendeeId);

  const bookingIds = (bookings ?? []).map((b) => b.id as string);
  const bookingsAffected = bookingIds.length;

  const nowIso = new Date().toISOString();

  // 6. Anonymise attendee (legally critical)
  const { error: attendeeUpdateErr } = await admin
    .from('attendees')
    .update({
      first_name: 'Anonymised',
      last_name: 'User',
      email: `anonymised+${attendeeId}@deleted.invalid`,
      phone: null,
      company: null,
      anonymised_at: nowIso,
    })
    .eq('id', attendeeId);

  if (attendeeUpdateErr) {
    return NextResponse.json(
      { error: 'Failed to anonymise attendee', detail: attendeeUpdateErr.message },
      { status: 500 }
    );
  }

  // 7. Anonymise free-text fields on bookings
  if (bookingIds.length > 0) {
    const { error: bookingsUpdateErr } = await admin
      .from('bookings')
      .update({
        goals: null,
        most_useful_insight: null,
        hardest_under_pressure: null,
        pre_event_notes: null,
        referral_detail: null,
      })
      .in('id', bookingIds);

    if (bookingsUpdateErr) {
      // Attendee record is already anonymised. Surface the error but don't pretend
      // the request fully succeeded — partial state needs investigation.
      return NextResponse.json(
        {
          error: 'Attendee anonymised, but failed to scrub bookings',
          detail: bookingsUpdateErr.message,
          bookingsAffected: 0,
        },
        { status: 500 }
      );
    }
  }

  // 8. Audit log — best-effort. A log failure must NOT undo the erasure.
  const { error: logErr } = await admin.from('data_erasure_log').insert({
    attendee_id: attendeeId,
    attendee_email_hash: emailHash,
    erased_by_admin_id: adminRow.id,
    reason: body.reason ?? null,
    bookings_affected: bookingsAffected,
  });
  if (logErr) {
    console.error('[anonymise] erasure complete but audit log write failed', {
      attendeeId,
      error: logErr.message,
    });
  }

  // 9. Done
  return NextResponse.json({ ok: true, bookingsAffected });
}
