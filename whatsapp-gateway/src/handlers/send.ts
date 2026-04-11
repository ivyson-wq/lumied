import type { Env } from '../types';
import { getSupabase } from '../services/supabase';
import { enviarTextoLivre, enviarMensagemComBotao, enviarTemplate } from '../services/whatsapp';

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// UUID v4 format — tightens input validation before hitting Postgres.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Chamado pelo app quando professora/coordenação quer enviar mensagem aprovada
export async function handleSend(req: Request, env: Env): Promise<Response> {
  // Fail closed: if the shared secret is not configured, refuse all requests.
  if (!env.APP_INTERNAL_SECRET) {
    console.error('[SEND] APP_INTERNAL_SECRET not configured');
    return new Response('Unauthorized', { status: 401 });
  }

  // Autenticação interna — timing-safe comparison.
  const authHeader = req.headers.get('Authorization') ?? '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!provided || !timingSafeEqual(provided, env.APP_INTERNAL_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { mensagem_id, escola_id } = body ?? {};
  if (typeof mensagem_id !== 'string' || !UUID_RE.test(mensagem_id)) {
    return new Response(JSON.stringify({ error: 'mensagem_id inválido' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (escola_id !== undefined && (typeof escola_id !== 'string' || !UUID_RE.test(escola_id))) {
    return new Response(JSON.stringify({ error: 'escola_id inválido' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
  const db = getSupabase(env);

  // Buscar mensagem
  const { data: msg } = await db.from('wa_mensagens').select('*').eq('id', mensagem_id).single();
  if (!msg || msg.status !== 'aprovada') {
    return new Response(JSON.stringify({ error: 'Mensagem não encontrada ou não aprovada' }), { status: 404 });
  }

  // Buscar escola para phone_id
  const { data: escola } = await db.from('escolas').select('whatsapp_phone_id,nome').eq('id', msg.escola_id || escola_id).single();
  if (!escola?.whatsapp_phone_id) {
    return new Response(JSON.stringify({ error: 'Escola sem phone_id WhatsApp configurado' }), { status: 400 });
  }

  // Determinar destinatários
  let familias: any[] = [];
  if (msg.familia_id) {
    // Mensagem individual
    const { data: fam } = await db.from('wa_familias').select('id,whatsapp,nome').eq('id', msg.familia_id).eq('opt_in', true).single();
    if (fam) familias = [fam];
  } else if (msg.turma_id) {
    // Mensagem para turma
    const { data: fams } = await db.from('wa_familias').select('id,whatsapp,nome').eq('turma_id', msg.turma_id).eq('opt_in', true).execute();
    familias = fams ?? [];
  }

  let enviados = 0;
  let falhas = 0;

  for (const fam of familias) {
    // Verificar janela ativa
    const { data: janela } = await db.from('wa_janelas').select('status,expira_em')
      .eq('familia_id', fam.id).eq('status', 'ativa').single();
    const janelaAtiva = janela && new Date(janela.expira_em) > new Date();

    let resultado;
    if (janelaAtiva) {
      // Dentro da janela → texto livre gratuito + botão "Li e confirmo"
      const corpo = `🍁 *${escola.nome}*\n\n${msg.conteudo}`;
      resultado = await enviarMensagemComBotao(env, escola.whatsapp_phone_id, fam.whatsapp, corpo, 'confirmar_leitura', '✅ Li e confirmo');
    } else {
      // Fora da janela → template pago
      resultado = await enviarTemplate(env, escola.whatsapp_phone_id, fam.whatsapp, 'aviso_escolar_v1', [
        fam.nome, escola.nome, msg.conteudo.substring(0, 900),
      ]);
    }

    if (resultado) {
      enviados++;
      // Registrar professora na janela para roteamento de resposta
      if (msg.professora_id) {
        await db.from('wa_janelas').upsert({
          familia_id: fam.id,
          professora_id: msg.professora_id,
          mensagem_id: msg.id,
          aberta_em: new Date().toISOString(),
          expira_em: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          status: 'ativa',
        }, { onConflict: 'familia_id' }).execute();
      }
    } else {
      falhas++;
    }
  }

  // Atualizar status da mensagem
  await db.from('wa_mensagens').update({
    status: 'enviada',
    enviada_at: new Date().toISOString(),
  }).eq('id', mensagem_id).execute();

  return new Response(JSON.stringify({ enviados, falhas, total: familias.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
  } catch (err) {
    // Never leak internals to the caller.
    console.error('[SEND] Unhandled error:', (err as Error).message);
    return new Response(JSON.stringify({ error: 'internal error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
