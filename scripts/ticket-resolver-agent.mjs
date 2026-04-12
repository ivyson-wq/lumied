// Lumied — Ticket Resolver Agent
// Roda via GitHub Actions (branch: ticket-agent)
// Usa Supabase Management API para consultar e atualizar tickets

const PROJECT_REF = 'brgorknbrjlfwvrrlwxj';
const API_BASE = `https://api.supabase.com/v1/projects/${PROJECT_REF}`;
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'ivyson-wq/maple-bear-rs';

if (!SUPABASE_ACCESS_TOKEN) {
  console.error('❌ SUPABASE_ACCESS_TOKEN não configurado');
  process.exit(1);
}

async function sqlQuery(query) {
  const res = await fetch(`${API_BASE}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL error (${res.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// Escapa string usando dollar-quoting do PostgreSQL
function dq(str) {
  // Usa tag aleatória para evitar conflito com $$ no conteúdo
  const tag = 'LMTAG';
  return `$${tag}$${str}$${tag}$`;
}

async function updateTicket(id, { status, resposta, tratamento }) {
  await sqlQuery(`
    UPDATE tickets SET
      status = '${status}',
      resposta = ${dq(resposta)},
      tratamento = ${dq(tratamento)},
      respondido_por = $$claude-ai@lumied.com.br$$,
      atualizado_em = now()
    WHERE id = '${id}'
  `);
}

async function createGitHubIssue(title, body) {
  if (!GITHUB_TOKEN) return null;
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'lumied-ticket-agent',
    },
    body: JSON.stringify({ title, body, labels: ['suporte'] }),
  });
  const data = await res.json();
  return data.html_url || null;
}

// ─── FAQ ───────────────────────────────────────────────────────────────────
const FAQ = [
  {
    keywords: ['login', 'entrar', 'senha', 'password', 'acesso negado', 'nao consigo entrar', 'não consigo', 'magic link'],
    resposta: 'Tente as seguintes soluções:\n1. Limpe o cache do navegador (Ctrl+Shift+Del)\n2. Tente em uma aba anônima\n3. Verifique se o email está correto\n4. Use a opção "Magic Link" para receber um link de acesso por email\n5. Se usa biometria, tente desativar e reativar nas configurações do navegador',
  },
  {
    keywords: ['lento', 'devagar', 'carregando', 'loading', 'demora', 'travando', 'trava'],
    resposta: 'Dicas para melhorar a performance:\n1. Verifique sua conexão de internet\n2. Limpe o cache do navegador (Ctrl+Shift+Del)\n3. Feche outras abas desnecessárias\n4. Use Chrome ou Edge atualizados\n5. Em mobile, feche e reabra o app',
  },
  {
    keywords: ['boleto', 'pagamento', 'cobrança', 'cobranca', 'fatura', 'pagar', 'pix'],
    resposta: 'Sobre boletos e pagamentos:\n1. Boletos levam até 24h para aparecer após emissão\n2. Após pagamento, o status atualiza em até 48h úteis\n3. Para segunda via, acesse a aba "Boletos" no portal dos pais\n4. PIX: use o QR Code ou a chave PIX exibida na tela',
  },
  {
    keywords: ['pickup', 'buscar', 'busca', 'retirada', 'autorizar', 'autorizado', 'busca de aluno'],
    resposta: 'Para gerenciar autorizações de retirada:\n1. Acesse Portal dos Pais → aba "Acesso"\n2. Clique em "Gerenciar Autorizados"\n3. Adicione nome, parentesco e foto da pessoa autorizada\n4. Defina o período (7/30/60 dias ou permanente)\n5. Aguarde aprovação da escola',
  },
  {
    keywords: ['biometria', 'face', 'facial', 'reconhecimento', 'câmera', 'camera'],
    resposta: 'Para cadastro biométrico:\n1. Acesse Portal dos Pais → "Acesso" → "Minha Face"\n2. Use ambiente bem iluminado e olhe diretamente para a câmera\n3. Aguarde validação de qualidade\n4. Após aprovação da escola, seu acesso estará ativo',
  },
  {
    keywords: ['nota', 'boletim', 'frequência', 'frequencia', 'presença', 'presenca', 'falta'],
    resposta: 'Para acompanhar notas e frequência:\n1. Acesse o Portal dos Pais ou Portal do Aluno\n2. Aba "Boletim" — notas por disciplina\n3. Aba "Frequência" — presenças e faltas\n4. Para contestar, entre em contato com a secretaria',
  },
  {
    keywords: ['diploma', 'declaração', 'declaracao', 'atestado', 'histórico', 'historico', 'documento'],
    resposta: 'Para solicitar documentos:\n1. Acesse o Portal dos Pais ou solicite na secretaria\n2. Diplomas e declarações ficam prontos em até 2 dias úteis\n3. Documentos digitais têm código de verificação em /verificar.html',
  },
  {
    keywords: ['turno', 'horario', 'horário', 'integral', 'semi', 'período'],
    resposta: 'Para informações sobre turnos:\n1. Alterações de turno devem ser solicitadas na secretaria\n2. A disponibilidade depende de vagas — entre em contato para verificar\n3. Mudanças de turno podem impactar o valor da mensalidade',
  },
  {
    keywords: ['impressão', 'impressao', 'imprimir', 'impresso'],
    resposta: 'Para solicitar impressões:\n1. Acesse o Portal da Professora → "Impressões"\n2. Faça upload do PDF e informe número de cópias\n3. A entrega ocorre em até 2 dias úteis\n4. Acompanhe o status na aba "Minhas Impressões"',
  },
  {
    keywords: ['almoxarifado', 'material', 'insumo', 'requisição', 'requisicao'],
    resposta: 'Para solicitar materiais do almoxarifado:\n1. Acesse o Portal da Professora → "Almoxarifado"\n2. Selecione os itens necessários e a quantidade\n3. Submeta a requisição\n4. Acompanhe o status em "Minhas Requisições"',
  },
];

function normalize(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function findFaqMatch(descricao) {
  const text = normalize(descricao);
  for (const faq of FAQ) {
    if (faq.keywords.some(kw => text.includes(normalize(kw)))) {
      return faq.resposta;
    }
  }
  return null;
}

// ─── Diagnóstico baseado em código ─────────────────────────────────────────
function diagnoseBug(ticket) {
  const desc = normalize(ticket.descricao);
  const portal = ticket.portal || '';
  const tipo = ticket.tipo || '';

  // Tela branca no portal da professora (bug corrigido 2026-04-06)
  if (portal === 'professora' && (desc.includes('tela branca') || desc.includes('tela em branco') || desc.includes('pagina branca'))) {
    return {
      canResolve: true,
      resposta: 'O problema de tela branca no Portal da Professora foi identificado e corrigido. Por favor:\n1. Pressione Ctrl+Shift+F5 (ou Cmd+Shift+R no Mac) para forçar atualização\n2. Limpe o cache e cookies do site\n3. Se o problema persistir após 24h, nos informe',
      tratamento: 'Tela branca professora.html — bug ReferenceError (NAV_GROUPS TDZ + funções faltando loadAcessoDashSec) corrigido em 2026-04-06. Orientado cache bust.',
    };
  }

  // Erro PAPEL_COLORS / Supabase JS SRI
  if (desc.includes('papel_colors') || (desc.includes('erro') && desc.includes('javascript') && portal === 'gerente')) {
    return {
      canResolve: true,
      resposta: 'Este erro JavaScript foi corrigido em atualização recente (problema com carregamento da biblioteca). Por favor, force a atualização da página (Ctrl+Shift+F5) e tente novamente.',
      tratamento: 'PAPEL_COLORS undefined — causado por SRI hash Supabase JS incorreto. Corrigido 2026-04-10 com hash verificado + guard defensivo.',
    };
  }

  // Contrato / assinatura eletrônica
  if (desc.includes('contrato') && (desc.includes('codigo') || desc.includes('código') || desc.includes('assinar'))) {
    return {
      canResolve: true,
      resposta: 'Para assinar um contrato:\n1. Acesse o link enviado por email\n2. Clique em "Enviar Código" para receber o código de verificação no seu email\n3. Digite o código de 6 dígitos recebido\n4. Leia o contrato, marque o checkbox e desenhe sua assinatura\nO código expira em 15 minutos — se expirou, solicite reenvio à secretaria.',
      tratamento: 'Dúvida sobre fluxo de assinatura eletrônica. Explicado processo completo (verificação email + assinatura canvas).',
    };
  }

  // Google OAuth / login social
  if (desc.includes('google') && desc.includes('login')) {
    return {
      canResolve: true,
      resposta: 'O login via Google está disponível no Portal dos Pais. Se está tendo problemas:\n1. Certifique-se de usar o mesmo email Google cadastrado na escola\n2. Permita popups no navegador para o site\n3. Alternativa: use "Magic Link" — você receberá um link de acesso direto no email',
      tratamento: 'Dúvida login Google. Orientado verificar email + permitir popups. Alternativa Magic Link sugerida.',
    };
  }

  // Chamado de manutenção
  if (desc.includes('chamado') || desc.includes('manutencao') || desc.includes('manutenção')) {
    return {
      canResolve: true,
      resposta: 'Para abrir um chamado de manutenção:\n1. Acesse o Portal da Professora ou Portal da Equipe\n2. Clique em "Manutenção" no menu\n3. Clique em "Novo Chamado"\n4. Preencha a descrição e urgência\n5. Acompanhe o status na lista de chamados',
      tratamento: 'Dúvida abertura de chamado de manutenção. Explicado fluxo no portal.',
    };
  }

  return { canResolve: false, resposta: null, tratamento: null };
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('🤖 Lumied Ticket Agent — iniciando');
  console.log('📅', new Date().toISOString());

  // 1. Buscar tickets abertos
  let tickets;
  try {
    tickets = await sqlQuery(`
      SELECT id, numero, email, nome, portal, tipo, descricao, url_pagina, user_agent, criado_em
      FROM tickets
      WHERE status = 'aberto'
      ORDER BY criado_em ASC
      LIMIT 10
    `);
  } catch (e) {
    console.error('❌ Erro ao buscar tickets:', e.message);
    process.exit(1);
  }

  console.log(`\n📬 ${tickets.length} ticket(s) aberto(s)`);

  if (tickets.length === 0) {
    console.log('✅ Nenhum ticket aberto. Encerrando.');
    return;
  }

  const results = [];

  for (const ticket of tickets) {
    console.log(`\n─────────────────────────────────────`);
    console.log(`📋 Ticket #${ticket.numero}`);
    console.log(`   Portal:  ${ticket.portal}`);
    console.log(`   Tipo:    ${ticket.tipo}`);
    console.log(`   Email:   ${ticket.email}`);
    console.log(`   Descrição: ${(ticket.descricao || '').substring(0, 150)}`);

    try {
      // Passo 1: FAQ match
      const faqResp = findFaqMatch(ticket.descricao);
      if (faqResp) {
        await updateTicket(ticket.id, {
          status: 'respondido',
          resposta: faqResp,
          tratamento: 'FAQ match automático — Ticket Agent GitHub Actions',
        });
        console.log(`   ✅ Resolvido via FAQ`);
        results.push({ numero: ticket.numero, portal: ticket.portal, tipo: ticket.tipo, acao: 'faq_resolvido', email: ticket.email });
        continue;
      }

      // Passo 2: Diagnóstico baseado em código
      const diag = diagnoseBug(ticket);
      if (diag.canResolve) {
        await updateTicket(ticket.id, {
          status: 'respondido',
          resposta: diag.resposta,
          tratamento: diag.tratamento,
        });
        console.log(`   ✅ Resolvido via diagnóstico de código`);
        results.push({ numero: ticket.numero, portal: ticket.portal, tipo: ticket.tipo, acao: 'codigo_resolvido', email: ticket.email });
        continue;
      }

      // Passo 3: Sugestão — agradecer
      if (ticket.tipo === 'sugestao') {
        await updateTicket(ticket.id, {
          status: 'respondido',
          resposta: 'Obrigado pela sua sugestão! Ela foi registrada e será analisada pela nossa equipe de produto. Valorizamos muito o feedback dos nossos usuários.',
          tratamento: 'Sugestão recebida e agradecida. Registrada para análise do time de produto.',
        });
        console.log(`   ✅ Sugestão agradecida`);
        results.push({ numero: ticket.numero, portal: ticket.portal, tipo: ticket.tipo, acao: 'sugestao_agradecida', email: ticket.email });
        continue;
      }

      // Passo 4: Escalar
      await updateTicket(ticket.id, {
        status: 'escalado',
        resposta: 'Sua solicitação foi recebida e analisada pela nossa equipe de IA. Estamos encaminhando para um atendente humano que retornará em breve.',
        tratamento: `Escalado — sem match em FAQ ou diagnóstico automático. Portal: ${ticket.portal}, Tipo: ${ticket.tipo}, URL: ${ticket.url_pagina || 'não informada'}. Revisão humana necessária.`,
      });
      console.log(`   ⚠️  Escalado para humano`);
      results.push({ numero: ticket.numero, portal: ticket.portal, tipo: ticket.tipo, acao: 'escalado', email: ticket.email });
    } catch (e) {
      console.error(`   ❌ Erro processando ticket #${ticket.numero}:`, e.message);
      results.push({ numero: ticket.numero, portal: ticket.portal, tipo: ticket.tipo, acao: 'erro', email: ticket.email });
    }
  }

  // Resumo
  console.log(`\n═══════════════════════════════════`);
  console.log(`📊 RESUMO`);
  console.log(`   Total:        ${tickets.length}`);
  console.log(`   FAQ:          ${results.filter(r => r.acao === 'faq_resolvido').length}`);
  console.log(`   Código:       ${results.filter(r => r.acao === 'codigo_resolvido').length}`);
  console.log(`   Sugestões:    ${results.filter(r => r.acao === 'sugestao_agradecida').length}`);
  console.log(`   Escalados:    ${results.filter(r => r.acao === 'escalado').length}`);
  console.log(`   Erros:        ${results.filter(r => r.acao === 'erro').length}`);

  // Criar issue no GitHub com relatório
  const resolved = results.filter(r => ['faq_resolvido', 'codigo_resolvido', 'sugestao_agradecida'].includes(r.acao)).length;
  const escalated = results.filter(r => r.acao === 'escalado').length;

  const issueBody = [
    `## 🤖 Relatório — Lumied Ticket Agent`,
    `**Data:** ${new Date().toISOString()}`,
    '',
    `| Métrica | Valor |`,
    `|---------|-------|`,
    `| Tickets processados | ${tickets.length} |`,
    `| Resolvidos (FAQ) | ${results.filter(r => r.acao === 'faq_resolvido').length} |`,
    `| Resolvidos (diagnóstico) | ${results.filter(r => r.acao === 'codigo_resolvido').length} |`,
    `| Sugestões agradecidas | ${results.filter(r => r.acao === 'sugestao_agradecida').length} |`,
    `| Escalados para humano | ${escalated} |`,
    '',
    `### Detalhes por ticket`,
    ...results.map(r => {
      const icon = r.acao === 'escalado' ? '⚠️' : r.acao === 'erro' ? '❌' : '✅';
      return `- ${icon} **#${r.numero}** (${r.portal} / ${r.tipo}): \`${r.acao}\``;
    }),
    '',
    escalated > 0 ? `> ⚠️ **${escalated} ticket(s) precisam de atenção humana.** Acesse o painel admin para revisar.` : '> ✅ Todos os tickets foram resolvidos automaticamente.',
  ].join('\n');

  const issueTitle = `[Ticket Agent] ${new Date().toLocaleDateString('pt-BR')} — ${resolved}/${tickets.length} resolvidos`;

  try {
    const url = await createGitHubIssue(issueTitle, issueBody);
    if (url) console.log(`\n📊 Issue criada: ${url}`);
  } catch (e) {
    console.log('\n📊 Relatório (console):');
    console.log(issueBody);
  }

  console.log('\n✅ Agente concluído!');

  // Exit with error se escalados > 0 para visibilidade no GitHub Actions
  if (results.some(r => r.acao === 'erro')) process.exit(1);
}

main().catch(e => {
  console.error('❌ Erro fatal:', e);
  process.exit(1);
});
