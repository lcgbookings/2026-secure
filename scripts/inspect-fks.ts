import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Try the named-FK embed; if it fails, fall back to column-name-based embed
(async () => {
  const queries = [
    "*, reschedule_to_booking:bookings!call_attempts_reschedule_to_booking_id_fkey (id)",
    "*, reschedule_to_booking:bookings!reschedule_to_booking_id (id)",
    "*, bookings!reschedule_to_booking_id (id)",
  ];
  for (const q of queries) {
    const { error } = await supabase.from('call_attempts').select(q).limit(1);
    console.log(`Query "${q}":`, error ? `ERROR: ${error.message}` : 'OK');
  }
})();
