// Roteamento família → professora correta

export async function routeParaProf(db: any, familiaId: string): Promise<string | null> {
  // 1. Janela ativa tem professora registrada
  const { data: janela } = await db
    .from('wa_janelas').select('professora_id')
    .eq('familia_id', familiaId).eq('status', 'ativa').single();
  if (janela?.professora_id) return janela.professora_id;

  // 2. Última mensagem enviada para a família
  const { data: msgs } = await db
    .from('wa_mensagens').select('professora_id')
    .eq('familia_id', familiaId).eq('status', 'enviada')
    .order('enviada_at', { ascending: false }).limit(1).execute();
  if (msgs?.[0]?.professora_id) return msgs[0].professora_id;

  // 3. Professora da turma
  const { data: fam } = await db
    .from('wa_familias').select('turma_id').eq('id', familiaId).single();
  if (fam?.turma_id) {
    const { data: turma } = await db
      .from('wa_turmas').select('professora_id').eq('id', fam.turma_id).single();
    if (turma?.professora_id) return turma.professora_id;
  }

  return null;
}
