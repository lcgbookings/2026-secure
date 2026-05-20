import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function slug(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'unknown';
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: attendeeId } = await context.params;

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

  const { data: attendee, error: attendeeErr } = await admin
    .from('attendees')
    .select('*')
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

  const { data: bookings } = await admin
    .from('bookings')
    .select('*, event:events ( session_label, start_time, venue )')
    .eq('attendee_id', attendeeId)
    .order('created_at', { ascending: true });

  const bookingRows = bookings ?? [];
  const bookingIds = bookingRows.map((b) => b.id as string);

  let callAttempts: Array<Record<string, unknown>> = [];
  if (bookingIds.length > 0) {
    const { data: calls } = await admin
      .from('call_attempts')
      .select('*')
      .in('booking_id', bookingIds)
      .order('attempted_at', { ascending: true });
    callAttempts = (calls ?? []) as Array<Record<string, unknown>>;
  }

  const attemptsByBooking = new Map<string, Array<Record<string, unknown>>>();
  for (const c of callAttempts) {
    const bid = c.booking_id as string | null;
    if (!bid) continue;
    const arr = attemptsByBooking.get(bid) ?? [];
    arr.push(c);
    attemptsByBooking.set(bid, arr);
  }

  let radioClicks: Array<Record<string, unknown>> = [];
  const email = (attendee as { email?: string | null }).email ?? null;
  if (email) {
    const { data } = await admin
      .from('pending_event_selections')
      .select('*')
      .eq('email', email);
    radioClicks = (data ?? []) as Array<Record<string, unknown>>;
  }

  const bookingsOut = bookingRows.map((b) => ({
    ...b,
    call_attempts: attemptsByBooking.get(b.id as string) ?? [],
  }));

  const newsletterConsent =
    (attendee as { newsletter_consent?: boolean | null }).newsletter_consent ?? null;
  const newsletterConsentAt =
    (attendee as { newsletter_consent_at?: string | null }).newsletter_consent_at ?? null;

  const payload = {
    generated_at: new Date().toISOString(),
    generated_for_dsar: true,
    attendee,
    bookings: bookingsOut,
    radio_clicks: radioClicks,
    consent: {
      newsletter_consent: newsletterConsent,
      newsletter_consent_at: newsletterConsentAt,
    },
    note: "This file contains all personal data held by Leadership Communication Group's Events Hub for this individual, produced in response to a data subject access request.",
  };

  const today = new Date().toISOString().slice(0, 10);
  const first = (attendee as { first_name?: string | null }).first_name ?? null;
  const last = (attendee as { last_name?: string | null }).last_name ?? null;
  const filename = `dsar-${slug(first)}-${slug(last)}-${today}.json`;

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
