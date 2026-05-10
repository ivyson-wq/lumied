/**
 * Screen recorder v4: Captures real feature screens with visible data.
 * Each clip shows the actual panel matching the video narration scene.
 *
 * Usage: node scripts/video-demo/record-screens-simple.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync, renameSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';

const BASE = 'https://demo.lumied.com.br';
const EMAIL = 'demo@lumied.com.br';
const SENHA = 'LumiedDemo2026!';
const OUT = join(process.cwd(), 'clips');

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
readdirSync(OUT).filter(f => f.startsWith('screen-')).forEach(f => unlinkSync(join(OUT, f)));

// Each panel maps to a video scene with specific interactions
const PANELS = [
  {
    name: 'dashboard',
    desc: 'Scene 3: Dashboard gerente com KPIs',
    panel: null, // default panel after login
    duration: 8000,
    interactions: async (page) => {
      // Just let the dashboard load and show KPIs
      await page.waitForTimeout(2000);
      await smoothScroll(page, 300, 'down');
      await page.waitForTimeout(2000);
      await smoothScroll(page, 300, 'up');
    }
  },
  {
    name: 'financeiro',
    desc: 'Scene 4: Financeiro com mensalidades e cobranças',
    panel: 'finMens',
    duration: 8000,
    interactions: async (page) => {
      await page.waitForTimeout(2000);
      await smoothScroll(page, 400, 'down');
      await page.waitForTimeout(3000);
      await smoothScroll(page, 400, 'up');
    }
  },
  {
    name: 'crm',
    desc: 'Scene: CRM Pipeline Kanban',
    panel: 'crmKanban',
    duration: 7000,
    interactions: async (page) => {
      await page.waitForTimeout(2000);
      // Try to click on a kanban card if exists
      await page.evaluate(() => {
        const card = document.querySelector('.kanban-card, .pipeline-card, [class*="kanban"]');
        if (card) card.click();
      });
      await page.waitForTimeout(2000);
      await smoothScroll(page, 200, 'down');
    }
  },
  {
    name: 'alunos',
    desc: 'Scene: Lista de alunos com dados',
    panel: 'alunos',
    duration: 7000,
    interactions: async (page) => {
      await page.waitForTimeout(2000);
      await smoothScroll(page, 500, 'down');
      await page.waitForTimeout(2000);
      await smoothScroll(page, 500, 'up');
    }
  },
  {
    name: 'ponto',
    desc: 'Scene 7: Setup Ponto CLT',
    panel: 'pontoDash',
    duration: 7000,
    interactions: async (page) => {
      await page.waitForTimeout(2000);
      await smoothScroll(page, 400, 'down');
      await page.waitForTimeout(2000);
    }
  },
  {
    name: 'acesso',
    desc: 'Scene 6: Controle de Acesso / Face ID',
    panel: 'acessoSetup',
    duration: 7000,
    interactions: async (page) => {
      await page.waitForTimeout(2000);
      await smoothScroll(page, 300, 'down');
      await page.waitForTimeout(2000);
    }
  },
  {
    name: 'inadimplencia',
    desc: 'Scene: Almoxarifado dashboard',
    panel: 'finInadimplencia',
    duration: 6000,
    interactions: async (page) => {
      await page.waitForTimeout(2000);
      await smoothScroll(page, 300, 'down');
    }
  },
];

async function smoothScroll(page, distance, direction = 'down') {
  await page.evaluate(async ({ dist, dir }) => {
    const el = document.querySelector('.main-content') || document.querySelector('main') || document.body;
    const start = el.scrollTop;
    const target = dir === 'down' ? start + dist : Math.max(0, start - dist);
    const steps = 60;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // easeInOut
      el.scrollTop = start + (target - start) * ease;
      await new Promise(r => setTimeout(r, 16));
    }
  }, { dist: distance, dir: direction });
}

async function recordPanel(browser, loggedInStorage, panel) {
  console.log(`  [${panel.name}] ${panel.desc}`);

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
  });

  await context.addInitScript((items) => {
    for (const [k, v] of Object.entries(items)) {
      try { localStorage.setItem(k, v); } catch {}
    }
    localStorage.setItem('onboarding_done', '1');
    localStorage.setItem('lumied_wizard_done', '1');
  }, loggedInStorage);

  const page = await context.newPage();
  await page.goto(`${BASE}/gerente.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);

  // If still on login, login again
  const needsLogin = await page.evaluate(() => {
    const el = document.querySelector('#loginForm, .login-box');
    return el && el.offsetParent !== null;
  });

  if (needsLogin) {
    console.log('    -> Logging in...');
    await page.fill('input[type="email"]', EMAIL).catch(() => {});
    await page.fill('input[type="password"]', SENHA).catch(() => {});
    await page.click('button[type="submit"]').catch(() => {});
    await page.waitForTimeout(3500);

    // Update storage for next panels
    const updated = await page.evaluate(() => {
      const items = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        items[k] = localStorage.getItem(k);
      }
      return items;
    });
    Object.assign(loggedInStorage, updated);
  }

  // Remove any overlays/wizards
  await page.evaluate(() => {
    document.querySelectorAll('[class*="wizard"], [class*="overlay"], [class*="onboarding"]')
      .forEach(el => { if (el.style) el.style.display = 'none'; });
  });

  // Navigate to target panel
  if (panel.panel) {
    await page.evaluate((pid) => {
      if (typeof showPanel === 'function') showPanel(pid);
    }, panel.panel);
    await page.waitForTimeout(1500);
  }

  // Run panel-specific interactions
  try {
    await panel.interactions(page);
  } catch (e) {
    console.log(`    Interaction warning: ${e.message.substring(0, 60)}`);
  }

  await page.waitForTimeout(1000);
  await context.close();

  // Rename latest webm
  const webms = readdirSync(OUT)
    .filter(f => f.endsWith('.webm') && !f.startsWith('screen-'))
    .map(f => ({ name: f, mtime: statSync(join(OUT, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (webms.length > 0) {
    const target = `screen-${panel.name}.webm`;
    try {
      renameSync(join(OUT, webms[0].name), join(OUT, target));
      const kb = (statSync(join(OUT, target)).size / 1024).toFixed(0);
      console.log(`    -> ${target} (${kb} KB)`);
    } catch (e) {
      console.log(`    Error: ${e.message}`);
    }
  }
}

async function main() {
  console.log('=== Lumied Screen Recorder v4 ===\n');
  const browser = await chromium.launch({ headless: true });

  // Pre-login
  console.log('Pre-login...');
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const pg = await ctx.newPage();
  await pg.goto(`${BASE}/gerente.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await pg.waitForTimeout(1000);
  await pg.fill('input[type="email"]', EMAIL).catch(() => {});
  await pg.fill('input[type="password"]', SENHA).catch(() => {});
  await pg.click('button[type="submit"]').catch(() => {});
  await pg.waitForTimeout(4000);

  const loggedInStorage = await pg.evaluate(() => {
    const items = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      items[k] = localStorage.getItem(k);
    }
    return items;
  });
  console.log(`  Auth keys: ${Object.keys(loggedInStorage).join(', ')}\n`);
  await ctx.close();

  // Record each panel
  for (const panel of PANELS) {
    await recordPanel(browser, loggedInStorage, panel);
  }

  await browser.close();

  console.log('\n=== All clips ===');
  readdirSync(OUT)
    .filter(f => f.startsWith('screen-'))
    .sort()
    .forEach(f => console.log(`  ${f} (${(statSync(join(OUT, f)).size / 1024).toFixed(0)} KB)`));
}

main().catch(console.error);
