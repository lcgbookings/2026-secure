import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  formatEventDateTime,
  formatEventDate,
  formatMoney,
  labelExperienceLevel,
  labelResponsibilityLevel,
  labelReferralSource,
  labelRelevance,
  labelCoachingInterest,
  labelProgrammeStatus,
  formatRelativeTime,
} from '@/lib/format';
import CallConsoleForm, { type CallAttemptRow } from './call-console-form';
import AssignToEvent from './assign-to-event';

export const dynamic = 'force-dynamic';

export default async function CallConsolePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: bookingId } = await params;
  const supabase = createAdminClient();

  const { data: booking } = await supabase
    .from('bookings')
    .select(
      `
      id,
      external_booking_id,
      ticket_type,
      booking_status,
      confirmation_status,
      confirmation_called_at,
      attendance_status,
      goals,
      experience_level,
      responsibility_level,
      rescheduled_from_booking_id,
      programme_signup_status,
      programme_signup_at,
      next_follow_up_at,
      signed_in_at,
      is_first_session,
      referral_source,
      referral_detail,
      pre_session_confidence,
      session_value_rating,
      most_useful_insight,
      session_relevance,
      hardest_under_pressure,
      coaching_interest,
      post_session_submitted_at,
      venue_override,
      pre_event_notes,
      event_id,
      attendee:attendees!inner (
        id, first_name, last_name, email, phone, company
      ),
      event:events (
        id, session_label, start_time, end_time, venue
      ),
      payments (amount_gross, currency, paid_at, status)
    `
    )
    .eq('id', bookingId)
    .maybeSingle();

  if (!booking) notFound();

  const attendee = Array.isArray(booking.attendee)
    ? booking.attendee[0]
    : booking.attendee;
  const event = Array.isArray(booking.event) ? booking.event[0] : booking.event;
  const payment = Array.isArray(booking.payments) ? booking.payments[0] : null;

  // Upcoming events (exclude this booking's current event from reschedule list)
  const { data: upcomingEventsRaw } = await supabase
    .from('events')
    .select('id, session_label, start_time, end_time')
    .gt('end_time', new Date().toISOString())
    .order('start_time', { ascending: true });

  const upcomingEvents = (upcomingEventsRaw ?? []).filter(
    (e) => e.id !== booking.event_id
  );

  // Call history for this booking
  const { data: callAttemptsRaw } = await supabase
    .from('call_attempts')
    .select(
      `
      *,
      reschedule_to_booking:bookings!call_attempts_reschedule_to_booking_id_fkey (
        id,
        event:events ( session_label )
      )
    `
    )
    .eq('booking_id', booking.id)
    .order('created_at', { ascending: false });

  const callAttempts = (callAttemptsRaw ?? []) as unknown as CallAttemptRow[];

  // Default attempt type: derived from event timing + history
  function deriveDefaultAttemptType():
    | 'initial'
    | '24h_reminder'
    | 'stale_followup'
    | 'post_event' {
    const now = Date.now();
    const endTs = event?.end_time ? new Date(event.end_time).getTime() : null;
    const startTs = event?.start_time ? new Date(event.start_time).getTime() : null;

    if (endTs !== null && endTs < now) return 'post_event';

    const hasInitial = callAttempts.some((a) => a.attempt_type === 'initial');
    const within24h =
      startTs !== null && startTs - now <= 24 * 60 * 60 * 1000 && startTs > now;
    if (within24h && hasInitial) return '24h_reminder';

    if (callAttempts.length > 0) {
      const latestTs = new Date(callAttempts[0].created_at).getTime();
      const tenDaysMs = 10 * 24 * 60 * 60 * 1000;
      if (now - latestTs > tenDaysMs) return 'stale_followup';
    }

    return 'initial';
  }
  const defaultAttemptType = deriveDefaultAttemptType();

  // If this booking was rescheduled from another, fetch the original for the banner
  let rescheduledFrom:
    | { id: string; session_label: string | null; start_time: string | null }
    | null = null;
  if (booking.rescheduled_from_booking_id) {
    const { data: original } = await supabase
      .from('bookings')
      .select('id, event:events ( session_label, start_time )')
      .eq('id', booking.rescheduled_from_booking_id)
      .maybeSingle();
    if (original) {
      const origEvent = Array.isArray(original.event) ? original.event[0] : original.event;
      rescheduledFrom = {
        id: original.id,
        session_label: origEvent?.session_label ?? null,
        start_time: origEvent?.start_time ?? null,
      };
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={event ? `/admin/events/${event.id}` : '/admin'}
          className="text-sm text-neutral-500 hover:text-neutral-900"
        >
          ← Back
        </Link>
        <h1 className="text-2xl font-bold mt-2">
          {attendee.first_name} {attendee.last_name}
        </h1>
        <p className="text-sm text-neutral-600 mt-1">{attendee.email}</p>
        <ProgrammePill
          status={booking.programme_signup_status}
          signedUpAt={booking.programme_signup_at}
          eventEndIso={event?.end_time ?? null}
        />
        {booking.next_follow_up_at && (
          <p className="text-sm text-neutral-600 mt-2">
            ↻ Follow up due {formatRelativeTime(booking.next_follow_up_at)}
          </p>
        )}
      </div>

      {rescheduledFrom && (
        <div className="border rounded-lg p-3 bg-amber-50 border-amber-200 text-sm text-amber-900">
          ↺ This booking was rescheduled from{' '}
          <Link
            href={`/admin/bookings/${rescheduledFrom.id}`}
            className="font-medium underline hover:text-amber-700"
          >
            {rescheduledFrom.session_label ?? 'an earlier session'}
            {rescheduledFrom.start_time
              ? ` on ${formatEventDate(rescheduledFrom.start_time)}`
              : ''}
          </Link>
          .
        </div>
      )}

      {!booking.event_id && (
        <AssignToEvent
          bookingId={booking.id}
          upcomingEvents={upcomingEvents.map((e) => ({
            id: e.id,
            label: formatEventDateTime(e.start_time, e.end_time),
          }))}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1 space-y-4">
          <div className="border rounded-lg p-4 space-y-3 bg-blue-50/30">
            <h2 className="text-xs uppercase text-neutral-500">Pre-event context</h2>
            {(booking.goals || booking.experience_level || booking.responsibility_level) ? (
              <>
                {booking.goals && (
                  <div>
                    <p className="text-xs text-neutral-500">Why this is a priority</p>
                    <p className="text-sm mt-0.5">{booking.goals}</p>
                  </div>
                )}
                <Field label="Experience" value={labelExperienceLevel(booking.experience_level)} />
                <Field label="Responsibility" value={labelResponsibilityLevel(booking.responsibility_level)} />
              </>
            ) : (
              <p className="text-sm text-neutral-500 italic">
                Not yet completed the pre-event survey.
              </p>
            )}
          </div>

          {/* Sign-in card */}
          <div className="border rounded-lg p-4 space-y-3 bg-green-50/30">
            <h2 className="text-xs uppercase text-neutral-500">Sign-in</h2>
            {booking.signed_in_at ? (
              <>
                <Field label="Signed in" value={new Date(booking.signed_in_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })} />
                {booking.is_first_session !== null && (
                  <Field label="First session" value={booking.is_first_session ? 'Yes' : 'No (returning)'} />
                )}
                <Field label="Referral" value={labelReferralSource(booking.referral_source)} />
                {booking.referral_detail && (
                  <Field label="Detail" value={booking.referral_detail} />
                )}
                {typeof booking.pre_session_confidence === 'number' && (
                  <Field label="Pre-session confidence" value={`${booking.pre_session_confidence}/10`} />
                )}
              </>
            ) : (
              <p className="text-sm text-neutral-500 italic">Not yet signed in.</p>
            )}
          </div>

          {/* Post-session card */}
          <div className="border rounded-lg p-4 space-y-3 bg-purple-50/30">
            <h2 className="text-xs uppercase text-neutral-500">Post-session reflection</h2>
            {booking.post_session_submitted_at ? (
              <>
                <Field label="Submitted" value={new Date(booking.post_session_submitted_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })} />
                {typeof booking.session_value_rating === 'number' && (
                  <Field label="Value rating" value={`${booking.session_value_rating}/10`} />
                )}
                <Field label="Relevance" value={labelRelevance(booking.session_relevance)} />
                <Field label="Coaching interest" value={labelCoachingInterest(booking.coaching_interest)} />
                {booking.most_useful_insight && (
                  <div>
                    <p className="text-xs text-neutral-500">Most useful insight</p>
                    <p className="text-sm mt-0.5">{booking.most_useful_insight}</p>
                  </div>
                )}
                {booking.hardest_under_pressure && (
                  <div>
                    <p className="text-xs text-neutral-500">Hardest under pressure</p>
                    <p className="text-sm mt-0.5">{booking.hardest_under_pressure}</p>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-neutral-500 italic">Not yet submitted reflection.</p>
            )}
          </div>

          <div className="border rounded-lg p-4 space-y-3">
            <h2 className="text-xs uppercase text-neutral-500">Attendee</h2>
            <Field label="Name" value={`${attendee.first_name} ${attendee.last_name}`} />
            <Field label="Email" value={attendee.email} />
            <Field label="Phone" value={attendee.phone ?? '-'} mono />
            <Field label="Company" value={attendee.company ?? '-'} />
          </div>

          <div className="border rounded-lg p-4 space-y-3">
            <h2 className="text-xs uppercase text-neutral-500">Booking</h2>
            <Field label="Ticket" value={booking.ticket_type ?? '-'} />
            <Field
              label="Paid"
              value={
                payment
                  ? `${formatMoney(payment.amount_gross, payment.currency)} (${payment.status})`
                  : '-'
              }
            />
            <Field label="Order ID" value={booking.external_booking_id ?? '-'} mono />
            {event && (
              <Field
                label="Current event"
                value={formatEventDateTime(event.start_time, event.end_time)}
              />
            )}
          </div>
        </div>

        <div className="md:col-span-2">
          <CallConsoleForm
            bookingId={booking.id}
            initialDetails={{
              goals: booking.goals ?? '',
              experience_level: booking.experience_level ?? '',
              responsibility_level: booking.responsibility_level ?? '',
              venue_override: booking.venue_override ?? '',
              pre_event_notes: booking.pre_event_notes ?? '',
            }}
            defaultAttemptType={defaultAttemptType}
            callAttempts={callAttempts}
            upcomingEvents={upcomingEvents.map((e) => ({
              id: e.id,
              label: formatEventDateTime(e.start_time, e.end_time),
            }))}
          />
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`text-sm ${mono ? 'font-mono' : ''} mt-0.5`}>{value}</p>
    </div>
  );
}

function ProgrammePill({
  status,
  signedUpAt,
  eventEndIso,
}: {
  status: string | null;
  signedUpAt: string | null;
  eventEndIso: string | null;
}) {
  const eventHasPassed =
    eventEndIso !== null && new Date(eventEndIso).getTime() < Date.now();

  // Skip entirely if the event is still upcoming and nothing's been decided
  if (!status && !eventHasPassed) return null;

  if (status === 'signed_up') {
    const date = signedUpAt
      ? new Date(signedUpAt).toLocaleDateString('en-GB', { dateStyle: 'short' })
      : null;
    return (
      <span className="inline-block mt-2 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
        Programme: {labelProgrammeStatus(status)}
        {date ? ` · ${date}` : ''}
      </span>
    );
  }

  if (status === 'declined') {
    return (
      <span className="inline-block mt-2 px-2 py-0.5 rounded-full text-xs font-medium bg-neutral-200 text-neutral-700">
        Programme: {labelProgrammeStatus(status)}
      </span>
    );
  }

  // status null + event has passed → "To be decided"
  return (
    <span className="inline-block mt-2 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
      Programme: To be decided
    </span>
  );
}
