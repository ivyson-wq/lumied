const API_URL = window.LUMIED_CONFIG.API_URL;
const API_KEY = window.LUMIED_CONFIG.ANON_KEY;

const $ = id => document.getElementById(id);

async function apiCall(action, params) {
  const res = await fetch(API_URL + '/functions/v1/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': API_KEY, 'Authorization': 'Bearer ' + API_KEY },
    body: JSON.stringify(Object.assign({ action }, params || {})),
  });
  return res.json();
}

function showView(view) {
  $('viewLogin').classList.toggle('hidden', view !== 'login');
  $('viewConnected').classList.toggle('hidden', view !== 'connected');
}

function setStatus(msg, type) {
  var el = $('status');
  el.textContent = msg;
  el.className = 'status' + (type ? ' ' + type : '');
}

// Check existing session on open
chrome.storage.local.get(['token', 'userName', 'userEmail'], function(d) {
  if (d.token) {
    showView('connected');
    $('userName').textContent = d.userName || '\u2014';
    $('userEmail').textContent = d.userEmail || '\u2014';
    setStatus('Conectado ao CRM', 'connected');
    apiCall('config_publica').then(function(cfg) {
      if (cfg.escola_nome) {
        $('userEscola').textContent = cfg.escola_nome;
        $('extTitle').textContent = cfg.escola_nome + ' CRM';
      }
    }).catch(function() {});
  } else {
    showView('login');
  }
});

// Login
$('btnLogin').addEventListener('click', function() {
  var email = $('loginEmail').value.trim();
  var senha = $('loginSenha').value;
  if (!email || !senha) { setStatus('Preencha e-mail e senha.', 'error'); return; }

  var btn = $('btnLogin');
  btn.disabled = true;
  btn.textContent = 'Entrando...';
  setStatus('Autenticando...', '');

  apiCall('login', { email: email, senha: senha }).then(function(d) {
    if (d.error) {
      setStatus(d.error, 'error');
      btn.disabled = false;
      btn.textContent = 'Entrar';
      return;
    }
    chrome.storage.local.set({
      token: d.token,
      userName: d.nome,
      userEmail: d.email,
    }, function() {
      showView('connected');
      $('userName').textContent = d.nome || '\u2014';
      $('userEmail').textContent = d.email || '\u2014';
      setStatus('Conectado ao CRM', 'connected');
      btn.disabled = false;
      btn.textContent = 'Entrar';
    });
  }).catch(function() {
    setStatus('Erro de conexao. Tente novamente.', 'error');
    btn.disabled = false;
    btn.textContent = 'Entrar';
  });
});

// Enter key submits login
$('loginEmail').addEventListener('keydown', function(e) { if (e.key === 'Enter') $('btnLogin').click(); });
$('loginSenha').addEventListener('keydown', function(e) { if (e.key === 'Enter') $('btnLogin').click(); });

// Open CRM panel
$('btnOpenCrm').addEventListener('click', function() {
  chrome.tabs.create({ url: chrome.runtime.getURL('crm.html') });
});

// Logout
$('btnLogout').addEventListener('click', function() {
  chrome.storage.local.get(['token'], function(config) {
    if (config.token) {
      apiCall('logout', { _token: config.token }).catch(function() {});
    }
    chrome.storage.local.remove(['token', 'userName', 'userEmail'], function() {
      showView('login');
      $('loginEmail').value = '';
      $('loginSenha').value = '';
      $('extTitle').textContent = 'Lumied CRM';
      setStatus('Faca login para conectar ao CRM', '');
    });
  });
});
