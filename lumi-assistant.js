// ═══════════════════════════════════════════════════════
//  Lumi — Assistente IA nativo em todos os portais
//  "Pergunte qualquer coisa sobre a escola"
//  Incluir: <script src="/lumi-assistant.js" defer></script>
// ═══════════════════════════════════════════════════════
(function () {
  'use strict';

  // Config
  const path = location.pathname;
  let portal = 'pais';
  if (path.includes('gerente')) portal = 'gerente';
  else if (path.includes('professora')) portal = 'professora';
  else if (path.includes('aluno')) portal = 'aluno';
  else if (path.includes('secretaria')) portal = 'secretaria';
  else if (path.includes('admin')) portal = 'admin';
  if (path.includes('admin')) return; // admin tem seu próprio painel

  const API_ACTION = portal === 'professora' ? 'ai_perguntar_prof' : 'ai_perguntar';
  const TOKEN_KEY = portal === 'professora' ? 'mb_prof_token' : 'mb_token';

  // Inject CSS
  const style = document.createElement('style');
  style.textContent = `
    #lumiBtn{position:fixed;bottom:80px;right:24px;z-index:9989;width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#6b3fa0,#1a6bb5);color:#fff;border:none;cursor:pointer;box-shadow:0 4px 16px rgba(107,63,160,.35);display:flex;align-items:center;justify-content:center;font-size:20px;transition:all .2s;font-family:inherit;}
    #lumiBtn:hover{transform:scale(1.08);box-shadow:0 6px 24px rgba(107,63,160,.5);}
    #lumiPanel{position:fixed;bottom:140px;right:24px;z-index:9990;width:380px;max-width:calc(100vw - 48px);max-height:480px;background:#fff;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.18);display:none;flex-direction:column;overflow:hidden;font-family:'DM Sans',system-ui,sans-serif;animation:lumiSlide .25s ease;}
    #lumiPanel.open{display:flex;}
    @keyframes lumiSlide{from{opacity:0;transform:translateY(10px) scale(.97);}to{opacity:1;transform:translateY(0) scale(1);}}
    .lumi-header{background:linear-gradient(135deg,#6b3fa0,#1a6bb5);color:#fff;padding:14px 18px;display:flex;align-items:center;gap:10px;}
    .lumi-header h3{font-size:14px;font-weight:700;flex:1;margin:0;}
    .lumi-header span{font-size:10px;opacity:.7;}
    .lumi-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;min-height:200px;max-height:320px;background:#faf8f5;}
    .lumi-msg{max-width:88%;padding:10px 14px;border-radius:12px;font-size:13px;line-height:1.5;word-wrap:break-word;}
    .lumi-msg.ai{background:#fff;align-self:flex-start;border:1px solid #e8e8e8;border-radius:2px 12px 12px 12px;color:#1a1a1a;}
    .lumi-msg.user{background:linear-gradient(135deg,#6b3fa0,#1a6bb5);color:#fff;align-self:flex-end;border-radius:12px 2px 12px 12px;}
    .lumi-msg.loading{background:#f0ece6;color:#7a7169;align-self:flex-start;border-radius:2px 12px 12px 12px;animation:lumiPulse 1.5s ease infinite;}
    @keyframes lumiPulse{0%,100%{opacity:1;}50%{opacity:.5;}}
    .lumi-input{padding:12px;border-top:1px solid #eee;display:flex;gap:8px;background:#fff;}
    .lumi-input input{flex:1;padding:10px 14px;border:1px solid #e2dbd1;border-radius:10px;font-size:13px;font-family:inherit;outline:none;}
    .lumi-input input:focus{border-color:#6b3fa0;}
    .lumi-input button{padding:10px 16px;background:linear-gradient(135deg,#6b3fa0,#1a6bb5);color:#fff;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-size:13px;font-family:inherit;}
    .lumi-suggestions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}
    .lumi-suggestions button{padding:6px 12px;background:#f0ece6;border:1px solid #e2dbd1;border-radius:8px;font-size:11px;cursor:pointer;font-family:inherit;color:#1a1a1a;transition:all .15s;}
    .lumi-suggestions button:hover{background:#e2dbd1;}
    @media(max-width:480px){#lumiPanel{left:8px;right:8px;width:auto;bottom:130px;}#lumiBtn{bottom:72px;right:16px;width:44px;height:44px;font-size:18px;}}
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

  // Create button
  const btn = document.createElement('button');
  btn.id = 'lumiBtn';
  btn.title = 'Lumi — Assistente IA';
  btn.innerHTML = '✨';
  btn.onclick = togglePanel;
  document.body.appendChild(btn);

  // Create panel
  const panel = document.createElement('div');
  panel.id = 'lumiPanel';
  const portalSugg = suggestions[portal] || suggestions.gerente;
  panel.innerHTML = `
    <div class="lumi-header">
      <span style="font-size:22px;">✨</span>
      <div><h3>Lumi</h3><span>Assistente inteligente</span></div>
      <button onclick="document.getElementById('lumiPanel').classList.remove('open')" style="background:none;border:none;color:rgba(255,255,255,.7);font-size:18px;cursor:pointer;">×</button>
    </div>
    <div class="lumi-body" id="lumiBody">
      <div class="lumi-msg ai">
        Olá! Sou a <strong>Lumi</strong>, sua assistente inteligente. Posso analisar dados da escola, redigir comunicados, gerar pareceres e muito mais. Como posso ajudar?
      </div>
      <div class="lumi-suggestions" id="lumiSuggestions">
        ${portalSugg.map(s => `<button onclick="window._lumiPergunta('${s}')">${s}</button>`).join('')}
      </div>
    </div>
    <div class="lumi-input">
      <input type="text" id="lumiInput" placeholder="Pergunte qualquer coisa..." onkeydown="if(event.key==='Enter')window._lumiEnviar()">
      <button onclick="window._lumiEnviar()">→</button>
    </div>
  `;
  document.body.appendChild(panel);

  let isOpen = false;
  function togglePanel() { isOpen = !isOpen; panel.classList.toggle('open', isOpen); if (isOpen) document.getElementById('lumiInput').focus(); }

  function addMsg(text, type) {
    const body = document.getElementById('lumiBody');
    document.getElementById('lumiSuggestions')?.remove();
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

    addMsg(pergunta, 'user');
    const loading = addMsg('Analisando dados...', 'loading');

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
      loading.remove();

      if (d.error) {
        addMsg('Desculpe, não consegui processar: ' + d.error, 'ai');
      } else {
        const resp = d.data?.resposta || d.resposta || 'Sem resposta.';
        addMsg(resp.replace(/\n/g, '<br>'), 'ai');
      }
    } catch (e) {
      loading.remove();
      addMsg('Erro de conexão. Tente novamente.', 'ai');
    }
  };
})();
