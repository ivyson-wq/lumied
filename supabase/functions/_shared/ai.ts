// ═══════════════════════════════════════════════════════
//  Shared: AI Service — Gemini Flash API wrapper
//  Camada nativa de inteligência operacional
// ═══════════════════════════════════════════════════════

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

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
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) { console.log("[AI] GEMINI_API_KEY não configurada"); return null; }

  const model = options.model || "gemini-2.0-flash";

  const contents: any[] = [];

  // System instruction via systemInstruction field
  const systemInstruction = options.system ? { parts: [{ text: options.system }] } : undefined;

  contents.push({ role: "user", parts: [{ text: prompt }] });

  const body: any = {
    contents,
    generationConfig: {
      maxOutputTokens: options.maxTokens || 500,
      temperature: options.temperature ?? 0.7,
    },
  };
  if (systemInstruction) body.systemInstruction = systemInstruction;

  try {
    const res = await fetch(`${GEMINI_URL}/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error("[AI] Gemini error:", res.status, await res.text());
      return null;
    }

    const data = await res.json() as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const tokensIn = data.usageMetadata?.promptTokenCount || 0;
    const tokensOut = data.usageMetadata?.candidatesTokenCount || 0;
    // Gemini Flash: free tier up to 15 RPM, paid ~$0.075/M input, $0.30/M output
    const cost = (tokensIn * 0.0000004) + (tokensOut * 0.0000016);

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
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) { console.log("[AI] GEMINI_API_KEY não configurada"); return null; }

  const model = "gemini-2.0-flash";
  const systemInstruction = options.system ? { parts: [{ text: options.system }] } : undefined;

  const body: any = {
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType, data: imageBase64 } },
        { text: prompt },
      ],
    }],
    generationConfig: { maxOutputTokens: options.maxTokens || 300, temperature: 0.3 },
  };
  if (systemInstruction) body.systemInstruction = systemInstruction;

  try {
    const res = await fetch(`${GEMINI_URL}/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error("[AI] Gemini vision error:", res.status, await res.text());
      return null;
    }

    const data = await res.json() as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const tokensIn = data.usageMetadata?.promptTokenCount || 0;
    const tokensOut = data.usageMetadata?.candidatesTokenCount || 0;
    const cost = (tokensIn * 0.0000004) + (tokensOut * 0.0000016);

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
