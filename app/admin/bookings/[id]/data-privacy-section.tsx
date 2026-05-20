'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  attendeeId: string;
  attendeeFirstName: string;
  isSuperAdmin: boolean;
  anonymisedAt: string | null;
  newsletterConsent: boolean | null;
  newsletterConsentAt: string | null;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export default function DataPrivacySection({
  attendeeId,
  attendeeFirstName,
  isSuperAdmin,
  anonymisedAt,
  newsletterConsent,
  newsletterConsentAt,
}: Props) {
  const router = useRouter();

  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleAnonymise() {
    setSubmitting(true);
    setError('');
    const res = await fetch(`/api/admin/attendees/${attendeeId}/anonymise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() || undefined }),
    });
    setSubmitting(false);
    if (res.ok) {
      setConfirming(false);
      setReason('');
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Anonymisation failed');
    }
  }

  return (
    <section className="lcg-card p-6">
      <div className="lcg-eyebrow mb-1 text-lcg-deep-teal/60">Data &amp; privacy</div>
      <h2 className="font-serif text-xl text-lcg-deep-teal mb-5">
        Compliance controls
      </h2>

      <div className="space-y-6">
        {/* Newsletter consent */}
        <div>
          <div className="text-xs text-lcg-body-muted uppercase tracking-wide mb-2">
            Newsletter consent
          </div>
          {newsletterConsent === true && (
            <p className="text-sm text-lcg-body">
              Consent given on {formatTimestamp(newsletterConsentAt)}.
            </p>
          )}
          {newsletterConsent === false && (
            <p className="text-sm text-lcg-body">
              Consent declined on {formatTimestamp(newsletterConsentAt)}.
            </p>
          )}
          {newsletterConsent === null && (
            <p className="text-sm text-lcg-body-muted italic">
              No consent record on this booking.
            </p>
          )}
        </div>

        {/* DSAR export */}
        <div>
          <div className="text-xs text-lcg-body-muted uppercase tracking-wide mb-2">
            Data export (DSAR)
          </div>
          <p className="text-sm text-lcg-body-muted mb-3">
            Download a JSON file containing all personal data the Events Hub holds
            about this individual.
          </p>
          <a
            href={`/api/admin/attendees/${attendeeId}/export`}
            download
            className="lcg-btn-secondary"
          >
            <span>↓</span>
            <span className="ml-2">Download data export</span>
          </a>
        </div>

        {/* Erasure / anonymise */}
        <div>
          <div className="text-xs text-lcg-body-muted uppercase tracking-wide mb-2">
            Right to erasure
          </div>

          {anonymisedAt ? (
            <p className="text-sm text-lcg-body">
              Already anonymised on {formatTimestamp(anonymisedAt)}.
            </p>
          ) : !isSuperAdmin ? (
            <p className="text-sm text-lcg-body-muted italic">
              Erasure requires super_admin. Contact Gordon.
            </p>
          ) : confirming ? (
            <div className="border border-red-200 bg-red-50 rounded-lg p-4 space-y-3">
              <p className="text-sm text-red-900 font-medium">
                This will permanently anonymise {attendeeFirstName}&apos;s personal data
                across all their bookings. This action cannot be undone.
              </p>
              <label className="block">
                <span className="text-xs text-red-900/70 uppercase tracking-wide">
                  Reason (optional)
                </span>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. DSAR erasure request 2026-05-20"
                  className="mt-1 w-full border border-red-300 rounded-lg px-3 py-2 bg-white text-sm focus:outline-none focus:border-red-500"
                  disabled={submitting}
                />
              </label>
              {error && (
                <p className="text-sm text-red-700 bg-white border border-red-300 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleAnonymise}
                  disabled={submitting}
                  className={
                    submitting
                      ? 'inline-flex items-center justify-center rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white opacity-40 cursor-not-allowed'
                      : 'inline-flex items-center justify-center rounded-lg bg-red-700 hover:bg-red-800 px-4 py-2 text-sm font-semibold text-white transition'
                  }
                >
                  {submitting ? 'Anonymising…' : 'Yes, anonymise permanently'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    setReason('');
                    setError('');
                  }}
                  disabled={submitting}
                  className="lcg-btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-lcg-body-muted mb-3">
                Permanently anonymise this attendee&apos;s personal data. Categorical
                fields are kept for analytics; names, contact details, and free-text
                survey responses are nulled.
              </p>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="inline-flex items-center justify-center rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:border-red-500 hover:bg-red-50 transition"
              >
                Anonymise attendee…
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
