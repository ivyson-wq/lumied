# Relatório de Experiência do Cliente — Lumied
## Como tornar o Lumied um dos melhores SaaS de educação do mundo

---

## 1. ESTADO ATUAL vs REFERÊNCIAS INTERNACIONAIS

### Comparação com líderes globais

| Dimensão | Brightwheel (EUA) | ClassApp (BR) | Toddle (Global) | **Lumied (Nós)** |
|----------|-------------------|---------------|-----------------|-------------------|
| Onboarding | 48h go-live | White-glove | Self-service | **Sem fluxo definido** |
| Fotos em tempo real | Core feature | Limitado | Core feature | **Agenda Digital (básica)** |
| Push notifications | Inteligentes, batched | Sim | Contextual | **Sem push (PWA)** |
| Pagamento 1 toque | Sim (ACH/card) | Não | N/A | **Boletos + PIX (2-3 cliques)** |
| Offline | Parcial | Não | Sim | **Não** |
| Camera integration | First-class | Não | First-class | **Upload manual** |
| Dashboard diretor | Traffic light KPIs | Básico | Competências | **Analytics (bom)** |
| Gamification | Não | Não | Streaks (sutil) | **Não** |
| ROI automático | Sim (renewal) | Não | Não | **Não** |
| Mobile-first | Nativo iOS/Android | Nativo | Nativo | **PWA** |

---

## 2. JORNADA DO CLIENTE — GAPS POR PERSONA

### 🟢 O que já funciona bem

| Persona | Pontos Fortes |
|---------|--------------|
| **Pai/Mãe** | Login com Google/biometria, pickup em 1 clique com animação, boletim digital, menu "Mais" organizado |
| **Professora** | Bottom nav reorganizada (Chamada, Notas, Agenda como prioridade), almoxarifado completo, Growth Plan |
| **Diretor** | Dashboard analytics, CRM Kanban, financeiro completo (DRE, balanço, boletos Inter), 45 painéis |
| **Admin SaaS** | Toggle granular de módulos por escola, gestão de planos, temas visuais |

### 🔴 Gaps críticos (impedem de ser top-tier)

#### Gap 1: Sem fluxo de onboarding
**Problema**: Escola contrata → e agora? Não há wizard de configuração, checklist de ativação, ou guia de primeiros passos.

**Solução**:
- Wizard de setup em 5 passos no primeiro login do gerente
- Checklist "Sua escola em 24h" com progresso visual
- Templates pré-populados (séries, disciplinas, períodos)
- Kit de lançamento para pais (QR code para portal, templates WhatsApp)

#### Gap 2: Fotos e câmera não são first-class
**Problema**: Na Agenda Digital, o upload de fotos é manual (base64 via campo). Deveria ser: abrir câmera → tirar foto → auto-enviar.

**Solução**:
- Botão flutuante de câmera no portal da professora
- Upload em background (não bloqueia UI)
- Compressão automática
- Galeria por dia com auto-tag de turma

#### Gap 3: Sem notificações push reais
**Problema**: Como PWA, as push notifications são limitadas. Pais não recebem alerta quando foto é postada ou pickup é chamado.

**Solução**:
- Web Push API (funciona em PWA no Android/desktop)
- Fallback WhatsApp para notificações urgentes (via API)
- Daily digest por email para pais
- Smart batching (máx 3 push/dia para não-urgentes)

#### Gap 4: Sem auto-save nos formulários
**Problema**: Se a professora preenche a chamada e a conexão cai, perde tudo.

**Solução**:
- Auto-save em cada campo (debounce 1s)
- LocalStorage como buffer offline
- Indicador visual "✓ Salvo" discreto
- Sync automático quando reconectar

#### Gap 5: Dashboard do diretor não tem "morning briefing"
**Problema**: Diretor precisa clicar em 5+ painéis para ter visão do dia. Brightwheel mostra tudo em 1 tela.

**Solução**:
- Tela "Bom dia, [nome]" com:
  - Frequência de hoje (%) com semáforo
  - Pagamentos pendentes (R$ e quantidade)
  - Leads novos
  - Alertas ativos
  - Eventos do dia
- Enviado como push/email às 7h

#### Gap 6: Sem métricas de ROI para renovação
**Problema**: Na hora de renovar, a escola não tem dados concretos do valor que o Lumied gerou.

**Solução**:
- Relatório automático mensal/anual:
  - "Mensagens enviadas: 12.000"
  - "Tempo admin economizado: ~480h"
  - "Inadimplência reduzida: 8% → 3.2%"
  - "Taxa de presença: 96%"
- Exportável em PDF para reunião de diretoria

#### Gap 7: Ações comuns exigem muitos cliques
**Problema**: Regra de ouro dos top SaaS é "3 taps para qualquer ação diária". Nosso app requer 3-4 cliques para ações básicas no gerente (seção colapsada + item).

**Solução**:
- "Quick Actions" no topo do dashboard: 4-6 atalhos para ações frequentes
- Seções recentes/favoritas no sidebar
- Busca rápida (Ctrl+K / ⌘K) para encontrar qualquer funcionalidade
- "Painéis fixados" pelo usuário

#### Gap 8: Sem modo offline
**Problema**: Escolas em áreas com internet instável perdem funcionalidade.

**Solução**:
- Service Worker com cache de dados recentes
- Queue offline para chamada, notas, mensagens
- Sync automático com merge inteligente
- Indicador "📡 Offline — dados serão sincronizados"

---

## 3. PLANO DE AÇÃO — PRIORIZADO POR IMPACTO

### ONDA 1 — Quick Wins (1-2 semanas) — Impacto imediato

| # | Ação | Persona | Esforço |
|---|------|---------|---------|
| 1 | **Quick Actions** no dashboard do gerente (4-6 botões grandes no topo) | Diretor | Baixo |
| 2 | **Morning Briefing** — tela resumo com KPIs do dia | Diretor | Médio |
| 3 | **Busca rápida** (Ctrl+K) para encontrar funcionalidades | Diretor | Médio |
| 4 | **Auto-save** em todos os formulários (debounce + localStorage) | Todos | Médio |
| 5 | **Botão câmera flutuante** no portal da professora | Professora | Baixo |
| 6 | **Daily Digest** por email para pais (resumo do dia da criança) | Pais | Médio |

### ONDA 2 — Diferenciadores (3-4 semanas) — Competitivo

| # | Ação | Persona | Esforço |
|---|------|---------|---------|
| 7 | **Wizard de onboarding** — setup em 5 passos no primeiro login | Diretor | Alto |
| 8 | **Web Push Notifications** (PWA push API) | Pais | Alto |
| 9 | **Kit de lançamento** para pais (QR code, templates WhatsApp) | Diretor/Pais | Médio |
| 10 | **Relatório ROI automático** (mensal + anual) | Diretor | Médio |
| 11 | **Photo upload em background** com compressão | Professora | Médio |
| 12 | **Streaks e milestones** sutis para professoras | Professora | Baixo |

### ONDA 3 — World-Class (5-8 semanas) — Líder de mercado

| # | Ação | Persona | Esforço |
|---|------|---------|---------|
| 13 | **Modo offline** (Service Worker + queue + sync) | Todos | Alto |
| 14 | **Memory Book** — resumo mensal automático com fotos | Pais | Alto |
| 15 | **Smart Notifications** — engine com batching, preferences, escalation | Todos | Alto |
| 16 | **School Health Score** — dashboard comparativo entre escolas (admin) | Admin SaaS | Alto |
| 17 | **App nativo** (Capacitor wrapping PWA) | Pais/Professora | Alto |
| 18 | **AI photo tagging** — sugestão de alunos em fotos de grupo | Professora | Alto |

---

## 4. MÉTRICAS DE SUCESSO

| Métrica | Atual (estimado) | Meta 6 meses | Meta 12 meses | Top EdTech |
|---------|-----------------|--------------|---------------|------------|
| Time to First Value | ~7 dias | **24 horas** | **4 horas** | < 24h |
| Adoção dos pais (30 dias) | ~50% | **80%** | **90%** | > 80% |
| Uso diário professora | ~60% | **85%** | **95%** | > 90% |
| Login semanal diretor | ~70% | **90%** | **95%** | > 85% |
| Tickets suporte/escola/mês | ~10 | **5** | **3** | < 5 |
| NPS | Não medido | **50** | **65** | > 60 |
| Churn anual | Não medido | **< 10%** | **< 5%** | < 5% |
| Tempo por ação comum | ~15s | **8s** | **5s** | < 10s |

---

## 5. O QUE NOS DIFERENCIA (já temos e ninguém tem)

| Diferencial | Por que importa |
|-------------|----------------|
| **Pickup animado** com carro + família + ETA GPS | Nenhum concorrente BR tem isso — cria conexão emocional |
| **CRM Kanban** integrado com matrícula + cálculo automático de série por idade | ClassApp/Sponte não têm CRM |
| **Almoxarifado** com busca de preços automática (Zoom, ML, Amazon) | Nenhum concorrente tem |
| **Busca de preços** com scraping multi-fonte | Único no mercado |
| **4 temas visuais** (Lúdico, Sério, Interativo, Corporativo) | Nenhum concorrente oferece customização visual |
| **Toggle granular** de módulos por escola via admin | Flexibilidade SaaS superior |
| **WebAuthn/Face ID** em todos os portais | Poucos concorrentes BR têm |
| **Chrome Extension** para WhatsApp com templates CRM | Inovador — integra CRM com o canal que as escolas realmente usam |

---

## 6. AUDITORIA DE JORNADA REAL (dados coletados via Puppeteer)

### Portal dos Pais — index.html
- **Load time**: 1.837ms (aceitável)
- **Auth options**: 2 visíveis (email/senha + Google OAuth)
- **Bottom nav**: 5 itens (Início, Dia a Dia, Boletim, Boletos, Mais) — **padrão correto**
- **Pickup animation**: Markup completo (carro, céu, estrada, ETA), CSS transitions funcionando
- **Feature gating**: 6 módulos com `data-modulo`
- **Bugs encontrados**:
  - Sem "Esqueci minha senha" no card de login (há link mas pouco visível)
  - Empty states dependem 100% de JS — sem skeleton loading no HTML
  - Hero do site escondido no mobile (`display:none` em <1024px)

### Portal da Professora — professora.html
- **Nav sidebar**: 12 itens (incluindo Chamada, Notas, Agenda, Diário)
- **Bottom nav**: 6 itens (Fila, Chamada, Notas, Agenda, Mais, Achados)
- **Bugs encontrados**:
  - **Diário de Classe NÃO está na bottom nav** — só acessível pela sidebar desktop
  - Achados aparece como 6º item solto em vez de dentro do "Mais"
  - Menu "Mais" pode não renderizar o grid corretamente no mobile

### Painel do Gerente — gerente.html
- **Sidebar**: 12 seções, 53 nav items, 55 painéis
- **Acadêmico confirmado**: 6 itens (Config Notas, Disciplinas, Períodos, Visão Geral, Frequência, Diário)
- **Feature gating**: 19 `data-modulo` attributes, 0 hidden (escola Enterprise)
- **Bugs encontrados**:
  - Sidebar muito longa — sem busca/filtro
  - Sem breadcrumbs na área de conteúdo

### Admin Panel — admin.html
- **Setup check**: Funciona — mostra "Configuração Inicial" com campo "Código de Ativação"
- **4 nav items**: Escolas, Planos, Módulos, Admins — correto
- **Bugs encontrados**:
  - Sem link "Já tenho conta? Fazer login" no form de setup
  - Se API `setup_check` falha, usuário fica preso no form de setup

### Portal do Aluno — aluno.html
- **Bottom nav**: 4 tabs (Notas, Frequência, Provas, Calendário)
- **Bugs encontrados**:
  - **Calendário mostra "Em breve"** — dead end
  - Sem recuperação de senha
  - Portal mais fraco (225 linhas vs 2662 do pais)

### Site Lumied — site/
- **Hero**: Screenshot real carrega (`naturalWidth > 0`)
- **Feature cards**: 6 imagens ÚNICAS (chat, financeiro, CRM, notas, almox, agenda) — **corrigido!**
- **Pricing**: 4 planos com toggle anual/mensal
- **Vídeos**: 9 disponíveis (1 com controls, 8 com hover-to-play)
- **Bugs encontrados**:
  - Vídeos com hover-to-play **não funcionam em touch/mobile**
  - Hero visual hidden no mobile (< 1024px)
  - Scroll para pricing pode não parar exatamente nos cards

---

## 7. BUGS IMEDIATOS A CORRIGIR (encontrados na auditoria)

| # | Bug | Local | Severidade | Esforço |
|---|-----|-------|-----------|---------|
| 1 | Diário de Classe fora da bottom nav da professora | professora.html | **Alta** | Baixo |
| 2 | Achados como 6º item solto na bottom nav (deveria estar no Mais) | professora.html | Média | Baixo |
| 3 | Vídeos do site não tocam no mobile (hover-only) | site/index.html | **Alta** | Baixo |
| 4 | Hero do site escondido no mobile | site/index.html | Média | Baixo |
| 5 | Calendário "Em breve" no portal do aluno | aluno.html | Média | Baixo (esconder tab) |
| 6 | Sem link "Já tenho conta?" no setup do admin | admin.html | Média | Baixo |
| 7 | Sem skeleton loading nos portais (empty state sem JS) | index.html, professora.html | Baixa | Médio |

---

## 8. CONCLUSÃO

### Scorecard de Customer Experience

| Dimensão | Score | Referência (Brightwheel) |
|----------|-------|------------------------|
| **Onboarding** | 2/5 | 5/5 (go-live em 48h) |
| **Jornada do Pai** | 4/5 | 5/5 (push + fotos + 1 tap) |
| **Jornada da Professora** | 3.5/5 | 5/5 (3-tap rule + offline) |
| **Jornada do Diretor** | 4/5 | 4.5/5 (traffic light dashboard) |
| **Mobile UX** | 3.5/5 | 5/5 (nativo + offline) |
| **Notificações** | 2/5 | 5/5 (smart batching + push) |
| **Engajamento/Retenção** | 2.5/5 | 5/5 (ROI + streaks + memory book) |
| **Site/Conversão** | 4/5 | 4.5/5 (instant demo + calculator) |

### Média geral CX: **3.2/5** (vs 4.8/5 do Brightwheel)

**Onde estamos**: Plataforma com features superiores à maioria dos concorrentes BR, mas a experiência diária ainda não compete com os top globais. Temos **mais módulos** que Brightwheel, mas eles vencem na **facilidade de uso**.

**O que falta para ser top-tier**: Não são features novas — é **polimento da experiência**. Quick actions, auto-save, push notifications, onboarding wizard, e métricas de ROI.

**A regra de ouro**: *"O app que ganha é o que a professora QUER usar todo dia e o pai ESCOLHE abrir voluntariamente — não porque precisa, mas porque conecta com a educação do filho."*

**Próximo passo**: Implementar a **Onda 1** (Quick Wins — 1-2 semanas) para saltar de 3.2 para **4.0/5**, depois Ondas 2-3 para chegar a **4.5+/5** e se posicionar como o melhor EdTech SaaS da América Latina.

### Investimento estimado por onda:
- **Onda 1** (Quick Wins): 1-2 semanas dev → impacto imediato em retenção
- **Onda 2** (Diferenciadores): 3-4 semanas dev → competitividade vs ClassApp/Sponte
- **Onda 3** (World-Class): 5-8 semanas dev → líder de mercado LATAM
