import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';
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
import CallConsoleForm, {
  type CallAttemptRow,
  type PricingResponse,
  type MasterclassOutcome,
} from './call-console-form';
import AssignToEvent from './assign-to-event';
import DataPrivacySection from './data-privacy-section';
import { countNoShowsSinceLastAttended } from '@/lib/bookings/no-show-count';

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
      pricing_disclosed,
      pricing_response,
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
      masterclass_outcome,
      masterclass_outcome_at,
      newsletter_consent,
      newsletter_consent_at,
      attendee:attendees!inner (
        id, first_name, last_name, email, phone, company, anonymised_at
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

  const { data: upcomingEventsRaw } = await supabase
    .from('events')
    .select('id, session_label, start_time, end_time')
    .eq('status', 'scheduled')
    .gt('start_time', new Date().toISOString())
    .order('start_time', { ascending: true });

  const upcomingEvents = (upcomingEventsRaw ?? []).filter(
    (e) => e.id !== booking.event_id
  );

  const { data: callAttemptsRaw } = await supabase
    .from('call_attempts')
    .select(
      `
      *,
      rescheduled_to_booking:bookings!call_attempts_rescheduled_to_booking_id_fkey (
        id,
        event:events ( session_label )
      )
    `
    )
    .eq('booking_id', booking.id)
    .order('attempted_at', { ascending: false });

  const callAttempts = (callAttemptsRaw ?? []) as unknown as CallAttemptRow[];

  const { data: adminUsersRaw } = await supabase
    .from('admin_users')
    .select('id, full_name');
  const adminUsers = (adminUsersRaw ?? []).map((a) => ({
    id: a.id as string,
    full_name: (a.full_name as string | null) ?? 'Unknown',
  }));

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

  const priorNoShowCount = await countNoShowsSinceLastAttended(attendee.id, booking.id);

  // Current admin's role — used to gate the anonymise control.
  // Same auth_user_id lookup pattern as app/admin/layout.tsx.
  const sessionClient = await createClient();
  const {
    data: { user: authUser },
  } = await sessionClient.auth.getUser();
  let isSuperAdmin = false;
  if (authUser) {
    const { data: currentAdmin } = await supabase
      .from('admin_users')
      .select('role')
      .eq('auth_user_id', authUser.id)
      .maybeSingle();
    isSuperAdmin = currentAdmin?.role === 'super_admin';
  }

  const hasPreEvent = !!(
    booking.goals ||
    booking.experience_level ||
    booking.responsibility_level
  );
  const hasReflection = !!booking.post_session_submitted_at;
  const signedIn = !!booking.signed_in_at;

  const backHref = event ? `/admin/cohorts/${event.id}` : '/admin';

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <header className="mb-6">
        <Link
          href={backHref}
          className="text-sm text-lcg-body-muted hover:text-lcg-deep-teal mb-2 inline-block"
        >
          ← Back
        </Link>
        <h1 className="font-serif text-3xl text-lcg-deep-teal">
          {attendee.first_name} {attendee.last_name}
        </h1>
        <p className="text-sm text-lcg-body-muted mt-1">{attendee.email}</p>
        <ProgrammePill
          status={booking.programme_signup_status}
          signedUpAt={booking.programme_signup_at}
          eventEndIso={event?.end_time ?? null}
        />
        {booking.next_follow_up_at && (
          <p className="text-sm text-lcg-body-muted mt-2">
            ↻ Follow up due {formatRelativeTime(booking.next_follow_up_at)}
          </p>
        )}
      </header>

      {rescheduledFrom && (
        <div className="flex items-center gap-2 text-sm text-lcg-body-muted bg-lcg-blue-tint border border-lcg-blue/30 rounded-xl px-4 py-2">
          <span className="text-lcg-blue text-lg">↺</span>
          <span>
            This booking was rescheduled from{' '}
            <Link
              href={`/admin/bookings/${rescheduledFrom.id}`}
              className="font-medium text-lcg-deep-teal hover:text-lcg-teal"
            >
              {rescheduledFrom.session_label ?? 'an earlier session'}
              {rescheduledFrom.start_time
                ? ` on ${formatEventDate(rescheduledFrom.start_time)}`
                : ''}
            </Link>
            .
          </span>
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

      {priorNoShowCount >= 2 && (
        <div className="lcg-card border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <div className="text-amber-700 text-xl leading-none mt-0.5">⚠</div>
            <div>
              <p className="font-semibold text-amber-900 text-sm">
                Repeat no-show pattern detected
              </p>
              <p className="text-sm text-amber-800 mt-1">
                This customer has {priorNoShowCount} prior no-show
                {priorNoShowCount === 1 ? '' : 's'} since their last attended session. They will not receive the no-show recovery email sequence if they no-show again. Consider whether to engage on this call.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ContextCard
          title="Pre-event context"
          empty={!hasPreEvent}
          emptyMessage="Not yet completed the pre-event survey."
        >
          {booking.goals && (
            <Field label="Why this is a priority" value={booking.goals} />
          )}
          <Field label="Experience" value={labelExperienceLevel(booking.experience_level)} />
          <Field
            label="Responsibility"
            value={labelResponsibilityLevel(booking.responsibility_level)}
          />
        </ContextCard>

        <ContextCard
          title="Sign-in"
          empty={!signedIn}
          emptyMessage="Not yet signed in."
        >
          <Field
            label="Signed in"
            value={
              booking.signed_in_at
                ? new Date(booking.signed_in_at).toLocaleString('en-GB', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })
                : '-'
            }
          />
          {booking.is_first_session !== null && (
            <Field
              label="First session"
              value={booking.is_first_session ? 'Yes' : 'No (returning)'}
            />
          )}
          <Field label="Referral" value={labelReferralSource(booking.referral_source)} />
          {booking.referral_detail && (
            <Field label="Detail" value={booking.referral_detail} />
          )}
          {typeof booking.pre_session_confidence === 'number' && (
            <Field
              label="Pre-session confidence"
              value={`${booking.pre_session_confidence}/10`}
            />
          )}
        </ContextCard>

        <ContextCard
          title="Post-session reflection"
          empty={!hasReflection}
          emptyMessage="Not yet submitted reflection."
        >
          <Field
            label="Submitted"
            value={
              booking.post_session_submitted_at
                ? new Date(booking.post_session_submitted_at).toLocaleString('en-GB', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })
                : '-'
            }
          />
          {typeof booking.session_value_rating === 'number' && (
            <Field label="Value rating" value={`${booking.session_value_rating}/10`} />
          )}
          <Field label="Relevance" value={labelRelevance(booking.session_relevance)} />
          <Field
            label="Coaching interest"
            value={labelCoachingInterest(booking.coaching_interest)}
          />
          {booking.most_useful_insight && (
            <Field label="Most useful insight" value={booking.most_useful_insight} />
          )}
          {booking.hardest_under_pressure && (
            <Field label="Hardest under pressure" value={booking.hardest_under_pressure} />
          )}
        </ContextCard>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="lcg-card p-5">
          <div className="lcg-eyebrow mb-3 text-lcg-deep-teal/60">Attendee</div>
          <div className="space-y-3 text-sm">
            <Field label="Name" value={`${attendee.first_name} ${attendee.last_name}`} />
            <Field label="Email" value={attendee.email ?? '-'} />
            <Field label="Phone" value={attendee.phone ?? '-'} mono />
            <Field label="Company" value={attendee.company ?? '-'} />
          </div>
        </div>

        <div className="lcg-card p-5">
          <div className="lcg-eyebrow mb-3 text-lcg-deep-teal/60">Booking</div>
          <div className="space-y-3 text-sm">
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
      </div>

      <CallConsoleForm
        bookingId={booking.id}
        initialPricing={{
          pricing_disclosed: booking.pricing_disclosed ?? false,
          pricing_response: (booking.pricing_response ?? null) as PricingResponse | null,
        }}
        initialDetails={{
          goals: booking.goals ?? '',
          experience_level: booking.experience_level ?? '',
          responsibility_level: booking.responsibility_level ?? '',
          venue_override: booking.venue_override ?? '',
          pre_event_notes: booking.pre_event_notes ?? '',
        }}
        callAttempts={callAttempts}
        upcomingEvents={upcomingEvents.map((e) => ({
          id: e.id,
          label: formatEventDateTime(e.start_time, e.end_time),
        }))}
        adminUsers={adminUsers}
        eventHasEnded={
          !!event?.end_time && new Date(event.end_time).getTime() < Date.now()
        }
        initialMasterclassOutcome={
          (booking.masterclass_outcome ?? null) as MasterclassOutcome | null
        }
        initialMasterclassOutcomeAt={booking.masterclass_outcome_at ?? null}
      />

      <DataPrivacySection
        attendeeId={attendee.id}
        attendeeFirstName={attendee.first_name ?? 'this attendee'}
        isSuperAdmin={isSuperAdmin}
        anonymisedAt={attendee.anonymised_at ?? null}
        newsletterConsent={booking.newsletter_consent ?? null}
        newsletterConsentAt={booking.newsletter_consent_at ?? null}
      />
    </div>
  );
}

function ContextCard({
  title,
  empty,
  emptyMessage,
  children,
}: {
  title: string;
  empty?: boolean;
  emptyMessage: string;
  children: ReactNode;
}) {
  return (
    <div className="lcg-card p-5">
      <div className="lcg-eyebrow mb-3 text-lcg-deep-teal/60">{title}</div>
      {empty ? (
        <p className="text-sm text-lcg-body-muted italic">{emptyMessage}</p>
      ) : (
        <div className="space-y-3 text-sm">{children}</div>
      )}
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
      <div className="text-xs text-lcg-body-muted uppercase tracking-wide">{label}</div>
      <div className={`text-lcg-body mt-0.5 ${mono ? 'font-mono' : ''}`}>{value}</div>
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

  return (
    <span className="inline-block mt-2 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
      Programme: To be decided
    </span>
  );
}
