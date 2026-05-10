/**
 * Simple screen recorder: captures real Lumied demo screens as video clips.
 * Uses Playwright with video recording.
 *
 * Usage: node scripts/video-demo/record-screens-simple.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync, renameSync, statSync } from 'fs';
import { join } from 'path';

const BASE = 'https://demo.lumied.com.br';
const EMAIL = 'demo@lumied.com.br';
const SENHA = 'LumiedDemo2026!';
const OUT = join(process.cwd(), 'clips');

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

async function recordPanel(browser, name, panelId, duration = 5000) {
  console.log(`  Recording ${name}...`);

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
  });

  const page = await context.newPage();

  try {
    await page.goto(`${BASE}/gerente.html`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);

    // Login
    const emailInput = await page.$('input[type="email"]') || await page.$('#email');
    const senhaInput = await page.$('input[type="password"]') || await page.$('#senha');

    if (emailInput && senhaInput) {
      await emailInput.fill(EMAIL);
      await senhaInput.fill(SENHA);
      const loginBtn = await page.$('button[type="submit"]') || await page.$('.btn-login');
      if (loginBtn) await loginBtn.click();
    }

    await page.waitForTimeout(3000);

    // Navigate to panel
    if (panelId && panelId !== 'dashMain') {
      await page.evaluate((pid) => {
        if (typeof showPanel === 'function') showPanel(pid);
      }, panelId);
      await page.waitForTimeout(2000);
    }

    // Slow scroll for visual effect
    await page.evaluate(async () => {
      const main = document.querySelector('.main-content') || document.querySelector('main') || document.body;
      for (let i = 0; i < 300; i += 3) {
        main.scrollTop = i;
        await new Promise(r => setTimeout(r, 30));
      }
    });

    await page.waitForTimeout(duration);
  } catch (e) {
    console.log(`    Warning: ${e.message.substring(0, 80)}`);
  }

  await context.close();

  // Rename latest webm file
  const webms = readdirSync(OUT)
    .filter(f => f.endsWith('.webm') && !f.startsWith('screen-'))
    .map(f => ({ name: f, mtime: statSync(join(OUT, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (webms.length > 0) {
    const target = `screen-${name}.webm`;
    try {
      renameSync(join(OUT, webms[0].name), join(OUT, target));
      console.log(`    Saved: clips/${target} (${(statSync(join(OUT, target)).size / 1024).toFixed(0)} KB)`);
    } catch (e) {
      console.log(`    Rename failed: ${e.message}`);
    }
  }
}

async function main() {
  console.log('Starting screen recording...');
  const browser = await chromium.launch({ headless: true });

  await recordPanel(browser, 'dashboard', 'dashMain', 6000);
  await recordPanel(browser, 'financeiro', 'finMens', 5000);
  await recordPanel(browser, 'crm', 'crmPipeline', 5000);
  await recordPanel(browser, 'alunos', 'alunos', 5000);
  await recordPanel(browser, 'ponto', 'pontoSetup', 4000);

  await browser.close();

  console.log('\nAll clips recorded:');
  readdirSync(OUT)
    .filter(f => f.startsWith('screen-'))
    .forEach(f => console.log(`  ${f} (${(statSync(join(OUT, f)).size / 1024).toFixed(0)} KB)`));
}

main().catch(console.error);
