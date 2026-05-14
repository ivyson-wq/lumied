// Adapter Sicredi — API Cobrança Bancária 2.0.
// Doc: https://developer.sicredi.io/portal/api/cobranca-bancaria-v2
//
// Particularidades:
//  • mTLS obrigatório (cert PFX no bucket bank-certs, senha via secret).
//  • OAuth2 client_credentials, scope "cobranca".
//  • Carteira (config.carteira) é "1" pra escolas (cobrança com registro).
//  • "Nosso número" da Sicredi: prefixo Y + 8 dígitos sequenciais + DV.
//    Quando emitimos sem informar, o banco devolve em `nossoNumero`.
//  • Webhook ("aviso de baixa"): HMAC-SHA256 do body com webhook_secret,
//    enviado no header `x-sicredi-assinatura`.
//  • Pagador: TipoPessoa "PF"/"PJ" (não FISICA/JURIDICA como Inter).

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

async function getToken(config: BancoConfig): Promise<string> {
  const clientId = config.client_id || ''
  const clientSecret = config.client_secret_name
    ? Deno.env.get(config.client_secret_name) || ''
    : ''

  if (!clientId || !clientSecret) {
    throw new BankError({
      code: 'CONFIG_INCOMPLETE',
      banco: 'sicredi',
      message: 'client_id ou secret do Sicredi ausente em escola_banco_config.',
    })
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'cobranca',
  })

  const res = await bankRelay({
    banco: 'sicredi',
    path: '/auth/openapi/token',
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
      banco: 'sicredi',
      message: `Sicredi OAuth recusou: ${res.status}`,
      status: res.status,
      details: res.body.slice(0, 300),
    })
  }

  return res.json<{ access_token: string }>().access_token
}

function authHeaders(token: string, config: BancoConfig): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'x-api-key': config.client_id ?? '',
  }
  return h
}

function mapSituacao(s: string | undefined): BoletoStatus['situacao'] {
  const v = (s ?? '').toUpperCase()
  if (v === 'PAGO' || v === 'LIQUIDADO' || v === 'BAIXADO_LIQUIDACAO') return 'PAGO'
  if (v === 'CANCELADO' || v === 'BAIXADO' || v === 'BAIXADO_SOLICITACAO') return 'CANCELADO'
  if (v === 'VENCIDO' || v === 'EXPIRADO') return 'VENCIDO'
  return 'EMITIDO'
}

export const sicrediAdapter: BankAdapter = {
  banco: 'sicredi',

  async emitirBoleto(input: BoletoInput, config: BancoConfig): Promise<BoletoOutput> {
    const token = await getToken(config)
    const cpfCnpj = input.pagador.cpf_cnpj.replace(/\D/g, '')
    const tipoPessoa = cpfCnpj.length === 14 ? 'PJ' : 'PF'
    const seuNumero = (input.seu_numero || `LUM${Date.now()}`).slice(0, 10)

    const payload: Record<string, unknown> = {
      tipoCobranca: 'NORMAL',
      pagador: {
        tipoPessoa,
        documento: cpfCnpj,
        nome: input.pagador.nome.slice(0, 40),
        ...(input.pagador.endereco && {
          endereco: `${input.pagador.endereco.logradouro}${input.pagador.endereco.numero ? `, ${input.pagador.endereco.numero}` : ''}`.slice(0, 40),
          bairro: input.pagador.endereco.bairro.slice(0, 30),
          cep: input.pagador.endereco.cep.replace(/\D/g, ''),
          cidade: input.pagador.endereco.cidade.slice(0, 30),
          uf: input.pagador.endereco.uf,
        }),
        ...(input.pagador.email && { email: input.pagador.email }),
      },
      especieDocumento: 'DUPLICATA_MERCANTIL_INDICACAO',
      seuNumero,
      valor: input.valor,
      dataVencimento: input.vencimento,
      mensagem: (input.mensagem ?? []).slice(0, 5).join('\n'),
    }

    if (input.multa_percentual) {
      payload.multa = { tipo: 'PERCENTUAL', valor: input.multa_percentual }
    }
    if (input.juros_percentual_mes) {
      payload.juros = { tipo: 'PERCENTUAL', valor: input.juros_percentual_mes }
    }
    if (input.desconto) {
      payload.desconto1 = {
        tipo: input.desconto.tipo === 'percentual' ? 'PERCENTUAL' : 'VALOR',
        data: input.desconto.data_limite,
        valor: input.desconto.valor,
      }
    }

    const res = await bankRelay({
      banco: 'sicredi',
      path: `/cobranca/boleto/v1/boletos`,
      method: 'POST',
      headers: {
        ...authHeaders(token, config),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      throw new BankError({
        code: 'BANK_REJECTED',
        banco: 'sicredi',
        message: `Sicredi rejeitou emissão: ${res.status}`,
        status: res.status,
        details: res.body.slice(0, 500),
      })
    }

    const out = res.json<{
      nossoNumero: string
      linhaDigitavel?: string
      codigoBarras?: string
      pdf?: string
      qrCodePix?: string
    }>()

    return {
      nosso_numero: out.nossoNumero,
      codigo_solicitacao: out.nossoNumero,
      linha_digitavel: out.linhaDigitavel ?? '',
      codigo_barras: out.codigoBarras ?? '',
      pdf_base64: out.pdf,
      pix_copia_cola: out.qrCodePix,
      vencimento: input.vencimento,
      valor: input.valor,
    }
  },

  async consultarBoleto(nossoNumero: string, config: BancoConfig): Promise<BoletoStatus> {
    const token = await getToken(config)
    const res = await bankRelay({
      banco: 'sicredi',
      path: `/cobranca/boleto/v1/boletos/${nossoNumero}`,
      headers: authHeaders(token, config),
    })
    if (!res.ok) {
      throw new BankError({
        code: res.status === 404 ? 'BOLETO_NOT_FOUND' : 'BANK_REJECTED',
        banco: 'sicredi',
        message: `Sicredi consulta falhou: ${res.status}`,
        status: res.status,
        details: res.body.slice(0, 300),
      })
    }
    const cob = res.json<{
      nossoNumero: string
      situacao?: string
      valor: number
      valorPago?: number
      dataLiquidacao?: string
      dataVencimento: string
    }>()
    return {
      nosso_numero: cob.nossoNumero,
      situacao: mapSituacao(cob.situacao),
      valor: cob.valor,
      valor_pago: cob.valorPago,
      data_pagamento: cob.dataLiquidacao,
      data_vencimento: cob.dataVencimento,
    }
  },

  async cancelarBoleto(nossoNumero: string, motivo: string, config: BancoConfig): Promise<void> {
    const token = await getToken(config)
    // Sicredi: PATCH com novaSituacao=BAIXADO_SOLICITACAO_BENEFICIARIO
    const res = await bankRelay({
      banco: 'sicredi',
      path: `/cobranca/boleto/v1/boletos/${nossoNumero}/baixa`,
      method: 'PATCH',
      headers: { ...authHeaders(token, config), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novaSituacao: 'BAIXADO',
        motivo: motivo.slice(0, 100),
      }),
    })
    if (!res.ok) {
      throw new BankError({
        code: 'BANK_REJECTED',
        banco: 'sicredi',
        message: `Sicredi cancelamento falhou: ${res.status}`,
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
    const cpf = cpfCnpj.replace(/\D/g, '')
    const q = `cpfCnpjPagador=${cpf}&dataInicio=${dataInicial}&dataFim=${dataFinal}&itensPorPagina=100`
    const res = await bankRelay({
      banco: 'sicredi',
      path: `/cobranca/boleto/v1/boletos?${q}`,
      headers: authHeaders(token, config),
    })
    if (!res.ok) {
      if (res.status === 404) return []
      throw new BankError({
        code: 'BANK_REJECTED',
        banco: 'sicredi',
        message: `Sicredi listagem falhou: ${res.status}`,
        status: res.status,
      })
    }
    const data = res.json<{ boletos?: any[]; content?: any[] }>()
    const arr = data.boletos ?? data.content ?? []
    return arr.map((cob: any) => ({
      nosso_numero: cob.nossoNumero,
      situacao: mapSituacao(cob.situacao),
      valor: cob.valor ?? 0,
      valor_pago: cob.valorPago,
      data_pagamento: cob.dataLiquidacao,
      data_vencimento: cob.dataVencimento,
    }))
  },

  async downloadBoletoPdf(nossoNumero: string, config: BancoConfig): Promise<Uint8Array> {
    const token = await getToken(config)
    const res = await bankRelay({
      banco: 'sicredi',
      path: `/cobranca/boleto/v1/boletos/${nossoNumero}/pdf`,
      headers: authHeaders(token, config),
    })
    if (!res.ok) {
      throw new BankError({
        code: 'BANK_REJECTED',
        banco: 'sicredi',
        message: `Sicredi PDF falhou: ${res.status}`,
        status: res.status,
      })
    }
    const data = res.json<{ pdf: string }>()
    const bin = atob(data.pdf)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  },

  async parseWebhook(headers: Headers, body: string, config: BancoConfig): Promise<WebhookEvent> {
    // HMAC-SHA256 do body com webhook_secret, base64 ou hex em x-sicredi-assinatura.
    const sig = headers.get('x-sicredi-assinatura') ?? headers.get('x-signature') ?? ''
    if (config.webhook_secret) {
      const expected = await hmacHex(body, config.webhook_secret)
      const expectedB64 = await hmacBase64(body, config.webhook_secret)
      if (sig !== expected && sig !== expectedB64) {
        throw new BankError({
          code: 'WEBHOOK_INVALID_SIG',
          banco: 'sicredi',
          message: 'Assinatura HMAC Sicredi inválida.',
        })
      }
    }
    const payload = JSON.parse(body)
    const situacao = (payload.situacao ?? payload.evento ?? '').toUpperCase()
    const tipoMap: Record<string, WebhookEvent['tipo']> = {
      LIQUIDADO: 'boleto.pago',
      PAGO: 'boleto.pago',
      BAIXADO: 'boleto.cancelado',
      BAIXADO_SOLICITACAO: 'boleto.cancelado',
      CANCELADO: 'boleto.cancelado',
      VENCIDO: 'boleto.vencido',
      EXPIRADO: 'boleto.vencido',
      REGISTRADO: 'boleto.emitido',
    }
    return {
      banco: 'sicredi',
      escola_id: config.escola_id,
      tipo: tipoMap[situacao] ?? 'desconhecido',
      nosso_numero: payload.nossoNumero ?? payload.identificadorBoleto,
      valor: payload.valor,
      valor_pago: payload.valorPago ?? payload.valorLiquidado,
      data_pagamento: payload.dataLiquidacao ?? payload.dataPagamento,
      raw: payload,
    }
  },
}

async function hmacHex(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmacBase64(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  let bin = ''
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b)
  return btoa(bin)
}
