'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { labelAttemptType, labelOutcome } from '@/lib/format';

type AttemptType = 'initial' | '24h_reminder' | 'stale_followup' | 'post_event';
type Outcome =
  | 'answered_confirmed'
  | 'answered_uncommitted'
  | 'answered_declined'
  | 'voicemail'
  | 'bad_number'
  | 'rescheduled'
  | 'lost_after_no_show'
  | 'lost_after_decline'
  | 'signed_up_for_programme'
  | 'programme_declined'
  | 'follow_up_requested';

const POST_EVENT_ONLY: ReadonlySet<Outcome> = new Set<Outcome>([
  'lost_after_no_show',
  'lost_after_decline',
  'signed_up_for_programme',
  'programme_declined',
]);

const BASE_OUTCOMES: Array<{ value: Outcome; label: string }> = [
  { value: 'answered_confirmed', label: 'Answered — confirmed' },
  { value: 'answered_uncommitted', label: 'Answered — uncommitted' },
  { value: 'answered_declined', label: 'Answered — declined' },
  { value: 'voicemail', label: 'Voicemail / no answer' },
  { value: 'bad_number', label: 'Bad number' },
  { value: 'rescheduled', label: 'Rescheduled to another session' },
  { value: 'follow_up_requested', label: 'Follow-up requested' },
];

const POST_EVENT_OUTCOMES: Array<{ value: Outcome; label: string }> = [
  { value: 'lost_after_no_show', label: "Lost — no-show, won't reschedule" },
  { value: 'lost_after_decline', label: 'Lost — declined to reschedule' },
  { value: 'signed_up_for_programme', label: 'Signed up for programme' },
  { value: 'programme_declined', label: 'Declined programme' },
];

function oneWeekFromTodayIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD for <input type="date">
}

export interface CallAttemptRow {
  id: string;
  attempt_type: AttemptType;
  outcome: Outcome;
  notes: string | null;
  whatsapp_video_sent: boolean;
  reschedule_to_booking_id: string | null;
  created_at: string;
  reschedule_to_booking?: {
    id: string;
    event?: { session_label?: string } | { session_label?: string }[] | null;
  } | null;
}

interface Props {
  bookingId: string;
  initialDetails: {
    goals: string;
    experience_level: string;
    responsibility_level: string;
    venue_override: string;
    pre_event_notes: string;
  };
  defaultAttemptType: AttemptType;
  callAttempts: CallAttemptRow[];
  upcomingEvents: Array<{ id: string; label: string }>;
}

export default function CallConsoleForm({
  bookingId,
  initialDetails,
  defaultAttemptType,
  callAttempts,
  upcomingEvents,
}: Props) {
  const router = useRouter();

  // ---------- Customer details form ----------
  const [details, setDetails] = useState(initialDetails);
  const [detailsStatus, setDetailsStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [detailsError, setDetailsError] = useState('');

  async function saveDetails(e: React.FormEvent) {
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

  // ---------- Log a call attempt form ----------
  const [attemptType, setAttemptType] = useState<AttemptType>(defaultAttemptType);
  const [outcome, setOutcome] = useState<Outcome | ''>('');
  const [attemptNotes, setAttemptNotes] = useState('');
  const [whatsappSent, setWhatsappSent] = useState(false);
  const [rescheduleToEventId, setRescheduleToEventId] = useState('');
  const [followUpDate, setFollowUpDate] = useState(oneWeekFromTodayIso());
  const [attemptStatus, setAttemptStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [attemptError, setAttemptError] = useState('');

  const visibleOutcomes =
    attemptType === 'post_event' ? [...BASE_OUTCOMES, ...POST_EVENT_OUTCOMES] : BASE_OUTCOMES;

  async function saveAttempt(e: React.FormEvent) {
    e.preventDefault();
    setAttemptError('');

    if (!outcome) {
      setAttemptError('Please pick an outcome.');
      return;
    }
    if (outcome === 'rescheduled' && !rescheduleToEventId) {
      setAttemptError('Pick a session to reschedule to.');
      return;
    }
    if (outcome === 'follow_up_requested' && !followUpDate) {
      setAttemptError('Pick a follow-up date.');
      return;
    }

    setAttemptStatus('saving');
    const payload: Record<string, unknown> = {
      attempt_type: attemptType,
      outcome,
      notes: attemptNotes.trim() || null,
      whatsapp_video_sent: whatsappSent,
    };
    if (outcome === 'rescheduled') {
      payload.reschedule_to_event_id = rescheduleToEventId;
    }
    if (outcome === 'follow_up_requested') {
      payload.follow_up_at = new Date(followUpDate).toISOString();
    }

    const res = await fetch(`/api/bookings/${bookingId}/call-attempts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const body = await res.json();
      setAttemptStatus('saved');
      // Reset form fields
      setOutcome('');
      setAttemptNotes('');
      setWhatsappSent(false);
      setRescheduleToEventId('');
      setFollowUpDate(oneWeekFromTodayIso());
      router.refresh();
      setTimeout(() => setAttemptStatus('idle'), 2000);
      // If rescheduled, send the user to the new booking
      if (body.newBookingId) {
        router.push(`/admin/bookings/${body.newBookingId}`);
      }
    } else {
      const body = await res.json().catch(() => ({}));
      setAttemptStatus('error');
      setAttemptError(body.error ?? 'Save failed');
    }
  }

  return (
    <div className="space-y-6">
      {/* --- Customer details form --- */}
      <form onSubmit={saveDetails} className="border rounded-lg p-5 space-y-5">
        <div>
          <h2 className="text-xs uppercase text-neutral-500 mb-1">Customer details</h2>
          <p className="text-sm text-neutral-600">
            Per-booking metadata captured from this attendee.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Experience</label>
            <select
              value={details.experience_level}
              onChange={(e) => setDetails({ ...details, experience_level: e.target.value })}
              className="w-full px-3 py-2 border rounded-md text-sm bg-white"
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
            <label className="block text-sm font-medium mb-1">Responsibility</label>
            <select
              value={details.responsibility_level}
              onChange={(e) => setDetails({ ...details, responsibility_level: e.target.value })}
              className="w-full px-3 py-2 border rounded-md text-sm bg-white"
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
          <label className="block text-sm font-medium mb-1">Goals</label>
          <textarea
            value={details.goals}
            onChange={(e) => setDetails({ ...details, goals: e.target.value })}
            rows={3}
            placeholder="What does this person want to achieve?"
            className="w-full px-3 py-2 border rounded-md text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Venue note (optional)</label>
          <input
            type="text"
            value={details.venue_override}
            onChange={(e) => setDetails({ ...details, venue_override: e.target.value })}
            placeholder="Only if different from event venue"
            className="w-full px-3 py-2 border rounded-md text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Pre-event notes</label>
          <textarea
            value={details.pre_event_notes}
            onChange={(e) => setDetails({ ...details, pre_event_notes: e.target.value })}
            rows={3}
            placeholder="Anything else worth recording."
            className="w-full px-3 py-2 border rounded-md text-sm"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={detailsStatus === 'saving'}
            className="px-4 py-2 bg-neutral-900 text-white rounded-md text-sm font-medium disabled:opacity-50 hover:bg-neutral-800"
          >
            {detailsStatus === 'saving' ? 'Saving...' : 'Save details'}
          </button>
          {detailsStatus === 'saved' && <span className="text-sm text-green-700">Saved.</span>}
          {detailsStatus === 'error' && (
            <span className="text-sm text-red-600">{detailsError}</span>
          )}
        </div>
      </form>

      {/* --- Log a call attempt form --- */}
      <form onSubmit={saveAttempt} className="border rounded-lg p-5 space-y-5">
        <div>
          <h2 className="text-xs uppercase text-neutral-500 mb-1">Log a call attempt</h2>
          <p className="text-sm text-neutral-600">Records one row per call. Updates the booking status.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Attempt type</label>
            <select
              value={attemptType}
              onChange={(e) => {
                const next = e.target.value as AttemptType;
                setAttemptType(next);
                // If switching away from post_event and a post-only outcome is selected, clear it
                if (next !== 'post_event' && outcome && POST_EVENT_ONLY.has(outcome)) {
                  setOutcome('');
                }
              }}
              className="w-full px-3 py-2 border rounded-md text-sm bg-white"
            >
              <option value="initial">Initial call</option>
              <option value="24h_reminder">24-hour reminder</option>
              <option value="stale_followup">Stale follow-up</option>
              <option value="post_event">Post-event follow-up</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Outcome</label>
            <select
              value={outcome}
              onChange={(e) => {
                const next = e.target.value as Outcome | '';
                setOutcome(next);
                if (next !== 'rescheduled') setRescheduleToEventId('');
                if (next === 'follow_up_requested' && !followUpDate) {
                  setFollowUpDate(oneWeekFromTodayIso());
                }
              }}
              className="w-full px-3 py-2 border rounded-md text-sm bg-white"
            >
              <option value="">Select an outcome...</option>
              {visibleOutcomes.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {outcome === 'rescheduled' && (
          <div>
            <label className="block text-sm font-medium mb-1">Reschedule to</label>
            <select
              value={rescheduleToEventId}
              onChange={(e) => setRescheduleToEventId(e.target.value)}
              className="w-full px-3 py-2 border rounded-md text-sm bg-white"
            >
              <option value="">Pick a session...</option>
              {upcomingEvents.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {outcome === 'follow_up_requested' && (
          <div>
            <label className="block text-sm font-medium mb-1">Follow up on</label>
            <input
              type="date"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              className="px-3 py-2 border rounded-md text-sm bg-white"
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Notes</label>
          <textarea
            value={attemptNotes}
            onChange={(e) => setAttemptNotes(e.target.value)}
            rows={3}
            placeholder="What did the attendee say?"
            className="w-full px-3 py-2 border rounded-md text-sm"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={whatsappSent}
            onChange={(e) => setWhatsappSent(e.target.checked)}
            className="h-4 w-4"
          />
          WhatsApp video sent
        </label>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={attemptStatus === 'saving'}
            className="px-4 py-2 bg-neutral-900 text-white rounded-md text-sm font-medium disabled:opacity-50 hover:bg-neutral-800"
          >
            {attemptStatus === 'saving' ? 'Saving...' : 'Save attempt'}
          </button>
          {attemptStatus === 'saved' && <span className="text-sm text-green-700">Saved.</span>}
          {attemptError && <span className="text-sm text-red-600">{attemptError}</span>}
        </div>
      </form>

      {/* --- Call history --- */}
      <div className="border rounded-lg p-5 space-y-3">
        <h2 className="text-xs uppercase text-neutral-500">Call history</h2>
        {callAttempts.length === 0 ? (
          <p className="text-sm text-neutral-500 italic">No call attempts yet.</p>
        ) : (
          <ul className="space-y-3">
            {callAttempts.map((a) => (
              <CallHistoryRow key={a.id} attempt={a} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CallHistoryRow({ attempt }: { attempt: CallAttemptRow }) {
  const [expanded, setExpanded] = useState(false);
  const date = new Date(attempt.created_at).toLocaleString('en-GB', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  const reschedEvent = Array.isArray(attempt.reschedule_to_booking?.event)
    ? attempt.reschedule_to_booking?.event[0]
    : attempt.reschedule_to_booking?.event;
  const reschedLabel = reschedEvent?.session_label ?? null;
  const note = attempt.notes ?? '';
  const isLong = note.length > 120;
  const displayed = !isLong || expanded ? note : `${note.slice(0, 120)}…`;

  return (
    <li className="border-b last:border-b-0 pb-3 last:pb-0">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-sm">
          <span className="font-medium">{labelAttemptType(attempt.attempt_type)}</span>
          <span className="text-neutral-400 mx-1">·</span>
          <span className="text-neutral-700">{labelOutcome(attempt.outcome)}</span>
          {attempt.whatsapp_video_sent && (
            <span className="ml-2 inline-flex items-center text-green-700" title="WhatsApp video sent">
              ✓ WhatsApp
            </span>
          )}
        </div>
        <span className="text-xs text-neutral-500">{date}</span>
      </div>
      {note && (
        <p className="text-sm text-neutral-600 mt-1 whitespace-pre-wrap">
          {displayed}
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="ml-2 text-xs text-neutral-500 underline"
            >
              {expanded ? 'collapse' : 'expand'}
            </button>
          )}
        </p>
      )}
      {attempt.reschedule_to_booking_id && reschedLabel && (
        <p className="text-xs italic text-neutral-500 mt-1">
          →{' '}
          <Link
            href={`/admin/bookings/${attempt.reschedule_to_booking_id}`}
            className="underline hover:text-neutral-900"
          >
            rescheduled to {reschedLabel}
          </Link>
        </p>
      )}
    </li>
  );
}
