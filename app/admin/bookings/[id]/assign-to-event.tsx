'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AssignToEvent({
  bookingId,
  upcomingEvents,
}: {
  bookingId: string;
  upcomingEvents: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [eventId, setEventId] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [error, setError] = useState('');

  async function handleAssign() {
    setError('');
    if (!eventId) {
      setError('Pick a session first.');
      return;
    }
    setStatus('saving');
    const res = await fetch(`/api/bookings/${bookingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: eventId }),
    });
    if (res.ok) {
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setStatus('error');
      setError(body.error ?? 'Save failed');
    }
  }

  return (
    <div className="border rounded-lg p-4 bg-yellow-50 border-yellow-200">
      <h2 className="text-xs uppercase text-yellow-900 mb-2">Assign to event</h2>
      <p className="text-sm text-yellow-900 mb-3">
        This booking isn&apos;t linked to a session yet. Pick the event the customer paid for.
      </p>
      <div className="flex gap-3 items-center flex-wrap">
        <select
          value={eventId}
          onChange={(e) => {
            setEventId(e.target.value);
            if (error) setError('');
          }}
          className="px-3 py-2 border rounded-md text-sm bg-white"
        >
          <option value="">Pick a session...</option>
          {upcomingEvents.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleAssign}
          disabled={status === 'saving'}
          className="px-4 py-2 bg-neutral-900 text-white rounded-md text-sm font-medium disabled:opacity-50 hover:bg-neutral-800"
        >
          {status === 'saving' ? 'Linking...' : 'Link to event'}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}
