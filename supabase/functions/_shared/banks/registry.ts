// Registry: mapeia BancoProvider -> BankAdapter.
// Adapters novos (sicredi/bb/itau/bradesco) entram aqui em cada sprint.

import type { BankAdapter, BancoProvider } from './types.ts'
import { BankError } from './errors.ts'
import { interAdapter } from './adapters/inter.ts'
import { sicrediAdapter } from './adapters/sicredi.ts'
import { bbAdapter } from './adapters/bb.ts'
import { itauAdapter } from './adapters/itau.ts'
import { bradescoAdapter } from './adapters/bradesco.ts'

const REGISTRY: Partial<Record<BancoProvider, BankAdapter>> = {
  inter: interAdapter,
  sicredi: sicrediAdapter,
  bb: bbAdapter,
  itau: itauAdapter,
  bradesco: bradescoAdapter,
}

export function getBankAdapter(banco: BancoProvider): BankAdapter {
  const adapter = REGISTRY[banco]
  if (!adapter) {
    throw new BankError({
      code: 'NOT_IMPLEMENTED',
      banco,
      message: `Adapter para ${banco} ainda não implementado.`,
    })
  }
  return adapter
}

export function bancosImplementados(): BancoProvider[] {
  return Object.keys(REGISTRY) as BancoProvider[]
}
