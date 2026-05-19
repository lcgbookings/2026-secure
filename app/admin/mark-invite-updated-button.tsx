'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function MarkInviteUpdatedButton({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleClick() {
    setError('');
    setSaving(true);
    const res = await fetch(`/api/bookings/${bookingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendar_invite_pending_update: false }),
    });
    if (res.ok) {
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Save failed');
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={saving}
        className="px-3 py-1.5 bg-neutral-900 text-white rounded-md text-xs font-medium disabled:opacity-50 hover:bg-neutral-800 whitespace-nowrap"
      >
        {saving ? 'Saving…' : 'Mark calendar updated'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
