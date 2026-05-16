import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { routeAndProcess } from '@/lib/webhooks/typeform/router';
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

  const result = await routeAndProcess(payload, payload);

  if (result.status === 'skipped') {
    return NextResponse.json({ ok: true, skipped: result.reason });
  } else if (result.status === 'enriched') {
    return NextResponse.json({
      ok: true,
      bookingId: result.bookingId,
      formType: result.formType,
      message: 'Booking enriched',
    });
  } else {
    return NextResponse.json({
      ok: true,
      pendingId: result.pendingId,
      formType: result.formType,
      message: 'Stored, no booking yet',
    });
  }
}

export async function GET() {
  return jsonError('Method not allowed', 405);
}
