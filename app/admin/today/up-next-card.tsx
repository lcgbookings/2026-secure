'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { QueueItem, QueuePriority } from '@/lib/today/build-queue';

export default function UpNextCard({ item }: { item: QueueItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSkip() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${item.id}/skip-today`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Skip failed (${res.status})`);
        setBusy(false);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setBusy(false);
    }
  }

  return (
    <div className="border border-lcg-deep-teal/10 rounded-xl p-6 bg-white">
      <div className="flex items-start justify-between mb-4 gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h2 className="font-serif text-xl text-lcg-deep-teal">
              {item.first_name} {item.last_name}
            </h2>
            <CategoryPill priority={item.priority} />
          </div>
          <p className="text-sm text-lcg-body-muted truncate">
            {item.email} · {item.phone || 'no phone'}
          </p>
        </div>
        {item.session_label_short && <ContextChip cohort={item.session_label_short} />}
      </div>

      {item.context_quote && (
        <blockquote className="border-l-2 border-lcg-teal pl-4 py-1 mb-4 text-sm text-lcg-body italic">
          &ldquo;{item.context_quote}&rdquo;
        </blockquote>
      )}

      <div className="flex gap-3 flex-wrap items-center">
        <Link href={`/admin/bookings/${item.id}`} className="lcg-btn-primary">
          Open call console →
        </Link>
        <button
          onClick={handleSkip}
          disabled={busy}
          className="lcg-btn-secondary disabled:opacity-50"
        >
          {busy ? 'Skipping...' : 'Skip for today'}
        </button>
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
    </div>
  );
}

const PRIORITY_LABELS: Record<QueuePriority, { label: string; color: string }> = {
  hot: { label: 'Hot lead', color: 'text-amber-700' },
  reminder_24h: { label: '24-hour reminder', color: 'text-red-700' },
  no_show_recovery: { label: 'Post-event recovery', color: 'text-purple-700' },
  new_pre_event: { label: 'Pre-event call', color: 'text-lcg-deep-teal/70' },
  stale_followup: { label: '10-day follow-up', color: 'text-lcg-body-muted' },
};

export function CategoryPill({
  priority,
  subtle,
}: {
  priority: QueuePriority;
  subtle?: boolean;
}) {
  const { label, color } = PRIORITY_LABELS[priority];
  return (
    <span
      className={`${color} ${subtle ? 'text-[11px]' : 'text-xs'} font-medium uppercase tracking-wide`}
    >
      {label}
    </span>
  );
}

export function ContextChip({ cohort }: { cohort: string }) {
  return (
    <span className="text-xs text-lcg-body-muted bg-lcg-cream rounded-full px-3 py-1 shrink-0">
      {cohort}
    </span>
  );
}
