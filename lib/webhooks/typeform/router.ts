import { createAdminClient } from '@/lib/supabase/admin';
import type { TypeformWebhookPayload } from './types';
import { normalisePreEventPayload } from './normalise-pre-event';
import { normaliseSigninPayload } from './normalise-signin';
import { normalisePostSessionPayload } from './normalise-post-session';

const FORM_PRE_EVENT = 'u9Xgavse';
const FORM_PRE_EVENT_LEGACY = 'DCTXrUnR';
const FORM_SIGNIN = 'q1H28ZpT';
const FORM_POST_SESSION = 'taq9E9Mt';

export type RouteResult =
  | { status: 'enriched'; bookingId: string; formType: string }
  | { status: 'pending'; pendingId: string; formType: string }
  | { status: 'skipped'; reason: string };

export async function routeAndProcess(
  payload: TypeformWebhookPayload,
  rawPayload: unknown
): Promise<RouteResult> {
  const formId = payload.form_response?.form_id ?? '';

  if (formId === FORM_PRE_EVENT || formId === FORM_PRE_EVENT_LEGACY) {
    return processPreEvent(payload, rawPayload);
  } else if (formId === FORM_SIGNIN) {
    return processSignin(payload, rawPayload);
  } else if (formId === FORM_POST_SESSION) {
    return processPostSession(payload, rawPayload);
  }

  return { status: 'skipped', reason: `Unknown form_id: ${formId}` };
}

async function findLatestBookingForEmail(email: string) {
  const supabase = createAdminClient();
  const { data: attendee } = await supabase
    .from('attendees')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (!attendee) return null;

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, goals, experience_level, responsibility_level, pre_event_masterclass_choice, referral_source, newsletter_consent, signed_in_at, post_session_submitted_at, attendance_status')
    .eq('attendee_id', attendee.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return booking;
}

async function processPreEvent(
  payload: TypeformWebhookPayload,
  rawPayload: unknown
): Promise<RouteResult> {
  const normalised = normalisePreEventPayload(payload);

  if (!normalised.email) {
    return { status: 'skipped', reason: 'No email in pre-event response' };
  }

  const supabase = createAdminClient();
  const booking = await findLatestBookingForEmail(normalised.email);

  if (booking) {
    const updates: Record<string, unknown> = {};
    if (normalised.goals && !booking.goals) updates.goals = normalised.goals;
    if (normalised.experience_level && !booking.experience_level)
      updates.experience_level = normalised.experience_level;
    if (normalised.responsibility_level && !booking.responsibility_level)
      updates.responsibility_level = normalised.responsibility_level;
    if (normalised.pre_event_masterclass_choice && !booking.pre_event_masterclass_choice)
      updates.pre_event_masterclass_choice = normalised.pre_event_masterclass_choice;
    if (normalised.referral_source && !booking.referral_source)
      updates.referral_source = normalised.referral_source;
    if (normalised.newsletter_consent !== null && booking.newsletter_consent === null) {
      updates.newsletter_consent = normalised.newsletter_consent;
      updates.newsletter_consent_at = normalised.submitted_at;
    }

    if (Object.keys(updates).length > 0) {
      await supabase.from('bookings').update(updates).eq('id', booking.id);
    }
    return { status: 'enriched', bookingId: booking.id, formType: 'pre_event' };
  }

  // No booking - store as pending (30 days)
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: pending } = await supabase
    .from('pending_typeform_responses')
    .upsert(
      {
        email: normalised.email,
        form_id: normalised.form_id,
        response_token: normalised.response_token,
        goals: normalised.goals,
        experience_level: normalised.experience_level,
        responsibility_level: normalised.responsibility_level,
        pre_event_masterclass_choice: normalised.pre_event_masterclass_choice,
        referral_source: normalised.referral_source,
        newsletter_consent: normalised.newsletter_consent,
        raw_payload: rawPayload as Record<string, unknown>,
        expires_at: expiresAt,
      },
      { onConflict: 'response_token', ignoreDuplicates: false }
    )
    .select('id')
    .single();

  return { status: 'pending', pendingId: pending?.id ?? '', formType: 'pre_event' };
}

async function processSignin(
  payload: TypeformWebhookPayload,
  rawPayload: unknown
): Promise<RouteResult> {
  const normalised = normaliseSigninPayload(payload);

  if (!normalised.email) {
    return { status: 'skipped', reason: 'No email in sign-in response' };
  }

  const supabase = createAdminClient();
  const booking = await findLatestBookingForEmail(normalised.email);

  if (booking) {
    const updates: Record<string, unknown> = {
      signed_in_at: normalised.submitted_at,
    };
    if (booking.attendance_status === 'pending') {
      updates.attendance_status = 'attended';
    }
    if (normalised.is_first_session !== null) updates.is_first_session = normalised.is_first_session;
    if (normalised.referral_source) updates.referral_source = normalised.referral_source;
    if (normalised.referral_detail) updates.referral_detail = normalised.referral_detail;
    if (typeof normalised.pre_session_confidence === 'number')
      updates.pre_session_confidence = normalised.pre_session_confidence;

    await supabase.from('bookings').update(updates).eq('id', booking.id);
    return { status: 'enriched', bookingId: booking.id, formType: 'signin' };
  }

  // No booking yet - shouldn't happen for sign-in (they should have paid first)
  // but store as pending in case email mismatch needs correcting later.
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: pending } = await supabase
    .from('pending_typeform_responses')
    .upsert(
      {
        email: normalised.email,
        form_id: normalised.form_id,
        response_token: normalised.response_token,
        raw_payload: rawPayload as Record<string, unknown>,
        expires_at: expiresAt,
      },
      { onConflict: 'response_token', ignoreDuplicates: false }
    )
    .select('id')
    .single();

  return { status: 'pending', pendingId: pending?.id ?? '', formType: 'signin' };
}

async function processPostSession(
  payload: TypeformWebhookPayload,
  rawPayload: unknown
): Promise<RouteResult> {
  const normalised = normalisePostSessionPayload(payload);

  if (!normalised.email) {
    return { status: 'skipped', reason: 'No email in post-session response' };
  }

  const supabase = createAdminClient();
  const booking = await findLatestBookingForEmail(normalised.email);

  if (booking) {
    const updates: Record<string, unknown> = {
      post_session_submitted_at: normalised.submitted_at,
    };
    if (booking.attendance_status === 'pending') {
      updates.attendance_status = 'attended';
    }
    if (typeof normalised.session_value_rating === 'number')
      updates.session_value_rating = normalised.session_value_rating;
    if (normalised.most_useful_insight) updates.most_useful_insight = normalised.most_useful_insight;
    if (normalised.session_relevance) updates.session_relevance = normalised.session_relevance;
    if (normalised.hardest_under_pressure)
      updates.hardest_under_pressure = normalised.hardest_under_pressure;
    if (normalised.coaching_interest) updates.coaching_interest = normalised.coaching_interest;

    await supabase.from('bookings').update(updates).eq('id', booking.id);
    return { status: 'enriched', bookingId: booking.id, formType: 'post_session' };
  }

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: pending } = await supabase
    .from('pending_typeform_responses')
    .upsert(
      {
        email: normalised.email,
        form_id: normalised.form_id,
        response_token: normalised.response_token,
        raw_payload: rawPayload as Record<string, unknown>,
        expires_at: expiresAt,
      },
      { onConflict: 'response_token', ignoreDuplicates: false }
    )
    .select('id')
    .single();

  return { status: 'pending', pendingId: pending?.id ?? '', formType: 'post_session' };
}
