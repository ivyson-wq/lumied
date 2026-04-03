import type { Env, WhatsAppWebhookPayload, Familia } from '../types';
import { getSupabase } from '../services/supabase';
import { routeParaProf } from '../services/router';
import { enviarTextoLivre, enviarMensagemComBotao, marcarComoLida } from '../services/whatsapp';
import { ativarEstouACaminho } from '../features/estou-a-caminho';
import { processarConfirmacao } from '../features/confirmacao';
import { processarFaq } from '../features/faq-bot';
import { processarDocumento, processarConfirmacaoDocumento } from '../features/documento-intake';

const KEYWORDS_ESTOU_A_CAMINHO = ['A CAMINHO', 'ACAMINHO', 'BUSCA', 'BUSCANDO', 'ESTOU INDO', 'JA ESTOU'];

export async function handleWebhook(req: Request, env: Env): Promise<Response> {
  const body = await req.json() as WhatsAppWebhookPayload;
  const db = getSupabase(env);

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      const phoneId = value.metadata?.phone_number_id;

      for (const msg of value.messages ?? []) {
        const waId = msg.from;

        // Marcar como lida
        await marcarComoLida(env, phoneId, msg.id);

        // ── Check if sender is STAFF (coordenação/direção/secretaria) ──
        const { data: staff } = await db
          .from('wa_staff').select('id,escola_id,nome,papel,whatsapp')
          .eq('whatsapp', waId).eq('ativo', true).single();

        if (staff) {
          // Staff member — handle document intake or confirmation

          // Document confirmation buttons (doc_<id>_confirmar / doc_<id>_rejeitar)
          if (msg.type === 'interactive' && msg.interactive?.button_reply?.id?.startsWith('doc_')) {
            await processarConfirmacaoDocumento(db, env, phoneId, waId, msg.interactive.button_reply.id);
            continue;
          }

          // Image or document from staff → document intake
          if (msg.type === 'image' && msg.image) {
            await processarDocumento(db, env, phoneId, staff, {
              id: msg.image.id,
              mime_type: msg.image.mime_type,
              sha256: msg.image.sha256,
            }, msg.image.caption);
            continue;
          }

          if (msg.type === 'document' && msg.document) {
            await processarDocumento(db, env, phoneId, staff, {
              id: msg.document.id,
              mime_type: msg.document.mime_type,
              sha256: msg.document.sha256,
              filename: msg.document.filename,
            }, msg.document.caption);
            continue;
          }

          // Text from staff without media — treat as context for next document
          if (msg.type === 'text') {
            await enviarTextoLivre(env, phoneId, waId,
              `📎 Olá, ${staff.nome}! Para arquivar um documento, envie a *foto* ou *arquivo* (PDF, imagem). ` +
              `Pode incluir uma descrição na legenda.\n\n` +
              `Exemplos:\n` +
              `_📸 Foto do atestado médico da prof. Maria_\n` +
              `_📄 Certificado de primeiros socorros_\n` +
              `_📋 Ata da reunião pedagógica de março_`);
            continue;
          }

          // Other media types from staff — not supported yet
          await enviarTextoLivre(env, phoneId, waId,
            '⚠️ Formato não suportado. Envie como *foto* ou *PDF/documento*.');
          continue;
        }

        // ── Regular flow: family member ──

        // 1. Buscar família
        const { data: familia } = await db
          .from('wa_familias').select('id,nome,whatsapp,aluno_nome,turma_id,escola_id,opt_in,familia_id_saas')
          .eq('whatsapp', waId).single() as { data: Familia | null };

        if (!familia) {
          await enviarTextoLivre(env, phoneId, waId,
            'Olá! Seu número não está cadastrado no sistema da escola. Por favor, entre em contato com a secretaria para vincular seu WhatsApp. 📞');
          continue;
        }

        // 2. Verificar se escola tem módulo ativo
        const { data: escola } = await db
          .from('escolas').select('modulo_whatsapp,whatsapp_phone_id')
          .eq('id', familia.escola_id).single();
        if (!escola?.modulo_whatsapp) continue;

        // 3. Renovar janela de atendimento (24h)
        await renovarJanela(db, familia.id);

        // 4. Classificar e rotear

        // Opt-in inicial
        if (msg.type === 'text' && ['OLÁ', 'OLA', 'OI', 'COMEÇAR', 'COMECAR'].includes(msg.text!.body.trim().toUpperCase())) {
          if (!familia.opt_in) {
            await db.from('wa_familias').update({ opt_in: true, opt_in_at: new Date().toISOString() }).eq('id', familia.id).execute();
          }
          await enviarTextoLivre(env, phoneId, waId,
            `Olá, ${familia.nome}! 👋 Bem-vindo ao canal de comunicação da Maple Bear.\n\nVocê receberá comunicados, avisos de eventos e pode tirar dúvidas por aqui.\n\nAluno(a): *${familia.aluno_nome || '—'}*\n\nPara qualquer dúvida, é só digitar! 🍁`);
          await db.from('wa_respostas').insert({ familia_id: familia.id, tipo: 'opt_in', conteudo: msg.text!.body, whatsapp_msg_id: msg.id }).select();
          continue;
        }

        // Confirmação de leitura (botão)
        if (msg.type === 'interactive' && msg.interactive?.button_reply?.id === 'confirmar_leitura') {
          await db.from('wa_respostas').insert({
            familia_id: familia.id, tipo: 'confirmacao_leitura',
            conteudo: 'Li e confirmo', whatsapp_msg_id: msg.id,
          }).select();
          await enviarTextoLivre(env, phoneId, waId, '✅ Confirmado! Obrigado.');
          continue;
        }

        // Confirmação de evento (botões)
        if (msg.type === 'interactive' && msg.interactive?.button_reply?.id?.startsWith('evento_')) {
          await processarConfirmacao(db, env, phoneId, familia as any, msg);
          continue;
        }

        // Estou a caminho (keyword)
        if (msg.type === 'text') {
          const texto = msg.text!.body.trim().toUpperCase();
          if (KEYWORDS_ESTOU_A_CAMINHO.some(k => texto.includes(k))) {
            await ativarEstouACaminho(env, phoneId, familia as any);
            await db.from('wa_respostas').insert({ familia_id: familia.id, tipo: 'estou_a_caminho', conteudo: msg.text!.body, whatsapp_msg_id: msg.id }).select();
            continue;
          }
        }

        // Texto livre → tentar FAQ bot → se não, rotear para professora
        if (msg.type === 'text') {
          const respondidoPeloBot = await processarFaq(db, env, phoneId, familia as any, msg);
          if (respondidoPeloBot) continue;
        }

        // Rotear para professora
        const professoraId = await routeParaProf(db, familia.id);
        await db.from('wa_respostas').insert({
          familia_id: familia.id,
          professora_id: professoraId,
          tipo: msg.type === 'text' ? 'resposta_texto' : 'duvida_roteada',
          conteudo: msg.text?.body || `[${msg.type}]`,
          whatsapp_msg_id: msg.id,
        }).select();
      }

      // Status updates (leitura pela família)
      for (const status of value.statuses ?? []) {
        if (status.status === 'read') {
          await db.from('wa_mensagens').update({ status: 'lida_pela_familia' }).eq('whatsapp_msg_id', status.id).execute();
        }
      }
    }
  }

  return new Response('OK', { status: 200 });
}

async function renovarJanela(db: any, familiaId: string) {
  const agora = new Date();
  const expira = new Date(agora.getTime() + 24 * 60 * 60 * 1000);

  await db.from('wa_janelas').upsert({
    familia_id: familiaId,
    aberta_em: agora.toISOString(),
    expira_em: expira.toISOString(),
    renovada_em: agora.toISOString(),
    status: 'ativa',
    atualizado_em: agora.toISOString(),
  }, { onConflict: 'familia_id' }).execute();
}
