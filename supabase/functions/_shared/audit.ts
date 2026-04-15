// Audit log unificado — usado por qualquer edge function.
// Fire-and-forget: nunca bloqueia a resposta ao usuário.

import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditEvent = {
  escola_id?: string | null;
  ator_tipo?: 'staff' | 'gerente' | 'professora' | 'secretaria' | 'pai' | 'aluno' | 'system';
  ator_id?: string | null;
  ator_email?: string | null;
  recurso: string;
  recurso_id?: string | null;
  acao: string;
  antes?: unknown;
  depois?: unknown;
  ip?: string | null;
  user_agent?: string | null;
  metadata?: Record<string, unknown>;
};

export function logAudit(sb: SupabaseClient, ev: AuditEvent): void {
  // Fire-and-forget — erro em auditoria NUNCA derruba a action.
  sb.from("audit_eventos").insert({
    escola_id: ev.escola_id ?? null,
    ator_tipo: ev.ator_tipo ?? null,
    ator_id: ev.ator_id ?? null,
    ator_email: ev.ator_email ?? null,
    recurso: ev.recurso,
    recurso_id: ev.recurso_id ?? null,
    acao: ev.acao,
    antes: ev.antes ?? null,
    depois: ev.depois ?? null,
    ip: ev.ip ?? null,
    user_agent: ev.user_agent ?? null,
    metadata: ev.metadata ?? null,
  }).then(({ error }) => {
    if (error) console.error('[audit] falha ao gravar evento:', error.message, ev.recurso, ev.acao);
  });
}
