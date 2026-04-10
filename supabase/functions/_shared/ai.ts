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
  // deno-lint-ignore no-explicit-any
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

    // deno-lint-ignore no-explicit-any
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

  // deno-lint-ignore no-explicit-any
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

    // deno-lint-ignore no-explicit-any
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

// deno-lint-ignore no-explicit-any
export function buildContextFromData(data: Record<string, any>): string {
  return Object.entries(data)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('\n');
}

// ═══════════════════════════════════════════════════════
//  Tool use (agentic loop) — used by MCP integrations
// ═══════════════════════════════════════════════════════

export interface ClaudeTool {
  name: string;
  description: string;
  // deno-lint-ignore no-explicit-any
  input_schema: any;
}

// deno-lint-ignore no-explicit-any
export type ToolExecutor = (name: string, args: Record<string, any>) => Promise<unknown>;

export interface AgenticResponse {
  text: string;
  tool_calls: Array<{ name: string; input: unknown; output: unknown }>;
  tokens_input: number;
  tokens_output: number;
  cost: number;
  stop_reason: string;
}

/**
 * Run Claude with tool use until it produces a final text response.
 * Performs up to `maxTurns` tool-call rounds.
 */
export async function askClaudeWithTools(
  userPrompt: string,
  tools: ClaudeTool[],
  executor: ToolExecutor,
  options: {
    system?: string;
    model?: string;
    maxTokens?: number;
    maxTurns?: number;
    temperature?: number;
  } = {},
): Promise<AgenticResponse | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) { console.log("[AI] ANTHROPIC_API_KEY não configurada"); return null; }

  const model = options.model || "claude-haiku-4-5-20251001";
  const maxTurns = options.maxTurns ?? 6;

  // deno-lint-ignore no-explicit-any
  const messages: any[] = [{ role: "user", content: userPrompt }];
  // deno-lint-ignore no-explicit-any
  const toolCalls: Array<{ name: string; input: any; output: any }> = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let stopReason = "max_turns";
  let finalText = "";

  for (let turn = 0; turn < maxTurns; turn++) {
    // deno-lint-ignore no-explicit-any
    const body: any = {
      model,
      max_tokens: options.maxTokens || 1024,
      messages,
      tools,
    };
    if (options.system) body.system = options.system;
    if (options.temperature !== undefined) body.temperature = options.temperature;

    let res: Response;
    try {
      res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      console.error("[AI] Fetch error:", e);
      return null;
    }

    if (!res.ok) {
      console.error("[AI] Tool-use error:", res.status, await res.text());
      return null;
    }

    // deno-lint-ignore no-explicit-any
    const data = (await res.json()) as any;
    tokensIn += data.usage?.input_tokens || 0;
    tokensOut += data.usage?.output_tokens || 0;
    stopReason = data.stop_reason || "end_turn";

    // Extract text blocks
    // deno-lint-ignore no-explicit-any
    const textBlocks = (data.content || []).filter((b: any) => b.type === "text");
    if (textBlocks.length > 0) {
      // deno-lint-ignore no-explicit-any
      finalText = textBlocks.map((b: any) => b.text).join("\n");
    }

    if (data.stop_reason !== "tool_use") {
      // Done — final text response
      break;
    }

    // Extract tool_use blocks and execute
    // deno-lint-ignore no-explicit-any
    const useBlocks = (data.content || []).filter((b: any) => b.type === "tool_use");
    if (useBlocks.length === 0) break;

    // Add assistant message to history
    messages.push({ role: "assistant", content: data.content });

    // Execute each tool and collect results
    // deno-lint-ignore no-explicit-any
    const toolResults: any[] = [];
    for (const block of useBlocks) {
      let output: unknown;
      let isError = false;
      try {
        output = await executor(block.name, block.input || {});
      } catch (e) {
        output = `Error: ${e instanceof Error ? e.message : String(e)}`;
        isError = true;
      }
      toolCalls.push({ name: block.name, input: block.input, output });
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: typeof output === "string" ? output : JSON.stringify(output),
        is_error: isError,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  const cost = tokensIn * 0.0000044 + tokensOut * 0.000022;
  return {
    text: finalText,
    tool_calls: toolCalls,
    tokens_input: tokensIn,
    tokens_output: tokensOut,
    cost,
    stop_reason: stopReason,
  };
}
