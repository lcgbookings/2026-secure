import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  // Vercel cron jobs send a special header. In production, verify it.
  const supabase = createAdminClient();

  const { count, error } = await supabase
    .from('pending_event_selections')
    .delete({ count: 'exact' })
    .lt('expires_at', new Date().toISOString())
    .is('consumed_at', null);

  if (error) {
    console.error('[cron] cleanup-pending failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: count ?? 0 });
}
