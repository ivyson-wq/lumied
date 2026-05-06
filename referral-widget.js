/* Lumied — Widget de Indicação
 * Botão discreto flutuante que aparece em portais para gerente/diretor/staff.
 * Clicou → gera link único de indicação (ind=<codigo>) apontando para /roi/ ou /demo/.
 * Convida a encaminhar para outras escolas em troca de benefícios do programa parceiros.
 *
 * Uso: <script src="/referral-widget.js" defer></script>
 *
 * Auto-inicialização: olha tokens conhecidos no localStorage e monta o widget
 * apenas quando faz sentido (gerente/admin/staff autenticado).
 */
(function () {
  'use strict';

  // Só em desktop — mobile vira poluição
  if (window.innerWidth < 900) return;

  // Detecta qual portal estamos
  const path = location.pathname.toLowerCase();
  const isPortalElegivel = /gerente\.html|admin\.html|admin-central\.html|secretaria\.html/.test(path) || path === '/' && location.host.startsWith('admin');

  if (!isPortalElegivel) return;

  // Verifica se há token (ou seja, usuário autenticado)
  const tokens = ['mb_token','mb_admin_token','sec_token','mb_staff_token'];
  const tokenKey = tokens.find(k => localStorage.getItem(k));
  if (!tokenKey) return;

  // Opt-out — usuário pode ter fechado o widget permanentemente
  if (localStorage.getItem('lumied_ref_dismissed') === 'true') return;

  // Código único por escola (deriva do token, ou random se não tiver contexto)
  const hash = (s) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
    return Math.abs(h).toString(36).slice(0, 8).toUpperCase();
  };
  const token = localStorage.getItem(tokenKey) || '';
  const codigo = 'IND-' + hash(token + (localStorage.getItem('escola_subdominio') || 'lumied'));

  const BASE = 'https://lumied.com.br';
  const urlIndicacao = `${BASE}/demo/?ind=${codigo}&utm_source=indicacao&utm_medium=portal&utm_campaign=${tokenKey.replace(/_/g,'-')}`;

  // Montagem do widget
  const css = `
    #lumied-ref-btn{position:fixed;bottom:130px;right:20px;z-index:9994;background:linear-gradient(135deg,#6B3FA0,#8E54B6);color:#fff;border:none;padding:10px 16px;border-radius:50px;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 4px 16px rgba(107,63,160,.3);display:flex;align-items:center;gap:7px;animation:lumiedPulse 2s infinite;}
    #lumied-ref-btn:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(107,63,160,.4);}
    @keyframes lumiedPulse{0%{box-shadow:0 4px 16px rgba(107,63,160,.3);}50%{box-shadow:0 4px 22px rgba(107,63,160,.55);}100%{box-shadow:0 4px 16px rgba(107,63,160,.3);}}
    #lumied-ref-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;align-items:center;justify-content:center;padding:20px;font-family:inherit;}
    #lumied-ref-modal.on{display:flex;}
    #lumied-ref-box{background:#fff;max-width:520px;width:100%;border-radius:18px;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.3);}
    #lumied-ref-box h3{font-size:19px;font-weight:800;margin:0 0 8px;color:#4c2a7a;}
    #lumied-ref-box p{font-size:14px;color:#475569;margin:0 0 14px;line-height:1.55;}
    #lumied-ref-box ul{font-size:13px;color:#334155;margin:8px 0 16px;padding-left:18px;}
    #lumied-ref-box li{margin-bottom:4px;}
    .lumied-link-box{background:#f0e6ff;padding:12px;border-radius:10px;font-family:monospace;font-size:12px;color:#4c2a7a;word-break:break-all;margin:8px 0 14px;border:1.5px dashed #6B3FA0;}
    .lumied-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;}
    .lumied-actions button{padding:11px 18px;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;font-family:inherit;}
    .lumied-btn-primary{background:#6B3FA0;color:#fff;}
    .lumied-btn-secondary{background:#f1f5f9;color:#0F172A;}
    .lumied-btn-text{background:transparent;color:#64748B;text-decoration:underline;}
    .lumied-close{position:absolute;top:14px;right:18px;background:none;border:none;font-size:22px;cursor:pointer;color:#94a3b8;}
    #lumied-ref-copied{display:none;color:#16A34A;font-size:12px;font-weight:700;margin-top:6px;}
    #lumied-ref-copied.on{display:block;}
  `;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const btn = document.createElement('button');
  btn.id = 'lumied-ref-btn';
  btn.title = 'Indique outra escola e ganhe benefícios';
  btn.innerHTML = '💜 Indique uma escola';
  btn.onclick = openModal;
  document.body.appendChild(btn);

  const modal = document.createElement('div');
  modal.id = 'lumied-ref-modal';
  modal.innerHTML = `
    <div id="lumied-ref-box" style="position:relative;">
      <button class="lumied-close" onclick="document.getElementById('lumied-ref-modal').classList.remove('on')">&times;</button>
      <h3>💜 Programa de indicação Lumied</h3>
      <p>Conhece outra escola que se beneficiaria do Lumied? Compartilhe seu link único. Se a escola fechar:</p>
      <ul>
        <li>🎁 <b>1 mês grátis</b> para a sua escola</li>
        <li>🎁 <b>5% de desconto</b> para a escola indicada</li>
        <li>💰 <b>R$ 500</b> em bônus para a top parceira do trimestre</li>
      </ul>
      <p style="font-weight:600;color:#4c2a7a;">Seu link personalizado:</p>
      <div class="lumied-link-box" id="lumied-ref-link">${urlIndicacao}</div>
      <div id="lumied-ref-copied">✓ Copiado!</div>
      <div class="lumied-actions">
        <button class="lumied-btn-primary" onclick="navigator.clipboard.writeText('${urlIndicacao}').then(()=>{document.getElementById('lumied-ref-copied').classList.add('on');setTimeout(()=>document.getElementById('lumied-ref-copied').classList.remove('on'),2000);})">📋 Copiar link</button>
        <button class="lumied-btn-secondary" onclick="window.open('https://wa.me/?text=' + encodeURIComponent('Oi! Conheci a Lumied e acho que pode te ajudar muito na gestão da escola. Dá uma olhada: ${urlIndicacao}'), '_blank')">💬 WhatsApp</button>
        <button class="lumied-btn-secondary" onclick="window.open('mailto:?subject=' + encodeURIComponent('Conheça a Lumied') + '&body=' + encodeURIComponent('Oi! Conheci a Lumied e acho que pode te ajudar na gestão da escola. Link: ${urlIndicacao}'), '_blank')">📧 E-mail</button>
        <button class="lumied-btn-text" onclick="localStorage.setItem('lumied_ref_dismissed','true');document.getElementById('lumied-ref-modal').classList.remove('on');document.getElementById('lumied-ref-btn').style.display='none';">Não mostrar mais</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  function openModal() {
    modal.classList.add('on');
  }

  // Fechar clicando no overlay
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('on');
  });
})();
