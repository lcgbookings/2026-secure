import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { findEventIdForLabel, parseFullEventLabel } from '@/lib/webhooks/event-matching';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RadioPayload {
  masterclass_date?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
}

function jsonError(message: string, status: number, detail?: unknown) {
  return NextResponse.json({ error: message, detail }, { status });
}

export async function POST(req: NextRequest) {
  // Validate secret
  const expectedSecret = process.env.SYSTEME_WEBHOOK_SECRET;
  if (!expectedSecret) {
    console.error('[systeme-radio] SYSTEME_WEBHOOK_SECRET not configured');
    return jsonError('Server misconfigured', 500);
  }

  const providedSecret =
    req.headers.get('x-webhook-secret') ??
    new URL(req.url).searchParams.get('secret');

  if (providedSecret !== expectedSecret) {
    console.warn('[systeme-radio] Invalid or missing secret');
    return jsonError('Unauthorised', 401);
  }

  // Parse payload
  let payload: RadioPayload;
  try {
    payload = (await req.json()) as RadioPayload;
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  // Required fields
  if (!payload.email || !payload.masterclass_date) {
    return jsonError('Missing required fields (email, masterclass_date)', 422);
  }

  const email = payload.email.trim().toLowerCase();
  const label = payload.masterclass_date.trim();

  const supabase = createAdminClient();

  // Resolve to event_id (best-effort; if no match, try to auto-create a draft event from the label)
  let matchedEventId = await findEventIdForLabel(label);

  if (!matchedEventId) {
    const parseResult = parseFullEventLabel(label);

    if (parseResult.success) {
      const { candidate } = parseResult;

      const insertPayload = {
        session_label: candidate.session_label,
        session_date: candidate.session_date,
        start_time: candidate.start_time,
        end_time: candidate.end_time,
        location: candidate.location,
        venue: null,
        status: 'draft',
        auto_created: true,
      };
      console.log(
        '[systeme-radio] Attempting upsert with payload:',
        JSON.stringify(insertPayload)
      );

      const { data: insertedEvent, error: upsertError } = await supabase
        .from('events')
        .upsert(insertPayload, { onConflict: 'session_label', ignoreDuplicates: true })
        .select('id')
        .maybeSingle();

      if (upsertError) {
        console.error(
          '[systeme-radio] Upsert error:',
          upsertError.code,
          upsertError.message,
          upsertError.details
        );
      }
      console.log(
        '[systeme-radio] Upsert returned:',
        insertedEvent ? `id=${insertedEvent.id}` : 'null'
      );

      if (insertedEvent) {
        matchedEventId = insertedEvent.id;
        console.log(
          '[systeme-radio] Auto-created draft event from radio:',
          label,
          '→ event_id:',
          matchedEventId
        );
      } else {
        // Conflict path: another request created this event concurrently. Re-fetch.
        const { data: existingEvent, error: refetchError } = await supabase
          .from('events')
          .select('id')
          .eq('session_label', candidate.session_label)
          .maybeSingle();

        if (refetchError) {
          console.error(
            '[systeme-radio] Re-fetch error:',
            refetchError.code,
            refetchError.message
          );
        }

        if (existingEvent) {
          matchedEventId = existingEvent.id;
          console.log(
            '[systeme-radio] Race recovered, found existing event:',
            candidate.session_label,
            '→',
            matchedEventId
          );
        } else {
          console.error(
            '[systeme-radio] Upsert returned null and re-fetch also failed for label:',
            candidate.session_label
          );
        }
      }
    } else {
      console.warn(
        '[systeme-radio] Radio click for unparseable label:',
        label,
        '— reason:',
        parseResult.reason
      );
    }
  }

  // Expire 1 hour from now
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('pending_event_selections')
    .insert({
      email,
      masterclass_date_label: label,
      matched_event_id: matchedEventId,
      first_name: (payload.first_name ?? '').trim() || null,
      last_name: (payload.last_name ?? '').trim() || null,
      phone: (payload.phone ?? '').trim() || null,
      raw_payload: payload as unknown as Record<string, unknown>,
      expires_at: expiresAt,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[systeme-radio] Insert failed', error);
    return jsonError('Database error', 500, error.message);
  }

  return NextResponse.json({
    ok: true,
    pendingId: data.id,
    matchedEventId,
    message: matchedEventId
      ? 'Stored, matched to event'
      : 'Stored, no event match yet',
  });
}

export async function GET() {
  return jsonError('Method not allowed', 405);
}
