// Adapter Banco do Brasil — API Cobranças (CobV2).
// Doc: https://developers.bb.com.br/apis/cobrancas/v2
//
// Particularidades:
//  • OAuth client_credentials no host oauth.bb.com.br (relay roteia).
//  • Scope: "cobrancas.boletos-info cobrancas.boletos-requisicao".
//  • Toda chamada exige `gw-dev-app-key=<developer_application_key>`
//    (BB chama de "developer_application_key" — guardamos em config.convenio
//    como prefixo? Não: usamos client_secret_name vinculado +
//    convenio=numeroConvenio). gw-app-key vem de Deno.env BB_DEV_APP_KEY.
//  • numeroConvenio (config.convenio) é obrigatório em emissão.
//  • Carteira "17" é padrão de cobrança com registro.
//  • Webhook BB envia via API Webhooks Cobranças (separada); por enquanto
//    rotamos pelo polling (listarBoletos) + endpoint /cobrancas/v2/boletos
//    com filtroSituacao=BAIXADO_LIQUIDACAO no daily sync.

import { bankRelay } from '../relay.ts'
import { BankError } from '../errors.ts'
import type {
  BankAdapter,
  BancoConfig,
  BoletoInput,
  BoletoOutput,
  BoletoStatus,
  WebhookEvent,
} from '../types.ts'

function gwAppKey(config: BancoConfig): string {
  // BB exige developer_application_key em todo request. Lemos do secret
  // BB_DEV_APP_KEY_<short> ou do client_id (formato "<gwkey>:<oauthkey>" — convenção interna).
  const key = config.client_secret_name
    ? Deno.env.get(`BB_DEV_APP_KEY_${config.client_secret_name.split('_').pop()}`) || ''
    : ''
  return key || Deno.env.get('BB_DEV_APP_KEY_DEFAULT') || ''
}

async function getToken(config: BancoConfig): Promise<string> {
  const clientId = config.client_id || ''
  const clientSecret = config.client_secret_name
    ? Deno.env.get(config.client_secret_name) || ''
    : ''

  if (!clientId || !clientSecret) {
    throw new BankError({
      code: 'CONFIG_INCOMPLETE',
      banco: 'bb',
      message: 'client_id ou client_secret do BB ausente em escola_banco_config.',
    })
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'cobrancas.boletos-info cobrancas.boletos-requisicao',
  })

  const res = await bankRelay({
    banco: 'bb',
    path: '/oauth/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body,
  })

  if (!res.ok) {
    throw new BankError({
      code: 'AUTH_FAILED',
      banco: 'bb',
      message: `BB OAuth recusou: ${res.status}`,
      status: res.status,
      details: res.body.slice(0, 300),
    })
  }
  return res.json<{ access_token: string }>().access_token
}

function authQuery(config: BancoConfig): string {
  return `gw-dev-app-key=${encodeURIComponent(gwAppKey(config))}`
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

function getConvenio(config: BancoConfig): number {
  const n = Number((config.convenio ?? '').replace(/\D/g, ''))
  if (!n) {
    throw new BankError({
      code: 'CONFIG_INCOMPLETE',
      banco: 'bb',
      message: 'numeroConvenio (config.convenio) obrigatório para BB.',
    })
  }
  return n
}

function mapEstado(estado: string | undefined | number): BoletoStatus['situacao'] {
  // BB usa códigos numéricos OU strings:
  //   1 EMITIDO, 6 LIQUIDADO/BAIXADO_LIQUIDACAO, 7 BAIXADO, 9 VENCIDO/PROTESTO
  const s = String(estado ?? '').toUpperCase()
  if (s === '6' || s.includes('LIQUID') || s.includes('PAGO') || s === 'BAIXADO_LIQUIDACAO') return 'PAGO'
  if (s === '7' || s === 'BAIXADO' || s === 'CANCELADO') return 'CANCELADO'
  if (s === '9' || s === 'VENCIDO' || s === 'PROTESTADO') return 'VENCIDO'
  return 'EMITIDO'
}

export const bbAdapter: BankAdapter = {
  banco: 'bb',

  async emitirBoleto(input: BoletoInput, config: BancoConfig): Promise<BoletoOutput> {
    const token = await getToken(config)
    const numeroConvenio = getConvenio(config)
    const cpfCnpj = input.pagador.cpf_cnpj.replace(/\D/g, '')
    const tipoInscricao = cpfCnpj.length === 14 ? 2 : 1
    // Nosso número BB: 17 dígitos = convênio (7) + número sequencial (10)
    const sequencial = (input.seu_numero || String(Date.now())).replace(/\D/g, '').slice(-10).padStart(10, '0')
    const numeroTituloCliente = `000${String(numeroConvenio).padStart(7, '0')}${sequencial}`

    const payload: Record<string, unknown> = {
      numeroConvenio,
      numeroCarteira: Number(config.carteira ?? 17),
      numeroVariacaoCarteira: 35,
      codigoModalidade: 1,
      dataEmissao: new Date().toISOString().slice(0, 10).split('-').reverse().join('.'),
      dataVencimento: input.vencimento.split('-').reverse().join('.'),
      valorOriginal: input.valor,
      numeroTituloCliente,
      pagador: {
        tipoInscricao,
        numeroInscricao: Number(cpfCnpj),
        nome: input.pagador.nome.slice(0, 30),
        ...(input.pagador.endereco && {
          endereco: input.pagador.endereco.logradouro.slice(0, 30),
          cep: Number(input.pagador.endereco.cep.replace(/\D/g, '')),
          cidade: input.pagador.endereco.cidade.slice(0, 20),
          bairro: input.pagador.endereco.bairro.slice(0, 20),
          uf: input.pagador.endereco.uf,
        }),
      },
      indicadorAceiteTituloVencido: 'S',
      numeroDiasLimiteRecebimento: 60,
    }

    if (input.multa_percentual) {
      payload.multa = {
        tipo: 2, // 2 = percentual
        data: input.vencimento.split('-').reverse().join('.'),
        porcentagem: input.multa_percentual,
      }
    }
    if (input.juros_percentual_mes) {
      payload.juros = {
        tipo: 2, // 2 = taxa mensal
        porcentagem: input.juros_percentual_mes,
      }
    }
    if (input.desconto) {
      payload.desconto = {
        tipo: input.desconto.tipo === 'percentual' ? 2 : 1,
        dataExpiracao: input.desconto.data_limite.split('-').reverse().join('.'),
        ...(input.desconto.tipo === 'percentual'
          ? { porcentagem: input.desconto.valor }
          : { valor: input.desconto.valor }),
      }
    }

    const res = await bankRelay({
      banco: 'bb',
      path: `/cobrancas/v2/boletos?${authQuery(config)}`,
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      throw new BankError({
        code: 'BANK_REJECTED',
        banco: 'bb',
        message: `BB rejeitou emissão: ${res.status}`,
        status: res.status,
        details: res.body.slice(0, 500),
      })
    }

    const out = res.json<{
      numero: string
      numeroCarteira?: number
      numeroVariacaoCarteira?: number
      codigoBarraNumerico?: string
      linhaDigitavel?: string
      qrCode?: { url?: string; txId?: string; emv?: string }
    }>()

    return {
      nosso_numero: out.numero ?? numeroTituloCliente,
      codigo_solicitacao: out.numero ?? numeroTituloCliente,
      linha_digitavel: out.linhaDigitavel ?? '',
      codigo_barras: out.codigoBarraNumerico ?? '',
      pix_copia_cola: out.qrCode?.emv,
      url_visualizacao: out.qrCode?.url,
      vencimento: input.vencimento,
      valor: input.valor,
    }
  },

  async consultarBoleto(nossoNumero: string, config: BancoConfig): Promise<BoletoStatus> {
    const token = await getToken(config)
    const numeroConvenio = getConvenio(config)
    const res = await bankRelay({
      banco: 'bb',
      path: `/cobrancas/v2/boletos/${nossoNumero}?numeroConvenio=${numeroConvenio}&${authQuery(config)}`,
      headers: authHeaders(token),
    })
    if (!res.ok) {
      throw new BankError({
        code: res.status === 404 ? 'BOLETO_NOT_FOUND' : 'BANK_REJECTED',
        banco: 'bb',
        message: `BB consulta falhou: ${res.status}`,
        status: res.status,
        details: res.body.slice(0, 300),
      })
    }
    const cob = res.json<any>()
    return {
      nosso_numero: cob.numero ?? nossoNumero,
      situacao: mapEstado(cob.codigoEstadoTituloCobranca ?? cob.estado),
      valor: cob.valorOriginal ?? cob.valorAtual ?? 0,
      valor_pago: cob.valorPagoSacado,
      data_pagamento: parseDate(cob.dataCreditoLiquidacao),
      data_vencimento: parseDate(cob.dataVencimento) ?? '',
    }
  },

  async cancelarBoleto(nossoNumero: string, motivo: string, config: BancoConfig): Promise<void> {
    const token = await getToken(config)
    const numeroConvenio = getConvenio(config)
    const res = await bankRelay({
      banco: 'bb',
      path: `/cobrancas/v2/boletos/${nossoNumero}/baixar?${authQuery(config)}`,
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ numeroConvenio, motivo: motivo.slice(0, 100) }),
    })
    if (!res.ok) {
      throw new BankError({
        code: 'BANK_REJECTED',
        banco: 'bb',
        message: `BB cancelamento falhou: ${res.status}`,
        status: res.status,
        details: res.body.slice(0, 300),
      })
    }
  },

  async listarBoletos(
    cpfCnpj: string,
    dataInicial: string,
    dataFinal: string,
    config: BancoConfig,
  ): Promise<BoletoStatus[]> {
    const token = await getToken(config)
    const numeroConvenio = getConvenio(config)
    const cpf = cpfCnpj.replace(/\D/g, '')
    const di = dataInicial.split('-').reverse().join('.')
    const df = dataFinal.split('-').reverse().join('.')
    const q = `numeroConvenio=${numeroConvenio}&cpfCnpjBeneficiario=${cpf}&dataInicioVencimento=${di}&dataFimVencimento=${df}&${authQuery(config)}`

    const res = await bankRelay({
      banco: 'bb',
      path: `/cobrancas/v2/boletos?${q}`,
      headers: authHeaders(token),
    })
    if (!res.ok) {
      if (res.status === 404) return []
      throw new BankError({
        code: 'BANK_REJECTED',
        banco: 'bb',
        message: `BB listagem falhou: ${res.status}`,
        status: res.status,
      })
    }
    const data = res.json<{ boletos?: any[] }>()
    return (data.boletos ?? []).map((cob: any) => ({
      nosso_numero: cob.numeroBoletoBB ?? cob.numero ?? '',
      situacao: mapEstado(cob.codigoEstadoTituloCobranca ?? cob.estado),
      valor: cob.valorOriginal ?? 0,
      valor_pago: cob.valorPagoSacado,
      data_pagamento: parseDate(cob.dataCreditoLiquidacao),
      data_vencimento: parseDate(cob.dataVencimento) ?? '',
    }))
  },

  async parseWebhook(_headers: Headers, body: string, config: BancoConfig): Promise<WebhookEvent> {
    // BB Webhook (CobV2 Webhooks API) envia POST JSON com lista de eventos.
    // Não há HMAC padrão; auth é por IP allowlist + relay_secret no header
    // (validado em bank-webhook antes de chamar parseWebhook).
    const payload = JSON.parse(body)
    const evt = Array.isArray(payload.eventos) ? payload.eventos[0] : payload
    const estado = evt.codigoEstadoTituloCobranca ?? evt.estado ?? evt.situacao
    const sit = mapEstado(estado)
    const tipoMap: Record<BoletoStatus['situacao'], WebhookEvent['tipo']> = {
      PAGO: 'boleto.pago',
      CANCELADO: 'boleto.cancelado',
      VENCIDO: 'boleto.vencido',
      EMITIDO: 'boleto.emitido',
      EXPIRADO: 'boleto.vencido',
    }
    return {
      banco: 'bb',
      escola_id: config.escola_id,
      tipo: tipoMap[sit] ?? 'desconhecido',
      nosso_numero: evt.numeroBoletoBB ?? evt.numero,
      valor: evt.valorOriginal,
      valor_pago: evt.valorPagoSacado,
      data_pagamento: parseDate(evt.dataCreditoLiquidacao),
      raw: payload,
    }
  },
}

// BB devolve datas como "dd.MM.yyyy" em vários endpoints. Convertemos pra ISO.
function parseDate(s: string | undefined): string | undefined {
  if (!s) return undefined
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  // Já vem ISO em alguns endpoints
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return s
}
