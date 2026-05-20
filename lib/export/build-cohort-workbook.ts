import ExcelJS from 'exceljs';
import { formatInTimeZone } from 'date-fns-tz';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  labelReferralSource,
  labelRelevance,
  labelCoachingInterest,
  labelExperienceLevel,
  labelResponsibilityLevel,
  labelPricingResponse,
  labelConfirmationStatus,
  labelAttendanceStatus,
} from '@/lib/format';
import { computeCohortStats, type CohortStats } from '@/lib/analytics/cohort-stats';

const LONDON_TZ = 'Europe/London';
const TEAL = 'FF003941';
const WHITE = 'FFFFFFFF';
const STRIPE = 'FFF5F5F5';

type EventRow = {
  id: string;
  session_label: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  venue: string | null;
  status: string | null;
  capacity: number | null;
};

type AttendeeEmbed = {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
};

type BookingRow = {
  id: string;
  event_id: string | null;
  attendee_id: string | null;
  confirmation_status: string | null;
  confirmation_called_at: string | null;
  attendance_status: string | null;
  pricing_disclosed: boolean | null;
  pricing_response: string | null;
  goals: string | null;
  experience_level: string | null;
  responsibility_level: string | null;
  signed_in_at: string | null;
  session_value_rating: number | null;
  most_useful_insight: string | null;
  session_relevance: string | null;
  hardest_under_pressure: string | null;
  coaching_interest: string | null;
  referral_source: string | null;
  newsletter_consent: boolean | null;
  flagged_repeat_no_show: boolean | null;
  masterclass_outcome: string | null;
  rescheduled_from_booking_id: string | null;
  attendee: AttendeeEmbed | AttendeeEmbed[] | null;
};

type CallAttemptRow = {
  booking_id: string;
  outcome: string | null;
  whatsapp_video_sent: boolean | null;
};

function unwrapAttendee(a: BookingRow['attendee']): AttendeeEmbed | null {
  if (!a) return null;
  return Array.isArray(a) ? a[0] ?? null : a;
}

function truncate(s: string | null, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function yesNo(v: boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  return v ? 'Yes' : 'No';
}

function fmtTimestamp(iso: string | null): string {
  if (!iso) return '';
  return formatInTimeZone(new Date(iso), LONDON_TZ, 'dd/MM/yyyy HH:mm');
}

function monthKey(iso: string | null): string {
  if (!iso) return '';
  return formatInTimeZone(new Date(iso), LONDON_TZ, 'yyyy-MM');
}

function monthLabel(iso: string | null): string {
  if (!iso) return '';
  return formatInTimeZone(new Date(iso), LONDON_TZ, 'MMMM yyyy');
}

function pct(num: number, den: number): string {
  if (den === 0) return '';
  return `${Math.round((num / den) * 100)}%`;
}

function formatTabName(label: string | null, taken: Set<string>): string {
  let raw = (label ?? 'Event').replace(/[–—]/g, '-');
  raw = raw.replace(/[\\\/\?\*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim();
  let base = raw.slice(0, 31);
  let name = base;
  let n = 2;
  while (taken.has(name)) {
    const suffix = ` ${n}`;
    name = base.slice(0, 31 - suffix.length) + suffix;
    n += 1;
  }
  taken.add(name);
  return name;
}

function formatEventTitle(ev: EventRow): string {
  const datePart = ev.start_time
    ? formatInTimeZone(new Date(ev.start_time), LONDON_TZ, 'EEEE do MMMM, yyyy')
    : '(no date)';
  const place = [ev.location, ev.venue].filter(Boolean).join(' (');
  const tail = ev.location && ev.venue ? `${place})` : place;
  return tail ? `${datePart} — ${tail}` : datePart;
}

const HEADER_COLUMNS: Array<{ header: string; width: number }> = [
  { header: 'First name', width: 18 },
  { header: 'Surname', width: 18 },
  { header: 'Email', width: 32 },
  { header: 'Phone', width: 18 },
  { header: 'Confirmation status', width: 22 },
  { header: 'Confirmation called at', width: 18 },
  { header: '# Call attempts', width: 14 },
  { header: 'WhatsApp video sent', width: 12 },
  { header: 'Pricing disclosed', width: 12 },
  { header: 'Pricing response', width: 22 },
  { header: 'Goals', width: 50 },
  { header: 'Pre-event experience', width: 22 },
  { header: 'Pre-event responsibility', width: 22 },
  { header: 'Signed in at', width: 18 },
  { header: 'Attendance status', width: 22 },
  { header: 'Session value rating', width: 14 },
  { header: 'Most useful insight', width: 50 },
  { header: 'Session relevance', width: 22 },
  { header: 'Hardest under pressure', width: 50 },
  { header: 'Coaching interest', width: 22 },
  { header: 'Referral source', width: 22 },
  { header: 'Newsletter consent', width: 12 },
  { header: 'Repeat no-show flag', width: 12 },
  { header: 'Rescheduled from', width: 32 },
];

function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: WHITE } };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
    cell.alignment = { vertical: 'middle' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
    };
  });
}

function stripeBody(sheet: ExcelJS.Worksheet, startRow: number, endRow: number) {
  for (let r = startRow; r <= endRow; r++) {
    if ((r - startRow) % 2 === 1) {
      const row = sheet.getRow(r);
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STRIPE } };
      });
    }
  }
}

export async function buildCohortWorkbook(): Promise<ExcelJS.Workbook> {
  const supabase = createAdminClient();

  const [eventsRes, bookingsRes, callsRes] = await Promise.all([
    supabase
      .from('events')
      .select('id, session_label, start_time, end_time, location, venue, status, capacity')
      .in('status', ['scheduled', 'completed'])
      .order('start_time', { ascending: true }),
    supabase
      .from('bookings')
      .select(
        `id, event_id, attendee_id, confirmation_status, confirmation_called_at,
         attendance_status, pricing_disclosed, pricing_response,
         goals, experience_level, responsibility_level,
         signed_in_at, session_value_rating, most_useful_insight,
         session_relevance, hardest_under_pressure, coaching_interest,
         referral_source, newsletter_consent, flagged_repeat_no_show, masterclass_outcome,
         rescheduled_from_booking_id,
         attendee:attendees ( first_name, last_name, email, phone )`
      ),
    supabase
      .from('call_attempts')
      .select('booking_id, outcome, whatsapp_video_sent'),
  ]);

  const events = (eventsRes.data ?? []) as EventRow[];
  const bookings = (bookingsRes.data ?? []) as unknown as BookingRow[];
  const calls = (callsRes.data ?? []) as CallAttemptRow[];

  const callsByBooking = new Map<string, { count: number; whatsapp: boolean }>();
  for (const c of calls) {
    if (!c.booking_id) continue;
    const entry = callsByBooking.get(c.booking_id) ?? { count: 0, whatsapp: false };
    entry.count += 1;
    if (c.whatsapp_video_sent) entry.whatsapp = true;
    callsByBooking.set(c.booking_id, entry);
  }

  const bookingsByEvent = new Map<string, BookingRow[]>();
  for (const b of bookings) {
    if (!b.event_id) continue;
    const arr = bookingsByEvent.get(b.event_id) ?? [];
    arr.push(b);
    bookingsByEvent.set(b.event_id, arr);
  }

  const bookingsById = new Map<string, BookingRow>();
  for (const b of bookings) bookingsById.set(b.id, b);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Leadership Communication Group';
  workbook.created = new Date();
  workbook.properties.date1904 = false;

  const eventsById = new Map<string, EventRow>();
  for (const ev of events) eventsById.set(ev.id, ev);

  const statsByEvent = new Map<string, CohortStats>();
  for (const ev of events) {
    const eBookings = bookingsByEvent.get(ev.id) ?? [];
    const eBookingIds = new Set(eBookings.map((b) => b.id));
    const eCalls = calls.filter((c) => c.booking_id && eBookingIds.has(c.booking_id));
    statsByEvent.set(ev.id, computeCohortStats(ev.id, eBookings, eCalls));
  }

  buildSummarySheet(workbook, events, statsByEvent);

  const takenNames = new Set<string>(['Summary']);
  for (const ev of events) {
    const name = formatTabName(ev.session_label, takenNames);
    const sheet = workbook.addWorksheet(name);
    buildCohortSheet(
      sheet,
      ev,
      bookingsByEvent.get(ev.id) ?? [],
      callsByBooking,
      bookingsById,
      eventsById,
      statsByEvent.get(ev.id) ?? null
    );
  }

  const unassigned = bookings.filter((b) => !b.event_id);
  const unassignedSheet = workbook.addWorksheet('Unassigned bookings');
  buildUnassignedSheet(unassignedSheet, unassigned, callsByBooking, bookingsById, eventsById);

  return workbook;
}

function buildUnassignedSheet(
  sheet: ExcelJS.Worksheet,
  rows: BookingRow[],
  callsByBooking: Map<string, { count: number; whatsapp: boolean }>,
  bookingsById: Map<string, BookingRow>,
  eventsById: Map<string, EventRow>
) {
  sheet.columns = HEADER_COLUMNS.map((c) => ({ width: c.width }));
  const lastCol = String.fromCharCode(64 + HEADER_COLUMNS.length); // 'X'

  sheet.mergeCells(`A1:${lastCol}1`);
  const titleCell = sheet.getCell('A1');
  titleCell.value = 'Bookings without an event assignment';
  titleCell.font = { bold: true, size: 14, color: { argb: WHITE } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
  sheet.getRow(1).height = 24;

  sheet.mergeCells(`A2:${lastCol}2`);
  const subCell = sheet.getCell('A2');
  subCell.value =
    'These bookings came in via Systeme but were never linked to a session. They need manual reconciliation in the admin.';
  subCell.font = { italic: true, color: { argb: 'FF555555' } };

  // Row 3 spacer left blank.

  const headerRow = sheet.getRow(4);
  HEADER_COLUMNS.forEach((c, i) => {
    headerRow.getCell(i + 1).value = c.header;
  });
  styleHeaderRow(headerRow);

  const sorted = sortBookingsByName(rows);
  const startRow = 5;

  if (sorted.length === 0) {
    sheet.mergeCells(`A${startRow}:${lastCol}${startRow}`);
    const emptyCell = sheet.getCell(`A${startRow}`);
    emptyCell.value = 'All bookings are assigned to an event.';
    emptyCell.font = { italic: true, color: { argb: 'FF888888' } };
    emptyCell.alignment = { horizontal: 'center' };
  } else {
    for (const b of sorted) {
      sheet.addRow(bookingToRowValues(b, callsByBooking, bookingsById, eventsById));
    }
    stripeBody(sheet, startRow, startRow + sorted.length - 1);
  }

  sheet.views = [{ state: 'frozen', ySplit: 4 }];
}

function buildSummarySheet(
  workbook: ExcelJS.Workbook,
  events: EventRow[],
  statsByEvent: Map<string, CohortStats>
) {
  const sheet = workbook.addWorksheet('Summary');

  const headers = [
    'Month',
    'Events',
    'Booked',
    'Confirmed',
    'Confirmation Rate',
    'Attended',
    'Show-up Rate',
    'Hot Coaching',
    'Coaching Rate',
    'No-shows',
  ];
  const widths = [16, 10, 10, 12, 16, 10, 14, 14, 14, 12];

  sheet.columns = widths.map((w) => ({ width: w }));
  const headerRow = sheet.addRow(headers);
  styleHeaderRow(headerRow);

  const monthEvents = new Map<string, EventRow[]>();
  for (const ev of events) {
    const key = monthKey(ev.start_time);
    const arr = monthEvents.get(key) ?? [];
    arr.push(ev);
    monthEvents.set(key, arr);
  }

  const monthKeys = Array.from(monthEvents.keys())
    .filter((k) => k)
    .sort();

  let totalEvents = 0;
  let totalBooked = 0;
  let totalConfirmed = 0;
  let totalAttended = 0;
  let totalHot = 0;
  let totalNoShow = 0;

  for (const mk of monthKeys) {
    const evs = monthEvents.get(mk) ?? [];

    let booked = 0;
    let confirmed = 0;
    let attended = 0;
    let hot = 0;
    let noShow = 0;
    for (const ev of evs) {
      const s = statsByEvent.get(ev.id);
      if (!s) continue;
      booked += s.booked;
      confirmed += s.confirmed;
      attended += s.attended;
      hot += s.hotCoaching;
      noShow += s.noShows;
    }

    const sample = evs[0]?.start_time ?? null;
    sheet.addRow([
      monthLabel(sample),
      evs.length,
      booked,
      confirmed,
      pct(confirmed, booked),
      attended,
      pct(attended, confirmed),
      hot,
      pct(hot, attended),
      noShow,
    ]);

    totalEvents += evs.length;
    totalBooked += booked;
    totalConfirmed += confirmed;
    totalAttended += attended;
    totalHot += hot;
    totalNoShow += noShow;
  }

  const totalRow = sheet.addRow([
    'TOTAL',
    totalEvents,
    totalBooked,
    totalConfirmed,
    '',
    totalAttended,
    '',
    totalHot,
    '',
    totalNoShow,
  ]);
  totalRow.font = { bold: true };

  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function bookingToRowValues(
  b: BookingRow,
  callsByBooking: Map<string, { count: number; whatsapp: boolean }>,
  bookingsById: Map<string, BookingRow>,
  eventsById: Map<string, EventRow>
): Array<string | number> {
  const a = unwrapAttendee(b.attendee);
  const callInfo = callsByBooking.get(b.id);
  let rescheduledLabel = '';
  if (b.rescheduled_from_booking_id) {
    const original = bookingsById.get(b.rescheduled_from_booking_id);
    const originalEvent = original?.event_id ? eventsById.get(original.event_id) : null;
    rescheduledLabel = originalEvent?.session_label ?? '';
  }
  return [
    a?.first_name ?? '',
    a?.last_name ?? '',
    a?.email ?? '',
    a?.phone ?? '',
    b.confirmation_status ? labelConfirmationStatus(b.confirmation_status) : '',
    fmtTimestamp(b.confirmation_called_at),
    callInfo?.count ?? 0,
    callInfo?.whatsapp ? 'Yes' : 'No',
    yesNo(b.pricing_disclosed),
    labelPricingResponse(b.pricing_response),
    truncate(b.goals, 200),
    labelExperienceLevel(b.experience_level),
    labelResponsibilityLevel(b.responsibility_level),
    fmtTimestamp(b.signed_in_at),
    b.attendance_status ? labelAttendanceStatus(b.attendance_status) : '',
    b.session_value_rating ?? '',
    truncate(b.most_useful_insight, 300),
    labelRelevance(b.session_relevance),
    truncate(b.hardest_under_pressure, 300),
    labelCoachingInterest(b.coaching_interest),
    labelReferralSource(b.referral_source),
    yesNo(b.newsletter_consent),
    b.flagged_repeat_no_show ? 'Yes' : '',
    rescheduledLabel,
  ];
}

function sortBookingsByName(rows: BookingRow[]): BookingRow[] {
  return [...rows].sort((a, b) => {
    const aa = unwrapAttendee(a.attendee);
    const bb = unwrapAttendee(b.attendee);
    const aLast = (aa?.last_name ?? '').toLowerCase();
    const bLast = (bb?.last_name ?? '').toLowerCase();
    if (aLast !== bLast) return aLast < bLast ? -1 : 1;
    const aFirst = (aa?.first_name ?? '').toLowerCase();
    const bFirst = (bb?.first_name ?? '').toLowerCase();
    return aFirst < bFirst ? -1 : aFirst > bFirst ? 1 : 0;
  });
}

function buildCohortSheet(
  sheet: ExcelJS.Worksheet,
  ev: EventRow,
  rows: BookingRow[],
  callsByBooking: Map<string, { count: number; whatsapp: boolean }>,
  bookingsById: Map<string, BookingRow>,
  eventsById: Map<string, EventRow>,
  stats: CohortStats | null
) {
  sheet.columns = HEADER_COLUMNS.map((c) => ({ width: c.width }));

  const lastCol = String.fromCharCode(64 + HEADER_COLUMNS.length); // 24 → 'X'
  sheet.mergeCells(`A1:${lastCol}1`);
  const titleCell = sheet.getCell('A1');
  titleCell.value = formatEventTitle(ev);
  titleCell.font = { bold: true, size: 14, color: { argb: WHITE } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
  sheet.getRow(1).height = 24;

  const booked = stats?.booked ?? 0;
  const confirmed = stats?.confirmed ?? 0;
  const attended = stats?.attended ?? 0;
  const hot = stats?.hotCoaching ?? 0;

  sheet.mergeCells(`A2:${lastCol}2`);
  const subCell = sheet.getCell('A2');
  subCell.value = `Booked: ${booked} · Confirmed: ${confirmed} · Attended: ${attended} · Hot coaching: ${hot}`;
  subCell.font = { italic: true, color: { argb: 'FF555555' } };

  // Row 3 spacer left blank.

  const headerRow = sheet.getRow(4);
  HEADER_COLUMNS.forEach((c, i) => {
    headerRow.getCell(i + 1).value = c.header;
  });
  styleHeaderRow(headerRow);

  const sorted = sortBookingsByName(rows);

  const startRow = 5;
  for (const b of sorted) {
    sheet.addRow(bookingToRowValues(b, callsByBooking, bookingsById, eventsById));
  }

  const endRow = startRow + sorted.length - 1;
  if (endRow >= startRow) stripeBody(sheet, startRow, endRow);

  sheet.views = [{ state: 'frozen', ySplit: 4 }];
}
