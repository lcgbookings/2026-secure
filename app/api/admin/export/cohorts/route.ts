import { NextResponse } from 'next/server';
import { formatInTimeZone } from 'date-fns-tz';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildCohortWorkbook } from '@/lib/export/build-cohort-workbook';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const admin = createAdminClient();
  const { data: adminRow } = await admin
    .from('admin_users')
    .select('id, status')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!adminRow || adminRow.status !== 'active') {
    return NextResponse.json({ error: 'Not authorised' }, { status: 403 });
  }

  const workbook = await buildCohortWorkbook();
  const buffer = await workbook.xlsx.writeBuffer();

  const today = formatInTimeZone(new Date(), 'Europe/London', 'yyyy-MM-dd');
  const filename = `lcg-cohorts-${today}.xlsx`;

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
