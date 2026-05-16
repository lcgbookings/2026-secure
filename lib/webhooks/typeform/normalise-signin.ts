import type { TypeformWebhookPayload } from './types';

export interface NormalisedSigninResponse {
  email: string | null;
  is_first_session: boolean | null;
  referral_source: string | null;
  referral_detail: string | null;
  pre_session_confidence: number | null;
  form_id: string;
  response_token: string;
  submitted_at: string;
}

const REFERRAL_LABEL_MAP: Record<string, string> = {
  'instagram': 'instagram',
  'word of mouth': 'word_of_mouth',
  'eventbrite': 'eventbrite',
  'tiktok': 'tiktok',
  'organisation': 'organisation_employer',
  'employer': 'organisation_employer',
  'search': 'search',
  'google': 'search',
};

function slugifyReferralSource(label: string | undefined): string | null {
  if (!label) return null;
  const normalised = label.toLowerCase().trim();
  for (const [key, value] of Object.entries(REFERRAL_LABEL_MAP)) {
    if (normalised.includes(key)) return value;
  }
  return 'other';
}

// Reuse the same title-keyword matcher pattern from pre-event normaliser.
// Pulled inline here to avoid cross-imports between sibling normalisers.
function findAnswerByTitleKeyword(
  payload: TypeformWebhookPayload,
  keywords: string[]
): unknown {
  const definition = payload.form_response?.definition?.fields ?? [];
  const answers = payload.form_response?.answers ?? [];
  const matchedField = definition.find((field) => {
    if (!field.title) return false;
    const title = field.title.toLowerCase();
    return keywords.every((kw) => title.includes(kw.toLowerCase()));
  });
  if (!matchedField?.id) return null;
  const matchedAnswer = answers.find((a) => a.field?.id === matchedField.id);
  return matchedAnswer ?? null;
}

export function normaliseSigninPayload(
  payload: TypeformWebhookPayload
): NormalisedSigninResponse {
  const formId = payload.form_response?.form_id ?? '';
  const responseToken = payload.form_response?.token ?? '';
  const submittedAt = payload.form_response?.submitted_at ?? new Date().toISOString();

  // Email
  let email: string | null = null;
  const emailAnswer = payload.form_response?.answers?.find(
    (a) => a.type === 'email' || a.field?.type === 'email'
  );
  if (emailAnswer?.email) email = emailAnswer.email.trim().toLowerCase();

  // Is first session - yes/no field
  // The CSV shows 1/0, so Typeform sends boolean. Could also be a multiple_choice with Yes/No labels.
  let is_first_session: boolean | null = null;
  const firstSessionAnswer = findAnswerByTitleKeyword(payload, ['first session']) as
    | { type?: string; boolean?: boolean; choice?: { label?: string } }
    | null;
  if (firstSessionAnswer) {
    if (typeof firstSessionAnswer.boolean === 'boolean') {
      is_first_session = firstSessionAnswer.boolean;
    } else if (firstSessionAnswer.choice?.label) {
      const label = firstSessionAnswer.choice.label.toLowerCase();
      is_first_session = label.includes('yes') || label === '1' || label === 'true';
    }
  }

  // Referral source
  const referralAnswer = findAnswerByTitleKeyword(payload, ['hear', 'session']) as
    | { choice?: { label?: string } }
    | null;
  const referral_source = slugifyReferralSource(referralAnswer?.choice?.label);

  // Referral detail - the conditional follow-up text. Could be any of:
  // "Who told you", "Which Instagram page", "Which TikTok page",
  // "Where did you see us on LinkedIn", "What did you search for"
  // Find whichever one has a non-empty text answer.
  let referral_detail: string | null = null;
  const detailKeywords: string[][] = [
    ['who', 'told'],
    ['instagram', 'page'],
    ['tiktok', 'page'],
    ['linkedin'],
    ['search'],
  ];
  for (const kws of detailKeywords) {
    const ans = findAnswerByTitleKeyword(payload, kws) as { text?: string } | null;
    if (ans?.text && ans.text.trim()) {
      referral_detail = ans.text.trim();
      break;
    }
  }

  // Pre-session confidence
  const confidenceAnswer = findAnswerByTitleKeyword(payload, ['confident', 'communication']) as
    | { number?: number }
    | null;
  const pre_session_confidence =
    typeof confidenceAnswer?.number === 'number' ? confidenceAnswer.number : null;

  return {
    email,
    is_first_session,
    referral_source,
    referral_detail,
    pre_session_confidence,
    form_id: formId,
    response_token: responseToken,
    submitted_at: submittedAt,
  };
}
