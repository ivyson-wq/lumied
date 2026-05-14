import { test, expect } from '@playwright/test';

/**
 * Golden path: Wizard de Migração de ERPs (admin-central)
 *
 * Não roda o fluxo end-to-end completo (criar job → upload → promover)
 * porque exige sessão staff válida e mutaria dados na Demo Lumied. Esse
 * teste cobre as garantias **estruturais** que asseguram que o wizard
 * está carregado e renderizado corretamente após a Onda 1 do refator
 * (que adotou window.__api/__utils/__toast via bundle defer).
 *
 * O fluxo HTTP completo end-to-end foi validado manualmente — ver
 * memory:project_migracao_erps "E2E real testado".
 */

test.describe('Migração de ERPs — admin-central', () => {
  test('aba Migração aparece no sidebar', async ({ page }) => {
    await page.goto('/admin-central.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
    // Sem login não vê o conteúdo, mas o item de menu (oculto) deve existir no DOM
    const navItem = page.locator('a:has-text("Migração ERPs")');
    await expect(navItem).toHaveCount(1);
  });

  test('modais do wizard estão presentes no DOM', async ({ page }) => {
    await page.goto('/admin-central.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
    // 4 modais adicionados pela feature migração + 2 da Onda 1
    await expect(page.locator('#modalNovaMigracao')).toBeAttached();
    await expect(page.locator('#modalMigEditarLinha')).toBeAttached();
    await expect(page.locator('#modalMigHistorico')).toBeAttached();
    await expect(page.locator('#modalMigRollback')).toBeAttached();
  });

  test('select de ERPs lista os 7 adapters + Excel/Outro', async ({ page }) => {
    await page.goto('/admin-central.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const opts = page.locator('#migNovaErp option');
    // 9 opções: Excel, Escolaweb, Sponte, WPensar, Agenda Edu, Sophia, TOTVS RM, GVDasa, Outro
    await expect(opts).toHaveCount(9);
    await expect(page.locator('#migNovaErp option[value="gvdasa"]')).toBeAttached();
    await expect(page.locator('#migNovaErp option[value="totvs_rm"]')).toBeAttached();
  });

  test('stepper do wizard tem 6 passos (incluindo step Verificar pós-promote)', async ({ page }) => {
    await page.goto('/admin-central.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const steps = page.locator('#migStepper .mig-step');
    await expect(steps).toHaveCount(6);
    await expect(page.locator('.mig-step[data-step="6"]')).toContainText('Verificar');
  });

  test('bundle dist/admin-central/index.js é servido', async ({ page }) => {
    // Onda 1 do refator: novo entry. Garante que /dist/admin-central/index.js existe.
    const r = await page.request.get('/dist/admin-central/index.js');
    expect(r.status()).toBe(200);
    const body = await r.text();
    // O bundle deve incluir o banner do esbuild e referência ao Lumied
    expect(body).toContain('Lumied');
  });

  test('window.__api e window.__utils ficam disponíveis após defer', async ({ page }) => {
    await page.goto('/admin-central.html');
    // Aguarda o defer terminar
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => !!(window as unknown as { __api?: unknown }).__api, null, { timeout: 5000 });

    const apiOk = await page.evaluate(() => !!(window as unknown as { __api?: { admin?: unknown } }).__api?.admin);
    const utilsOk = await page.evaluate(() => !!(window as unknown as { __utils?: { esc?: unknown } }).__utils?.esc);
    const toastOk = await page.evaluate(() => typeof (window as unknown as { __toast?: unknown }).__toast === 'function');
    expect(apiOk).toBe(true);
    expect(utilsOk).toBe(true);
    expect(toastOk).toBe(true);
  });
});

test.describe('Tutoriais por ERP — Central de Ajuda', () => {
  test('section "Migração de ERPs" aparece no sidebar', async ({ page }) => {
    await page.goto('/ajuda/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('.sidebar-section[data-portal="migracao-erps"]')).toBeAttached();
  });

  test('8 artigos de tutorial estão no DOM', async ({ page }) => {
    await page.goto('/ajuda/');
    const articles = page.locator('article.help-article[data-portal="migracao-erps"]');
    await expect(articles).toHaveCount(8);
    // Verifica que os 7 ERPs + overview têm artigos
    for (const id of ['mig-overview', 'mig-excel', 'mig-escolaweb', 'mig-sponte',
                      'mig-wpensar', 'mig-sophia', 'mig-totvs', 'mig-gvdasa']) {
      await expect(page.locator('#' + id)).toBeAttached();
    }
  });
});
