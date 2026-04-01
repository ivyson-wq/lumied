import type { Env, Familia } from '../types';
import { enviarTextoLivre } from '../services/whatsapp';

export async function processarConfirmacao(
  db: any, env: Env, phoneId: string, familia: Familia, msg: any
): Promise<void> {
  const buttonId = msg.interactive.button_reply.id;
  // formato: "evento_<evento_id>_confirmado" ou "evento_<evento_id>_recusado"
  const partes = buttonId.split('_');
  const eventoId = partes[1];
  const resposta = partes[2]; // confirmado | recusado

  await db.from('wa_confirmacoes_evento').upsert({
    evento_id: eventoId,
    familia_id: familia.id,
    resposta,
    canal: 'whatsapp',
    respondido_em: new Date().toISOString(),
  }, { onConflict: 'evento_id,familia_id' }).execute();

  const textoResposta = resposta === 'confirmado'
    ? '✅ Presença confirmada! Obrigado.'
    : '👍 Entendido. Até a próxima!';

  await enviarTextoLivre(env, phoneId, familia.whatsapp, textoResposta);

  // Registrar resposta
  await db.from('wa_respostas').insert({
    familia_id: familia.id,
    tipo: 'confirmacao_evento',
    conteudo: `${resposta} - evento ${eventoId}`,
    whatsapp_msg_id: msg.id,
  }).select();
}
