#!/usr/bin/env node
// Exercises the four paths through the Systeme order webhook auto-create logic.
//
// Pre-req: `npm run dev` running on http://localhost:3000

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---------- env ----------
function readEnv() {
  const envPath = resolve(ROOT, '.env.local');
  if (!existsSync(envPath)) {
    console.error(`Cannot find ${envPath}`);
    process.exit(1);
  }
  const env = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

const ENV = readEnv();
const SECRET = ENV.SYSTEME_WEBHOOK_SECRET;
const SUPABASE_URL = ENV.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY;

if (!SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing required env in .env.local');
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const URL = `http://localhost:3000/api/webhooks/systeme?secret=${encodeURIComponent(SECRET)}`;

// ---------- helpers ----------
let orderCounter = 990000000 + Math.floor(Math.random() * 1000);
function nextOrderId() {
  return orderCounter++;
}

function buildSystemePayload({ email, sessionLabel, orderId, contactId }) {
  return {
    customer: {
      id: contactId,
      clientIp: '0.0.0.0',
      contactId: contactId,
      email,
      fields: {
        surname: 'Auto',
        phone_number: '447900000000',
        first_name: 'Test',
        postcode: '',
        street_address: '',
        city: '',
      },
      paymentProcessor: 'stripe',
      sourceUrl: 'https://test',
    },
    coupon: null,
    funnelStep: {
      id: 21612461,
      name: 'Test Funnel',
      type: 'offer-form',
      funnel: { id: 6527102, name: 'BIG Main Funnel' },
    },
    checkoutPage: null,
    order: {
      id: orderId,
      createdAt: '2026-05-16T12:00:00+00:00',
      discountAmount: null,
      discountType: null,
      shippingFee: null,
      totalPrice: 100,
      vat: 0,
    },
    orderItem: {
      createdAt: '2026-05-16T12:00:00+00:00',
      id: orderId + 1,
      resources: [
        {
          course: null,
          courseBundle: null,
          enrollmentAccessType: null,
          enrollmentDrippingAccessCourse: null,
          physicalProduct: null,
          tag: { id: 1758324, name: 'Masterclass' },
        },
      ],
    },
    pricePlan: {
      id: 3080556,
      name: '£1 Access',
      type: 'one_shot',
      amount: 100,
      currency: 'gbp',
      innerName: '£1 Access',
      recurringOptions: null,
      statementDescriptor: 'Believe In Greatness',
    },
    // Note: session_label / radio choice is NOT in this payload by design.
    // The radio webhook fires first to populate pending_event_selections.
    _testSessionLabel: sessionLabel, // for debugging only
  };
}

async function postWebhook(payload) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let body;
  try {
    body = await res.json();
  } catch {
    body = { error: `non-JSON (${res.status})` };
  }
  return { status: res.status, body };
}

async function cleanupTestData(emails, sessionLabels) {
  // Order matters: bookings → payments cascade isn't guaranteed, but
  // we delete in dependency order regardless.
  // 1. payments (by attendee email lookup)
  // 2. bookings (by attendee email lookup)
  // 3. pending_event_selections (by email)
  // 4. attendees (by email)
  // 5. events (by session_label)

  for (const email of emails) {
    // Find attendee
    const { data: att } = await supabaseAdmin
      .from('attendees')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (att) {
      // Find bookings for that attendee
      const { data: bookings } = await supabaseAdmin
        .from('bookings')
        .select('id')
        .eq('attendee_id', att.id);

      const bookingIds = (bookings ?? []).map((b) => b.id);
      if (bookingIds.length) {
        await supabaseAdmin.from('payments').delete().in('booking_id', bookingIds);
        await supabaseAdmin.from('bookings').delete().in('id', bookingIds);
      }

      await supabaseAdmin.from('attendees').delete().eq('id', att.id);
    }

    await supabaseAdmin.from('pending_event_selections').delete().eq('email', email);
  }

  for (const label of sessionLabels) {
    await supabaseAdmin.from('events').delete().eq('session_label', label);
  }
}

async function findAttendeeId(email) {
  const { data } = await supabaseAdmin
    .from('attendees')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  return data?.id ?? null;
}

async function findLatestBooking(attendeeId) {
  const { data } = await supabaseAdmin
    .from('bookings')
    .select('id, event_id')
    .eq('attendee_id', attendeeId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function findEventBySessionLabel(label) {
  const { data } = await supabaseAdmin
    .from('events')
    .select('id, session_label, session_date, start_time, end_time, auto_created')
    .eq('session_label', label)
    .maybeSingle();
  return data ?? null;
}

async function countEventsByLabel(label) {
  const { count } = await supabaseAdmin
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('session_label', label);
  return count ?? 0;
}

async function findPendingByEmail(email) {
  const { data } = await supabaseAdmin
    .from('pending_event_selections')
    .select('id, matched_event_id, masterclass_date_label')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

// ---------- result tracker ----------
const results = [];
function record(scenario, pass, detail) {
  results.push({ scenario, pass, detail });
  if (pass) {
    console.log(`[PASS] Scenario ${scenario}`);
  } else {
    console.log(`[FAIL] Scenario ${scenario}\n  ${detail}`);
  }
}

// ---------- SCENARIO 1 ----------
async function scenario1() {
  const email = 'test-auto-create-1@example.com';
  const label = 'Mon 8 February, 14:00–17:00';
  let preseededEventId = null;
  try {
    // Pre-seed event
    const { data: ev, error: evErr } = await supabaseAdmin
      .from('events')
      .insert({
        session_label: label,
        session_date: '2027-02-08',
        start_time: '2027-02-08T14:00:00+00:00',
        end_time: '2027-02-08T17:00:00+00:00',
        auto_created: false,
      })
      .select('id')
      .single();
    if (evErr) throw new Error(`pre-seed event: ${evErr.message}`);
    preseededEventId = ev.id;

    // Pre-seed pending
    const { error: penErr } = await supabaseAdmin
      .from('pending_event_selections')
      .insert({
        email,
        masterclass_date_label: label,
        matched_event_id: preseededEventId,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
    if (penErr) throw new Error(`pre-seed pending: ${penErr.message}`);

    // Fire webhook
    const orderId = nextOrderId();
    const res = await postWebhook(
      buildSystemePayload({ email, sessionLabel: label, orderId, contactId: orderId })
    );
    if (res.status !== 200) {
      record(1, false, `webhook returned ${res.status}: ${JSON.stringify(res.body)}`);
      return;
    }

    const attId = await findAttendeeId(email);
    const booking = attId ? await findLatestBooking(attId) : null;
    const eventCount = await countEventsByLabel(label);

    if (!booking) {
      record(1, false, 'no booking found');
    } else if (booking.event_id !== preseededEventId) {
      record(1, false, `expected booking.event_id=${preseededEventId}, got ${booking.event_id}`);
    } else if (eventCount !== 1) {
      record(1, false, `expected 1 event with label, got ${eventCount}`);
    } else {
      record(1, true);
    }
  } catch (err) {
    record(1, false, err.message);
  } finally {
    await cleanupTestData([email], [label]);
  }
}

// ---------- SCENARIO 2 ----------
async function scenario2() {
  const email = 'test-auto-create-2@example.com';
  const label = 'Tue 9 February, 15:00–18:00';
  try {
    // Ensure no event exists with this label
    await supabaseAdmin.from('events').delete().eq('session_label', label);

    // Pre-seed pending (matched_event_id null)
    const { error: penErr } = await supabaseAdmin
      .from('pending_event_selections')
      .insert({
        email,
        masterclass_date_label: label,
        matched_event_id: null,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
    if (penErr) throw new Error(`pre-seed pending: ${penErr.message}`);

    const orderId = nextOrderId();
    const res = await postWebhook(
      buildSystemePayload({ email, sessionLabel: label, orderId, contactId: orderId })
    );
    if (res.status !== 200) {
      record(2, false, `webhook returned ${res.status}: ${JSON.stringify(res.body)}`);
      return;
    }

    const newEvent = await findEventBySessionLabel(label);
    const attId = await findAttendeeId(email);
    const booking = attId ? await findLatestBooking(attId) : null;
    const pending = await findPendingByEmail(email);

    const problems = [];
    if (!newEvent) problems.push('event not auto-created');
    else {
      if (!newEvent.auto_created) problems.push('auto_created should be true');
      if (newEvent.session_date !== '2027-02-09')
        problems.push(`session_date expected 2027-02-09, got ${newEvent.session_date}`);
      // parseRadioLabel returns ISO in UTC for Feb (GMT) → 15:00 GMT = 15:00Z
      const startIso = new Date(newEvent.start_time).toISOString();
      if (startIso !== '2027-02-09T15:00:00.000Z')
        problems.push(`start_time expected 2027-02-09T15:00:00.000Z, got ${startIso}`);
      const endIso = new Date(newEvent.end_time).toISOString();
      if (endIso !== '2027-02-09T18:00:00.000Z')
        problems.push(`end_time expected 2027-02-09T18:00:00.000Z, got ${endIso}`);
    }
    if (!booking) problems.push('no booking found');
    else if (newEvent && booking.event_id !== newEvent.id)
      problems.push(`booking.event_id=${booking.event_id} but event.id=${newEvent.id}`);
    if (!pending) problems.push('pending row missing');
    else if (newEvent && pending.matched_event_id !== newEvent.id)
      problems.push(`pending.matched_event_id=${pending.matched_event_id} but event.id=${newEvent.id}`);

    if (problems.length === 0) record(2, true);
    else record(2, false, problems.join('; '));
  } catch (err) {
    record(2, false, err.message);
  } finally {
    await cleanupTestData([email], [label]);
  }
}

// ---------- SCENARIO 3 ----------
async function scenario3() {
  const email = 'test-auto-create-3@example.com';
  const label = 'garbage';
  try {
    await supabaseAdmin.from('events').delete().eq('session_label', label);

    const { error: penErr } = await supabaseAdmin
      .from('pending_event_selections')
      .insert({
        email,
        masterclass_date_label: label,
        matched_event_id: null,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
    if (penErr) throw new Error(`pre-seed pending: ${penErr.message}`);

    const orderId = nextOrderId();
    const res = await postWebhook(
      buildSystemePayload({ email, sessionLabel: label, orderId, contactId: orderId })
    );
    if (res.status !== 200) {
      record(3, false, `webhook returned ${res.status}: ${JSON.stringify(res.body)}`);
      return;
    }

    const eventCount = await countEventsByLabel(label);
    const attId = await findAttendeeId(email);
    const booking = attId ? await findLatestBooking(attId) : null;

    const problems = [];
    if (eventCount !== 0) problems.push(`expected 0 events with label "garbage", got ${eventCount}`);
    if (!booking) problems.push('no booking found');
    else if (booking.event_id !== null)
      problems.push(`expected booking.event_id=null, got ${booking.event_id}`);

    if (problems.length === 0) record(3, true);
    else record(3, false, problems.join('; '));
  } catch (err) {
    record(3, false, err.message);
  } finally {
    await cleanupTestData([email], [label]);
  }
}

// ---------- SCENARIO 4 ----------
async function scenario4() {
  const emailA = 'test-auto-create-4a@example.com';
  const emailB = 'test-auto-create-4b@example.com';
  const label = 'Wed 10 February, 16:00–19:00';
  try {
    await supabaseAdmin.from('events').delete().eq('session_label', label);

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { error: penErr } = await supabaseAdmin
      .from('pending_event_selections')
      .insert([
        {
          email: emailA,
          masterclass_date_label: label,
          matched_event_id: null,
          expires_at: expiresAt,
        },
        {
          email: emailB,
          masterclass_date_label: label,
          matched_event_id: null,
          expires_at: expiresAt,
        },
      ]);
    if (penErr) throw new Error(`pre-seed pending: ${penErr.message}`);

    const orderA = nextOrderId();
    const orderB = nextOrderId();

    // Fire concurrently
    const [resA, resB] = await Promise.all([
      postWebhook(
        buildSystemePayload({ email: emailA, sessionLabel: label, orderId: orderA, contactId: orderA })
      ),
      postWebhook(
        buildSystemePayload({ email: emailB, sessionLabel: label, orderId: orderB, contactId: orderB })
      ),
    ]);

    if (resA.status !== 200 || resB.status !== 200) {
      record(4, false, `A=${resA.status} B=${resB.status}`);
      return;
    }

    // Count events
    const { data: events } = await supabaseAdmin
      .from('events')
      .select('id')
      .eq('session_label', label);
    const eventCount = (events ?? []).length;
    const eventId = events?.[0]?.id ?? null;

    const attA = await findAttendeeId(emailA);
    const attB = await findAttendeeId(emailB);
    const bookingA = attA ? await findLatestBooking(attA) : null;
    const bookingB = attB ? await findLatestBooking(attB) : null;
    const pendingA = await findPendingByEmail(emailA);
    const pendingB = await findPendingByEmail(emailB);

    const problems = [];
    if (eventCount !== 1) problems.push(`expected exactly 1 event, got ${eventCount}`);
    if (!bookingA || bookingA.event_id !== eventId)
      problems.push(`bookingA.event_id=${bookingA?.event_id}, expected ${eventId}`);
    if (!bookingB || bookingB.event_id !== eventId)
      problems.push(`bookingB.event_id=${bookingB?.event_id}, expected ${eventId}`);
    if (!pendingA || pendingA.matched_event_id !== eventId)
      problems.push(`pendingA.matched_event_id=${pendingA?.matched_event_id}, expected ${eventId}`);
    if (!pendingB || pendingB.matched_event_id !== eventId)
      problems.push(`pendingB.matched_event_id=${pendingB?.matched_event_id}, expected ${eventId}`);

    if (problems.length === 0) record(4, true);
    else record(4, false, problems.join('; '));
  } catch (err) {
    record(4, false, err.message);
  } finally {
    await cleanupTestData([emailA, emailB], [label]);
  }
}

// ---------- main ----------
(async () => {
  // Sanity: dev server reachable?
  try {
    const ping = await fetch('http://localhost:3000/api/webhooks/systeme');
    if (ping.status !== 405 && ping.status !== 200) {
      console.error(`Dev server returned unexpected ${ping.status}. Is npm run dev running?`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Cannot reach http://localhost:3000 — start \`npm run dev\` first.\n${err.message}`);
    process.exit(1);
  }

  await scenario1();
  await scenario2();
  await scenario3();
  await scenario4();

  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`\n===== ${passed}/${total} scenarios passed =====`);
  process.exit(passed === total ? 0 : 1);
})();
