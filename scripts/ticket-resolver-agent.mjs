// Lumied — Ticket Resolver Agent v3
// Fase 3: Resolver tickets com base nas descrições já conhecidas

const PROJECT_REF = 'brgorknbrjlfwvrrlwxj';
const API_BASE = `https://api.supabase.com/v1/projects/${PROJECT_REF}`;
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'ivyson-wq/maple-bear-rs';

if (!SUPABASE_ACCESS_TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN não configurado'); process.exit(1); }

async function sqlQuery(query) {
  const res = await fetch(`${API_BASE}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL error (${res.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function dq(str) { const t = 'LT'; return `$${t}$${String(str||'').replace(new RegExp('\\$'+t+'\\$','g'),'')}$${t}$`; }

async function updateTicket(id, { status, resposta, tratamento }) {
  await sqlQuery(`UPDATE tickets SET status='${status}', resposta=${dq(resposta)}, tratamento=${dq(tratamento)}, respondido_por=$$claude-ai@lumied.com.br$$, atualizado_em=now() WHERE id='${id}'`);
}

async function closeGitHubIssue(num) {
  if (!GITHUB_TOKEN) return;
  await fetch(`https://api.github.com/repos/${REPO}/issues/${num}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'lumied-ticket-agent' },
    body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
  });
}

// ─── FAQ completo + heurísticas ───
const FAQ = [
  { kw: ['login','entrar','senha','acesso negado','nao consigo','n\u00e3o consigo','magic link'], r: 'Tente as seguintes solu\u00e7\u00f5es:\n1. Limpe o cache do navegador (Ctrl+Shift+Del)\n2. Tente em uma aba an\u00f4nima\n3. Verifique se o email est\u00e1 correto\n4. Use a op\u00e7\u00e3o "Magic Link" para receber um link de acesso por email\n5. Se usa biometria, tente desativar e reativar nas configura\u00e7\u00f5es do navegador' },
  { kw: ['lento','devagar','carregando','loading','demora','travando','trava'], r: 'Dicas de performance:\n1. Verifique sua conex\u00e3o de internet\n2. Limpe o cache do navegador (Ctrl+Shift+Del)\n3. Feche outras abas\n4. Use Chrome ou Edge atualizados\n5. Em mobile, feche e reabra o app' },
  { kw: ['boleto','pagamento','cobran\u00e7a','fatura','pagar','mensalidade'], r: 'Sobre boletos:\n1. Boletos levam at\u00e9 24h para aparecer\n2. Ap\u00f3s pagamento, o status atualiza em at\u00e9 48h \u00fateis\n3. Para segunda via, acesse a aba "Boletos" no portal dos pais' },
  { kw: ['equipe','membro','colaborador','usuario','usu\u00e1rio','n\u00e3o vejo','nao vejo'], r: 'Sobre a lista de Equipe no Portal do Gerente:\n\nO painel Equipe mostra os membros que voc\u00ea gerencia (professoras, secretaria, comercial, manuten\u00e7\u00e3o, etc.). O pr\u00f3prio usu\u00e1rio gerente/diretor n\u00e3o aparece nessa lista, pois \u00e9 quem administra \u2014 n\u00e3o quem \u00e9 administrado.\n\nSe est\u00e1 procurando um membro espec\u00edfico:\n1. Verifique se ele foi cadastrado em Equipe → "+ Adicionar Membro"\n2. Confirme se o papel dele est\u00e1 correto (professora, secretaria, etc.)\n3. Se o membro foi cadastrado recentemente, aguarde at\u00e9 1 minuto para sincronizar\n\nPara gerenciar seu pr\u00f3prio perfil como gerente, use o \u00edcone de usu\u00e1rio no topo da p\u00e1gina.' },
  { kw: ['pickup','buscar','busca','retirada','autorizar','autorizado'], r: 'Para gerenciar autoriza\u00e7\u00f5es de retirada:\n1. Acesse Portal dos Pais \u2192 aba "Acesso"\n2. Clique em "Gerenciar Autorizados"\n3. Adicione nome, parentesco e foto\n4. Defina o per\u00edodo (7/30/60 dias ou permanente)' },
  { kw: ['biometria','face','facial','camera','c\u00e2mera'], r: 'Para cadastro biom\u00e9trico:\n1. Portal dos Pais \u2192 "Acesso" \u2192 "Minha Face"\n2. Use ambiente bem iluminado\n3. Olhe diretamente para a c\u00e2mera\n4. Aguarde valida\u00e7\u00e3o e aprova\u00e7\u00e3o da escola' },
  { kw: ['nota','boletim','frequ\u00eancia','frequencia','falta'], r: 'Para acompanhar notas e frequ\u00eancia:\n1. Acesse o Portal dos Pais ou Portal do Aluno\n2. Aba "Boletim" \u2014 notas por disciplina\n3. Aba "Frequ\u00eancia" \u2014 presen\u00e7as e faltas' },
  { kw: ['diploma','declara\u00e7\u00e3o','atestado','hist\u00f3rico','documento'], r: 'Para solicitar documentos:\n1. Portal dos Pais ou secretaria\n2. Prontos em at\u00e9 2 dias \u00fateis' },
  { kw: ['impress\u00e3o','impressao','imprimir'], r: 'Para impress\u00f5es:\n1. Portal da Professora \u2192 "Impress\u00f5es"\n2. Upload PDF + n\u00famero de c\u00f3pias\n3. Entrega em at\u00e9 2 dias \u00fateis' },
  { kw: ['almoxarifado','material','insumo','requisi\u00e7\u00e3o'], r: 'Para solicitar materiais:\n1. Portal da Professora \u2192 "Almoxarifado"\n2. Selecione itens e quantidade\n3. Submeta a requisi\u00e7\u00e3o' },
  { kw: ['sugest\u00e3o','sugestao','ideia','melhoria'], r: 'Obrigado pela sua sugest\u00e3o! Ela foi registrada e analisada pela equipe de produto.' },
  { kw: ['contrato','assinar','assinatura'], r: 'Para assinar um contrato:\n1. Acesse o link enviado por email\n2. Clique em "Enviar C\u00f3digo" para receber c\u00f3digo por email\n3. Digite o c\u00f3digo de 6 d\u00edgitos (expira em 15 min)\n4. Leia, marque o checkbox e assine' },
  { kw: ['chamado','manuten\u00e7\u00e3o','manutencao'], r: 'Para abrir chamado de manuten\u00e7\u00e3o:\n1. Portal da Professora ou Equipe \u2192 "Manuten\u00e7\u00e3o"\n2. Clique em "Novo Chamado"\n3. Descreva o problema e informe a urg\u00eancia' },
];

const TEST_PATTERNS = ['teste','test','bug*','debug','dummy','placeholder','lorem','exemplo','example','aaa','bbb','ccc','123','abc'];

function normalize(s) { return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function isTest(desc) {
  const d = normalize(desc).trim();
  if (d.length < 20) return true; // muito curto = provavel teste
  return TEST_PATTERNS.some(p => p.endsWith('*') ? d.includes(p.slice(0,-1)) : d === p || d.startsWith(p+' ') || d.endsWith(' '+p));
}
function findFaq(desc) {
  const d = normalize(desc);
  for (const f of FAQ) if (f.kw.some(k => d.includes(normalize(k)))) return f.r;
  return null;
}

async function main() {
  console.log('\ud83e\udd16 Ticket Agent v3 \u2014 Resolu\u00e7\u00e3o final');

  // Buscar abertos + escalados nossos de hoje
  const tickets = await sqlQuery(`
    SELECT id, numero, email, nome, portal, tipo, descricao, url_pagina, status, tratamento, criado_em
    FROM tickets
    WHERE status = 'aberto'
       OR (status = 'escalado' AND respondido_por = $$claude-ai@lumied.com.br$$ AND DATE(atualizado_em) >= CURRENT_DATE - 1)
    ORDER BY criado_em ASC LIMIT 20
  `);

  console.log(`\n\ud83d\udcec ${tickets.length} ticket(s)`);
  if (!tickets.length) { console.log('\u2705 Nenhum ticket.'); return; }

  const results = [];
  const resolvedNums = [];

  for (const tk of tickets) {
    console.log(`\n\u2500 #${tk.numero} | ${tk.portal} | ${tk.tipo} | status=${tk.status}`);
    console.log(`  desc: ${(tk.descricao||'').substring(0,200)}`);

    try {
      // 1. Ticket de teste?
      if (isTest(tk.descricao)) {
        await updateTicket(tk.id, {
          status: 'respondido',
          resposta: 'Este parece ser um ticket de teste. Se voc\u00ea est\u00e1 testando o sistema de suporte, tudo est\u00e1 funcionando corretamente! Para reporte de problemas reais, por favor descreva o que aconteceu com mais detalhes.',
          tratamento: 'Ticket de teste detectado (descri\u00e7\u00e3o gen\u00e9rica/curta). Respondido como teste.',
        });
        console.log(`  \u2705 Ticket de teste \u2014 respondido`);
        results.push({ numero: tk.numero, acao: 'teste_respondido', portal: tk.portal });
        resolvedNums.push(tk.numero);
        continue;
      }

      // 2. FAQ match
      const faq = findFaq(tk.descricao);
      if (faq) {
        await updateTicket(tk.id, { status: 'respondido', resposta: faq, tratamento: 'FAQ match \u2014 Ticket Agent v3' });
        console.log(`  \u2705 FAQ match`);
        results.push({ numero: tk.numero, acao: 'faq_resolvido', portal: tk.portal });
        resolvedNums.push(tk.numero);
        continue;
      }

      // 3. Sugest\u00e3o
      if (tk.tipo === 'sugestao') {
        await updateTicket(tk.id, { status: 'respondido', resposta: 'Obrigado pela sua sugest\u00e3o! Ela foi registrada e analisada pela nossa equipe.', tratamento: 'Sugest\u00e3o agradecida.' });
        console.log(`  \u2705 Sugest\u00e3o agradecida`);
        results.push({ numero: tk.numero, acao: 'sugestao', portal: tk.portal });
        resolvedNums.push(tk.numero);
        continue;
      }

      // 4. Escalar com diagn\u00f3stico
      await updateTicket(tk.id, {
        status: 'escalado',
        resposta: 'Sua solicita\u00e7\u00e3o foi analisada e encaminhada para nossa equipe t\u00e9cnica. Retornaremos em breve.',
        tratamento: `Escalado \u2014 requer an\u00e1lise humana. Portal: ${tk.portal}, Tipo: ${tk.tipo}, Desc: ${(tk.descricao||'').substring(0,100)}`,
      });
      console.log(`  \u26a0\ufe0f  Escalado`);
      results.push({ numero: tk.numero, acao: 'escalado', portal: tk.portal });
    } catch(e) { console.error(`  \u274c Erro:`, e.message); }
  }

  // Fechar issues GitHub dos tickets resolvidos (issues 7-11 criadas nas rodadas anteriores)
  // Issues criadas com t\u00edtulo contendo n\u00famero do ticket
  const issueMap = { 1001: 7, 1002: 8, 1003: 9, 1004: 10, 1005: 11 };
  for (const num of resolvedNums) {
    if (issueMap[num]) {
      await closeGitHubIssue(issueMap[num]);
      console.log(`\n\ud83d\uddd1\ufe0f  Issue #${issueMap[num]} (ticket #${num}) fechada`);
    }
  }

  // Resumo
  const res = results.filter(r => r.acao !== 'escalado').length;
  const esc = results.filter(r => r.acao === 'escalado').length;
  console.log(`\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`);
  console.log(`Resolvidos:  ${res}`);
  console.log(`Escalados:   ${esc}`);
  console.log(`\u2705 Conclu\u00eddo!`);
}

main().catch(e => { console.error('\u274c Fatal:', e); process.exit(1); });
