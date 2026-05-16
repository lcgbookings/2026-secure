#!/usr/bin/env node
// Backfill Typeform sign-in + post-session CSVs by replaying each row as a
// synthetic webhook payload to /api/webhooks/typeform.
//
// Usage:
//   node scripts/backfill-typeforms.mjs           # localhost:3000
//   node scripts/backfill-typeforms.mjs --prod    # 2026-secure.vercel.app

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---------- env ----------
function readSecret() {
  const envPath = resolve(ROOT, '.env.local');
  if (!existsSync(envPath)) {
    console.error(`Cannot find ${envPath}`);
    process.exit(1);
  }
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key === 'TYPEFORM_WEBHOOK_SECRET') return value;
  }
  console.error('TYPEFORM_WEBHOOK_SECRET not found in .env.local');
  process.exit(1);
}

const SECRET = readSecret();
const PROD = process.argv.includes('--prod');
const BASE = PROD ? 'https://2026-secure.vercel.app' : 'http://localhost:3000';
const URL = `${BASE}/api/webhooks/typeform?secret=${encodeURIComponent(SECRET)}`;

console.log(`Target: ${BASE}\n`);

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normaliseSubmittedAt(raw) {
  if (!raw) return new Date().toISOString();
  return raw.endsWith('Z') ? raw : `${raw}Z`;
}

function readCsv(filename) {
  const path = resolve(ROOT, 'data', filename);
  if (!existsSync(path)) {
    console.error(`CSV not found: ${path}`);
    process.exit(1);
  }
  const text = readFileSync(path, 'utf8');
  return parse(text, { columns: true, skip_empty_lines: true });
}

function findColumn(row, predicate) {
  for (const key of Object.keys(row)) {
    if (predicate(key)) return key;
  }
  return null;
}

// ---------- payload builders ----------
function buildSigninPayload(row) {
  const answers = [];

  answers.push({
    type: 'email',
    email: row['Email'],
    field: { id: 'email', type: 'email' },
  });

  const firstRaw = row['Is this your first session with us?'];
  if (firstRaw === '1' || firstRaw === 1 || firstRaw === '0' || firstRaw === 0) {
    answers.push({
      type: 'boolean',
      boolean: firstRaw === '1' || firstRaw === 1,
      field: { id: 'first', type: 'yes_no' },
    });
  }

  const hear = row['How did you hear about this session?'];
  if (hear && String(hear).trim()) {
    answers.push({
      type: 'choice',
      choice: { label: String(hear).trim() },
      field: { id: 'hear', type: 'multiple_choice' },
    });
  }

  // First non-empty of the 5 detail columns
  const detailCols = [
    { col: 'Who told you about us?', id: 'who_told' },
    { col: 'Which Instagram page did you see us on?', id: 'ig_page' },
    { col: 'Which TikTok page did you see us on?', id: 'tt_page' },
    { col: 'Where did you see us on LinkedIn?', id: 'li_where' },
    { col: 'What did you search for?', id: 'search' },
  ];
  for (const { col, id } of detailCols) {
    const v = row[col];
    if (v && String(v).trim()) {
      answers.push({
        type: 'text',
        text: String(v).trim(),
        field: { id, type: 'short_text' },
      });
      break;
    }
  }

  // Confidence: long title with parenthetical - match by prefix
  const confCol = findColumn(row, (k) =>
    k.startsWith('On a scale of 1 to 10, how confident')
  );
  if (confCol) {
    const n = parseInt(row[confCol], 10);
    if (!Number.isNaN(n)) {
      answers.push({
        type: 'number',
        number: n,
        field: { id: 'conf', type: 'number' },
      });
    }
  }

  return {
    event_type: 'form_response',
    form_response: {
      form_id: 'q1H28ZpT',
      token: row['#'],
      submitted_at: normaliseSubmittedAt(row['Submit Date (UTC)']),
      definition: {
        fields: [
          { id: 'email', title: 'Email', type: 'email' },
          { id: 'first', title: 'Is this your first session with us?', type: 'yes_no' },
          { id: 'hear', title: 'How did you hear about this session?', type: 'multiple_choice' },
          { id: 'who_told', title: 'Who told you about us?', type: 'short_text' },
          { id: 'ig_page', title: 'Which Instagram page did you see us on?', type: 'short_text' },
          { id: 'tt_page', title: 'Which TikTok page did you see us on?', type: 'short_text' },
          { id: 'li_where', title: 'Where did you see us on LinkedIn?', type: 'short_text' },
          { id: 'search', title: 'What did you search for?', type: 'short_text' },
          {
            id: 'conf',
            title:
              'On a scale of 1 to 10, how confident are you in your communication abilities?',
            type: 'number',
          },
        ],
      },
      answers,
    },
  };
}

function buildPostSessionPayload(row) {
  const answers = [];

  answers.push({
    type: 'email',
    email: row['Email'],
    field: { id: 'email', type: 'email' },
  });

  // Value rating: long title with curly apostrophe + en dash
  const valueCol = findColumn(row, (k) =>
    k.startsWith('On a scale of 1–1') // "On a scale of 1–1"
  );
  if (valueCol) {
    const n = parseInt(row[valueCol], 10);
    if (!Number.isNaN(n)) {
      answers.push({
        type: 'number',
        number: n,
        field: { id: 'value', type: 'number' },
      });
    }
  }

  const insightCol = findColumn(row, (k) =>
    k.startsWith('What was the most useful insight')
  );
  if (insightCol && row[insightCol] && String(row[insightCol]).trim()) {
    answers.push({
      type: 'text',
      text: String(row[insightCol]).trim(),
      field: { id: 'insight', type: 'long_text' },
    });
  }

  const relevance = row['How relevant is this work to where you are right now?'];
  if (relevance && String(relevance).trim()) {
    answers.push({
      type: 'choice',
      choice: { label: String(relevance).trim() },
      field: { id: 'relevance', type: 'multiple_choice' },
    });
  }

  const hardestCol = findColumn(row, (k) =>
    k.startsWith('When it comes to communicating under pressure')
  );
  if (hardestCol && row[hardestCol] && String(row[hardestCol]).trim()) {
    answers.push({
      type: 'text',
      text: String(row[hardestCol]).trim(),
      field: { id: 'hardest', type: 'long_text' },
    });
  }

  const reflectsCol = findColumn(row, (k) =>
    k.startsWith('Based on what you')
  );
  if (reflectsCol && row[reflectsCol] && String(row[reflectsCol]).trim()) {
    answers.push({
      type: 'choice',
      choice: { label: String(row[reflectsCol]).trim() },
      field: { id: 'reflects', type: 'multiple_choice' },
    });
  }

  return {
    event_type: 'form_response',
    form_response: {
      form_id: 'taq9E9Mt',
      token: row['#'],
      submitted_at: normaliseSubmittedAt(row['Submit Date (UTC)']),
      definition: {
        fields: [
          { id: 'email', title: 'Email', type: 'email' },
          {
            id: 'value',
            title: "On a scale of 1–10, how valuable was today's masterclass for you?",
            type: 'number',
          },
          {
            id: 'insight',
            title:
              'What was the most useful insight, moment, or realisation for you today?',
            type: 'long_text',
          },
          {
            id: 'relevance',
            title: 'How relevant is this work to where you are right now?',
            type: 'multiple_choice',
          },
          {
            id: 'hardest',
            title:
              'When it comes to communicating under pressure, what do you find hardest right now?',
            type: 'long_text',
          },
          {
            id: 'reflects',
            title:
              "Based on what you've experienced today, which best reflects where you are right now?",
            type: 'multiple_choice',
          },
        ],
      },
      answers,
    },
  };
}

// ---------- core POST ----------
async function postPayload(payload) {
  let res;
  try {
    res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error(
      `\nConnection failed: ${err.message}\nStart the dev server with \`npm run dev\` first, then re-run this script.`
    );
    process.exit(1);
  }

  let body = {};
  try {
    body = await res.json();
  } catch {
    body = { error: `non-JSON response (${res.status})` };
  }

  if (body.bookingId) return { status: 'enriched', body };
  if (body.pendingId) return { status: 'pending', body };
  return { status: 'skipped', body };
}

// ---------- main ----------
async function processFile({ rows, label, build }) {
  const counts = { enriched: 0, pending: 0, skipped: 0 };
  const total = rows.length;

  for (let i = 0; i < total; i++) {
    const row = rows[i];
    const idx = `${i + 1}/${total}`;
    const email = row['Email'] && String(row['Email']).trim();
    const responseType = row['Response Type'];

    if (!email) {
      counts.skipped += 1;
      console.log(`[${label} ${idx}] (no email) → skipped (no email)`);
      continue;
    }

    if (responseType !== 'completed') {
      counts.skipped += 1;
      console.log(`[${label} ${idx}] ${email} → skipped (Response Type=${responseType || 'empty'})`);
      continue;
    }

    const payload = build(row);
    const { status, body } = await postPayload(payload);
    counts[status] += 1;

    let detail = '';
    if (status === 'enriched') detail = ` (bookingId: ${body.bookingId})`;
    else if (status === 'pending') detail = ` (pendingId: ${body.pendingId})`;
    else if (body.skipped) detail = ` (${body.skipped})`;
    else if (body.error) detail = ` (${body.error})`;
    console.log(`[${label} ${idx}] ${email} → ${status}${detail}`);

    await sleep(100);
  }

  return { total, counts };
}

(async () => {
  const signinRows = readCsv('signin-responses.csv');
  const postRows = readCsv('post-session-responses.csv');

  const signinResult = await processFile({
    rows: signinRows,
    label: 'signin',
    build: buildSigninPayload,
  });

  const postResult = await processFile({
    rows: postRows,
    label: 'post-session',
    build: buildPostSessionPayload,
  });

  console.log('\n===== SUMMARY =====');
  console.log(`Sign-ins processed: ${signinResult.total}`);
  console.log(`  enriched: ${signinResult.counts.enriched}`);
  console.log(`  pending:  ${signinResult.counts.pending}`);
  console.log(`  skipped:  ${signinResult.counts.skipped}`);
  console.log(`Post-sessions processed: ${postResult.total}`);
  console.log(`  enriched: ${postResult.counts.enriched}`);
  console.log(`  pending:  ${postResult.counts.pending}`);
  console.log(`  skipped:  ${postResult.counts.skipped}`);
})();
