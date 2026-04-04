// ═══════════════════════════════════════════════════════
//  Shared: AI Service — Claude API wrapper (Anthropic)
//  Camada nativa de inteligência operacional
// ═══════════════════════════════════════════════════════

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export interface AIResponse {
  text: string;
  tokens_input: number;
  tokens_output: number;
  cost: number; // R$ estimado
}

export async function askClaude(
  prompt: string,
  options: {
    system?: string;
    maxTokens?: number;
    model?: string;
    temperature?: number;
  } = {}
): Promise<AIResponse | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) { console.log("[AI] ANTHROPIC_API_KEY não configurada"); return null; }

  const model = options.model || "claude-haiku-4-5-20251001";
  const body: any = {
    model,
    max_tokens: options.maxTokens || 500,
    messages: [{ role: "user", content: prompt }],
  };
  if (options.system) body.system = options.system;
  if (options.temperature !== undefined) body.temperature = options.temperature;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error("[AI] Claude error:", res.status, await res.text());
      return null;
    }

    const data = await res.json() as any;
    const text = data.content?.[0]?.text || "";
    const tokensIn = data.usage?.input_tokens || 0;
    const tokensOut = data.usage?.output_tokens || 0;
    // Haiku: $0.80/M input, $4.00/M output
    const cost = (tokensIn * 0.0000044) + (tokensOut * 0.000022);

    return { text, tokens_input: tokensIn, tokens_output: tokensOut, cost };
  } catch (e) {
    console.error("[AI] Fetch error:", e);
    return null;
  }
}

/**
 * Ask with image (vision) — for document classification
 */
export async function askWithImage(
  prompt: string,
  imageBase64: string,
  mimeType: string,
  options: { system?: string; maxTokens?: number } = {}
): Promise<AIResponse | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) { console.log("[AI] ANTHROPIC_API_KEY não configurada"); return null; }

  const body: any = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: options.maxTokens || 300,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
        { type: "text", text: prompt },
      ],
    }],
  };
  if (options.system) body.system = options.system;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error("[AI] Claude vision error:", res.status, await res.text());
      return null;
    }

    const data = await res.json() as any;
    const text = data.content?.[0]?.text || "";
    const tokensIn = data.usage?.input_tokens || 0;
    const tokensOut = data.usage?.output_tokens || 0;
    const cost = (tokensIn * 0.0000044) + (tokensOut * 0.000022);

    return { text, tokens_input: tokensIn, tokens_output: tokensOut, cost };
  } catch (e) {
    console.error("[AI] Fetch error:", e);
    return null;
  }
}

export const SYSTEM_PROMPTS = {
  gerente: `Você é a Lumi, assistente de inteligência operacional da plataforma Lumied.
Você analisa dados reais da escola e gera insights acionáveis para a direção.
Seja direta, use números, e sempre sugira uma ação concreta.
Responda em português brasileiro. Máximo 3-4 frases por insight.
Nunca invente dados — use apenas o que foi fornecido como contexto.`,

  professora: `Você é a Lumi, assistente inteligente da plataforma Lumied.
Você ajuda professoras com análises de turma, sugestões pedagógicas e comunicação com famílias.
Seja acolhedora, prática e focada em ação.
Responda em português brasileiro. Máximo 3-4 frases.`,

  pais: `Você é a Lumi, assistente da escola no portal dos pais.
Responda dúvidas sobre notas, frequência, eventos e pagamentos.
Seja calorosa, clara e objetiva. Use linguagem acessível.
Responda em português brasileiro. Máximo 2-3 frases.`,

  admin: `Você é a Lumi, assistente de gestão SaaS da plataforma Lumied.
Analise métricas de uso, churn risk, adoção de módulos e saúde das escolas.
Foco em dados, tendências e recomendações estratégicas.
Responda em português brasileiro.`,
};

export function buildContextFromData(data: Record<string, any>): string {
  return Object.entries(data)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('\n');
}
