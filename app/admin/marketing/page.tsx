import { redirect } from 'next/navigation';

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ eventId?: string }>;
}) {
  const { eventId } = await searchParams;
  redirect(eventId ? `/admin/analytics?eventId=${eventId}` : '/admin/analytics');
}
