/**
 * Records real screen captures from demo.lumied.com.br for the commercial video.
 * Uses Playwright to login, navigate panels, and capture video clips.
 *
 * Usage: node scripts/video-demo/record-screens.mjs
 * Output: clips/screen-*.webm (5-8 second clips of each panel)
 */

import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const BASE = 'https://demo.lumied.com.br';
const EMAIL = 'demo@lumied.com.br';
const SENHA = 'LumiedDemo2026!';
const OUT = join(process.cwd(), 'clips');

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const PANELS = [
  { name: 'dashboard', panel: 'dashMain', wait: 3000, duration: 6000, scroll: false },
  { name: 'financeiro', panel: 'finMens', wait: 2000, duration: 5000, scroll: true },
  { name: 'crm', panel: 'crmPipeline', wait: 2000, duration: 5000, scroll: false },
  { name: 'alunos', panel: 'alunos', wait: 2000, duration: 5000, scroll: true },
  { name: 'almoxarifado', panel: 'almDash', wait: 2000, duration: 5000, scroll: false },
];

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });

  for (const p of PANELS) {
    console.log(`Recording: ${p.name}...`);

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
      colorScheme: 'dark',
    });

    const page = await context.newPage();

    try {
      // Login
      await page.goto(`${BASE}/gerente.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);

      // Fill login form
      await page.fill('input[type="email"], input[placeholder*="email"], #email', EMAIL).catch(() => {});
      await page.fill('input[type="password"], input[placeholder*="senha"], #senha', SENHA).catch(() => {});
      await page.click('button[type="submit"], .btn-login, button:has-text("Entrar")').catch(() => {});

      // Wait for dashboard to load
      await page.waitForTimeout(p.wait + 2000);

      // Navigate to panel if not dashboard
      if (p.panel !== 'dashMain') {
        await page.evaluate((panelName) => {
          const link = document.querySelector(`[onclick*="${panelName}"]`);
          if (link) link.click();
          else if (typeof showPanel === 'function') showPanel(panelName);
        }, p.panel);
        await page.waitForTimeout(p.wait);
      }

      // Simulate natural interaction
      if (p.scroll) {
        const mainContent = await page.$('.main-content, .panel-content, main, [id*="panel"]');
        if (mainContent) {
          await page.evaluate(() => {
            const el = document.querySelector('.main-content') || document.querySelector('main') || document.body;
            let pos = 0;
            const scroll = () => {
              pos += 2;
              el.scrollTop = pos;
              if (pos < 400) requestAnimationFrame(scroll);
            };
            scroll();
          });
        }
      }

      // Record for duration
      await page.waitForTimeout(p.duration);

    } catch (err) {
      console.log(`  Warning: ${err.message}`);
    }

    // Close context to save video
    await context.close();

    // Rename the video file
    const { readdirSync, renameSync } = await import('fs');
    const files = readdirSync(OUT).filter(f => f.endsWith('.webm')).sort((a, b) => {
      const statA = (await import('fs')).statSync(join(OUT, a));
      const statB = (await import('fs')).statSync(join(OUT, b));
      return statB.mtimeMs - statA.mtimeMs;
    });

    // Find the most recent webm that hasn't been renamed
    const allWebm = readdirSync(OUT).filter(f => f.endsWith('.webm') && !f.startsWith('screen-'));
    if (allWebm.length > 0) {
      // Sort by modification time, pick newest
      const newest = allWebm.reduce((a, b) => {
        const { statSync } = require('fs');
        return statSync(join(OUT, a)).mtimeMs > statSync(join(OUT, b)).mtimeMs ? a : b;
      });
      const target = `screen-${p.name}.webm`;
      try { renameSync(join(OUT, newest), join(OUT, target)); } catch {}
      console.log(`  Saved: ${target}`);
    }
  }

  await browser.close();
  console.log('\nDone! Clips saved in clips/');
}

main().catch(console.error);
