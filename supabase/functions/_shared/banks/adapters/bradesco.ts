// Adapter Bradesco — API Cobrança (Boletos).
// Doc: https://meiosdepagamentobradesco.com.br/pix-pj/desenvolvedor/
//
// Particularidades:
//  • mTLS obrigatório (cert PFX no bucket bank-certs).
//  • OAuth client_credentials no endpoint /auth/server, scope "cob.write cob.read".
//  • Convenio (config.convenio) + carteira (config.carteira) obrigatórios.
//    Padrão escolas: carteira "09" (cobrança registrada com PIX).
//  • Nosso número Bradesco: 11 dígitos = carteira (2) + nosso_numero (9).
//    Banco devolve completo em "nuTituloBeneficiario".
//  • Webhook simples HMAC-SHA256 do body com webhook_secret,
//    header `bradesco-signature`.

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
      banco: 'bradesco',
      message: 'client_id ou client_secret do Bradesco ausente em escola_banco_config.',
    })
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'cob.write cob.read',
  })

  const res = await bankRelay({
    banco: 'bradesco',
    path: '/auth/server/v1.1/token',
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
      banco: 'bradesco',
      message: `Bradesco OAuth recusou: ${res.status}`,
      status: res.status,
      details: res.body.slice(0, 300),
    })
  }
  return res.json<{ access_token: string }>().access_token
}

function getCarteira(config: BancoConfig): string {
  return (config.carteira ?? '09').replace(/\D/g, '').padStart(2, '0').slice(0, 2)
}

function getCnpj(config: BancoConfig): string {
  return (config.beneficiario_cnpj ?? '').replace(/\D/g, '')
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

function mapSituacao(s: string | undefined | number): BoletoStatus['situacao'] {
  // Bradesco status: "REGISTRADO", "LIQUIDADO", "BAIXADO", "PROTESTADO", "CANCELADO"
  const v = String(s ?? '').toUpperCase()
  if (v === 'LIQUIDADO' || v === 'PAGO') return 'PAGO'
  if (v === 'BAIXADO' || v === 'CANCELADO') return 'CANCELADO'
  if (v === 'VENCIDO' || v === 'PROTESTADO' || v === 'EXPIRADO') return 'VENCIDO'
  return 'EMITIDO'
}

export const bradescoAdapter: BankAdapter = {
  banco: 'bradesco',

  async emitirBoleto(input: BoletoInput, config: BancoConfig): Promise<BoletoOutput> {
    const token = await getToken(config)
    const cpfCnpj = input.pagador.cpf_cnpj.replace(/\D/g, '')
    const tipoInscricao = cpfCnpj.length === 14 ? 2 : 1
    const seuNumero = (input.seu_numero || `LUM${Date.now()}`).slice(0, 11)
    const cnpjBenef = getCnpj(config)

    const payload: Record<string, unknown> = {
      nuCPFCNPJ: cnpjBenef.slice(0, 8),
      filialCPFCNPJ: cnpjBenef.slice(8, 12),
      ctrlCPFCNPJ: cnpjBenef.slice(12, 14),
      idProduto: getCarteira(config),
      nuNegociacao: config.convenio ?? `${config.agencia.padStart(4, '0')}0000000${config.conta.padStart(7, '0')}`,
      nuCliente: seuNumero,
      dtEmissaoTitulo: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
      dtVencimentoTitulo: input.vencimento.replace(/-/g, '.'),
      tpVencimento: 0,
      vlNominalTitulo: Math.round(input.valor * 100), // centavos
      cdEspecieTitulo: '04', // duplicata mercantil
      nomePagador: input.pagador.nome.slice(0, 70),
      logradouroPagador: input.pagador.endereco?.logradouro?.slice(0, 70) ?? '',
      nuLogradouroPagador: input.pagador.endereco?.numero?.slice(0, 10) ?? 'S/N',
      complementoLogradouroPagador: input.pagador.endereco?.complemento?.slice(0, 20) ?? '',
      cepPagador: Number((input.pagador.endereco?.cep ?? '').replace(/\D/g, '').slice(0, 5) || 0),
      complementoCepPagador: (input.pagador.endereco?.cep ?? '').replace(/\D/g, '').slice(5, 8),
      bairroPagador: input.pagador.endereco?.bairro?.slice(0, 40) ?? '',
      municipioPagador: input.pagador.endereco?.cidade?.slice(0, 30) ?? '',
      ufPagador: input.pagador.endereco?.uf ?? '',
      cdIndCpfcnpjPagador: tipoInscricao,
      nuCpfcnpjPagador: cpfCnpj,
      ...(input.pagador.email && { emailPagador: input.pagador.email.slice(0, 60) }),
      ...(input.multa_percentual && {
        cdMulta: 2, // percentual
        pcMulta: Math.round(input.multa_percentual * 10000),
        diasMulta: 1,
      }),
      ...(input.juros_percentual_mes && {
        cdJuros: 2, // taxa mensal
        pcJuros: Math.round(input.juros_percentual_mes * 10000),
      }),
      ...(input.desconto && {
        cdDesconto1: input.desconto.tipo === 'percentual' ? 2 : 1,
        dtLimiteDesconto1: input.desconto.data_limite.replace(/-/g, '.'),
        [input.desconto.tipo === 'percentual' ? 'pcDesconto1' : 'vlDesconto1']:
          input.desconto.tipo === 'percentual'
            ? Math.round(input.desconto.valor * 10000)
            : Math.round(input.desconto.valor * 100),
      }),
      ...(input.mensagem && {
        textoMensagem: input.mensagem.slice(0, 5).join(' | ').slice(0, 200),
      }),
    }

    const res = await bankRelay({
      banco: 'bradesco',
      path: '/v1/boleto/registrarBoleto',
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      throw new BankError({
        code: 'BANK_REJECTED',
        banco: 'bradesco',
        message: `Bradesco rejeitou emissão: ${res.status}`,
        status: res.status,
        details: res.body.slice(0, 500),
      })
    }

    const out = res.json<any>()
    if (out.cdErro && Number(out.cdErro) !== 0) {
      throw new BankError({
        code: 'BANK_REJECTED',
        banco: 'bradesco',
        message: `Bradesco erro ${out.cdErro}: ${out.msgErro ?? 'sem detalhe'}`,
        details: out,
      })
    }
    return {
      nosso_numero: out.nuTituloBeneficiario ?? out.nossoNumero ?? seuNumero,
      codigo_solicitacao: out.idProtocoloRegistroBoleto ?? out.nuTituloBeneficiario ?? seuNumero,
      linha_digitavel: out.linhaDigitavel ?? '',
      codigo_barras: out.codigoBarras ?? '',
      pix_copia_cola: out.qrCode?.emv ?? out.emv,
      url_visualizacao: out.urlBoleto,
      vencimento: input.vencimento,
      valor: input.valor,
    }
  },

  async consultarBoleto(nossoNumero: string, config: BancoConfig): Promise<BoletoStatus> {
    const token = await getToken(config)
    const cnpjBenef = getCnpj(config)
    const res = await bankRelay({
      banco: 'bradesco',
      path: `/v1/boleto/consultarBoleto`,
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nuCPFCNPJ: cnpjBenef.slice(0, 8),
        filialCPFCNPJ: cnpjBenef.slice(8, 12),
        ctrlCPFCNPJ: cnpjBenef.slice(12, 14),
        idProduto: getCarteira(config),
        nuNegociacao: config.convenio,
        nuTituloBeneficiario: nossoNumero,
      }),
    })
    if (!res.ok) {
      throw new BankError({
        code: res.status === 404 ? 'BOLETO_NOT_FOUND' : 'BANK_REJECTED',
        banco: 'bradesco',
        message: `Bradesco consulta falhou: ${res.status}`,
        status: res.status,
        details: res.body.slice(0, 300),
      })
    }
    const cob = res.json<any>()
    return {
      nosso_numero: cob.nuTituloBeneficiario ?? nossoNumero,
      situacao: mapSituacao(cob.cdSituacaoTitulo ?? cob.situacao),
      valor: Number(cob.vlNominalTitulo ?? 0) / 100,
      valor_pago: cob.vlPago ? Number(cob.vlPago) / 100 : undefined,
      data_pagamento: parseDate(cob.dtCredito ?? cob.dtPagamento),
      data_vencimento: parseDate(cob.dtVencimentoTitulo) ?? '',
    }
  },

  async cancelarBoleto(nossoNumero: string, motivo: string, config: BancoConfig): Promise<void> {
    const token = await getToken(config)
    const cnpjBenef = getCnpj(config)
    const res = await bankRelay({
      banco: 'bradesco',
      path: '/v1/boleto/baixarBoleto',
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nuCPFCNPJ: cnpjBenef.slice(0, 8),
        filialCPFCNPJ: cnpjBenef.slice(8, 12),
        ctrlCPFCNPJ: cnpjBenef.slice(12, 14),
        idProduto: getCarteira(config),
        nuNegociacao: config.convenio,
        nuTituloBeneficiario: nossoNumero,
        cdMotivoBaixa: '10', // a pedido do cliente
        textoMotivo: motivo.slice(0, 80),
      }),
    })
    if (!res.ok) {
      throw new BankError({
        code: 'BANK_REJECTED',
        banco: 'bradesco',
        message: `Bradesco cancelamento falhou: ${res.status}`,
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
    const cnpjBenef = getCnpj(config)
    const cpf = cpfCnpj.replace(/\D/g, '')
    const res = await bankRelay({
      banco: 'bradesco',
      path: '/v1/boleto/consultarBoletosBeneficiario',
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nuCPFCNPJ: cnpjBenef.slice(0, 8),
        filialCPFCNPJ: cnpjBenef.slice(8, 12),
        ctrlCPFCNPJ: cnpjBenef.slice(12, 14),
        idProduto: getCarteira(config),
        nuNegociacao: config.convenio,
        dtInicio: dataInicial.replace(/-/g, '.'),
        dtFim: dataFinal.replace(/-/g, '.'),
        cpfCnpjPagador: cpf,
        registrosPorPagina: 100,
      }),
    })
    if (!res.ok) {
      if (res.status === 404) return []
      throw new BankError({
        code: 'BANK_REJECTED',
        banco: 'bradesco',
        message: `Bradesco listagem falhou: ${res.status}`,
        status: res.status,
      })
    }
    const data = res.json<{ titulosBeneficiario?: any[] }>()
    return (data.titulosBeneficiario ?? []).map((cob: any) => ({
      nosso_numero: cob.nuTituloBeneficiario ?? '',
      situacao: mapSituacao(cob.cdSituacaoTitulo),
      valor: Number(cob.vlNominalTitulo ?? 0) / 100,
      valor_pago: cob.vlPago ? Number(cob.vlPago) / 100 : undefined,
      data_pagamento: parseDate(cob.dtCredito ?? cob.dtPagamento),
      data_vencimento: parseDate(cob.dtVencimentoTitulo) ?? '',
    }))
  },

  async parseWebhook(headers: Headers, body: string, config: BancoConfig): Promise<WebhookEvent> {
    const sig = headers.get('bradesco-signature') ?? headers.get('x-bradesco-signature') ?? ''
    if (config.webhook_secret) {
      const expected = await hmacHex(body, config.webhook_secret)
      if (sig !== expected) {
        throw new BankError({
          code: 'WEBHOOK_INVALID_SIG',
          banco: 'bradesco',
          message: 'Assinatura HMAC Bradesco inválida.',
        })
      }
    }
    const payload = JSON.parse(body)
    const evt = Array.isArray(payload.eventos) ? payload.eventos[0] : payload
    const sit = mapSituacao(evt.cdSituacaoTitulo ?? evt.situacao ?? evt.evento)
    const tipoMap: Record<BoletoStatus['situacao'], WebhookEvent['tipo']> = {
      PAGO: 'boleto.pago',
      CANCELADO: 'boleto.cancelado',
      VENCIDO: 'boleto.vencido',
      EMITIDO: 'boleto.emitido',
      EXPIRADO: 'boleto.vencido',
    }
    return {
      banco: 'bradesco',
      escola_id: config.escola_id,
      tipo: tipoMap[sit] ?? 'desconhecido',
      nosso_numero: evt.nuTituloBeneficiario ?? evt.nossoNumero,
      valor: evt.vlNominalTitulo ? Number(evt.vlNominalTitulo) / 100 : undefined,
      valor_pago: evt.vlPago ? Number(evt.vlPago) / 100 : undefined,
      data_pagamento: parseDate(evt.dtCredito ?? evt.dtPagamento),
      raw: payload,
    }
  },
}

function parseDate(s: string | undefined): string | undefined {
  if (!s) return undefined
  // "yyyy.MM.dd" → "yyyy-MM-dd"
  const m = s.match(/^(\d{4})\.(\d{2})\.(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  // "dd.MM.yyyy"
  const m2 = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return s
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
