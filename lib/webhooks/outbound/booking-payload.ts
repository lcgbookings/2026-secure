import { createAdminClient } from '@/lib/supabase/admin';

type EmbedOne<T> = T | T[] | null;

function unwrap<T>(v: EmbedOne<T>): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export async function buildBookingPayload(
  bookingId: string
): Promise<{ success: true; payload: object } | { success: false; reason: string }> {
  const admin = createAdminClient();

  const { data: bookingRow, error: bookingErr } = await admin
    .from('bookings')
    .select(
      `id, attendee_id, event_id, ticket_type, confirmation_status, attendance_status,
       pricing_disclosed, pricing_response, rescheduled_from_booking_id,
       goals, experience_level, responsibility_level, referral_source, newsletter_consent,
       signed_in_at, is_first_session, pre_session_confidence,
       post_session_submitted_at, session_value_rating, most_useful_insight,
       session_relevance, hardest_under_pressure, coaching_interest,
       attendee:attendees ( first_name, last_name, email, phone ),
       event:events ( id, session_label, session_date, start_time, end_time, location, venue, status )`
    )
    .eq('id', bookingId)
    .maybeSingle();

  if (bookingErr) {
    return { success: false, reason: bookingErr.message };
  }
  if (!bookingRow) {
    return { success: false, reason: 'booking not found' };
  }

  type AttendeeEmbed = {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  type EventEmbed = {
    id?: string | null;
    session_label?: string | null;
    session_date?: string | null;
    start_time?: string | null;
    end_time?: string | null;
    location?: string | null;
    venue?: string | null;
    status?: string | null;
  };

  const attendee = unwrap<AttendeeEmbed>(
    bookingRow.attendee as EmbedOne<AttendeeEmbed>
  );
  const event = unwrap<EventEmbed>(bookingRow.event as EmbedOne<EventEmbed>);

  const { data: lastAttended } = await admin
    .from('bookings')
    .select('signed_in_at')
    .eq('attendee_id', bookingRow.attendee_id)
    .not('signed_in_at', 'is', null)
    .order('signed_in_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const sinceIso = lastAttended?.signed_in_at ?? '1900-01-01T00:00:00.000Z';

  const { data: attendeeBookings } = await admin
    .from('bookings')
    .select('id')
    .eq('attendee_id', bookingRow.attendee_id);

  const attendeeBookingIds = (attendeeBookings ?? []).map((b) => b.id);

  let rescheduleCount = 0;
  if (attendeeBookingIds.length > 0) {
    const { count } = await admin
      .from('call_attempts')
      .select('id', { count: 'exact', head: true })
      .in('booking_id', attendeeBookingIds)
      .eq('outcome', 'answered_rescheduled')
      .gt('attempted_at', sinceIso);
    rescheduleCount = count ?? 0;
  }

  let eventType = 'booking.in_progress';
  if (bookingRow.attendance_status === 'no_show') {
    eventType = 'booking.no_show_recorded';
  } else if (bookingRow.confirmation_status === 'cancelled') {
    const { data: downstream } = await admin
      .from('bookings')
      .select('id')
      .eq('rescheduled_from_booking_id', bookingRow.id)
      .limit(1)
      .maybeSingle();
    eventType = downstream ? 'booking.rescheduled' : 'booking.declined';
  } else if (
    bookingRow.attendance_status === 'attended' &&
    bookingRow.coaching_interest === 'speak_before_leaving'
  ) {
    eventType = 'booking.attended_with_hot_coaching_interest';
  } else if (bookingRow.attendance_status === 'attended') {
    eventType = 'booking.attended';
  } else if (bookingRow.confirmation_status === 'confirmed') {
    eventType = 'booking.confirmed';
  }

  const payload = {
    event_type: eventType,
    generated_at: new Date().toISOString(),
    attendee: {
      first_name: attendee?.first_name ?? null,
      last_name: attendee?.last_name ?? null,
      email: attendee?.email ?? null,
      phone: attendee?.phone ?? null,
    },
    booking: {
      id: bookingRow.id,
      event_id: bookingRow.event_id,
      ticket_type: bookingRow.ticket_type,
      confirmation_status: bookingRow.confirmation_status,
      attendance_status: bookingRow.attendance_status,
      pricing_disclosed: bookingRow.pricing_disclosed,
      pricing_response: bookingRow.pricing_response,
      reschedule_count: rescheduleCount,
      rescheduled_from_booking_id: bookingRow.rescheduled_from_booking_id,
    },
    event: event
      ? {
          id: event.id ?? null,
          session_label: event.session_label ?? null,
          session_date: event.session_date ?? null,
          start_time: event.start_time ?? null,
          end_time: event.end_time ?? null,
          location: event.location ?? null,
          venue: event.venue ?? null,
          status: event.status ?? null,
        }
      : null,
    pre_event_context: {
      goals: bookingRow.goals,
      experience_level: bookingRow.experience_level,
      responsibility_level: bookingRow.responsibility_level,
      referral_source: bookingRow.referral_source,
      newsletter_consent: bookingRow.newsletter_consent,
    },
    sign_in_context: bookingRow.signed_in_at
      ? {
          signed_in_at: bookingRow.signed_in_at,
          is_first_session: bookingRow.is_first_session,
          pre_session_confidence: bookingRow.pre_session_confidence,
          referral_source: bookingRow.referral_source,
        }
      : null,
    post_session_context: bookingRow.post_session_submitted_at
      ? {
          post_session_submitted_at: bookingRow.post_session_submitted_at,
          session_value_rating: bookingRow.session_value_rating,
          most_useful_insight: bookingRow.most_useful_insight,
          session_relevance: bookingRow.session_relevance,
          hardest_under_pressure: bookingRow.hardest_under_pressure,
          coaching_interest: bookingRow.coaching_interest,
        }
      : null,
  };

  return { success: true, payload };
}
