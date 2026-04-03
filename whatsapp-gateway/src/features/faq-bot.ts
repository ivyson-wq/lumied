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

  // Consultar Gemini Flash API
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `Você é o assistente da Maple Bear. Responda a pergunta abaixo APENAS se encontrar uma resposta clara nas FAQs fornecidas. Se não souber com certeza, responda APENAS com a palavra: ROTEAR

FAQs:
${faqsTexto}

Pergunta do responsável: ${pergunta}

Responda de forma amigável e direta. Máximo 3 linhas.` }] }],
        generationConfig: { maxOutputTokens: 200, temperature: 0.3 },
      }),
    });

    if (!res.ok) return false;

    const data = await res.json() as any;
    const resposta = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

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
    console.error('[FAQ-BOT] Erro Gemini:', e);
    return false;
  }
}
