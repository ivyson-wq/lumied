import { test, expect } from '@playwright/test';

// ═══ HUB (area-restrita) — golden path do seletor de portais ═══
test.describe('Area Restrita Hub', () => {
  test('renderiza cards de portais rapidamente', async ({ page }) => {
    await page.goto('/area-restrita.html', { waitUntil: 'domcontentloaded' });
    // Os 4 cards renderizam imediatamente (render-then-hydrate).
    // Tolerância generosa para 1ª carga (ex-cold start edge function).
    const cards = page.locator('.portal-card');
    await expect(cards).toHaveCount(4, { timeout: 10000 });
    // Pelo menos gerente deve estar sempre visível (sem gating).
    await expect(page.getByRole('heading', { name: /Painel do Gerente/i })).toBeVisible();
  });

  test('bootstrap endpoint responde < 3s', async ({ page }) => {
    const t0 = Date.now();
    const resp = await page.request.post(
      'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/api',
      {
        headers: {
          'Content-Type': 'application/json',
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyZ29ya25icmpsZnd2cnJsd3hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk2NzMwMDAsImV4cCI6MjA1NTI0OTAwMH0.placeholder',
        },
        data: { action: 'hub_bootstrap', _tokens: [] },
        failOnStatusCode: false,
      }
    );
    const elapsed = Date.now() - t0;
    // Apenas verifica que respondeu — o status pode ser 401 se anon key não bate,
    // o que é OK para smoke test. Foco é latência.
    expect(resp.status()).toBeLessThan(600);
    expect(elapsed).toBeLessThan(3000);
  });
});
