# Maple Bear RS — Contexto do Projeto

## Visão Geral

Sistema web para a escola **Maple Bear Bento Gonçalves, RS** (franquia canadense de ensino bilíngue). Permite que famílias façam solicitações de turno, se inscrevam em atividades extraclasse, visualizem agenda, registrem ausências e agendem reuniões com a direção.

**URL de produção:** https://maple-bear-rs.vercel.app  
**Repositório GitHub:** https://github.com/ivyson-wq/Escolha-de-turno

---

## Stack Técnica

| Camada | Tecnologia |
|---|---|
| Frontend | HTML estático + Vanilla JS (sem framework) |
| Hosting | Vercel (deploy automático via GitHub) |
| Backend | Supabase (banco PostgreSQL + Edge Functions Deno) |
| Auth pública | Supabase Auth (Magic Link + Google OAuth) |
| Auth gerentes | Sistema próprio (tabela `gerentes` + senhas PBKDF2) |
| E-mail | Resend HTTP API (domínio: maplebearcaxiasdosul.com.br) |
| PDF | jsPDF + html2canvas (gerado no navegador) |
| PWA | manifest.json + service worker (sw.js) |

---

## Credenciais e Configurações

### Supabase
- **Project URL:** `https://brgorknbrjlfwvrrlwxj.supabase.co`
- **Anon Key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyZ29ya25icmpsZnd2cnJsd3hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjU0NTUsImV4cCI6MjA4OTM0MTQ1NX0.QKX_6ZSfied60ZpB8VOx03hwiyD9J5lskKwfl-oXPYE`
- **Authentication → Site URL:** `https://maple-bear-rs.vercel.app`
- **JWT Verification em Edge Functions:** DESATIVADO (todas as funções são públicas)

### Secrets das Edge Functions (Supabase → Edge Functions → Secrets)
- `RESEND_API_KEY` — chave da API do Resend (começa com `re_`)
- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` — automáticos
- `GOOGLE_SERVICE_ACCOUNT` — JSON da service account Google (opcional, para Google Calendar)

### Resend
- **Domínio verificado:** `maplebearcaxiasdosul.com.br`
- **Sender:** `noreply@maplebearcaxiasdosul.com.br`
- **Uso:** API HTTP direta (NÃO usar biblioteca SMTP — quebra com Deno runtime atual)

### Google OAuth (para login público)
- Configurado no Google Cloud Console
- **Redirect URI autorizado:** `https://brgorknbrjlfwvrrlwxj.supabase.co/auth/v1/callback`

### Logo
- **URL raw GitHub:** `https://raw.githubusercontent.com/ivyson-wq/Escolha-de-turno/main/Design%20sem%20nome.png`

---

## Estrutura de Arquivos

```
/
├── index.html          # Formulário público (famílias)
├── gerente.html        # Painel gerencial
├── setup.html          # Criação do primeiro gerente
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker (PWA)
└── supabase/
    ├── migrations/
    │   ├── 001_schema.sql           # Schema base
    │   ├── 003_dias_semana.sql      # Coluna dias_semana
    │   ├── 004_atividades.sql       # Tabelas atividades e inscrições
    │   ├── 005_turmas.sql           # Estrutura de turmas com slots
    │   ├── 006_vagas.sql            # Campo vagas por turma
    │   ├── 007_professoras_ausencias.sql  # Professoras, ausências, almoço
    │   └── 008_reunioes.sql         # Gestoras, horários, reuniões
    └── functions/
        ├── api/index.ts             # Edge Function principal
        ├── send-email/index.ts      # Edge Function de e-mail (Resend HTTP)
        └── calendar/index.ts        # Edge Function Google Calendar
```

---

## Banco de Dados — Tabelas

### Tabelas principais
| Tabela | Descrição |
|---|---|
| `gerentes` | Usuários do painel gerencial (senha PBKDF2) |
| `gerente_sessoes` | Tokens de sessão dos gerentes |
| `series` | Séries escolares (Year 1, Year 2, etc.) |
| `solicitacoes` | Solicitações de alteração de turno |
| `atividades` | Atividades extraclasse cadastradas |
| `inscricoes_atividades` | Inscrições nas atividades |
| `professoras` | Professoras que recebem aviso de ausência |
| `ausencias` | Ausências registradas pelos responsáveis |
| `gestoras` | Diretora e Coordenadora (para reuniões) |
| `horarios_disponiveis` | Slots semanais de cada gestora |
| `reunioes` | Reuniões agendadas |
| `configuracoes` | Chave-valor: logo_url, almoco_preco |

### Estrutura JSONB das atividades (`horarios`)
```json
[
  {
    "turma": "Turma A — 14h",
    "vagas": 15,
    "almoco_disponivel": true,
    "almoco_preco": 50.00,
    "slots": [
      {"dia": "Terça", "inicio": "14:00", "fim": "15:00"},
      {"dia": "Quinta", "inicio": "14:00", "fim": "15:00"}
    ]
  }
]
```

---

## Edge Functions — Actions

### `api` (função principal)
**Públicas (sem auth):**
- `setup_check`, `setup`, `login`, `logout`
- `series_list`, `atividades_list` (com contagem inscritos/vagas)
- `config_get`
- `public_submit` (turno)
- `inscricao_atividade_submit` (atividades)
- `minha_agenda` (turno + atividades + ausências do responsável)
- `ausencia_submit`, `ausencia_delete`

**Autenticadas (gerente):**
- `solicitacoes_list/update_turno/delete`
- `series_list_all/create/update/delete`
- `atividades_list_all/create/update/update_full/delete`
- `inscricoes_atividades_list/delete`
- `gerentes_list/create/delete/change_password`
- `professoras_list/create/delete`
- `config_set/delete`
- `logo_upload/remove`
- `relatorio_upload` (PDF → Supabase Storage → link público)

### `send-email`
Usa Resend HTTP API diretamente. Tipos suportados: `turno`, `atividade`, `ausencia`

**IMPORTANTE:** NÃO usar biblioteca SMTP (`smtp@v0.7.0`) — `Deno.writeAll` foi removida. Usar sempre fetch para `api.resend.com/emails`.

### `calendar`
Google Calendar via Service Account JWT. Actions: `gestoras_list`, `gestoras_update`, `horarios_list/create/delete`, `slots_disponiveis`, `agendar_reuniao`, `cancelar_reuniao`, `reunioes_list`, `minhas_reunioes`

---

## Funcionalidades — Formulário Público (index.html)

### Fluxo do usuário
1. **Login** — Magic Link por e-mail OU Google OAuth
2. **Agenda** — exibe próximos 5 dias (expansível), com botão de registrar ausência por dia
3. **Formulário** — escolha entre:
   - **Alteração de Turno** — 12 opções, modal de dias para frequências < 5x/semana
   - **Atividades Extraclasse** — cards com turmas, vagas, opção de almoço por turma, detecção de conflito de horários
4. **Agendar Reunião** — escolha gestora + slot disponível + assunto (no fim da página)
5. **Sucesso** — e-mail de confirmação enviado

### Autenticação pública
- Magic Link: Supabase Auth OTP (SMTP via Resend configurado no Supabase)
- Google OAuth: configurado no Google Cloud Console

---

## Funcionalidades — Painel Gerencial (gerente.html)

### Sidebar — seções
**Turnos 2026**
- Dashboard Turnos — stats + crianças por dia + tabela filtrável + exportar PDF + compartilhar PDF via WhatsApp

**Atividades Extraclasse**
- Dashboard Atividades — stats + crianças por dia (agrupadas por atividade e turma) + ocupação + inscrições
- Gerenciar Atividades — CRUD atividades com turmas, vagas, almoço; lista de inscrições

**Configurações**
- Professoras — CRUD professoras + preço padrão do almoço
- Reuniões — lista de reuniões; edição de gestoras (nome, e-mail, Calendar ID); CRUD horários
- Logotipo — upload/remoção
- Usuários — CRUD gerentes + alterar senha

### Exportar PDF e WhatsApp
- **📄 Exportar PDF** — gera PDF com jsPDF + html2canvas, baixa no computador
- **Compartilhar PDF** — gera PDF, faz upload para Supabase Storage bucket `relatorios`, envia link via WhatsApp

---

## PWA

- `manifest.json` — nome, ícone, cores, display standalone
- `sw.js` — service worker com cache network-first
- Banner de instalação automático no Android/Chrome
- No iOS: usuário instala manualmente via Safari → Compartilhar → Adicionar à Tela de Início

---

## Decisões Técnicas Importantes

1. **Auth de gerentes separada do Supabase Auth** — sistema próprio com PBKDF2, para não misturar com auth das famílias
2. **Resend HTTP API em vez de SMTP** — a biblioteca `smtp@v0.7.0` quebrou com atualização do Deno (`Deno.writeAll` removido)
3. **JWT Verification desativado** nas Edge Functions — necessário para chamadas públicas sem token de usuário
4. **JSONB para horários de atividades** — flexibilidade para múltiplas turmas por atividade
5. **Geração de PDF no navegador** — sem servidor, sem custo, usando jsPDF + html2canvas
6. **Sem framework JS** — HTML + Vanilla JS puro para simplicidade e velocidade de carregamento

---

## Gestoras Padrão

| Cargo | Nome | E-mail |
|---|---|---|
| Diretora Pedagógica | Simone Onzi | simone@escola.com.br |
| Coordenadora Pedagógica | Daiane | daiane@escola.com.br |

*Editáveis no painel: Reuniões → Gestoras*

---

## Histórico de Problemas Resolvidos

- **`smtp@v0.7.0` quebrado** — migrado para Resend HTTP API
- **401 nas Edge Functions** — todas as chamadas precisam de `Authorization: Bearer {ANON_KEY}`
- **Modal ausência não abrindo** — `style="display:none"` inline sobrepõe classe CSS; removido o inline style
- **Atividades não carregando** — `atividades_list` estava na seção autenticada da API; movido para público
- **`inscricao_atividade_submit` com 401** — mesmo problema, movido para seção pública
- **onclick quebrado nos cards de agenda** — aspas simples dentro de template literals; corrigido com `data-attributes`
- **Turmas não abrindo no formulário** — re-render completo do DOM causava travamento; refatorado para atualização pontual dos elementos

---

## Próximos Passos Sugeridos

- Integração Z-API para envio automático de ausências por WhatsApp
- Notificações push (requer upgrade para Capacitor/app nativo)
- Relatórios mensais automáticos por e-mail
- Portal de pagamentos das atividades
