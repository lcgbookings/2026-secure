import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

(async () => {
  // Attempt an upsert with onConflict='session_label' on a deliberately-non-conflicting row.
  // If session_label lacks a unique index, PostgREST returns an error explaining so.
  const testLabel = `__schema_probe_${Date.now()}`;
  const today = new Date().toISOString().slice(0, 10);
  const startIso = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const endIso = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('events')
    .upsert(
      {
        session_label: testLabel,
        session_date: today,
        start_time: startIso,
        end_time: endIso,
        location: 'Probe',
        venue: null,
        status: 'draft',
      },
      { onConflict: 'session_label', ignoreDuplicates: true }
    )
    .select('id')
    .maybeSingle();

  if (error) {
    console.log('ERROR (likely no unique index on session_label):', error.message);
  } else {
    console.log('OK — upsert with onConflict=session_label accepted. Row:', data);
    // Clean up
    if (data?.id) {
      await supabase.from('events').delete().eq('id', data.id);
      console.log('Probe row cleaned up.');
    } else {
      // No id returned means it was a no-op or duplicate; clean up by label
      await supabase.from('events').delete().eq('session_label', testLabel);
      console.log('Probe rows by label cleaned up.');
    }
  }
})();
