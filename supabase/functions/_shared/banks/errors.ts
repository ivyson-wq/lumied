// Erro padronizado pra adapters bancários. Permite tratamento
// uniforme de falhas em qualquer banco (auth expirou, cert inválido,
// rate limit, etc.) sem o caller precisar conhecer particularidades.

export type BankErrorCode =
  | 'AUTH_FAILED'           // OAuth rejeitou credenciais
  | 'CERT_INVALID'          // PFX expirado/corrompido
  | 'CERT_NOT_FOUND'        // path no bucket vazio
  | 'CONFIG_INCOMPLETE'     // escola_banco_config sem campos obrigatórios
  | 'BOLETO_NOT_FOUND'
  | 'BOLETO_DUPLICATED'
  | 'BANK_REJECTED'         // banco retornou 400/422 com regra de negócio
  | 'BANK_UNAVAILABLE'      // 5xx, timeout
  | 'RATE_LIMITED'
  | 'WEBHOOK_INVALID_SIG'
  | 'NOT_IMPLEMENTED'
  | 'UNKNOWN'

export class BankError extends Error {
  code: BankErrorCode
  banco: string
  status?: number
  details?: unknown

  constructor(opts: { code: BankErrorCode; banco: string; message: string; status?: number; details?: unknown }) {
    super(opts.message)
    this.name = 'BankError'
    this.code = opts.code
    this.banco = opts.banco
    this.status = opts.status
    this.details = opts.details
  }

  toJSON() {
    return {
      error: 'BankError',
      code: this.code,
      banco: this.banco,
      message: this.message,
      status: this.status,
      details: this.details,
    }
  }
}
