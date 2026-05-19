import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CALL_TYPES = [
  'pre_event',
  'pre_event_24h_reminder',
  'stale_follow_up',
  'post_event_no_show',
  'post_event_follow_up',
] as const;

const OUTCOMES = [
  'answered_confirmed',
  'answered_uncommitted',
  'answered_declined',
  'answered_rescheduled',
  'voicemail',
  'no_answer',
  'wrong_number',
  'lost_after_no_show',
  'lost_after_decline',
] as const;

type Outcome = (typeof OUTCOMES)[number];

const CONFIRMATION_MAP: Record<Outcome, string> = {
  answered_confirmed: 'confirmed',
  answered_uncommitted: 'pending',
  answered_declined: 'cancelled',
  answered_rescheduled: 'cancelled',
  voicemail: 'unreachable',
  no_answer: 'unreachable',
  wrong_number: 'unreachable',
  lost_after_no_show: 'cancelled',
  lost_after_decline: 'cancelled',
};

interface PostBody {
  call_type?: string;
  outcome?: string;
  whatsapp_video_sent?: boolean;
  notes?: string;
  reschedule_to_event_id?: string;
}

function fail(message: string, status: number, detail?: unknown) {
  return NextResponse.json({ error: message, detail }, { status });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: bookingId } = await context.params;

  // ---------- Auth ----------
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('Unauthorised', 401);

  const admin = createAdminClient();
  const { data: adminRow } = await admin
    .from('admin_users')
    .select('id, status')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!adminRow || adminRow.status !== 'active') {
    return fail('Not authorised', 403);
  }

  // ---------- Parse + validate body ----------
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return fail('Invalid JSON', 400);
  }

  const { call_type, outcome, whatsapp_video_sent, notes, reschedule_to_event_id } = body;

  if (!call_type || !(CALL_TYPES as readonly string[]).includes(call_type)) {
    return fail(
      `Invalid call_type. Must be one of: ${CALL_TYPES.join(', ')}`,
      400
    );
  }
  if (!outcome || !(OUTCOMES as readonly string[]).includes(outcome)) {
    return fail(`Invalid outcome. Must be one of: ${OUTCOMES.join(', ')}`, 400);
  }
  if (typeof whatsapp_video_sent !== 'boolean') {
    return fail('whatsapp_video_sent must be boolean', 400);
  }
  if (outcome === 'answered_rescheduled' && !reschedule_to_event_id) {
    return fail(
      'reschedule_to_event_id required when outcome is answered_rescheduled',
      400
    );
  }
  if (outcome !== 'answered_rescheduled' && reschedule_to_event_id) {
    return fail(
      'reschedule_to_event_id only allowed when outcome is answered_rescheduled',
      400
    );
  }

  console.log(
    `[call-attempts] booking=${bookingId} call_type=${call_type} outcome=${outcome} by=${adminRow.id}`
  );

  // ---------- Fetch the booking ----------
  const { data: booking, error: bookingErr } = await admin
    .from('bookings')
    .select(
      'id, attendee_id, event_id, confirmation_status, attendance_status, pricing_disclosed, pricing_response, ticket_type, external_booking_id, goals, experience_level, responsibility_level'
    )
    .eq('id', bookingId)
    .maybeSingle();

  if (bookingErr) {
    console.error('[call-attempts] booking fetch error', bookingErr);
    return fail('Database error fetching booking', 500, bookingErr.message);
  }
  if (!booking) return fail('Booking not found', 404);

  // ---------- Pricing-disclosure gate ----------
  if (outcome === 'answered_confirmed' && booking.pricing_disclosed !== true) {
    console.warn(`[call-attempts] pricing-disclosure gate blocked booking=${bookingId}`);
    return fail(
      "Pricing disclosure required before confirming. Tick the disclosure box on the call console and capture the customer's response first.",
      422
    );
  }

  // ---------- Reschedule path ----------
  let newBookingId: string | null = null;

  if (outcome === 'answered_rescheduled') {
    // Verify target event exists
    const { data: targetEvent, error: targetErr } = await admin
      .from('events')
      .select('id')
      .eq('id', reschedule_to_event_id!)
      .maybeSingle();

    if (targetErr) {
      console.error('[call-attempts] target event fetch error', targetErr);
      return fail('Database error fetching target event', 500, targetErr.message);
    }
    if (!targetEvent) return fail('Target event not found', 404);

    // ---------- Reschedule limit guard ----------
    // Count past answered_rescheduled attempts for this attendee since their last attended session.
    // "Last attended session" = the most recent booking with signed_in_at IS NOT NULL.
    const { data: lastAttended } = await admin
      .from('bookings')
      .select('signed_in_at')
      .eq('attendee_id', booking.attendee_id)
      .not('signed_in_at', 'is', null)
      .order('signed_in_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const sinceIso = lastAttended?.signed_in_at ?? '1900-01-01T00:00:00.000Z';

    // Get all booking_ids for this attendee (the FK to filter call_attempts by attendee)
    const { data: attendeeBookings, error: ablErr } = await admin
      .from('bookings')
      .select('id')
      .eq('attendee_id', booking.attendee_id);

    if (ablErr) {
      console.error('[call-attempts] attendee-bookings fetch error', ablErr);
      return fail('Database error checking reschedule history', 500, ablErr.message);
    }

    const bookingIdsForAttendee = (attendeeBookings ?? []).map((b) => b.id);

    let reschedCount = 0;
    if (bookingIdsForAttendee.length > 0) {
      const { count, error: countErr } = await admin
        .from('call_attempts')
        .select('id', { count: 'exact', head: true })
        .in('booking_id', bookingIdsForAttendee)
        .eq('outcome', 'answered_rescheduled')
        .gt('attempted_at', sinceIso);

      if (countErr) {
        console.error('[call-attempts] reschedule-count error', countErr);
        return fail('Database error checking reschedule history', 500, countErr.message);
      }
      reschedCount = count ?? 0;
    }

    if (reschedCount >= 2) {
      console.warn(
        `[call-attempts] reschedule-limit blocked booking=${bookingId} attendee=${booking.attendee_id} count=${reschedCount}`
      );
      return fail(
        'Reschedule limit reached. Customer has been rescheduled 2 times since last attendance.',
        422
      );
    }

    // ---------- Create the new booking ----------
    const { data: newBooking, error: newErr } = await admin
      .from('bookings')
      .insert({
        booking_type: 'event_ticket',
        attendee_id: booking.attendee_id,
        event_id: reschedule_to_event_id!,
        rescheduled_from_booking_id: booking.id,
        confirmation_status: 'pending',
        attendance_status: 'pending',
        ticket_type: booking.ticket_type,
        external_booking_id: null,
        pricing_disclosed: booking.pricing_disclosed,
        pricing_response: booking.pricing_response,
        goals: booking.goals,
        experience_level: booking.experience_level,
        responsibility_level: booking.responsibility_level,
        calendar_invite_pending_update: true,
        booking_status: 'confirmed',
        // Session-specific fields explicitly NULL on the new row:
        signed_in_at: null,
        post_session_submitted_at: null,
        session_value_rating: null,
        most_useful_insight: null,
        session_relevance: null,
        hardest_under_pressure: null,
        coaching_interest: null,
        referral_source: null,
        referral_detail: null,
        pre_session_confidence: null,
        is_first_session: null,
        newsletter_consent: null,
        newsletter_consent_at: null,
        pre_event_masterclass_choice: null,
      })
      .select('id')
      .single();

    if (newErr || !newBooking) {
      console.error('[call-attempts] new-booking insert error', newErr);
      return fail('Failed to create reschedule booking', 500, newErr?.message);
    }

    newBookingId = newBooking.id;
    console.log(
      `[call-attempts] reschedule created new booking=${newBookingId} from=${booking.id}`
    );

    // Flag the ORIGINAL too so its calendar invite gets revoked
    const { error: origFlagErr } = await admin
      .from('bookings')
      .update({ calendar_invite_pending_update: true })
      .eq('id', booking.id);
    if (origFlagErr) {
      console.error('[call-attempts] orig calendar-invite-flag error', origFlagErr);
      // non-fatal — the new booking is already created; keep going
    }
  }

  // ---------- Insert call_attempts row ----------
  const nowIso = new Date().toISOString();
  const { data: attempt, error: attemptErr } = await admin
    .from('call_attempts')
    .insert({
      booking_id: booking.id,
      call_type,
      outcome,
      whatsapp_video_sent,
      notes: notes ?? null,
      rescheduled_to_booking_id: newBookingId,
      attempted_by_admin_id: adminRow.id,
      attempted_at: nowIso,
    })
    .select('id')
    .single();

  if (attemptErr || !attempt) {
    console.error('[call-attempts] insert error', attemptErr);
    return fail('Failed to create call attempt', 500, attemptErr?.message);
  }

  // ---------- Update the original booking ----------
  const newConfirmationStatus = CONFIRMATION_MAP[outcome as Outcome];
  const { error: bookingUpdateErr } = await admin
    .from('bookings')
    .update({
      confirmation_status: newConfirmationStatus,
      last_contact_at: nowIso,
    })
    .eq('id', booking.id);

  if (bookingUpdateErr) {
    console.error('[call-attempts] booking update error', bookingUpdateErr);
    return fail('Failed to update booking state', 500, bookingUpdateErr.message);
  }

  console.log(
    `[call-attempts] done attempt=${attempt.id} → confirmation_status=${newConfirmationStatus}${
      newBookingId ? ` newBooking=${newBookingId}` : ''
    }`
  );

  return NextResponse.json({
    ok: true,
    attemptId: attempt.id,
    newConfirmationStatus,
    ...(newBookingId ? { newBookingId } : {}),
  });
}
