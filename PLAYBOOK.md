# PLAYBOOK Comercial — Lumied

**Versão:** 2026-04-16 · **Dono:** Ivyson Longoni · **Revisão:** trimestral

---

## 1. ICP (Ideal Customer Profile)

### Target primário — Escola Independente 150-500 alunos
| Critério | Detalhe |
|---|---|
| **Porte** | 150-500 alunos matriculados |
| **Segmento** | Educação Infantil + Fundamental I/II, bilíngues e franqueadas (Maple Bear, Objetivo, Mó, Bandeirantes) |
| **Sistema atual** | Sponte, Escolaweb, ClassApp, Diário Escola, planilhas Excel |
| **Dor ativa** | Fragmentação (3-5 sistemas soltos), boleto manual, comunicação 100% WhatsApp pessoal, sem controle de almoxarifado |
| **Poder de decisão** | Gestor/diretor com autonomia; CNPJ próprio ou franqueado individual |
| **Ticket esperado** | R$ 12k-40k/ano (tiers Start a Prestige) |
| **Geo prioridade** | RS, SC, PR → SP, MG → LATAM |

### ICP secundário — Rede/Franquia pequena (2-10 unidades)
- Sinepe/Sindicatos estaduais, redes familiares, franquias regionais.
- Venda multi-unidade (desconto 15%), contato geralmente direção geral.

### Anti-ICP (não vender agora)
- Escolas >1500 alunos → demanda ERP corporativo (Sophia, TOTVS Educacional)
- Cursos livres/técnicos → não temos módulos certificação MEC, falta feature-fit
- Creches <50 alunos → LTV baixo, não paga o CAC

---

## 2. Posicionamento

**One-liner:** *"A plataforma completa que substitui Sponte, Escolaweb e 5 planilhas — com o painel que o gestor abre todo dia e o app que o pai escolhe abrir."*

**3 provas:**
1. **Pilotos reais em produção** (Maple Bear Caxias, Bento Gonçalves, Construfare, Lumied)
2. **IA Lumi embarcada** — insights financeiros e pedagógicos em linguagem natural (MCP + Claude)
3. **4 tiers** (R$ 790 → R$ 3.300) com migração assistida de dados gratuita

**Arma competitiva contra Escolaweb/Sponte:** landing `/vs/escolaweb/` com comparativo feature-por-feature.

---

## 3. Funil (metas mensais — meses 1-3)

| Etapa | Meta/mês | KPI | Fonte |
|---|---|---|---|
| **Leads MQL** | 60 | Form /site/ + WhatsApp | Orgânico blog + outbound |
| **Reuniões marcadas** | 25 | Calendar booking | SDR / outbound |
| **Demos realizadas** | 18 | CRM Kanban | Gestor |
| **Propostas enviadas** | 10 | Pipeline | Pós-demo |
| **Matrículas (fechamento)** | **5** | Ativações | Closing |
| **MRR adicional** | **R$ 8k-15k** | Billing | Cumulativo |

**Conversão-alvo:** MQL → Matrícula = **8%** (benchmark EdTech B2B: 5-10%)

---

## 4. Canais de aquisição

### 4.1 Outbound (peso 50% meses 1-3)
- **Lista semanal:** 30 escolas-alvo (rede Maple Bear, Sinepe RS/SC/PR, franquias bilíngues)
- **Sequência 7 toques** em 14 dias:
  1. LinkedIn follow + curtida em 2 posts
  2. DM LinkedIn personalizada (referência à escola)
  3. E-mail #1 — diagnóstico em 15min
  4. WhatsApp direto da diretoria (horário 9h-11h)
  5. E-mail #2 — case Maple Bear (ROI)
  6. Ligação curta
  7. Break-up e-mail ("estou encerrando follow-up")
- **Templates:** `scripts/outbound-templates.md` (criar)

### 4.2 Indicações (peso 25%)
- `parceiros.html` ativo — clientes pagantes indicam, ganham:
  - 5% off na contratação do indicado
  - 1 mês grátis quando o indicado assina
  - R$ 500 cash para top parceiro trimestral
- **Ativação:** botão/widget fixo em todos os portais (ver `referral-widget.js`)

### 4.3 Inbound SEO (peso 15%, cresce meses 4+)
- **Blog automation** diária (`scripts/daily-blog-agent.md`) — 1 artigo/dia
- Keywords alvo: "sistema gestão escolar", "alternativa sponte", "alternativa escolaweb", "agenda digital escolar", "chamada digital escola"
- **GSC + IndexNow + sitemap** já ativos

### 4.4 Parcerias estratégicas (peso 10%)
- **Franqueadoras:** Maple Bear HQ, Bandeirantes, Bob Silva, Positivo (abordagem top-down)
- **Sinepe regionais:** patrocínio de eventos, webinars compliance CLT
- **Contadores escolares:** apresentar DRE integrado + boletos Inter como diferencial

---

## 5. Script de Demo (20 minutos)

### Estrutura
| Min | Bloco | Objetivo |
|---|---|---|
| 0-2 | **Abertura** | Contexto, validação de dor |
| 2-5 | **Morning Briefing do diretor** | "Veja tudo da escola em 30s" |
| 5-9 | **CRM + Matrícula com cálculo idade→série** | Mostrar valor comercial |
| 9-13 | **Portal da professora** (chamada + notas + agenda digital) | UX no dia a dia |
| 13-16 | **Financeiro** (DRE + boleto Inter + PIX) | Prova de robustez |
| 16-18 | **IA Lumi** — pergunte qualquer coisa | Wow factor |
| 18-20 | **Próximos passos + proposta** | Fechar próxima reunião |

### Regras de ouro
1. **Nunca mostre tela de config** — sempre mostre a tela do usuário final
2. **Use dados do piloto Maple Bear** (já povoados) — nunca demo vazia
3. **Pergunte antes de mostrar:** "Quantas mensalidades atrasadas vocês têm hoje?" → mostre cobrança
4. **Feche com próximo passo concreto** — nunca "qualquer dúvida me chama"
5. **Demo dura 20min; não passe disso** — excedeu, corte e marque follow-up

### Dados do "demo seed" (escola fictícia pré-popular)
- Escola: **Colégio Exemplar**
- 287 alunos, 18 turmas, 24 professoras
- 12% inadimplência (P/ mostrar régua de cobrança gerar impacto)
- 4 leads CRM em estágios distintos
- 6 atestados médicos pendentes
- Importante: demo reset diário às 03:00 BRT (`demo_reset_job`)

---

## 6. Matriz de objeções

| Objeção | Resposta |
|---|---|
| **"Já temos Sponte/Escolaweb"** | "Sabemos. 3 dos nossos 5 pilotos vieram de lá. Migração gratuita de dados em 48h + 2 meses de suporte paralelo." |
| **"Muito caro"** | "O tier Starter é R$ 790/mês — 35% mais barato que Sponte Premium. E só 2 mensalidades recuperadas por régua de cobrança pagam o ano." |
| **"É seguro? LGPD?"** | "Auditoria de segurança com 4 rodadas de hardening, RLS Postgres em 20+ tabelas, criptografia end-to-end, DPA pronto. Conferir `/site/dpa/` e `/site/certificacao/`." |
| **"As professoras resistem"** | "Use a Onda 1 de ativação: treinamento de 40min + gamificação com streaks. Nossos pilotos têm 85%+ de adoção em 30 dias." |
| **"E se a internet cair?"** | "Roadmap Onda 3 Q3/2026: modo offline com fila + sync inteligente. Hoje: cache agressivo + PWA instalável." |
| **"Quero conhecer cases"** | "Ligue para Denise Magnus (Maple Bear Caxias) ou Larissa Rama (BG) — vou intermediar." |
| **"Preciso pensar / vou comparar"** | "Ok, te mando comparativo completo Lumied vs 3 concorrentes (escolaweb, sponte, classapp). Marca 20min na próxima semana?" |
| **"Quem é a Lumied?"** | "Produto criado dentro da Maple Bear RS, hoje spin-off independente. 222 migrations, 23 módulos, pilotos em produção desde 2025." |

---

## 7. Proposta comercial (template)

**Assunto:** Proposta Lumied — [Nome da Escola]

```
Olá [Nome do decisor],

Segue proposta do Lumied para [Nome da Escola] com base no que conversamos:

TIER RECOMENDADO: [Starter/Start/Evolução/Prestige]
- Alunos ativos: até [N]
- Módulos inclusos: [listar]
- WhatsApp: [N] msgs/mês (se aplicável)

INVESTIMENTO:
- Mensal: R$ [X]/mês (pagto mensal)
- Anual: R$ [Y]/mês equivalente (com 20% off — pagto anual antecipado)
- Setup: ISENTO (migração de dados + onboarding + treinamento)

O QUE ESTÁ INCLUÍDO:
- Subdomínio próprio (ex: colegio.lumied.com.br) ou domínio do cliente
- Migração de dados (Sponte/Escolaweb/Excel) — entregue em até 48h
- Treinamento de 4h (diretoria + secretaria + 2 professoras multiplicadoras)
- Suporte via chat/email com SLA de 4h úteis
- IA Lumi inclusa nos tiers Evolução e Prestige
- Compliance CLT + ponto AFD (tiers Evolução+)

PRAZO DE IMPLANTAÇÃO:
- Go-live: 5 dias úteis após contrato assinado
- Treinamento: até D+10
- Reunião de saúde: D+30, D+60, D+90

VALIDADE DA PROPOSTA: 15 dias

PRÓXIMO PASSO:
Assinatura do contrato (anexo) + cadastro da escola no admin.lumied.com.br

Qualquer dúvida, estou à disposição.

Abraço,
[Seu nome]
```

---

## 8. Trial (quando oferecer e como)

**Regra:** trial **NÃO é padrão**. Oferece apenas quando:
1. Escola hesita e pediu 2+ reuniões
2. Decisão depende de prova técnica (integração contábil específica)
3. Competindo head-to-head com Escolaweb/Sponte

**Formato do trial:**
- 21 dias corridos
- **Subdomínio próprio**, dados reais (não demo)
- Onboarding completo (gera compromisso)
- **Cláusula:** se converter em até 30 dias pós-trial, os dias do trial contam como uso pago desde o dia 1
- **Guardrail:** limita a 10 alunos cadastráveis (evita uso produtivo sem pagar)

---

## 9. Pricing e descontos (travas)

| Condição | Desconto máximo | Aprovador |
|---|---|---|
| Pagamento anual antecipado | 20% off | SDR/Gestor |
| Rede com 2-5 unidades | 10% off | Gestor |
| Rede com 6-10 unidades | 15% off | Gestor |
| Rede com 10+ unidades | 20-25% off | Fundador |
| Escola indicada (parceiro) | 5% off | Automático |
| Maple Bear (programa parceria) | 20% off + setup isento | Fundador |
| **Qualquer desconto >25%** | — | **Aprovação Ivyson direta** |

**Proibido:** dar desconto em troca de NDA; dar desconto em troca de depoimento (estes são "nice to have", pedir separado).

---

## 10. Métricas do comercial (dashboard semanal)

Salvar no `admin-central.html` aba "Comercial":

| Métrica | Meta semanal |
|---|---|
| Leads novos | 15 |
| Reuniões marcadas | 6 |
| Demos realizadas | 4 |
| Propostas enviadas | 2 |
| Fechamentos | 1 |
| CAC (gasto em ads + tempo SDR) | < R$ 2.500 |
| LTV estimado (24 meses retenção) | > R$ 35.000 |
| LTV/CAC | > 10x |

---

## 11. Handoff Vendas → CS (dia da assinatura)

Ao fechar, gestor comercial **obrigatoriamente** entrega em até 24h:

```
ESCOLA: [Nome]
CONTATO DIRETORIA: [Nome, e-mail, WhatsApp]
CONTATO TI (se houver): [Nome, e-mail]
CONTATO FINANCEIRO: [Nome, e-mail] — IMUTÁVEL após setup
TIER: [Starter/Start/Evolução/Prestige]
MÓDULOS ESPECIAIS: [listar custom]
MIGRAÇÃO NECESSÁRIA: [de qual sistema, qtd de alunos]
PROMESSAS FEITAS: [listar explicitamente tudo que foi prometido]
EXPECTATIVA DO CLIENTE: [frase do cliente do que ele espera ganhar]
GO-LIVE: [data]
```

→ Este handoff dispara a automação `staff_criar_escola` + o processo CS (ver `CS_PLAYBOOK.md`).

---

## 12. Primeiros 90 dias — O que você precisa fazer AGORA

- [ ] **Semana 1:** Lista de 30 escolas-alvo RS/SC (use Google Maps + Sinepe.com.br)
- [ ] **Semana 1:** Gravar 1 vídeo demo de 8min (colocar em `/site/` com CTA agenda)
- [ ] **Semana 1:** Testar sequência outbound em 10 escolas (tracking em planilha)
- [ ] **Semana 2:** Ligar para Denise Magnus + Larissa Rama + Construfare para **gravar depoimento** (60s cada)
- [ ] **Semana 2:** Ativar botão Indicar em todos os portais (já em progresso)
- [ ] **Semana 3:** Primeiras 3 demos agendadas → gravar + revisar
- [ ] **Semana 4:** Primeiro fechamento-meta
- [ ] **Mês 2:** 5 fechamentos + refinar playbook com o que aprendeu
- [ ] **Mês 3:** Definir se contrata SDR ou segue solo (base: pipeline > 40 leads/mês)

---

## Referências
- `COMERCIAL.md` — apresentação comercial (features)
- `RELATORIO_CX.md` — diagnóstico CX e roadmap
- `CS_PLAYBOOK.md` — processo pós-venda
- `CLAUDE.md` — contexto técnico completo
- `/site/vs/escolaweb/` — landing comparativa
- `/parceiros.html` — programa de indicação
