// ═══════════════════════════════════════════════════════════════
//  Edge Function: migracao
//  Migração assistida de ERPs educacionais para Lumied.
//  Operado por lumied_staff. Pipeline INGEST → PARSE → VALIDATE → PROMOTE.
//  Decisões em memory:project_migracao_erps (2026-05-14).
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  Router, rateLimit, validateInput, successResponse, AppError,
  createLogger, logAudit, type Context, type Middleware, type Schema,
} from "../_shared/mod.ts";
import {
  isValidCpf, isValidCnpj, normEmail, normName,
} from "./validator.ts";
import { parseFileToRows, rowsToStaging, detectErp, type EntidadeAlvo } from "./adapters/excel.ts";

const log = createLogger("migracao");

const ERP_ORIGENS = new Set([
  "excel","escolaweb","sponte","wpensar","agenda_edu","sophia","totvs_rm","gvdasa","outro",
]);
const ENTIDADES = new Set<EntidadeAlvo>([
  "alunos","responsaveis","turmas","matriculas","funcionarios","financeiro","notas",
]);
const STAGING_TABLES: Record<EntidadeAlvo, string> = {
  alunos:       "migracao_staging_alunos",
  responsaveis: "migracao_staging_responsaveis",
  turmas:       "migracao_staging_turmas",
  matriculas:   "migracao_staging_matriculas",
  funcionarios: "migracao_staging_funcionarios",
  financeiro:   "migracao_staging_financeiro",
  notas:        "migracao_staging_notas",
};

// ─────────────────────────────────────────────────────────────
//  Staff auth — só lumied_staff opera migração.
// ─────────────────────────────────────────────────────────────
const authStaff: Middleware = async (ctx, next) => {
  const token = (ctx.body._staff_token as string) || (ctx.body._token as string) || null;
  if (!token) throw new AppError("AUTH_REQUIRED", "Token de staff obrigatório.");
  const { data } = await ctx.sb
    .from("lumied_staff_sessoes")
    .select("staff_id, expira_em, lumied_staff(id, nome, email, cargo, ativo)")
    .eq("token", token).single();
  // deno-lint-ignore no-explicit-any
  const sess = data as any;
  if (!sess || new Date(sess.expira_em) < new Date()) {
    throw new AppError("AUTH_INVALID", "Sessão de staff inválida ou expirada.");
  }
  const staff = sess.lumied_staff;
  if (!staff?.ativo) throw new AppError("AUTH_USER_DISABLED", "Conta de staff desativada.");
  ctx.user = { ...staff, tipo: "staff" };
  return next();
};

// Carrega job, valida ownership do staff (qualquer staff ativo pode operar
// qualquer job — auditado). Popula ctx.escola_id.
async function loadJob(ctx: Context, jobId: string): Promise<Record<string, unknown>> {
  if (!jobId) throw new AppError("VALIDATION_FAILED", "job_id obrigatório.");
  const { data: job } = await ctx.sb.from("migracao_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!job) throw new AppError("NOT_FOUND", "Job de migração não encontrado.");
  // deno-lint-ignore no-explicit-any
  ctx.escola_id = (job as any).escola_id;
  return job as Record<string, unknown>;
}

function staffAudit(ctx: Context, jobId: string, escolaId: string, acao: string, detalhes: Record<string, unknown> = {}) {
  // Trilha específica de migração + audit global.
  ctx.sb.from("migracao_audit").insert({
    job_id: jobId, escola_id: escolaId,
    operador_staff_id: ctx.user?.id, operador_nome: ctx.user?.nome,
    acao, detalhes, ip: ctx.ip,
  }).then(({ error }) => { if (error) console.error("[migracao_audit]", error.message); });
  logAudit(ctx.sb, {
    escola_id: escolaId, ator_tipo: "staff", ator_id: ctx.user?.id, ator_email: ctx.user?.email,
    recurso: "migracao", recurso_id: jobId, acao, metadata: detalhes, ip: ctx.ip,
  });
}

// ═══════════════════════════════════════════════════════════════
//  Router
// ═══════════════════════════════════════════════════════════════
const router = new Router("migracao");
router.useGlobal(rateLimit());

// ── Schemas ──
const jobIdSchema: Schema = { job_id: { required: true, type: "uuid" } };
const criarJobSchema: Schema = {
  escola_id: { required: true, type: "uuid" },
  erp_origem: { required: true, type: "string" },
};
const uploadSchema: Schema = {
  job_id: { required: true, type: "uuid" },
  nome: { required: true, type: "string" },
  conteudo_base64: { required: true, type: "string" },
  entidade_alvo: { required: true, type: "string" },
};

// ═════════════════════════════════════════════════════════════
//  1. LISTAR / CRIAR / CANCELAR / RESUMO de jobs
// ═════════════════════════════════════════════════════════════

router.on("migracao_listar_jobs", authStaff, async (ctx: Context) => {
  const { escola_id, status, limit } = ctx.body as { escola_id?: string; status?: string; limit?: number };
  let q = ctx.sb.from("migracao_jobs").select("*, escolas(nome, slug)")
    .order("criado_em", { ascending: false }).limit(Math.min(limit ?? 50, 200));
  if (escola_id) q = q.eq("escola_id", escola_id);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw new AppError("INTERNAL_ERROR", error.message);
  return successResponse(data ?? []);
});

router.on("migracao_criar_job", authStaff, validateInput(criarJobSchema), async (ctx: Context) => {
  const { escola_id, erp_origem, observacao } = ctx.body as { escola_id: string; erp_origem: string; observacao?: string };
  if (!ERP_ORIGENS.has(erp_origem)) throw new AppError("VALIDATION_FAILED", `ERP origem inválido: ${erp_origem}`);
  const { data: escola } = await ctx.sb.from("escolas").select("id, nome").eq("id", escola_id).maybeSingle();
  if (!escola) throw new AppError("NOT_FOUND", "Escola não encontrada.");

  const { data: job, error } = await ctx.sb.from("migracao_jobs").insert({
    escola_id, erp_origem, observacao: observacao ?? null,
    operador_staff_id: ctx.user?.id, status: "rascunho",
  }).select("*").single();
  if (error) throw new AppError("INTERNAL_ERROR", error.message);

  // deno-lint-ignore no-explicit-any
  staffAudit(ctx, (job as any).id, escola_id, "criar_job", { erp_origem });
  log.info("Job criado", { user_id: ctx.user?.id, escola_id, metadata: { erp_origem } });
  return successResponse(job);
});

router.on("migracao_cancelar_job", authStaff, validateInput(jobIdSchema), async (ctx: Context) => {
  const { job_id, motivo } = ctx.body as { job_id: string; motivo?: string };
  const job = await loadJob(ctx, job_id);
  if (job.status === "promovido") throw new AppError("CONFLICT", "Job já promovido — cancelamento bloqueado.");
  await ctx.sb.from("migracao_jobs").update({
    status: "cancelado",
    observacao: motivo ? `[CANCELADO] ${motivo}` : (job.observacao as string ?? null),
  }).eq("id", job_id);
  staffAudit(ctx, job_id, ctx.escola_id!, "cancelar", { motivo: motivo ?? null });
  return successResponse({ ok: true });
});

router.on("migracao_job_resumo", authStaff, validateInput(jobIdSchema), async (ctx: Context) => {
  const { job_id } = ctx.body as { job_id: string };
  await loadJob(ctx, job_id);
  const { data: resumo } = await ctx.sb.from("v_migracao_job_resumo").select("*").eq("job_id", job_id).maybeSingle();
  const { data: arquivos } = await ctx.sb.from("migracao_arquivos")
    .select("id, nome_original, entidade_alvo, linhas_total, linhas_parseadas, enviado_em")
    .eq("job_id", job_id).order("enviado_em", { ascending: false });
  return successResponse({ resumo, arquivos: arquivos ?? [] });
});

// ═════════════════════════════════════════════════════════════
//  2. INGEST — upload de arquivo para o bucket privado
// ═════════════════════════════════════════════════════════════

router.on("migracao_upload_arquivo", authStaff, validateInput(uploadSchema), async (ctx: Context) => {
  const { job_id, nome, conteudo_base64, entidade_alvo, mime } = ctx.body as {
    job_id: string; nome: string; conteudo_base64: string; entidade_alvo: string; mime?: string;
  };
  if (!ENTIDADES.has(entidade_alvo as EntidadeAlvo)) {
    throw new AppError("VALIDATION_FAILED", `Entidade alvo inválida: ${entidade_alvo}`);
  }
  const job = await loadJob(ctx, job_id);
  if (["promovido","cancelado"].includes(job.status as string)) {
    throw new AppError("CONFLICT", `Job em status ${job.status} não aceita uploads.`);
  }

  // Decode base64 — tolera prefixo data:;base64,
  const b64 = conteudo_base64.includes(",") ? conteudo_base64.split(",").pop()! : conteudo_base64;
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  if (bytes.byteLength > 100 * 1024 * 1024) {
    throw new AppError("VALIDATION_FAILED", "Arquivo excede 100 MB.");
  }
  const safeName = nome.replace(/[^A-Za-z0-9._-]/g, "_");
  const path = `${ctx.escola_id}/${job_id}/${Date.now()}_${safeName}`;
  const contentType = mime || guessMime(nome);

  const { error: upErr } = await ctx.sb.storage.from("migracao-anexos")
    .upload(path, bytes, { contentType, upsert: false });
  if (upErr) throw new AppError("INTERNAL_ERROR", upErr.message);

  // hash sha256 do conteúdo (pra detectar uploads duplicados)
  const hash = await sha256Bytes(bytes);

  const { data: arq, error } = await ctx.sb.from("migracao_arquivos").insert({
    job_id, escola_id: ctx.escola_id,
    nome_original: nome, storage_path: path, mime: contentType,
    tamanho_bytes: bytes.byteLength, sha256: hash,
    entidade_alvo,
  }).select("*").single();
  if (error) throw new AppError("INTERNAL_ERROR", error.message);

  await ctx.sb.from("migracao_jobs").update({
    status: job.status === "rascunho" ? "ingerido" : job.status,
  }).eq("id", job_id);

  // deno-lint-ignore no-explicit-any
  staffAudit(ctx, job_id, ctx.escola_id!, "upload", { arquivo_id: (arq as any).id, entidade_alvo, bytes: bytes.byteLength });
  return successResponse(arq);
});

// ═════════════════════════════════════════════════════════════
//  3. PARSE — converte arquivos em staging
// ═════════════════════════════════════════════════════════════

router.on("migracao_parse", authStaff, validateInput(jobIdSchema), async (ctx: Context) => {
  const { job_id } = ctx.body as { job_id: string };
  const job = await loadJob(ctx, job_id);
  if (["promovido","cancelado"].includes(job.status as string)) {
    throw new AppError("CONFLICT", `Job em status ${job.status} não pode ser reparseado.`);
  }

  // Lista arquivos ainda não totalmente parseados
  const { data: arquivos } = await ctx.sb.from("migracao_arquivos")
    .select("*").eq("job_id", job_id);
  if (!arquivos || arquivos.length === 0) {
    throw new AppError("CONFLICT", "Job não tem arquivos para parsear.");
  }

  const resumo: Record<string, number> = {};
  let erpAuto = job.erp_origem as string;

  for (const arq of arquivos) {
    // deno-lint-ignore no-explicit-any
    const a = arq as any;
    // Se já parseou completo, pula
    if (a.linhas_parseadas > 0 && a.linhas_parseadas >= a.linhas_total) continue;

    const { data: blob, error: dlErr } = await ctx.sb.storage.from("migracao-anexos").download(a.storage_path);
    if (dlErr || !blob) {
      await ctx.sb.from("migracao_jobs").update({ status: "erro" }).eq("id", job_id);
      throw new AppError("INTERNAL_ERROR", `Falha ao baixar ${a.nome_original}: ${dlErr?.message ?? "blob vazio"}`);
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let rows: Record<string, unknown>[] = [];
    try { rows = parseFileToRows(a.nome_original, bytes); }
    catch (e) { throw new AppError("VALIDATION_FAILED", `Falha ao parsear ${a.nome_original}: ${(e as Error).message}`); }

    if (erpAuto === "excel" && rows.length > 0) {
      // Refina detecção do ERP fonte pelos headers reais
      const headers = Object.keys(rows[0]);
      erpAuto = detectErp(a.nome_original, headers);
    }

    const entidade = a.entidade_alvo as EntidadeAlvo;
    if (!ENTIDADES.has(entidade)) continue;
    const parsed = await rowsToStaging(rows, entidade);

    // Bulk insert em chunks de 500
    const table = STAGING_TABLES[entidade];
    let inserted = 0;
    for (let i = 0; i < parsed.length; i += 500) {
      const chunk = parsed.slice(i, i + 500).map(p => ({
        job_id, escola_id: ctx.escola_id,
        origem_arquivo_id: a.id, origem_linha: p.linha, origem_hash: p.hash,
        ...p.data,
      }));
      const { error: insErr } = await ctx.sb.from(table).insert(chunk);
      if (insErr) {
        // tenta novamente desduplicando por origem_hash (re-parse seguro)
        const filtered = await dedupeByHash(ctx.sb, table, job_id, chunk);
        if (filtered.length > 0) {
          const { error: e2 } = await ctx.sb.from(table).insert(filtered);
          if (e2) throw new AppError("INTERNAL_ERROR", `Insert staging ${entidade}: ${e2.message}`);
          inserted += filtered.length;
        }
      } else inserted += chunk.length;
    }
    resumo[entidade] = (resumo[entidade] ?? 0) + inserted;

    await ctx.sb.from("migracao_arquivos").update({
      linhas_total: rows.length, linhas_parseadas: parsed.length,
    }).eq("id", a.id);
  }

  await ctx.sb.from("migracao_jobs").update({
    status: "parseado", parseado_em: new Date().toISOString(),
    erp_origem: erpAuto, resumo,
  }).eq("id", job_id);

  staffAudit(ctx, job_id, ctx.escola_id!, "parse", { resumo, erp_origem: erpAuto });
  return successResponse({ ok: true, resumo, erp_origem: erpAuto });
});

// ═════════════════════════════════════════════════════════════
//  4. VALIDAR — preenche flags e is_valido por linha
// ═════════════════════════════════════════════════════════════

router.on("migracao_validar", authStaff, validateInput(jobIdSchema), async (ctx: Context) => {
  const { job_id } = ctx.body as { job_id: string };
  const job = await loadJob(ctx, job_id);
  if (["promovido","cancelado"].includes(job.status as string)) {
    throw new AppError("CONFLICT", `Job em status ${job.status}.`);
  }

  const erros: Record<string, number> = {};
  const warns: Record<string, number> = {};

  // ── Alunos ─────────────────────────────────────────────────
  const { data: alunos } = await ctx.sb.from("migracao_staging_alunos")
    .select("id, nome, email, cpf, data_nascimento, responsavel_email, responsavel_cpf")
    .eq("job_id", job_id).eq("ignorado", false);
  for (const a of alunos ?? []) {
    const flags: { code: string; msg: string; severity: "info"|"warn"|"error" }[] = [];
    // deno-lint-ignore no-explicit-any
    const r = a as any;
    if (!r.nome) flags.push({ code: "nome_vazio", msg: "Nome obrigatório.", severity: "error" });
    if (r.cpf && !isValidCpf(r.cpf)) flags.push({ code: "cpf_invalido", msg: "CPF inválido (mod 11).", severity: "error" });
    if (!r.responsavel_email && !r.responsavel_cpf)
      flags.push({ code: "sem_responsavel", msg: "Aluno sem responsável — bloqueia LGPD (menor).", severity: "error" });
    const ok = !flags.some(f => f.severity === "error");
    await ctx.sb.from("migracao_staging_alunos").update({ flags, is_valido: ok }).eq("id", r.id);
    flags.forEach(f => {
      if (f.severity === "error") erros[f.code] = (erros[f.code] ?? 0) + 1;
      else warns[f.code] = (warns[f.code] ?? 0) + 1;
    });
  }

  // ── Responsáveis ───────────────────────────────────────────
  const { data: resps } = await ctx.sb.from("migracao_staging_responsaveis")
    .select("id, nome, email, cpf, aluno_email").eq("job_id", job_id).eq("ignorado", false);
  for (const r of resps ?? []) {
    const flags: { code: string; msg: string; severity: "info"|"warn"|"error" }[] = [];
    // deno-lint-ignore no-explicit-any
    const x = r as any;
    if (!x.nome) flags.push({ code: "nome_vazio", msg: "Nome obrigatório.", severity: "error" });
    if (!x.email) flags.push({ code: "email_vazio", msg: "Email obrigatório (chave de família).", severity: "error" });
    if (x.cpf && !isValidCpf(x.cpf)) flags.push({ code: "cpf_invalido", msg: "CPF inválido.", severity: "error" });
    const ok = !flags.some(f => f.severity === "error");
    // Tenta match com familias existentes (mesma escola + email)
    let matchId: string | null = null;
    if (x.email) {
      const { data: fam } = await ctx.sb.from("familias")
        .select("id").eq("escola_id", ctx.escola_id).eq("email", normEmail(x.email)).maybeSingle();
      // deno-lint-ignore no-explicit-any
      matchId = (fam as any)?.id ?? null;
    }
    if (matchId) flags.push({ code: "match_familia_existente", msg: "Família já cadastrada — será atualizada.", severity: "info" });
    await ctx.sb.from("migracao_staging_responsaveis").update({ flags, is_valido: ok, match_familia_id: matchId }).eq("id", x.id);
    flags.forEach(f => {
      if (f.severity === "error") erros[f.code] = (erros[f.code] ?? 0) + 1;
      else if (f.severity === "warn") warns[f.code] = (warns[f.code] ?? 0) + 1;
    });
  }

  // ── Turmas ─────────────────────────────────────────────────
  const { data: turmas } = await ctx.sb.from("migracao_staging_turmas")
    .select("id, nome, ano").eq("job_id", job_id).eq("ignorado", false);
  for (const t of turmas ?? []) {
    const flags: { code: string; msg: string; severity: "info"|"warn"|"error" }[] = [];
    // deno-lint-ignore no-explicit-any
    const x = t as any;
    if (!x.nome) flags.push({ code: "nome_vazio", msg: "Nome da turma obrigatório.", severity: "error" });
    let matchId: string | null = null;
    if (x.nome) {
      const { data: serie } = await ctx.sb.from("series")
        .select("id").eq("escola_id", ctx.escola_id).ilike("nome", x.nome).maybeSingle();
      // deno-lint-ignore no-explicit-any
      matchId = (serie as any)?.id ?? null;
    }
    if (matchId) flags.push({ code: "match_serie_existente", msg: "Série já existe — vamos reutilizar.", severity: "info" });
    const ok = !flags.some(f => f.severity === "error");
    await ctx.sb.from("migracao_staging_turmas").update({ flags, is_valido: ok, match_serie_id: matchId }).eq("id", x.id);
    flags.forEach(f => { if (f.severity === "error") erros[f.code] = (erros[f.code] ?? 0) + 1; });
  }

  // ── Funcionários ───────────────────────────────────────────
  const { data: funcs } = await ctx.sb.from("migracao_staging_funcionarios")
    .select("id, nome, email, cpf, cargo").eq("job_id", job_id).eq("ignorado", false);
  for (const f of funcs ?? []) {
    const flags: { code: string; msg: string; severity: "info"|"warn"|"error" }[] = [];
    // deno-lint-ignore no-explicit-any
    const x = f as any;
    if (!x.nome) flags.push({ code: "nome_vazio", msg: "Nome obrigatório.", severity: "error" });
    if (x.cpf && !isValidCpf(x.cpf)) flags.push({ code: "cpf_invalido", msg: "CPF inválido.", severity: "error" });
    const papelLumied = mapCargoToPapel(x.cargo);
    if (!papelLumied) flags.push({ code: "papel_indefinido", msg: "Cargo não mapeia para papel Lumied — promoção ignora este registro.", severity: "warn" });
    const ok = !flags.some(f => f.severity === "error");
    await ctx.sb.from("migracao_staging_funcionarios").update({ flags, is_valido: ok, papel_lumied: papelLumied }).eq("id", x.id);
    flags.forEach(f => {
      if (f.severity === "error") erros[f.code] = (erros[f.code] ?? 0) + 1;
      else warns[f.code] = (warns[f.code] ?? 0) + 1;
    });
  }

  // ── Financeiro ─────────────────────────────────────────────
  const { data: fins } = await ctx.sb.from("migracao_staging_financeiro")
    .select("id, tipo, valor, data_vencimento, status_lumied, familia_email, familia_cpf, descricao")
    .eq("job_id", job_id).eq("ignorado", false);
  for (const t of fins ?? []) {
    const flags: { code: string; msg: string; severity: "info"|"warn"|"error" }[] = [];
    // deno-lint-ignore no-explicit-any
    const x = t as any;
    if (x.valor == null || x.valor <= 0) flags.push({ code: "valor_invalido", msg: "Valor ausente ou ≤ 0.", severity: "error" });
    if (!x.descricao) flags.push({ code: "descricao_vazia", msg: "Descrição vazia.", severity: "warn" });
    if (!x.status_lumied) flags.push({ code: "status_indefinido", msg: "Status do título não foi mapeado.", severity: "warn" });
    if (x.tipo === "receita" && !x.familia_email && !x.familia_cpf)
      flags.push({ code: "sem_familia", msg: "Receita sem família vinculada.", severity: "warn" });
    if (x.familia_cpf && !isValidCpf(x.familia_cpf) && !isValidCnpj(x.familia_cpf))
      flags.push({ code: "cpf_familia_invalido", msg: "CPF/CNPJ da família inválido.", severity: "warn" });
    const ok = !flags.some(f => f.severity === "error");
    await ctx.sb.from("migracao_staging_financeiro").update({ flags, is_valido: ok }).eq("id", x.id);
    flags.forEach(f => {
      if (f.severity === "error") erros[f.code] = (erros[f.code] ?? 0) + 1;
      else warns[f.code] = (warns[f.code] ?? 0) + 1;
    });
  }

  // ── Matrículas / Notas: validação mínima (não bloqueante) ─
  await ctx.sb.from("migracao_staging_matriculas")
    .update({ flags: [], is_valido: true }).eq("job_id", job_id).eq("ignorado", false);
  await ctx.sb.from("migracao_staging_notas")
    .update({ flags: [], is_valido: true }).eq("job_id", job_id).eq("ignorado", false);

  await ctx.sb.from("migracao_jobs").update({
    status: "validado", validado_em: new Date().toISOString(),
    resumo: { erros, warns },
  }).eq("id", job_id);
  staffAudit(ctx, job_id, ctx.escola_id!, "validar", { erros, warns });

  return successResponse({ ok: true, erros, warns });
});

// ═════════════════════════════════════════════════════════════
//  5. LISTAR STAGING + override/ignore por linha
// ═════════════════════════════════════════════════════════════

router.on("migracao_listar_staging", authStaff, async (ctx: Context) => {
  const { job_id, entidade, somente_com_flags, somente_validos, limit, offset } = ctx.body as {
    job_id: string; entidade: EntidadeAlvo;
    somente_com_flags?: boolean; somente_validos?: boolean;
    limit?: number; offset?: number;
  };
  if (!job_id || !ENTIDADES.has(entidade)) throw new AppError("VALIDATION_FAILED", "job_id e entidade obrigatórios.");
  await loadJob(ctx, job_id);
  let q = ctx.sb.from(STAGING_TABLES[entidade]).select("*", { count: "exact" })
    .eq("job_id", job_id).order("origem_linha", { ascending: true })
    .range(offset ?? 0, (offset ?? 0) + Math.min(limit ?? 100, 500) - 1);
  if (somente_com_flags) q = q.neq("flags::text", "[]");
  if (somente_validos) q = q.eq("is_valido", true);
  const { data, error, count } = await q;
  if (error) throw new AppError("INTERNAL_ERROR", error.message);
  return successResponse({ rows: data ?? [], total: count ?? 0 });
});

router.on("migracao_override_linha", authStaff, async (ctx: Context) => {
  const { entidade, id, patch } = ctx.body as { entidade: EntidadeAlvo; id: string; patch: Record<string, unknown> };
  if (!ENTIDADES.has(entidade) || !id || !patch) throw new AppError("VALIDATION_FAILED", "entidade, id, patch obrigatórios.");
  // Bloqueia override em campos de controle
  const safe = { ...patch };
  delete safe.id; delete safe.job_id; delete safe.escola_id;
  delete safe.promovido_id; delete safe.promovido_em; delete safe.criado_em;
  // Override implícito reseta validação — staff re-roda migracao_validar
  safe.flags = [];
  safe.is_valido = false;
  const { data, error } = await ctx.sb.from(STAGING_TABLES[entidade]).update(safe).eq("id", id).select("job_id, escola_id").maybeSingle();
  if (error) throw new AppError("INTERNAL_ERROR", error.message);
  // deno-lint-ignore no-explicit-any
  const d = data as any;
  if (d) staffAudit(ctx, d.job_id, d.escola_id, "override_linha", { entidade, id, campos: Object.keys(safe) });
  return successResponse({ ok: true });
});

router.on("migracao_ignorar_linha", authStaff, async (ctx: Context) => {
  const { entidade, id, ignorar } = ctx.body as { entidade: EntidadeAlvo; id: string; ignorar?: boolean };
  if (!ENTIDADES.has(entidade) || !id) throw new AppError("VALIDATION_FAILED", "entidade e id obrigatórios.");
  const novoValor = ignorar !== false;
  const { data, error } = await ctx.sb.from(STAGING_TABLES[entidade])
    .update({ ignorado: novoValor }).eq("id", id).select("job_id, escola_id").maybeSingle();
  if (error) throw new AppError("INTERNAL_ERROR", error.message);
  // deno-lint-ignore no-explicit-any
  const d = data as any;
  if (d) staffAudit(ctx, d.job_id, d.escola_id, novoValor ? "ignorar_linha" : "reativar_linha", { entidade, id });
  return successResponse({ ok: true });
});

// ═════════════════════════════════════════════════════════════
//  6. PROMOVER — staging → tabelas canônicas
// ═════════════════════════════════════════════════════════════

router.on("migracao_promover", authStaff, validateInput(jobIdSchema), async (ctx: Context) => {
  const { job_id, confirm } = ctx.body as { job_id: string; confirm?: boolean };
  if (!confirm) throw new AppError("VALIDATION_FAILED", "Promoção exige confirm=true.");
  const job = await loadJob(ctx, job_id);
  if (job.status !== "validado") throw new AppError("CONFLICT", `Job precisa estar validado (status atual: ${job.status}).`);

  const escolaId = ctx.escola_id!;
  const counts: Record<string, number> = {};

  // Ordem: responsáveis (familias) → series (turmas) → alunos derivam do trigger
  // → matrículas (atualiza serie_id de alunos) → funcionários → financeiro → notas

  // ── Responsáveis → familias (trigger sincroniza alunos automaticamente) ──
  const { data: resps } = await ctx.sb.from("migracao_staging_responsaveis")
    .select("id, nome, email, cpf, telefone, whatsapp, endereco, cidade, uf, cep, aluno_email, aluno_cpf, match_familia_id")
    .eq("job_id", job_id).eq("is_valido", true).eq("ignorado", false);

  for (const r of resps ?? []) {
    // deno-lint-ignore no-explicit-any
    const x = r as any;
    const email = normEmail(x.email);
    // Procura aluno staging vinculado pra preencher nome_aluno/serie
    const { data: alunoLinked } = await ctx.sb.from("migracao_staging_alunos")
      .select("nome, data_nascimento, cpf, serie_origem")
      .eq("job_id", job_id).eq("ignorado", false)
      .or(`responsavel_email.eq.${email},responsavel_cpf.eq.${x.cpf ?? ""}`)
      .maybeSingle();
    // deno-lint-ignore no-explicit-any
    const al = alunoLinked as any;

    const payload: Record<string, unknown> = {
      escola_id: escolaId,
      email,
      nome_responsavel: x.nome,
      nome_resp: x.nome,
      cpf: x.cpf,
      telefone: x.telefone ?? x.whatsapp,
      ...(x.endereco && { endereco: x.endereco }),
      ...(x.cidade && { cidade: x.cidade }),
      ...(x.uf && { uf: x.uf }),
      ...(x.cep && { cep: x.cep }),
      ...(al?.nome && { nome_aluno: al.nome }),
      ...(al?.serie_origem && { serie: al.serie_origem }),
    };

    let resId = x.match_familia_id as string | null;
    if (resId) {
      const { error } = await ctx.sb.from("familias").update(payload).eq("id", resId);
      if (error) throw new AppError("INTERNAL_ERROR", `familias update ${email}: ${error.message}`);
    } else {
      const { data: ins, error } = await ctx.sb.from("familias")
        .upsert(payload, { onConflict: "email" }).select("id").single();
      if (error) throw new AppError("INTERNAL_ERROR", `familias insert ${email}: ${error.message}`);
      // deno-lint-ignore no-explicit-any
      resId = (ins as any).id;
    }
    await ctx.sb.from("migracao_staging_responsaveis").update({
      promovido_id: resId, promovido_em: new Date().toISOString(),
    }).eq("id", x.id);
    counts.familias = (counts.familias ?? 0) + 1;
  }

  // ── Turmas → series (reutiliza match ou cria) ──
  const { data: turmas } = await ctx.sb.from("migracao_staging_turmas")
    .select("id, nome, ano, turno, ordem, match_serie_id")
    .eq("job_id", job_id).eq("is_valido", true).eq("ignorado", false);
  const turmaNomeToSerie = new Map<string, string>();
  for (const t of turmas ?? []) {
    // deno-lint-ignore no-explicit-any
    const x = t as any;
    let serieId = x.match_serie_id as string | null;
    if (!serieId) {
      const { data: ins, error } = await ctx.sb.from("series").insert({
        escola_id: escolaId, nome: x.nome,
        ...(x.ordem != null && { ordem: x.ordem }),
      }).select("id").single();
      if (error) throw new AppError("INTERNAL_ERROR", `series insert ${x.nome}: ${error.message}`);
      // deno-lint-ignore no-explicit-any
      serieId = (ins as any).id;
    }
    await ctx.sb.from("migracao_staging_turmas").update({
      promovido_id: serieId, promovido_em: new Date().toISOString(),
    }).eq("id", x.id);
    turmaNomeToSerie.set(normName(x.nome), serieId!);
    counts.series = (counts.series ?? 0) + 1;
  }

  // ── Matrículas → atualiza serie_id em alunos ──
  const { data: matrs } = await ctx.sb.from("migracao_staging_matriculas")
    .select("id, aluno_email, aluno_cpf, turma_origem, ano, status")
    .eq("job_id", job_id).eq("is_valido", true).eq("ignorado", false);
  for (const m of matrs ?? []) {
    // deno-lint-ignore no-explicit-any
    const x = m as any;
    const serieId = x.turma_origem ? turmaNomeToSerie.get(normName(x.turma_origem)) : null;
    if (!serieId || !x.aluno_email) continue;
    const { error } = await ctx.sb.from("alunos").update({
      serie_id: serieId, turma: x.turma_origem,
      ativo: x.status === "matriculado",
    }).eq("escola_id", escolaId).eq("email", normEmail(x.aluno_email));
    if (!error) counts.matriculas = (counts.matriculas ?? 0) + 1;
    await ctx.sb.from("migracao_staging_matriculas").update({
      promovido_id: null, promovido_em: new Date().toISOString(),
    }).eq("id", x.id);
  }

  // ── Funcionários → rh_funcionarios + usuarios (papel mapeado) ──
  const { data: funcs } = await ctx.sb.from("migracao_staging_funcionarios")
    .select("id, nome, email, cpf, telefone, cargo, papel_lumied")
    .eq("job_id", job_id).eq("is_valido", true).eq("ignorado", false);
  for (const f of funcs ?? []) {
    // deno-lint-ignore no-explicit-any
    const x = f as any;
    if (!x.papel_lumied) continue;
    const email = x.email ? normEmail(x.email) : null;
    const { data: existing } = email
      ? await ctx.sb.from("usuarios").select("id, papeis").eq("escola_id", escolaId).eq("email", email).maybeSingle()
      : { data: null };
    if (existing) {
      // deno-lint-ignore no-explicit-any
      const cur = existing as any;
      const papeis = new Set<string>(cur.papeis ?? []);
      papeis.add(x.papel_lumied);
      await ctx.sb.from("usuarios").update({ papeis: Array.from(papeis), nome: x.nome }).eq("id", cur.id);
      await ctx.sb.from("migracao_staging_funcionarios").update({
        promovido_id: cur.id, promovido_em: new Date().toISOString(),
      }).eq("id", x.id);
    } else if (email) {
      const { data: ins, error } = await ctx.sb.from("usuarios").insert({
        escola_id: escolaId, nome: x.nome, email,
        papeis: [x.papel_lumied], ativo: true,
      }).select("id").single();
      if (error) {
        // Não falha o promote inteiro — funcionário fica para retry manual
        console.error("[migracao] funcionario insert", email, error.message);
        continue;
      }
      // deno-lint-ignore no-explicit-any
      await ctx.sb.from("migracao_staging_funcionarios").update({
        promovido_id: (ins as any).id, promovido_em: new Date().toISOString(),
      }).eq("id", x.id);
    }
    counts.funcionarios = (counts.funcionarios ?? 0) + 1;
  }

  // ── Financeiro → fin_lancamentos ──
  const { data: fins } = await ctx.sb.from("migracao_staging_financeiro")
    .select("id, tipo, descricao, valor, data_lancamento, data_vencimento, data_pagamento, status_lumied, fornecedor, familia_email, familia_nome, documento, observacao")
    .eq("job_id", job_id).eq("is_valido", true).eq("ignorado", false);

  // Chunk insert
  const finChunk: Record<string, unknown>[] = [];
  const stagingIds: string[] = [];
  for (const t of fins ?? []) {
    // deno-lint-ignore no-explicit-any
    const x = t as any;
    finChunk.push({
      escola_id: escolaId,
      tipo: x.tipo, descricao: x.descricao ?? "Migrado",
      valor: x.valor,
      data_lancamento: x.data_lancamento ?? x.data_vencimento ?? new Date().toISOString().slice(0,10),
      data_vencimento: x.data_vencimento,
      data_pagamento: x.data_pagamento,
      status: x.status_lumied ?? "pendente",
      fornecedor: x.fornecedor,
      familia_email: x.familia_email ? normEmail(x.familia_email) : null,
      familia_nome: x.familia_nome,
      observacao: [x.observacao, x.documento ? `Doc: ${x.documento}` : null].filter(Boolean).join(" | ") || null,
      criado_por: `migracao:${ctx.user?.email}`,
    });
    stagingIds.push(x.id);
  }
  if (finChunk.length > 0) {
    for (let i = 0; i < finChunk.length; i += 500) {
      const slice = finChunk.slice(i, i + 500);
      const { error } = await ctx.sb.from("fin_lancamentos").insert(slice);
      if (error) throw new AppError("INTERNAL_ERROR", `fin_lancamentos: ${error.message}`);
    }
    counts.fin_lancamentos = finChunk.length;
    await ctx.sb.from("migracao_staging_financeiro").update({
      promovido_em: new Date().toISOString(),
    }).in("id", stagingIds);
  }

  // ── Marca job como promovido ──
  await ctx.sb.from("migracao_jobs").update({
    status: "promovido", promovido_em: new Date().toISOString(),
    resumo: { ...(job.resumo as Record<string, unknown> ?? {}), promovido: counts },
  }).eq("id", job_id);
  staffAudit(ctx, job_id, escolaId, "promover", counts);

  return successResponse({ ok: true, promovido: counts });
});

// ═════════════════════════════════════════════════════════════
//  Helpers
// ═════════════════════════════════════════════════════════════

async function sha256Bytes(b: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  return Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, "0")).join("");
}

function guessMime(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "csv": return "text/csv";
    case "xls": return "application/vnd.ms-excel";
    case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "pdf": return "application/pdf";
    case "zip": return "application/zip";
    case "json": return "application/json";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    default: return "application/octet-stream";
  }
}

function mapCargoToPapel(cargo: string | null): string | null {
  if (!cargo) return null;
  const c = normName(cargo);
  if (/diretor|principal|head/.test(c)) return "diretor";
  if (/gerent|coordenad/.test(c)) return "gerente";
  if (/secretari/.test(c)) return "secretaria";
  if (/financ|tesour/.test(c)) return "financeiro";
  if (/professor|docente|teacher/.test(c)) return "professora";
  if (/aux.*professor|assistant/.test(c)) return "professora_assistente";
  if (/comercial|vend/.test(c)) return "comercial";
  if (/manut|zelad/.test(c)) return "manutencao";
  if (/cozinh|nutric/.test(c)) return "nutricionista";
  if (/almox|estoq/.test(c)) return "almoxarifado";
  return null;
}

async function dedupeByHash(
  sb: SupabaseClient, table: string, jobId: string,
  // deno-lint-ignore no-explicit-any
  chunk: any[],
  // deno-lint-ignore no-explicit-any
): Promise<any[]> {
  const hashes = chunk.map(c => c.origem_hash).filter(Boolean);
  if (hashes.length === 0) return chunk;
  const { data: existentes } = await sb.from(table)
    .select("origem_hash").eq("job_id", jobId).in("origem_hash", hashes);
  // deno-lint-ignore no-explicit-any
  const set = new Set((existentes ?? []).map((e: any) => e.origem_hash));
  return chunk.filter(c => !set.has(c.origem_hash));
}

// ═══ SERVE ═══
serve(async (req: Request) => {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  return router.handle(req, sb);
});
