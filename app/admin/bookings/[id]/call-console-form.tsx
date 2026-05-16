'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  bookingId: string;
  initial: {
    event_id: string | null;
    confirmation_status: string;
    goals: string;
    experience_level: string;
    responsibility_level: string;
    venue_override: string;
    pre_event_notes: string;
  };
  events: Array<{ id: string; label: string }>;
}

export default function CallConsoleForm({ bookingId, initial, events }: Props) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('saving');
    setErrorMessage('');

    const res = await fetch(`/api/bookings/${bookingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });

    if (res.ok) {
      setStatus('saved');
      router.refresh();
      setTimeout(() => setStatus('idle'), 2000);
    } else {
      const body = await res.json().catch(() => ({}));
      setStatus('error');
      setErrorMessage(body.error ?? 'Save failed');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border rounded-lg p-5 space-y-5">
      <div>
        <h2 className="text-xs uppercase text-neutral-500 mb-1">Call console</h2>
        <p className="text-sm text-neutral-600">
          Complete the confirmation call and capture goals.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Event</label>
        <select
          value={form.event_id ?? ''}
          onChange={(e) => setForm({ ...form, event_id: e.target.value || null })}
          className="w-full px-3 py-2 border rounded-md text-sm bg-white"
        >
          <option value="">No event assigned</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Confirmation outcome</label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 'pending', label: 'Pending' },
            { value: 'confirmed', label: 'Confirmed' },
            { value: 'unreachable', label: 'Unreachable' },
            { value: 'cancelled', label: 'Cancelled' },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setForm({ ...form, confirmation_status: opt.value })}
              className={`px-3 py-2 border rounded-md text-sm font-medium ${
                form.confirmation_status === opt.value
                  ? 'bg-neutral-900 text-white border-neutral-900'
                  : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Experience</label>
          <select
            value={form.experience_level}
            onChange={(e) => setForm({ ...form, experience_level: e.target.value })}
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
            value={form.responsibility_level}
            onChange={(e) => setForm({ ...form, responsibility_level: e.target.value })}
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
          value={form.goals}
          onChange={(e) => setForm({ ...form, goals: e.target.value })}
          rows={3}
          placeholder="What does this person want to achieve?"
          className="w-full px-3 py-2 border rounded-md text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Venue note (optional)
        </label>
        <input
          type="text"
          value={form.venue_override}
          onChange={(e) => setForm({ ...form, venue_override: e.target.value })}
          placeholder="Only if different from event venue"
          className="w-full px-3 py-2 border rounded-md text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Pre-event notes</label>
        <textarea
          value={form.pre_event_notes}
          onChange={(e) =>
            setForm({ ...form, pre_event_notes: e.target.value })
          }
          rows={3}
          placeholder="Anything else worth recording from the call."
          className="w-full px-3 py-2 border rounded-md text-sm"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={status === 'saving'}
          className="px-4 py-2 bg-neutral-900 text-white rounded-md text-sm font-medium disabled:opacity-50 hover:bg-neutral-800"
        >
          {status === 'saving' ? 'Saving...' : 'Save'}
        </button>

        {status === 'saved' && (
          <span className="text-sm text-green-700">Saved.</span>
        )}
        {status === 'error' && (
          <span className="text-sm text-red-600">{errorMessage}</span>
        )}
      </div>
    </form>
  );
}
