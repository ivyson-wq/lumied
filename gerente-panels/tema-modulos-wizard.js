// Auto-extraído do gerente.html (Onda 4 — batch final).
// LOGO + Módulos habilitados (feature gating) + Tema visual + Wizard de primeiro acesso
  // ── LOGO ──────────────────────────────────────────────
  // ── Módulos habilitados (feature gating) ──
  window._enabledModules = null;
  async function loadModulosHabilitados() {
    try {
      const d = await api({ action: 'modulos_habilitados' });
      if (d && Array.isArray(d.modulos)) {
        window._enabledModules = new Set(d.modulos);
        applyModuleGating();
      }
    } catch(e) { console.warn('Feature gating não disponível:', e); }
  }
  function applyModuleGating() {
    if (!window._enabledModules) return;
    document.querySelectorAll('[data-modulo]').forEach(el => {
      const mod = el.dataset.modulo;
      el.style.display = window._enabledModules.has(mod) ? '' : 'none';
    });
    // Esconde label de grupo quando todos os nav-items da section estão ocultos
    document.querySelectorAll('.sb-nav .sb-label').forEach(label => {
      const sect = label.nextElementSibling;
      if (!sect || !sect.classList.contains('sb-section')) return;
      const items = sect.querySelectorAll('.nav-item');
      const hasVisible = Array.from(items).some(it => {
        if (it.style.display === 'none') return false;
        let p = it.parentElement;
        while (p && p !== sect) { if (p.style.display === 'none') return false; p = p.parentElement; }
        return true;
      });
      label.style.display = hasVisible ? '' : 'none';
    });
  }
  function applyRoleGating() {
    var papeis = window._userPapeis || ['gerente'];
    document.querySelectorAll('[data-papel]').forEach(function(el) {
      var required = el.dataset.papel.split(',');
      el.style.display = required.some(function(r) { return papeis.includes(r); }) ? '' : 'none';
    });
  }

  // ── Tema visual da escola ──
  async function loadTemaEscola() {
    try {
      const d = await api({ action: 'modulos_habilitados' });
      if (d && d.tema) {
        document.body.className = document.body.className.replace(/theme-\w+/g, '');
        document.body.classList.add('theme-' + d.tema);
        localStorage.setItem('mb_tema', d.tema);
      }
    } catch(e) {
      // Fallback: usar tema salvo localmente
      const tema = localStorage.getItem('mb_tema');
      if (tema) document.body.classList.add('theme-' + tema);
    }
  }

  // ── Wizard de primeiro acesso (multi-step) ──
  async function checkPrimeiroAcesso() {
    if (localStorage.getItem('onboarding_done')) return;
    // Verificar se há alunos cadastrados
    const alunos = await api({ action: 'alunos_list' });
    const total = Array.isArray(alunos) ? alunos.length : (alunos?.data?.length || 0);
    if (total > 0) { localStorage.setItem('onboarding_done', '1'); return; }
    // Carregar nome da escola para o wizard
    const nomeResp = await api({ action:'config_get', chave:'escola_nome' }).catch(()=>null);
    const escolaNomeWiz = nomeResp?.valor ? String(nomeResp.valor).replace(/^"|"$/g, '') : 'sua escola';
    setTimeout(() => mostrarWizard(escolaNomeWiz), 1500);
  }

  function mostrarWizard(escolaNome) {
    let wizStep = 0;
    const steps = [
      { icon: '🎉', title: 'Bem-vindo ao Lumied!', desc: `<strong>${escolaNome}</strong> está pronta para uso.`, btnLabel: null, btnPanel: null },
      { icon: '🎓', title: 'Importe seus alunos', desc: 'Cadastre alunos individualmente ou importe em massa via planilha.', btnLabel: 'Ir para Alunos', btnPanel: 'alunos' },
      { icon: '💰', title: 'Configure o financeiro', desc: 'Defina plano de contas, mensalidades e formas de pagamento.', btnLabel: 'Ir para Financeiro', btnPanel: 'finDash' },
      { icon: '👥', title: 'Convide sua equipe', desc: 'Adicione professoras, secretaria e coordenacao ao sistema.', btnLabel: 'Ir para Equipe', btnPanel: 'equipe' },
      { icon: '🚀', title: 'Pronto!', desc: 'Sua escola esta configurada. Explore o painel e comece a usar o Lumied.', btnLabel: null, btnPanel: null }
    ];

    const overlay = document.createElement('div');
    overlay.id = 'wizardOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(3px);';

    function renderStep() {
      const s = steps[wizStep];
      const isFirst = wizStep === 0;
      const isLast = wizStep === steps.length - 1;
      const dots = steps.map((_, i) =>
        `<span style="width:${i===wizStep?'24px':'8px'};height:8px;border-radius:4px;background:${i===wizStep?'var(--red)':'#ddd'};transition:all .3s;display:inline-block;"></span>`
      ).join('');

      let actionButtons = '';
      if (isFirst) {
        actionButtons = `<button onclick="wizardNext()" style="flex:1;padding:13px;background:var(--red);color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;box-shadow:0 4px 14px rgba(200,16,46,.3);">Vamos comecar</button>`;
      } else if (isLast) {
        actionButtons = `<button onclick="wizardFinish()" style="flex:1;padding:13px;background:var(--red);color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;box-shadow:0 4px 14px rgba(200,16,46,.3);">Comecar a usar</button>`;
      } else {
        actionButtons = `
          <button onclick="wizardNext()" style="padding:13px 24px;background:#f5f5f5;border:1px solid var(--border);border-radius:10px;cursor:pointer;font-size:13px;color:var(--muted);">Pular</button>
          <button onclick="wizardGoPanel('${s.btnPanel}')" style="flex:1;padding:13px;background:var(--red);color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;box-shadow:0 4px 14px rgba(200,16,46,.3);">${s.btnLabel}</button>`;
      }

      overlay.innerHTML = `<div style="background:#fff;border-radius:16px;max-width:480px;width:100%;padding:36px 32px;box-shadow:0 24px 60px rgba(0,0,0,.25);animation:popIn .25s ease;">
        <div style="text-align:center;margin-bottom:28px;">
          <div style="font-size:52px;margin-bottom:14px;">${s.icon}</div>
          <h2 style="font-family:'Lora',serif;font-size:22px;margin-bottom:8px;color:var(--text);">${s.title}</h2>
          <p style="font-size:14px;color:var(--muted);line-height:1.6;">${s.desc}</p>
        </div>
        <div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:24px;">${dots}</div>
        <div style="display:flex;gap:10px;align-items:center;">${actionButtons}</div>
        ${!isLast ? '<button onclick="wizardSkipAll()" style="display:block;width:100%;margin-top:12px;padding:8px;background:none;border:none;cursor:pointer;font-size:12px;color:var(--muted);text-decoration:underline;">Nao mostrar novamente</button>' : ''}
      </div>`;
    }

    window.wizardNext = function() { if (wizStep < steps.length - 1) { wizStep++; renderStep(); } };
    window.wizardGoPanel = function(panel) {
      localStorage.setItem('onboarding_done', '1');
      overlay.remove();
      showPanel(panel);
    };
    window.wizardFinish = function() {
      localStorage.setItem('onboarding_done', '1');
      overlay.remove();
    };
    window.wizardSkipAll = function() {
      localStorage.setItem('onboarding_done', '1');
      overlay.remove();
    };

    renderStep();
    document.body.appendChild(overlay);
  }

  // Detecta subdomínio de demonstração (demo.lumied.com.br) — força branding Lumied
  // para não expor nome/logo da escola cujos dados seedados estão no banco global.
  const IS_DEMO_HOST = /^demo\./i.test(location.hostname);
  // Nome da escola — usado em relatórios, PDFs, Excel, WhatsApp, etc.
  let SCHOOL_NAME = IS_DEMO_HOST ? 'Demo Lumied' : 'Lumied';

  async function loadSidebarLogo() {
    if (IS_DEMO_HOST) {
      document.getElementById('sidebarLogo').style.display = 'none';
      const leaf = document.getElementById('sidebarLeaf');
      if (leaf) { leaf.src = '/lumied-logo-branco.png'; leaf.style.display = 'block'; leaf.alt = 'Lumied'; }
      document.querySelectorAll('.sb-brand h1').forEach(el => el.textContent = SCHOOL_NAME);
      document.title = SCHOOL_NAME + ' — Painel do Gerente';
      const lb = document.getElementById('loginBrandName');
      if (lb) lb.textContent = SCHOOL_NAME;
      return;
    }
    const d = await api({ action:'config_get', chave:'logo_url' });
    if(d.valor){ document.getElementById('sidebarLogo').src=d.valor; document.getElementById('sidebarLogo').style.display='block'; document.getElementById('sidebarLeaf').style.display='none'; }
    // Carregar nome da escola
    const nome = await api({ action:'config_get', chave:'escola_nome' });
    if(nome?.valor) {
      const cleanNome = String(nome.valor).replace(/^"|"$/g, '');
      SCHOOL_NAME = cleanNome;
      document.querySelectorAll('.sb-brand h1').forEach(el => el.textContent = cleanNome);
      document.title = cleanNome + ' — Painel do Gerente';
    }
  }
  // ── TEMA VISUAL ──
  async function loadTemaAtual() {
    const d = await api({ action: 'config_get', chave: 'tema_visual' });
    const tema = d?.valor || '';
    // Highlight active theme card
    document.querySelectorAll('.theme-option').forEach(el => {
      el.classList.toggle('active', el.dataset.theme === tema);
    });
    // Apply theme to body
    document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
    if (tema) document.body.classList.add(tema);
  }

  async function selecionarTema(tema, el) {
    document.querySelectorAll('.theme-option').forEach(o => o.classList.remove('active'));
    if (el) el.classList.add('active');
    await api({ action: 'config_set', chave: 'tema_visual', valor: tema });
    // Apply immediately
    document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
    if (tema) document.body.classList.add(tema);
    showToast('Tema atualizado! Os portais usarão este tema.', 'success');
  }
  window.selecionarTema = selecionarTema;

  async function loadLogoPanel() {
    loadTemaAtual();
    const d = await api({ action:'config_get', chave:'logo_url' });
    const img=document.getElementById('logoPreviewImg'), noImg=document.getElementById('logoNoImg'), removeBtn=document.getElementById('btnRemoveLogo');
    if(d.valor){ img.src=d.valor; img.style.display='block'; noImg.style.display='none'; removeBtn.style.display='block'; }
    else{ img.style.display='none'; noImg.style.display='flex'; removeBtn.style.display='none'; }
  }
  function onLogoSelected(e) {
    const file=e.target.files[0]; if(!file) return;
    if(file.size>5*1024*1024){ showToast('Máximo 5MB.','warning'); return; }
    selectedFile=file;
    document.getElementById('logoFileName').textContent='📎 '+file.name; document.getElementById('logoFileName').style.display='block';
    document.getElementById('btnUpload').disabled=false;
  }
  var uz=document.getElementById('uploadZone');
  uz?.addEventListener('dragover',e=>{e.preventDefault();uz.classList.add('drag');});
  uz?.addEventListener('dragleave',()=>uz.classList.remove('drag'));
  uz?.addEventListener('drop',e=>{e.preventDefault();uz.classList.remove('drag');const f=e.dataTransfer.files[0];if(f){const dt=new DataTransfer();dt.items.add(f);document.getElementById('logoFile').files=dt.files;onLogoSelected({target:{files:[f]}});}});

  async function uploadLogo() {
    if(!selectedFile) return;
    const btn=document.getElementById('btnUpload'), wrap=document.getElementById('uploadBarWrap'), bar=document.getElementById('uploadBar');
    btn.disabled=true; btn.textContent='Enviando…'; wrap.style.display='block'; bar.style.width='40%';
    const reader=new FileReader();
    reader.onload=async function(ev){
      const base64=ev.target.result.split(',')[1];
      bar.style.width='70%';
      const d=await api({ action:'logo_upload', base64, mime:selectedFile.type });
      bar.style.width='100%';
      if(d.error) showAlert('logo','error','Erro: '+d.error);
      else{ showAlert('logo','success','✅ Logotipo atualizado!'); loadLogoPanel(); loadSidebarLogo(); }
      btn.disabled=false; btn.textContent='Enviar Logotipo'; wrap.style.display='none'; bar.style.width='0%';
      selectedFile=null; document.getElementById('logoFileName').style.display='none'; document.getElementById('logoFile').value='';
    };
    reader.readAsDataURL(selectedFile);
  }
  async function removeLogo() {
    if(!await _lumiedConfirm('Remover logotipo?')) return;
    await api({ action:'logo_remove' });
    document.getElementById('logoPreviewImg').style.display='none'; document.getElementById('logoNoImg').style.display='flex';
    document.getElementById('btnRemoveLogo').style.display='none';
    document.getElementById('sidebarLogo').style.display='none'; document.getElementById('sidebarLeaf').style.display='block';
    showAlert('logo','success','Logotipo removido.');
  }

