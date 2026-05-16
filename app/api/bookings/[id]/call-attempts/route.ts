import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ATTEMPT_TYPES = ['initial', '24h_reminder', 'stale_followup', 'post_event'] as const;
const OUTCOMES = [
  'answered_confirmed',
  'answered_uncommitted',
  'answered_declined',
  'voicemail',
  'bad_number',
  'rescheduled',
  'lost_after_no_show',
  'lost_after_decline',
  'signed_up_for_programme',
  'programme_declined',
  'follow_up_requested',
] as const;
const POST_EVENT_ONLY_OUTCOMES = [
  'lost_after_no_show',
  'lost_after_decline',
  'signed_up_for_programme',
  'programme_declined',
] as const;

interface PostBody {
  attempt_type?: string;
  outcome?: string;
  notes?: string;
  whatsapp_video_sent?: boolean;
  reschedule_to_event_id?: string;
  follow_up_at?: string;
}

const CONFIRMATION_MAP: Record<string, string> = {
  answered_confirmed: 'confirmed',
  answered_uncommitted: 'pending',
  answered_declined: 'cancelled',
  voicemail: 'unreachable',
  bad_number: 'unreachable',
};

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: bookingId } = await context.params;

  // Auth
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

  // Parse + validate
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const {
    attempt_type,
    outcome,
    notes,
    whatsapp_video_sent,
    reschedule_to_event_id,
    follow_up_at,
  } = body;

  if (!attempt_type || !(ATTEMPT_TYPES as readonly string[]).includes(attempt_type)) {
    return NextResponse.json({ error: 'Invalid attempt_type' }, { status: 400 });
  }
  if (!outcome || !(OUTCOMES as readonly string[]).includes(outcome)) {
    return NextResponse.json({ error: 'Invalid outcome' }, { status: 400 });
  }
  if (
    attempt_type !== 'post_event' &&
    (POST_EVENT_ONLY_OUTCOMES as readonly string[]).includes(outcome)
  ) {
    return NextResponse.json(
      { error: 'This outcome is only valid for post_event attempts' },
      { status: 400 }
    );
  }
  if (outcome === 'rescheduled' && !reschedule_to_event_id) {
    return NextResponse.json(
      { error: 'reschedule_to_event_id required when outcome is rescheduled' },
      { status: 400 }
    );
  }
  if (outcome !== 'rescheduled' && reschedule_to_event_id) {
    return NextResponse.json(
      { error: 'reschedule_to_event_id only allowed when outcome is rescheduled' },
      { status: 400 }
    );
  }
  // follow_up_at gating
  let followUpIso: string | null = null;
  if (outcome === 'follow_up_requested') {
    if (!follow_up_at) {
      return NextResponse.json(
        { error: 'follow_up_at required when outcome is follow_up_requested' },
        { status: 400 }
      );
    }
    const parsed = new Date(follow_up_at);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: 'Invalid follow_up_at date' }, { status: 400 });
    }
    followUpIso = parsed.toISOString();
  } else if (follow_up_at) {
    return NextResponse.json(
      { error: 'follow_up_at only allowed when outcome is follow_up_requested' },
      { status: 400 }
    );
  }

  // Fetch the original booking
  const { data: origBooking, error: origErr } = await admin
    .from('bookings')
    .select(
      'id, attendee_id, event_id, ticket_type, goals, experience_level, responsibility_level, pre_event_masterclass_choice, referral_source, newsletter_consent, newsletter_consent_at, event:events ( end_time )'
    )
    .eq('id', bookingId)
    .maybeSingle();

  if (origErr || !origBooking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  let newBookingId: string | null = null;

  // === RESCHEDULE PATH ===
  if (outcome === 'rescheduled') {
    // Verify target event exists and is in the future
    const { data: targetEvent } = await admin
      .from('events')
      .select('id, end_time')
      .eq('id', reschedule_to_event_id!)
      .maybeSingle();

    if (!targetEvent) {
      return NextResponse.json({ error: 'Target event not found' }, { status: 400 });
    }
    if (new Date(targetEvent.end_time).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Target event has already ended' }, { status: 400 });
    }

    // Create the new booking
    const { data: newBooking, error: newErr } = await admin
      .from('bookings')
      .insert({
        booking_type: 'event_ticket',
        attendee_id: origBooking.attendee_id,
        event_id: reschedule_to_event_id!,
        external_booking_id: null,
        ticket_type: origBooking.ticket_type,
        booking_status: 'confirmed',
        confirmation_status: 'pending',
        attendance_status: 'pending',
        rescheduled_from_booking_id: origBooking.id,
        calendar_invite_pending_update: true,
        goals: origBooking.goals,
        experience_level: origBooking.experience_level,
        responsibility_level: origBooking.responsibility_level,
        pre_event_masterclass_choice: origBooking.pre_event_masterclass_choice,
        referral_source: origBooking.referral_source,
        newsletter_consent: origBooking.newsletter_consent,
        newsletter_consent_at: origBooking.newsletter_consent_at,
      })
      .select('id')
      .single();

    if (newErr || !newBooking) {
      return NextResponse.json(
        { error: 'Failed to create reschedule booking', detail: newErr?.message },
        { status: 500 }
      );
    }
    newBookingId = newBooking.id;

    // If the original event already passed, mark the original as no_show
    const origEvent = Array.isArray(origBooking.event) ? origBooking.event[0] : origBooking.event;
    if (origEvent?.end_time && new Date(origEvent.end_time).getTime() < Date.now()) {
      await admin
        .from('bookings')
        .update({ attendance_status: 'no_show' })
        .eq('id', origBooking.id);
    }
  }

  // Insert the call_attempts row (on the ORIGINAL booking always)
  const { data: attempt, error: attemptErr } = await admin
    .from('call_attempts')
    .insert({
      booking_id: origBooking.id,
      attempt_type,
      outcome,
      notes: notes ?? null,
      whatsapp_video_sent: whatsapp_video_sent === true,
      reschedule_to_booking_id: newBookingId,
      attempted_by: adminRow.id,
    })
    .select('*')
    .single();

  if (attemptErr || !attempt) {
    return NextResponse.json(
      { error: 'Failed to create call attempt', detail: attemptErr?.message },
      { status: 500 }
    );
  }

  // Sync the booking's denormalised state
  if (outcome === 'lost_after_no_show' || outcome === 'lost_after_decline') {
    await admin
      .from('bookings')
      .update({ no_show_lost_at: new Date().toISOString() })
      .eq('id', origBooking.id);
  } else if (outcome === 'signed_up_for_programme') {
    await admin
      .from('bookings')
      .update({
        programme_signup_status: 'signed_up',
        programme_signup_at: new Date().toISOString(),
        next_follow_up_at: null,
      })
      .eq('id', origBooking.id);
  } else if (outcome === 'programme_declined') {
    await admin
      .from('bookings')
      .update({
        programme_signup_status: 'declined',
        programme_signup_at: new Date().toISOString(),
        next_follow_up_at: null,
      })
      .eq('id', origBooking.id);
  } else if (outcome === 'follow_up_requested') {
    await admin
      .from('bookings')
      .update({ next_follow_up_at: followUpIso })
      .eq('id', origBooking.id);
  } else if (outcome !== 'rescheduled') {
    const newConfirmation = CONFIRMATION_MAP[outcome];
    const update: Record<string, unknown> = { next_follow_up_at: null };
    if (newConfirmation) {
      update.confirmation_status = newConfirmation;
      update.confirmation_called_at = new Date().toISOString();
      update.confirmation_called_by = adminRow.id;
    }
    await admin.from('bookings').update(update).eq('id', origBooking.id);
  }

  return NextResponse.json({
    ok: true,
    attempt,
    newBookingId,
  });
}
