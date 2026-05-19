import { createHmac } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { countNoShowsSinceLastAttended } from '@/lib/bookings/no-show-count';
import { buildBookingPayload } from '@/lib/webhooks/outbound/booking-payload';

export async function fireNoShowRecoveryWebhook(bookingId: string): Promise<{
  fired: boolean;
  reason?: string;
  error?: string;
}> {
  const url = process.env.ZAPIER_NO_SHOW_WEBHOOK_URL;
  if (!url) {
    console.log('[no-show-webhook] URL not configured, skipping for booking', bookingId);
    return { fired: false, reason: 'webhook URL not configured' };
  }

  const secret = process.env.ZAPIER_NO_SHOW_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[no-show-webhook] secret not configured for booking', bookingId);
    return { fired: false, reason: 'webhook secret not configured' };
  }

  const admin = createAdminClient();

  const { data: booking } = await admin
    .from('bookings')
    .select('id, attendee_id, attendance_status, no_show_recovery_webhook_fired_at')
    .eq('id', bookingId)
    .maybeSingle();

  if (!booking) {
    return { fired: false, reason: 'booking not found' };
  }

  if (booking.no_show_recovery_webhook_fired_at) {
    return {
      fired: false,
      reason: `already fired at ${booking.no_show_recovery_webhook_fired_at}`,
    };
  }

  if (booking.attendance_status !== 'no_show') {
    return {
      fired: false,
      reason: `booking is not a no-show (status: ${booking.attendance_status})`,
    };
  }

  const noShowCount = await countNoShowsSinceLastAttended(booking.attendee_id);
  if (noShowCount >= 3) {
    console.log(
      `[no-show-webhook] suppressed for booking ${bookingId}: attendee has ${noShowCount} no-shows including this one`
    );
    await admin
      .from('bookings')
      .update({ no_show_recovery_webhook_fired_at: new Date().toISOString() })
      .eq('id', bookingId);
    return { fired: false, reason: `suppressed: ${noShowCount} prior no-shows` };
  }

  const built = await buildBookingPayload(bookingId);
  if (!built.success) {
    console.error(
      `[no-show-webhook] failed to build payload for booking ${bookingId}: ${built.reason}`
    );
    return { fired: false, reason: built.reason };
  }

  const payload = { ...built.payload, event_type: 'booking.no_show_recorded' };
  const bodyString = JSON.stringify(payload);
  const signature = 'sha256=' + createHmac('sha256', secret).update(bodyString).digest('hex');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  let res: Response | null = null;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature': signature,
        'User-Agent': 'LCG-Events-Hub/1.0',
      },
      body: bodyString,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const e = err as Error;
    const errMsg = e.name === 'AbortError' ? 'timeout after 8s' : e.message ?? 'fetch failed';
    console.error(`[no-show-webhook] failed for booking ${bookingId}: ${errMsg}`);
    return { fired: false, error: errMsg };
  }
  clearTimeout(timeoutId);

  if (res.ok) {
    await admin
      .from('bookings')
      .update({ no_show_recovery_webhook_fired_at: new Date().toISOString() })
      .eq('id', bookingId);
    console.log(`[no-show-webhook] fired for booking ${bookingId} → ${res.status}`);
    return { fired: true };
  }

  const errMsg = `HTTP ${res.status}`;
  console.error(`[no-show-webhook] failed for booking ${bookingId}: ${errMsg}`);
  return { fired: false, error: errMsg };
}
