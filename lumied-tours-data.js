// ═══════════════════════════════════════════════════════════════
//  Lumied — Definição de tours (Sprint 9 LAP)
//
//  Registra tours na engine LumiedTour. Carrega DEPOIS de lumied-tour.js.
//  Cada tour roda 1x por usuário (localStorage por chave).
// ═══════════════════════════════════════════════════════════════
(function() {
  if (!window.LumiedTour) return;

  // ─── Tour 1: Dashboard do gerente (landing) ────────────────────
  LumiedTour.register('tour_gerente_landing', [
    {
      selector: '.sidebar',
      title: 'Esta é sua barra de navegação',
      text: 'Aqui você acessa todos os módulos contratados pela escola: financeiro, alunos, manutenção, almoxarifado, comunicação e mais. Os itens são liberados conforme seu papel.',
      position: 'right',
    },
    {
      selector: '#panelDashboard, .panel.active',
      title: 'Dashboard executivo',
      text: 'Em segundos você vê inadimplência, frequência crítica, próximos vencimentos e indicadores-chave da escola. Atualiza em tempo real.',
      position: 'auto',
    },
    {
      selector: '#lumied-lap-checklist, .lap-help-fab',
      title: 'Checklist de ativação 🚀',
      text: 'Este widget no canto direito mostra os próximos passos pra deixar seu Lumied 100% pronto. Cada item ✓ tira um motivo de churn.',
      position: 'left',
    },
    {
      selector: '.lap-help-fab',
      title: 'Ajuda contextual a 1 clique',
      text: 'Sempre que tiver dúvida, clica neste botão "?" e mostramos artigos da tela atual + atalho pro WhatsApp se precisar de ajuda humana.',
      position: 'right',
    },
  ]);

  // ─── Tour 2: Painel Ativação no admin-central ──────────────────
  LumiedTour.register('tour_activation_painel', [
    {
      selector: '#lapAmpsD60',
      title: 'AMPS @ D60 — sua North Star',
      text: 'Active Modules Per School aos 60 dias é a métrica que prevê retenção. Escolas com 4+ módulos ativos têm 3× menos churn.',
      position: 'bottom',
    },
    {
      selector: '#lapPctGreen',
      title: '% de escolas saudáveis',
      text: 'Soma das escolas com Lumied Health Score ≥ 80. Meta T1 deste trimestre: > 50%.',
      position: 'bottom',
    },
    {
      selector: '#lapTbody',
      title: 'Tabela ordenada por risco',
      text: 'Vermelhas primeiro (ação urgente do CS), amarelas em seguida. Clique no botão ↗ pra abrir o drawer com breakdown dos 4 pilares e timeline de eventos.',
      position: 'top',
    },
    {
      selector: 'button[onclick="recomputeActivation()"]',
      title: 'Recalcular agora',
      text: 'O LHS é refreshado todo dia às 04:00 BRT. Mas se precisar ver o impacto de um evento recente (ex: nova baixa automática), clica aqui pra forçar agora.',
      position: 'left',
    },
  ]);

  // ─── Tour 3: Help drawer (primeira vez que abre) ───────────────
  // Roda quando o drawer é aberto pela 1ª vez. Disparado pelo lumied-help.js.
  LumiedTour.register('tour_help_drawer', [
    {
      selector: '.lap-help-drawer .lap-help-search',
      title: 'Busque pela sua dúvida',
      text: 'Digite uma palavra (ex: "boleto", "matrícula", "ponto") e mostramos os artigos mais relevantes pra esta tela.',
      position: 'left',
    },
    {
      selector: '.lap-help-drawer .lap-help-cta.wa',
      title: 'Atalho pro WhatsApp',
      text: 'Não achou o que precisa? Esse botão abre o WhatsApp comercial da Lumied já com mensagem pré-preenchida sobre onde você está.',
      position: 'left',
    },
  ]);
})();
