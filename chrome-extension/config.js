// ═══════════════════════════════════════════════════════════════
//  Lumied CRM — Config global da extensão
//
//  ATENÇÃO: o anon_key do Supabase é PÚBLICO por design — pode ficar
//  no source. É o token de sessão (login) que é sensível, e esse vai
//  pro chrome.storage.local somente após autenticação.
//
//  Mantido em arquivo separado pra:
//    • facilitar rotação sem alterar lógica
//    • permitir override por escola/ambiente no futuro
// ═══════════════════════════════════════════════════════════════
(function() {
  const CONFIG = {
    API_URL: 'https://brgorknbrjlfwvrrlwxj.supabase.co',
    ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyZ29ya25icmpsZnd2cnJsd3hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjU0NTUsImV4cCI6MjA4OTM0MTQ1NX0.QKX_6ZSfied60ZpB8VOx03hwiyD9J5lskKwfl-oXPYE',
    EXT_VERSION: '1.7.1',
  };
  if (typeof window !== 'undefined') {
    window.LUMIED_CONFIG = CONFIG;
  }
  if (typeof self !== 'undefined') {
    self.LUMIED_CONFIG = CONFIG;
  }
})();
