// Reset App — limpa cache, service workers, storage e recarrega.
// Uso: <button onclick="_resetApp()">Resetar app</button>
window._resetApp = async function () {
  if (!confirm('Resetar o app vai limpar o cache local e te deslogar. Continuar?')) return;
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch (e) {}
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) {}
  try { localStorage.clear(); } catch (e) {}
  try { sessionStorage.clear(); } catch (e) {}
  location.replace(location.pathname + '?_r=' + Date.now());
};
