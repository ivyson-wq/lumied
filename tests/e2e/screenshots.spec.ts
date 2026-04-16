import { test, Page, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Captura screenshots da escola Demo Lumied para usar na Central de Ajuda.
 *
 * Requer env vars (secrets no CI):
 *   DEMO_URL       (ex: https://demo.lumied.com.br)
 *   DEMO_EMAIL     (ex: demo@lumied.com.br)
 *   DEMO_PASSWORD  (ex: LumiedDemo2026!)
 *
 * Output: site/screenshots/ajuda/<nome>.png
 */

const DEMO_URL = process.env.DEMO_URL || 'https://demo.lumied.com.br';
const DEMO_EMAIL = process.env.DEMO_EMAIL || 'demo@lumied.com.br';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'LumiedDemo2026!';
const OUT_DIR = path.join(process.cwd(), 'site', 'screenshots', 'ajuda');

// Garantir pasta de saída
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

/**
 * Instala interceptor de rede: swap de "Maple Bear" por "Demo Lumied" em
 * TODAS as respostas JSON (cobre config_publica e outras APIs). Chamar
 * UMA vez antes de page.goto().
 */
async function installNetworkRebrand(page: Page) {
  await page.route('**/functions/v1/**', async (route) => {
    const resp = await route.fetch();
    const ct = resp.headers()['content-type'] || '';
    if (!ct.includes('json')) { await route.fulfill({ response: resp }); return; }
    let body = await resp.text();
    body = body
      .replace(/Maple Bear[^"\\\\·\-\n|]*/g, 'Demo Lumied')
      .replace(/🍁/g, '')
      .replace(/maplebear[a-z]*/gi, 'lumied');
    await route.fulfill({ response: resp, body });
  });
}

/**
 * Aplica rebrand da UI: substitui "Maple Bear" por "Demo Lumied" e troca
 * as imagens de logo por /lumied-logo-branco.png. Rodado antes de cada
 * screenshot para não vazar branding de cliente nas capturas.
 */
async function applyDemoBranding(page: Page) {
  await page.evaluate(() => {
    const LUMIED_LOGO = '/lumied-logo-branco.png';
    const LUMIED_LOGO_DARK = '/lumied-logo-preto.png';

    // Substituições textuais
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent || '';
        if (t.includes('Maple Bear')) {
          node.textContent = t.replace(/Maple Bear[^·\-\n|]*/g, 'Demo Lumied').replace(/🍁/g, '');
        }
      } else {
        node.childNodes.forEach(walk);
      }
    };
    walk(document.body);

    // Título da aba
    document.title = document.title.replace(/Maple Bear[^—\-|]*/gi, 'Lumied');

    // Trocar imagens cujo alt/src menciona Maple Bear
    document.querySelectorAll('img').forEach((img) => {
      const alt = (img.getAttribute('alt') || '').toLowerCase();
      const src = img.getAttribute('src') || '';
      if (alt.includes('maple') || src.includes('Design%20sem%20nome') || src.includes('maple')) {
        img.src = LUMIED_LOGO_DARK;
        img.alt = 'Lumied';
      }
    });

    // Heading H1 e brand name do login (IDs conhecidos)
    const brand = document.getElementById('loginBrandName');
    if (brand) brand.textContent = 'Demo Lumied';
    document.querySelectorAll('h1, h2, h3, h4').forEach(h => {
      if ((h.textContent || '').match(/Maple Bear/i)) h.textContent = h.textContent!.replace(/Maple Bear[^·\-\n|]*/gi, 'Demo Lumied');
    });

    // Atributos comuns (placeholder, title, aria-label, value em inputs)
    document.querySelectorAll<HTMLElement>('[placeholder], [title], [aria-label]').forEach(el => {
      ['placeholder', 'title', 'aria-label'].forEach(attr => {
        const v = el.getAttribute(attr);
        if (v && /Maple Bear/i.test(v)) el.setAttribute(attr, v.replace(/Maple Bear[^·\-\n|]*/gi, 'Demo Lumied'));
      });
    });
    document.querySelectorAll<HTMLInputElement>('input[value], input[type="hidden"]').forEach(inp => {
      if (/Maple Bear/i.test(inp.value)) inp.value = inp.value.replace(/Maple Bear[^·\-\n|]*/gi, 'Demo Lumied');
    });
  });
}

async function loginGerente(page: Page) {
  await installNetworkRebrand(page);
  await page.goto(`${DEMO_URL}/gerente.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginEmail', { timeout: 15000 });
  await page.fill('#loginEmail', DEMO_EMAIL);
  await page.fill('#loginPass', DEMO_PASSWORD);
  await page.click('#loginBtn');
  // Espera sidebar aparecer (logado)
  await page.waitForSelector('#appShell .sidebar', { state: 'visible', timeout: 20000 });
  await page.waitForTimeout(1500); // dashboard carrega dados
  await applyDemoBranding(page);
}

async function snap(page: Page, panel: string, filename: string, opts: { selector?: string; fullPage?: boolean } = {}) {
  // Alterna o painel usando a função interna do app
  await page.evaluate((p) => (window as any).showPanel && (window as any).showPanel(p), panel);
  await page.waitForTimeout(2000); // espera dados renderizarem
  await applyDemoBranding(page); // re-aplica rebrand (se painel recriar DOM)

  const outPath = path.join(OUT_DIR, filename);
  if (opts.selector) {
    const el = await page.$(opts.selector);
    if (el) {
      await el.screenshot({ path: outPath });
      console.log(`✓ ${filename} (seletor ${opts.selector})`);
      return;
    }
  }
  // Full viewport por padrão (com sidebar para contexto)
  await page.screenshot({ path: outPath, fullPage: opts.fullPage ?? false });
  console.log(`✓ ${filename}`);
}

test.describe.configure({ mode: 'serial' });

test.describe('Screenshots Central de Ajuda — Portal do Gerente', () => {
  test.setTimeout(120000);

  test('captura painéis principais', async ({ page }) => {
    page.setViewportSize({ width: 1440, height: 900 });
    await loginGerente(page);

    const panels: Array<[string, string]> = [
      ['analytics',      'gerente-dashboard.png'],
      ['alunos',         'gerente-alunos.png'],
      ['notasVisao',     'gerente-notas.png'],
      ['frequencia',     'gerente-frequencia.png'],
      ['calendario',     'gerente-calendario.png'],
      ['series',         'gerente-series.png'],
      ['chatConversas',  'gerente-comunicacao.png'],
      ['almDash',        'gerente-almox-dash.png'],
      ['almPend',        'gerente-almox-pendentes.png'],
      ['almTodas',       'gerente-almox-requisicoes.png'],
      ['almInsumos',     'gerente-almox-insumos.png'],
      ['almCompras',     'gerente-almox-compras.png'],
      ['almTurmas',      'gerente-almox-turmas.png'],
      ['almOrc',         'gerente-almox-orcamentos.png'],
    ];

    for (const [panel, filename] of panels) {
      try { await snap(page, panel, filename); }
      catch (e) { console.warn(`⚠ Falha em ${panel}: ${(e as Error).message}`); }
    }
  });

  test('captura painéis financeiros', async ({ page }) => {
    page.setViewportSize({ width: 1440, height: 900 });
    await loginGerente(page);

    const panels: Array<[string, string]> = [
      ['finDash',          'gerente-fin-dash.png'],
      ['finMensalidades',  'gerente-fin-mensalidades.png'],
      ['finInadimplencia', 'gerente-fin-inadimplencia.png'],
      ['finBoletos',       'gerente-fin-boletos.png'],
      ['finRegua',         'gerente-fin-regua.png'],
    ];

    for (const [panel, filename] of panels) {
      try { await snap(page, panel, filename); }
      catch (e) { console.warn(`⚠ Falha em ${panel}: ${(e as Error).message}`); }
    }
  });

  test('captura CRM e Equipe', async ({ page }) => {
    page.setViewportSize({ width: 1440, height: 900 });
    await loginGerente(page);

    const panels: Array<[string, string]> = [
      ['crmDash',    'gerente-crm.png'],
      ['crmLeads',   'gerente-crm-leads.png'],
      ['crmKanban',  'gerente-crm-kanban.png'],
      ['crmContratos','gerente-crm-contratos.png'],
      ['equipe',     'gerente-equipe.png'],
    ];

    for (const [panel, filename] of panels) {
      try { await snap(page, panel, filename); }
      catch (e) { console.warn(`⚠ Falha em ${panel}: ${(e as Error).message}`); }
    }
  });

  test('captura telas de login e inicial', async ({ page }) => {
    page.setViewportSize({ width: 1440, height: 900 });
    await installNetworkRebrand(page);
    await page.goto(`${DEMO_URL}/gerente.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loginEmail', { timeout: 15000 });
    await applyDemoBranding(page);
    await page.screenshot({ path: path.join(OUT_DIR, 'gerente-login.png') });
    console.log('✓ gerente-login.png');

    // Portal dos pais — landing page pública
    await page.goto(`${DEMO_URL}/familia.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await applyDemoBranding(page);
    await page.screenshot({ path: path.join(OUT_DIR, 'pais-login.png') });
    console.log('✓ pais-login.png');

    // Hub (area-restrita)
    await page.goto(`${DEMO_URL}/area-restrita.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await applyDemoBranding(page);
    await page.screenshot({ path: path.join(OUT_DIR, 'area-restrita.png') });
    console.log('✓ area-restrita.png');
  });
});
