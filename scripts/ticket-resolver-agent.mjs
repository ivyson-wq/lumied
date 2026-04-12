// Lumied — Ticket Resolver Agent v2
// Fase 2: Diagnóstico detalhado dos tickets escalados
// Leia as descrições completas, tente resolver com mais heurísticas,
// crie issues detalhadas no GitHub para os que precisam de atenção humana.

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

function dq(str) { const t = 'LT'; return `$${t}$${String(str || '').replace(new RegExp('\\$'+t+'\\$','g'), '')}$${t}$`; }

async function updateTicket(id, { status, resposta, tratamento }) {
  await sqlQuery(`UPDATE tickets SET status='${status}', resposta=${dq(resposta)}, tratamento=${dq(tratamento)}, respondido_por=$$claude-ai@lumied.com.br$$, atualizado_em=now() WHERE id='${id}'`);
}

async function createGitHubIssue(title, body, labels) {
  if (!GITHUB_TOKEN) return null;
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'lumied-ticket-agent' },
    body: JSON.stringify({ title, body, labels: labels || ['suporte'] }),
  });
  const data = await res.json();
  return data.html_url || null;
}

// FAQ extendido
const FAQ = [
  { keywords: ['login','entrar','senha','password','acesso negado','nao consigo','n\u00e3o consigo','magic link','nao abre','n\u00e3o abre'], resposta: 'Tente as seguintes solu\u00e7\u00f5es:\n1. Limpe o cache do navegador (Ctrl+Shift+Del)\n2. Tente em uma aba an\u00f4nima\n3. Verifique se o email est\u00e1 correto\n4. Use a op\u00e7\u00e3o "Magic Link" para receber um link de acesso por email\n5. Se usa biometria, tente desativar e reativar nas configura\u00e7\u00f5es do navegador' },
  { keywords: ['lento','devagar','carregando','loading','demora','travando','trava','congela'], resposta: 'Dicas de performance:\n1. Verifique sua conex\u00e3o de internet\n2. Limpe o cache do navegador (Ctrl+Shift+Del)\n3. Feche outras abas\n4. Use Chrome ou Edge atualizados\n5. Em mobile, feche e reabra o app' },
  { keywords: ['boleto','pagamento','cobran\u00e7a','cobranca','fatura','pagar','pix','mensalidade'], resposta: 'Sobre boletos e pagamentos:\n1. Boletos levam at\u00e9 24h para aparecer\n2. Ap\u00f3s pagamento, o status atualiza em at\u00e9 48h \u00fateis\n3. Para segunda via, acesse a aba "Boletos" no portal dos pais\n4. PIX: use o QR Code ou a chave PIX exibida na tela' },
  { keywords: ['pickup','buscar','busca','retirada','autorizar','autorizado'], resposta: 'Para gerenciar autoriza\u00e7\u00f5es de retirada:\n1. Acesse Portal dos Pais \u2192 aba "Acesso"\n2. Clique em "Gerenciar Autorizados"\n3. Adicione nome, parentesco e foto\n4. Defina o per\u00edodo\n5. Aguarde aprova\u00e7\u00e3o da escola' },
  { keywords: ['biometria','face','facial','reconhecimento','c\u00e2mera','camera'], resposta: 'Para cadastro biom\u00e9trico:\n1. Portal dos Pais \u2192 "Acesso" \u2192 "Minha Face"\n2. Use ambiente bem iluminado\n3. Olhe diretamente para a c\u00e2mera\n4. Aguarde valida\u00e7\u00e3o de qualidade' },
  { keywords: ['nota','boletim','frequ\u00eancia','frequencia','presen\u00e7a','presenca','falta'], resposta: 'Para acompanhar notas e frequ\u00eancia:\n1. Acesse Portal dos Pais ou Portal do Aluno\n2. Aba "Boletim" \u2014 notas por disciplina\n3. Aba "Frequ\u00eancia" \u2014 presen\u00e7as e faltas\n4. Para contestar, entre em contato com a secretaria' },
  { keywords: ['diploma','declara\u00e7\u00e3o','declaracao','atestado','hist\u00f3rico','historico','documento'], resposta: 'Para solicitar documentos:\n1. Solicite no Portal dos Pais ou na secretaria\n2. Documentos ficam prontos em at\u00e9 2 dias \u00fateis\n3. Documentos digitais t\u00eam c\u00f3digo de verifica\u00e7\u00e3o em /verificar.html' },
  { keywords: ['turno','horario','hor\u00e1rio','integral','semi','per\u00edodo'], resposta: 'Sobre turnos:\n1. Altera\u00e7\u00f5es devem ser solicitadas na secretaria\n2. Disponibilidade depende de vagas\n3. Mudan\u00e7as de turno podem impactar a mensalidade' },
  { keywords: ['impress\u00e3o','impressao','imprimir'], resposta: 'Para impress\u00f5es:\n1. Portal da Professora \u2192 "Impress\u00f5es"\n2. Upload do PDF + n\u00famero de c\u00f3pias\n3. Entrega em at\u00e9 2 dias \u00fateis' },
  { keywords: ['almoxarifado','material','insumo','requisi\u00e7\u00e3o','requisicao'], resposta: 'Para solicitar materiais:\n1. Portal da Professora \u2192 "Almoxarifado"\n2. Selecione itens e quantidade\n3. Submeta a requisi\u00e7\u00e3o' },
  { keywords: ['contrato','assinar','assinatura','c\u00f3digo de verifica\u00e7\u00e3o','codigo de verificacao'], resposta: 'Para assinar um contrato:\n1. Acesse o link enviado por email\n2. Clique em "Enviar C\u00f3digo" para receber c\u00f3digo no email\n3. Digite o c\u00f3digo de 6 d\u00edgitos\n4. Leia, marque o checkbox e assine\nO c\u00f3digo expira em 15 minutos.' },
  { keywords: ['calendario','agenda','evento','atividade'], resposta: 'Para acessar o calend\u00e1rio:\n1. Acesse o Portal dos Pais ou Portal da Professora\n2. Clique em "Agenda" ou "Calend\u00e1rio" no menu\n3. Os eventos escolares s\u00e3o publicados pela secretaria' },
  { keywords: ['chamado','manuten\u00e7\u00e3o','manutencao','reparo'], resposta: 'Para abrir chamado de manuten\u00e7\u00e3o:\n1. Portal da Professora ou Equipe \u2192 "Manuten\u00e7\u00e3o"\n2. Clique em "Novo Chamado"\n3. Descreva o problema e informe a urg\u00eancia' },
  { keywords: ['sugest\u00e3o','sugestao','ideia','melhoria'], resposta: 'Obrigado pela sugest\u00e3o! Ela foi registrada e ser\u00e1 analisada pela nossa equipe de produto.' },
  { keywords: ['google','login google','entrar com google'], resposta: 'Para login com Google:\n1. Clique em "Entrar com Google" na tela de login\n2. Certifique-se de usar o mesmo email cadastrado na escola\n3. Permita popups no navegador\nAlternativa: use "Magic Link" para receber um link por email.' },
];

function normalize(str) { return (str||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function findFaqMatch(desc) {
  const t = normalize(desc);
  for (const f of FAQ) if (f.keywords.some(k => t.includes(normalize(k)))) return f.resposta;
  return null;
}

function diagnoseBug(ticket) {
  const d = normalize(ticket.descricao); const p = ticket.portal||''; const tp = ticket.tipo||'';
  if (p==='professora'&&(d.includes('tela branca')||d.includes('tela em branco')||d.includes('pagina branca')))
    return { ok:true, r:'O problema de tela branca no Portal da Professora foi corrigido. Pressione Ctrl+Shift+F5 para atualizar.', t:'Tela branca professora.html \u2014 corrigido 2026-04-06.' };
  if (d.includes('papel_colors')||d.includes('supabase')&&d.includes('erro'))
    return { ok:true, r:'Erro JavaScript corrigido em atualiza\u00e7\u00e3o recente. Pressione Ctrl+Shift+F5 e tente novamente.', t:'SRI Supabase JS \u2014 corrigido 2026-04-10.' };
  if (d.includes('pix')&&(d.includes('recusado')||d.includes('erro')||d.includes('nao funciona')))
    return { ok:true, r:'Problema com PIX/QR Code foi corrigido. Por favor tente gerar novamente.', t:'PIX CRC16 \u2014 corrigido 2026-04-10.' };
  if (tp==='sugestao'||d.includes('sugestao')||d.includes('sugest\u00e3o'))
    return { ok:true, r:'Obrigado pela sua sugest\u00e3o! Ela foi registrada para an\u00e1lise do time de produto.', t:'Sugest\u00e3o recebida.' };
  if (d.includes('duvida')||d.includes('d\u00favida')||tp==='duvida')
    return { ok:false };
  return { ok:false };
}

async function main() {
  console.log('\ud83e\udd16 Ticket Agent v2 \u2014 Diagn\u00f3stico detalhado');

  // Buscar tickets ABERTOS (novos desde a \u00faltima rodada) + ESCALADOS por n\u00f3s
  const tickets = await sqlQuery(`
    SELECT id, numero, email, nome, portal, tipo, descricao, url_pagina, user_agent, criado_em, status, tratamento
    FROM tickets
    WHERE (status = 'aberto')
       OR (status = 'escalado' AND respondido_por = $$claude-ai@lumied.com.br$$ AND DATE(atualizado_em) = CURRENT_DATE)
    ORDER BY criado_em ASC
    LIMIT 20
  `);

  console.log(`\n\ud83d\udcec ${tickets.length} ticket(s) para processar`);
  if (!tickets.length) { console.log('\u2705 Nenhum ticket pendente.'); return; }

  const resolved = [], escalated = [];

  for (const tk of tickets) {
    console.log(`\n\u2500 Ticket #${tk.numero} | ${tk.portal} | ${tk.tipo} | ${tk.status}`);
    console.log(`  Descri\u00e7\u00e3o: ${(tk.descricao||'').substring(0,200)}`);

    try {
      if (tk.status === 'escalado') {
        // Segundo passe nos escalados: FAQ extendido
        const faq = findFaqMatch(tk.descricao);
        if (faq) {
          await updateTicket(tk.id, { status:'respondido', resposta:faq, tratamento:'FAQ match (passe 2) \u2014 Ticket Agent v2' });
          console.log(`  \u2705 Resolvido via FAQ (passe 2)`);
          resolved.push(tk);
        } else {
          const d = diagnoseBug(tk);
          if (d.ok) {
            await updateTicket(tk.id, { status:'respondido', resposta:d.r, tratamento:d.t });
            console.log(`  \u2705 Resolvido via diagn\u00f3stico`);
            resolved.push(tk);
          } else {
            console.log(`  \u26a0\ufe0f  Mantido como escalado`);
            escalated.push(tk);
          }
        }
      } else {
        // Novo ticket aberto
        const faq = findFaqMatch(tk.descricao);
        if (faq) {
          await updateTicket(tk.id, { status:'respondido', resposta:faq, tratamento:'FAQ match \u2014 Ticket Agent v2' });
          console.log(`  \u2705 Resolvido via FAQ`);
          resolved.push(tk);
        } else {
          const d = diagnoseBug(tk);
          if (d.ok) {
            await updateTicket(tk.id, { status:'respondido', resposta:d.r, tratamento:d.t });
            console.log(`  \u2705 Resolvido via diagn\u00f3stico`);
            resolved.push(tk);
          } else {
            await updateTicket(tk.id, { status:'escalado', resposta:'Sua solicita\u00e7\u00e3o foi recebida e encaminhada para nossa equipe. Retornaremos em breve.', tratamento:`Escalado \u2014 sem match. Portal: ${tk.portal}, Tipo: ${tk.tipo}` });
            console.log(`  \u26a0\ufe0f  Escalado`);
            escalated.push(tk);
          }
        }
      }
    } catch(e) { console.error(`  \u274c Erro:`, e.message); }
  }

  // Criar issue detalhada para cada ticket escalado
  for (const tk of escalated) {
    const body = [
      `## Ticket #${tk.numero} precisa de aten\u00e7\u00e3o humana`,
      '',
      `| Campo | Valor |`,
      `|-------|-------|`,
      `| N\u00famero | #${tk.numero} |`,
      `| Portal | ${tk.portal} |`,
      `| Tipo | ${tk.tipo} |`,
      `| Email | ${tk.email} |`,
      `| Nome | ${tk.nome||'N/A'} |`,
      `| URL | ${tk.url_pagina||'N/A'} |`,
      `| Data | ${tk.criado_em} |`,
      '',
      `### Descri\u00e7\u00e3o do usu\u00e1rio`,
      '```',
      tk.descricao || '(sem descri\u00e7\u00e3o)',
      '```',
      '',
      `### Diagn\u00f3stico do agente`,
      tk.tratamento || 'Sem match em FAQ ou padr\u00f5es conhecidos.',
      '',
      `### Pr\u00f3ximos passos`,
      `- [ ] Revisar descri\u00e7\u00e3o acima`,
      `- [ ] Verificar logs no Sentry para erros relacionados`,
      `- [ ] Responder o usu\u00e1rio via painel admin em \`admin.lumied.com.br\``,
      `- [ ] Fechar esta issue ap\u00f3s resolver`,
    ].join('\n');

    const url = await createGitHubIssue(
      `[Suporte #${tk.numero}] ${tk.tipo} no ${tk.portal} \u2014 revis\u00e3o humana necess\u00e1ria`,
      body,
      ['suporte', 'escalado']
    );
    if (url) console.log(`  \ud83d\udccc Issue criada: ${url}`);
  }

  // Resumo final
  console.log(`\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550 RESUMO FINAL \u2550\u2550\u2550\u2550\u2550\u2550\u2550`);
  console.log(`Resolvidos:  ${resolved.length}`);
  console.log(`Escalados:   ${escalated.length}`);
  console.log('\u2705 Conclu\u00eddo!');
}

main().catch(e => { console.error('\u274c Fatal:', e); process.exit(1); });
