import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { normaliseSystemeBooking } from '@/lib/webhooks/systeme/normalise';
import type { SystemeBookingPayload } from '@/lib/webhooks/systeme/types';
import { parseRadioLabel } from '@/lib/radio-parser';
import { countNoShowsSinceLastAttended } from '@/lib/bookings/no-show-count';

// Disable static analysis; this route uses runtime headers and DB writes.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function jsonError(message: string, status: number, detail?: unknown) {
  return NextResponse.json({ error: message, detail }, { status });
}

export async function POST(req: NextRequest) {
  // 1. Validate webhook secret
  const expectedSecret = process.env.SYSTEME_WEBHOOK_SECRET;
  if (!expectedSecret) {
    console.error('[systeme webhook] SYSTEME_WEBHOOK_SECRET not configured');
    return jsonError('Server misconfigured', 500);
  }

  // Read raw body once (needed for HMAC verification)
  const rawBody = await req.text();

  // Try plain shared-secret first (used by our curl tests and the radio form)
  const providedSecret =
    req.headers.get('x-webhook-secret') ??
    req.headers.get('x-systeme-secret') ??
    new URL(req.url).searchParams.get('secret');

  let authorised = false;

  if (providedSecret && providedSecret === expectedSecret) {
    authorised = true;
  } else {
    // Try HMAC signature (used by Systeme.io)
    const signatureHeader = req.headers.get('x-webhook-signature');
    if (signatureHeader) {
      const computed = createHmac('sha256', expectedSecret)
        .update(rawBody, 'utf8')
        .digest('hex');
      try {
        const a = Buffer.from(signatureHeader, 'hex');
        const b = Buffer.from(computed, 'hex');
        if (a.length === b.length && timingSafeEqual(a, b)) {
          authorised = true;
        }
      } catch {
        // Malformed signature header - leave authorised = false
      }
    }
  }

  if (!authorised) {
    console.warn('[systeme webhook] Invalid or missing signature/secret');
    return jsonError('Unauthorised', 401);
  }

  // 2. Parse payload
  let payload: SystemeBookingPayload;
  try {
    payload = JSON.parse(rawBody) as SystemeBookingPayload;
  } catch (err) {
    console.error('[systeme webhook] Failed to parse JSON', err);
    return jsonError('Invalid JSON', 400);
  }

  // 3. Validate required fields
  if (!payload?.customer?.email || !payload?.order?.id) {
    console.error('[systeme webhook] Missing required fields', payload);
    return jsonError('Missing required fields', 422);
  }

  // 4. Normalise
  const normalised = normaliseSystemeBooking(payload);
  const supabase = createAdminClient();

  try {
    // 5. Upsert attendee by email
    const { data: attendee, error: attendeeError } = await supabase
      .from('attendees')
      .upsert(
        {
          email: normalised.attendee.email,
          first_name: normalised.attendee.firstName || 'Unknown',
          last_name: normalised.attendee.lastName || 'Unknown',
          phone: normalised.attendee.phone,
          systeme_contact_id: normalised.attendee.systemeContactId,
          systeme_customer_id: normalised.attendee.systemeCustomerId,
          source: 'systeme_io',
        },
        { onConflict: 'email', ignoreDuplicates: false }
      )
      .select('id')
      .single();

    if (attendeeError || !attendee) {
      console.error('[systeme webhook] Attendee upsert failed', attendeeError);
      return jsonError('Database error (attendee)', 500, attendeeError?.message);
    }

    // 6. Check if booking already exists (idempotency)
    const { data: existingBooking } = await supabase
      .from('bookings')
      .select('id')
      .eq('external_booking_id', normalised.booking.externalBookingId)
      .maybeSingle();

    let bookingId: string;

    if (existingBooking) {
      bookingId = existingBooking.id;
      console.log('[systeme webhook] Booking already exists, idempotent return', bookingId);
    } else {
      // Check for repeat no-show pattern. The new booking doesn't exist yet,
      // so no exclusion is needed.
      let flaggedRepeat = false;
      try {
        const priorNoShows = await countNoShowsSinceLastAttended(attendee.id);
        flaggedRepeat = priorNoShows >= 2;

        if (flaggedRepeat) {
          console.warn(
            '[systeme-webhook] Flagging booking as repeat no-show pattern: attendee',
            attendee.id,
            'has',
            priorNoShows,
            'prior no-shows since last attended'
          );
        }
      } catch (err) {
        console.error('[systeme-webhook] failed to check no-show pattern, defaulting to false:', err);
      }

      const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .insert({
          booking_type: 'event_ticket',
          attendee_id: attendee.id,
          event_id: null,
          external_booking_id: normalised.booking.externalBookingId,
          external_source: 'systeme_io',
          ticket_type: normalised.booking.ticketType,
          booking_status: 'confirmed',
          confirmation_status: 'pending',
          attendance_status: 'pending',
          flagged_repeat_no_show: flaggedRepeat,
        })
        .select('id')
        .single();

      if (bookingError || !booking) {
        console.error('[systeme webhook] Booking insert failed', bookingError);
        return jsonError('Database error (booking)', 500, bookingError?.message);
      }
      bookingId = booking.id;
    }

    // After booking is created/found, try to link an event from pending selections.
    // Only attempt if booking has no event yet AND payment succeeded (this webhook fires after payment confirmation).
    if (!existingBooking) {
      // Booking was just created with event_id=NULL. Try to find a matching pending selection.
      const { data: pending } = await supabase
        .from('pending_event_selections')
        .select('id, matched_event_id, masterclass_date_label')
        .eq('email', normalised.attendee.email)
        .is('consumed_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pending) {
        // Mark consumed first to avoid double-consumption on retries.
        await supabase
          .from('pending_event_selections')
          .update({
            consumed_at: new Date().toISOString(),
            consumed_by_booking_id: bookingId,
          })
          .eq('id', pending.id);

        let eventId: string | null = pending.matched_event_id;

        // Auto-create event from radio label if possible
        if (!eventId && pending.masterclass_date_label) {
          const parsed = parseRadioLabel(pending.masterclass_date_label);

          if (parsed) {
            // Race guard: re-check for an event with this session_label
            const { data: existingRace } = await supabase
              .from('events')
              .select('id')
              .eq('session_label', pending.masterclass_date_label)
              .maybeSingle();

            if (existingRace) {
              eventId = existingRace.id;
            } else {
              const sessionDate = `${parsed.parsed_year}-${String(parsed.parsed_month).padStart(2, '0')}-${String(parsed.parsed_day).padStart(2, '0')}`;

              const { data: newEvent, error: insertErr } = await supabase
                .from('events')
                .insert({
                  session_label: pending.masterclass_date_label,
                  session_date: sessionDate,
                  start_time: parsed.start_time,
                  end_time: parsed.end_time,
                  auto_created: true,
                })
                .select('id')
                .single();

              if (insertErr) {
                // Likely a race; re-query by label
                const { data: afterRace } = await supabase
                  .from('events')
                  .select('id')
                  .eq('session_label', pending.masterclass_date_label)
                  .maybeSingle();
                eventId = afterRace?.id ?? null;
                if (!eventId) {
                  console.error(
                    `[systeme webhook] Event auto-create failed for "${pending.masterclass_date_label}"`,
                    insertErr
                  );
                }
              } else {
                eventId = newEvent.id;
                console.log(
                  `[systeme webhook] Auto-created event ${eventId} from label "${pending.masterclass_date_label}"`
                );

                // Retroactively link any other queued radio clicks for the same label
                await supabase
                  .from('pending_event_selections')
                  .update({ matched_event_id: eventId })
                  .eq('masterclass_date_label', pending.masterclass_date_label)
                  .is('matched_event_id', null);
              }
            }
          }
        }

        // Link the resolved event to the booking
        if (eventId) {
          await supabase
            .from('bookings')
            .update({ event_id: eventId })
            .eq('id', bookingId);
          console.log(
            `[systeme webhook] Linked booking ${bookingId} to event ${eventId} via pending selection`
          );
        } else {
          console.log(
            `[systeme webhook] Pending selection found for ${normalised.attendee.email} but no event matched label "${pending.masterclass_date_label}"`
          );
        }
      } else {
        console.log(
          `[systeme webhook] No pending event selection found for ${normalised.attendee.email}`
        );
      }
    }

    // Also consume any pending Typeform pre-event response for this email.
    // Requires these columns on pending_typeform_responses (run manually in Supabase):
    //   alter table pending_typeform_responses
    //     add column if not exists pre_event_masterclass_choice text,
    //     add column if not exists referral_source text,
    //     add column if not exists newsletter_consent boolean;
    if (!existingBooking) {
      const { data: pendingTypeform } = await supabase
        .from('pending_typeform_responses')
        .select('id, goals, experience_level, responsibility_level, pre_event_masterclass_choice, referral_source, newsletter_consent, created_at')
        .eq('email', normalised.attendee.email)
        .is('consumed_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pendingTypeform) {
        const enrichments: Record<string, unknown> = {};
        if (pendingTypeform.goals) enrichments.goals = pendingTypeform.goals;
        if (pendingTypeform.experience_level)
          enrichments.experience_level = pendingTypeform.experience_level;
        if (pendingTypeform.responsibility_level)
          enrichments.responsibility_level = pendingTypeform.responsibility_level;
        if (pendingTypeform.pre_event_masterclass_choice)
          enrichments.pre_event_masterclass_choice = pendingTypeform.pre_event_masterclass_choice;
        if (pendingTypeform.referral_source)
          enrichments.referral_source = pendingTypeform.referral_source;
        if (pendingTypeform.newsletter_consent !== null && pendingTypeform.newsletter_consent !== undefined) {
          enrichments.newsletter_consent = pendingTypeform.newsletter_consent;
          enrichments.newsletter_consent_at = pendingTypeform.created_at;
        }

        if (Object.keys(enrichments).length > 0) {
          await supabase
            .from('bookings')
            .update(enrichments)
            .eq('id', bookingId);
        }

        await supabase
          .from('pending_typeform_responses')
          .update({
            consumed_at: new Date().toISOString(),
            consumed_by_booking_id: bookingId,
          })
          .eq('id', pendingTypeform.id);

        console.log(
          `[systeme webhook] Enriched booking ${bookingId} from pending Typeform`
        );
      }
    }

    // 7. Check if payment already exists (idempotency)
    const { data: existingPayment } = await supabase
      .from('payments')
      .select('id')
      .eq('external_payment_id', normalised.payment.externalPaymentId)
      .maybeSingle();

    if (!existingPayment) {
      const { error: paymentError } = await supabase.from('payments').insert({
        attendee_id: attendee.id,
        booking_id: bookingId,
        external_payment_id: normalised.payment.externalPaymentId,
        amount_gross: normalised.payment.amountGross,
        currency: normalised.payment.currency,
        payment_type: 'ticket',
        status: 'succeeded',
        paid_at: normalised.payment.paidAt,
        metadata: {
          funnel_name: normalised.meta.funnelName,
          funnel_step_name: normalised.meta.funnelStepName,
          tag_name: normalised.meta.tagName,
          source_url: normalised.meta.sourceUrl,
        },
      });

      if (paymentError) {
        console.error('[systeme webhook] Payment insert failed', paymentError);
        return jsonError('Database error (payment)', 500, paymentError?.message);
      }
    }

    return NextResponse.json({
      ok: true,
      attendeeId: attendee.id,
      bookingId,
      message: existingBooking ? 'Idempotent: booking already existed' : 'Booking created',
    });
  } catch (err) {
    console.error('[systeme webhook] Unhandled error', err);
    return jsonError('Internal server error', 500, err instanceof Error ? err.message : String(err));
  }
}

// Reject anything that's not POST
export async function GET() {
  return jsonError('Method not allowed', 405);
}
