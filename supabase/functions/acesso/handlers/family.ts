// Acesso — actions do portal dos pais (autorização de retirada provisória)
import { Router, successResponse, AppError, resolveEscolaId } from "../../_shared/mod.ts";
import {
  type Any,
  assertFamiliaOwnership,
  getAuthenticatedPaiEmail,
  uuidToDeviceId,
  validarQualidadeFoto,
  onlyDigits,
  isValidCpf,
  resolveFamiliasDoPai,
} from "../_lib.ts";

export function register(router: Router) {
  router.on("acesso_minha_face", async (ctx) => {
    const { email } = ctx.body as Any;
    if (!email) throw new AppError("VALIDATION_FAILED", "Email obrigatório.");
    const familia = await assertFamiliaOwnership(ctx, email);
    if (!familia) return successResponse(null);
    const { data: face } = await ctx.sb.from("acesso_faces")
      .select("*").eq("pessoa_tipo", "responsavel").eq("pessoa_id", familia.id).eq("ativo", true).maybeSingle();
    return successResponse(face);
  });

  router.on("acesso_presenca_filhos", async (ctx) => {
    const { email } = ctx.body as Any;
    if (!email) throw new AppError("VALIDATION_FAILED", "Email obrigatório.");
    const familiaAuth = await assertFamiliaOwnership(ctx, email);
    if (!familiaAuth) return successResponse([]);
    const hoje = new Date().toISOString().split("T")[0];
    // alunos não tem familia_id; vínculo é por familia_email/email + escola_id
    const { data: alunos } = await ctx.sb.from("alunos")
      .select("id, nome, serie")
      .eq("escola_id", familiaAuth.escola_id)
      .or(`familia_email.eq.${familiaAuth.email},email.eq.${familiaAuth.email}`);
    if (!alunos?.length) return successResponse([]);
    const result = [];
    for (const a of alunos) {
      const { data: p } = await ctx.sb.from("acesso_presenca")
        .select("*").eq("aluno_id", a.id).eq("data", hoje).maybeSingle();
      result.push({
        aluno_id: a.id, aluno_nome: a.nome, serie: a.serie,
        status: p?.status || "ausente", hora_entrada: p?.hora_entrada, hora_saida: p?.hora_saida,
      });
    }
    return successResponse(result);
  });

  router.on("acesso_meus_autorizados", async (ctx) => {
    const { email } = ctx.body as Any;
    if (!email) throw new AppError("VALIDATION_FAILED", "Email obrigatório.");
    const familia = await assertFamiliaOwnership(ctx, email);
    if (!familia) return successResponse([]);
    const { data } = await ctx.sb.from("acesso_permissoes_retirada")
      .select("*").eq("responsavel_id", familia.id).order("criado_em", { ascending: false });
    return successResponse(data ?? []);
  });

  router.on("acesso_adicionar_autorizado", async (ctx) => {
    const { email_responsavel, aluno_id, aluno_nome, responsavel_nome, parentesco, foto, validade } = ctx.body as Any;
    if (!email_responsavel || !aluno_id || !responsavel_nome || !parentesco) {
      throw new AppError("VALIDATION_FAILED", "Campos obrigatórios: email, aluno_id, nome, parentesco.");
    }
    const familia = await assertFamiliaOwnership(ctx, email_responsavel);
    if (!familia) throw new AppError("NOT_FOUND", "Família não encontrada.");

    let fotoUrl: string | null = null;
    let fotoBinary: Uint8Array | null = null;
    if (foto) {
      const raw = atob(foto.replace(/^data:image\/\w+;base64,/, ""));
      fotoBinary = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) fotoBinary[i] = raw.charCodeAt(i);
      if (fotoBinary.length > 2 * 1024 * 1024) throw new AppError("VALIDATION_FAILED", "Foto deve ter no máximo 2MB.");

      const qualidade = await validarQualidadeFoto(ctx.sb, fotoBinary);
      if (!qualidade.ok) {
        return successResponse({ ok: false, qualidade_erros: qualidade.errors });
      }

      const path = `acesso/autorizados/${aluno_id}_${Date.now()}.jpg`;
      await ctx.sb.storage.from("wa-documentos").upload(path, fotoBinary, { contentType: "image/jpeg", upsert: true });
      const { data: signed } = await ctx.sb.storage.from("wa-documentos").createSignedUrl(path, 60 * 60 * 24 * 7);
      fotoUrl = signed?.signedUrl || null;
    }

    const paiEscolaId = await resolveEscolaId(ctx.req, ctx.sb, null, ctx.body);
    if (!paiEscolaId) throw new AppError("BAD_REQUEST", "Não foi possível determinar a escola.");

    const { error: permErr } = await ctx.sb.from("acesso_permissoes_retirada").insert({
      escola_id: paiEscolaId, aluno_id, aluno_nome: aluno_nome || "", responsavel_id: familia.id,
      responsavel_nome, responsavel_email: email_responsavel,
      responsavel_foto_url: fotoUrl, parentesco, validade: validade || null,
      autorizado: true, autorizado_por: "auto (portal pais)",
    });
    if (permErr) throw new AppError("BAD_REQUEST", permErr.message);

    const pessoaId = crypto.randomUUID();
    const deviceUserId = uuidToDeviceId(pessoaId);
    await ctx.sb.from("acesso_faces").insert({
      escola_id: paiEscolaId, pessoa_tipo: "responsavel", pessoa_id: pessoaId,
      pessoa_nome: responsavel_nome, foto_url: fotoUrl,
      device_user_id: deviceUserId, sync_status: "aguardando_aprovacao",
    });

    return successResponse({ ok: true });
  });

  router.on("acesso_cancelar_autorizado", async (ctx) => {
    const { id } = ctx.body as Any;
    if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");

    const authedEmail = await getAuthenticatedPaiEmail(ctx);
    const lookupEscolaId = await resolveEscolaId(ctx.req, ctx.sb, null, ctx.body);

    let qPerm = ctx.sb.from("acesso_permissoes_retirada")
      .select("id, responsavel_id, responsavel_email").eq("id", id);
    if (lookupEscolaId) qPerm = qPerm.eq("escola_id", lookupEscolaId);
    const { data: perm } = await qPerm.maybeSingle();
    if (!perm) throw new AppError("NOT_FOUND", "Autorização não encontrada.");

    let qFam = ctx.sb.from("familias").select("id, email").eq("id", perm.responsavel_id);
    if (lookupEscolaId) qFam = qFam.eq("escola_id", lookupEscolaId);
    const { data: familia } = await qFam.maybeSingle();

    const familiaEmail = String(familia?.email || perm.responsavel_email || "").toLowerCase();
    if (!familiaEmail || familiaEmail !== authedEmail) {
      throw new AppError("FORBIDDEN", "Você não tem permissão para cancelar esta autorização.");
    }

    if (lookupEscolaId) {
      await ctx.sb.from("acesso_permissoes_retirada").update({ autorizado: false }).eq("id", id).eq("escola_id", lookupEscolaId);
    } else {
      await ctx.sb.from("acesso_permissoes_retirada").update({ autorizado: false }).eq("id", id);
    }
    return successResponse({ ok: true });
  });

  // ─── Lista filhos + autorizados existentes (portal pai)
  router.on("acesso_pai_meus_autorizados", async (ctx) => {
    const email = await getAuthenticatedPaiEmail(ctx);
    const familias = await resolveFamiliasDoPai(ctx, email);
    if (!familias.length) return successResponse({ filhos: [] });

    // Cada familia.id é o aluno (mig 109 sincroniza). Buscar alunos por nome+escola pra cobrir id divergente
    const alunoIds: string[] = [];
    const familiaByAlunoId = new Map<string, Any>();
    const escolasIds = new Set<string>();
    for (const f of familias) {
      if (f.escola_id) escolasIds.add(f.escola_id);
      if (f.id) { alunoIds.push(f.id); familiaByAlunoId.set(f.id, f); }
    }

    let alunosPorNome: Any[] = [];
    if (escolasIds.size && familias.length) {
      const nomes = familias.map((f: Any) => f.nome_aluno).filter(Boolean);
      const { data } = await ctx.sb.from("alunos").select("id, nome, escola_id").in("escola_id", Array.from(escolasIds)).in("nome", nomes);
      alunosPorNome = data || [];
    }
    for (const a of alunosPorNome) {
      if (!alunoIds.includes(a.id)) alunoIds.push(a.id);
    }

    if (!alunoIds.length) return successResponse({ filhos: [] });

    const { data: perms } = await ctx.sb.from("acesso_permissoes_retirada")
      .select("id, aluno_id, aluno_nome, responsavel_id, responsavel_nome, responsavel_email, responsavel_cpf, responsavel_foto_url, parentesco, validade, autorizado, criado_por_familia, criado_em")
      .in("aluno_id", alunoIds)
      .order("criado_em", { ascending: false });

    const respIds = (perms ?? []).map((p: Any) => p.responsavel_id).filter(Boolean);
    const facesMap = new Map<string, Any>();
    if (respIds.length) {
      const { data: faces } = await ctx.sb.from("acesso_faces")
        .select("pessoa_id, sync_status").eq("ativo", true).eq("pessoa_tipo", "responsavel").in("pessoa_id", respIds);
      for (const f of faces || []) facesMap.set(f.pessoa_id, f);
    }

    const { data: tokens } = await ctx.sb.from("acesso_cadastro_tokens")
      .select("pessoa_id, expira_em, usado").eq("pessoa_tipo", "responsavel").in("pessoa_id", respIds);
    const tokenMap = new Map<string, Any>();
    for (const t of tokens || []) tokenMap.set(t.pessoa_id, t);

    const filhosOut: Any = {};
    for (const aid of alunoIds) {
      const fam = familiaByAlunoId.get(aid) || familias[0];
      filhosOut[aid] = { aluno_id: aid, aluno_nome: fam?.nome_aluno || "—", autorizados: [] };
    }
    for (const p of perms || []) {
      if (!filhosOut[p.aluno_id]) continue;
      const face = p.responsavel_id ? facesMap.get(p.responsavel_id) : null;
      const tk = p.responsavel_id ? tokenMap.get(p.responsavel_id) : null;
      let face_status = "sem_face";
      if (face?.sync_status === "sincronizado") face_status = "cadastrada";
      else if (face?.sync_status === "aguardando_aprovacao") face_status = "aguardando_aprovacao";
      else if (face?.sync_status === "erro") face_status = "erro";
      else if (tk && !tk.usado && new Date(tk.expira_em) > new Date()) face_status = "link_enviado";
      filhosOut[p.aluno_id].autorizados.push({
        id: p.id, responsavel_id: p.responsavel_id, nome: p.responsavel_nome,
        cpf: p.responsavel_cpf, email: p.responsavel_email,
        parentesco: p.parentesco, foto_url: p.responsavel_foto_url,
        validade: p.validade, ativo: !!p.autorizado,
        criado_por_familia: !!p.criado_por_familia, face_status,
      });
    }

    return successResponse({ filhos: Object.values(filhosOut) });
  });

  // ─── Cria autorização provisória (pelo pai)
  router.on("acesso_pai_autorizar_create", async (ctx) => {
    const email = await getAuthenticatedPaiEmail(ctx);
    const { aluno_id, responsavel_nome, responsavel_cpf, responsavel_email, parentesco, validade } = ctx.body as Any;

    if (!aluno_id || !responsavel_nome || !responsavel_cpf || !responsavel_email) {
      throw new AppError("VALIDATION_FAILED", "aluno_id, responsavel_nome, responsavel_cpf e responsavel_email são obrigatórios.");
    }
    const cpfDigits = onlyDigits(responsavel_cpf);
    if (!isValidCpf(cpfDigits)) throw new AppError("VALIDATION_FAILED", "CPF inválido.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(responsavel_email)) throw new AppError("VALIDATION_FAILED", "Email inválido.");
    if (validade && new Date(validade) < new Date(new Date().toDateString())) {
      throw new AppError("VALIDATION_FAILED", "Validade não pode ser no passado.");
    }

    const familias = await resolveFamiliasDoPai(ctx, email);
    const escolaId = familias[0]?.escola_id;
    if (!escolaId) throw new AppError("FORBIDDEN", "Família não encontrada para esse email.");

    const { data: aluno } = await ctx.sb.from("alunos").select("id, nome, escola_id, familia_email").eq("id", aluno_id).maybeSingle();
    if (!aluno) throw new AppError("NOT_FOUND", "Aluno não encontrado.");
    if (aluno.escola_id !== escolaId) throw new AppError("FORBIDDEN", "Esse aluno não pertence à sua família.");
    const matchPorEmail = String(aluno.familia_email || "").toLowerCase() === email;
    const matchPorNome = familias.some((f: Any) => String(f.nome_aluno || "").trim() === String(aluno.nome || "").trim());
    if (!matchPorEmail && !matchPorNome) throw new AppError("FORBIDDEN", "Esse aluno não pertence à sua família.");

    // LIMITE configurável em escola_config
    const { data: cfgRows } = await ctx.sb.from("escola_config")
      .select("chave, valor").eq("escola_id", escolaId).eq("chave", "max_autorizados_por_aluno");
    const maxAutorizados = Number(cfgRows?.[0]?.valor ?? 10) || 10;
    const { count: ativosCount } = await ctx.sb.from("acesso_permissoes_retirada")
      .select("id", { count: "exact", head: true })
      .eq("aluno_id", aluno_id).eq("autorizado", true);
    if ((ativosCount ?? 0) >= maxAutorizados) {
      throw new AppError("VALIDATION_FAILED", `Limite de ${maxAutorizados} autorizações ativas atingido para esse aluno. Revogue alguma antes de adicionar.`);
    }

    const { data: dupCheck } = await ctx.sb.from("acesso_permissoes_retirada")
      .select("id").eq("aluno_id", aluno_id).eq("autorizado", true)
      .eq("responsavel_cpf", cpfDigits).maybeSingle();
    if (dupCheck?.id) {
      throw new AppError("VALIDATION_FAILED", "Já existe uma autorização ativa para essa pessoa. Revogue antes de criar nova.");
    }

    const responsavel_id = crypto.randomUUID();
    const { data: perm, error } = await ctx.sb.from("acesso_permissoes_retirada").insert({
      escola_id: escolaId,
      aluno_id, aluno_nome: aluno.nome,
      responsavel_id, responsavel_nome, responsavel_email,
      responsavel_cpf: cpfDigits,
      parentesco: parentesco || "outro",
      validade: validade || null,
      autorizado: true,
      autorizado_por: `Pai/Mãe (${email})`,
      criado_por_familia: true,
      criado_por_pai_email: email,
    }).select().single();
    if (error) throw new AppError("BAD_REQUEST", error.message);

    // Gera link de cadastro de face + envia email
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    await ctx.sb.from("acesso_cadastro_tokens").insert({
      escola_id: escolaId, token,
      pessoa_tipo: "responsavel", pessoa_id: responsavel_id,
      pessoa_nome: responsavel_nome,
      email: responsavel_email,
      gerado_por: `pai:${email}`,
      expira_em: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    });

    const appUrl = Deno.env.get("APP_URL") || "https://maplebearcaxias.lumied.com.br";
    const link = `${appUrl}/cadastro-face.html?token=${token}`;

    let emailSent = false; let emailReason: string | null = null;
    try {
      const sendUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`;
      const sr = await fetch(sendUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          tipo: "cadastro_face",
          escola_id: escolaId,
          to: responsavel_email,
          pessoa_nome: responsavel_nome,
          pessoa_tipo: "responsavel",
          link,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const sb: Any = await sr.json().catch(() => ({}));
      emailSent = !!sb?.sent;
      if (!emailSent) emailReason = sb?.reason || `HTTP ${sr.status}`;
    } catch (e) { emailReason = String(e); }

    // Fire-and-forget: notifica secretaria/gerente
    try {
      const sendUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`;
      fetch(sendUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          tipo: "notif_pai_autorizou",
          escola_id: escolaId,
          aluno_nome: aluno.nome,
          responsavel_nome,
          responsavel_cpf: cpfDigits,
          responsavel_email,
          parentesco: parentesco || "outro",
          validade,
          pai_email: email,
        }),
        signal: AbortSignal.timeout(10_000),
      }).catch((e) => console.warn("[notif_pai_autorizou] Falhou:", String(e)));
    } catch (_) { /* ignore */ }

    return successResponse({ ok: true, permissao_id: perm.id, responsavel_id, link, email_enviado: emailSent, email_reason: emailReason });
  });

  // ─── Revoga autorização (pelo pai, somente se ele criou)
  router.on("acesso_pai_autorizar_revogar", async (ctx) => {
    const email = await getAuthenticatedPaiEmail(ctx);
    const { id } = ctx.body as Any;
    if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");

    const { data: perm } = await ctx.sb.from("acesso_permissoes_retirada")
      .select("id, criado_por_pai_email, autorizado, responsavel_id, escola_id").eq("id", id).maybeSingle();
    if (!perm) throw new AppError("NOT_FOUND", "Autorização não encontrada.");
    if (perm.criado_por_pai_email !== email) {
      throw new AppError("FORBIDDEN", "Você só pode revogar autorizações criadas por você. Outras devem ser revogadas pela escola.");
    }

    await ctx.sb.from("acesso_permissoes_retirada").update({ autorizado: false }).eq("id", id);

    // Se o responsável NÃO tiver mais nenhuma autorização ativa, marca face pra remoção
    if (perm.responsavel_id) {
      const { count: outrasAtivas } = await ctx.sb.from("acesso_permissoes_retirada")
        .select("id", { count: "exact", head: true })
        .eq("responsavel_id", perm.responsavel_id).eq("autorizado", true);
      if ((outrasAtivas ?? 0) === 0) {
        await ctx.sb.from("acesso_faces").update({
          sync_status: "aguardando_remocao",
          atualizado_em: new Date().toISOString(),
        })
          .eq("escola_id", perm.escola_id)
          .eq("pessoa_tipo", "responsavel")
          .eq("pessoa_id", perm.responsavel_id)
          .eq("ativo", true);
      }
    }

    return successResponse({ ok: true });
  });
}
