// ─────────────────────────────────────────────────────────────────
//  Tipos canônicos pra integração bancária multi-provider.
//  Cada adapter (inter, sicredi, bb, itau, bradesco) implementa
//  BankAdapter consumindo BancoConfig (lida de escola_banco_config).
// ─────────────────────────────────────────────────────────────────

export type BancoProvider = 'inter' | 'sicredi' | 'bb' | 'itau' | 'bradesco'

export interface BancoConfig {
  id: string
  escola_id: string
  banco: BancoProvider
  agencia: string
  conta: string
  conta_digito?: string | null
  convenio?: string | null
  carteira?: string | null
  beneficiario_cnpj: string
  beneficiario_nome: string
  client_id?: string | null
  client_secret_name?: string | null
  cert_storage_path?: string | null
  cert_secret_key?: string | null
  pix_chave?: string | null
  pix_tipo?: string | null
  webhook_secret?: string | null
  homologado: boolean
}

export interface PagadorInput {
  cpf_cnpj: string
  nome: string
  email?: string
  telefone?: string
  endereco?: {
    logradouro: string
    numero?: string
    complemento?: string
    bairro: string
    cep: string
    cidade: string
    uf: string
  }
}

export interface BoletoInput {
  pagador: PagadorInput
  valor: number
  vencimento: string                    // YYYY-MM-DD
  descricao?: string
  seu_numero?: string                   // referência interna da escola
  multa_percentual?: number
  juros_percentual_mes?: number
  desconto?: { tipo: 'fixo' | 'percentual'; valor: number; data_limite: string }
  mensagem?: string[]                   // até 5 linhas no boleto
}

export interface BoletoOutput {
  nosso_numero: string
  codigo_solicitacao: string            // ID interno do banco (Inter chama assim)
  linha_digitavel: string
  codigo_barras: string
  pdf_base64?: string                   // alguns bancos retornam direto, outros exigem GET extra
  pix_copia_cola?: string               // bancos modernos embutem PIX no boleto
  vencimento: string
  valor: number
  url_visualizacao?: string
}

export interface BoletoStatus {
  nosso_numero: string
  situacao: 'EMITIDO' | 'PAGO' | 'VENCIDO' | 'CANCELADO' | 'EXPIRADO'
  valor: number
  valor_pago?: number
  data_pagamento?: string
  data_vencimento: string
}

export interface PixInput {
  txid?: string                         // se omitido, gerado pelo banco
  pagador?: PagadorInput
  valor: number
  expiracao_segundos?: number           // default 3600
  descricao?: string
  info_adicionais?: { nome: string; valor: string }[]
}

export interface PixOutput {
  txid: string
  qr_code_base64: string
  copia_cola: string
  expira_em: string                     // ISO
  valor: number
}

export interface WebhookEvent {
  banco: BancoProvider
  escola_id: string
  tipo: 'boleto.pago' | 'boleto.vencido' | 'boleto.cancelado' | 'boleto.emitido' | 'pix.recebido' | 'desconhecido'
  nosso_numero?: string
  txid?: string                         // PIX
  valor?: number
  valor_pago?: number
  data_pagamento?: string
  raw: unknown                          // payload original p/ debug
}

export interface BankAdapter {
  banco: BancoProvider

  /** Emite um novo boleto. Retorna nosso_numero + linha digitável + PDF. */
  emitirBoleto(input: BoletoInput, config: BancoConfig): Promise<BoletoOutput>

  /** Consulta status de um boleto pelo nosso_numero. */
  consultarBoleto(nossoNumero: string, config: BancoConfig): Promise<BoletoStatus>

  /** Cancela boleto não pago. Motivos: ACERTOS, APEDIDODOCLIENTE, etc. */
  cancelarBoleto(nossoNumero: string, motivo: string, config: BancoConfig): Promise<void>

  /** Lista boletos por CPF/CNPJ no período (sync incremental). */
  listarBoletos(
    cpfCnpj: string,
    dataInicial: string,
    dataFinal: string,
    config: BancoConfig
  ): Promise<BoletoStatus[]>

  /** Emite cobrança PIX (QR estático ou dinâmico). */
  emitirPix?(input: PixInput, config: BancoConfig): Promise<PixOutput>

  /** Faz download do PDF do boleto (alguns bancos não retornam no emitirBoleto). */
  downloadBoletoPdf?(nossoNumero: string, config: BancoConfig): Promise<Uint8Array>

  /**
   * Valida HMAC + parseia payload do webhook num evento canônico.
   * `headers` e `body` vêm da Request original. `escola_id` é resolvido
   * pelo dispatcher antes de chamar o adapter.
   */
  parseWebhook(
    headers: Headers,
    body: string,
    config: BancoConfig
  ): Promise<WebhookEvent>
}
