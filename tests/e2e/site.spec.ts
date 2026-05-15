import { test, expect } from '@playwright/test';

test.describe('Site Lumied', () => {
  test('hero carrega com screenshot', async ({ page }) => {
    await page.goto('/site/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.hero h1').first()).toBeVisible({ timeout: 15000 });
    const heroImg = page.locator('.hero-screenshot img');
    await expect(heroImg).toBeVisible({ timeout: 10000 });
  });

  test('navegação funciona', async ({ page }) => {
    await page.goto('/site/', { waitUntil: 'domcontentloaded' });
    // On mobile the nav is hidden behind hamburger
    const isMobile = (page.viewportSize()?.width || 1440) < 768;
    if (!isMobile) {
      await expect(page.locator('.nav a:has-text("Funcionalidades")')).toBeVisible();
      await expect(page.locator('.nav a:has-text("Planos")')).toBeVisible();
    } else {
      await expect(page.locator('.hamburger')).toBeVisible();
    }
  });

  test('6 feature cards renderizam', async ({ page }) => {
    await page.goto('/site/');
    await page.evaluate(() => window.scrollTo(0, 2000));
    await page.waitForTimeout(1000);
    const cards = page.locator('.feature-card');
    await expect(cards).toHaveCount(6);
  });

  test('pricing cards renderizam (3 tiers atual)', async ({ page }) => {
    await page.goto('/site/');
    await page.evaluate(() => window.scrollTo(0, 7000));
    await page.waitForTimeout(1000);
    // Tiers atuais (2026-05): Starter (R$ 790), Essencial, Prestige.
    // Antes eram 5 tiers; v3 consolidou em 3 ([[project_tier_starter.md]]).
    const cards = page.locator('.plan-card, .pricing-card');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('plano featured é destacado', async ({ page }) => {
    await page.goto('/site/');
    await page.evaluate(() => window.scrollTo(0, 7000));
    await page.waitForTimeout(1000);
    const featured = page.locator('.plan-card.featured, .pricing-card.featured').first();
    await expect(featured).toBeVisible();
  });

  test('toggle pricing muda valores', async ({ page }) => {
    await page.goto('/site/');
    await page.evaluate(() => window.scrollTo(0, 6500));
    await page.waitForTimeout(1000);
    // Default is annual (239)
    const firstAmount = page.locator('.amount').first();
    const initialText = await firstAmount.textContent();
    // Click toggle to switch to monthly
    await page.locator('.toggle-switch').click();
    await page.waitForTimeout(500);
    const newText = await firstAmount.textContent();
    expect(newText).not.toBe(initialText);
  });

  test('CTA form tem 3 inputs', async ({ page }) => {
    await page.goto('/site/');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    const form = page.locator('.cta-form');
    await expect(form).toBeVisible();
    const inputs = form.locator('input');
    await expect(inputs).toHaveCount(3);
  });

  test('galeria de screenshots tem 3 tabs', async ({ page }) => {
    await page.goto('/site/');
    await page.evaluate(() => window.scrollTo(0, 5000));
    await page.waitForTimeout(1000);
    const tabs = page.locator('.ss-tab');
    await expect(tabs).toHaveCount(3);
  });

  test('sem erros JS no console', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/site/');
    await page.waitForTimeout(3000);
    expect(errors).toHaveLength(0);
  });
});
