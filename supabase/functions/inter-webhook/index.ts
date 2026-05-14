// inter-webhook — backward-compat shim.
// Inter está configurado historicamente para POST /inter-webhook;
// internamente reusa toda a lógica do bank-webhook genérico chamando
// /bank-webhook/inter via HTTP. Não precisa reconfigurar portal Inter.
//
// TODO: depois de validar bank-webhook em prod, mover URL no portal Inter
// pra /bank-webhook/inter e deletar este shim.

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (req.method !== 'POST') return new Response('Método não permitido', { status: 405 })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const target = `${supabaseUrl}/functions/v1/bank-webhook/inter`

  // Encaminha headers relevantes (auth secret, content-type)
  const fwdHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
  const xWebhook = req.headers.get('x-webhook-secret')
  const auth = req.headers.get('authorization')
  if (xWebhook) fwdHeaders['x-webhook-secret'] = xWebhook
  if (auth) fwdHeaders['Authorization'] = auth

  const body = await req.text()

  try {
    const res = await fetch(target, { method: 'POST', headers: fwdHeaders, body })
    const text = await res.text()
    return new Response(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
    })
  } catch (err) {
    console.error('[inter-webhook shim] fwd falhou:', err)
    return new Response(JSON.stringify({ error: 'Forward para bank-webhook falhou.' }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    })
  }
})
