// ═══════════════════════════════════════════════════════════════
//  MCP Tools — Dev scope (Lumied development only)
//
//  Reserved for local dev + staff automation (ticket-resolver loop).
//  Requires MCP_DEV_KEY env var or dev scope token.
// ═══════════════════════════════════════════════════════════════

import type { McpTool } from "../_shared/mcp.ts";

export const devTools: McpTool[] = [
  // ─── Migrations ───────────────────────────────────────────────
  {
    name: "list_migrations",
    description:
      "Lista as migrations SQL do projeto (arquivos em supabase/migrations). " +
      "Retorna os últimos N nomes em ordem decrescente.",
    scope: "dev",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", default: 20, maximum: 100 },
      },
    },
    handler: async ({ limit = 20 }) => {
      // Edge function can't read local files — use Management API schema query
      const accessToken = Deno.env.get("SUPABASE_ACCESS_TOKEN");
      const projectRef = Deno.env.get("SUPABASE_PROJECT_REF") ||
        "brgorknbrjlfwvrrlwxj";
      if (!accessToken) {
        throw new Error(
          "SUPABASE_ACCESS_TOKEN não configurado. Este tool lê o schema_migrations via Management API.",
        );
      }
      const res = await fetch(
        `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: `SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT ${
              Math.min(limit as number, 100)
            }`,
          }),
        },
      );
      if (!res.ok) throw new Error(`Management API: ${res.status}`);
      const rows = await res.json();
      return { migrations: rows };
    },
  },

  // ─── Describe table ───────────────────────────────────────────
  {
    name: "describe_table",
    description:
      "Retorna as colunas de uma tabela (nome, tipo, nullable, default). " +
      "Útil para entender o schema antes de escrever queries.",
    scope: "dev",
    inputSchema: {
      type: "object",
      required: ["tabela"],
      properties: {
        tabela: { type: "string", description: "Nome da tabela" },
        schema: { type: "string", default: "public" },
      },
    },
    handler: async ({ tabela, schema = "public" }) => {
      const accessToken = Deno.env.get("SUPABASE_ACCESS_TOKEN");
      const projectRef = Deno.env.get("SUPABASE_PROJECT_REF") ||
        "brgorknbrjlfwvrrlwxj";
      if (!accessToken) throw new Error("SUPABASE_ACCESS_TOKEN não configurado");
      const tabelaSafe = String(tabela).replace(/[^a-zA-Z0-9_]/g, "");
      const schemaSafe = String(schema).replace(/[^a-zA-Z0-9_]/g, "");
      if (!tabelaSafe || tabelaSafe.length > 63) throw new Error("Nome de tabela inválido.");
      if (!schemaSafe || schemaSafe.length > 63) throw new Error("Nome de schema inválido.");
      const ALLOWED_SCHEMAS = ["public", "auth", "storage", "extensions", "cron", "net"];
      if (!ALLOWED_SCHEMAS.includes(schemaSafe)) throw new Error(`Schema não permitido: ${schemaSafe}`);
      const res = await fetch(
        `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: `SELECT column_name, data_type, is_nullable, column_default
                    FROM information_schema.columns
                    WHERE table_schema = '${schemaSafe}' AND table_name = '${tabelaSafe}'
                    ORDER BY ordinal_position`,
          }),
        },
      );
      if (!res.ok) throw new Error(`Management API: ${res.status}`);
      const cols = await res.json();
      if (!Array.isArray(cols) || cols.length === 0) {
        throw new Error(`Tabela não encontrada: ${schemaSafe}.${tabelaSafe}`);
      }
      return { tabela: `${schemaSafe}.${tabelaSafe}`, colunas: cols };
    },
  },

  // ─── Health check ─────────────────────────────────────────────
  {
    name: "health_check",
    description:
      "Executa health check do Supabase (DB + Storage latency). " +
      "Útil para diagnosticar problemas de infraestrutura.",
    scope: "dev",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/health`, {
        method: "GET",
      });
      return await res.json();
    },
  },

  // ─── Test edge function ──────────────────────────────────────
  {
    name: "invoke_edge_function",
    description:
      "Invoca uma edge function do Lumied com um payload de teste. " +
      "Uso: debug de actions específicas. Requer service role key (já configurada).",
    scope: "dev",
    inputSchema: {
      type: "object",
      required: ["function_name", "payload"],
      properties: {
        function_name: {
          type: "string",
          enum: [
            "admin",
            "api",
            "diplomas",
            "acesso",
            "compliance",
            "ponto",
            "lumied-ai",
            "ticket-resolver",
            "health",
          ],
        },
        payload: {
          type: "object",
          description: "Body JSON (inclui 'action' e parâmetros)",
        },
      },
    },
    handler: async ({ function_name, payload }) => {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const res = await fetch(
        `${supabaseUrl}/functions/v1/${function_name}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
            apikey: serviceKey,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30000),
        },
      );
      const text = await res.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch { /* non-JSON */ }
      return {
        status: res.status,
        ok: res.ok,
        body: json ?? text,
      };
    },
  },

  // ─── Read git-committed CLAUDE.md sections ───────────────────
  {
    name: "get_system_info",
    description:
      "Retorna informações do sistema Lumied: versão, contagens de alunos/escolas/tickets, " +
      "módulos habilitados globalmente, projeto Supabase. Use no início de uma sessão de debug.",
    scope: "dev",
    inputSchema: { type: "object", properties: {} },
    handler: async (_args, { sb }) => {
      const [escolas, alunos, tickets, insights] = await Promise.all([
        sb.from("escolas").select("id", { count: "exact", head: true }).eq("ativo", true),
        sb.from("alunos").select("id", { count: "exact", head: true }).eq("ativo", true),
        sb.from("tickets").select("id", { count: "exact", head: true }).in("status", ["aberto", "escalado"]),
        sb.from("ia_insights").select("id", { count: "exact", head: true }).eq("status", "ativa"),
      ]);
      return {
        projeto: "Lumied",
        supabase_project_ref: Deno.env.get("SUPABASE_PROJECT_REF") || "brgorknbrjlfwvrrlwxj",
        mcp_version: "1.0.0",
        escolas_ativas: escolas.count || 0,
        alunos_ativos: alunos.count || 0,
        tickets_abertos: tickets.count || 0,
        insights_ativos: insights.count || 0,
        timestamp: new Date().toISOString(),
      };
    },
  },
];
