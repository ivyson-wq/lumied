export interface Env {
  WHATSAPP_TOKEN: string;
  WHATSAPP_VERIFY_TOKEN: string;
  META_APP_SECRET?: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  GEMINI_API_KEY: string;
  OPENAI_API_KEY: string;
  APP_INTERNAL_SECRET: string;
  APP_BASE_URL: string;
}

export interface WhatsAppMessage {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
  image?: { id: string; mime_type: string; sha256: string; caption?: string };
  document?: { id: string; mime_type: string; sha256: string; filename?: string; caption?: string };
  audio?: { id: string; mime_type: string };
  timestamp: string;
}

export interface WhatsAppWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      field: string;
      value: {
        metadata: { phone_number_id: string };
        messages?: WhatsAppMessage[];
        statuses?: Array<{ id: string; status: string; recipient_id: string }>;
      };
    }>;
  }>;
}

export interface Familia {
  id: string;
  nome: string;
  whatsapp: string;
  aluno_nome: string;
  turma_id: string;
  escola_id: string;
  opt_in: boolean;
}
