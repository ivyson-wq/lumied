// ═══════════════════════════════════════════════════════════════
//  Maple Bear BG — Edge Function: api
//  Gerencia TUDO: login, sessões, solicitações, séries, gerentes
//  SEM Supabase Auth — sistema próprio de senhas e sessões
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ok  = (data: unknown)        => new Response(JSON.stringify(data),        { headers: { ...CORS, "Content-Type": "application/json" } });
const err = (msg: string, s = 400) => new Response(JSON.stringify({ error: msg }), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// ── Hashing de senha — gerentes (formato v1:base64:base64, 120k iter) ──
async function hashSenha(senha: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key  = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" }, key, 256);
  const s = btoa(String.fromCharCode(...salt));
  const h = btoa(String.fromCharCode(...new Uint8Array(bits)));
  return `v1:${s}:${h}`;
}

// ── Hashing de senha — professoras (formato hex:hex, 100k iter) ──
// Compatível com a edge function 'diplomas' que faz o login da professora
async function hashSenhaProf(senha: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${hashHex}`;
}

async function verificarSenha(senha: string, stored: string): Promise<boolean> {
  try {
    const [, sB64, hB64] = stored.split(":");
    const salt = Uint8Array.from(atob(sB64), c => c.charCodeAt(0));
    const key  = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" }, key, 256);
    const novo = btoa(String.fromCharCode(...new Uint8Array(bits)));
    return novo === hB64;
  } catch { return false; }
}

// ── Validar sessão ─────────────────────────────────────────────
async function validarSessao(admin: ReturnType<typeof createClient>, token: string | null) {
  if (!token) return null;
  const { data } = await admin
    .from("gerente_sessoes")
    .select("gerente_id, expira_em, gerentes(id, nome, email)")
    .eq("token", token)
    .single();
  if (!data) return null;
  if (new Date(data.expira_em) < new Date()) return null;
  return data.gerentes as { id: string; nome: string; email: string };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return err("Body inválido"); }
  const { action } = body;

  // ════════════════════════════════════════════════════════════
  //  AÇÕES PÚBLICAS (sem autenticação)
  // ════════════════════════════════════════════════════════════

  // Verifica se é o primeiro acesso (nenhum gerente cadastrado)
  if (action === "setup_check") {
    const { count } = await admin.from("gerentes").select("*", { count: "exact", head: true });
    return ok({ needs_setup: (count ?? 0) === 0 });
  }

  // Cria o primeiro gerente (só funciona se não houver nenhum)
  if (action === "setup") {
    const { count } = await admin.from("gerentes").select("*", { count: "exact", head: true });
    if ((count ?? 0) > 0) return err("Já existe um gerente cadastrado.", 403);
    const { nome, email, senha } = body as { nome: string; email: string; senha: string };
    if (!nome || !email || !senha) return err("Nome, e-mail e senha são obrigatórios.");
    if ((senha as string).length < 6) return err("Senha mínima de 6 caracteres.");
    const senha_hash = await hashSenha(senha as string);
    const { data: g, error } = await admin.from("gerentes").insert({ nome, email, senha_hash }).select().single();
    if (error) return err(error.message.includes("unique") ? "E-mail já cadastrado." : error.message);
    const { data: sessao } = await admin.from("gerente_sessoes").insert({ gerente_id: g.id }).select().single();
    return ok({ token: sessao!.token, nome: g.nome, email: g.email });
  }

  // Login
  if (action === "login") {
    const { email, senha } = body as { email: string; senha: string };
    if (!email || !senha) return err("E-mail e senha são obrigatórios.");
    const { data: g } = await admin.from("gerentes").select("*").eq("email", email).single();
    if (!g) return err("E-mail ou senha incorretos.", 401);
    const ok2 = await verificarSenha(senha as string, g.senha_hash);
    if (!ok2) return err("E-mail ou senha incorretos.", 401);
    // Limpa sessões expiradas
    await admin.from("gerente_sessoes").delete().lt("expira_em", new Date().toISOString());
    const { data: sessao } = await admin.from("gerente_sessoes").insert({ gerente_id: g.id }).select().single();
    return ok({ token: sessao!.token, nome: g.nome, email: g.email });
  }

  // Logout
  if (action === "logout") {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (token) await admin.from("gerente_sessoes").delete().eq("token", token);
    return ok({ success: true });
  }

  // Leitura pública de séries (para o formulário)
  if (action === "series_list") {
    const { data } = await admin.from("series").select("*").eq("ativo", true).order("ordem");
    return ok(data ?? []);
  }

  // Leitura pública de atividades (para o formulário) — com contagem de inscritos por turma
  if (action === "atividades_list") {
    const { data: atividades } = await admin.from("atividades").select("*").eq("ativo", true).order("ordem");
    if (!atividades?.length) return ok([]);

    // Busca todas as inscrições para contar por atividade+turma
    const { data: inscricoes } = await admin.from("inscricoes_atividades").select("turmas_selecionadas");

    // Monta mapa: "atividade_id|turma_nome" → contagem
    const ocupacao: Record<string, number> = {};
    for (const ins of inscricoes ?? []) {
      for (const ts of (ins.turmas_selecionadas ?? [])) {
        const key = `${ts.atividade_id}|${ts.turma}`;
        ocupacao[key] = (ocupacao[key] || 0) + 1;
      }
    }

    // Injeta inscritos e vagas_disponiveis em cada turma
    const resultado = atividades.map(a => ({
      ...a,
      horarios: (a.horarios ?? []).map((t: Record<string, unknown>) => {
        const inscritos = ocupacao[`${a.id}|${t.turma}`] || 0;
        const vagas = Number(t.vagas ?? 999);
        return { ...t, inscritos, vagas_disponiveis: Math.max(0, vagas - inscritos) };
      })
    }));

    return ok(resultado);
  }

  // Agenda do responsável (turno + atividades + ausências)
  if (action === "minha_agenda") {
    const { email } = body as { email: string };
    if (!email) return err("E-mail obrigatório.");
    const [solicitacoes, inscricoes, ausencias] = await Promise.all([
      admin.from("solicitacoes").select("*").eq("email", email).order("criado_em", { ascending: false }),
      admin.from("inscricoes_atividades").select("*").eq("email", email).order("criado_em", { ascending: false }),
      admin.from("ausencias").select("*").eq("email_resp", email).gte("data_ausencia", new Date().toISOString().split("T")[0]),
    ]);
    return ok({
      solicitacoes: solicitacoes.data ?? [],
      inscricoes: inscricoes.data ?? [],
      ausencias: ausencias.data ?? [],
    });
  }

  // Registrar ausência (check-out)
  if (action === "ausencia_submit") {
    const { email_resp, nome_crianca, data_ausencia, tipo, observacao } = body as Record<string, unknown>;
    if (!email_resp || !nome_crianca || !data_ausencia) return err("Campos obrigatórios ausentes.");
    // Verifica se já existe ausência para esse dia e criança
    const { data: exist } = await admin.from("ausencias")
      .select("id").eq("email_resp", email_resp).eq("nome_crianca", nome_crianca as string).eq("data_ausencia", data_ausencia as string).single();
    if (exist) return ok({ success: true, already: true });
    const { error } = await admin.from("ausencias").insert({ email_resp, nome_crianca, data_ausencia, tipo: tipo ?? "turno", observacao: observacao ?? null });
    if (error) return err(error.message);
    return ok({ success: true });
  }

  // Remover ausência (criança vai comparecer afinal)
  if (action === "ausencia_delete") {
    const { id } = body as { id: string };
    await admin.from("ausencias").delete().eq("id", id);
    return ok({ success: true });
  }

  // Leitura pública de configurações (logo)
  if (action === "config_get") {
    const { chave } = body as { chave: string };
    const { data } = await admin.from("configuracoes").select("valor").eq("chave", chave).single();
    return ok({ valor: data?.valor ?? null });
  }

  // Envio público do formulário de turno
  if (action === "public_submit") {
    const { email, nome_resp, nome_crianca, serie, turno, dias_semana } = body as Record<string, unknown>;
    if (!email || !nome_resp || !nome_crianca || !turno) return err("Campos obrigatórios ausentes.");
    const { error } = await admin.from("solicitacoes").insert({ email, nome_resp, nome_crianca, serie, turno, dias_semana: dias_semana ?? null });
    if (error) return err(error.message);
    return ok({ success: true });
  }

  // Inscrição pública em atividades
  if (action === "inscricao_atividade_submit") {
    const { email, nome_resp, nome_crianca, serie, atividades_ids, atividades_detalhe, turmas_selecionadas } = body as Record<string, unknown>;
    if (!email || !nome_resp || !nome_crianca || !atividades_ids) return err("Campos obrigatórios ausentes.");
    const { error } = await admin.from("inscricoes_atividades").insert({
      email, nome_resp, nome_crianca, serie,
      atividades_ids,
      atividades_detalhe: atividades_detalhe ?? [],
      turmas_selecionadas: turmas_selecionadas ?? []
    });
    if (error) return err(error.message);
    return ok({ success: true });
  }

  // ════════════════════════════════════════════════════════════
  //  AÇÕES AUTENTICADAS
  // ════════════════════════════════════════════════════════════
  const token = req.headers.get("authorization")?.replace("Bearer ", "") ?? null;
  const gerente = await validarSessao(admin, token);
  if (!gerente) return err("Sessão inválida ou expirada. Faça login novamente.", 401);

  // ── Solicitações ──────────────────────────────────────────────
  if (action === "solicitacoes_list") {
    const { data } = await admin.from("solicitacoes").select("*").order("criado_em", { ascending: false });
    return ok(data ?? []);
  }
  if (action === "solicitacoes_update_turno") {
    const { id, turno } = body as { id: string; turno: string };
    const { error } = await admin.from("solicitacoes").update({ turno }).eq("id", id);
    if (error) return err(error.message);
    return ok({ success: true });
  }
  if (action === "solicitacoes_delete") {
    const { id } = body as { id: string };
    await admin.from("solicitacoes").delete().eq("id", id);
    return ok({ success: true });
  }

  // ── Séries (CRUD completo) ────────────────────────────────────
  if (action === "series_list_all") {
    const { data } = await admin.from("series").select("*").order("ordem");
    return ok(data ?? []);
  }
  if (action === "series_create") {
    const { nome, ordem } = body as { nome: string; ordem: number };
    if (!nome) return err("Nome é obrigatório.");
    const { error } = await admin.from("series").insert({ nome, ordem: ordem ?? 99 });
    if (error) return err(error.message.includes("unique") ? "Já existe uma série com este nome." : error.message);
    return ok({ success: true });
  }
  if (action === "series_update") {
    const { id, nome, ordem, ativo } = body as { id: string; nome: string; ordem: number; ativo: boolean };
    const { error } = await admin.from("series").update({ nome, ordem, ativo }).eq("id", id);
    if (error) return err(error.message);
    return ok({ success: true });
  }
  if (action === "series_delete") {
    const { id } = body as { id: string };
    await admin.from("series").delete().eq("id", id);
    return ok({ success: true });
  }

  // ── Gerentes ──────────────────────────────────────────────────
  if (action === "gerentes_list") {
    const { data } = await admin.from("gerentes").select("id, nome, email, criado_em").order("criado_em");
    return ok(data ?? []);
  }
  if (action === "gerentes_create") {
    const { nome, email, senha } = body as { nome: string; email: string; senha: string };
    if (!nome || !email || !senha) return err("Nome, e-mail e senha são obrigatórios.");
    if ((senha as string).length < 6) return err("Senha mínima de 6 caracteres.");
    const senha_hash = await hashSenha(senha as string);
    const { error } = await admin.from("gerentes").insert({ nome, email, senha_hash });
    if (error) return err(error.message.includes("unique") ? "E-mail já cadastrado." : error.message);
    return ok({ success: true });
  }
  if (action === "gerentes_delete") {
    const { id } = body as { id: string };
    if (id === gerente.id) return err("Você não pode remover sua própria conta.");
    const { count } = await admin.from("gerentes").select("*", { count: "exact", head: true });
    if ((count ?? 0) <= 1) return err("É necessário manter pelo menos um gerente.");
    await admin.from("gerentes").delete().eq("id", id);
    return ok({ success: true });
  }
  if (action === "gerentes_change_password") {
    const { senhaAtual, novaSenha } = body as { senhaAtual: string; novaSenha: string };
    if (!senhaAtual || !novaSenha) return err("Preencha todos os campos.");
    if ((novaSenha as string).length < 6) return err("Senha mínima de 6 caracteres.");
    const { data: g } = await admin.from("gerentes").select("senha_hash").eq("id", gerente.id).single();
    if (!g || !(await verificarSenha(senhaAtual, g.senha_hash))) return err("Senha atual incorreta.");
    const hash = await hashSenha(novaSenha);
    await admin.from("gerentes").update({ senha_hash: hash }).eq("id", gerente.id);
    return ok({ success: true });
  }

  // ── Configurações ────────────────────────────────────────────
  if (action === "config_set") {
    const { chave, valor } = body as { chave: string; valor: string };
    await admin.from("configuracoes").upsert({ chave, valor, atualizado_em: new Date().toISOString() });
    return ok({ success: true });
  }
  if (action === "config_delete") {
    const { chave } = body as { chave: string };
    await admin.from("configuracoes").delete().eq("chave", chave);
    return ok({ success: true });
  }

  // ── Logo upload (base64) ─────────────────────────────────────
  if (action === "logo_upload") {
    const { base64, mime } = body as { base64: string; mime: string };
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
    if (!allowed.includes(mime)) return err("Tipo de arquivo não permitido.");
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    if (bytes.length > 5 * 1024 * 1024) return err("Arquivo muito grande (máx. 5MB).");
    const ext = mime.split("/")[1].replace("svg+xml", "svg");
    const path = `logo.${ext}`;
    const { error } = await admin.storage.from("logos").upload(path, bytes, { contentType: mime, upsert: true });
    if (error) return err(error.message);
    const { data: { publicUrl } } = admin.storage.from("logos").getPublicUrl(path);
    const url = publicUrl + "?t=" + Date.now();
    await admin.from("configuracoes").upsert({ chave: "logo_url", valor: url });
    return ok({ url });
  }
  if (action === "logo_remove") {
    await admin.from("configuracoes").delete().eq("chave", "logo_url");
    return ok({ success: true });
  }

  // ── Upload de relatório PDF para compartilhar ─────────────────
  if (action === "relatorio_upload") {
    const { base64, nome } = body as { base64: string; nome: string };
    if (!base64 || !nome) return err("base64 e nome são obrigatórios.");
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    if (bytes.length > 20 * 1024 * 1024) return err("Arquivo muito grande (máx. 20MB).");
    // Salva com timestamp para evitar cache
    const path = `relatorios/${nome}-${Date.now()}.pdf`;
    // Garante que o bucket 'relatorios' existe
    await admin.storage.createBucket('relatorios', { public: true, fileSizeLimit: 20971520 }).catch(() => {});
    const { error } = await admin.storage.from("relatorios").upload(path, bytes, { contentType: "application/pdf", upsert: false });
    if (error) return err(error.message);
    const { data: { publicUrl } } = admin.storage.from("relatorios").getPublicUrl(path);
    return ok({ url: publicUrl });
  }

  // ── Atividades (públicas) ─────────────────────────────────────
  if (action === "atividades_list") {
    const { data } = await admin.from("atividades").select("*").eq("ativo", true).order("ordem");
    return ok(data ?? []);
  }

  // ── Atividades CRUD (autenticado) ─────────────────────────────
  if (action === "atividades_list_all") {
    const { data: atividades } = await admin.from("atividades").select("*").order("ordem");
    if (!atividades?.length) return ok([]);

    const { data: inscricoes } = await admin.from("inscricoes_atividades").select("turmas_selecionadas");
    const ocupacao: Record<string, number> = {};
    for (const ins of inscricoes ?? []) {
      for (const ts of (ins.turmas_selecionadas ?? [])) {
        const key = `${ts.atividade_id}|${ts.turma}`;
        ocupacao[key] = (ocupacao[key] || 0) + 1;
      }
    }

    const resultado = atividades.map(a => ({
      ...a,
      horarios: (a.horarios ?? []).map((t: Record<string, unknown>) => {
        const inscritos = ocupacao[`${a.id}|${t.turma}`] || 0;
        const vagas = Number(t.vagas ?? 999);
        return { ...t, inscritos, vagas_disponiveis: Math.max(0, vagas - inscritos) };
      })
    }));

    return ok(resultado);
  }
  if (action === "atividades_create") {
    const { nome, preco, descricao, cor, horarios, ordem } = body as Record<string, unknown>;
    if (!nome) return err("Nome é obrigatório.");
    const { error } = await admin.from("atividades").insert({ nome, preco: preco ?? 0, descricao: descricao ?? "", cor: cor ?? "#C8102E", horarios: horarios ?? [], ordem: ordem ?? 99 });
    if (error) return err(error.message);
    return ok({ success: true });
  }
  if (action === "atividades_update") {
    const { id, nome, preco, descricao, cor, horarios, ordem, ativo } = body as Record<string, unknown>;
    if (!id) return err("ID obrigatório.");
    const { error } = await admin.from("atividades").update({ nome, preco, descricao, cor, horarios, ordem, ativo }).eq("id", id);
    if (error) return err(error.message);
    return ok({ success: true });
  }

  // Atualização completa (edição pelo gerente)
  if (action === "atividades_update_full") {
    const { id, nome, preco, descricao, cor, horarios, ordem } = body as Record<string, unknown>;
    if (!id || !nome) return err("ID e nome são obrigatórios.");
    const { error } = await admin.from("atividades").update({ nome, preco, descricao, cor, horarios, ordem }).eq("id", id);
    if (error) return err(error.message);
    return ok({ success: true });
  }
  if (action === "atividades_delete") {
    const { id } = body as { id: string };
    await admin.from("atividades").delete().eq("id", id);
    return ok({ success: true });
  }

  // ── Inscrições em atividades (autenticado) ────────────────────
  if (action === "inscricoes_atividades_list") {
    const { data } = await admin.from("inscricoes_atividades").select("*").order("criado_em", { ascending: false });
    return ok(data ?? []);
  }
  if (action === "inscricoes_atividades_delete") {
    const { id } = body as { id: string };
    await admin.from("inscricoes_atividades").delete().eq("id", id);
    return ok({ success: true });
  }

  // ── Professoras (autenticado) ─────────────────────────────────
  if (action === "professoras_list") {
    const { data } = await admin.from("professoras").select("*").order("nome");
    return ok(data ?? []);
  }
  if (action === "professoras_create") {
    const { nome, email, senha } = body as { nome: string; email: string; senha: string };
    if (!nome || !email) return err("Nome e e-mail são obrigatórios.");
    const insertData: Record<string, unknown> = { nome, email };
    if (senha) {
      if ((senha as string).length < 6) return err("Senha mínima de 6 caracteres.");
      insertData.senha_hash = await hashSenhaProf(senha as string);
    }
    const { error } = await admin.from("professoras").insert(insertData);
    if (error) return err(error.message.includes("unique") ? "E-mail já cadastrado." : error.message);
    return ok({ success: true });
  }
  if (action === "professoras_reset_senha") {
    const { id, nova_senha } = body as { id: string; nova_senha: string };
    if (!id || !nova_senha) return err("ID e nova senha são obrigatórios.");
    if ((nova_senha as string).length < 6) return err("Senha mínima de 6 caracteres.");
    const senha_hash = await hashSenhaProf(nova_senha as string);
    const { error } = await admin.from("professoras").update({ senha_hash }).eq("id", id);
    if (error) return err(error.message);
    return ok({ success: true });
  }
  if (action === "professoras_delete") {
    const { id } = body as { id: string };
    await admin.from("professoras").delete().eq("id", id);
    return ok({ success: true });
  }

  return err("Ação desconhecida.");
});
