// ═══════════════════════════════════════════════════════
//  Lumi — Assistente IA nativo em todos os portais
//  "Pergunte qualquer coisa sobre a escola"
//  Incluir: <script src="/lumi-assistant.js" defer></script>
// ═══════════════════════════════════════════════════════
(function () {
  'use strict';

  // Esperar autenticacao — so injetar apos login
  function isLoggedIn() {
    return localStorage.getItem('mb_token') || localStorage.getItem('mb_prof_token') || localStorage.getItem('mb_aluno_token') || localStorage.getItem('mb_admin_token');
  }
  if (!isLoggedIn()) {
    // Re-checar a cada 2s ate login
    const checkInterval = setInterval(() => { if (isLoggedIn()) { clearInterval(checkInterval); init(); } }, 2000);
    return;
  }
  init();
  function init() {

  // Config
  const path = location.pathname;
  let portal = 'pais';
  if (path.includes('gerente')) portal = 'gerente';
  else if (path.includes('professora')) portal = 'professora';
  else if (path.includes('aluno')) portal = 'aluno';
  else if (path.includes('secretaria')) portal = 'secretaria';
  else if (path.includes('admin')) portal = 'admin';
  if (path.includes('admin')) return;
  // Gerente: já tem barra de busca no dashboard, não injetar bottombar
  if (portal === 'gerente') return;

  const API_ACTION = portal === 'professora' ? 'ai_perguntar_prof' : 'ai_perguntar';
  const TOKEN_KEY = portal === 'professora' ? 'mb_prof_token' : 'mb_token';

  // Inject CSS — bottombar fixa
  const style = document.createElement('style');
  style.textContent = `
    #lumiBar{position:fixed;bottom:0;left:0;right:0;z-index:9989;background:#fff;border-top:1px solid #e2dbd1;padding:8px 16px;display:flex;align-items:center;gap:8px;font-family:'DM Sans',system-ui,sans-serif;box-shadow:0 -2px 12px rgba(0,0,0,.06);}
    #lumiBar input{flex:1;padding:10px 14px;border:1.5px solid #e2dbd1;border-radius:12px;font-size:13px;font-family:inherit;outline:none;background:#faf8f5;transition:border-color .2s;}
    #lumiBar input:focus{border-color:#6B3FA0;}
    #lumiBar button{width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#6B3FA0,#1A6BB5);color:#fff;border:none;cursor:pointer;font-size:16px;flex-shrink:0;display:flex;align-items:center;justify-content:center;}
    #lumiBar .lumi-icon{font-size:18px;flex-shrink:0;}
    #lumiResponse{position:fixed;bottom:60px;left:16px;right:16px;z-index:9990;background:#fff;border:1px solid #e2dbd1;border-radius:14px;padding:16px;box-shadow:0 8px 32px rgba(0,0,0,.12);display:none;font-family:'DM Sans',system-ui,sans-serif;font-size:13px;line-height:1.6;max-height:300px;overflow-y:auto;}
    #lumiResponse .close-resp{position:absolute;top:8px;right:12px;background:none;border:none;font-size:16px;cursor:pointer;color:#7a7169;}
    body{padding-bottom:64px !important;}
    .bnav,.prof-bnav{bottom:56px !important;}
    @media(min-width:901px){#lumiBar{left:240px;}}
  `;
  document.head.appendChild(style);

  // Suggestions by portal
  const suggestions = {
    gerente: ['Resumo do dia', 'Como está a inadimplência?', 'Redigir comunicado', 'Leads parados no CRM', 'Previsão próximo mês'],
    professora: ['Analisar minha turma', 'Gerar parecer BNCC', 'Sugestão de atividade', 'Alunos com frequência baixa'],
    pais: ['Notas do meu filho', 'Próximos eventos', 'Status do boleto', 'Horário das aulas'],
    aluno: ['Minhas notas', 'Próxima prova', 'Frequência do mês'],
    secretaria: ['Atestados pendentes', 'Documentos para emitir'],
  };

  // Create bottombar
  const bar = document.createElement('div');
  bar.id = 'lumiBar';
  bar.innerHTML = `
    <span class="lumi-icon">✨</span>
    <input type="text" id="lumiInput" placeholder="Pergunte à Lumi..." onkeydown="if(event.key==='Enter')window._lumiEnviar()">
    <button onclick="window._lumiEnviar()">→</button>
  `;
  document.body.appendChild(bar);

  // Response panel (aparece acima da bottombar)
  const respPanel = document.createElement('div');
  respPanel.id = 'lumiResponse';
  respPanel.innerHTML = '<button class="close-resp" onclick="this.parentElement.style.display=\'none\'">×</button><div id="lumiRespContent"></div>';
  document.body.appendChild(respPanel);

  function addMsg(text, type) {
    // Para bottombar, mostra no painel de resposta
    const resp = document.getElementById('lumiResponse');
    const content = document.getElementById('lumiRespContent');
    if (type === 'user') return; // não mostrar a pergunta do user no painel
    resp.style.display = 'block';
    content.innerHTML = text;
    const msg = document.createElement('div');
    msg.className = 'lumi-msg ' + type;
    msg.innerHTML = text;
    body.appendChild(msg);
    body.scrollTop = body.scrollHeight;
    return msg;
  }

  window._lumiPergunta = function (texto) {
    document.getElementById('lumiInput').value = texto;
    window._lumiEnviar();
  };

  window._lumiEnviar = async function () {
    const input = document.getElementById('lumiInput');
    const pergunta = input.value.trim();
    if (!pergunta) return;
    input.value = '';

    addMsg('<span style="color:#7a7169;">✨ Analisando...</span>', 'ai');

    try {
      const config = window.CONFIG || {};
      const supabaseUrl = config.SUPABASE_URL || 'https://brgorknbrjlfwvrrlwxj.supabase.co';
      const anon = config.SUPABASE_ANON || '';
      const token = localStorage.getItem(TOKEN_KEY) || '';

      const tokenField = portal === 'professora' ? '_prof_token' : '_token';
      const r = await fetch(supabaseUrl + '/functions/v1/lumied-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': anon, 'Authorization': 'Bearer ' + anon },
        body: JSON.stringify({ action: API_ACTION, pergunta, portal, [tokenField]: token }),
      });
      const d = await r.json();

      if (d.error) {
        addMsg('Desculpe: ' + d.error, 'ai');
      } else {
        const resp = d.data?.resposta || d.resposta || 'Sem resposta.';
        addMsg('<div style="display:flex;gap:8px;"><span style="font-size:16px;flex-shrink:0;">✨</span><div>' + resp.replace(/\n/g, '<br>') + '</div></div>', 'ai');
      }
    } catch (e) {
      loading.remove();
      addMsg('Erro de conexão. Tente novamente.', 'ai');
    }
  };

  } // fim da function init()
})();
