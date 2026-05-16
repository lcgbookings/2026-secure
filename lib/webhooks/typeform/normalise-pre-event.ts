import type {
  TypeformWebhookPayload,
  NormalisedTypeformResponse,
} from './types';

const EXPERIENCE_LABEL_MAP: Record<string, string> = {
  'less than 1 year': 'under_1',
  'less than a year': 'under_1',
  '1-3 years': '1_to_3',
  '1–3 years': '1_to_3',
  '1 to 3 years': '1_to_3',
  '3-5 years': '3_to_5',
  '3–5 years': '3_to_5',
  '3 to 5 years': '3_to_5',
  '5+ years': '5_plus',
  '5 plus years': '5_plus',
  'more than 5 years': '5_plus',
};

const RESPONSIBILITY_LABEL_MAP: Record<string, string> = {
  'influence leadership': 'influence_strategy',
  'influence leadership, culture, or communication strategy': 'influence_strategy',
  'directly influence leadership': 'influence_strategy',
  'manage teams': 'manage_teams',
  'manage teams and represent': 'manage_teams',
  'preparing for or aspiring': 'aspiring_leader',
  'aspiring to leadership': 'aspiring_leader',
};

function slugifyExperience(label: string | undefined): string | null {
  if (!label) return null;
  const normalised = label.toLowerCase().trim();
  for (const [key, value] of Object.entries(EXPERIENCE_LABEL_MAP)) {
    if (normalised.includes(key)) return value;
  }
  return 'other';
}

function slugifyResponsibility(label: string | undefined): string | null {
  if (!label) return null;
  const normalised = label.toLowerCase().trim();
  for (const [key, value] of Object.entries(RESPONSIBILITY_LABEL_MAP)) {
    if (normalised.includes(key)) return value;
  }
  return 'other';
}

function findAnswerByTitleKeyword(
  payload: TypeformWebhookPayload,
  keywords: string[]
): TypeformWebhookPayload['form_response'] extends infer R
  ? R extends { answers?: infer A }
    ? A extends Array<infer Item> | undefined
      ? Item | null
      : null
    : null
  : null {
  const definition = payload.form_response?.definition?.fields ?? [];
  const answers = payload.form_response?.answers ?? [];

  // Find the field whose title contains all keywords (case-insensitive)
  const matchedField = definition.find((field) => {
    if (!field.title) return false;
    const title = field.title.toLowerCase();
    return keywords.every((kw) => title.includes(kw.toLowerCase()));
  });

  if (!matchedField?.id) return null as never;

  const matchedAnswer = answers.find(
    (answer) => answer.field?.id === matchedField.id
  );

  return (matchedAnswer ?? null) as never;
}

export function normalisePreEventPayload(
  payload: TypeformWebhookPayload
): NormalisedTypeformResponse {
  const formId = payload.form_response?.form_id ?? '';
  const responseToken = payload.form_response?.token ?? '';

  // Email: the dedicated email field type, OR fall back to a field titled "email"
  let email: string | null = null;
  const emailAnswer = payload.form_response?.answers?.find(
    (a) => a.type === 'email' || a.field?.type === 'email'
  );
  if (emailAnswer?.email) {
    email = emailAnswer.email.trim().toLowerCase();
  }

  // Goals: long_text titled with "priority" + "communication"
  const goalsAnswer = findAnswerByTitleKeyword(payload, ['priority', 'communication']);
  const goals = (goalsAnswer as { text?: string } | null)?.text?.trim() ?? null;

  // Experience: multiple_choice titled with "years" + "experience"
  const experienceAnswer = findAnswerByTitleKeyword(payload, ['years', 'experience']);
  const experienceLabel = (experienceAnswer as { choice?: { label?: string } } | null)?.choice?.label;
  const experience_level = slugifyExperience(experienceLabel);

  // Responsibility: multiple_choice titled with "responsibility level" OR "describes" + "current"
  let responsibilityAnswer = findAnswerByTitleKeyword(payload, ['responsibility', 'level']);
  if (!responsibilityAnswer) {
    responsibilityAnswer = findAnswerByTitleKeyword(payload, ['describes', 'current']);
  }
  const responsibilityLabel = (responsibilityAnswer as { choice?: { label?: string } } | null)?.choice?.label;
  const responsibility_level = slugifyResponsibility(responsibilityLabel);

  return {
    email,
    goals,
    experience_level,
    responsibility_level,
    form_id: formId,
    response_token: responseToken,
  };
}
