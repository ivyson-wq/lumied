// ═══════════════════════════════════════════════════════
//  Lumi — Assistente IA nativo em todos os portais
//  "Pergunte qualquer coisa sobre a escola"
//  Incluir: <script src="/lumi-assistant.js" defer></script>
// ═══════════════════════════════════════════════════════
(function () {
  'use strict';

  // Detect portal first
  const path = location.pathname;
  let portal = 'pais';
  if (path.includes('gerente')) portal = 'gerente';
  else if (path.includes('professora')) portal = 'professora';
  else if (path.includes('aluno')) portal = 'aluno';
  else if (path.includes('secretaria')) portal = 'secretaria';
  else if (path.includes('admin')) portal = 'admin';
  if (portal === 'admin') return; // Não mostrar no admin

  // Check if user is ACTUALLY logged in (verify login screen is hidden)
  function isLoggedIn() {
    // Check if login screen is visible — if so, NOT logged in
    const loginScreen = document.getElementById('loginScreen') || document.getElementById('loginScreenWrap') || document.getElementById('loginWall') || document.getElementById('loginCard');
    if (loginScreen && loginScreen.style.display !== 'none' && !loginScreen.classList.contains('hidden')) return false;
    // Also require a token
    return localStorage.getItem('mb_token') || localStorage.getItem('prof_token') || localStorage.getItem('mb_aluno_token') || localStorage.getItem('sec_token');
  }

  // Wait for DOM + login, max 60 checks (2 min)
  let attempts = 0;
  function tryInit() {
    attempts++;
    if (attempts > 60) return; // Give up after 2 minutes
    if (!isLoggedIn()) { setTimeout(tryInit, 2000); return; }
    init();
  }
  // Wait for DOM to be ready before first check
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(tryInit, 1000); });
  } else {
    setTimeout(tryInit, 1000);
  }
  return; // Exit IIFE — init() will be called when ready

  function init() {

  const isGerente = portal === 'gerente';
  // MCP mode: gerente/secretaria usam ai_perguntar_mcp (tool use com dados reais)
  // Professora ainda usa endpoint clássico com contexto pré-coletado
  const useMcp = (portal === 'gerente' || portal === 'secretaria');
  const API_ACTION = useMcp
    ? 'ai_perguntar_mcp'
    : (portal === 'professora' ? 'ai_perguntar_prof' : 'ai_perguntar');
  const TOKEN_KEYS = { professora: 'prof_token', aluno: 'mb_aluno_token', secretaria: 'sec_token' };
  const TOKEN_KEY = TOKEN_KEYS[portal] || 'mb_token';

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
    .bnav,.prof-bnav,.bottom-nav{bottom:56px !important;}
    @media(min-width:901px){#lumiBar{left:240px;}}
    @media(max-width:900px){.bottom-nav.visible{bottom:56px !important;}}
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

  // Gerente: esconder bottombar quando Dashboard está ativo (tem barra central)
  if (isGerente) {
    function checkDashboardActive() {
      const dashPanel = document.getElementById('panelDashboard');
      const isDash = dashPanel && dashPanel.classList.contains('active');
      bar.style.display = isDash ? 'none' : 'flex';
      respPanel.style.display = isDash ? 'none' : respPanel.style.display;
    }
    // Observar mudanças de painel
    const observer = new MutationObserver(checkDashboardActive);
    const content = document.querySelector('.content');
    if (content) observer.observe(content, { subtree: true, attributes: true, attributeFilter: ['class'] });
    // Check inicial após app carregar
    setTimeout(checkDashboardActive, 2000);
  }

  function addMsg(text, type) {
    const resp = document.getElementById('lumiResponse');
    const content = document.getElementById('lumiRespContent');
    if (type === 'user') return;
    resp.style.display = 'block';
    content.innerHTML = text;
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
      console.error('[Lumi]', e);
      addMsg('Erro de conexão. Tente novamente.', 'ai');
    }
  };

  } // fim da function init()
})();
