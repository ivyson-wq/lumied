import { test, expect, type ConsoleMessage } from '@playwright/test';

// ═══════════════════════════════════════════════════════════════
//  Gerente Portal — pós-Onda 4 do refator
//
//  Onda 4 quebrou gerente.html (22k linhas) em 28 panel scripts
//  carregados via <script defer>. O risco principal: função declarada
//  num panel sendo chamada por código de outro panel/inline que carrega
//  antes — ReferenceError em runtime.
//
//  Esses testes validam EXATAMENTE o que está em risco:
//    1. Todos os panel scripts respondem 200
//    2. gerente.html carrega sem erro no console
//    3. Globais críticos de cada panel ficam definidos em window
//    4. window.showPanel(id) não throwa pra nenhum painel
//
//  Sem login — todos os testes rodam contra o portal anônimo. As
//  funções `load*` que chamam API devolvem 401 mas a invocação JS
//  em si não pode lançar exception.
// ═══════════════════════════════════════════════════════════════

const PANEL_SCRIPTS = [
  'manutencao.js',
  'inventario-fisico.js',
  'workflows.js',
  'cantina.js',
  'atividades.js',
  'acesso-extras.js',
  'secretaria-diplomas-pdi.js',
  'almoxarifado.js',
  'nav-favoritos.js',
  'turno-modal.js',
  'recursos-reservas.js',
  'analytics-audit.js',
  'tema-modulos-wizard.js',
  'biblioteca.js',
  'alunos.js',
  'equipe.js',
  'professoras-acesso.js',
  'familias-calendario.js',
  'financeiro.js',
  'impressoes-horarios.js',
  'onboarding-notas.js',
  'wizard-briefing.js',
  'compliance-ponto-contratos.js',
  'financeiro-core.js',
  'financeiro-ext.js',
  'crm.js',
  'compliance-novos.js',
  'ponto-afd.js',
];

// Função global esperada após cada panel script carregar. Se uma falhar,
// significa que a extração apagou ou renomeou a função sem querer.
// Coleta uma representativa de cada panel — não exaustivo, mas detecta
// falha catastrófica de carregamento.
const PANEL_GLOBALS: Record<string, string> = {
  'manutencao.js':                  'loadManutPanel',
  'inventario-fisico.js':           'almInvCarregarLista',
  'workflows.js':                   'loadWorkflows',
  'cantina.js':                     'loadCardapio',
  'atividades.js':                  'loadAtividadesPanel',
  'acesso-extras.js':               'loadAcessoFaces',
  'secretaria-diplomas-pdi.js':     'loadSecretarias',
  'almoxarifado.js':                'almShowTab',
  'nav-favoritos.js':               'initFavorites',
  'turno-modal.js':                 'openModal',
  'recursos-reservas.js':           'loadSeries',
  'analytics-audit.js':             'loadRecursosAnalytics',
  'tema-modulos-wizard.js':         'loadSidebarLogo',
  'biblioteca.js':                  'loadBibAcervo',
  'alunos.js':                      'renderAlunos',
  'equipe.js':                      'loadEquipe',
  'professoras-acesso.js':          'loadProfessoras',
  'familias-calendario.js':         'loadCalendario',
  'financeiro.js':                  'loadFinDashboard',
  'impressoes-horarios.js':         'loadImpressoesGerente',
  'onboarding-notas.js':            'loadOnboardingBilling',
  'wizard-briefing.js':             'loadMorningBriefing',
  'compliance-ponto-contratos.js':  'loadContratos',
  'financeiro-core.js':             'loadFinDre',
  'financeiro-ext.js':              'loadInadimplencia',
  'crm.js':                         'loadCrmLeads',
  'compliance-novos.js':            'loadCompLgpd',
  'ponto-afd.js':                   'loadPontoEmployees',
};

// Painéis que o gerente pode abrir via showPanel(id). Para cada um o
// switcher chama load*(...) — se algum throw, regressão da Onda 4.
const PANELS_TO_SWITCH = [
  'analytics', 'workflows', 'alunos', 'professoras', 'series',
  'recursos', 'biblioteca', 'cantina', 'logo',
  'crmKanban', 'manutencao', 'almoxarifado', 'pontoEmployees',
  'pontoImport', 'finDre', 'finBalanco', 'roi', 'contratos',
];

const BASE = 'https://maplebearcaxias.lumied.com.br';

test.describe('Onda 4 — gerente.html panels', () => {
  test('os 28 panel scripts respondem 200', async ({ request }) => {
    for (const p of PANEL_SCRIPTS) {
      const r = await request.get(`${BASE}/gerente-panels/${p}`);
      expect.soft(r.status(), `${p} should be 200`).toBe(200);
    }
  });

  test('gerente.html carrega sem console errors fatais', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') {
        const t = msg.text();
        // Ignora 401s e network errors esperados (sem auth) e erros de extensão
        if (/401|Failed to load resource|Sessão|chrome-extension|Sentry/i.test(t)) return;
        errors.push(`CONSOLE: ${t}`);
      }
    });

    await page.goto(`${BASE}/gerente.html`, { waitUntil: 'load', timeout: 30000 });
    // Aguarda defer scripts completarem (setTimeout no init dispara após DOMContentLoaded)
    await page.waitForTimeout(2500);

    expect(errors, `Console errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('cada panel script expõe sua função-canário em window', async ({ page }) => {
    await page.goto(`${BASE}/gerente.html`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2500); // espera defer

    const missing: string[] = [];
    for (const [panel, fnName] of Object.entries(PANEL_GLOBALS)) {
      const exists = await page.evaluate((name) =>
        typeof (window as unknown as Record<string, unknown>)[name] === 'function',
        fnName,
      );
      if (!exists) missing.push(`${panel} → window.${fnName}`);
    }

    expect(missing, `Funções não-encontradas:\n${missing.join('\n')}`).toEqual([]);
  });

  test('showPanel(id) não throwa para nenhum painel crítico', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`${BASE}/gerente.html`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2500);

    // Verifica que showPanel existe antes de invocar
    const hasShowPanel = await page.evaluate(() =>
      typeof (window as unknown as { showPanel?: unknown }).showPanel === 'function',
    );
    expect(hasShowPanel, 'window.showPanel deve estar definida').toBe(true);

    for (const id of PANELS_TO_SWITCH) {
      await page.evaluate((panelId) => {
        try {
          // deno-lint-ignore no-explicit-any
          (window as any).showPanel(panelId, null);
        } catch (e) {
          // throw síncrono — captura no pageerror handler
          throw e;
        }
      }, id);
      // Pequena espera pra deixar load*() async começar (e possivelmente falhar)
      await page.waitForTimeout(150);
    }

    // Re-pega errors após todos os switches
    await page.waitForTimeout(500);

    // Filtra erros vindos de chamadas API 401 (esperados sem login)
    const real = errors.filter((e) =>
      !/401|Sessão|fetch|NetworkError|api.*token|auth/i.test(e),
    );

    expect(real, `Page errors durante panel switching:\n${real.join('\n')}`).toEqual([]);
  });
});
