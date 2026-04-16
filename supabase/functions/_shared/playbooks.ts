// ═══════════════════════════════════════════════════════
//  Shared: Playbooks GTM + CS — base de conhecimento
//  para perguntas comerciais/pós-venda na IA Lumi
// ═══════════════════════════════════════════════════════
//
// Fonte original: PLAYBOOK.md + scripts/outbound-templates.md + CS_PLAYBOOK.md
// Versão condensada com regras de decisão, pricing, objeções e scripts.
// Atualizar aqui quando os docs originais mudarem de versão.

export const PLAYBOOK_GTM = `
PLAYBOOK COMERCIAL LUMIED (resumido — fonte: PLAYBOOK.md)

=== ICP PRIMÁRIO ===
• Porte: 150-500 alunos
• Segmento: Educação Infantil + Fundamental I/II, bilíngues e franqueadas (Maple Bear, Objetivo)
• Sistema atual: Sponte, Escolaweb, ClassApp, Diário Escola, planilhas
• Dor: fragmentação (3-5 sistemas), boleto manual, comunicação WhatsApp pessoal
• Ticket: R$ 12k-40k/ano
• Geo: RS, SC, PR → SP, MG → LATAM

ICP SECUNDÁRIO: Redes/franquias 2-10 unidades (desconto 15%)

ANTI-ICP: escolas >1500 (ERP corporativo), cursos livres/técnicos, creches <50 alunos

=== POSICIONAMENTO ===
"A plataforma completa que substitui Sponte, Escolaweb e 5 planilhas — com o painel que o gestor abre todo dia e o app que o pai escolhe abrir."

3 provas: (1) pilotos reais em produção, (2) IA Lumi embarcada, (3) 4 tiers com migração gratuita.
Arma competitiva: landing /vs/escolaweb/

=== FUNIL (metas mensais meses 1-3) ===
60 MQL → 25 reuniões → 18 demos → 10 propostas → 5 matrículas
MRR adicional: R$ 8k-15k/mês
Conversão-alvo: MQL → Matrícula = 8%

=== PRICING (4 tiers) ===
• Starter:   R$ 790/mês (anual R$ 632) — 200 alunos, 12 módulos básicos — substituto Sponte/Escolaweb
• Start:     R$ 1.200/mês (anual R$ 960) — 300 alunos, 15 módulos — gestão completa
• Evolução:  R$ 1.800/mês (anual R$ 1.440) — 800 alunos, 23 módulos + 500 WhatsApp/mês — IA+WhatsApp+Compliance
• Prestige:  R$ 3.300/mês (anual R$ 2.640) — ilimitado + 2000 WhatsApp/mês — Rede+RH+Face ID

WhatsApp travas: 80% alerta, 95% urgente, 100% bloqueio.
Resp financeiro IMUTÁVEL após setup (só staff altera).

=== DESCONTOS (travas) ===
• Pagamento anual antecipado: até 20% off (aprov. SDR/Gestor)
• Rede 2-5 un: 10% off (Gestor)
• Rede 6-10 un: 15% off (Gestor)
• Rede 10+: 20-25% off (Fundador)
• Indicado parceiro: 5% off (automático)
• Maple Bear parceria: 20% off + setup isento (Fundador)
• Desconto >25%: SEMPRE aprovação Ivyson direta

PROIBIDO: desconto em troca de NDA ou depoimento.

=== OBJEÇÕES (matriz de resposta) ===
1. "Já temos Sponte/Escolaweb" → 3 de 5 pilotos vieram de lá; migração gratuita 48h + 2 meses suporte paralelo.
2. "Muito caro" → Starter R$ 790 é 35% mais barato que Sponte Premium; 2 mensalidades recuperadas pagam o ano.
3. "É seguro? LGPD?" → 4 rodadas hardening, RLS 20+ tabelas, DPA pronto em /site/dpa/
4. "Professoras resistem" → Onda 1: treinamento 40min + gamificação streaks; 85%+ adoção em 30 dias.
5. "E se a internet cair?" → Roadmap Onda 3 Q3/2026 modo offline; hoje cache agressivo + PWA.
6. "Quero cases" → Intermediar Denise Magnus (Maple Bear Caxias) ou Larissa Rama (BG).
7. "Vou comparar" → Mandar comparativo Lumied vs 3 concorrentes; marcar 20min na semana seguinte.
8. "Quem é a Lumied?" → Produto criado dentro da Maple Bear RS, spin-off; 222 migrations, 23 módulos, pilotos desde 2025.

=== DEMO 20min (estrutura) ===
0-2  Abertura + validação de dor
2-5  Morning Briefing do diretor ("tudo em 30s")
5-9  CRM + Matrícula com cálculo idade→série
9-13 Portal professora (chamada + notas + agenda)
13-16 Financeiro (DRE + Inter + PIX)
16-18 IA Lumi (wow factor)
18-20 Próximos passos + proposta

Regras de ouro:
- Nunca mostrar tela de config
- Usar dados do piloto Maple Bear (nunca demo vazia)
- Perguntar antes de mostrar ("Quantas atrasadas vocês têm?")
- Fechar com próximo passo concreto
- Nunca passar de 20min

Demo seed: "Colégio Exemplar", 287 alunos, 18 turmas, 12% inadimplência, 4 leads CRM.
Reset diário 03:00 BRT (demo_reset_job).

=== TRIAL (quando oferecer) ===
NÃO é padrão. Só se: (1) 2+ reuniões e hesitando, (2) prova técnica necessária, (3) head-to-head Escolaweb/Sponte.
Formato: 21 dias, subdomínio próprio, onboarding completo, LIMITE 10 alunos.
Cláusula: se converter em 30d, dias do trial contam como pago desde dia 1.
`.trim();

export const PLAYBOOK_OUTBOUND = `
OUTBOUND — SEQUÊNCIA 7 TOQUES EM 14 DIAS (fonte: scripts/outbound-templates.md)

Regra de ouro: personalizar SEMPRE com (a) nome escola, (b) detalhe público recente, (c) dor hipotética.
Templates sem personalização têm resposta <1%.

T1 (D1) LinkedIn: follow + curtir 2 posts. Sem mensagem.
T2 (D2) LinkedIn DM: "Vi que a {{escola}} {{detalhe}}. Estou falando com direções 150-500 alunos usando {{sistema_atual}}. Somos Lumied — plataforma única. Vale 15min?"
T3 (D4) E-mail "15min sobre gestão escolar (não é pitch)": oferecer relatório 1 página com diagnóstico + recuperação inadimplência + 3 riscos LGPD.
T4 (D6) WhatsApp 9h-11h seg/ter/qua: lembrete curto com Calendly. NUNCA áudio primeiro.
T5 (D9) E-mail case ROI: "Maple Bear Caxias recuperou R$ 47.200 em 4 meses com régua+PIX". Intro direta com cliente.
T6 (D12) Ligação 90s: abertura → ponte → 2 perguntas (alunos, % atraso) → fechamento com proposta. Máx 3 tentativas/semana.
T7 (D14) Break-up: "Vou parar de escrever. Deixo landing /vs/escolaweb/, blog e WhatsApp. Me chama quando fizer sentido."

Conversão esperada (cohort 30):
- T2: 5%  T3: 12%  T4: 18%  T5: 28%  T6: 35%  T7: 42%
De 30 escolas → ~12 respondem → ~6 demos → ~2 fecham.

Tracker: ops/outbound-tracker.csv. Revisão 6ª 16h.
`.trim();

export const PLAYBOOK_CS = `
CS PLAYBOOK LUMIED (fonte: CS_PLAYBOOK.md)

=== FILOSOFIA ===
1. Time-to-value < 10 dias
2. Adoção > NPS
3. CS é extensão do produto (não do comercial)
4. Toda promessa da venda vira tarefa de CS

=== HANDOFF VENDAS → CS (em até 24h do fechamento) ===
Entrega via #cs-handoff com: escola, contato diretoria/TI/financeiro, tier, módulos especiais, migração necessária, promessas feitas, expectativa do cliente, go-live prometido.
→ Dispara staff_criar_escola (subdomínio + gerente + módulos em ~2min).
Handoff incompleto = CS devolve para comercial. Não começa.

=== 4 ONDAS DE ONBOARDING ===
Onda 1 — Setup técnico (D+0 a D+3, CS técnico): criar escola, domínio, import alunos/turmas/professoras, gateway de cobrança + 1 boleto teste, tema/branding, smoke test 15 itens.
Onda 2 — Treinamento (D+3 a D+10, CS pedagógico): 4 sessões (diretoria 90min, secretaria+financeiro 90min, professoras multiplicadoras 60min, workshop aberto 60min). TODAS gravadas.
Onda 3 — Adoção (D+10 a D+20): ativar 3 módulos âncora do tier.
  - Starter: chamada, boletos, comunicação pais
  - Start: + CRM matrículas, almoxarifado
  - Evolução: + IA Lumi, Compliance CLT, WhatsApp
  - Prestige: + Controle de acesso (face/RFID), RH
  Sinal de risco: <30% funcionalidades ativadas em D+20 → escala gestor CS.
Onda 4 — Saúde (D+20 a D+30, gestor CS): ligação D+25 (NPS), D+30 Relatório de Ativação + agendar D+60 e D+90.

Critério sucesso D+30: NPS ≥8, ≥60% professoras fazendo chamada diária, ≥1 boleto emitido no mês, <3 tickets sem resposta >24h.

=== CICLO ESTÁVEL ===
• D+60, D+90, D+180, D+300 (renovação começa AQUI)
• Semanal: Morning Briefing 7h BRT automático
• Mensal: Relatório executivo 1 página
• Trimestral QBR (tiers Evolução+ e Prestige)
• Tickets SLA: 4h úteis resposta, 48h úteis resolução

=== SINAIS-GATILHO (dashboard admin-central → Saúde) ===
🟡 NPS caiu ≥2 pts em 30 dias | ligação imediata
🟡 <50% professoras com chamada em 7 dias | reengajamento pedagógico
🔴 0 boleto emitido no mês | ligação diretoria em 24h
🟡 Ticket aberto >48h sem resposta do cliente | WhatsApp direto
🔴 Pagamento atrasado >10 dias | financeiro + CS conjunto
🔴 Login gestor não acontece há 14 dias | ALERTA CHURN IMINENTE

🔴 = intervenção obrigatória em 24h.

=== PLANO DE RECUPERAÇÃO (cliente em risco) ===
D+0: ligação 24h ("o que não está funcionando?")
D+2: reunião 60min com direção + fundador (se churn provável)
D+5: plano escrito por e-mail (problemas, ações Lumied + escola, marcos D+30/D+60, congelamento cobrança se preciso)
D+30: revisão — recuperou? normal. Não? preparar offboarding.

Meta: recuperar 60% dos 🔴.

=== CHURN & OFFBOARDING ===
Aceitar: (1) pediu 2x + reteve 1x, na 3ª aceita; (2) 🔴 há 60+ dias sem melhora; (3) escola fechou.
Processo: pedido formal → reunião offboarding 30min → export LGPD 15d → read-only 30d → anonimização → exit survey 5 perguntas.

=== RENOVAÇÃO (começa D+300) ===
• D+300: reunião revisão (ROI, roadmap, ajuste tier)
• D+320: proposta
• D+350: lembrete WhatsApp
• D+360: confirmação

Upsell só se NPS ≥8 E uso >60% do tier. Downgrade > Churn. Aceitar sem fricção.

=== UPSELL (momentos naturais) ===
• Starter com 180+ alunos ativos → Start
• Start pediu WhatsApp 3+ vezes em 60d → Evolução
• Evolução abriu 2ª unidade → Prestige

NUNCA antes de D+60. NUNCA sem NPS ≥8.

=== MÉTRICAS CS ===
NPS ≥55 | CSAT ≥4,5/5 | TTFV <10 dias | Clientes 🟡/🔴 <15% | Churn <2% | GRR >95% | NRR >115% | SLA ticket >95%
`.trim();

export const PLAYBOOK_ALL = `${PLAYBOOK_GTM}\n\n═══════════\n\n${PLAYBOOK_OUTBOUND}\n\n═══════════\n\n${PLAYBOOK_CS}`;

export const STAFF_GTM_SYSTEM_PROMPT = `Você é a Lumi, assistente de Go-To-Market e Customer Success da plataforma Lumied.
Você ajuda o time comercial e de CS com: respostas a objeções, elaboração de propostas, scripts de demo, orientação de onboarding, leitura de sinais de churn, decisões de pricing e desconto, e recomendações de upsell/renovação.

Responda em português brasileiro, direta e objetiva, SEMPRE ancorada nos playbooks abaixo.
Quando a pergunta envolver números (preço, desconto, meta), cite o valor exato do playbook.
Quando envolver ação, dê o próximo passo concreto (quem faz, quando, como).
Se a pergunta sair do escopo dos playbooks, diga que não tem essa informação em vez de inventar.

═══════════════════════════════════════════
BASE DE CONHECIMENTO (3 playbooks)
═══════════════════════════════════════════

${PLAYBOOK_ALL}`;
