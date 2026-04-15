import type { Env } from '../types';
import { enviarTextoLivre } from '../services/whatsapp';

const REFEICAO_NOMES: Record<string, string> = {
  cafe: '☕ Café',
  lanche_manha: '🍎 Lanche da manhã',
  almoco: '🍽️ Almoço',
  lanche_tarde: '🍪 Lanche da tarde',
  jantar: '🌙 Jantar',
};

function formatData(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
}

export async function enviarCardapioSemanal(db: any, env: Env, phoneId: string, familia: any): Promise<void> {
  const hoje = new Date();
  const seg = new Date(hoje);
  seg.setDate(hoje.getDate() - hoje.getDay() + 1); // próxima segunda
  const sex = new Date(seg);
  sex.setDate(seg.getDate() + 4);

  const { data: items } = await db
    .from('cozinha_cardapios')
    .select('data, refeicao, descricao_livre, cozinha_receitas(nome)')
    .eq('escola_id', familia.escola_id)
    .eq('publicado', true)
    .gte('data', seg.toISOString().split('T')[0])
    .lte('data', sex.toISOString().split('T')[0])
    .order('data').order('refeicao').execute();

  if (!items || items.length === 0) return;

  const byDate: Record<string, any[]> = {};
  for (const it of items) {
    (byDate[it.data] = byDate[it.data] || []).push(it);
  }

  const linhas: string[] = [`🍳 *Cardápio da Semana* — ${familia.aluno_nome || 'sua família'}`, ''];
  for (const dt of Object.keys(byDate).sort()) {
    linhas.push(`*${formatData(dt)}*`);
    for (const i of byDate[dt]) {
      const nome = i.cozinha_receitas?.nome || i.descricao_livre || '—';
      linhas.push(`  • ${REFEICAO_NOMES[i.refeicao] || i.refeicao}: ${nome}`);
    }
    linhas.push('');
  }
  linhas.push('Bom apetite! 🧑‍🍳');

  await enviarTextoLivre(env, phoneId, familia.whatsapp, linhas.join('\n'));
}
