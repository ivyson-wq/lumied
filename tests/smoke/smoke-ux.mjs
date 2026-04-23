#!/usr/bin/env node
/**
 * Lumied UX Smoke Test
 * Validates that all UX scripts load correctly and key features are present.
 * Run: node tests/smoke/smoke-ux.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..', '..');
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
  }
}

function fileExists(path) {
  return existsSync(join(ROOT, path));
}

function fileContains(path, pattern) {
  if (!fileExists(path)) return false;
  const content = readFileSync(join(ROOT, path), 'utf-8');
  if (typeof pattern === 'string') return content.includes(pattern);
  return pattern.test(content);
}

console.log('\n🧪 Lumied UX Smoke Tests\n');

// ── 1. Core UX files exist ──
console.log('📁 Core files:');
assert(fileExists('lumied-ux.js'), 'lumied-ux.js exists');
assert(fileExists('lumied-a11y.js'), 'lumied-a11y.js exists');
assert(fileExists('lumied-delight.js'), 'lumied-delight.js exists');
assert(fileExists('lumied-pro.js'), 'lumied-pro.js exists');
assert(fileExists('lumied-charts.js'), 'lumied-charts.js exists');
assert(fileExists('src/shared/realtime.js'), 'realtime.js exists');
assert(fileExists('src/shared/portal-init.js'), 'portal-init.js exists');
assert(fileExists('src/shared/components/data-table.js'), 'data-table.js exists');
assert(fileExists('src/shared/components/toast.js'), 'toast.js exists');
assert(fileExists('src/shared/components/modal.js'), 'modal.js exists');

// ── 2. All portals include UX scripts ──
console.log('\n📄 Portal script inclusion:');
const portals = ['gerente.html', 'professora.html', 'secretaria.html', 'admin.html', 'aluno.html', 'area-restrita.html', 'familia.html'];
for (const p of portals) {
  assert(fileContains(p, 'lumied-ux.js'), `${p} includes lumied-ux.js`);
  assert(fileContains(p, 'lumied-a11y.js'), `${p} includes lumied-a11y.js`);
  assert(fileContains(p, 'lumied-delight.js'), `${p} includes lumied-delight.js`);
  assert(fileContains(p, 'lumied-pro.js'), `${p} includes lumied-pro.js`);
}

// ── 3. Feature presence in UX files ──
console.log('\n🎯 Feature checks:');
assert(fileContains('lumied-ux.js', 'setupCommandPalette'), 'Ctrl+K command palette');
assert(fileContains('lumied-ux.js', 'setupDarkMode'), 'Dark mode');
assert(fileContains('lumied-ux.js', 'setupPanelTransitions'), 'Panel transitions');
assert(fileContains('lumied-ux.js', 'setupBreadcrumbs'), 'Breadcrumbs');
assert(fileContains('lumied-ux.js', '_showSkeleton'), 'Skeleton loaders');
assert(fileContains('lumied-ux.js', 'setupKeyboardShortcuts'), 'Keyboard shortcuts');

assert(fileContains('lumied-a11y.js', 'addSkipLink'), 'Skip link');
assert(fileContains('lumied-a11y.js', 'setupSidebarKeyboard'), 'Sidebar keyboard nav');
assert(fileContains('lumied-a11y.js', 'aria-expanded'), 'ARIA expanded');
assert(fileContains('lumied-a11y.js', 'focus-visible'), 'Focus visible');
assert(fileContains('lumied-a11y.js', 'a11y-contrast-fix'), 'Contrast fix');

assert(fileContains('lumied-delight.js', 'setupCountUp'), 'Count-up animation');
assert(fileContains('lumied-delight.js', '_confetti'), 'Confetti');
assert(fileContains('lumied-delight.js', 'setupShortcuts'), 'Vim shortcuts');
assert(fileContains('lumied-delight.js', 'setupPresence'), 'Who\'s online');
assert(fileContains('lumied-delight.js', 'setupWhiteLabel'), 'White-label');
assert(fileContains('lumied-delight.js', 'setupSmartDefaults'), 'Smart defaults');

assert(fileContains('lumied-pro.js', 'enhanceDragDrop'), 'Drag-and-drop');
assert(fileContains('lumied-pro.js', 'setupBulkOps'), 'Bulk operations');
assert(fileContains('lumied-pro.js', 'setupContextMenu'), 'Context menu');
assert(fileContains('lumied-pro.js', 'setupProgressiveImages'), 'Progressive images');
assert(fileContains('lumied-pro.js', '_createWizard'), 'Guided wizard');
assert(fileContains('lumied-pro.js', '@media print'), 'Print CSS');

assert(fileContains('lumied-charts.js', '_renderAnalyticsCharts'), 'Analytics charts');
assert(fileContains('lumied-charts.js', '_renderFinCharts'), 'Financial charts');

// ── 4. Component features ──
console.log('\n🧩 Component checks:');
assert(fileContains('src/shared/components/data-table.js', 'pageSize'), 'Table pagination');
assert(fileContains('src/shared/components/data-table.js', 'showSkeleton'), 'Table skeleton export');
assert(fileContains('src/shared/components/data-table.js', 'emptyCta'), 'Empty state CTA');
assert(fileContains('src/shared/components/toast.js', 'undo'), 'Toast undo');
assert(fileContains('src/shared/components/toast.js', 'shrink'), 'Toast progress bar');
assert(fileContains('src/shared/components/modal.js', 'setLoading'), 'Modal loading state');
assert(fileContains('src/shared/components/modal.js', 'danger'), 'Modal danger style');

// ── 5. Realtime ──
console.log('\n📡 Realtime checks:');
assert(fileContains('src/shared/realtime.js', 'subscribeAccess'), 'Access subscription');
assert(fileContains('src/shared/realtime.js', 'subscribePickup'), 'Pickup subscription');
assert(fileContains('src/shared/realtime.js', 'subscribeSolicitacoes'), 'Solicitacoes subscription');
assert(fileContains('src/shared/realtime.js', 'subscribeNotificacoes'), 'Notifications subscription');
assert(fileContains('src/shared/realtime.js', 'unsubscribeAll'), 'Cleanup function');

// ── 6. Charts in gerente.html ──
console.log('\n📊 Chart.js integration:');
assert(fileContains('gerente.html', 'chart.js@4.4.6'), 'Chart.js CDN');
assert(fileContains('gerente.html', 'lumied-charts.js'), 'Charts script tag');
assert(fileContains('gerente.html', 'chartSolicitacoes'), 'Solicitacoes canvas');
assert(fileContains('gerente.html', '_renderAnalyticsCharts'), 'Analytics chart call');
assert(fileContains('gerente.html', '_renderFinCharts'), 'Finance chart call');

// ── 7. Build output ──
console.log('\n📦 Build output:');
assert(fileExists('dist/gerente/index.js'), 'Gerente bundle');
assert(fileExists('dist/pais/index.js'), 'Pais bundle');
assert(fileExists('dist/professora/index.js'), 'Professora bundle');

// ── 8. Backend shared modules ──
console.log('\n⚙️ Backend shared:');
assert(fileExists('supabase/functions/_shared/mod.ts'), 'Barrel export mod.ts');
assert(fileContains('supabase/functions/_shared/mod.ts', 'resolveUsuario'), 'Session resolvers exported');
assert(fileContains('supabase/functions/_shared/mod.ts', 'authProfOrGerente'), 'New auth middlewares exported');
assert(fileContains('supabase/functions/_shared/router.ts', 'authProfOrGerente'), 'authProfOrGerente middleware');
assert(fileContains('supabase/functions/_shared/router.ts', 'authAluno'), 'authAluno middleware');

// ── Summary ──
console.log(`\n${'═'.repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
