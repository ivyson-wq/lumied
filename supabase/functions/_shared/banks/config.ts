// Resolução de BancoConfig pra escola+banco a partir do DB.
import type { BancoConfig, BancoProvider } from './types.ts'
import { BankError } from './errors.ts'

interface SbClient {
  from(table: string): any
}

/**
 * Carrega config do banco padrão da escola (ou banco específico se passado).
 * Usado por edge functions ao iniciar uma operação bancária.
 */
export async function getBancoConfig(
  sb: SbClient,
  escolaId: string,
  banco?: BancoProvider
): Promise<BancoConfig> {
  let q = sb.from('escola_banco_config')
    .select('*')
    .eq('escola_id', escolaId)
    .eq('ativo', true)

  if (banco) {
    q = q.eq('banco', banco)
  } else {
    q = q.eq('padrao', true)
  }

  const { data, error } = await q.maybeSingle()

  if (error) {
    throw new BankError({
      code: 'CONFIG_INCOMPLETE',
      banco: banco ?? 'desconhecido',
      message: `Erro ao carregar config bancária: ${error.message}`,
    })
  }

  if (!data) {
    throw new BankError({
      code: 'CONFIG_INCOMPLETE',
      banco: banco ?? 'padrao',
      message: banco
        ? `Escola não tem config bancária ativa para ${banco}.`
        : 'Escola não tem banco padrão configurado.',
    })
  }

  return data as BancoConfig
}

/**
 * Carrega config por CNPJ do beneficiário (usado pelo bank-webhook
 * pra resolver escola_id a partir do payload do banco).
 */
export async function getBancoConfigByCnpj(
  sb: SbClient,
  banco: BancoProvider,
  cnpjLimpo: string
): Promise<BancoConfig | null> {
  const { data } = await sb.from('escola_banco_config')
    .select('*')
    .eq('banco', banco)
    .eq('beneficiario_cnpj', cnpjLimpo)
    .eq('ativo', true)
    .maybeSingle()
  return (data as BancoConfig) ?? null
}

/**
 * Resolve config pro bank-webhook a partir do CNPJ do payload (preferido)
 * com fallback single-tenant: só aceita config "qualquer ativa" quando
 * existir EXATAMENTE 1 configuração ativa pro banco no sistema.
 *
 * Em multi-tenant (>1 escola configurada com mesmo banco), retorna
 * { config: null, reason: 'multi_tenant_no_cnpj' } — anti-padrão do
 * incidente 16/04 onde "pega primeira ativa" vazava dados entre escolas.
 */
export type ResolveResult =
  | { config: BancoConfig; via: 'cnpj' | 'single_tenant_fallback' }
  | { config: null; reason: 'no_config' | 'multi_tenant_no_cnpj' }

export async function resolveBancoConfigForWebhook(
  sb: SbClient,
  banco: BancoProvider,
  cnpjLimpo: string | null,
): Promise<ResolveResult> {
  if (cnpjLimpo) {
    const byCnpj = await getBancoConfigByCnpj(sb, banco, cnpjLimpo)
    if (byCnpj) return { config: byCnpj, via: 'cnpj' }
  }
  const { data: ativas, count } = await sb.from('escola_banco_config')
    .select('*', { count: 'exact' })
    .eq('banco', banco)
    .eq('ativo', true)
  if (count === 1 && ativas && ativas.length === 1) {
    return { config: ativas[0] as BancoConfig, via: 'single_tenant_fallback' }
  }
  if (count && count > 1) {
    return { config: null, reason: 'multi_tenant_no_cnpj' }
  }
  return { config: null, reason: 'no_config' }
}

/** Atualiza ultima_emissao + limpa erro após sucesso. */
export async function marcarSucesso(sb: SbClient, configId: string): Promise<void> {
  await sb.from('escola_banco_config')
    .update({ ultima_emissao: new Date().toISOString(), ultimo_erro: null, ultimo_erro_em: null })
    .eq('id', configId)
}

/** Registra erro pro painel de bancos exibir. */
export async function marcarErro(sb: SbClient, configId: string, msg: string): Promise<void> {
  await sb.from('escola_banco_config')
    .update({ ultimo_erro: msg.slice(0, 500), ultimo_erro_em: new Date().toISOString() })
    .eq('id', configId)
}
