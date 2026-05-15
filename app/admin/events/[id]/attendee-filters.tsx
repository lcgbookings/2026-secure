'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useState } from 'react';

export default function AttendeeFilters({
  currentQuery,
  currentConfirmation,
  currentAttendance,
}: {
  currentQuery: string;
  currentConfirmation: string;
  currentAttendance: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchValue, setSearchValue] = useState(currentQuery);

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== 'all') {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateParam('q', searchValue);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <form onSubmit={handleSearchSubmit} className="flex-1 min-w-[200px]">
        <input
          type="text"
          placeholder="Search by name, email, or phone..."
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          className="w-full px-3 py-2 border rounded-md text-sm"
        />
      </form>

      <select
        value={currentConfirmation}
        onChange={(e) => updateParam('confirmation', e.target.value)}
        className="px-3 py-2 border rounded-md text-sm bg-white"
      >
        <option value="all">All confirmation</option>
        <option value="pending">Pending</option>
        <option value="confirmed">Confirmed</option>
        <option value="cancelled">Cancelled</option>
        <option value="unreachable">Unreachable</option>
      </select>

      <select
        value={currentAttendance}
        onChange={(e) => updateParam('attendance', e.target.value)}
        className="px-3 py-2 border rounded-md text-sm bg-white"
      >
        <option value="all">All attendance</option>
        <option value="pending">Pending</option>
        <option value="attended">Attended</option>
        <option value="no_show">No-show</option>
        <option value="excused">Excused</option>
      </select>
    </div>
  );
}
