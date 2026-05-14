// Adapter Banco Inter — API Cobrança v3.
// Doc: https://developers.inter.co/references/cobranca-bolepix
//
// Migrado de boletos-sync, boletos-list, inter-webhook (sprint 0).
// Backward-compat: lê INTER_CLIENT_ID/SECRET/CONTA do env se config
// não tiver client_id setado (transição até staff popular UI Bancos).

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

const SCOPES = [
  'boleto-cobranca.read boleto-cobranca.write',
  'boleto-cobranca.read',
  'cobranca.boleto.read cobranca.boleto.pdf',
  'cobranca.read',
]

async function getToken(config: BancoConfig): Promise<string> {
  const clientId = config.client_id || Deno.env.get('INTER_CLIENT_ID') || ''
  const clientSecret = config.client_secret_name
    ? Deno.env.get(config.client_secret_name) || ''
    : Deno.env.get('INTER_CLIENT_SECRET') || ''

  if (!clientId || !clientSecret) {
    throw new BankError({
      code: 'CONFIG_INCOMPLETE',
      banco: 'inter',
      message: 'client_id ou client_secret do Inter ausente (env e config).',
    })
  }

  for (const scope of SCOPES) {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope,
      grant_type: 'client_credentials',
    })
    const res = await bankRelay({
      banco: 'inter',
      path: '/oauth/v2/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (res.ok) return res.json<{ access_token: string }>().access_token
  }

  throw new BankError({
    code: 'AUTH_FAILED',
    banco: 'inter',
    message: 'Nenhum scope OAuth aceito pelo Inter.',
  })
}

function getConta(config: BancoConfig): string {
  return config.conta || Deno.env.get('INTER_CONTA') || ''
}

function authHeaders(token: string, config: BancoConfig): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${token}` }
  const conta = getConta(config)
  if (conta) h['x-conta-corrente'] = conta
  return h
}

export const interAdapter: BankAdapter = {
  banco: 'inter',

  async emitirBoleto(input: BoletoInput, config: BancoConfig): Promise<BoletoOutput> {
    const token = await getToken(config)
    const seuNumero = input.seu_numero || `LUM${Date.now()}`
    const cpfCnpj = input.pagador.cpf_cnpj.replace(/\D/g, '')
    const tipoPessoa = cpfCnpj.length === 14 ? 'JURIDICA' : 'FISICA'

    const payload: Record<string, unknown> = {
      seuNumero,
      valorNominal: input.valor,
      dataVencimento: input.vencimento,
      numDiasAgenda: 60,
      pagador: {
        cpfCnpj,
        tipoPessoa,
        nome: input.pagador.nome,
        email: input.pagador.email,
        telefone: input.pagador.telefone,
        ...(input.pagador.endereco && {
          endereco: input.pagador.endereco.logradouro,
          numero: input.pagador.endereco.numero,
          complemento: input.pagador.endereco.complemento,
          bairro: input.pagador.endereco.bairro,
          cep: input.pagador.endereco.cep.replace(/\D/g, ''),
          cidade: input.pagador.endereco.cidade,
          uf: input.pagador.endereco.uf,
        }),
      },
      mensagem: input.mensagem ? { linha1: input.mensagem[0], linha2: input.mensagem[1], linha3: input.mensagem[2], linha4: input.mensagem[3], linha5: input.mensagem[4] } : undefined,
    }

    if (input.multa_percentual) {
      payload.multa = { codigo: 'PERCENTUAL', taxa: input.multa_percentual }
    }
    if (input.juros_percentual_mes) {
      payload.mora = { codigo: 'TAXAMENSAL', taxa: input.juros_percentual_mes }
    }
    if (input.desconto) {
      payload.desconto = {
        codigo: input.desconto.tipo === 'percentual' ? 'PERCENTUALDATAINFORMADA' : 'VALORFIXODATAINFORMADA',
        taxa: input.desconto.tipo === 'percentual' ? input.desconto.valor : 0,
        valor: input.desconto.tipo === 'fixo' ? input.desconto.valor : 0,
        data: input.desconto.data_limite,
      }
    }

    const res = await bankRelay({
      banco: 'inter',
      path: '/cobranca/v3/cobrancas',
      method: 'POST',
      headers: { ...authHeaders(token, config), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      throw new BankError({
        code: 'BANK_REJECTED',
        banco: 'inter',
        message: `Inter rejeitou emissão: ${res.status}`,
        status: res.status,
        details: res.body.slice(0, 500),
      })
    }

    const out = res.json<{ codigoSolicitacao: string }>()
    // Inter v3 retorna só codigoSolicitacao na criação. Detalhes via consulta.
    const detalhe = await this.consultarBoleto(out.codigoSolicitacao, config)
    const pdfBytes = await this.downloadBoletoPdf!(out.codigoSolicitacao, config).catch(() => null)

    return {
      nosso_numero: detalhe.nosso_numero,
      codigo_solicitacao: out.codigoSolicitacao,
      linha_digitavel: '',                     // populado por consultarBoleto se necessário
      codigo_barras: '',
      pdf_base64: pdfBytes ? bytesToBase64(pdfBytes) : undefined,
      vencimento: detalhe.data_vencimento,
      valor: detalhe.valor,
    }
  },

  async consultarBoleto(nossoNumero: string, config: BancoConfig): Promise<BoletoStatus> {
    const token = await getToken(config)
    const res = await bankRelay({
      banco: 'inter',
      path: `/cobranca/v3/cobrancas/${nossoNumero}`,
      headers: authHeaders(token, config),
    })
    if (!res.ok) {
      throw new BankError({
        code: res.status === 404 ? 'BOLETO_NOT_FOUND' : 'BANK_REJECTED',
        banco: 'inter',
        message: `Inter consulta falhou: ${res.status}`,
        status: res.status,
        details: res.body.slice(0, 300),
      })
    }
    const data = res.json<any>()
    const cob = data.cobranca ?? data
    return {
      nosso_numero: cob.nossoNumero,
      situacao: (cob.situacao || 'EMITIDO') as BoletoStatus['situacao'],
      valor: cob.valorNominal ?? cob.valor ?? 0,
      valor_pago: cob.valorTotalRecebido,
      data_pagamento: cob.dataPagamento,
      data_vencimento: cob.dataVencimento,
    }
  },

  async cancelarBoleto(nossoNumero: string, motivo: string, config: BancoConfig): Promise<void> {
    const token = await getToken(config)
    const res = await bankRelay({
      banco: 'inter',
      path: `/cobranca/v3/cobrancas/${nossoNumero}/cancelar`,
      method: 'POST',
      headers: { ...authHeaders(token, config), 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivoCancelamento: motivo }),
    })
    if (!res.ok) {
      throw new BankError({
        code: 'BANK_REJECTED',
        banco: 'inter',
        message: `Cancelamento falhou: ${res.status}`,
        status: res.status,
        details: res.body.slice(0, 300),
      })
    }
  },

  async listarBoletos(cpfCnpj: string, dataInicial: string, dataFinal: string, config: BancoConfig): Promise<BoletoStatus[]> {
    const token = await getToken(config)
    const cpf = cpfCnpj.replace(/\D/g, '')
    const queries = [
      `cpfCnpjPagador=${cpf}&dataInicial=${dataInicial}&dataFinal=${dataFinal}&filtrarPor=VENCIMENTO&itensPorPagina=50&paginaAtual=0`,
      `cpfCnpj=${cpf}&dataInicial=${dataInicial}&dataFinal=${dataFinal}&itensPorPagina=100`,
    ]

    let lista: any[] = []
    for (const q of queries) {
      const res = await bankRelay({
        banco: 'inter',
        path: `/cobranca/v3/cobrancas?${q}`,
        headers: authHeaders(token, config),
      })
      if (res.ok) {
        const data = res.json<{ content?: any[]; cobrancas?: any[] }>()
        lista = data.content ?? data.cobrancas ?? []
        break
      }
      if (res.status === 404) return []
    }

    return lista.map((raw: any) => {
      const cob = raw.cobranca ?? raw
      return {
        nosso_numero: cob.nossoNumero ?? cob.seuNumero ?? '',
        situacao: (cob.situacao || 'EMITIDO') as BoletoStatus['situacao'],
        valor: cob.valorNominal ?? cob.valor ?? 0,
        valor_pago: cob.valorTotalRecebido,
        data_pagamento: cob.dataPagamento,
        data_vencimento: cob.dataVencimento,
      }
    })
  },

  async downloadBoletoPdf(nossoNumero: string, config: BancoConfig): Promise<Uint8Array> {
    const token = await getToken(config)
    const res = await bankRelay({
      banco: 'inter',
      path: `/cobranca/v3/cobrancas/${nossoNumero}/pdf`,
      headers: authHeaders(token, config),
    })
    if (!res.ok) {
      throw new BankError({
        code: 'BANK_REJECTED',
        banco: 'inter',
        message: `Download PDF falhou: ${res.status}`,
        status: res.status,
      })
    }
    const data = res.json<{ pdf: string }>()
    const binary = atob(data.pdf)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  },

  async parseWebhook(_headers: Headers, body: string, config: BancoConfig): Promise<WebhookEvent> {
    // Inter não envia HMAC — auth é por allowlist de IP + RELAY_SECRET no header
    // (já validado em bank-webhook antes de chamar parseWebhook).
    const payload = JSON.parse(body)
    const situacao: string = (payload.situacao ?? payload.evento ?? '').toUpperCase()
    const tipoMap: Record<string, WebhookEvent['tipo']> = {
      PAGO: 'boleto.pago',
      VENCIDO: 'boleto.vencido',
      CANCELADO: 'boleto.cancelado',
      EXPIRADO: 'boleto.vencido',
      EMITIDO: 'boleto.emitido',
    }
    return {
      banco: 'inter',
      escola_id: config.escola_id,
      tipo: tipoMap[situacao] ?? 'desconhecido',
      nosso_numero: payload.nossoNumero ?? '',
      valor: payload.valorNominal ?? payload.valor,
      valor_pago: payload.valorTotalRecebido,
      data_pagamento: payload.dataPagamento,
      raw: payload,
    }
  },
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}
