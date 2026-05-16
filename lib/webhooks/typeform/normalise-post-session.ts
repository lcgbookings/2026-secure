import type { TypeformWebhookPayload } from './types';

export interface NormalisedPostSessionResponse {
  email: string | null;
  session_value_rating: number | null;
  most_useful_insight: string | null;
  session_relevance: string | null;
  hardest_under_pressure: string | null;
  coaching_interest: string | null;
  form_id: string;
  response_token: string;
  submitted_at: string;
}

const RELEVANCE_LABEL_MAP: Record<string, string> = {
  'very relevant': 'very_relevant',
  'somewhat relevant': 'somewhat_relevant',
  'interesting': 'interesting_not_priority',
  'not relevant': 'not_relevant',
};

const COACHING_INTEREST_LABEL_MAP: Record<string, string> = {
  'speak before leaving': 'speak_before_leaving',
  'masterclass rate': 'speak_before_leaving',
  'apply via the website': 'apply_via_website',
  'apply via website': 'apply_via_website',
  'not at this time': 'not_at_this_time',
};

function slugifyRelevance(label: string | undefined): string | null {
  if (!label) return null;
  const normalised = label.toLowerCase().trim();
  for (const [key, value] of Object.entries(RELEVANCE_LABEL_MAP)) {
    if (normalised.includes(key)) return value;
  }
  return 'other';
}

function slugifyCoachingInterest(label: string | undefined): string | null {
  if (!label) return null;
  const normalised = label.toLowerCase().trim();
  for (const [key, value] of Object.entries(COACHING_INTEREST_LABEL_MAP)) {
    if (normalised.includes(key)) return value;
  }
  return 'other';
}

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

export function normalisePostSessionPayload(
  payload: TypeformWebhookPayload
): NormalisedPostSessionResponse {
  const formId = payload.form_response?.form_id ?? '';
  const responseToken = payload.form_response?.token ?? '';
  const submittedAt = payload.form_response?.submitted_at ?? new Date().toISOString();

  // Email
  let email: string | null = null;
  const emailAnswer = payload.form_response?.answers?.find(
    (a) => a.type === 'email' || a.field?.type === 'email'
  );
  if (emailAnswer?.email) email = emailAnswer.email.trim().toLowerCase();

  // Value rating: "On a scale of 1-10, how valuable was today's masterclass"
  const valueAnswer = findAnswerByTitleKeyword(payload, ['valuable', 'masterclass']) as
    | { number?: number }
    | null;
  const session_value_rating =
    typeof valueAnswer?.number === 'number' ? valueAnswer.number : null;

  // Most useful insight (long_text)
  const insightAnswer = findAnswerByTitleKeyword(payload, ['useful', 'insight']) as
    | { text?: string }
    | null;
  const most_useful_insight = insightAnswer?.text?.trim() ?? null;

  // Relevance
  const relevanceAnswer = findAnswerByTitleKeyword(payload, ['relevant', 'right now']) as
    | { choice?: { label?: string } }
    | null;
  const session_relevance = slugifyRelevance(relevanceAnswer?.choice?.label);

  // Hardest under pressure (long_text)
  const hardestAnswer = findAnswerByTitleKeyword(payload, ['hardest', 'pressure']) as
    | { text?: string }
    | null;
  const hardest_under_pressure = hardestAnswer?.text?.trim() ?? null;

  // Coaching interest - the killer question
  const coachingAnswer = findAnswerByTitleKeyword(payload, ['reflects', 'right now']) as
    | { choice?: { label?: string } }
    | null;
  const coaching_interest = slugifyCoachingInterest(coachingAnswer?.choice?.label);

  return {
    email,
    session_value_rating,
    most_useful_insight,
    session_relevance,
    hardest_under_pressure,
    coaching_interest,
    form_id: formId,
    response_token: responseToken,
    submitted_at: submittedAt,
  };
}
