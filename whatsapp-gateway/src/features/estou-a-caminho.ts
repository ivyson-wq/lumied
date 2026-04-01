import type { Env, Familia } from '../types';
import { enviarTextoLivre } from '../services/whatsapp';

export async function ativarEstouACaminho(env: Env, phoneId: string, familia: Familia): Promise<void> {
  // Delega para endpoint interno do app — mesma chamada do botão no portal
  try {
    const res = await fetch(`${env.APP_BASE_URL}/functions/v1/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` },
      body: JSON.stringify({ action: 'pickup_estou_a_caminho', familia_id: familia.familia_id_saas || familia.id, ativado_por: 'whatsapp' }),
    });
    if (res.ok) {
      await enviarTextoLivre(env, phoneId, familia.whatsapp, '🚗 Pronto! A escola foi notificada que você está a caminho. Boa viagem! 🍁');
    } else {
      await enviarTextoLivre(env, phoneId, familia.whatsapp, '⚠️ Não consegui ativar a notificação. Tente novamente ou use o app.');
    }
  } catch (e) {
    console.error('[ESTOU-A-CAMINHO] Erro:', e);
  }
}
