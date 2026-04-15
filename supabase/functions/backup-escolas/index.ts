// ═══════════════════════════════════════════════════════════════
//  Edge Function: backup-escolas
// ═══════════════════════════════════════════════════════════════
//  Backups diários por escola — bucket privado backups-escolas.
//
//  Actions:
//    run_all          — cron (via CRON_INTERNAL_KEY): todas as escolas
//    run_one          — manual (staff): escola_id
//    list             — lista backups da escola (staff ou gerente da própria)
//    download         — URL assinada (60min) para baixar
//    rotate           — remove backups acima do retention por tier
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { gzip } from "compress/mod.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("backup-escolas");
let CORS: Record<string, string> = getCorsHeaders();

// Tabelas que compõem o backup de cada escola. Filtradas por escola_id.
// Tabelas sem escola_id (ex: regua_config global) não entram.
const TENANT_TABLES: string[] = [
  "escolas", "escola_config", "escola_modulos",
  "gerentes", "usuarios", "professoras", "series",
  "alunos", "familias",
  "fin_mensalidades", "fin_inadimplencia", "fin_lancamentos",
  "boletos", "regua_execucoes", "cobranca_tratativas",
  "notas_periodos", "notas_disciplinas", "notas_avaliacoes", "notas_lancamentos",
  "matricula_contratos", "contratos", "comunicados",
  "alm_turmas", "alm_insumos", "alm_orcamentos", "alm_requisicoes", "alm_compras", "alm_entregas",
  "compliance_politicas", "compliance_certificacoes", "compliance_inspecoes",
  "rh_funcionarios", "rh_ponto_registros",
  "acesso_dispositivos", "acesso_permissoes_retirada",
  "tickets", "backups_log",
];

// Tabelas que NÃO têm escola_id mas estão escopadas por FK indireta — ignoradas.
// (Podem ser adicionadas depois via query customizada.)

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function err(msg: string, status = 400, code?: string) {
  return json({ error: msg, code }, status);
}

async function validarStaff(sb: SupabaseClient, token: string): Promise<{ ok: boolean; staff?: any }> {
  if (!token) return { ok: false };
  const { data } = await sb.from("lumied_staff_sessoes").select("staff_id, expira_em, lumied_staff(email, nome, cargo)").eq("token", token).maybeSingle();
  if (!data || new Date((data as any).expira_em) < new Date()) return { ok: false };
  return { ok: true, staff: (data as any).lumied_staff };
}

async function validarGerente(sb: SupabaseClient, token: string): Promise<{ ok: boolean; escola_id?: string }> {
  if (!token) return { ok: false };
  const { data: gs } = await sb.from("gerente_sessoes").select("gerente_id, expira_em, gerentes(escola_id)").eq("token", token).maybeSingle();
  if (gs && new Date((gs as any).expira_em) >= new Date()) {
    return { ok: true, escola_id: (gs as any).gerentes?.escola_id };
  }
  const { data: us } = await sb.from("sessoes").select("usuario_id, expira_em, usuarios(escola_id, papeis)").eq("token", token).maybeSingle();
  if (us && new Date((us as any).expira_em) >= new Date()) {
    const papeis: string[] = (us as any).usuarios?.papeis || [];
    if (papeis.some(p => ["gerente","diretor","financeiro"].includes(p))) {
      return { ok: true, escola_id: (us as any).usuarios?.escola_id };
    }
  }
  return { ok: false };
}

async function runBackup(sb: SupabaseClient, escola_id: string): Promise<{ path: string; size: number; linhas: number; tabelas: number }> {
  const hoje = new Date().toISOString().slice(0, 10);

  // Insere/atualiza row de log (em_andamento)
  await sb.from("backups_log").upsert({
    escola_id, data_backup: hoje, status: "em_andamento", iniciado_em: new Date().toISOString(),
  }, { onConflict: "escola_id,data_backup" });

  const payload: any = { meta: { escola_id, data_backup: hoje, gerado_em: new Date().toISOString(), versao: 1 }, tabelas: {} };
  let totalLinhas = 0;
  let tabelasOk = 0;

  for (const tabela of TENANT_TABLES) {
    try {
      const query = tabela === "escolas"
        ? sb.from(tabela).select("*").eq("id", escola_id)
        : sb.from(tabela).select("*").eq("escola_id", escola_id);
      const { data, error } = await query;
      if (error) {
        log.warn(`skip ${tabela}: ${error.message}`);
        continue;
      }
      payload.tabelas[tabela] = data ?? [];
      totalLinhas += (data ?? []).length;
      tabelasOk++;
    } catch (e) {
      log.warn(`erro ${tabela}: ${(e as Error).message}`);
    }
  }

  const jsonBytes = new TextEncoder().encode(JSON.stringify(payload));
  const gzBytes = gzip(jsonBytes);
  const storagePath = `${escola_id}/${hoje}.json.gz`;

  const { error: upErr } = await sb.storage.from("backups-escolas").upload(storagePath, gzBytes, {
    contentType: "application/gzip", upsert: true,
  });
  if (upErr) throw new Error(`Upload falhou: ${upErr.message}`);

  await sb.from("backups_log").update({
    status: "sucesso",
    tamanho_bytes: gzBytes.byteLength,
    storage_path: storagePath,
    tabelas_inc: tabelasOk,
    linhas_total: totalLinhas,
    concluido_em: new Date().toISOString(),
  }).eq("escola_id", escola_id).eq("data_backup", hoje);

  return { path: storagePath, size: gzBytes.byteLength, linhas: totalLinhas, tabelas: tabelasOk };
}

async function rotateBackups(sb: SupabaseClient): Promise<{ removidos: number }> {
  const { data: escolas } = await sb.from("escolas").select("id").eq("ativo", true);
  let removidos = 0;
  for (const e of escolas ?? []) {
    const { data: retData } = await sb.rpc("backup_retention_days", { p_escola_id: e.id });
    const dias = typeof retData === "number" ? retData : 14;
    const limite = new Date(); limite.setDate(limite.getDate() - dias);
    const { data: antigos } = await sb.from("backups_log")
      .select("id, storage_path")
      .eq("escola_id", e.id)
      .lt("data_backup", limite.toISOString().slice(0,10))
      .eq("status", "sucesso");
    for (const b of antigos ?? []) {
      if (b.storage_path) await sb.storage.from("backups-escolas").remove([b.storage_path]).catch(() => {});
      await sb.from("backups_log").update({ status: "rotated" }).eq("id", b.id);
      removidos++;
    }
  }
  return { removidos };
}

serve(async (req) => {
  CORS = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const action = body.action as string;
  const authHeader = req.headers.get("authorization") || "";
  const token = (body._token as string) || authHeader.replace(/^Bearer\s+/i, "");

  try {
    // ── CRON: run_all ──
    if (action === "run_all") {
      const cronKey = Deno.env.get("CRON_INTERNAL_KEY") || "";
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
      // Aceita qualquer um dos dois — service_role é o caminho oficial do pg_cron
      // (vide migration 238), cronKey mantém compatibilidade com postdeploy.mjs.
      const authorized = token && (token === cronKey || token === serviceRoleKey);
      if (!authorized) return err("Apenas cron interno pode disparar run_all.", 403);

      const { data: escolas } = await sb.from("escolas").select("id, nome").eq("ativo", true);
      const resultados: any[] = [];
      for (const e of escolas ?? []) {
        try {
          const r = await runBackup(sb, e.id);
          resultados.push({ escola_id: e.id, nome: e.nome, ok: true, ...r });
          log.info(`Backup ok: ${e.nome}`, { metadata: r });
        } catch (ex) {
          await sb.from("backups_log").update({
            status: "erro", erro_msg: (ex as Error).message, concluido_em: new Date().toISOString(),
          }).eq("escola_id", e.id).eq("data_backup", new Date().toISOString().slice(0,10));
          resultados.push({ escola_id: e.id, nome: e.nome, ok: false, erro: (ex as Error).message });
          log.error(`Backup falhou: ${e.nome}`, { metadata: { err: (ex as Error).message } });
        }
      }
      const rot = await rotateBackups(sb).catch(() => ({ removidos: 0 }));
      return json({ executados: resultados.length, resultados, rotacionados: rot.removidos });
    }

    // ── STAFF: run_one ──
    if (action === "run_one") {
      const v = await validarStaff(sb, token);
      if (!v.ok) return err("Staff apenas.", 403);
      const escola_id = body.escola_id as string;
      if (!escola_id) return err("escola_id obrigatório.");
      const r = await runBackup(sb, escola_id);
      return json({ ok: true, ...r });
    }

    // ── list ──
    if (action === "list") {
      const staff = await validarStaff(sb, token);
      const escolaParam = body.escola_id as string | undefined;
      let targetEscolaId: string | null = null;

      if (staff.ok) {
        if (!escolaParam) return err("escola_id obrigatório.");
        targetEscolaId = escolaParam;
      } else {
        const g = await validarGerente(sb, token);
        if (!g.ok || !g.escola_id) return err("Sessão inválida.", 401);
        if (escolaParam && escolaParam !== g.escola_id) return err("Sem acesso a essa escola.", 403);
        targetEscolaId = g.escola_id;
      }

      const { data } = await sb.from("backups_log")
        .select("id, data_backup, status, tamanho_bytes, tabelas_inc, linhas_total, iniciado_em, concluido_em")
        .eq("escola_id", targetEscolaId)
        .in("status", ["sucesso","erro"])
        .order("data_backup", { ascending: false })
        .limit(100);
      return json({ escola_id: targetEscolaId, backups: data ?? [] });
    }

    // ── download (URL assinada 60min) ──
    if (action === "download") {
      const staff = await validarStaff(sb, token);
      const escolaParam = body.escola_id as string;
      const dataBackup = body.data_backup as string;
      if (!escolaParam || !dataBackup) return err("escola_id e data_backup obrigatórios.");

      let targetEscolaId = escolaParam;
      if (!staff.ok) {
        const g = await validarGerente(sb, token);
        if (!g.ok || g.escola_id !== escolaParam) return err("Sem acesso.", 403);
        targetEscolaId = g.escola_id!;
      }

      const path = `${targetEscolaId}/${dataBackup}.json.gz`;
      const { data, error } = await sb.storage.from("backups-escolas").createSignedUrl(path, 3600);
      if (error || !data?.signedUrl) return err("Backup não encontrado ou expirado.", 404);
      return json({ url: data.signedUrl, expira_em: new Date(Date.now() + 3600000).toISOString() });
    }

    // ── rotate (manual, staff) ──
    if (action === "rotate") {
      const v = await validarStaff(sb, token);
      if (!v.ok) return err("Staff apenas.", 403);
      const r = await rotateBackups(sb);
      return json({ ok: true, ...r });
    }

    return err("Ação inválida.", 400);
  } catch (e) {
    log.error("backup-escolas erro", { metadata: { err: (e as Error).message } });
    return err((e as Error).message, 500);
  }
});
