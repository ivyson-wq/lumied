/**
 * Lumied Utils — utilitários comuns consolidados.
 *
 * Antes da Onda 1 de refator (2026-05-14), cada portal HTML reimplementava
 * `esc`, `fmtDate`, `fmtMoney`, etc. inline. Esse módulo centraliza tudo
 * e o portal-init expõe via `window.__utils.*` pra inline scripts consumirem.
 */

// ── HTML escape ─────────────────────────────────────────────────
// Usa textContent → innerHTML do browser pra cobrir todos os edge cases
// (incluindo entidades raras). Aceita null/undefined silenciosamente.
export function esc(s) {
  if (s === null || s === undefined) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

// ── Datas ───────────────────────────────────────────────────────
// Aceita: ISO date (yyyy-mm-dd), ISO datetime, Date, timestamp ms, ou null.
// Retorna '—' pra valores vazios — não 'Invalid Date' nem string vazia.
export function fmtDate(d) {
  if (!d) return '—';
  // Caso simples e mais rápido: ISO date string yyyy-mm-dd
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) {
    const [y, m, day] = d.slice(0, 10).split('-');
    return `${day}/${m}/${y}`;
  }
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('pt-BR');
}

export function fmtDateTime(d) {
  if (!d) return '—';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('pt-BR') + ' ' +
    dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Tempo relativo (ex: "há 3 min", "ontem", "há 5 dias"). Útil em feeds.
export function relTime(d) {
  if (!d) return '—';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '—';
  const diff = (Date.now() - dt.getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 2) return 'ontem';
  if (diff < 86400 * 7) return `há ${Math.floor(diff / 86400)} dias`;
  return fmtDate(dt);
}

// ── Moeda ───────────────────────────────────────────────────────
export function fmtMoney(v, opts = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return opts.fallback ?? 'R$ 0,00';
  return n.toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: opts.cents === false ? 0 : 2,
    maximumFractionDigits: opts.cents === false ? 0 : 2,
  });
}

// ── Números & porcentagem ──────────────────────────────────────
export function fmtNumber(v, digits = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPercent(v, digits = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + '%';
}

// ── CPF / CNPJ formatação (display only — validação está no edge) ─
export function fmtCpfCnpj(v) {
  if (!v) return '';
  const s = String(v).replace(/\D/g, '');
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v;
}

export function fmtPhone(v) {
  if (!v) return '';
  const s = String(v).replace(/\D/g, '');
  if (s.length === 11) return s.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (s.length === 10) return s.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return v;
}

// ── Slug ────────────────────────────────────────────────────────
export function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ── Debounce / throttle ─────────────────────────────────────────
export function debounce(fn, ms = 300) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

export function throttle(fn, ms = 300) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn.apply(this, args); }
  };
}

// ── Clipboard ───────────────────────────────────────────────────
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(String(text || ''));
    return true;
  } catch {
    // Fallback (Safari iOS sem permissão)
    const ta = document.createElement('textarea');
    ta.value = String(text || ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
}

// ── Bag de utils pra bind em window.__utils ─────────────────────
export const utils = {
  esc,
  fmtDate, fmtDateTime, relTime,
  fmtMoney, fmtNumber, fmtPercent,
  fmtCpfCnpj, fmtPhone,
  slugify, debounce, throttle, copyToClipboard,
};
