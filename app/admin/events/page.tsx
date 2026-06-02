import { redirect } from 'next/navigation';

export default async function EventsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  redirect(status ? `/admin/cohorts?status=${status}` : '/admin/cohorts');
}
