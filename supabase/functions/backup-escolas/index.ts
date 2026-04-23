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
import { captureException } from "../_shared/sentry.ts";

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

async function runBackup(sb: SupabaseClient, escola_id: string): Promise<{ path: string; size: number; linhas: number; tabelas: number; faces: number }> {
  const hoje = new Date().toISOString().slice(0, 10);

  // Insere/atualiza row de log (em_andamento)
  await sb.from("backups_log").upsert({
    escola_id, data_backup: hoje, status: "em_andamento", iniciado_em: new Date().toISOString(),
  }, { onConflict: "escola_id,data_backup" });

  // Config: incluir faces?
  const { data: escolaRow } = await sb.from("escolas").select("saas_backup_incluir_faces").eq("id", escola_id).maybeSingle();
  const incluirFaces = !!(escolaRow as { saas_backup_incluir_faces?: boolean } | null)?.saas_backup_incluir_faces;

  // deno-lint-ignore no-explicit-any
  const payload: any = {
    meta: { escola_id, data_backup: hoje, gerado_em: new Date().toISOString(), versao: 2, incluir_faces: incluirFaces },
    tabelas: {},
    faces: {} as Record<string, string>, // aluno_id/face_id → base64 jpg
  };
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

  // Faces (opt-in)
  let facesBaixadas = 0;
  if (incluirFaces) {
    try {
      const { data: faces } = await sb.from("acesso_faces").select("id, pessoa_id, foto_url").eq("escola_id", escola_id);
      for (const f of (faces ?? []) as Array<{ id: string; pessoa_id: string; foto_url: string }>) {
        if (!f.foto_url) continue;
        try {
          const resp = await fetch(f.foto_url, { signal: AbortSignal.timeout(5000) });
          if (!resp.ok) continue;
          const bytes = new Uint8Array(await resp.arrayBuffer());
          let bin = ""; const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
          payload.faces[f.id] = btoa(bin);
          facesBaixadas++;
        } catch { /* face individual falhou — pula */ }
      }
    } catch (e) {
      log.warn(`faces: ${(e as Error).message}`);
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

  return { path: storagePath, size: gzBytes.byteLength, linhas: totalLinhas, tabelas: tabelasOk, faces: facesBaixadas };
}

async function enviarAlertaFalha(sb: SupabaseClient, escolaId: string, escolaNome: string, erro: string) {
  try {
    // Busca email de alerta: coluna própria > superusuario_email config > skip
    const { data: e } = await sb.from("escolas").select("saas_backup_alert_email").eq("id", escolaId).maybeSingle();
    let email = (e as { saas_backup_alert_email?: string } | null)?.saas_backup_alert_email || null;
    if (!email) {
      const { data: c } = await sb.from("escola_config").select("valor")
        .eq("chave", "superusuario_email").eq("escola_id", escolaId).maybeSingle();
      email = (c?.valor as string | null)?.replace(/^"|"$/g, "") || null;
    }
    if (!email) return;
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        tipo: "generic",
        to: email,
        subject: `Falha no backup diário — ${escolaNome}`,
        html: `<h2>Backup diário falhou</h2><p>Escola: <strong>${escolaNome}</strong></p><p>Data: ${new Date().toLocaleString("pt-BR")}</p><p>Erro: <code>${erro}</code></p><p>Tentaremos novamente no próximo ciclo. Se persistir, contate suporte@lumied.com.br.</p>`,
        escola_id: escolaId,
      }),
    });
  } catch (e) {
    log.warn(`alerta email falhou: ${(e as Error).message}`);
  }
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
          const errMsg = (ex as Error).message;
          await sb.from("backups_log").update({
            status: "erro", erro_msg: errMsg, concluido_em: new Date().toISOString(),
          }).eq("escola_id", e.id).eq("data_backup", new Date().toISOString().slice(0,10));
          resultados.push({ escola_id: e.id, nome: e.nome, ok: false, erro: errMsg });
          log.error(`Backup falhou: ${e.nome}`, { metadata: { err: errMsg } });
          // Alerta por email (best-effort — não bloqueia outras escolas)
          enviarAlertaFalha(sb, e.id, e.nome, errMsg).catch(() => {});
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

    // ── restore_preview (staff, dry-run) ──
    if (action === "restore_preview") {
      const v = await validarStaff(sb, token);
      if (!v.ok) return err("Staff apenas.", 403);
      const escola_id = body.escola_id as string;
      const data_backup = body.data_backup as string;
      if (!escola_id || !data_backup) return err("escola_id e data_backup obrigatórios.");

      const path = `${escola_id}/${data_backup}.json.gz`;
      const { data: blob, error: dlErr } = await sb.storage.from("backups-escolas").download(path);
      if (dlErr || !blob) return err("Backup não encontrado.", 404);

      const { gunzip } = await import("compress/mod.ts");
      const gzBytes = new Uint8Array(await blob.arrayBuffer());
      const jsonBytes = gunzip(gzBytes);
      // deno-lint-ignore no-explicit-any
      const payload = JSON.parse(new TextDecoder().decode(jsonBytes)) as any;

      // Summary: para cada tabela, quantas linhas no backup vs quantas atualmente
      const resumo: Array<{ tabela: string; no_backup: number; atual: number; diff: number }> = [];
      for (const [tabela, rowsRaw] of Object.entries(payload.tabelas || {})) {
        const rows = rowsRaw as unknown[];
        let atual = 0;
        try {
          const q = tabela === "escolas"
            ? sb.from(tabela).select("*", { count: "exact", head: true }).eq("id", escola_id)
            : sb.from(tabela).select("*", { count: "exact", head: true }).eq("escola_id", escola_id);
          const { count } = await q;
          atual = count ?? 0;
        } catch { /* tabela pode não existir agora */ }
        resumo.push({ tabela, no_backup: rows.length, atual, diff: rows.length - atual });
      }

      await sb.from("restores_log").insert({
        escola_id, backup_data: data_backup, modo: "preview",
        iniciado_por: ((v.staff as { email?: string })?.email || "staff"),
        tabelas_afetadas: resumo.length,
        linhas_afetadas: resumo.reduce((s, r) => s + r.no_backup, 0),
        status: "sucesso",
        concluido_em: new Date().toISOString(),
      });

      return json({
        ok: true,
        meta: payload.meta,
        resumo,
        faces_count: Object.keys(payload.faces || {}).length,
        avisos: [
          "Este é um preview. Nenhum dado foi alterado.",
          "restore_apply é DESTRUTIVO — apaga dados atuais da escola e substitui pelos do backup.",
          "Só staff sênior deve executar apply, e apenas após validar este resumo com o cliente.",
        ],
      });
    }

    // ── restore_apply (staff, DESTRUTIVO) ──
    if (action === "restore_apply") {
      const v = await validarStaff(sb, token);
      if (!v.ok) return err("Staff apenas.", 403);
      const escola_id = body.escola_id as string;
      const data_backup = body.data_backup as string;
      const confirm = body.confirm_destructive as string;
      if (!escola_id || !data_backup) return err("escola_id e data_backup obrigatórios.");
      if (confirm !== `RESTAURAR_${escola_id}`) {
        return err(`Para confirmar restore destrutivo, envie confirm_destructive = "RESTAURAR_${escola_id}"`, 400);
      }

      const path = `${escola_id}/${data_backup}.json.gz`;
      const { data: blob, error: dlErr } = await sb.storage.from("backups-escolas").download(path);
      if (dlErr || !blob) return err("Backup não encontrado.", 404);

      const { gunzip } = await import("compress/mod.ts");
      const gzBytes = new Uint8Array(await blob.arrayBuffer());
      const jsonBytes = gunzip(gzBytes);
      // deno-lint-ignore no-explicit-any
      const payload = JSON.parse(new TextDecoder().decode(jsonBytes)) as any;

      const { data: logRow } = await sb.from("restores_log").insert({
        escola_id, backup_data: data_backup, modo: "apply",
        iniciado_por: ((v.staff as { email?: string })?.email || "staff"),
        status: "em_andamento",
      }).select().single();

      let tabelasProcessadas = 0;
      let linhasInseridas = 0;
      const erros: string[] = [];

      try {
        // DELETE então INSERT. Tabelas na ordem reversa das FKs idealmente; aqui
        // confiamos em ON DELETE CASCADE de escolas (mas muitas tabelas não têm).
        // Skip de tabelas sensíveis que NUNCA devem ser restauradas (staff_sessoes etc).
        const SKIP_TABLES = new Set(["backups_log", "restores_log"]);

        for (const [tabela, rowsRaw] of Object.entries(payload.tabelas || {})) {
          if (SKIP_TABLES.has(tabela)) continue;
          const rows = rowsRaw as Record<string, unknown>[];
          try {
            // DELETE atuais
            if (tabela !== "escolas") {
              await sb.from(tabela).delete().eq("escola_id", escola_id);
            }
            // INSERT do backup
            if (rows.length) {
              const { error } = await sb.from(tabela).upsert(rows, { onConflict: "id" });
              if (error) throw new Error(error.message);
              linhasInseridas += rows.length;
            }
            tabelasProcessadas++;
          } catch (e) {
            erros.push(`${tabela}: ${(e as Error).message}`);
          }
        }

        await sb.from("restores_log").update({
          status: erros.length ? "erro" : "sucesso",
          tabelas_afetadas: tabelasProcessadas,
          linhas_afetadas: linhasInseridas,
          erro_msg: erros.length ? erros.join(" | ") : null,
          concluido_em: new Date().toISOString(),
        }).eq("id", (logRow as { id: string }).id);

        return json({
          ok: erros.length === 0,
          tabelas_processadas: tabelasProcessadas,
          linhas_inseridas: linhasInseridas,
          erros,
        });
      } catch (e) {
        await sb.from("restores_log").update({
          status: "erro", erro_msg: (e as Error).message, concluido_em: new Date().toISOString(),
        }).eq("id", (logRow as { id: string }).id);
        throw e;
      }
    }

    return err("Ação inválida.", 400);
  } catch (e) {
    log.error("backup-escolas erro", { metadata: { err: (e as Error).message } });
    captureException(e instanceof Error ? e : new Error(String(e)), { function: 'backup-escolas', action }).catch(() => {});
    return err((e as Error).message, 500);
  }
});
