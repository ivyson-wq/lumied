/**
 * Lumied Voice — Web Speech API commands for teachers
 * Wake word: "Lumi" (detected case-insensitively at start of transcript)
 *
 * Commands (after wake word):
 *   "registra falta do [nome]"     → mark absence via API
 *   "agenda [texto]"               → create agenda entry
 *   "chamada [serie]"              → open attendance panel
 *   "buscar [nome]"                → open Ctrl+K pre-filled
 *   "notas de [nome]"              → navigate to student grades
 */

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let _recognition = null;
let _listening = false;
let _pill = null;

function normalize(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function createPill() {
  if (_pill) return _pill;

  const pill = document.createElement('div');
  pill.id = 'lumiVoicePill';
  pill.style.cssText = [
    'position:fixed',
    'bottom:80px',
    'left:16px',
    'z-index:99990',
    'display:flex',
    'align-items:center',
    'gap:6px',
    'background:rgba(26,26,26,.88)',
    'color:#fff',
    'padding:8px 14px 8px 10px',
    'border-radius:999px',
    'font-family:"DM Sans",system-ui,sans-serif',
    'font-size:12px',
    'font-weight:600',
    'box-shadow:0 4px 16px rgba(0,0,0,.35)',
    'transition:background .25s,transform .2s',
    'cursor:pointer',
    'user-select:none',
    'backdrop-filter:blur(8px)',
    '-webkit-backdrop-filter:blur(8px)',
  ].join(';');

  pill.innerHTML = `
    <span id="lumiVoiceDot" style="width:8px;height:8px;border-radius:50%;background:#aaa;flex-shrink:0;transition:background .25s;"></span>
    <span id="lumiVoiceLabel">Lumi — aguardando</span>
  `;
  pill.addEventListener('click', () => toggle());
  document.body.appendChild(pill);
  _pill = pill;
  return pill;
}

function setPillState(state) {
  const dot = document.getElementById('lumiVoiceDot');
  const label = document.getElementById('lumiVoiceLabel');
  if (!dot || !label) return;

  if (state === 'idle') {
    dot.style.background = '#aaa';
    dot.style.animation = '';
    label.textContent = 'Lumi — aguardando';
    if (_pill) _pill.style.background = 'rgba(26,26,26,.88)';
  } else if (state === 'listening') {
    dot.style.background = '#4caf50';
    dot.style.animation = 'lumiPulse 1.2s ease infinite';
    label.textContent = 'Lumi ouvindo...';
    if (_pill) _pill.style.background = 'rgba(26,26,26,.88)';
  } else if (state === 'processing') {
    dot.style.background = '#C8102E';
    dot.style.animation = 'lumiPulse .5s ease infinite';
    label.textContent = 'Processando...';
    if (_pill) _pill.style.background = 'rgba(180,10,30,.9)';
  }
}

function injectStyles() {
  if (document.getElementById('lumiVoiceStyles')) return;
  const style = document.createElement('style');
  style.id = 'lumiVoiceStyles';
  style.textContent = `
    @keyframes lumiPulse {
      0%,100% { transform:scale(1); opacity:1; }
      50% { transform:scale(1.5); opacity:.6; }
    }
    #lumiVoicePill:hover { transform:translateY(-2px); }
  `;
  document.head.appendChild(style);
}

function toast(msg, type = 'info') {
  if (typeof window.showToast === 'function') window.showToast(msg, type, 4000);
}

async function handleCommand(raw) {
  setPillState('processing');

  const n = normalize(raw);

  // "registra falta do [nome]" / "registra falta [nome]"
  const faltaMatch = n.match(/^registra\s+falta\s+(?:do?|da)\s+(.+)$/);
  if (faltaMatch) {
    const nome = faltaMatch[1].trim();
    toast(`🎤 Registrando falta: ${nome}...`, 'info');
    try {
      const api = window.__api;
      if (api?.diplomas) {
        await api.diplomas({ action: 'prof_marcar_falta', aluno_nome: nome });
        toast(`✓ Falta registrada para ${nome}`, 'success');
      } else {
        toast(`Falta de "${nome}" anotada (API indisponível)`, 'warning');
      }
    } catch (e) {
      toast(`Erro ao registrar falta: ${e.message || e}`, 'error');
    }
    setPillState('listening');
    return;
  }

  // "agenda [texto]"
  const agendaMatch = n.match(/^agenda[:\s]+(.+)$/);
  if (agendaMatch) {
    const texto = raw.replace(/^[Ll]umi[,\s]*/i, '').replace(/^agenda[:\s]*/i, '').trim();
    toast(`🎤 Criando agenda: ${texto}`, 'info');
    try {
      const api = window.__api;
      if (api?.diplomas) {
        await api.diplomas({ action: 'agenda_enviar', texto });
        toast('✓ Entrada de agenda criada', 'success');
      } else {
        toast(`Agenda "${texto}" anotada (API indisponível)`, 'warning');
      }
    } catch (e) {
      toast(`Erro ao criar agenda: ${e.message || e}`, 'error');
    }
    setPillState('listening');
    return;
  }

  // "chamada [serie]" / "chamada da turma [serie]"
  const chamadaMatch = n.match(/^chamada(?:\s+da\s+turma)?\s*(.*)$/);
  if (chamadaMatch) {
    const serie = chamadaMatch[1].trim();
    toast(`🎤 Abrindo chamada${serie ? ` — ${serie}` : ''}`, 'info');
    if (typeof window.showPanel === 'function') {
      window.showPanel('chamada');
    } else {
      const btn = document.querySelector('[onclick*="showPanel(\'chamada\'"]');
      if (btn) btn.click();
    }
    setPillState('listening');
    return;
  }

  // "buscar [nome]"
  const buscarMatch = n.match(/^buscar\s+(.+)$/);
  if (buscarMatch) {
    const nome = raw.replace(/^[Ll]umi[,\s]*/i, '').replace(/^buscar\s*/i, '').trim();
    toast(`🎤 Buscando: ${nome}`, 'info');
    if (typeof window._openCommandPalette === 'function') {
      window._openCommandPalette();
      setTimeout(() => {
        const input = document.querySelector('.cmd-input');
        if (input) {
          input.value = nome;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, 150);
    }
    setPillState('listening');
    return;
  }

  // "notas de [nome]"
  const notasMatch = n.match(/^notas\s+de\s+(.+)$/);
  if (notasMatch) {
    const nome = notasMatch[1].trim();
    toast(`🎤 Abrindo notas de ${nome}`, 'info');
    if (typeof window.showPanel === 'function') {
      window.showPanel('notas');
    } else {
      const btn = document.querySelector('[onclick*="showPanel(\'notas\'"]');
      if (btn) btn.click();
    }
    setPillState('listening');
    return;
  }

  toast(`🎤 Comando não reconhecido: "${raw}"`, 'warning');
  setPillState('listening');
}

function onResult(event) {
  for (let i = event.resultIndex; i < event.results.length; i++) {
    if (!event.results[i].isFinal) continue;
    const transcript = event.results[i][0].transcript.trim();
    const n = normalize(transcript);

    if (!n.startsWith('lumi')) continue;

    // Extract command after wake word
    const command = transcript.replace(/^lumi[,.\s]*/i, '').trim();
    if (!command) {
      toast('🎤 Lumi ouvindo — diga um comando', 'info');
      continue;
    }

    handleCommand(command);
  }
}

function startListening() {
  if (!_recognition) return;
  try {
    _recognition.start();
  } catch (_) {
    // Already started — ignore
  }
}

export function initVoice() {
  if (!SpeechRecognition) return; // Browser doesn't support it

  injectStyles();
  createPill();

  const PREF_KEY = 'lumied_voice_enabled';
  const savedPref = localStorage.getItem(PREF_KEY);
  // Default off; user must opt-in via mic button click
  let enabled = savedPref === '1';

  _recognition = new SpeechRecognition();
  _recognition.lang = 'pt-BR';
  _recognition.continuous = true;
  _recognition.interimResults = false;
  _recognition.maxAlternatives = 1;

  _recognition.onresult = onResult;

  _recognition.onend = () => {
    if (_listening) {
      // Auto-restart on unexpected end
      setTimeout(() => {
        if (_listening) startListening();
      }, 500);
    }
  };

  _recognition.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      toast('Microfone bloqueado. Permita o acesso no navegador.', 'error');
      _listening = false;
      enabled = false;
      localStorage.setItem(PREF_KEY, '0');
      setPillState('idle');
    }
    // For 'no-speech' and 'aborted' errors, auto-restart is handled by onend
  };

  function start() {
    if (_listening) return;
    _listening = true;
    enabled = true;
    localStorage.setItem(PREF_KEY, '1');
    setPillState('listening');
    startListening();
    if (typeof window.__voiceOnChange === 'function') window.__voiceOnChange(true);
  }

  function stop() {
    if (!_listening) return;
    _listening = false;
    enabled = false;
    localStorage.setItem(PREF_KEY, '0');
    setPillState('idle');
    try { _recognition.stop(); } catch (_) {}
    if (typeof window.__voiceOnChange === 'function') window.__voiceOnChange(false);
  }

  function toggle() {
    _listening ? stop() : start();
  }

  window.__voice = { start, stop, toggle, isListening: () => _listening };

  // Restore preference
  if (enabled) start();
}
