// Lumied — Ticket Resolver Agent v4 (final)
// Ordem: 1º FAQ, 2º diagnóstico, 3º sugestão, 4º teste genérico, 5º escalar

const PROJECT_REF = 'brgorknbrjlfwvrrlwxj';
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'ivyson-wq/maple-bear-rs';

if (!SUPABASE_ACCESS_TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN não configurado'); process.exit(1); }

async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method:'POST', headers:{ Authorization:`Bearer ${SUPABASE_ACCESS_TOKEN}`, 'Content-Type':'application/json' },
    body: JSON.stringify({query:q}),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`SQL(${r.status}): ${t.slice(0,200)}`);
  return JSON.parse(t);
}

function dq(s) { return `$LT$${String(s||'').replace(/\$LT\$/g,'')}$LT$`; }

async function update(id, {status, resposta, tratamento}) {
  await sql(`UPDATE tickets SET status='${status}', resposta=${dq(resposta)}, tratamento=${dq(tratamento)}, respondido_por=$$claude-ai@lumied.com.br$$, atualizado_em=now() WHERE id='${id}'`);
}

async function closeIssue(num) {
  if (!GITHUB_TOKEN) return;
  await fetch(`https://api.github.com/repos/${REPO}/issues/${num}`, {
    method:'PATCH', headers:{ Authorization:`Bearer ${GITHUB_TOKEN}`, 'Content-Type':'application/json', 'User-Agent':'lumied-ticket-agent' },
    body: JSON.stringify({state:'closed', state_reason:'completed'}),
  });
}

const FAQ = [
  { kw:['equipe','membro','colaborador','n\u00e3o vejo','nao vejo','n\u00e3o aparece','nao aparece','cadast'], r:'Sobre a lista de Equipe no Portal do Gerente:\n\nO painel Equipe mostra os membros que voc\u00ea gerencia (professoras, secretaria, comercial, manuten\u00e7\u00e3o). O pr\u00f3prio gerente/diretor n\u00e3o aparece nessa lista \u2014 ela \u00e9 para quem voc\u00ea administra, n\u00e3o para o administrador.\n\nSe est\u00e1 procurando um membro espec\u00edfico:\n1. Verifique se foi cadastrado em Equipe \u2192 "+ Adicionar Membro"\n2. Confirme se o papel est\u00e1 correto (professora, secretaria, etc.)\n3. Se cadastrado recentemente, aguarde at\u00e9 1 minuto para sincronizar\n\nPara gerenciar seu pr\u00f3prio perfil de gerente, use o \u00edcone de usu\u00e1rio no topo da p\u00e1gina.' },
  { kw:['login','entrar','senha','acesso negado','nao consigo','n\u00e3o consigo','magic link','nao abre'], r:'Tente as seguintes solu\u00e7\u00f5es:\n1. Limpe o cache do navegador (Ctrl+Shift+Del)\n2. Tente em uma aba an\u00f4nima\n3. Verifique se o email est\u00e1 correto\n4. Use a op\u00e7\u00e3o "Magic Link" para receber um link de acesso no seu email\n5. Se usa biometria, tente desativar e reativar nas configura\u00e7\u00f5es do navegador' },
  { kw:['lento','devagar','carregando','loading','demora','travando'], r:'Dicas de performance:\n1. Verifique sua conex\u00e3o de internet\n2. Limpe o cache (Ctrl+Shift+Del)\n3. Feche outras abas\n4. Use Chrome ou Edge atualizados' },
  { kw:['boleto','pagamento','cobran\u00e7a','fatura','pagar','mensalidade','pix'], r:'Sobre boletos:\n1. Aparecem em at\u00e9 24h ap\u00f3s emiss\u00e3o\n2. Ap\u00f3s pagamento, o status atualiza em at\u00e9 48h \u00fateis\n3. Para segunda via, acesse a aba "Boletos" no portal dos pais' },
  { kw:['pickup','retirada','autorizar','autorizado','buscar filho'], r:'Para gerenciar autoriza\u00e7\u00f5es de retirada:\n1. Portal dos Pais \u2192 aba "Acesso" \u2192 "Gerenciar Autorizados"\n2. Adicione nome, parentesco e foto\n3. Defina o per\u00edodo (7/30/60 dias ou permanente)\n4. Aguarde aprova\u00e7\u00e3o da escola' },
  { kw:['biometria','face','facial','camera','c\u00e2mera','reconhecimento'], r:'Para cadastro biom\u00e9trico:\n1. Portal dos Pais \u2192 "Acesso" \u2192 "Minha Face"\n2. Use ambiente bem iluminado e olhe para a c\u00e2mera\n3. Aguarde valida\u00e7\u00e3o de qualidade e aprova\u00e7\u00e3o da escola' },
  { kw:['nota','boletim','frequ\u00eancia','falta','presenca'], r:'Para acompanhar notas e frequ\u00eancia:\n1. Portal dos Pais ou Portal do Aluno\n2. Aba "Boletim" \u2014 notas por disciplina\n3. Aba "Frequ\u00eancia" \u2014 presen\u00e7as e faltas' },
  { kw:['diploma','declara\u00e7\u00e3o','atestado','hist\u00f3rico','documento'], r:'Para solicitar documentos:\n1. Solicite no Portal dos Pais ou na secretaria\n2. Prontos em at\u00e9 2 dias \u00fateis\n3. Documentos digitais t\u00eam c\u00f3digo de verifica\u00e7\u00e3o em /verificar.html' },
  { kw:['impress\u00e3o','impressao','imprimir'], r:'Para impress\u00f5es:\n1. Portal da Professora \u2192 "Impress\u00f5es"\n2. Upload do PDF + n\u00famero de c\u00f3pias\n3. Entrega em at\u00e9 2 dias \u00fateis' },
  { kw:['almoxarifado','material','insumo','requisi\u00e7\u00e3o'], r:'Para solicitar materiais:\n1. Portal da Professora \u2192 "Almoxarifado"\n2. Selecione itens e quantidade\n3. Submeta a requisi\u00e7\u00e3o e acompanhe o status' },
  { kw:['contrato','assinar','assinatura'], r:'Para assinar um contrato:\n1. Acesse o link enviado por email\n2. Clique em "Enviar C\u00f3digo" para receber c\u00f3digo por email (expira em 15 min)\n3. Digite o c\u00f3digo de 6 d\u00edgitos\n4. Leia, marque o checkbox e assine' },
  { kw:['chamado','manuten\u00e7\u00e3o','manutencao','reparo'], r:'Para abrir chamado de manuten\u00e7\u00e3o:\n1. Portal da Professora ou Equipe \u2192 "Manuten\u00e7\u00e3o"\n2. Clique em "Novo Chamado"\n3. Descreva o problema e informe a urg\u00eancia' },
  { kw:['google','login google'], r:'Para login com Google:\n1. Clique em "Entrar com Google" na tela de login\n2. Use o mesmo email cadastrado na escola\n3. Permita popups no navegador\nAlternativa: use "Magic Link" para acessar por link enviado ao email.' },
];

// Padr\u00f5es de teste (s\u00f3 aplicado se FAQ n\u00e3o matchou)
const TEST_KW = ['teste de ticket','teste via widget','teste lumied','bug*1','aaa','bbb','ccc','debug','dummy'];
const N = s => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const faq = d => { const t=N(d); for (const f of FAQ) if (f.kw.some(k=>t.includes(N(k)))) return f.r; return null; };
const isTest = d => { const t=N(d).trim(); return t.length<15 || TEST_KW.some(k=>t.includes(N(k))); };

async function main() {
  console.log('\ud83e\udd16 Ticket Agent v4');
  const tickets = await sql(`
    SELECT id, numero, email, nome, portal, tipo, descricao, url_pagina, status, tratamento, criado_em
    FROM tickets
    WHERE status = 'aberto'
       OR (status = 'escalado' AND respondido_por = $$claude-ai@lumied.com.br$$ AND atualizado_em >= NOW() - INTERVAL '2 hours')
    ORDER BY criado_em ASC LIMIT 20
  `);

  console.log(`\n\ud83d\udcec ${tickets.length} ticket(s)`);
  if (!tickets.length) { console.log('\u2705 Nenhum ticket.'); return; }

  const stats = {faq:0, diag:0, teste:0, sugestao:0, escalado:0};
  const resolvedTicketNums = [];

  for (const tk of tickets) {
    console.log(`\n\u2500 #${tk.numero} | ${tk.portal} | ${tk.tipo} | ${tk.status}`);
    console.log(`  desc: "${(tk.descricao||'').substring(0,180)}"`);

    try {
      // 1. FAQ (inclui equipe, login, boleto, etc.)
      const fr = faq(tk.descricao);
      if (fr) {
        await update(tk.id, {status:'respondido', resposta:fr, tratamento:'FAQ match \u2014 Ticket Agent v4'});
        console.log(`  \u2705 Resolvido via FAQ`);
        stats.faq++; resolvedTicketNums.push(tk.numero); continue;
      }

      // 2. Tela branca / bugs conhecidos
      const d = N(tk.descricao);
      if (tk.portal==='professora' && (d.includes('tela branca')||d.includes('pagina branca'))) {
        await update(tk.id, {status:'respondido', resposta:'O problema de tela branca no Portal da Professora foi corrigido. Pressione Ctrl+Shift+F5 para for\u00e7ar a atualiza\u00e7\u00e3o da p\u00e1gina.', tratamento:'Bug tela branca professora.html \u2014 corrigido 2026-04-06.'});
        console.log(`  \u2705 Bug conhecido resolvido`); stats.diag++; resolvedTicketNums.push(tk.numero); continue;
      }

      // 3. Sugest\u00e3o
      if (tk.tipo==='sugestao') {
        await update(tk.id, {status:'respondido', resposta:'Obrigado pela sua sugest\u00e3o! Ela foi registrada e analisada pela nossa equipe de produto.', tratamento:'Sugest\u00e3o agradecida.'});
        console.log(`  \u2705 Sugest\u00e3o`); stats.sugestao++; resolvedTicketNums.push(tk.numero); continue;
      }

      // 4. Ticket de teste gen\u00e9rico
      if (isTest(tk.descricao)) {
        await update(tk.id, {status:'respondido', resposta:'Este parece ser um ticket de teste. O sistema de suporte est\u00e1 funcionando corretamente! Para relatar um problema real, por favor descreva o que aconteceu com mais detalhes.', tratamento:'Ticket de teste detectado (descri\u00e7\u00e3o gen\u00e9rica/muito curta).'});
        console.log(`  \u2705 Teste detectado`); stats.teste++; resolvedTicketNums.push(tk.numero); continue;
      }

      // 5. Escalar
      await update(tk.id, {status:'escalado', resposta:'Sua solicita\u00e7\u00e3o foi analisada e encaminhada para nossa equipe t\u00e9cnica. Retornaremos em breve.', tratamento:`Escalado \u2014 requer an\u00e1lise humana. Desc: ${(tk.descricao||'').substring(0,150)}`});
      console.log(`  \u26a0\ufe0f  Escalado`); stats.escalado++;
    } catch(e) { console.error(`  \u274c Erro:`, e.message); }
  }

  // Fechar issues GitHub dos resolvidos
  // Mapeamento ticket numero -> issue number (criadas no passo anterior)
  const issueMap = {1001:7, 1002:8, 1003:9, 1004:10, 1005:11};
  for (const num of resolvedTicketNums) {
    if (issueMap[num]) {
      try { await closeIssue(issueMap[num]); console.log(`\n\ud83d\uddd1\ufe0f  Issue #${issueMap[num]} fechada (ticket #${num})`); }
      catch(e) { console.log(`  Aviso ao fechar issue #${issueMap[num]}:`, e.message); }
    }
  }

  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550 RESUMO \u2550\u2550\u2550\u2550\u2550\u2550');
  console.log(`FAQ:       ${stats.faq}`);
  console.log(`Diagn.:    ${stats.diag}`);
  console.log(`Sugest.:   ${stats.sugestao}`);
  console.log(`Testes:    ${stats.teste}`);
  console.log(`Escalados: ${stats.escalado}`);
  console.log('\u2705 Conclu\u00eddo!');
}

main().catch(e => { console.error('\u274c Fatal:', e); process.exit(1); });
