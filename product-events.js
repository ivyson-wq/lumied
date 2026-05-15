// ═══════════════════════════════════════════════════════════════
//  Lumied — Product Events SDK (client-side)
//
//  Telemetria de produto para o Lumied Activation Program (LAP).
//  Alimenta o Lumied Health Score (LHS) e a métrica AMPS.
//
//  Uso:
//    <script src="/config.js"></script>
//    <script src="/product-events.js" defer></script>
//
//    trackProductEvent('financeiro.cobranca.gerada', { valor_cents: 12000 });
//    trackProductEvent('manutencao.chamado.aberto', { categoria: 'eletrica' });
//
//  Características:
//    - Buffer (flush a cada 5s ou 10 eventos)
//    - sendBeacon no unload pra não perder último flush
//    - Persistência em sessionStorage (sobrevive a refresh)
//    - Token de sessão lido automaticamente do localStorage
//    - Fire-and-forget: nunca quebra UI, falha silenciosa
//    - Skip em localhost (não polui telemetria com dev)
// ═══════════════════════════════════════════════════════════════
(function() {
  if (typeof window === 'undefined') return;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    // Dev: stub que loga no console pra ajudar debugging
    window.trackProductEvent = function(name, payload) {
      console.debug('[track-event:dev]', name, payload || {});
    };
    return;
  }

  var SUPABASE_URL = (window.CONFIG && window.CONFIG.SUPABASE_URL) || 'https://brgorknbrjlfwvrrlwxj.supabase.co';
  var ENDPOINT = SUPABASE_URL + '/functions/v1/track-event';

  var BUFFER_KEY = 'lumied_pe_buffer';
  var SESSION_KEY = 'lumied_pe_session';
  var FLUSH_INTERVAL_MS = 5000;
  var FLUSH_AT_COUNT = 10;
  var MAX_BUFFER = 200; // hard cap pra não estourar storage

  // ── Session ID (1 por sessão de browser) ──
  var sessionId = sessionStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = 'ses_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(SESSION_KEY, sessionId);
  }

  // ── Token discovery ──
  function getToken() {
    return localStorage.getItem('gerente_token')
        || localStorage.getItem('prof_token')
        || localStorage.getItem('secretaria_token')
        || localStorage.getItem('staff_token')
        || localStorage.getItem('aluno_token')
        || null;
  }

  // ── Buffer ──
  function readBuffer() {
    try {
      var raw = sessionStorage.getItem(BUFFER_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }
  function writeBuffer(arr) {
    try {
      sessionStorage.setItem(BUFFER_KEY, JSON.stringify(arr));
    } catch (e) { /* storage cheio: descarta silencioso */ }
  }
  function clearBuffer() {
    try { sessionStorage.removeItem(BUFFER_KEY); } catch (e) { /* */ }
  }

  function enqueue(ev) {
    var buf = readBuffer();
    buf.push(ev);
    if (buf.length > MAX_BUFFER) buf = buf.slice(-MAX_BUFFER);
    writeBuffer(buf);
    if (buf.length >= FLUSH_AT_COUNT) flush();
  }

  // ── Flush ──
  var inFlight = false;
  function flush(useBeacon) {
    if (inFlight && !useBeacon) return;
    var buf = readBuffer();
    if (buf.length === 0) return;

    var payload = { events: buf };
    var token = getToken();
    if (token) payload._token = token;

    // sendBeacon: melhor pra unload (não bloqueia), mas só POST JSON com Blob
    if (useBeacon && navigator.sendBeacon) {
      try {
        var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        var sent = navigator.sendBeacon(ENDPOINT, blob);
        if (sent) clearBuffer();
      } catch (e) { /* */ }
      return;
    }

    inFlight = true;
    var body = JSON.stringify(payload);
    var headers = { 'Content-Type': 'application/json' };
    fetch(ENDPOINT, { method: 'POST', headers: headers, body: body, keepalive: true })
      .then(function(r) {
        // 204 = ok. 400 = drop (eventos malformados). Outros = retry mais tarde.
        if (r.status === 204 || r.status === 400) {
          // Limpa só os eventos que foram enviados (não os que entraram depois).
          var current = readBuffer();
          var remaining = current.slice(buf.length);
          if (remaining.length === 0) clearBuffer();
          else writeBuffer(remaining);
        }
      })
      .catch(function() { /* silencioso */ })
      .finally(function() { inFlight = false; });
  }

  // Flush periódico
  var timer = setInterval(flush, FLUSH_INTERVAL_MS);

  // Flush no unload (sendBeacon)
  function onUnload() { flush(true); }
  window.addEventListener('pagehide', onUnload);
  window.addEventListener('beforeunload', onUnload);
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') flush(true);
  });

  // ── API pública ──
  // trackProductEvent(eventName, payload?, { module?, idempotencyKey?, source? })
  window.trackProductEvent = function(eventName, payload, opts) {
    if (typeof eventName !== 'string' || eventName.length === 0) return;
    opts = opts || {};
    enqueue({
      event_name: eventName,
      module: opts.module || guessModuleFromPath(),
      payload: payload || {},
      session_id: sessionId,
      source: opts.source || 'web',
      idempotency_key: opts.idempotencyKey || undefined,
    });
  };

  // Helper opcional pra cancelar timer (testes)
  window.__lumiedPeStop = function() { clearInterval(timer); flush(true); };

  function guessModuleFromPath() {
    var p = location.pathname.toLowerCase();
    if (p.indexOf('financeiro') >= 0) return 'financeiro';
    if (p.indexOf('manut') >= 0) return 'manutencao';
    if (p.indexOf('almox') >= 0 || p.indexOf('compras') >= 0) return 'almoxarifado';
    if (p.indexOf('ponto') >= 0 || p.indexOf('compliance') >= 0) return 'ponto';
    if (p.indexOf('crm') >= 0 || p.indexOf('comercial') >= 0) return 'crm';
    if (p.indexOf('professora') >= 0 || p.indexOf('academico') >= 0) return 'academico';
    if (p.indexOf('agenda') >= 0) return 'agenda';
    if (p.indexOf('cobranca') >= 0) return 'cobranca';
    if (p.indexOf('admin') >= 0) return 'admin';
    if (p.indexOf('familia') >= 0 || p === '/' || p.endsWith('/index.html')) return 'dashboard';
    return 'outro';
  }
})();
