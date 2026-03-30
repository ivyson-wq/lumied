import { test, expect } from '@playwright/test';

// ═══ PORTAL DOS PAIS ═══
test.describe('Portal dos Pais', () => {
  test('página de login carrega corretamente', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Maple Bear', { exact: false }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('input[type="email"]').first()).toBeVisible();
  });

  test('botões de login alternativos visíveis', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.getByText('Continuar com Google').first()).toBeVisible();
    await expect(page.getByText('Criar conta').first()).toBeVisible();
  });

  test('não mostra conteúdo sem login', async ({ page }) => {
    await page.goto('/index.html');
    // Bottom nav não deve estar visível sem login
    const bottomNav = page.locator('#bottomNav');
    await expect(bottomNav).not.toHaveClass(/visible/);
  });

  test('link para Área Restrita visível', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('text=Área Restrita')).toBeVisible();
  });
});

// ═══ PAINEL DO GERENTE ═══
test.describe('Painel do Gerente', () => {
  test('tela de login carrega', async ({ page }) => {
    await page.goto('/gerente.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('#loginEmail')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#loginSenha')).toBeVisible();
  });

  test('login card é visualmente centralizado', async ({ page }) => {
    await page.goto('/gerente.html');
    const card = page.locator('.login-card');
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    expect(box).toBeTruthy();
    // Card should be roughly centered horizontally
    const pageWidth = page.viewportSize()!.width;
    const cardCenter = box!.x + box!.width / 2;
    expect(Math.abs(cardCenter - pageWidth / 2)).toBeLessThan(50);
  });

  test('formulário rejeita campos vazios', async ({ page }) => {
    await page.goto('/gerente.html');
    await page.click('text=Entrar no Painel');
    // Should show error
    await page.waitForTimeout(1000);
    const errorEl = page.locator('#loginError');
    await expect(errorEl).toBeVisible();
  });
});

// ═══ PORTAL DA PROFESSORA ═══
test.describe('Portal da Professora', () => {
  test('tela de login carrega', async ({ page }) => {
    await page.goto('/professora.html');
    await expect(page.locator('#loginScreen')).toBeVisible();
  });
});

// ═══ PORTAL DA SECRETARIA ═══
test.describe('Portal da Secretaria', () => {
  test('página carrega', async ({ page }) => {
    await page.goto('/secretaria.html');
    await expect(page.locator('body')).toBeVisible();
  });
});

// ═══ PORTAL DO ALUNO ═══
test.describe('Portal do Aluno', () => {
  test('tela de login carrega', async ({ page }) => {
    await page.goto('/aluno.html');
    await expect(page.getByRole('heading', { name: 'Portal do Aluno' })).toBeVisible();
    await expect(page.locator('#loginEmail')).toBeVisible();
  });
});

// ═══ ADMIN PANEL ═══
test.describe('Admin Panel', () => {
  test('tela de login carrega sem erros JS', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/admin.html');
    await page.waitForTimeout(2000);
    await expect(page.locator('text=Painel Administrativo')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('setup check é executado', async ({ page }) => {
    await page.goto('/admin.html');
    await page.waitForTimeout(2000);
    // Either login form or setup form should be visible
    const loginForm = page.locator('#loginForm');
    const setupForm = page.locator('#setupForm');
    const loginVisible = await loginForm.isVisible();
    const setupVisible = await setupForm.isVisible();
    expect(loginVisible || setupVisible).toBe(true);
  });
});

// ═══ ÁREA RESTRITA ═══
test.describe('Área Restrita', () => {
  test('mostra 4 portal cards', async ({ page }) => {
    await page.goto('/area-restrita.html');
    const cards = page.locator('.portal-card');
    await expect(cards).toHaveCount(4);
  });

  test('cards linkam para portais corretos', async ({ page }) => {
    await page.goto('/area-restrita.html');
    await expect(page.locator('a[href="gerente.html"]')).toBeVisible();
    await expect(page.locator('a[href="professora.html"]')).toBeVisible();
    await expect(page.locator('a[href="secretaria.html"]')).toBeVisible();
    await expect(page.locator('a[href="admin.html"]')).toBeVisible();
  });
});
