import type { Env } from '../types';
import { enviarTextoLivre } from '../services/whatsapp';

export async function gerarEEnviarRelatorio(db: any, env: Env, phoneId: string, familia: any): Promise<void> {
  const hoje = new Date();
  const semanaInicio = new Date(hoje);
  semanaInicio.setDate(hoje.getDate() - hoje.getDay() - 6); // segunda passada
  const semanaFim = new Date(semanaInicio);
  semanaFim.setDate(semanaInicio.getDate() + 4); // sexta

  const inicioStr = semanaInicio.toISOString().split('T')[0];
  const fimStr = semanaFim.toISOString().split('T')[0];

  // Coletar dados da semana
  const [presencas, mensagens, eventos] = await Promise.all([
    db.from('frequencia').select('data,presente')
      .eq('aluno_id', familia.familia_id_saas)
      .gte('data', inicioStr).lte('data', fimStr).execute(),
    db.from('wa_mensagens').select('conteudo,criado_em')
      .eq('turma_id', familia.turma_id).eq('status', 'enviada')
      .gte('criado_em', inicioStr).lte('criado_em', fimStr + 'T23:59:59')
      .order('criado_em', { ascending: false }).limit(5).execute(),
    db.from('wa_eventos').select('titulo,data_evento')
      .eq('turma_id', familia.turma_id)
      .gte('data_evento', hoje.toISOString()).limit(3).execute(),
  ]);

  // Gerar texto com Anthropic API
  const prompt = `Você é o assistente de comunicação da Maple Bear, uma escola bilíngue canadense.
Gere um relatório semanal amigável e conciso (máximo 5 linhas) para os responsáveis do aluno ${familia.aluno_nome}.

Dados da semana:
- Presenças: ${JSON.stringify(presencas.data ?? [])}
- Comunicados da turma: ${JSON.stringify((mensagens.data ?? []).map((m: any) => m.conteudo?.substring(0, 100)))}
- Próximos eventos: ${JSON.stringify((eventos.data ?? []).map((e: any) => `${e.titulo} em ${e.data_evento}`))}

O tom deve ser caloroso, positivo e informativo. Escreva em português brasileiro.
Não use markdown. Comece com uma saudação incluindo o nome do aluno.`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 300, temperature: 0.7 },
      }),
    });

    if (!res.ok) { console.error('[RELATORIO] Gemini error:', res.status); return; }

    const data = await res.json() as any;
    const texto = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!texto) return;

    const cabecalho = `🍁 *Maple Bear • Resumo da Semana*\n\n`;
    const msgRes = await enviarTextoLivre(env, phoneId, familia.whatsapp, cabecalho + texto);

    // Registrar
    await db.from('wa_relatorios_semanais').insert({
      familia_id: familia.id,
      aluno_nome: familia.aluno_nome,
      semana_inicio: inicioStr,
      conteudo_gerado: texto,
      enviado_em: new Date().toISOString(),
      whatsapp_msg_id: msgRes?.messages?.[0]?.id,
      escola_id: familia.escola_id,
    }).select();
  } catch (e) {
    console.error('[RELATORIO] Erro:', e);
  }
}
