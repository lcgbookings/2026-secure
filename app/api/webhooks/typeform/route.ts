import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { normaliseTypeformPayload } from '@/lib/webhooks/typeform/normalise';
import type { TypeformWebhookPayload } from '@/lib/webhooks/typeform/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function jsonError(message: string, status: number, detail?: unknown) {
  return NextResponse.json({ error: message, detail }, { status });
}

export async function POST(req: NextRequest) {
  const expectedSecret = process.env.TYPEFORM_WEBHOOK_SECRET;
  if (!expectedSecret) {
    console.error('[typeform webhook] TYPEFORM_WEBHOOK_SECRET not configured');
    return jsonError('Server misconfigured', 500);
  }

  // Read raw body once (needed for HMAC verification)
  const rawBody = await req.text();

  // Verify Typeform-Signature: format is "sha256=<base64 hash>"
  const signatureHeader = req.headers.get('typeform-signature');

  let authorised = false;
  if (signatureHeader && signatureHeader.startsWith('sha256=')) {
    const provided = signatureHeader.slice('sha256='.length);
    const computed = createHmac('sha256', expectedSecret)
      .update(rawBody, 'utf8')
      .digest('base64');
    try {
      const a = Buffer.from(provided, 'base64');
      const b = Buffer.from(computed, 'base64');
      if (a.length === b.length && timingSafeEqual(a, b)) {
        authorised = true;
      }
    } catch {
      // Malformed - leave authorised false
    }
  }

  // Also allow plain shared-secret via query param (for our internal tests)
  if (!authorised) {
    const providedSecret = new URL(req.url).searchParams.get('secret');
    if (providedSecret === expectedSecret) {
      authorised = true;
    }
  }

  if (!authorised) {
    console.warn('[typeform webhook] Invalid or missing signature');
    return jsonError('Unauthorised', 401);
  }

  // Parse
  let payload: TypeformWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as TypeformWebhookPayload;
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  // Skip non-form_response events (Typeform also fires partial_response sometimes)
  if (payload.event_type && payload.event_type !== 'form_response') {
    return NextResponse.json({ ok: true, skipped: payload.event_type });
  }

  const normalised = normaliseTypeformPayload(payload);

  if (!normalised.email) {
    console.warn('[typeform webhook] No email in response', { token: normalised.response_token });
    return jsonError('No email in response', 422);
  }

  if (!normalised.response_token) {
    return jsonError('Missing response token', 422);
  }

  const supabase = createAdminClient();

  // Try to find an existing booking for this email
  const { data: existingAttendee } = await supabase
    .from('attendees')
    .select('id')
    .eq('email', normalised.email)
    .maybeSingle();

  if (existingAttendee) {
    // Find the most recent booking for this attendee
    const { data: existingBooking } = await supabase
      .from('bookings')
      .select('id')
      .eq('attendee_id', existingAttendee.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingBooking) {
      // Update booking directly. Don't overwrite existing non-null values.
      const { data: currentBooking } = await supabase
        .from('bookings')
        .select('goals, experience_level, responsibility_level')
        .eq('id', existingBooking.id)
        .single();

      const updates: Record<string, unknown> = {};
      if (normalised.goals && !currentBooking?.goals) {
        updates.goals = normalised.goals;
      }
      if (normalised.experience_level && !currentBooking?.experience_level) {
        updates.experience_level = normalised.experience_level;
      }
      if (normalised.responsibility_level && !currentBooking?.responsibility_level) {
        updates.responsibility_level = normalised.responsibility_level;
      }

      if (Object.keys(updates).length > 0) {
        await supabase
          .from('bookings')
          .update(updates)
          .eq('id', existingBooking.id);
        console.log(
          `[typeform webhook] Enriched booking ${existingBooking.id} for ${normalised.email}`
        );
      }

      return NextResponse.json({
        ok: true,
        bookingId: existingBooking.id,
        message: 'Booking enriched',
      });
    }
  }

  // No booking yet - store as pending. Idempotent on response_token.
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  const { data: pending, error: pendingError } = await supabase
    .from('pending_typeform_responses')
    .upsert(
      {
        email: normalised.email,
        form_id: normalised.form_id,
        response_token: normalised.response_token,
        goals: normalised.goals,
        experience_level: normalised.experience_level,
        responsibility_level: normalised.responsibility_level,
        raw_payload: payload as unknown as Record<string, unknown>,
        expires_at: expiresAt,
      },
      { onConflict: 'response_token', ignoreDuplicates: false }
    )
    .select('id')
    .single();

  if (pendingError) {
    console.error('[typeform webhook] Failed to store pending response', pendingError);
    return jsonError('Database error', 500, pendingError.message);
  }

  console.log(
    `[typeform webhook] Stored pending response ${pending.id} for ${normalised.email}`
  );
  return NextResponse.json({
    ok: true,
    pendingId: pending.id,
    message: 'Stored, no booking yet',
  });
}

export async function GET() {
  return jsonError('Method not allowed', 405);
}
