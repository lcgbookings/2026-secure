import { createAdminClient } from "@/lib/supabase/admin";

export async function countNoShowsSinceLastAttended(
  attendeeId: string,
  excludeBookingId?: string
): Promise<number> {
  const supabase = createAdminClient();

  const { data: signedInRow } = await supabase
    .from("bookings")
    .select("signed_in_at")
    .eq("attendee_id", attendeeId)
    .not("signed_in_at", "is", null)
    .order("signed_in_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: submittedRow } = await supabase
    .from("bookings")
    .select("post_session_submitted_at")
    .eq("attendee_id", attendeeId)
    .not("post_session_submitted_at", "is", null)
    .order("post_session_submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const signedInAt = signedInRow?.signed_in_at ?? null;
  const submittedAt = submittedRow?.post_session_submitted_at ?? null;

  let floor: string;
  if (signedInAt && submittedAt) {
    floor = signedInAt > submittedAt ? signedInAt : submittedAt;
  } else if (signedInAt) {
    floor = signedInAt;
  } else if (submittedAt) {
    floor = submittedAt;
  } else {
    floor = "1900-01-01";
  }

  let query = supabase
    .from("bookings")
    .select("id, events!inner(end_time)", { count: "exact", head: true })
    .eq("attendee_id", attendeeId)
    .eq("attendance_status", "no_show")
    .gt("events.end_time", floor);

  if (excludeBookingId) {
    query = query.neq("id", excludeBookingId);
  }

  const { count, error } = await query;

  if (error) throw error;
  return count ?? 0;
}
