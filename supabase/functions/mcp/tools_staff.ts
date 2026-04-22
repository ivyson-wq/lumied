// ═══════════════════════════════════════════════════════════════
//  MCP Tools — Staff scope (Lumied internal operations)
//
//  Tools for the Lumied staff team: ticket triage, diagnosis,
//  deploy, SQL queries, escola health checks.
// ═══════════════════════════════════════════════════════════════

import type { McpTool } from "../_shared/mcp.ts";

export const staffTools: McpTool[] = [
  // ─── Tickets ───────────────────────────────────────────────────
  {
    name: "tickets_list_open",
    description:
      "Lista tickets de suporte abertos (status 'aberto' ou 'escalado'). " +
      "Retorna id, numero, tipo, portal, email, descricao e url_pagina. " +
      "Use limit para paginar (default 20).",
    scope: "staff",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        status: {
          type: "string",
          enum: ["aberto", "escalado", "respondido", "todos"],
          default: "aberto",
        },
      },
    },
    handler: async ({ limit = 20, status = "aberto" }, { sb }) => {
      let q = sb
        .from("tickets")
        .select(
          "id, numero, tipo, portal, email, nome, descricao, url_pagina, status, tratamento, criado_em",
        )
        .order("criado_em", { ascending: true })
        .limit(Math.min(limit as number, 100));
      if (status !== "todos") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { count: data?.length || 0, tickets: data || [] };
    },
  },
  {
    name: "ticket_get",
    description:
      "Busca detalhes completos de um ticket pelo ID ou número. " +
      "Retorna todos os campos incluindo user_agent, resolucao_tela, screenshot.",
    scope: "staff",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "UUID do ticket" },
        numero: { type: "integer", description: "Número sequencial (#1001+)" },
      },
    },
    handler: async ({ id, numero }, { sb }) => {
      if (!id && !numero) throw new Error("id ou numero obrigatório");
      let q = sb.from("tickets").select("*");
      q = id ? q.eq("id", id) : q.eq("numero", numero);
      const { data, error } = await q.maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Ticket não encontrado");
      return data;
    },
  },
  {
    name: "ticket_respond",
    description:
      "Responde e fecha um ticket de suporte. Marca status='respondido' e envia email ao usuário via Resend. " +
      "Use esta ferramenta após diagnosticar o problema e ter uma solução ou explicação.",
    scope: "staff",
    inputSchema: {
      type: "object",
      required: ["id", "resposta"],
      properties: {
        id: { type: "string", description: "UUID do ticket" },
        resposta: { type: "string", description: "Mensagem de resposta ao usuário" },
        tratamento: {
          type: "string",
          description: "Anotação interna sobre o tratamento aplicado (não visível ao usuário)",
        },
        proximos_passos: {
          type: "string",
          description: "Próximos passos sugeridos se aplicável",
        },
      },
    },
    handler: async ({ id, resposta, tratamento, proximos_passos }, { sb, user }) => {
      const update: Record<string, unknown> = {
        status: "respondido",
        resposta,
        respondido_por: user?.email || "lumied-mcp@lumied.com.br",
        atualizado_em: new Date().toISOString(),
      };
      if (tratamento) update.tratamento = tratamento;
      if (proximos_passos) update.proximos_passos = proximos_passos;
      const { data: ticket, error } = await sb
        .from("tickets")
        .update(update)
        .eq("id", id)
        .select("email, nome, numero, portal")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!ticket) throw new Error("Ticket não encontrado");
      // Send email notification (best effort)
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey && ticket.email) {
        try {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "Lumied Suporte <noreply@lumied.com.br>",
              to: [ticket.email],
              subject: `[Lumied #${ticket.numero}] Resposta ao seu chamado`,
              html: `<div style="font-family:sans-serif;max-width:600px;">
                <h2 style="color:#6C63FF;">Olá ${ticket.nome || ""},</h2>
                <p>Sua solicitação (#${ticket.numero}) foi analisada:</p>
                <div style="background:#f5f5f5;padding:16px;border-radius:8px;white-space:pre-wrap;">${resposta}</div>
                ${proximos_passos ? `<p><strong>Próximos passos:</strong><br>${proximos_passos}</p>` : ""}
                <p style="color:#7a7169;font-size:12px;">Equipe Lumied</p>
              </div>`,
            }),
            signal: AbortSignal.timeout(8000),
          });
        } catch (e) { console.warn('[mcp] Ticket response email failed:', (e as Error).message) }
      }
      return { success: true, ticket_id: id, numero: ticket.numero };
    },
  },
  {
    name: "ticket_close",
    description:
      "Fecha um ticket sem resposta ao usuário (ex: duplicado, spam). Use raramente.",
    scope: "staff",
    inputSchema: {
      type: "object",
      required: ["id", "motivo"],
      properties: {
        id: { type: "string" },
        motivo: { type: "string" },
      },
    },
    handler: async ({ id, motivo }, { sb, user }) => {
      const { error } = await sb
        .from("tickets")
        .update({
          status: "fechado",
          tratamento: `Fechado sem resposta: ${motivo}`,
          respondido_por: user?.email || "lumied-mcp@lumied.com.br",
          atualizado_em: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw new Error(error.message);
      return { success: true };
    },
  },

  // ─── Escolas ──────────────────────────────────────────────────
  {
    name: "escolas_list",
    description:
      "Lista todas as escolas do Lumied (tenants). Retorna id, nome, subdominio, plano, ativo, total_alunos, criado_em. Use para saber quem são os clientes.",
    scope: "staff",
    inputSchema: {
      type: "object",
      properties: {
        apenas_ativas: { type: "boolean", default: true },
      },
    },
    handler: async ({ apenas_ativas = true }, { sb }) => {
      let q = sb
        .from("escolas")
        .select("id, nome, subdominio, plano, ativo, criado_em")
        .order("nome");
      if (apenas_ativas) q = q.eq("ativo", true);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { count: data?.length || 0, escolas: data || [] };
    },
  },
  {
    name: "escola_status",
    description:
      "Diagnóstico completo de uma escola: plano, módulos ativos, total alunos, " +
      "uso de storage, tickets abertos, alertas de compliance. " +
      "Use quando o usuário perguntar 'como está a escola X'.",
    scope: "staff",
    inputSchema: {
      type: "object",
      properties: {
        subdominio: { type: "string", description: "Ex: maplebearcaxias" },
        escola_id: { type: "string", description: "Alternativa ao subdominio" },
      },
    },
    handler: async ({ subdominio, escola_id }, { sb }) => {
      if (!subdominio && !escola_id) {
        throw new Error("subdominio ou escola_id obrigatório");
      }
      let q = sb
        .from("escolas")
        .select("id, nome, subdominio, plano, ativo, criado_em, plano_expira_em");
      q = escola_id ? q.eq("id", escola_id) : q.eq("subdominio", subdominio);
      const { data: escola, error } = await q.maybeSingle();
      if (error) throw new Error(error.message);
      if (!escola) throw new Error("Escola não encontrada");

      const [alunos, modulos, tickets, uso] = await Promise.all([
        sb.from("alunos").select("id", { count: "exact", head: true }).eq("ativo", true),
        sb
          .from("escola_modulos")
          .select("modulo_id, habilitado")
          .eq("escola_id", escola.id)
          .eq("habilitado", true),
        sb
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("escola_id", escola.id)
          .in("status", ["aberto", "escalado"]),
        sb.from("escola_uso").select("*").eq("escola_id", escola.id).maybeSingle(),
      ]);

      return {
        escola: {
          id: escola.id,
          nome: escola.nome,
          subdominio: escola.subdominio,
          plano: escola.plano,
          ativo: escola.ativo,
          criado_em: escola.criado_em,
          plano_expira_em: escola.plano_expira_em,
        },
        total_alunos: alunos.count || 0,
        modulos_ativos: modulos.data?.length || 0,
        tickets_abertos: tickets.count || 0,
        uso: uso.data || null,
      };
    },
  },

  // ─── SQL (read-only) ──────────────────────────────────────────
  {
    name: "sql_query",
    description:
      "Executa SQL read-only no Supabase (apenas SELECT). " +
      "Use para consultas específicas que não têm tool dedicada. " +
      "Rejeita INSERT/UPDATE/DELETE/DROP/ALTER. Limite: 500 linhas.",
    scope: "staff",
    inputSchema: {
      type: "object",
      required: ["sql"],
      properties: {
        sql: { type: "string", description: "SELECT query" },
      },
    },
    handler: async ({ sql }) => {
      // Strip SQL comments before validation to prevent bypass via hidden keywords
      sql = String(sql).replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const normalized = sql.trim().toLowerCase();
      const forbidden = [
        "insert",
        "update",
        "delete",
        "drop",
        "alter",
        "truncate",
        "grant",
        "revoke",
        "create",
        "replace",
      ];
      if (!normalized.startsWith("select") && !normalized.startsWith("with")) {
        throw new Error("Apenas SELECT/WITH permitido");
      }
      for (const kw of forbidden) {
        if (new RegExp(`\\b${kw}\\b`, "i").test(normalized)) {
          throw new Error(`Palavra-chave proibida: ${kw.toUpperCase()}`);
        }
      }
      // Use Management API (requires SUPABASE_ACCESS_TOKEN in env)
      const accessToken = Deno.env.get("SUPABASE_ACCESS_TOKEN");
      const projectRef = Deno.env.get("SUPABASE_PROJECT_REF") || "brgorknbrjlfwvrrlwxj";
      if (!accessToken) {
        throw new Error("SUPABASE_ACCESS_TOKEN não configurado nos secrets");
      }
      const res = await fetch(
        `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: sql }),
        },
      );
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Supabase Management API error: ${res.status} ${errText}`);
      }
      const data = await res.json();
      const rows = Array.isArray(data) ? data : [];
      return { rows: rows.slice(0, 500), total: rows.length, truncated: rows.length > 500 };
    },
  },

  // ─── Sentry integration ───────────────────────────────────────
  {
    name: "sentry_recent_errors",
    description:
      "Busca erros recentes no Sentry (lumied.sentry.io). " +
      "Útil para diagnosticar tickets de 'bug/erro/tela branca'. " +
      "Retorna título, count, último visto, URL.",
    scope: "staff",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Filtro de busca (ex: 'portal:gerente')" },
        limit: { type: "integer", default: 10, maximum: 50 },
      },
    },
    handler: async ({ query = "", limit = 10 }) => {
      const token = Deno.env.get("SENTRY_AUTH_TOKEN");
      const org = Deno.env.get("SENTRY_ORG") || "lumied";
      const project = Deno.env.get("SENTRY_PROJECT") || "lumied-frontend";
      if (!token) {
        throw new Error("SENTRY_AUTH_TOKEN não configurado");
      }
      const url = new URL(
        `https://sentry.io/api/0/projects/${org}/${project}/issues/`,
      );
      url.searchParams.set("query", query || "is:unresolved");
      url.searchParams.set("limit", String(Math.min(limit as number, 50)));
      url.searchParams.set("statsPeriod", "24h");
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`Sentry API error: ${res.status}`);
      }
      const issues = (await res.json()) as Array<Record<string, unknown>>;
      return {
        count: issues.length,
        issues: issues.map((i) => ({
          id: i.id,
          title: i.title,
          culprit: i.culprit,
          count: i.count,
          lastSeen: i.lastSeen,
          permalink: i.permalink,
          level: i.level,
        })),
      };
    },
  },

  // ─── Audit log ────────────────────────────────────────────────
  {
    name: "staff_audit_log",
    description:
      "Histórico de ações realizadas por staff Lumied (audit log). " +
      "Útil para entender quem fez o quê e quando.",
    scope: "staff",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", default: 20, maximum: 100 },
        staff_id: { type: "string", description: "Filtrar por um staff específico" },
      },
    },
    handler: async ({ limit = 20, staff_id }, { sb }) => {
      let q = sb
        .from("lumied_staff_audit")
        .select("*")
        .order("criado_em", { ascending: false })
        .limit(Math.min(limit as number, 100));
      if (staff_id) q = q.eq("staff_id", staff_id);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { count: data?.length || 0, logs: data || [] };
    },
  },
];
