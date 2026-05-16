export interface TypeformWebhookPayload {
  event_id?: string;
  event_type?: string;
  form_response?: {
    form_id?: string;
    token?: string;
    submitted_at?: string;
    definition?: {
      fields?: Array<{
        id?: string;
        ref?: string;
        title?: string;
        type?: string;
      }>;
    };
    answers?: Array<{
      type?: string;
      text?: string;
      email?: string;
      number?: number;
      boolean?: boolean;
      date?: string;
      url?: string;
      choice?: { label?: string; ref?: string };
      choices?: { labels?: string[]; refs?: string[] };
      field?: {
        id?: string;
        ref?: string;
        type?: string;
      };
    }>;
    hidden?: Record<string, string>;
  };
}

export interface NormalisedTypeformResponse {
  email: string | null;
  goals: string | null;
  experience_level: string | null;
  responsibility_level: string | null;
  form_id: string;
  response_token: string;
}
