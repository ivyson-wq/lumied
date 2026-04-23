/**
 * Lumied Charts — Chart.js enhanced visualizations for analytics & financial dashboards.
 * Self-contained IIFE. Exposes window._renderAnalyticsCharts(d) and window._renderFinCharts(d).
 */
(function () {
  'use strict';

  var MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  // Lumied palette
  var C = {
    red: '#C8102E',
    green: '#2d7a3a',
    blue: '#1a6bb5',
    orange: '#d4830a',
    muted: '#5a5249',
    grid: '#e2dbd1',
    yellow: '#d4a00a'
  };

  // Store chart instances for cleanup
  var _charts = {};

  function isDark() {
    return document.body.classList.contains('theme-dark');
  }

  function gridColor() {
    return isDark() ? 'rgba(255,255,255,0.1)' : C.grid;
  }

  function textColor() {
    return isDark() ? '#ccc' : C.muted;
  }

  function fmtBRL(v) {
    return 'R$ ' + parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function destroyChart(id) {
    if (_charts[id]) {
      _charts[id].destroy();
      delete _charts[id];
    }
  }

  function makeChart(canvasId, config) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    destroyChart(canvasId);
    var ctx = canvas.getContext('2d');
    var chart = new Chart(ctx, config);
    _charts[canvasId] = chart;
    return chart;
  }

  function baseScaleOpts(isCurrency) {
    return {
      x: {
        grid: { display: false },
        ticks: { color: textColor(), font: { size: 11 } }
      },
      y: {
        grid: { color: gridColor(), borderDash: [4, 4] },
        ticks: {
          color: textColor(),
          font: { size: 11 },
          callback: isCurrency ? function (v) { return fmtBRL(v); } : undefined
        },
        beginAtZero: true
      }
    };
  }

  function baseTooltip(isCurrency) {
    return {
      backgroundColor: isDark() ? '#333' : '#fff',
      titleColor: isDark() ? '#eee' : '#1a1a1a',
      bodyColor: isDark() ? '#ccc' : '#333',
      borderColor: isDark() ? '#555' : C.grid,
      borderWidth: 1,
      padding: 10,
      cornerRadius: 8,
      callbacks: isCurrency ? {
        label: function (ctx) {
          return ctx.dataset.label + ': ' + fmtBRL(ctx.parsed.y);
        }
      } : undefined
    };
  }

  // ── Analytics Charts ──────────────────────────────────

  window._renderAnalyticsCharts = function (d) {
    if (typeof Chart === 'undefined') return;

    Chart.defaults.font.family = "'DM Sans', system-ui, sans-serif";

    // Solicitacoes — line chart
    makeChart('chartSolicitacoes', {
      type: 'line',
      data: {
        labels: MONTHS,
        datasets: [{
          label: 'Solicitacoes',
          data: d.solicitacoes_por_mes || [],
          borderColor: C.red,
          backgroundColor: 'rgba(200,16,46,0.08)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBackgroundColor: C.red,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: baseTooltip(false)
        },
        scales: baseScaleOpts(false)
      }
    });

    // Gastos Almoxarifado — bar chart (blue)
    makeChart('chartAlmox', {
      type: 'bar',
      data: {
        labels: MONTHS,
        datasets: [{
          label: 'Almoxarifado',
          data: d.gastos_almox_por_mes || [],
          backgroundColor: C.blue,
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 32
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: baseTooltip(true)
        },
        scales: baseScaleOpts(true)
      }
    });

    // Manutencao — bar chart (orange)
    makeChart('chartManutencao', {
      type: 'bar',
      data: {
        labels: MONTHS,
        datasets: [{
          label: 'Manutencao',
          data: d.manutencao_por_mes || [],
          backgroundColor: C.orange,
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 32
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: baseTooltip(false)
        },
        scales: baseScaleOpts(false)
      }
    });
  };

  // ── Financial Charts ──────────────────────────────────

  window._renderFinCharts = function (d) {
    if (typeof Chart === 'undefined') return;

    Chart.defaults.font.family = "'DM Sans', system-ui, sans-serif";

    // Receitas vs Despesas — grouped bar
    makeChart('chartFinRecDesp', {
      type: 'bar',
      data: {
        labels: MONTHS,
        datasets: [
          {
            label: 'Receitas',
            data: d.receitas_mes || [],
            backgroundColor: C.green,
            borderRadius: 6,
            borderSkipped: false,
            maxBarThickness: 24
          },
          {
            label: 'Despesas',
            data: d.despesas_mes || [],
            backgroundColor: C.red,
            borderRadius: 6,
            borderSkipped: false,
            maxBarThickness: 24
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: textColor(), usePointStyle: true, padding: 16, font: { size: 12 } } },
          tooltip: baseTooltip(true)
        },
        scales: baseScaleOpts(true)
      }
    });

    // Donut — composicao
    var total = parseFloat(d.total_receitas || 0);
    var desp = parseFloat(d.total_despesas || 0);
    var pend = parseFloat(d.pendente || 0);

    makeChart('chartFinDonut', {
      type: 'doughnut',
      data: {
        labels: ['Receitas', 'Despesas', 'Pendente'],
        datasets: [{
          data: [total, desp, pend],
          backgroundColor: [C.green, C.red, C.yellow],
          borderWidth: 2,
          borderColor: isDark() ? '#1c1712' : '#fff',
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: { position: 'bottom', labels: { color: textColor(), usePointStyle: true, padding: 12, font: { size: 11 } } },
          tooltip: {
            backgroundColor: isDark() ? '#333' : '#fff',
            titleColor: isDark() ? '#eee' : '#1a1a1a',
            bodyColor: isDark() ? '#ccc' : '#333',
            borderColor: isDark() ? '#555' : C.grid,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: function (ctx) {
                return ctx.label + ': ' + fmtBRL(ctx.parsed);
              }
            }
          }
        }
      }
    });
  };

})();
