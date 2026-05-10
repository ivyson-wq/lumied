/**
 * Screen recorder: captures real Lumied demo screens as video clips.
 * Logs in ONCE, then navigates panels and captures clips from each.
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

// Clean old screen recordings
readdirSync(OUT).filter(f => f.startsWith('screen-')).forEach(f => unlinkSync(join(OUT, f)));

const PANELS = [
  { name: 'dashboard', panel: null, duration: 6000 },
  { name: 'financeiro', panel: 'finMens', duration: 5000 },
  { name: 'crm', panel: 'crmPipeline', duration: 5000 },
  { name: 'alunos', panel: 'alunos', duration: 5000 },
  { name: 'ponto', panel: 'pontoSetup', duration: 5000 },
];

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });

  // Step 1: Login once in a persistent context, save cookies
  console.log('Logging in...');
  const loginCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const loginPage = await loginCtx.newPage();

  await loginPage.goto(`${BASE}/gerente.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await loginPage.waitForTimeout(1000);

  const emailInput = await loginPage.$('input[type="email"]') || await loginPage.$('#email');
  const senhaInput = await loginPage.$('input[type="password"]') || await loginPage.$('#senha');
  if (emailInput && senhaInput) {
    await emailInput.fill(EMAIL);
    await senhaInput.fill(SENHA);
    const loginBtn = await loginPage.$('button[type="submit"]') || await loginPage.$('.btn-login');
    if (loginBtn) await loginBtn.click();
  }
  await loginPage.waitForTimeout(4000);

  // Get cookies and localStorage after login
  const cookies = await loginCtx.cookies();
  const storage = await loginPage.evaluate(() => {
    const items = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      items[key] = localStorage.getItem(key);
    }
    return items;
  });
  console.log(`  Logged in. Cookies: ${cookies.length}, localStorage keys: ${Object.keys(storage).length}`);
  await loginCtx.close();

  // Step 2: Record each panel in a fresh context (pre-authenticated)
  for (const p of PANELS) {
    console.log(`  Recording ${p.name}...`);

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
    });

    // Restore cookies
    await context.addCookies(cookies);

    const page = await context.newPage();

    // Restore localStorage before navigation
    await page.addInitScript((storageItems) => {
      for (const [key, value] of Object.entries(storageItems)) {
        try { localStorage.setItem(key, value); } catch {}
      }
    }, storage);

    try {
      await page.goto(`${BASE}/gerente.html`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Dismiss onboarding wizard if present
      await page.evaluate(() => {
        localStorage.setItem('onboarding_done', '1');
        localStorage.setItem('lumied_wizard_done', '1');
        const overlay = document.querySelector('.wizard-overlay, .onboarding-overlay, [id*="wizard"]');
        if (overlay) overlay.style.display = 'none';
        // Close any modal
        document.querySelectorAll('.modal-overlay, .wizard-overlay').forEach(m => m.remove());
      });
      await page.waitForTimeout(500);

      // Navigate to panel
      if (p.panel) {
        await page.evaluate((pid) => {
          if (typeof showPanel === 'function') showPanel(pid);
        }, p.panel);
        await page.waitForTimeout(1500);
      }

      // Smooth scroll for visual interest
      await page.evaluate(async () => {
        const main = document.querySelector('.main-content') || document.querySelector('main') || document.body;
        for (let i = 0; i < 250; i += 2) {
          main.scrollTop = i;
          await new Promise(r => setTimeout(r, 25));
        }
      });

      await page.waitForTimeout(p.duration);
    } catch (e) {
      console.log(`    Warning: ${e.message.substring(0, 80)}`);
    }

    await context.close();

    // Rename latest webm
    const webms = readdirSync(OUT)
      .filter(f => f.endsWith('.webm') && !f.startsWith('screen-'))
      .map(f => ({ name: f, mtime: statSync(join(OUT, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    if (webms.length > 0) {
      const target = `screen-${p.name}.webm`;
      try {
        renameSync(join(OUT, webms[0].name), join(OUT, target));
        const size = (statSync(join(OUT, target)).size / 1024).toFixed(0);
        console.log(`    Saved: clips/${target} (${size} KB)`);
      } catch (e) {
        console.log(`    Rename failed: ${e.message}`);
      }
    }
  }

  await browser.close();

  console.log('\nAll clips recorded:');
  readdirSync(OUT)
    .filter(f => f.startsWith('screen-'))
    .forEach(f => console.log(`  ${f} (${(statSync(join(OUT, f)).size / 1024).toFixed(0)} KB)`));
}

main().catch(console.error);
