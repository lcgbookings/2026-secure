import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function probe(table: string) {
  const { data, error } = await supabase.from(table).select('*').limit(1);
  console.log(`\n=== ${table} ===`);
  if (error) {
    console.log(`ERROR: ${error.message}`);
    return;
  }
  if (!data || data.length === 0) {
    console.log('(empty)');
    return;
  }
  for (const key of Object.keys(data[0])) {
    const v = data[0][key];
    const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
    console.log(`  ${key}: ${t}`);
  }
}

(async () => {
  await probe('call_attempts');
  await probe('bookings');
})();
