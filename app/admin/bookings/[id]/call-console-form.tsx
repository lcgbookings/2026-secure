'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// ---------- types ----------
export type CallType =
  | 'pre_event'
  | 'pre_event_24h_reminder'
  | 'stale_follow_up'
  | 'post_event_no_show'
  | 'post_event_follow_up';

export type Outcome =
  | 'answered_confirmed'
  | 'answered_uncommitted'
  | 'answered_declined'
  | 'answered_rescheduled'
  | 'voicemail'
  | 'no_answer'
  | 'wrong_number'
  | 'lost_after_no_show'
  | 'lost_after_decline';

export type PricingResponse =
  | 'open_to_invest'
  | 'not_in_position'
  | 'undecided'
  | 'not_asked';

export interface CallAttemptRow {
  id: string;
  call_type: CallType;
  outcome: Outcome;
  notes: string | null;
  whatsapp_video_sent: boolean;
  rescheduled_to_booking_id: string | null;
  attempted_by_admin_id: string | null;
  attempted_at: string;
  rescheduled_to_booking?: {
    id: string;
    event?: { session_label?: string } | { session_label?: string }[] | null;
  } | null;
}

interface Props {
  bookingId: string;
  initialPricing: {
    pricing_disclosed: boolean;
    pricing_response: PricingResponse | null;
  };
  initialDetails: {
    goals: string;
    experience_level: string;
    responsibility_level: string;
    venue_override: string;
    pre_event_notes: string;
  };
  callAttempts: CallAttemptRow[];
  upcomingEvents: Array<{ id: string; label: string }>;
  adminUsers: Array<{ id: string; full_name: string }>;
}

const CALL_TYPE_LABELS: Record<CallType, string> = {
  pre_event: 'Pre-event call',
  pre_event_24h_reminder: '24-hour reminder',
  stale_follow_up: '10-day follow-up',
  post_event_no_show: 'Post-event no-show recovery',
  post_event_follow_up: 'Post-event follow-up',
};

const OUTCOME_LABELS: Record<Outcome, string> = {
  answered_confirmed: 'Confirmed',
  answered_uncommitted: 'Uncommitted (needs another call)',
  answered_declined: 'Declined',
  answered_rescheduled: 'Rescheduled',
  voicemail: 'Voicemail',
  no_answer: 'No answer',
  wrong_number: 'Wrong number',
  lost_after_no_show: 'Lost after no-show',
  lost_after_decline: 'Lost after decline',
};

const PRICING_RESPONSE_OPTIONS: Array<{ value: PricingResponse; label: string }> = [
  { value: 'open_to_invest', label: 'Open to investing' },
  { value: 'not_in_position', label: 'Not in a position' },
  { value: 'undecided', label: 'Undecided' },
  { value: 'not_asked', label: 'Not asked yet' },
];

const OUTCOME_BADGE: Record<Outcome, string> = {
  answered_confirmed: 'bg-green-100 text-green-800',
  answered_uncommitted: 'bg-amber-100 text-amber-800',
  answered_declined: 'bg-red-100 text-red-800',
  answered_rescheduled: 'bg-lcg-blue-tint text-lcg-blue',
  voicemail: 'bg-amber-100 text-amber-800',
  no_answer: 'bg-amber-100 text-amber-800',
  wrong_number: 'bg-red-100 text-red-800',
  lost_after_no_show: 'bg-red-100 text-red-800',
  lost_after_decline: 'bg-red-100 text-red-800',
};

const INPUT_CLASSES =
  'w-full border border-lcg-deep-teal/15 rounded-lg px-3 py-2 bg-white text-sm focus:outline-none focus:border-lcg-teal focus:ring-1 focus:ring-lcg-teal/20';

export default function CallConsoleForm({
  bookingId,
  initialPricing,
  initialDetails,
  callAttempts,
  upcomingEvents,
  adminUsers,
}: Props) {
  const router = useRouter();

  // ---------- pricing (immediate-save) ----------
  const [pricingDisclosed, setPricingDisclosed] = useState(initialPricing.pricing_disclosed);
  const [pricingResponse, setPricingResponse] = useState<PricingResponse>(
    initialPricing.pricing_response ?? 'not_asked'
  );
  const [pricingStatus, setPricingStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [pricingError, setPricingError] = useState('');

  async function patchPricing(updates: {
    pricing_disclosed?: boolean;
    pricing_response?: PricingResponse;
  }) {
    setPricingStatus('saving');
    setPricingError('');
    const res = await fetch(`/api/bookings/${bookingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      setPricingStatus('idle');
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setPricingStatus('error');
      setPricingError(body.error ?? 'Save failed');
    }
  }

  async function handleDisclosureChange(next: boolean) {
    setPricingDisclosed(next);
    await patchPricing({ pricing_disclosed: next });
  }
  async function handlePricingResponseChange(next: PricingResponse) {
    setPricingResponse(next);
    await patchPricing({ pricing_response: next });
  }

  // ---------- call attempt ----------
  const [callType, setCallType] = useState<CallType>('pre_event');
  const [outcome, setOutcome] = useState<Outcome | ''>('');
  const [rescheduleEventId, setRescheduleEventId] = useState('');
  const [whatsappSent, setWhatsappSent] = useState(false);
  const [attemptNotes, setAttemptNotes] = useState('');
  const [attemptStatus, setAttemptStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle'
  );
  const [attemptError, setAttemptError] = useState('');

  const disableReason: string | null = (() => {
    if (outcome === 'answered_confirmed' && !pricingDisclosed) {
      return 'Tick the pricing disclosure box first';
    }
    if (outcome === 'answered_rescheduled' && !rescheduleEventId) {
      return 'Select an event to reschedule to';
    }
    return null;
  })();

  async function submitAttempt(e: React.FormEvent) {
    e.preventDefault();
    setAttemptError('');
    if (!outcome) {
      setAttemptError('Pick an outcome.');
      return;
    }
    if (disableReason) {
      setAttemptError(disableReason);
      return;
    }

    setAttemptStatus('saving');
    const payload: Record<string, unknown> = {
      call_type: callType,
      outcome,
      whatsapp_video_sent: whatsappSent,
      notes: attemptNotes.trim() || undefined,
    };
    if (outcome === 'answered_rescheduled') {
      payload.reschedule_to_event_id = rescheduleEventId;
    }

    const res = await fetch(`/api/bookings/${bookingId}/call-attempts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const body = await res.json();
      setAttemptStatus('saved');
      setCallType('pre_event');
      setOutcome('');
      setRescheduleEventId('');
      setWhatsappSent(false);
      setAttemptNotes('');
      router.refresh();
      setTimeout(() => setAttemptStatus('idle'), 2000);
      if (body.newBookingId) {
        router.push(`/admin/bookings/${body.newBookingId}`);
      }
    } else {
      const body = await res.json().catch(() => ({}));
      setAttemptStatus('error');
      setAttemptError(body.error ?? 'Save failed');
    }
  }

  // ---------- booking details ----------
  const [details, setDetails] = useState(initialDetails);
  const [detailsStatus, setDetailsStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle'
  );
  const [detailsError, setDetailsError] = useState('');

  async function submitDetails(e: React.FormEvent) {
    e.preventDefault();
    setDetailsStatus('saving');
    setDetailsError('');
    const res = await fetch(`/api/bookings/${bookingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(details),
    });
    if (res.ok) {
      setDetailsStatus('saved');
      router.refresh();
      setTimeout(() => setDetailsStatus('idle'), 2000);
    } else {
      const body = await res.json().catch(() => ({}));
      setDetailsStatus('error');
      setDetailsError(body.error ?? 'Save failed');
    }
  }

  const adminNameById = new Map(adminUsers.map((a) => [a.id, a.full_name]));
  const attemptDisabled = attemptStatus === 'saving' || !!disableReason || !outcome;

  return (
    <div className="space-y-6">
      {/* ---------- SECTION 1: PRICING QUALIFIER ---------- */}
      <section className="lcg-card-dark p-6 bg-lcg-deep-teal/95">
        <div className="lcg-eyebrow text-lcg-blue mb-1">Pricing qualifier</div>
        <h2 className="font-serif text-xl text-lcg-cream mb-4">
          Disclose before you confirm
        </h2>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={pricingDisclosed}
            onChange={(e) => handleDisclosureChange(e.target.checked)}
            disabled={pricingStatus === 'saving'}
            className="mt-1 accent-lcg-teal"
          />
          <span className="text-sm text-lcg-cream/90">
            I disclosed that the full programme pricing will be shared at the session.
          </span>
        </label>

        <fieldset
          className={`mt-5 ${!pricingDisclosed ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <legend className="text-xs text-lcg-cream/60 uppercase tracking-wide mb-2">
            Customer response to pricing disclosure
          </legend>
          <div className="flex flex-wrap gap-2">
            {PRICING_RESPONSE_OPTIONS.map((opt) => {
              const selected = pricingResponse === opt.value;
              return (
                <label
                  key={opt.value}
                  className={`px-3 py-1.5 rounded-lg text-sm cursor-pointer border transition ${
                    selected
                      ? 'bg-lcg-teal text-lcg-deep-teal border-lcg-teal'
                      : 'bg-transparent text-lcg-cream border-lcg-cream/30 hover:border-lcg-cream/60'
                  }`}
                >
                  <input
                    type="radio"
                    name="pricing-response"
                    value={opt.value}
                    className="sr-only"
                    checked={selected}
                    onChange={() => handlePricingResponseChange(opt.value)}
                    disabled={!pricingDisclosed || pricingStatus === 'saving'}
                  />
                  {opt.label}
                </label>
              );
            })}
          </div>
        </fieldset>

        <p className="mt-3 text-xs text-lcg-cream/50">
          The pricing disclosure must be ticked before this booking can be marked Confirmed.
        </p>

        {pricingError && (
          <p className="mt-3 text-sm text-red-200">{pricingError}</p>
        )}
      </section>

      {/* ---------- SECTION 2: LOG A CALL ATTEMPT ---------- */}
      <form onSubmit={submitAttempt} className="lcg-card p-6 space-y-5">
        <div>
          <div className="lcg-eyebrow mb-1 text-lcg-deep-teal/60">Call workflow</div>
          <h2 className="font-serif text-xl text-lcg-deep-teal">Log a call attempt</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-lcg-body-muted uppercase tracking-wide mb-1">
              Call type
            </label>
            <select
              value={callType}
              onChange={(e) => setCallType(e.target.value as CallType)}
              className={INPUT_CLASSES}
            >
              {(Object.keys(CALL_TYPE_LABELS) as CallType[]).map((c) => (
                <option key={c} value={c}>
                  {CALL_TYPE_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-lcg-body-muted uppercase tracking-wide mb-1">
              Outcome
            </label>
            <select
              value={outcome}
              onChange={(e) => {
                const v = e.target.value as Outcome | '';
                setOutcome(v);
                if (v !== 'answered_rescheduled') setRescheduleEventId('');
              }}
              className={INPUT_CLASSES}
            >
              <option value="">Select an outcome...</option>
              <optgroup label="Answered">
                <option value="answered_confirmed">Confirmed</option>
                <option value="answered_uncommitted">Uncommitted (needs another call)</option>
                <option value="answered_declined">Declined</option>
                <option value="answered_rescheduled">Rescheduled</option>
              </optgroup>
              <optgroup label="Did not answer">
                <option value="voicemail">Voicemail</option>
                <option value="no_answer">No answer</option>
                <option value="wrong_number">Wrong number</option>
              </optgroup>
              <optgroup label="Lost">
                <option value="lost_after_no_show">Lost after no-show</option>
                <option value="lost_after_decline">Lost after decline</option>
              </optgroup>
            </select>
          </div>
        </div>

        {outcome === 'answered_rescheduled' && (
          <div>
            <label className="block text-xs text-lcg-body-muted uppercase tracking-wide mb-1">
              Reschedule to event
            </label>
            <select
              value={rescheduleEventId}
              onChange={(e) => setRescheduleEventId(e.target.value)}
              className={INPUT_CLASSES}
              required
            >
              <option value="">Pick an event...</option>
              {upcomingEvents.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-lcg-body">
          <input
            type="checkbox"
            checked={whatsappSent}
            onChange={(e) => setWhatsappSent(e.target.checked)}
            className="accent-lcg-teal"
          />
          WhatsApp video sent
        </label>

        <div>
          <label className="block text-xs text-lcg-body-muted uppercase tracking-wide mb-1">
            Call notes
          </label>
          <textarea
            value={attemptNotes}
            onChange={(e) => setAttemptNotes(e.target.value)}
            rows={3}
            className={INPUT_CLASSES}
            placeholder="Anything worth recording from this call."
          />
        </div>

        {attemptError && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {attemptError}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={attemptDisabled}
            title={disableReason ?? undefined}
            className={
              attemptDisabled
                ? 'inline-flex items-center justify-center rounded-lg bg-lcg-teal px-4 py-2 text-sm font-semibold text-lcg-deep-teal opacity-40 cursor-not-allowed'
                : 'lcg-btn-primary'
            }
          >
            {attemptStatus === 'saving' ? 'Logging...' : 'Log call attempt'}
          </button>
          {attemptStatus === 'saved' && (
            <span className="text-sm text-lcg-teal">Logged.</span>
          )}
        </div>
      </form>

      {/* ---------- SECTION 3: UPDATE BOOKING DETAILS ---------- */}
      <form onSubmit={submitDetails} className="lcg-card p-6 space-y-5">
        <div>
          <div className="lcg-eyebrow mb-1 text-lcg-deep-teal/60">Booking details</div>
          <h2 className="font-serif text-xl text-lcg-deep-teal">Update booking context</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-lcg-body-muted uppercase tracking-wide mb-1">
              Experience
            </label>
            <select
              value={details.experience_level}
              onChange={(e) =>
                setDetails({ ...details, experience_level: e.target.value })
              }
              className={INPUT_CLASSES}
            >
              <option value="">Not captured</option>
              <option value="under_1">Less than 1 year</option>
              <option value="1_to_3">1 to 3 years</option>
              <option value="3_to_5">3 to 5 years</option>
              <option value="5_plus">5+ years</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-lcg-body-muted uppercase tracking-wide mb-1">
              Responsibility
            </label>
            <select
              value={details.responsibility_level}
              onChange={(e) =>
                setDetails({ ...details, responsibility_level: e.target.value })
              }
              className={INPUT_CLASSES}
            >
              <option value="">Not captured</option>
              <option value="influence_strategy">Influences leadership/strategy</option>
              <option value="manage_teams">Manages teams + external rep</option>
              <option value="aspiring_leader">Aspiring to leadership</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs text-lcg-body-muted uppercase tracking-wide mb-1">
            Goals
          </label>
          <textarea
            value={details.goals}
            onChange={(e) => setDetails({ ...details, goals: e.target.value })}
            rows={3}
            className={INPUT_CLASSES}
            placeholder="What does this person want to achieve?"
          />
        </div>

        <div>
          <label className="block text-xs text-lcg-body-muted uppercase tracking-wide mb-1">
            Venue note (optional)
          </label>
          <input
            type="text"
            value={details.venue_override}
            onChange={(e) => setDetails({ ...details, venue_override: e.target.value })}
            placeholder="Only if different from event venue"
            className={INPUT_CLASSES}
          />
        </div>

        <div>
          <label className="block text-xs text-lcg-body-muted uppercase tracking-wide mb-1">
            Pre-event notes
          </label>
          <textarea
            value={details.pre_event_notes}
            onChange={(e) => setDetails({ ...details, pre_event_notes: e.target.value })}
            rows={3}
            className={INPUT_CLASSES}
            placeholder="Anything else worth recording."
          />
        </div>

        {detailsStatus === 'error' && detailsError && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {detailsError}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={detailsStatus === 'saving'}
            className={
              detailsStatus === 'saving'
                ? 'inline-flex items-center justify-center rounded-lg border border-lcg-deep-teal/20 bg-white px-4 py-2 text-sm font-medium text-lcg-deep-teal opacity-40 cursor-not-allowed'
                : 'lcg-btn-secondary'
            }
          >
            {detailsStatus === 'saving' ? 'Saving...' : 'Update booking details'}
          </button>
          {detailsStatus === 'saved' && (
            <span className="text-sm text-lcg-teal">Saved.</span>
          )}
        </div>
      </form>

      {/* ---------- SECTION 4: CALL HISTORY ---------- */}
      <section className="lcg-card p-6">
        <h2 className="font-serif text-xl text-lcg-deep-teal mb-4">
          Call history{' '}
          <span className="text-base text-lcg-body-muted font-sans font-normal">
            ({callAttempts.length} attempt{callAttempts.length === 1 ? '' : 's'})
          </span>
        </h2>

        {callAttempts.length === 0 ? (
          <p className="text-sm text-lcg-body-muted italic">No calls logged yet.</p>
        ) : (
          <ul className="divide-y divide-lcg-deep-teal/10">
            {callAttempts.map((a) => (
              <HistoryRow key={a.id} attempt={a} adminNameById={adminNameById} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  return (
    <span
      className={`inline-block ${OUTCOME_BADGE[outcome]} text-xs font-medium px-2 py-0.5 rounded`}
    >
      {OUTCOME_LABELS[outcome] ?? outcome}
    </span>
  );
}

function HistoryRow({
  attempt,
  adminNameById,
}: {
  attempt: CallAttemptRow;
  adminNameById: Map<string, string>;
}) {
  const date = new Date(attempt.attempted_at).toLocaleString('en-GB', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  const adminName = attempt.attempted_by_admin_id
    ? adminNameById.get(attempt.attempted_by_admin_id) ?? 'Unknown'
    : 'Unknown';
  const reschedEvent = Array.isArray(attempt.rescheduled_to_booking?.event)
    ? attempt.rescheduled_to_booking?.event[0]
    : attempt.rescheduled_to_booking?.event;
  const reschedLabel = reschedEvent?.session_label ?? null;
  const note = attempt.notes ?? '';
  const truncated = note.length > 200 ? `${note.slice(0, 200)}…` : note;

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className="text-sm font-medium text-lcg-deep-teal">
          {CALL_TYPE_LABELS[attempt.call_type] ?? attempt.call_type}
        </span>
        <OutcomeBadge outcome={attempt.outcome} />
        <span className="text-xs text-lcg-body-muted">
          {date} · {adminName}
        </span>
        {attempt.whatsapp_video_sent && (
          <span className="text-xs text-lcg-teal">✓ WhatsApp video</span>
        )}
      </div>
      {truncated && (
        <p className="text-sm text-lcg-body mt-1 whitespace-pre-wrap">{truncated}</p>
      )}
      {attempt.rescheduled_to_booking_id && (
        <Link
          href={`/admin/bookings/${attempt.rescheduled_to_booking_id}`}
          className="text-xs text-lcg-blue hover:underline mt-1 inline-block"
        >
          Rescheduled to → {reschedLabel ?? 'new booking'}
        </Link>
      )}
    </li>
  );
}
