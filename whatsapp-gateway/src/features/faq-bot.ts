import type { Env, Familia } from '../types';
import { enviarTextoLivre } from '../services/whatsapp';

export async function processarFaq(
  db: any, env: Env, phoneId: string, familia: Familia, msg: any
): Promise<boolean> {
  const pergunta = msg.text?.body;
  if (!pergunta || pergunta.length < 5) return false;

  // Buscar FAQs da escola
  const { data: faqs } = await db
    .from('wa_faqs').select('pergunta,resposta,categoria')
    .eq('escola_id', familia.escola_id).eq('ativa', true).execute();

  if (!faqs?.length) return false;

  const faqsTexto = faqs.map((f: any) => `P: ${f.pergunta}\nR: ${f.resposta}`).join('\n\n');

  // Consultar Anthropic API
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `Você é o assistente da Maple Bear. Responda a pergunta abaixo APENAS se encontrar uma resposta clara nas FAQs fornecidas. Se não souber com certeza, responda APENAS com a palavra: ROTEAR

FAQs:
${faqsTexto}

Pergunta do responsável: ${pergunta}

Responda de forma amigável e direta. Máximo 3 linhas.`,
        }],
      }),
    });

    if (!res.ok) return false;

    const data = await res.json() as any;
    const resposta = data.content?.[0]?.text?.trim();

    if (!resposta || resposta === 'ROTEAR') return false;

    // Responder automaticamente
    await enviarTextoLivre(env, phoneId, familia.whatsapp, `🍁 *Maple Bear*\n\n${resposta}`);

    // Registrar como respondida pelo bot
    await db.from('wa_respostas').insert({
      familia_id: familia.id,
      tipo: 'duvida_respondida_bot',
      conteudo: pergunta,
      whatsapp_msg_id: msg.id,
    }).select();

    return true;
  } catch (e) {
    console.error('[FAQ-BOT] Erro Anthropic:', e);
    return false;
  }
}
