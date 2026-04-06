-- 203: Habilitar Supabase Realtime nas tabelas de dashboard e pickup
-- Substitui polling (fetch a cada N segundos) por WebSocket push

ALTER PUBLICATION supabase_realtime ADD TABLE solicitacoes;
ALTER PUBLICATION supabase_realtime ADD TABLE inscricoes_atividades;
ALTER PUBLICATION supabase_realtime ADD TABLE pickup_notificacoes;
