import { createAdminClient } from '@/lib/supabase/admin';
import { fireNoShowRecoveryWebhook } from '@/lib/webhooks/outbound/no-show-recovery';

// Idempotent maintenance jobs that used to run on every dashboard load.
// Now invoked from /admin/today, which is the primary admin landing surface.
//   1. Auto-flip 'pending' attendance to 'no_show' for sessions that ended 6h+ ago.
//   2. Fire the no-show recovery webhook for any no-show booking that hasn't had
//      its webhook fired yet (filtered by no_show_recovery_webhook_fired_at).
export async function runTodayMaintenance(): Promise<void> {
  const supabase = createAdminClient();
  const sixHoursAgoIso = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  try {
    const { data: endedEvents } = await supabase
      .from('events')
      .select('id')
      .eq('status', 'scheduled')
      .lt('end_time', sixHoursAgoIso);

    const endedIds = (endedEvents ?? []).map((e) => e.id);
    if (endedIds.length > 0) {
      const { error: autoFlipError } = await supabase
        .from('bookings')
        .update({ attendance_status: 'no_show' })
        .eq('confirmation_status', 'confirmed')
        .eq('attendance_status', 'pending')
        .is('signed_in_at', null)
        .is('post_session_submitted_at', null)
        .in('event_id', endedIds);

      if (autoFlipError) {
        console.error('[today auto-flip] update failed', autoFlipError);
      }
    }
  } catch (err) {
    console.error('[today auto-flip] threw', err);
  }

  try {
    const { data: pendingWebhookBookings } = await supabase
      .from('bookings')
      .select('id')
      .eq('attendance_status', 'no_show')
      .is('no_show_recovery_webhook_fired_at', null);

    if (pendingWebhookBookings && pendingWebhookBookings.length > 0) {
      for (const booking of pendingWebhookBookings) {
        try {
          await fireNoShowRecoveryWebhook(booking.id);
        } catch (err) {
          console.error('[today pending-webhook] failed for', booking.id, err);
        }
      }
    }
  } catch (err) {
    console.error('[today pending-webhook] outer error', err);
  }
}
