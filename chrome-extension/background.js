// Service worker — proxies API calls from content script to bypass CORS
// Em MV3 os service workers podem importar scripts via importScripts.
importScripts('config.js');

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.type !== 'api') return false;
  const cfg = self.LUMIED_CONFIG || {};
  chrome.storage.local.get(['token'], function(stored) {
    if (!stored.token) {
      sendResponse({ error: 'Extensao nao configurada. Clique no icone Lumied na barra do Chrome.' });
      return;
    }
    const apiUrl = cfg.API_URL;
    const apiKey = cfg.ANON_KEY;
    if (!apiUrl || !apiKey) {
      sendResponse({ error: 'Config da extensao corrompida. Reinstale a extensao.' });
      return;
    }
    fetch(apiUrl + '/functions/v1/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': apiKey, 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify(Object.assign({ action: msg.action, _token: stored.token }, msg.params || {})),
    })
    .then(function(r) { return r.json(); })
    .then(function(data) { sendResponse(data); })
    .catch(function(err) { sendResponse({ error: err.message }); });
  });
  return true; // keep channel open for async response
});
