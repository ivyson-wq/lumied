# CS PLAYBOOK — Lumied (Pós-Venda)

**Versão:** 2026-04-16 · **Dono:** Ivyson Longoni · **Revisão:** trimestral

Do "contrato assinado" até "renovação ou churn" — o manual de Customer Success do Lumied.

---

## 1. Filosofia de CS

1. **Time-to-value < 10 dias.** Se o cliente não está usando de verdade em D+10, já estamos perdendo.
2. **Adoção > NPS.** Cliente feliz que não usa cancela na renovação. Cliente que usa muito e reclama é o que renova.
3. **CS é extensão do produto, não do comercial.** O foco é sucesso do cliente, não upsell. Upsell vem quando sucesso acontece.
4. **Toda promessa da venda vira tarefa de CS.** Se o comercial prometeu migração em 48h, CS entrega em 48h. Se prometeu algo impossível, corrigimos com o cliente cedo, não tarde.

---

## 2. Handoff Vendas → CS (D+0)

Gatilho: contrato assinado no sistema. Em até **24h**, o gestor comercial entrega via Slack `#cs-handoff`:

```
ESCOLA: [Nome]
CONTATO DIRETORIA: [Nome, e-mail, WhatsApp]
CONTATO TI (se houver): [Nome, e-mail]
CONTATO FINANCEIRO: [Nome, e-mail] — IMUTÁVEL após setup
TIER: [Starter/Start/Evolução/Prestige]
MÓDULOS ESPECIAIS: [custom]
MIGRAÇÃO NECESSÁRIA: [sistema origem, qtd alunos, prazo prometido]
PROMESSAS FEITAS: [tudo que foi prometido — explícito]
EXPECTATIVA DO CLIENTE: [frase textual do que ele espera ganhar]
GO-LIVE PROMETIDO: [data]
```

→ Automação `staff_criar_escola` cria a escola + subdomínio Vercel + gerente + módulos do plano em ~2min.
→ CS cria card no Kanban `#cs-onboarding` e atribui dono.

**Regra:** se o handoff não chegou completo, CS **não** começa. Devolve para comercial e registra bloqueio (métrica interna).

---

## 3. Onboarding — 4 Ondas (D+0 até D+30)

### Onda 1 — Setup técnico (D+0 a D+3)

Responsável: CS técnico

- [ ] **D+0:** cria escola via admin-central, envia credenciais iniciais (gerente + superadmin) no WhatsApp
- [ ] **D+0:** configura domínio próprio se prometido (subdomínio Vercel é instantâneo; domínio custom pede DNS do cliente, SLA 48h)
- [ ] **D+1:** import de alunos/famílias (Sponte/Escolaweb export ou planilha — template em `/ops/migracao-template.xlsx`)
- [ ] **D+1:** importa turmas, séries, professoras, responsáveis
- [ ] **D+2:** configura gateway de cobrança (Banco Inter ou PIX), testa 1 boleto real
- [ ] **D+2:** aplica tema/branding (logo, cores, favicon) — `escola_config` multi-tenant
- [ ] **D+3:** **smoke test completo** com checklist de 15 itens (login, chamada, boleto, agenda, app pais)

**Entregáveis da Onda 1:** escola em produção com dados reais, todos os portais acessíveis, 1 boleto teste emitido com sucesso.

### Onda 2 — Treinamento (D+3 a D+10)

Responsável: CS pedagógico + gestor comercial (participa da 1ª sessão)

| Sessão | Duração | Público | Conteúdo |
|---|---|---|---|
| **1. Diretoria** | 90min | Dono, diretor, secretaria | Visão geral, CRM, matrícula, Morning Briefing, admin da escola |
| **2. Secretaria + Financeiro** | 90min | Secretaria + financeiro | Matrícula, alunos, boletos, inadimplência, régua de cobrança, PIX, DRE |
| **3. Professoras multiplicadoras** | 60min | 2-3 professoras "campeãs" | Chamada, notas, agenda digital, diário, materiais, app no celular |
| **4. Workshop aberto** | 60min | Toda equipe que quiser | Q&A, dicas práticas, atalhos |

**Regras:**
- Todas gravadas (Google Meet) e deixadas na área da escola em `/ajuda/treinamentos/`
- Oferecer segundo round gratuito em D+30 se NPS <8 ou ticket rate alto
- Não passar de 4 sessões na Onda 2 — excesso de treinamento gera fadiga

### Onda 3 — Onda de adoção (D+10 a D+20)

Responsável: CS pedagógico

Objetivo: ativar os **3 módulos âncora** do tier contratado.

| Tier | Módulos âncora prioritários |
|---|---|
| **Starter** | Chamada digital, boletos, comunicação pais |
| **Start** | + CRM matrículas, almoxarifado |
| **Evolução** | + IA Lumi, Compliance CLT, WhatsApp gateway |
| **Prestige** | + Controle de acesso (face/RFID), RH completo |

**Playbook de ativação por módulo:** para cada módulo âncora, CS:
1. Liga/chama no WhatsApp o responsável direto (ex: RH para compliance)
2. Mostra o "primeiro valor" em 15min (ex: upload de AFD → relatório de HE em 60s)
3. Deixa uma **tarefa prática** (ex: "cadastra 10 funcionários até sexta")
4. Verifica adoção via dashboard interno

**Sinais de risco:** <30% das funcionalidades do plano ativadas em D+20 → escala para gestor de CS.

### Onda 4 — Saúde (D+20 a D+30)

Responsável: gestor CS

- [ ] **D+25:** ligação de saúde com direção (20min), NPS curto (0-10), 1 pergunta aberta ("o que ainda não fez sentido?")
- [ ] **D+30:** entrega do **Relatório de Ativação** — 1 página PDF com:
  - % de alunos ativos no app
  - Nº de boletos emitidos e taxa de recebimento
  - Nº de aulas com chamada digital
  - Nº de comunicados enviados
  - Tickets abertos e SLA
  - Top 3 oportunidades detectadas pela IA Lumi
- [ ] **D+30:** agenda próximas revisões — D+60 e D+90

**Critério de sucesso D+30:**
- NPS >= 8
- Pelo menos 60% das professoras fazendo chamada digital diariamente
- Pelo menos 1 boleto emitido via Lumied no mês
- <3 tickets abertos sem resposta há mais de 24h

Não bateu? Plano de recuperação (§6).

---

## 4. Ciclo Estável — D+30 até renovação

### 4.1 Revisões de saúde

| Marco | Duração | Foco |
|---|---|---|
| **D+60** | 30min | Adoção ampla, novos módulos, primeiros insights Lumi |
| **D+90** | 45min | ROI parcial, NPS equipe + pais, alinhamento próximos 90 dias |
| **D+180** | 30min | Revisão tier (upsell natural?), NPS, coleta case |
| **D+300** | 60min | **Revisão de renovação** — começar 2 meses antes do aniversário |

### 4.2 Touchpoints contínuos

- **Semanal (automático):** Morning Briefing do gestor chega por e-mail 7h BRT
- **Mensal:** Relatório executivo 1 página (mesmo formato do D+30)
- **Trimestral:** QBR (Quarterly Business Review) com tiers Evolução+ e Prestige — 60min, co-construir roadmap do próximo trimestre
- **Tickets:** SLA 4h úteis (resposta), 48h úteis (resolução). Tickets "urgente" escalam pro WhatsApp do CS.

### 4.3 Sinais-gatilho

CS monitora semanalmente (dashboard `admin-central → Saúde`):

| Sinal | Cor | Ação |
|---|---|---|
| NPS caiu ≥ 2 pontos em 30 dias | 🟡 | Ligação de saúde imediata |
| <50% das professoras com chamada em 7 dias | 🟡 | Reengajamento pedagógico |
| 0 boleto emitido no mês | 🔴 | Ligação diretoria em 24h |
| Ticket aberto > 48h sem resposta do cliente | 🟡 | WhatsApp direto |
| Pagamento atrasado > 10 dias | 🔴 | Financeiro + CS em conjunto |
| Login do gestor não acontece há 14 dias | 🔴 | **Alerta de churn iminente** |

🔴 = intervenção obrigatória em 24h.

---

## 5. Comunidade, conteúdo e expansão

### 5.1 Comunidade de clientes
- **Grupo WhatsApp fechado** ("Clientes Lumied") — dúvidas peer-to-peer, anúncios de release, tips
- **Release notes mensal** enviada por e-mail (toda 1ª quarta do mês)
- **Painel de votação de roadmap** em `admin.html` aba "Ideias" (prioriza por peso do tier)

### 5.2 Conteúdo para clientes
- **Academia Lumied** (`/academia/`) — 12 microcursos 10min cada, um por módulo
- Biblioteca de templates (agenda, comunicados, contratos) — reutilizáveis entre escolas
- Webinar mensal 45min + Q&A

### 5.3 Upsell (apenas se houver sucesso)
Momentos naturais:
- Cliente Starter chegou em 180 alunos ativos (próximo do limite 200) → proposta Start
- Cliente Start pediu WhatsApp 3+ vezes em 60 dias → proposta Evolução
- Cliente Evolução abriu 2ª unidade → proposta Prestige (multi-unidade)

**Regra:** upsell nunca antes de D+60 e nunca sem NPS ≥ 8.

### 5.4 Indicação
Clientes com NPS ≥ 9 recebem convite do programa parceiros (`parceiros.html`):
- 5% off na próxima mensalidade por cada indicado
- 1 mês grátis quando o indicado assina
- R$ 500 cash para top parceiro trimestral

CS identifica e ativa manualmente nos primeiros 3 meses do programa — depois automatizar.

---

## 6. Plano de recuperação (cliente em risco)

**Gatilhos:** sinal 🔴 no dashboard, NPS ≤ 6, atraso de pagamento > 15 dias, ou cliente mencionou cancelar.

### Etapas

1. **D+0:** gestor CS liga em 24h e pergunta abertamente "o que não está funcionando?"
2. **D+2:** reunião 60min com direção da escola — CS + fundador (se churn provável)
3. **D+5:** **Plano de Recuperação por escrito** entregue por e-mail:
   - Problemas identificados (máx 5)
   - Ações da Lumied (prazos explícitos)
   - Ações da escola (se aplicável)
   - Marcos de sucesso para D+30 e D+60
   - "Congelamento" de cobrança por 30 dias se necessário (aprovação fundador)
4. **D+30:** revisão do plano. Se recuperado → volta ao ciclo normal. Se não → preparar offboarding.

**Meta:** recuperar 60% dos clientes em 🔴. Abaixo disso, revisar produto/processo/contratação.

---

## 7. Churn e Offboarding

### 7.1 Quando aceitar o churn
- Cliente pediu cancelamento 2x e reteve 1x — na 3ª, aceitar
- Cliente está em 🔴 há 60+ dias sem melhora apesar do plano de recuperação
- Escola fechou as portas (motivo externo, fora do nosso controle)

### 7.2 Processo
1. **Pedido formal** por escrito (e-mail do responsável financeiro cadastrado — lembre-se: imutável)
2. **Reunião de offboarding** (30min) — ouvir feedback REAL, sem defensividade
3. **Exportação de dados LGPD** (art. 18 VI) — backup completo em até 15 dias úteis
4. **Desativação suave:** portal fica read-only por 30 dias, depois dados anonimizados
5. **Exit survey** (5 perguntas) — fonte crítica para product/commercial

### 7.3 Rituais pós-churn
- Exit review no all-hands (toda 1ª sexta do mês) — sem culpa, foco em aprendizado
- Atualização da matriz de objeções e ICP em `PLAYBOOK.md` §6 e §1
- "Porta aberta" em 12 meses — e-mail leve oferecendo volta com desconto no setup

---

## 8. Renovação (começa no D+300)

**Filosofia:** renovação não é momento de venda — é momento de celebração. Se CS fez o trabalho, renovação é consequência.

### Linha do tempo
- **D+300** (60 dias antes do aniversário): **Reunião de renovação** — revisar ROI, roadmap do cliente, ajustar tier se for o caso
- **D+320:** proposta de renovação enviada (preço congelado ou reajuste INPC, mais benefícios novos)
- **D+350:** lembrete amigável WhatsApp
- **D+360:** confirmação final + contrato renovado

### Upsell na renovação
- Se cliente está usando <60% do tier contratado → **não** propor upsell. Risco de churn.
- Se cliente está batendo limites → propor próximo tier com desconto escalonado no primeiro trimestre.

### Downgrade
É preferível downgrade a churn. Se cliente pedir, aceitar sem fricção e colocar em plano de re-ativação (módulos do tier original ficam "locked preview" para upsell futuro).

---

## 9. Organograma CS (meta — 2026)

| Papel | Quando contratar | Carga |
|---|---|---|
| **CS Lead** (gestor + onboarding + recuperação) | desde dia 1 (Ivyson acumula) | 15-20 clientes |
| **CS Técnico** (setup + integrações) | >10 clientes pagantes | 25 clientes |
| **CS Pedagógico** (treinamento + adoção) | >15 clientes pagantes | 30 clientes |
| **CS Analyst** (saúde + dashboards + NPS) | >40 clientes pagantes | toda a base |

Até lá, tudo é acumulado pelo fundador com apoio da IA Lumi (painéis automáticos de saúde).

---

## 10. Métricas CS (dashboard `admin-central` aba "CS")

| Métrica | Meta |
|---|---|
| **NPS médio** | ≥ 55 |
| **CSAT pós-treinamento** | ≥ 4,5/5 |
| **Time to first value** | < 10 dias |
| **% clientes em 🟡/🔴** | < 15% da base |
| **Churn mensal** | < 2% |
| **Gross Revenue Retention (GRR)** | > 95% |
| **Net Revenue Retention (NRR)** | > 115% |
| **Ticket SLA compliance** | > 95% em 4h úteis |
| **Adoção módulos âncora em D+30** | > 70% |

---

## Referências
- `PLAYBOOK.md` — playbook comercial (handoff Vendas → CS em §11)
- `scripts/outbound-templates.md` — prospecção
- `COMERCIAL.md` — apresentação de features
- `RELATORIO_CX.md` — diagnóstico CX e roadmap
- `admin-central.html` → abas "Escolas", "Saúde", "CS"
