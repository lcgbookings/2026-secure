import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  formatEventDateTime,
  formatMoney,
  labelExperienceLevel,
  labelResponsibilityLevel,
  labelReferralSource,
  labelRelevance,
  labelCoachingInterest,
} from '@/lib/format';
import CallConsoleForm from './call-console-form';

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

  // List of upcoming events so Abel can assign one if missing
  const { data: events } = await supabase
    .from('events')
    .select('id, session_label, start_time, end_time')
    .gte('end_time', new Date().toISOString())
    .order('start_time', { ascending: true });

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
      </div>

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
            initial={{
              event_id: booking.event_id,
              confirmation_status: booking.confirmation_status,
              goals: booking.goals ?? '',
              experience_level: booking.experience_level ?? '',
              responsibility_level: booking.responsibility_level ?? '',
              venue_override: booking.venue_override ?? '',
              pre_event_notes: booking.pre_event_notes ?? '',
            }}
            events={(events ?? []).map((e) => ({
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
