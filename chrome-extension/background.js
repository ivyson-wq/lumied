// Service worker — proxies API calls from content script to bypass CORS
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.type !== 'api') return false;
  chrome.storage.local.get(['apiUrl', 'apiKey', 'token'], function(config) {
    if (!config.apiUrl || !config.token) {
      sendResponse({ error: 'Extensao nao configurada. Clique no icone Lumied na barra do Chrome.' });
      return;
    }
    fetch(config.apiUrl + '/functions/v1/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': config.apiKey, 'Authorization': 'Bearer ' + config.apiKey },
      body: JSON.stringify(Object.assign({ action: msg.action, _token: config.token }, msg.params || {})),
    })
    .then(function(r) { return r.json(); })
    .then(function(data) { sendResponse(data); })
    .catch(function(err) { sendResponse({ error: err.message }); });
  });
  return true; // keep channel open for async response
});
