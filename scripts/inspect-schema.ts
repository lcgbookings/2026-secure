import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function listColumns(table: string) {
  // Probe the table by selecting one row and inspect the keys
  const { data, error } = await supabase.from(table).select('*').limit(1);
  if (error) {
    console.log(`\n=== ${table} ===\nERROR: ${error.message}`);
    return;
  }
  console.log(`\n=== ${table} ===`);
  if (!data || data.length === 0) {
    console.log('(table empty — probing column presence via failing inserts is unsafe; using rpc/information_schema instead)');
    return;
  }
  for (const key of Object.keys(data[0])) {
    const v = data[0][key];
    const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
    console.log(`  ${key}: ${t}`);
  }
}

(async () => {
  await listColumns('events');
  await listColumns('pending_event_selections');
})();
