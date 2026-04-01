import type { Env } from '../types';
import { getSupabase } from '../services/supabase';
import { gerarEEnviarRelatorio } from '../features/relatorio';

// Cron: sábados 9h UTC — relatório semanal por aluno
export async function handleCron(env: Env): Promise<void> {
  const db = getSupabase(env);

  // Buscar escolas com módulo ativo
  const { data: escolas } = await db
    .from('escolas').select('id,whatsapp_phone_id')
    .eq('modulo_whatsapp', true).execute();

  for (const escola of escolas ?? []) {
    if (!escola.whatsapp_phone_id) continue;

    // Buscar famílias com opt-in
    const { data: familias } = await db
      .from('wa_familias').select('id,nome,aluno_nome,whatsapp,turma_id,escola_id,familia_id_saas')
      .eq('escola_id', escola.id).eq('opt_in', true).execute();

    let enviados = 0;
    for (const familia of familias ?? []) {
      try {
        await gerarEEnviarRelatorio(db, env, escola.whatsapp_phone_id, familia);
        enviados++;
      } catch (e) {
        console.error(`[CRON] Erro relatório ${familia.aluno_nome}:`, e);
      }
    }
    console.log(`[CRON] Escola ${escola.id}: ${enviados} relatórios enviados`);
  }
}
