// ═══════════════════════════════════════════════════════
//  Dias da Semana — Tab switcher for mobile
//  On phones, converts the 5-column grid into tabs:
//  [Seg 12] [Ter 8] [Qua 15] [Qui 10] [Sex 7]
//  Only the selected day's children list is visible.
//  On desktop (>768px), does nothing.
// ═══════════════════════════════════════════════════════
(function() {
  if (window.innerWidth > 768) return;

  var DIAS_SHORT = { 'Segunda': 'Seg', 'Terça': 'Ter', 'Quarta': 'Qua', 'Quinta': 'Qui', 'Sexta': 'Sex' };
  var today = new Date().getDay(); // 0=Sun, 1=Mon...
  var todayIdx = today >= 1 && today <= 5 ? today - 1 : 0; // Mon=0, Fri=4, default Mon

  function initTabs() {
    var grids = document.querySelectorAll('.dias-semana-grid');
    for (var g = 0; g < grids.length; g++) {
      var grid = grids[g];
      if (grid.dataset.tabbed) continue;
      grid.dataset.tabbed = '1';

      var cards = grid.querySelectorAll('.dia-card');
      if (cards.length < 2) continue;

      // Create tab bar
      var tabBar = document.createElement('div');
      tabBar.style.cssText = 'display:flex;gap:4px;margin-bottom:10px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px;';

      for (var i = 0; i < cards.length; i++) {
        (function(idx) {
          var card = cards[idx];
          var header = card.querySelector('.dia-card-header');
          var nome = header ? (header.querySelector('.dia-nome') || {}).textContent || '' : '';
          var count = header ? (header.querySelector('.dia-count') || {}).textContent || '0' : '0';
          var short = DIAS_SHORT[nome] || nome;

          var tab = document.createElement('button');
          tab.className = 'dia-tab';
          tab.setAttribute('data-idx', String(idx));
          tab.style.cssText = 'flex:1;min-width:0;padding:8px 4px;border:1.5px solid #e2dbd1;border-radius:10px;background:#fff;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;text-align:center;transition:all .15s;white-space:nowrap;';
          tab.innerHTML = '<div style="font-size:12px;font-weight:700;">' + short + '</div><div class="dia-tab-count" data-dia="' + nome + '" style="font-size:18px;font-weight:800;color:#C8102E;line-height:1.2;">' + count + '</div>';

          if (idx === todayIdx) {
            tab.style.background = '#C8102E';
            tab.style.color = '#fff';
            tab.style.borderColor = '#C8102E';
            tab.querySelector('.dia-tab-count').style.color = '#fff';
          }

          tab.addEventListener('click', function() {
            // Update tab styles
            var allTabs = tabBar.querySelectorAll('.dia-tab');
            for (var t = 0; t < allTabs.length; t++) {
              allTabs[t].style.background = '#fff';
              allTabs[t].style.color = '#1a1a1a';
              allTabs[t].style.borderColor = '#e2dbd1';
              var tc = allTabs[t].querySelector('.dia-tab-count');
              if (tc) tc.style.color = '#C8102E';
            }
            tab.style.background = '#C8102E';
            tab.style.color = '#fff';
            tab.style.borderColor = '#C8102E';
            var myCount = tab.querySelector('.dia-tab-count');
            if (myCount) myCount.style.color = '#fff';

            // Show/hide cards
            for (var c = 0; c < cards.length; c++) {
              cards[c].style.display = c === idx ? '' : 'none';
            }
          });

          tabBar.appendChild(tab);
        })(i);
      }

      // Insert tab bar before the grid
      grid.parentNode.insertBefore(tabBar, grid);

      // Hide all cards except today's
      for (var j = 0; j < cards.length; j++) {
        cards[j].style.display = j === todayIdx ? '' : 'none';
        // Hide the red header on mobile (info is in the tab)
        var h = cards[j].querySelector('.dia-card-header');
        if (h) h.style.display = 'none';
      }
    }
  }

  // Update tab counts when data loads (MutationObserver)
  function updateTabCounts() {
    var tabs = document.querySelectorAll('.dia-tab-count[data-dia]');
    for (var i = 0; i < tabs.length; i++) {
      var dia = tabs[i].getAttribute('data-dia');
      // Find the matching dia-count element
      var countEls = document.querySelectorAll('.dia-count');
      for (var c = 0; c < countEls.length; c++) {
        var parent = countEls[c].closest('.dia-card');
        if (parent) {
          var nome = parent.querySelector('.dia-nome');
          if (nome && nome.textContent === dia) {
            tabs[i].textContent = countEls[c].textContent;
          }
        }
      }
    }
  }

  // Run after DOM ready and observe for dynamic content
  function run() {
    initTabs();
    // Re-run when panels switch or data loads
    var observer = new MutationObserver(function() {
      setTimeout(function() { initTabs(); updateTabCounts(); }, 500);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
