# Product Events — Taxonomia (Lumied Activation Program)

Base do **Lumied Health Score (LHS)** e da métrica norte **AMPS — Active Modules per School @ D60**.

> Onde fica: tabela `product_events` (mig 342) · edge function `track-event` · client SDK `/product-events.js`.

---

## Convenção de naming

```
<modulo>.<entidade>.<acao>
```

- Tudo **snake_case** e **dotted**.
- Mínimo 2 pontos (3 segmentos).
- Regex: `^[a-z_]+(\.[a-z_]+)+$`.
- Verbos no passado simples (`gerada`, `paga`, `cadastrado`, `aberto`, `fechado`).

Bom: `financeiro.cobranca.gerada`, `manutencao.chamado.fechado_no_sla`
Ruim: `geraCobranca`, `cobranca-gerada`, `clicked-button-x`

## Quando emitir

- **Sempre que houver uma ação de valor**, não um clique de UI.
- Emitir do **servidor** (edge function) quando o evento for um efeito de borda real (boleto pago, baixa, matrícula registrada).
- Emitir do **cliente** apenas para eventos de UX (wizard concluído, checklist item, primeira visita).
- **Não emitir** pra navegação / page-view (GA já cobre).

## Payload

- Mantenha **pequeno** (<10KB; constraint 16KB no banco).
- Use campos com `_cents`, `_count`, `_id` no nome quando o tipo for óbvio.
- Não inclua PII (nome, email, CPF) — só IDs.

---

## Inventário de eventos (v1)

Marcação:
- 🌟 — alimenta direto AMPS / aha de algum módulo (essencial)
- 💼 — alimenta outcomes do LHS
- 🧭 — alimenta jornada de onboarding

### `auth` — Identidade

| Evento | Quando | Payload | Tags |
|---|---|---|---|
| `auth.user.logged_in` | Login bem-sucedido (qualquer portal) | `{ persona, primeiro_login_dia: bool, dispositivo: 'web'\|'mobile' }` | 🌟🧭 |
| `auth.user.first_login` | 1ª vez do usuário na escola | `{ persona }` | 🧭 |
| `auth.session.expirou` | Sessão expirou silenciosamente | `{ persona }` | — |

### `onboarding` — Programa de ativação

| Evento | Quando | Payload | Tags |
|---|---|---|---|
| `onboarding.wizard.iniciado` | Abriu setup wizard | `{ contexto: 'first_login'\|'reabriu' }` | 🧭 |
| `onboarding.wizard.passo_concluido` | Concluiu 1 passo do wizard | `{ passo: int, nome: string }` | 🧭 |
| `onboarding.wizard.finalizado` | Terminou todos os passos | `{ duracao_seg: int }` | 🧭 |
| `onboarding.wizard.pulado` | Clicou "pular por agora" | `{ passo_atual: int }` | 🧭 |
| `onboarding.checklist.item_concluido` | Marcou item da checklist persistente | `{ item_id, percent_done: int }` | 🧭 |
| `onboarding.checklist.completo` | 100% da checklist | `{ duracao_dias: int }` | 🧭 |
| `onboarding.convite.enviado` | Mandou convite p/ colega | `{ canal: 'whatsapp'\|'email', papel }` | 🧭 |
| `onboarding.convite.aceito` | Convite aceito (login do convidado) | `{ canal, papel }` | 🧭🌟 |
| `onboarding.modulo.primeiro_uso` | 1ª ação real num módulo | `{ module }` | 🌟 |

### `dashboard` — Diretor / gestor

| Evento | Quando | Payload | Tags |
|---|---|---|---|
| `dashboard.executivo.visualizado` | Diretor abriu o dashboard | `{ filtro_periodo }` | 🌟 |
| `dashboard.relatorio.exportado` | Exportou PDF/CSV | `{ relatorio, formato }` | 💼 |
| `dashboard.relatorio.mensal.gerado` | Relatório mensal automático criado | `{ mes }` | 💼 |

### `financeiro`

| Evento | Quando | Payload | Tags |
|---|---|---|---|
| `financeiro.conta_bancaria.configurada` | Onboarding banco OK | `{ banco }` | 🌟🧭 |
| `financeiro.cobranca.gerada` | Boleto/cobrança criado | `{ valor_cents, qtd: int }` | 💼 |
| `financeiro.remessa.gerada` | Remessa enviada ao banco | `{ qtd_titulos: int, banco }` | 💼 |
| `financeiro.remessa.processada` | Retorno do banco OK | `{ qtd_titulos: int }` | 💼 |
| `financeiro.baixa.automatica` | Webhook do banco baixou cobrança | `{ valor_cents }` | 💼🌟 |
| `financeiro.baixa.manual` | Usuário baixou manualmente | `{ valor_cents }` | — |
| `financeiro.boleto.pago` | Pagamento confirmado (cliente final) | `{ valor_cents, via: 'pix'\|'boleto' }` | 💼 |
| `financeiro.regua_cobranca.disparada` | Régua automática enviou cobrança | `{ canal, dias_atraso: int }` | 💼 |
| `financeiro.fechamento_mes.realizado` | Fechou mês contábil | `{ mes }` | 💼 |

### `manutencao`

| Evento | Payload | Tags |
|---|---|---|
| `manutencao.chamado.aberto` | `{ categoria, urgencia }` | 💼 |
| `manutencao.chamado.atribuido` | `{ equipe_id }` | — |
| `manutencao.chamado.fechado_no_sla` | `{ tempo_seg: int }` | 💼🌟 |
| `manutencao.chamado.fechado_fora_sla` | `{ tempo_seg: int }` | 💼 |
| `manutencao.duvida.aberta` | `{ chamado_id }` | — |

### `almoxarifado`

| Evento | Payload | Tags |
|---|---|---|
| `almoxarifado.insumo.cadastrado` | `{ qtd: int }` | 🌟 |
| `almoxarifado.movimentacao.saida` | `{ qtd_itens: int }` | 💼 |
| `almoxarifado.movimentacao.entrada` | `{ qtd_itens: int }` | — |
| `almoxarifado.inventario.fechado` | `{ qtd_itens_contados: int, divergencias: int }` | 💼🌟 |
| `almoxarifado.requisicao.aprovada` | `{ valor_cents }` | — |
| `almoxarifado.compra.cadastrada` | `{ valor_cents }` | 💼 |

### `ponto`

| Evento | Payload | Tags |
|---|---|---|
| `ponto.batida.registrada` | `{ tipo: 'entrada'\|'saida'\|'almoco' }` | 💼 |
| `ponto.espelho.fechado` | `{ mes }` | 💼🌟 |
| `ponto.justificativa.aprovada` | `{ motivo }` | — |
| `ponto.afd.importado` | `{ qtd_linhas: int }` | — |

### `crm` / `comercial`

| Evento | Payload | Tags |
|---|---|---|
| `crm.lead.criado` | `{ origem }` | — |
| `crm.lead.qualificado` | `{ tag }` | 💼 |
| `crm.visita_agendada` | `{ data }` | 💼 |
| `crm.matricula.fechada` | `{ valor_mensal_cents }` | 💼🌟 |

### `academico` / `pedagogico`

| Evento | Payload | Tags |
|---|---|---|
| `academico.turma.criada` | `{}` | 🌟 |
| `academico.aluno.matriculado` | `{ via: 'lumied'\|'import_erp'\|'crm' }` | 🌟 |
| `academico.nota.lancada` | `{ disciplina }` | 💼 |
| `academico.frequencia.lancada` | `{ turma_id }` | 💼 |
| `academico.boletim.gerado` | `{ trimestre }` | 💼 |

### `comunicacao` / `agenda`

| Evento | Payload | Tags |
|---|---|---|
| `comunicacao.mensagem.enviada` | `{ canal, destinatarios: int }` | — |
| `agenda.evento.criado` | `{ tipo }` | — |
| `agenda.evento.visualizado_pai` | `{ tipo }` | 💼 |

### `pais` (portal família)

| Evento | Payload | Tags |
|---|---|---|
| `pais.convite.aceito` | `{}` | 🌟🧭 |
| `pais.boletim.visualizado` | `{ aluno_id }` | 💼 |
| `pais.boleto.pago.via_app` | `{ valor_cents }` | 💼🌟 |
| `pais.agenda.lida` | `{}` | — |

### `pickup` / `controle_acesso`

| Evento | Payload | Tags |
|---|---|---|
| `pickup.solicitacao.criada` | `{}` | — |
| `pickup.retirada.concluida` | `{ tempo_seg: int }` | — |

---

## Persona inferida (server-side)

A edge function `track-event` **resolve a persona** a partir do `papeis[]` do usuário (token de sessão). O cliente NÃO precisa passar.

Precedência:
`diretor > financeiro > comercial > nutricionista > almoxarife > manutencao > impressao > coord_pedagogico > professora_assistente > professora > secretaria > gerente`

## Que evento alimenta o quê

| Componente do LHS | Eventos-chave |
|---|---|
| **Adoção (40%)** — AMPS | qualquer evento com `module` populado conta como atividade no módulo |
| **Cobertura de stakeholders (20%)** | `auth.user.logged_in` particionado por `persona` |
| **Outcomes (25%)** | `financeiro.baixa.automatica` / `manutencao.chamado.fechado_no_sla` / `academico.aluno.matriculado.via_lumied` / `ponto.espelho.fechado` |
| **Sentimento (15%)** | `dashboard.executivo.visualizado` (proxy + NPS quando integrar) |

---

## Idempotência

Pra eventos que vêm de webhook (banco, ERP) onde pode haver replay:

```js
trackProductEvent('financeiro.baixa.automatica', { valor_cents: 12000 }, {
  idempotencyKey: 'webhook-inter-' + transactionId  // dedup
});
```

A constraint `uq_product_events_idem` (mig 342) garante 1 inserção por `(escola_id, idempotency_key)`. Useful: vide [[idempotency-check]] skill.

---

## Adicionando novo evento

1. Escolha nome seguindo a convenção `modulo.entidade.acao`.
2. Adicione linha nesta tabela com payload esperado + tags (🌟💼🧭).
3. Se for outcome novo, atualize `fn_lumied_health_score` (mig do Sprint 2).
4. Não precisa migration nova — `product_events` aceita qualquer `event_name` que case a regex.

## Anti-padrões

- ❌ Eventos por clique de UI sem valor (`button.submit.clicked`)
- ❌ Payload com nome/email/CPF (PII)
- ❌ Eventos no client quando deveria ser server-side (vão chegar atrasados ou nunca)
- ❌ Reusar `event_name` com payload variável (cria ambiguidade)
- ❌ Disparar de loops (1 evento por linha processada — agregue antes)
