/**
 * Lumied Realtime — Supabase WebSocket subscriptions
 * Replaces polling with instant updates for:
 * - Access events (aluno chegou/saiu)
 * - Pickup notifications (pai a caminho)
 * - Chat messages
 * - Solicitacoes novas
 */

const SUPABASE_URL = 'https://brgorknbrjlfwvrrlwxj.supabase.co';

let _client = null;
let _status = 'disconnected';
const _channels = [];

/**
 * Get the current Supabase Realtime connection status.
 * @returns {'connected' | 'connecting' | 'disconnected'}
 */
export function getStatus() {
  return _status;
}

/**
 * Initialize the Supabase Realtime client.
 * Call once on portal init. Uses the anon key (not service role).
 * @param {string} [anonKey] - Override anon key; defaults to window.__SUPABASE_ANON or meta tag
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function initRealtime(anonKey) {
  if (_client) return _client;

  const key = anonKey
    || window.__SUPABASE_ANON
    || document.querySelector('meta[name="sb-anon"]')?.content
    || '';

  if (!key) {
    console.warn('[Realtime] No anon key found — subscriptions will not work.');
    return null;
  }

  _status = 'connecting';
  console.log('[Realtime] Initializing Supabase Realtime client...');

  // supabase UMD exposes window.supabase — skip if not loaded
  if (typeof supabase === 'undefined' || !supabase.createClient) {
    console.warn('[Realtime] Supabase JS not loaded — realtime disabled');
    _status = 'disconnected';
    return null;
  }

  _client = supabase.createClient(SUPABASE_URL, key, {
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });

  // Track global connection status via the realtime socket
  _client.realtime.onOpen(() => {
    _status = 'connected';
    console.log('[Realtime] WebSocket connected.');
  });
  _client.realtime.onClose(() => {
    _status = 'disconnected';
    console.log('[Realtime] WebSocket disconnected.');
  });
  _client.realtime.onError((err) => {
    console.error('[Realtime] WebSocket error:', err);
  });

  return _client;
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/**
 * Create a postgres_changes subscription on a channel.
 * @param {string} channelName  Unique channel label
 * @param {object} opts
 * @param {string} opts.table
 * @param {string} opts.event   'INSERT' | 'UPDATE' | '*'
 * @param {string} opts.filter  e.g. 'escola_id=eq.abc'
 * @param {Function} callback   Receives the new row payload
 * @returns {Function} unsubscribe
 */
function _subscribe(channelName, { table, event, filter }, callback) {
  if (!_client) {
    console.warn(`[Realtime] Client not initialised — cannot subscribe to ${table}`);
    return () => {};
  }

  const channel = _client
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event,
        schema: 'public',
        table,
        filter,
      },
      (payload) => {
        callback(payload.new);
      },
    )
    .on('system', { event: 'disconnect' }, () => {
      _status = 'disconnected';
      console.warn(`[Realtime] Channel "${channelName}" disconnected — will auto-reconnect.`);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`[Realtime] Subscribed to ${table} (channel: ${channelName})`);
      } else if (status === 'CHANNEL_ERROR') {
        console.error(`[Realtime] Channel error on ${channelName}`);
      }
    });

  _channels.push(channel);

  // Return unsubscribe function
  return () => {
    _client.removeChannel(channel);
    const idx = _channels.indexOf(channel);
    if (idx !== -1) _channels.splice(idx, 1);
    console.log(`[Realtime] Unsubscribed from ${table} (channel: ${channelName})`);
  };
}

// ---------------------------------------------------------------------------
// Public subscription helpers
// ---------------------------------------------------------------------------

/**
 * Subscribe to pickup notifications (pai a caminho).
 * Funciona porque familia.html usa Supabase Auth (magic link) — auth.jwt()
 * disponível pro Realtime checar RLS. Tabela está em supabase_realtime.
 * @param {string} escolaId
 * @param {Function} callback
 * @returns {Function} unsubscribe
 */
export function subscribePickup(escolaId, callback) {
  return _subscribe('pickup-notifications', {
    table: 'pickup_notificacoes',
    event: 'INSERT',
    filter: `escola_id=eq.${escolaId}`,
  }, callback);
}

/**
 * Subscribe to new/updated solicitacoes.
 * NOTA: portais gerente/professora usam sessao propria (nao auth.jwt) — RLS
 * pode bloquear entrega. Polling continua sendo o caminho real nesses
 * portais; este helper so e util quando o caller usa Supabase Auth.
 * @param {string} escolaId
 * @param {Function} callback
 * @returns {Function} unsubscribe
 */
export function subscribeSolicitacoes(escolaId, callback) {
  return _subscribe('solicitacoes', {
    table: 'solicitacoes',
    event: '*',
    filter: `escola_id=eq.${escolaId}`,
  }, callback);
}

// Removido (2026-05-14, cost-audit): subscribeAccess, subscribeChat,
// subscribeNotificacoes — eram chamados em portais que usam sessao propria
// (professora, gerente) onde RLS bloqueia 100% do payload (auth.jwt vazia).
// Polling 10s ja cobre. Pra ressuscitar precisa: portal em Supabase Auth +
// policy SELECT pra papel correspondente + ADD TABLE no publication.

/**
 * Unsubscribe from all active channels and clean up.
 */
export function unsubscribeAll() {
  if (!_client) return;
  for (const ch of _channels) {
    _client.removeChannel(ch);
  }
  _channels.length = 0;
  console.log('[Realtime] All subscriptions removed.');
}
