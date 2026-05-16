'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function CalendarInvite({
  eventId,
  initialUrl,
}: {
  eventId: string;
  initialUrl: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(!initialUrl);
  const [value, setValue] = useState(initialUrl ?? '');
  const [savedUrl, setSavedUrl] = useState<string | null>(initialUrl);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError('');
    const trimmed = value.trim();

    if (!trimmed) {
      setError('Please enter a valid URL');
      return;
    }
    try {
      new URL(trimmed);
    } catch {
      setError('Please enter a valid URL');
      return;
    }

    setSaving(true);
    const res = await fetch(`/api/events/${eventId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendar_url: trimmed }),
    });
    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Save failed');
      return;
    }

    setSavedUrl(trimmed);
    setEditing(false);
    router.refresh();
  }

  return (
    <div>
      <h2 className="text-sm font-semibold uppercase text-neutral-500 mb-3">
        Calendar invite
      </h2>
      <div className="border rounded-lg p-4">
        {!editing && savedUrl ? (
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={savedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-3 py-2 bg-neutral-900 text-white rounded-md text-sm font-medium hover:bg-neutral-800"
            >
              View on Google Calendar
            </a>
            <button
              type="button"
              onClick={() => {
                setValue(savedUrl);
                setError('');
                setEditing(true);
              }}
              className="px-3 py-2 border border-neutral-300 rounded-md text-sm font-medium hover:bg-neutral-50"
            >
              Edit
            </button>
          </div>
        ) : (
          <div>
            <label htmlFor="calendar-url" className="block text-sm font-medium mb-1">
              Google Calendar event URL
            </label>
            <div className="flex flex-wrap items-start gap-2">
              <input
                id="calendar-url"
                type="text"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (error) setError('');
                }}
                placeholder="https://calendar.google.com/calendar/event?eid=..."
                className="flex-1 min-w-[260px] px-3 py-2 border rounded-md text-sm"
              />
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-neutral-900 text-white rounded-md text-sm font-medium disabled:opacity-50 hover:bg-neutral-800"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              {savedUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setValue(savedUrl);
                    setError('');
                    setEditing(false);
                  }}
                  className="px-3 py-2 border border-neutral-300 rounded-md text-sm font-medium hover:bg-neutral-50"
                >
                  Cancel
                </button>
              )}
            </div>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
