-- =====================================================
-- 087: Sistema de Suporte — Tickets + FAQ Automático
-- =====================================================

-- ── Base de conhecimento (FAQ) ──────────────────────
CREATE TABLE IF NOT EXISTS suporte_faq (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  pergunta text NOT NULL,
  resposta text NOT NULL,
  palavras_chave text[] DEFAULT '{}',       -- tags para matching
  categoria text DEFAULT 'geral',           -- 'geral','financeiro','notas','frequencia','acesso','boletos','agenda'
  portal text DEFAULT 'todos',              -- 'todos','pais','professora','gerente','aluno','secretaria'
  ordem integer DEFAULT 0,
  ativo boolean DEFAULT true,
  visualizacoes integer DEFAULT 0,
  util_sim integer DEFAULT 0,
  util_nao integer DEFAULT 0,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE suporte_faq DISABLE ROW LEVEL SECURITY;

-- ── Tickets de suporte ──────────────────────────────
CREATE TABLE IF NOT EXISTS suporte_tickets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  numero serial,                            -- número sequencial legível
  titulo text NOT NULL,
  descricao text NOT NULL,
  categoria text DEFAULT 'geral',
  prioridade text DEFAULT 'normal',         -- 'baixa','normal','alta','urgente'
  status text DEFAULT 'aberto',             -- 'aberto','em_andamento','aguardando_usuario','resolvido','fechado'
  portal_origem text,                       -- de qual portal veio
  -- Usuário que abriu
  usuario_nome text NOT NULL,
  usuario_email text NOT NULL,
  usuario_tipo text,                        -- 'pai','professora','gerente','aluno','secretaria'
  -- Resolução
  resolvido_por text,
  resolucao text,
  resolvido_em timestamptz,
  -- FAQ tentativa
  faq_tentou boolean DEFAULT false,         -- se o chatbot tentou resolver antes
  faq_ids_mostrados uuid[],                 -- quais FAQs foram mostradas
  faq_resolveu boolean DEFAULT false,       -- se o FAQ resolveu (ticket não foi criado)
  -- Metadata
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE suporte_tickets DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_suporte_tickets_status ON suporte_tickets(status);
CREATE INDEX idx_suporte_tickets_email ON suporte_tickets(usuario_email);

-- ── Mensagens do ticket ─────────────────────────────
CREATE TABLE IF NOT EXISTS suporte_mensagens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES suporte_tickets(id) ON DELETE CASCADE,
  autor_nome text NOT NULL,
  autor_tipo text NOT NULL,                 -- 'usuario','suporte','sistema'
  mensagem text NOT NULL,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE suporte_mensagens DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_suporte_msgs_ticket ON suporte_mensagens(ticket_id);

-- Trigger atualizado_em
CREATE TRIGGER suporte_tickets_atualizado
  BEFORE UPDATE ON suporte_tickets
  FOR EACH ROW EXECUTE FUNCTION trigger_set_atualizado_em();

-- ── FAQ inicial (respostas mais comuns) ─────────────
INSERT INTO suporte_faq (pergunta, resposta, palavras_chave, categoria, portal) VALUES
('Como altero minha senha?', 'Acesse o portal, clique no seu nome no canto superior direito e selecione "Alterar Senha". Digite sua senha atual e a nova senha desejada. Se esqueceu a senha, clique em "Esqueci minha senha" na tela de login.', '{senha,alterar,trocar,esqueci,password}', 'acesso', 'todos'),
('Não consigo fazer login', 'Verifique se o e-mail está correto (sem espaços extras). Tente limpar o cache do navegador (Ctrl+Shift+Del). Se o problema persistir, peça à coordenação para resetar sua senha.', '{login,entrar,acesso,erro,nao consigo}', 'acesso', 'todos'),
('Onde vejo o boletim do meu filho?', 'No Portal dos Pais, acesse a seção "Boletim" no menu inferior. Lá você encontra as notas por disciplina e período. O boletim é atualizado conforme as professoras lançam as notas.', '{boletim,notas,nota,resultado,media}', 'notas', 'pais'),
('Como vejo a frequência?', 'No Portal dos Pais, acesse "Frequência" no menu. Você verá o percentual de presença e o histórico de faltas. Caso identifique alguma divergência, entre em contato com a secretaria.', '{frequencia,presenca,falta,faltas,chamada}', 'frequencia', 'pais'),
('Como emitir segunda via do boleto?', 'No Portal dos Pais, acesse a seção "Boletos". Clique no boleto desejado para visualizar ou copiar o código de barras/PIX. Boletos vencidos são atualizados automaticamente com juros e multa.', '{boleto,segunda via,pagar,pagamento,pix,codigo}', 'financeiro', 'pais'),
('Como registro a chamada?', 'No Portal da Professora, acesse "Chamada". Selecione a turma e marque os alunos presentes/ausentes. A chamada pode ser editada até o final do dia.', '{chamada,presenca,falta,registro,frequencia}', 'frequencia', 'professora'),
('Como lanço notas?', 'No Portal da Professora, acesse "Notas". Selecione a turma, disciplina e período. Preencha as notas no grid e clique em "Salvar". As notas ficam visíveis para os pais automaticamente.', '{notas,lancar,nota,boletim,avaliacao}', 'notas', 'professora'),
('Como envio recado pela agenda digital?', 'No Portal da Professora, acesse "Agenda Digital". Selecione a turma, escreva o recado, adicione fotos se quiser e envie. Os pais recebem notificação instantânea.', '{agenda,recado,diario,mensagem,foto}', 'geral', 'professora'),
('A página não carrega / está lenta', 'Tente atualizar a página (F5 ou Ctrl+R). Limpe o cache do navegador. Verifique sua conexão com a internet. Se usar Wi-Fi, tente mudar para dados móveis como teste. O sistema é compatível com Chrome, Safari e Firefox atualizados.', '{lento,carrega,erro,pagina,branco,bug,travou}', 'geral', 'todos'),
('Como falo com a escola?', 'Você pode usar o Chat dentro do portal para enviar mensagem diretamente para a escola. Para assuntos financeiros, use o e-mail da secretaria. Para emergências, ligue diretamente para a escola.', '{contato,falar,escola,telefone,email,chat}', 'geral', 'pais')
ON CONFLICT DO NOTHING;
