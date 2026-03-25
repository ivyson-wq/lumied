// ═══════════════════════════════════════════════════════════════
//  Maple Bear BG — Edge Function: api
//  Gerencia TUDO: login, sessões, solicitações, séries, gerentes
//  SEM Supabase Auth — sistema próprio de senhas e sessões
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateChallenge, verifyRegistration, verifyAuthentication, b64urlEncode } from "../_shared/webauthn.ts";

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
    const logoutToken = (body._token as string) || req.headers.get("authorization")?.replace("Bearer ", "");
    if (logoutToken) await admin.from("gerente_sessoes").delete().eq("token", logoutToken);
    return ok({ success: true });
  }

  // WebAuthn login (público)
  if (action === "webauthn_login_challenge") {
    const { email, rp_id } = body as { email: string; rp_id: string };
    if (!email || !rp_id) return err("email e rp_id obrigatórios.", 400);
    const { data: g } = await admin.from("gerentes").select("id").eq("email", email).maybeSingle();
    if (!g) return err("Usuário não encontrado.", 404);
    const { data: creds } = await admin.from("webauthn_credentials").select("credential_id, transports").eq("usuario_tipo", "gerente").eq("usuario_id", g.id);
    if (!creds?.length) return err("Nenhuma biometria cadastrada.", 404);
    const challenge = generateChallenge();
    await admin.from("webauthn_challenges").insert({ challenge, usuario_tipo: "gerente", usuario_id: g.id, email, tipo: "login", rp_id });
    return ok({ challenge, rp_id, allowCredentials: creds.map(c => ({ id: c.credential_id, transports: c.transports })) });
  }
  if (action === "webauthn_login_verify") {
    const { credential, rp_id } = body as { credential: any; rp_id: string };
    if (!credential || !rp_id) return err("Dados incompletos.", 400);
    const { data: cred } = await admin.from("webauthn_credentials").select("*").eq("credential_id", credential.id).maybeSingle();
    if (!cred || cred.usuario_tipo !== "gerente") return err("Credencial não encontrada.", 404);
    const { data: ch } = await admin.from("webauthn_challenges").select("*").eq("tipo", "login").eq("usuario_id", cred.usuario_id).gt("expira_em", new Date().toISOString()).order("criado_em", { ascending: false }).limit(1).maybeSingle();
    if (!ch) return err("Challenge expirado.", 400);
    await admin.from("webauthn_challenges").delete().eq("id", ch.id);
    try {
      const result = await verifyAuthentication(credential.response.clientDataJSON, credential.response.authenticatorData, credential.response.signature, ch.challenge, rp_id, cred.public_key, cred.sign_count);
      await admin.from("webauthn_credentials").update({ sign_count: result.newSignCount }).eq("id", cred.id);
      const { data: g } = await admin.from("gerentes").select("nome, email").eq("id", cred.usuario_id).maybeSingle();
      if (!g) return err("Gerente não encontrado.", 404);
      const { data: sess } = await admin.from("gerente_sessoes").insert({ gerente_id: cred.usuario_id }).select("token").single();
      return ok({ token: sess!.token, nome: g.nome, email: g.email });
    } catch (e) { return err("Verificação falhou: " + (e as Error).message, 400); }
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

  // ── Manutenção — envio público (qualquer portal) ─────────────
  if (action === "manutencao_submit") {
    const { descricao, localizacao, urgencia, usuario_id, _email, base64, mime } = body as Record<string, unknown>;
    if (!descricao || !localizacao || !urgencia) return err("Descrição, localização e urgência são obrigatórios.");
    const urgencias = ["baixa", "media", "alta", "critica"];
    if (!urgencias.includes(urgencia as string)) return err("Urgência inválida. Use: baixa, media, alta, critica.");
    let foto_url: string | null = null;
    if (base64 && mime) {
      const allowed = ["image/jpeg", "image/png", "image/webp"];
      if (!allowed.includes(mime as string)) return err("Tipo de imagem não permitido.");
      const bytes = Uint8Array.from(atob(base64 as string), c => c.charCodeAt(0));
      if (bytes.length > 10 * 1024 * 1024) return err("Imagem muito grande (máx. 10MB).");
      const ext = (mime as string).split("/")[1];
      const path = `fotos/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      await admin.storage.createBucket("manutencoes", { public: true }).catch(() => {});
      const { error: upErr } = await admin.storage.from("manutencoes").upload(path, bytes, { contentType: mime as string, upsert: false });
      if (upErr) return err("Erro ao enviar foto: " + upErr.message);
      const { data: { publicUrl } } = admin.storage.from("manutencoes").getPublicUrl(path);
      foto_url = publicUrl;
    }
    const insert: Record<string, unknown> = { descricao, localizacao, urgencia, foto_url };
    if (usuario_id) insert.usuario_id = usuario_id;
    const { error } = await admin.from("manutencoes").insert(insert);
    if (error) return err(error.message);
    return ok({ success: true });
  }

  // ════════════════════════════════════════════════════════════
  //  AÇÕES AUTENTICADAS
  // ════════════════════════════════════════════════════════════
  // Token: prioriza _token do body (evita conflito com JWT Verification do Supabase),
  // fallback para Authorization header
  const authHeader = req.headers.get("authorization")?.replace("Bearer ", "") ?? null;
  const token = (body._token as string) || authHeader;
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

  // ── Usuários Unificados ──────────────────────────────────────
  if (action === "usuarios_list") {
    const { data } = await admin.from("usuarios").select("id, nome, email, papel, ativo, criado_em").order("papel").order("nome");
    const users = data ?? [];
    // Enriquece professoras com serie_id
    const profEmails = users.filter(u => u.papel === 'professora' || u.papel === 'professora_assistente').map(u => u.email);
    if (profEmails.length) {
      const { data: profs } = await admin.from("professoras").select("email, serie_id, series(id, nome)").in("email", profEmails);
      const profMap = new Map((profs ?? []).map((p: any) => [p.email, { serie_id: p.serie_id, serie_nome: p.series?.nome }]));
      for (const u of users) {
        const p = profMap.get(u.email);
        if (p) { (u as any).serie_id = p.serie_id; (u as any).serie_nome = p.serie_nome; }
      }
    }
    return ok(users);
  }
  if (action === "usuarios_create") {
    const { nome, email, senha, papel } = body as { nome: string; email: string; senha: string; papel: string };
    if (!nome || !email || !senha || !papel) return err("Nome, e-mail, senha e papel são obrigatórios.");
    const papeisValidos = ["gerente", "professora", "professora_assistente", "secretaria", "manutencao"];
    if (!papeisValidos.includes(papel)) return err("Papel inválido.");
    if ((senha as string).length < 6) return err("Senha mínima de 6 caracteres.");
    // Usa hash hex (100k iter) padrão unificado
    const senha_hash = await hashSenhaProf(senha as string);
    const { error } = await admin.from("usuarios").insert({ nome, email, senha_hash, papel });
    if (error) return err(error.message.includes("unique") ? "E-mail já cadastrado." : error.message);
    // Sincroniza com tabela legada correspondente
    if (papel === "gerente") {
      await admin.from("gerentes").insert({ nome, email, senha_hash: await hashSenha(senha as string) }).catch(() => {});
    } else if (papel === "professora" || papel === "professora_assistente" || papel === "manutencao") {
      await admin.from("professoras").insert({ nome, email, senha_hash, tipo: papel === "professora" ? "professora" : papel }).catch(() => {});
    } else if (papel === "secretaria") {
      await admin.from("secretarias").insert({ nome, email, senha_hash }).catch(() => {});
    }
    return ok({ success: true });
  }
  if (action === "usuarios_update") {
    const { id, nome, email, papel } = body as { id: string; nome: string; email: string; papel: string };
    if (!id) return err("ID obrigatório.");
    const update: Record<string, unknown> = {};
    if (nome) update.nome = nome;
    if (email) update.email = email;
    if (papel) update.papel = papel;
    const { error } = await admin.from("usuarios").update(update).eq("id", id);
    if (error) return err(error.message.includes("unique") ? "E-mail já cadastrado." : error.message);
    return ok({ success: true });
  }
  if (action === "usuarios_delete") {
    const { id } = body as { id: string };
    if (!id) return err("ID obrigatório.");
    // Busca o usuário para saber o papel
    const { data: u } = await admin.from("usuarios").select("email, papel").eq("id", id).single();
    if (!u) return err("Usuário não encontrado.");
    // Não permite excluir a si mesmo
    if (u.email === gerente.email) return err("Você não pode remover sua própria conta.");
    // Verifica se é o último gerente
    if (u.papel === "gerente") {
      const { count } = await admin.from("usuarios").select("*", { count: "exact", head: true }).eq("papel", "gerente");
      if ((count ?? 0) <= 1) return err("É necessário manter pelo menos um gerente.");
    }
    await admin.from("usuarios").delete().eq("id", id);
    // Remove da tabela legada correspondente
    if (u.papel === "gerente") await admin.from("gerentes").delete().eq("email", u.email).catch(() => {});
    else if (["professora", "professora_assistente", "manutencao"].includes(u.papel)) await admin.from("professoras").delete().eq("email", u.email).catch(() => {});
    else if (u.papel === "secretaria") await admin.from("secretarias").delete().eq("email", u.email).catch(() => {});
    return ok({ success: true });
  }
  if (action === "usuarios_reset_senha") {
    const { id, nova_senha } = body as { id: string; nova_senha: string };
    if (!id || !nova_senha) return err("ID e nova senha são obrigatórios.");
    if ((nova_senha as string).length < 6) return err("Senha mínima de 6 caracteres.");
    const senha_hash = await hashSenhaProf(nova_senha as string);
    const { error } = await admin.from("usuarios").update({ senha_hash }).eq("id", id);
    if (error) return err(error.message);
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
    const { nome, email, senha, tipo } = body as { nome: string; email: string; senha: string; tipo?: string };
    if (!nome || !email) return err("Nome e e-mail são obrigatórios.");
    const tiposValidos = ["professora", "professora_assistente", "manutencao"];
    const insertData: Record<string, unknown> = { nome, email, tipo: tiposValidos.includes(tipo ?? "") ? tipo : "professora" };
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

  // ── Manutenção CRUD (autenticado — gerente) ─────────────────
  if (action === "manutencao_list") {
    const { data, error } = await admin
      .from("manutencoes")
      .select("*, usuarios(nome, email)")
      .order("criado_em", { ascending: false });
    if (error) return err(error.message);
    // Sort by urgencia priority: critica > alta > media > baixa, then by criado_em desc
    const prioridade: Record<string, number> = { critica: 0, alta: 1, media: 2, baixa: 3 };
    const sorted = (data ?? []).sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      const pa = prioridade[a.urgencia as string] ?? 9;
      const pb = prioridade[b.urgencia as string] ?? 9;
      if (pa !== pb) return pa - pb;
      return new Date(b.criado_em as string).getTime() - new Date(a.criado_em as string).getTime();
    });
    return ok(sorted);
  }
  if (action === "manutencao_create") {
    const { descricao, localizacao, urgencia, foto_url: fotoUrlBody, usuario_id, base64, mime } = body as Record<string, unknown>;
    if (!descricao || !localizacao || !urgencia) return err("Descrição, localização e urgência são obrigatórios.");
    const urgencias = ["baixa", "media", "alta", "critica"];
    if (!urgencias.includes(urgencia as string)) return err("Urgência inválida. Use: baixa, media, alta, critica.");
    let foto_url: string | null = (fotoUrlBody as string) ?? null;
    if (base64 && mime) {
      const allowed = ["image/jpeg", "image/png", "image/webp"];
      if (!allowed.includes(mime as string)) return err("Tipo de imagem não permitido.");
      const bytes = Uint8Array.from(atob(base64 as string), c => c.charCodeAt(0));
      if (bytes.length > 10 * 1024 * 1024) return err("Imagem muito grande (máx. 10MB).");
      const ext = (mime as string).split("/")[1];
      const path = `fotos/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      await admin.storage.createBucket("manutencoes", { public: true }).catch(() => {});
      const { error: upErr } = await admin.storage.from("manutencoes").upload(path, bytes, { contentType: mime as string, upsert: false });
      if (upErr) return err("Erro ao enviar foto: " + upErr.message);
      const { data: { publicUrl } } = admin.storage.from("manutencoes").getPublicUrl(path);
      foto_url = publicUrl;
    }
    const insert: Record<string, unknown> = { descricao, localizacao, urgencia, foto_url };
    if (usuario_id) insert.usuario_id = usuario_id;
    const { error } = await admin.from("manutencoes").insert(insert);
    if (error) return err(error.message);
    return ok({ success: true });
  }
  if (action === "manutencao_update_status") {
    const { id, status, equipe_responsavel, observacao_gerente } = body as Record<string, unknown>;
    if (!id || !status) return err("ID e status são obrigatórios.");
    const statusValidos = ["aprovada", "em_execucao", "concluida", "rejeitada"];
    if (!statusValidos.includes(status as string)) return err("Status inválido. Use: aprovada, em_execucao, concluida, rejeitada.");
    const update: Record<string, unknown> = { status, atualizado_em: new Date().toISOString() };
    if (equipe_responsavel !== undefined) update.equipe_responsavel = equipe_responsavel;
    if (observacao_gerente !== undefined) update.observacao_gerente = observacao_gerente;
    if (status === "concluida") update.data_conclusao = new Date().toISOString().split("T")[0];
    const { error } = await admin.from("manutencoes").update(update).eq("id", id);
    if (error) return err(error.message);
    return ok({ success: true });
  }
  if (action === "manutencao_delete") {
    const { id } = body as { id: string };
    if (!id) return err("ID obrigatório.");
    await admin.from("manutencoes").delete().eq("id", id);
    return ok({ success: true });
  }

  // ── Famílias (CRUD) ─────────────────────────────────────
  if (action === "familias_list") {
    const { data } = await admin.from("familias").select("*").order("nome_aluno");
    return ok(data ?? []);
  }
  if (action === "familias_update") {
    const { cpf, serie } = body as { cpf: string; serie: string | null };
    if (!cpf) return err("CPF obrigatório.");
    const { error } = await admin.from("familias").update({ serie }).eq("cpf", cpf);
    if (error) return err(error.message);
    return ok({ success: true });
  }
  if (action === "familias_delete") {
    const { cpf } = body as { cpf: string };
    if (!cpf) return err("CPF obrigatório.");
    await admin.from("familias").delete().eq("cpf", cpf);
    return ok({ success: true });
  }

  // ── Equipes de manutenção (CRUD) ────────────────────────
  if (action === "manut_equipes_list") {
    const { data } = await admin.from("manut_equipes").select("*").eq("ativo", true).order("nome");
    return ok(data ?? []);
  }
  if (action === "manut_equipes_list_all") {
    const { data } = await admin.from("manut_equipes").select("*").order("nome");
    return ok(data ?? []);
  }
  if (action === "manut_equipe_save") {
    const { id, nome } = body as { id?: string; nome: string };
    if (!nome) return err("Nome obrigatório.");
    if (id) {
      const { error } = await admin.from("manut_equipes").update({ nome }).eq("id", id);
      if (error) return err(error.message);
    } else {
      const { error } = await admin.from("manut_equipes").insert({ nome });
      if (error) return err(error.message.includes("unique") ? "Já existe uma equipe com este nome." : error.message);
    }
    return ok({ success: true });
  }
  if (action === "manut_equipe_toggle") {
    const { id, ativo } = body as { id: string; ativo: boolean };
    if (!id) return err("ID obrigatório.");
    await admin.from("manut_equipes").update({ ativo }).eq("id", id);
    return ok({ success: true });
  }

  // ── Categorias de insumos ───────────────────────────────
  if (action === "alm_categorias_list") {
    const { data } = await admin.from("alm_categorias").select("*").eq("ativo", true).order("nome");
    return ok(data ?? []);
  }
  if (action === "alm_categorias_list_all") {
    const { data } = await admin.from("alm_categorias").select("*").order("nome");
    return ok(data ?? []);
  }
  if (action === "alm_categoria_save") {
    const { id, nome } = body as { id?: string; nome: string };
    if (!nome) return err("Nome obrigatório.");
    if (id) {
      const { error } = await admin.from("alm_categorias").update({ nome }).eq("id", id);
      if (error) return err(error.message);
    } else {
      const { error } = await admin.from("alm_categorias").insert({ nome });
      if (error) return err(error.message.includes("unique") ? "Já existe uma categoria com este nome." : error.message);
    }
    return ok({ success: true });
  }
  if (action === "alm_categoria_toggle") {
    const { id, ativo } = body as { id: string; ativo: boolean };
    if (!id) return err("ID obrigatório.");
    await admin.from("alm_categorias").update({ ativo }).eq("id", id);
    return ok({ success: true });
  }

  // ── Calendario Escolar ─────────────────────────────────
  if (action === "calendario_list") {
    const { mes, ano } = body as { mes?: string; ano?: string };
    let query = admin.from("calendario_eventos").select("*").order("data_inicio");
    if (mes) {
      const [y, m] = mes.split("-");
      const inicio = `${y}-${m}-01`;
      const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
      const fim = `${y}-${m}-${lastDay}`;
      query = query.gte("data_inicio", inicio).lte("data_inicio", fim);
    } else if (ano) {
      query = query.gte("data_inicio", `${ano}-01-01`).lte("data_inicio", `${ano}-12-31`);
    }
    const { data } = await query;
    return ok(data ?? []);
  }
  if (action === "calendario_list_public") {
    // Para pais e professoras (sem auth)
    const mes = (body as any).mes || new Date().toISOString().slice(0, 7);
    const [y, m] = mes.split("-");
    const inicio = `${y}-${m}-01`;
    const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
    const fim = `${y}-${m}-${lastDay}`;
    const portal = (body as any).portal || "pais";
    let query = admin.from("calendario_eventos").select("*")
      .gte("data_inicio", inicio).lte("data_inicio", fim).order("data_inicio");
    if (portal === "pais") query = query.eq("visivel_pais", true);
    else query = query.eq("visivel_professoras", true);
    const { data } = await query;
    return ok(data ?? []);
  }
  if (action === "calendario_save") {
    const { id, titulo, descricao, data_inicio, data_fim, tipo, cor, visivel_pais, visivel_professoras } = body as any;
    if (!titulo || !data_inicio) return err("Titulo e data obrigatorios.");
    const data = { titulo, descricao: descricao || null, data_inicio, data_fim: data_fim || data_inicio, tipo: tipo || "evento", cor: cor || "#C8102E", visivel_pais: visivel_pais ?? true, visivel_professoras: visivel_professoras ?? true, criado_por: gerente?.nome };
    if (id) {
      await admin.from("calendario_eventos").update(data).eq("id", id);
    } else {
      await admin.from("calendario_eventos").insert(data);
    }
    return ok({ success: true });
  }
  if (action === "calendario_delete") {
    const { id } = body as { id: string };
    if (!id) return err("ID obrigatorio.");
    await admin.from("calendario_eventos").delete().eq("id", id);
    return ok({ success: true });
  }

  // ── Analytics Dashboard ───────────────────────────────
  if (action === "analytics_dashboard") {
    const ano = (body as any).ano || new Date().getFullYear().toString();
    // Solicitacoes por mes
    const { data: sols } = await admin.from("solicitacoes").select("criado_em, turno").gte("criado_em", `${ano}-01-01`).lte("criado_em", `${ano}-12-31T23:59:59`);
    const solsPorMes = Array(12).fill(0);
    for (const s of sols ?? []) { const m = new Date(s.criado_em).getMonth(); solsPorMes[m]++; }

    // Almoxarifado gastos por mes
    const { data: reqs } = await admin.from("alm_requisicoes").select("mes, total, status").like("mes", `${ano}-%`);
    const gastosPorMes = Array(12).fill(0);
    for (const r of reqs ?? []) {
      if (r.status === "aprovado") {
        const m = parseInt(r.mes.split("-")[1]) - 1;
        gastosPorMes[m] += r.total || 0;
      }
    }

    // Manutencao por status
    const { data: manuts } = await admin.from("manutencoes").select("status, urgencia, criado_em").gte("criado_em", `${ano}-01-01`);
    const manutStatus: Record<string, number> = {};
    const manutPorMes = Array(12).fill(0);
    for (const m of manuts ?? []) {
      manutStatus[m.status] = (manutStatus[m.status] || 0) + 1;
      const mo = new Date(m.criado_em).getMonth();
      manutPorMes[mo]++;
    }

    // Atividades inscritos
    const { data: ativs } = await admin.from("atividades").select("nome, horarios").eq("ativo", true);
    const atividadesData = (ativs ?? []).map((a: any) => ({
      nome: a.nome,
      inscritos: (a.horarios || []).reduce((s: number, h: any) => s + (h.inscritos || 0), 0),
    }));

    return ok({
      solicitacoes_por_mes: solsPorMes,
      gastos_almox_por_mes: gastosPorMes,
      manutencao_status: manutStatus,
      manutencao_por_mes: manutPorMes,
      atividades: atividadesData,
      ano,
    });
  }

  // ── Atribuir turma/série a professora ───────────────────
  if (action === "usuarios_set_serie") {
    const { email, serie_id } = body as { email: string; serie_id: string | null };
    if (!email) return err("E-mail obrigatório.");
    const { error } = await admin.from("professoras").update({ serie_id: serie_id || null }).eq("email", email);
    if (error) return err(error.message);
    return ok({ success: true });
  }

  // ── Notificações ────────────────────────────────────────
  if (action === "notif_list") {
    const { portal, email } = body as { portal: string; email: string };
    if (!portal || !email) return err("portal e email obrigatórios.");
    const { data } = await admin.from("notificacoes").select("*")
      .eq("portal", portal).eq("destinatario", email)
      .order("criado_em", { ascending: false }).limit(50);
    return ok(data ?? []);
  }
  if (action === "notif_marcar_lida") {
    const { ids } = body as { ids: string[] };
    if (!ids || !Array.isArray(ids)) return err("ids obrigatório (array).");
    await admin.from("notificacoes").update({ lida: true }).in("id", ids);
    return ok({ success: true });
  }
  if (action === "notif_marcar_todas") {
    const { portal, email } = body as { portal: string; email: string };
    if (!portal || !email) return err("portal e email obrigatórios.");
    await admin.from("notificacoes").update({ lida: true }).eq("portal", portal).eq("destinatario", email).eq("lida", false);
    return ok({ success: true });
  }

  // ── WebAuthn / Biometria (gerente) ──────────────────────
  if (action === "webauthn_register_challenge") {
    const rp_id = body.rp_id as string;
    if (!rp_id || !gerente) return err("Sessão inválida.", 401);
    const challenge = generateChallenge();
    await admin.from("webauthn_challenges").insert({ challenge, usuario_tipo: "gerente", usuario_id: gerente.id, tipo: "register", rp_id });
    await admin.from("webauthn_challenges").delete().lt("expira_em", new Date().toISOString());
    return ok({ challenge, rp_id, user_id: b64urlEncode(new TextEncoder().encode(gerente.id)), user_name: gerente.email, user_display_name: gerente.nome });
  }
  if (action === "webauthn_register_verify") {
    const { credential, rp_id } = body as { credential: any; rp_id: string };
    if (!credential || !rp_id || !gerente) return err("Dados incompletos.", 400);
    const { data: ch } = await admin.from("webauthn_challenges").select("*").eq("tipo", "register").eq("usuario_id", gerente.id).gt("expira_em", new Date().toISOString()).order("criado_em", { ascending: false }).limit(1).maybeSingle();
    if (!ch) return err("Challenge expirado.", 400);
    await admin.from("webauthn_challenges").delete().eq("id", ch.id);
    try {
      const result = await verifyRegistration(credential.response.clientDataJSON, credential.response.attestationObject, ch.challenge, rp_id);
      await admin.from("webauthn_credentials").insert({ usuario_tipo: "gerente", usuario_id: gerente.id, credential_id: result.credentialId, public_key: result.publicKey, sign_count: result.signCount, transports: credential.transports || ["internal"], rp_id });
      return ok({ success: true });
    } catch (e) { return err("Verificação falhou: " + (e as Error).message, 400); }
  }

  // WebAuthn login (public — before session validation)
  // These are handled above in the public section, but we put them here as fallthrough
  return err("Ação desconhecida.");
});
