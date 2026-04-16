# ops/ — Operação Comercial & CS

Arquivos operacionais do dia a dia comercial/CS. **Não entram no produto** — são ferramentas internas.

## Arquivos

### `outbound-tracker.csv`
Tracker de prospecção ativa. Uma linha por escola-alvo. Preencha as datas dos toques (T1-T7) à medida que executa a sequência descrita em `../scripts/outbound-templates.md`.

**Colunas:**
- `escola`, `decisor`, `cargo`, `cidade`, `uf`, `alunos_estimados` — identificação do lead
- `sistema_atual` — Sponte, Escolaweb, ClassApp, Excel, nenhum
- `origem` — Sinepe, LinkedIn, indicação, blog orgânico, etc.
- `toque_atual` — T1 a T7 (onde está na sequência)
- `data_t1_follow` a `data_t7_breakup` — datas YYYY-MM-DD de cada execução
- `ultima_resposta` — texto livre da última interação
- `status` — MQL, SQL, DEMO, PROPOSTA, FECHADO, PERDIDO
- `motivo_perda` — se PERDIDO, preencher
- `tier_sugerido` — Starter, Start, Evolução, Prestige (base em §4 do PLAYBOOK)
- `proximo_passo` — o que vai acontecer a seguir
- `observacoes` — notas livres

**Ritual:** revisão toda **6ª feira 16h** — aposentar leads que passaram do T7 sem resposta, adicionar 30 novos na segunda.

### `README.md`
Este arquivo.

## Sugestões futuras

- Migrar para Google Sheets quando o time crescer (colunas ficam as mesmas, ganha filtros/compartilhamento)
- Integrar com CRM do admin-central (hoje o CRM é por escola, não para o funil comercial da Lumied)
- Script Node.js para importar CSV → `crm_leads_lumied` (tabela SaaS-level, não tenant)

## Referências
- `../PLAYBOOK.md` — estratégia e metas
- `../scripts/outbound-templates.md` — scripts dos 7 toques
- `../CS_PLAYBOOK.md` — o que acontece depois do fechamento
