-- Migration 250: Update matriculas 2026/2027 from enrollment spreadsheets
-- 2026: 209 students, 2027: 248 students

DO $$
DECLARE
  eid uuid;
BEGIN
  SELECT id INTO eid FROM escolas WHERE slug = 'maplebear' OR nome ILIKE '%Maple Bear%' LIMIT 1;
  IF eid IS NULL THEN RAISE EXCEPTION 'Escola Maple Bear not found'; END IF;

  DELETE FROM crm_matriculas WHERE escola_id = eid AND ano IN (2026, 2027);
  DELETE FROM crm_turmas_vagas WHERE escola_id = eid AND ano IN (2026, 2027);

  INSERT INTO crm_turmas_vagas (serie, ano, qtd_turmas, vagas_por_turma, ordem, escola_id)
    VALUES ('BEAR CARE', 2026, 1, 18, 0, eid);
  INSERT INTO crm_turmas_vagas (serie, ano, qtd_turmas, vagas_por_turma, ordem, escola_id)
    VALUES ('TODDLER', 2026, 2, 18, 1, eid);
  INSERT INTO crm_turmas_vagas (serie, ano, qtd_turmas, vagas_por_turma, ordem, escola_id)
    VALUES ('NURSERY', 2026, 3, 18, 2, eid);
  INSERT INTO crm_turmas_vagas (serie, ano, qtd_turmas, vagas_por_turma, ordem, escola_id)
    VALUES ('JK', 2026, 2, 18, 3, eid);
  INSERT INTO crm_turmas_vagas (serie, ano, qtd_turmas, vagas_por_turma, ordem, escola_id)
    VALUES ('SK', 2026, 2, 18, 4, eid);
  INSERT INTO crm_turmas_vagas (serie, ano, qtd_turmas, vagas_por_turma, ordem, escola_id)
    VALUES ('YEAR 1', 2026, 2, 18, 5, eid);
  INSERT INTO crm_turmas_vagas (serie, ano, qtd_turmas, vagas_por_turma, ordem, escola_id)
    VALUES ('YEAR 2', 2026, 1, 18, 6, eid);
  INSERT INTO crm_turmas_vagas (serie, ano, qtd_turmas, vagas_por_turma, ordem, escola_id)
    VALUES ('YEAR 3', 2026, 1, 18, 7, eid);
  INSERT INTO crm_turmas_vagas (serie, ano, qtd_turmas, vagas_por_turma, ordem, escola_id)
    VALUES ('BEAR CARE', 2027, 1, 18, 0, eid);
  INSERT INTO crm_turmas_vagas (serie, ano, qtd_turmas, vagas_por_turma, ordem, escola_id)
    VALUES ('TODDLER', 2027, 2, 18, 1, eid);
  INSERT INTO crm_turmas_vagas (serie, ano, qtd_turmas, vagas_por_turma, ordem, escola_id)
    VALUES ('NURSERY', 2027, 3, 18, 2, eid);
  INSERT INTO crm_turmas_vagas (serie, ano, qtd_turmas, vagas_por_turma, ordem, escola_id)
    VALUES ('JK', 2027, 3, 18, 3, eid);
  INSERT INTO crm_turmas_vagas (serie, ano, qtd_turmas, vagas_por_turma, ordem, escola_id)
    VALUES ('SK', 2027, 2, 18, 4, eid);
  INSERT INTO crm_turmas_vagas (serie, ano, qtd_turmas, vagas_por_turma, ordem, escola_id)
    VALUES ('YEAR 1', 2027, 2, 18, 5, eid);
  INSERT INTO crm_turmas_vagas (serie, ano, qtd_turmas, vagas_por_turma, ordem, escola_id)
    VALUES ('YEAR 2', 2027, 2, 18, 6, eid);
  INSERT INTO crm_turmas_vagas (serie, ano, qtd_turmas, vagas_por_turma, ordem, escola_id)
    VALUES ('YEAR 3', 2027, 1, 18, 7, eid);
  INSERT INTO crm_turmas_vagas (serie, ano, qtd_turmas, vagas_por_turma, ordem, escola_id)
    VALUES ('YEAR 4', 2027, 1, 18, 8, eid);

  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Arthur Zanotto Casagrande Boff', 'BEAR CARE', 'A', 2026, 'matriculado', '2024-12-04', '2025-04-28', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'João Felipe de Almeida Reis', 'BEAR CARE', 'A', 2026, 'matriculado', '2024-06-24', '2025-06-12', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antonia Fanton Bongiolo', 'BEAR CARE', 'A', 2026, 'matriculado', '2024-05-17', '2025-07-10', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Malu Cardoso Moraes', 'BEAR CARE', 'A', 2026, 'matriculado', '2024-09-27', '2025-07-11', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Bernardo Fochesato Nadin', 'BEAR CARE', 'A', 2026, 'matriculado', '2025-01-14', '2025-09-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Rafael Brisotto Zart', 'BEAR CARE', 'A', 2026, 'matriculado', '2024-08-12', '2025-09-08', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Daniel Gotardo', 'BEAR CARE', 'A', 2026, 'matriculado', '2024-05-12', '2025-10-20', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Amália Rodrigues Alessi', 'BEAR CARE', 'A', 2026, 'matriculado', '2024-08-12', '2025-10-30', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matteo de Oliveira Rettore', 'BEAR CARE', 'A', 2026, 'matriculado', '2024-06-13', '2025-11-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Betina Giani Bidese', 'BEAR CARE', 'A', 2026, 'matriculado', '2024-05-17', '2025-11-11', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Martina Porciuncula', 'BEAR CARE', 'A', 2026, 'matriculado', '2025-05-02', '2026-01-28', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antonella Thorell Franceschini', 'BEAR CARE', 'A', 2026, 'matriculado', '2025-02-27', '2026-02-06', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Serena Rodrigues dos Santos', 'BEAR CARE', 'A', 2026, 'matriculado', '2024-09-09', '2026-05-02', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Conrado Bianchi Hemann', 'TODDLER', 'A', 2026, 'matriculado', '2023-07-24', '2024-04-05', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Guilherme Minuscoli Gregoletto', 'TODDLER', 'A', 2026, 'matriculado', '2023-04-03', '2024-06-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Carmel Camilo Pérsico', 'TODDLER', 'A', 2026, 'matriculado', '2023-04-18', '2024-07-11', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Augusto da Silva Gelain', 'TODDLER', 'A', 2026, 'matriculado', '2023-09-18', '2024-08-15', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Lilibeth Rezer Reis', 'TODDLER', 'A', 2026, 'matriculado', '2023-06-26', '2024-08-21', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Luca Dal Lago Armiliato', 'TODDLER', 'A', 2026, 'matriculado', '2023-08-01', '2024-10-28', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Eduardo Bortolotto da Silveira', 'TODDLER', 'A', 2026, 'matriculado', '2023-09-05', '2024-11-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Cecília Agnoletto Fernandes', 'TODDLER', 'A', 2026, 'matriculado', '2023-11-30', '2024-11-26', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Jade Consorte', 'TODDLER', 'A', 2026, 'matriculado', '2023-04-04', NULL, eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Mathias Mazzarollo', 'TODDLER', 'A', 2026, 'matriculado', '2023-11-13', '2025-02-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Augusto Klassmann Concer', 'TODDLER', 'A', 2026, 'matriculado', '2023-12-07', '2025-01-31', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Davi Boff Comandulli', 'TODDLER', 'A', 2026, 'matriculado', '2023-12-05', '2025-02-27', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Murilo Zinn Dotta', 'TODDLER', 'A', 2026, 'matriculado', '2023-11-28', '2025-04-01', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Liz Perizzollo Pacheco', 'TODDLER', 'A', 2026, 'matriculado', '2023-04-29', '2025-04-02', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Rafael Kich Guerra', 'TODDLER', 'A', 2026, 'matriculado', '2023-12-08', '2025-04-02', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Julia Azevedo Dornelles', 'TODDLER', 'A', 2026, 'matriculado', '2023-07-19', '2025-07-25', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Pedro Colla Susin', 'TODDLER', 'A', 2026, 'matriculado', '2023-09-27', '2025-11-18', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matteo de Oliveira Canuto', 'TODDLER', 'B', 2026, 'matriculado', '2023-11-01', '2025-04-03', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Murilo de Lima Abreu', 'TODDLER', 'B', 2026, 'matriculado', '2024-01-26', '2025-04-08', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matteo Luigi Porciuncula', 'TODDLER', 'B', 2026, 'matriculado', '2023-12-02', '2025-04-14', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Carlos de Vargas Soares', 'TODDLER', 'B', 2026, 'matriculado', '2024-01-02', '2025-04-15', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matteo Fagherazzi Lazzarin', 'TODDLER', 'B', 2026, 'matriculado', '2024-02-10', '2025-04-16', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Guilherme Momolli de Oliveira', 'TODDLER', 'B', 2026, 'matriculado', '2023-10-25', '2025-04-24', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Livia Fochesatto', 'TODDLER', 'B', 2026, 'matriculado', '2024-01-23', '2025-04-28', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matteo Piccinini Segalin', 'TODDLER', 'B', 2026, 'matriculado', '2023-12-23', '2025-04-29', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Isabella Costa Colonetti', 'TODDLER', 'B', 2026, 'matriculado', '2023-08-23', '2025-09-12', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Theodoro Biridi Heinen', 'TODDLER', 'B', 2026, 'matriculado', '2023-11-11', '2025-05-13', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matteo Olmi', 'TODDLER', 'B', 2026, 'matriculado', '2023-11-03', '2025-06-03', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Ravi Barboza Martins', 'TODDLER', 'B', 2026, 'matriculado', '2023-05-22', '2025-07-10', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Aurora Crestoni Kleber', 'TODDLER', 'B', 2026, 'matriculado', '2023-12-16', '2025-09-16', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Rafael dos Santos Pereira', 'TODDLER', 'B', 2026, 'matriculado', '2023-07-31', '2025-10-14', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Bianca NIcola de Prá', 'TODDLER', 'B', 2026, 'matriculado', '2023-10-15', '2025-10-29', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Guilherme Gottardo de David', 'TODDLER', 'B', 2026, 'matriculado', '2023-09-29', '2025-11-06', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Pedro Spagnolo', 'TODDLER', 'B', 2026, 'matriculado', NULL, '2025-11-07', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Angelo Vendrame Melo', 'NURSERY', 'A', 2026, 'matriculado', '2022-07-22', '2023-09-21', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antonella Bortoncello Fedrizzi', 'NURSERY', 'A', 2026, 'matriculado', '2022-10-06', '2024-06-25', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Arthur de Souza Amaral', 'NURSERY', 'A', 2026, 'matriculado', '2022-05-19', '2024-01-29', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Benício Werner Nesello', 'NURSERY', 'A', 2026, 'matriculado', '2022-07-01', '2023-08-30', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Germano de Lima Abreu', 'NURSERY', 'A', 2026, 'matriculado', '2022-07-01', '2024-07-15', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'João Fiamenghi Dalla Vecchia', 'NURSERY', 'A', 2026, 'matriculado', '2023-03-02', '2024-07-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Laís Bof Gregoletto', 'NURSERY', 'A', 2026, 'matriculado', '2022-06-19', '2024-04-16', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Luan Lemos Studt', 'NURSERY', 'A', 2026, 'matriculado', '2022-11-11', '2024-07-24', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Martin Knopp da Silva Ramos', 'NURSERY', 'A', 2026, 'matriculado', '2022-05-28', '2024-06-17', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matteo Barp Bertolassi', 'NURSERY', 'A', 2026, 'matriculado', '2022-05-23', '2022-10-30', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matteo dos Santos Borges', 'NURSERY', 'A', 2026, 'matriculado', '2022-09-15', '2024-06-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Olivia Cardoso Moraes', 'NURSERY', 'A', 2026, 'matriculado', '2022-06-24', '2023-06-01', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Pedro Flores Vanni', 'NURSERY', 'A', 2026, 'matriculado', '2022-10-29', '2023-10-05', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Pietro Furlan Bandeira', 'NURSERY', 'A', 2026, 'matriculado', '2022-09-14', '2024-07-09', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Samuel Schimer', 'NURSERY', 'A', 2026, 'matriculado', '2022-05-24', '2023-09-15', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Sofia Rech', 'NURSERY', 'A', 2026, 'matriculado', '2022-06-30', '2023-12-20', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Vitoria Mota Winter', 'NURSERY', 'A', 2026, 'matriculado', '2022-06-08', '2023-10-26', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Nicolas Calgaro Zucco', 'NURSERY', 'A', 2026, 'matriculado', '2022-05-23', '2025-09-10', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Aurora Casagrande Valduga', 'NURSERY', 'B', 2026, 'matriculado', '2022-08-16', '2024-10-22', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Aurora Martinelli Sgarbi', 'NURSERY', 'B', 2026, 'matriculado', '2022-06-17', '2025-07-24', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Bento Tonezer Tedesco', 'NURSERY', 'B', 2026, 'matriculado', '2023-03-17', '2024-09-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Bento Veronese Pan', 'NURSERY', 'B', 2026, 'matriculado', '2023-02-16', '2025-06-09', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Bernardo Farias Triches', 'NURSERY', 'B', 2026, 'matriculado', '2022-09-19', NULL, eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Davi de Araujo Rombaldi', 'NURSERY', 'B', 2026, 'matriculado', '2022-11-16', '2025-05-05', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Eduardo de Moraes Celli', 'NURSERY', 'B', 2026, 'matriculado', '2022-08-19', '2024-08-12', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Giovana Postali Rech', 'NURSERY', 'B', 2026, 'matriculado', '2022-12-12', '2024-08-05', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Julia Vanin Pergher', 'NURSERY', 'B', 2026, 'matriculado', '2022-04-26', '2025-04-22', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Leonardo da Rosa Silva', 'NURSERY', 'B', 2026, 'matriculado', '2022-09-30', '2024-10-15', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Luiz Paulo de Almeida Reis', 'NURSERY', 'B', 2026, 'matriculado', '2022-09-12', '2024-07-24', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Manuela Thorell Franceschini', 'NURSERY', 'B', 2026, 'matriculado', '2022-11-19', '2024-12-11', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maria Clara Marin Dapper', 'NURSERY', 'B', 2026, 'matriculado', '2022-11-26', '2024-11-08', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Martin Zolet Moscher', 'NURSERY', 'B', 2026, 'matriculado', '2022-05-05', '2025-04-30', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Miguel Bonfant Flach', 'NURSERY', 'B', 2026, 'matriculado', '2023-02-02', '2024-09-03', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Pedro Zampieron Bittencourt', 'NURSERY', 'B', 2026, 'matriculado', '2022-11-14', '2025-05-21', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Pedro Alberto Zanotti Costantin', 'NURSERY', 'B', 2026, 'matriculado', '2023-01-10', '2025-05-20', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maria Antonia del Gaudio Luz', 'NURSERY', 'B', 2026, 'matriculado', '2022-10-27', '2025-08-20', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Rafael Marchett', 'NURSERY', 'C', 2026, 'matriculado', '2022-10-14', '2025-08-11', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Arthur Kehl Picolli', 'NURSERY', 'C', 2026, 'matriculado', '2023-02-02', '2025-09-02', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Leon Pelegrini Cosila', 'NURSERY', 'C', 2026, 'matriculado', '2023-02-09', '2025-04-14', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Briana Marquetti de Oliveira', 'NURSERY', 'C', 2026, 'matriculado', '2022-04-05', '2025-11-17', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Betina Daros Tondo Pereira', 'NURSERY', 'C', 2026, 'matriculado', '2022-05-29', '2025-11-26', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Cecília Ferrari Nasser', 'NURSERY', 'C', 2026, 'matriculado', '2023-02-05', '2026-01-27', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Manuela Stedile Troes', 'NURSERY', 'C', 2026, 'matriculado', '2022-04-24', '2026-01-12', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antônio Dantas Reis', 'NURSERY', 'C', 2026, 'matriculado', '2022-09-25', '2026-01-14', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Bernado Zottis Focchesato', 'NURSERY', 'C', 2026, 'matriculado', '2022-09-19', '2026-01-16', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Cecília Rodrigues dos Santos', 'NURSERY', 'C', 2026, 'matriculado', '2022-04-29', '2026-01-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maria Medeiros Donada', 'NURSERY', 'C', 2026, 'matriculado', '2022-10-14', '2026-01-12', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'ANTONIETTA ELY PEREIRA', 'NURSERY', 'C', 2026, 'matriculado', '2022-04-24', '2026-03-10', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Adele Lazarin', 'JK', 'A', 2026, 'matriculado', '2021-09-07', '2022-12-06', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antônio Dalzochio Seitenfus', 'JK', 'A', 2026, 'matriculado', '2021-07-27', '2023-01-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maria Luiza Chiarello Vargas', 'JK', 'A', 2026, 'matriculado', '2021-04-01', '2022-12-05', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Davi Lucas Fochesatto', 'JK', 'A', 2026, 'matriculado', '2021-05-18', '2023-03-24', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Olívia Chaves Bedin', 'JK', 'A', 2026, 'matriculado', '2021-09-24', '2022-11-29', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Theodoro Bertolazzi de Almeida', 'JK', 'A', 2026, 'matriculado', '2021-06-23', '2022-12-09', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Vicenzo Lusa Bergonsi', 'JK', 'A', 2026, 'matriculado', '2021-06-04', '2022-10-27', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antonella Barbosa Suzin', 'JK', 'A', 2026, 'matriculado', '2021-11-17', '2024-07-02', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Elisa Pedrotti Montes de Oca', 'JK', 'A', 2026, 'matriculado', '2021-04-26', '2024-01-03', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Valentin Pipe de David Variani', 'JK', 'A', 2026, 'matriculado', '2021-08-14', '2024-01-09', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maya Argenta', 'JK', 'A', 2026, 'matriculado', '2021-07-08', '2022-12-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Arthur Sebben Pretto', 'JK', 'A', 2026, 'matriculado', '2021-07-31', '2022-12-18', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Luiza Farias Randon', 'JK', 'A', 2026, 'matriculado', '2021-07-05', '2023-04-18', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Lara Mezzomo Schiavo', 'JK', 'A', 2026, 'matriculado', '2022-03-28', '2023-08-30', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Lucca Dickel de Lima', 'JK', 'A', 2026, 'matriculado', '2022-03-01', '2023-09-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Francisco Zanetti Ferrari', 'JK', 'A', 2026, 'matriculado', '2021-07-17', '2023-09-27', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antonio de Carli Corradi', 'JK', 'A', 2026, 'matriculado', '2021-10-21', '2023-12-01', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maitê Franco Zanrosso', 'JK', 'A', 2026, 'matriculado', '2021-11-25', '2024-07-01', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Giovana Souza Giacomet', 'JK', 'B', 2026, 'matriculado', '2021-12-10', '2024-07-30', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Romana Andretta Schauren', 'JK', 'B', 2026, 'matriculado', '2021-12-31', NULL, eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Vicente Giasson Lopes', 'JK', 'B', 2026, 'matriculado', '2022-02-08', '2024-10-11', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antonella Fedrizzi Brognoli', 'JK', 'B', 2026, 'matriculado', '2022-02-20', '2024-07-08', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Laura Bertoldo Fichtner', 'JK', 'B', 2026, 'matriculado', '2022-03-14', '2024-08-14', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Davi de Zorzi Carraro', 'JK', 'B', 2026, 'matriculado', '2021-08-13', '2025-01-27', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Martina Citton Scariot', 'JK', 'B', 2026, 'matriculado', '2021-08-19', '2025-01-29', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Alice Costa Munaro', 'JK', 'B', 2026, 'matriculado', '2021-07-23', '2025-09-29', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Luísa Laghetto Lessa', 'JK', 'B', 2026, 'matriculado', '2021-06-09', '2026-01-20', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Carolina Colussi Schmitt', 'JK', 'B', 2026, 'matriculado', '2030-12-30', '2026-02-11', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Chloe Brylynskyi Ferreira Bortolini dos Anjos', 'JK', 'B', 2026, 'matriculado', '2021-09-21', '2026-03-18', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Cecília Bampi Stringari Muller', 'SK', 'A', 2026, 'matriculado', '2020-07-10', '2022-10-20', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Cecília Mezzomo Schiavo', 'SK', 'A', 2026, 'matriculado', '2020-07-20', '2022-10-24', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Dante Bessa Lima de Brito', 'SK', 'A', 2026, 'matriculado', '2020-04-20', '2022-10-27', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Giovana Muraro Andreazza', 'SK', 'A', 2026, 'matriculado', '2021-03-20', '2022-11-24', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Isabella de Oliveira Bonatto', 'SK', 'A', 2026, 'matriculado', '2020-10-05', '2022-10-11', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Júlia Rodrigues Sechin', 'SK', 'A', 2026, 'matriculado', '2020-05-24', '2022-10-26', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Milena Bampi Stringari Muller', 'SK', 'A', 2026, 'matriculado', '2020-07-10', '2022-10-20', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Vincenzo Tonella Heredia', 'SK', 'A', 2026, 'matriculado', '2020-11-22', '2023-08-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Júlia Stargherlin Rigo', 'SK', 'A', 2026, 'matriculado', '2020-11-12', '2023-07-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Rafael Piccoli Andreis', 'SK', 'A', 2026, 'matriculado', '2020-09-02', '2024-06-21', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antonio Arenhardt de Melo', 'SK', 'A', 2026, 'matriculado', '2020-11-14', '2024-09-03', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Lucas de Castro Favero', 'SK', 'A', 2026, 'matriculado', '2020-04-17', '2024-10-23', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Murilo Gelatti Cataluna', 'SK', 'A', 2026, 'matriculado', '2020-12-28', '2024-12-03', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Helena de Almeida Grandi', 'SK', 'A', 2026, 'matriculado', '2020-08-13', '2024-12-09', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Laura De Zorzi Lovat', 'SK', 'A', 2026, 'matriculado', '2020-07-18', '2024-02-07', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maria Helena Bossardi Raymondi', 'SK', 'A', 2026, 'matriculado', '2021-01-18', '2023-05-08', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maria Victoria Suzin', 'SK', 'A', 2026, 'matriculado', '2020-09-18', '2023-06-21', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Lara Hermione Lahm Freitas', 'SK', 'A', 2026, 'matriculado', '2020-04-29', '2023-11-13', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maya Armino Decimo', 'SK', 'B', 2026, 'matriculado', '2020-11-26', '2023-08-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Henry Manzato', 'SK', 'B', 2026, 'matriculado', '2020-07-07', '2023-10-03', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Vicente Nesello Ruziska', 'SK', 'B', 2026, 'matriculado', '2020-04-28', '2023-10-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Théo Zauza Ossani', 'SK', 'B', 2026, 'matriculado', '2020-09-04', '2024-03-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Joaquim Canalli de Queiroz', 'SK', 'B', 2026, 'matriculado', '2021-03-04', '2024-11-12', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Pedro Santini Paviani', 'SK', 'B', 2026, 'matriculado', '2020-05-10', '2025-07-03', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Nicolas Macagnan Riva', 'SK', 'B', 2026, 'matriculado', '2020-04-06', '2025-09-17', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Joaquim Daros Tondo Pereira', 'SK', 'B', 2026, 'matriculado', '2020-06-08', '2025-11-26', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Helena Monteiro Comerlatto', 'SK', 'B', 2026, 'matriculado', '2021-02-04', '2022-11-10', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Thomas Pretto Schoninger', 'SK', 'B', 2026, 'matriculado', '2021-01-18', '2024-10-30', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Aurora Maragno Perini', 'YEAR 1', 'A', 2026, 'matriculado', '2019-08-03', '2022-11-07', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Carolina Vieira da Fonseca Zortea', 'YEAR 1', 'A', 2026, 'matriculado', '2019-06-22', '2022-11-08', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Celina Boff', 'YEAR 1', 'A', 2026, 'matriculado', '2020-03-12', '2022-10-15', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Daniel Kirsch Deon', 'YEAR 1', 'A', 2026, 'matriculado', '2019-08-25', '2022-11-10', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Lara Colle Ragazzon', 'YEAR 1', 'A', 2026, 'matriculado', '2019-08-19', '2022-12-12', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Lourenço Giovanella Pergher', 'YEAR 1', 'A', 2026, 'matriculado', '2019-12-17', '2022-10-27', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Pietra Zamboni Concli', 'YEAR 1', 'A', 2026, 'matriculado', '2019-06-21', '2022-11-30', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Frederico Franzosi Benatti', 'YEAR 1', 'A', 2026, 'matriculado', '2019-12-02', '2023-06-07', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Jannie Granetto', 'YEAR 1', 'A', 2026, 'matriculado', '2019-07-03', '2023-07-14', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Valentin Furtado Rodrigues', 'YEAR 1', 'A', 2026, 'matriculado', '2019-05-17', '2023-10-02', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Pedro Mandelli Miglioranza', 'YEAR 1', 'A', 2026, 'matriculado', '2019-10-17', '2023-10-02', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Thomas Sonda Ferrarini', 'YEAR 1', 'A', 2026, 'matriculado', '2019-11-06', '2024-12-02', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Theo de Aguida Bourcheidt', 'YEAR 1', 'A', 2026, 'matriculado', '2020-09-02', '2023-10-18', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Catherine de Vargas Soares', 'YEAR 1', 'A', 2026, 'matriculado', '2019-10-08', '2024-02-27', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Fernando Fellini', 'YEAR 1', 'A', 2026, 'matriculado', '2020-09-30', '2024-07-05', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antonella Rodrigues dos Santos', 'YEAR 1', 'A', 2026, 'matriculado', '2019-06-29', '2026-01-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matheus Vedana Lunardi', 'YEAR 1', 'B', 2026, 'matriculado', '2019-09-06', '2024-06-24', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maria Isabella Novello Rech', 'YEAR 1', 'B', 2026, 'matriculado', '2020-01-20', '2025-03-28', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Lara de Araujo Rombaldi', 'YEAR 1', 'B', 2026, 'matriculado', '2019-08-13', '2025-05-05', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Vicenzo Muni Sandi Viecili', 'YEAR 1', 'B', 2026, 'matriculado', '2019-09-18', '2025-05-20', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Joaquim Canevese Piroli', 'YEAR 1', 'B', 2026, 'matriculado', '2019-11-01', '2025-05-15', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Isabella Elisa Tobar Lacerda', 'YEAR 1', 'B', 2026, 'matriculado', '2019-12-30', '2025-05-30', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antonella Perozzo Soares', 'YEAR 1', 'B', 2026, 'matriculado', '2019-05-13', '2025-07-21', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Caleb Henrique Medeiros Sá', 'YEAR 1', 'B', 2026, 'matriculado', '2019-06-22', '2024-07-24', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Ravi Nicolini Slaviero', 'YEAR 1', 'B', 2026, 'matriculado', '2020-02-28', '2025-12-01', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matteo Chitolina Carniel', 'YEAR 1', 'B', 2026, 'matriculado', '2019-10-28', NULL, eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Clara Formolo Girardi', 'YEAR 2', 'A', 2026, 'matriculado', '2018-10-31', '2022-11-16', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Eduardo Bertolazzi de Almeida', 'YEAR 2', 'A', 2026, 'matriculado', '2019-02-18', '2022-12-09', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Enrico Susin De Davi', 'YEAR 2', 'A', 2026, 'matriculado', '2019-02-14', '2023-02-01', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Henrique Chiarello Vargas', 'YEAR 2', 'A', 2026, 'matriculado', '2019-01-06', '2022-12-05', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Larissa da Costa Correa', 'YEAR 2', 'A', 2026, 'matriculado', '2018-10-05', '2022-11-09', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Luca Martins Vanni', 'YEAR 2', 'A', 2026, 'matriculado', '2019-01-03', '2022-12-22', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antonella Baggio Teles', 'YEAR 2', 'A', 2026, 'matriculado', '2018-04-21', '2023-06-15', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Pietro Olmi', 'YEAR 2', 'A', 2026, 'matriculado', '2019-04-10', '2022-10-28', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Sofia Bavaresco Pegorini', 'YEAR 2', 'A', 2026, 'matriculado', '2018-12-21', '2024-04-11', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Miguel Domingues de Lima', 'YEAR 2', 'A', 2026, 'matriculado', '2019-03-07', '2024-06-06', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matteo Cindrade Londero', 'YEAR 2', 'A', 2026, 'matriculado', '2019-03-15', '2024-08-12', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Hannah Stein Pontalti Velho', 'YEAR 2', 'A', 2026, 'matriculado', '2018-09-08', '2024-06-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maria Antônia Dutra Goulart', 'YEAR 2', 'A', 2026, 'matriculado', '2018-12-11', NULL, eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Gabriel Veber Campanharo', 'YEAR 2', 'A', 2026, 'matriculado', '2018-12-10', '2025-02-07', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Alice Cabanellos', 'YEAR 2', 'A', 2026, 'matriculado', '2111-11-11', '2025-11-17', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Mavie Luisa da Silva', 'YEAR 2', 'A', 2026, 'matriculado', '2018-06-28', '2024-01-15', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Marcos Luis Perini Chaves', 'YEAR 3', 'A', 2026, 'matriculado', '2017-06-23', '2023-01-31', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Sophia Duarte da Costa', 'YEAR 3', 'A', 2026, 'matriculado', '2018-01-12', '2022-11-11', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Sofia Mathias Netto de Prosdocimi', 'YEAR 3', 'A', 2026, 'matriculado', '2017-06-28', '2023-01-17', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Tomás Lima de Brito', 'YEAR 3', 'A', 2026, 'matriculado', '2017-11-08', '2022-10-27', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Lorenzo de Veiga Lima Barse', 'YEAR 3', 'A', 2026, 'matriculado', '2018-02-21', '2023-02-13', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Alice Fadanelli Bellenzier', 'YEAR 3', 'A', 2026, 'matriculado', '2018-03-02', '2023-05-17', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Guilherme Rambor', 'YEAR 3', 'A', 2026, 'matriculado', '2017-10-28', '2023-06-26', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Eduardo Rambor', 'YEAR 3', 'A', 2026, 'matriculado', '2017-10-28', '2023-06-26', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Stella Quadros Silvestre', 'YEAR 3', 'A', 2026, 'matriculado', '2017-09-24', '2023-07-18', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Alice Stangherlin Rigo', 'YEAR 3', 'A', 2026, 'matriculado', '2017-05-13', '2023-07-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Bianca Manzato', 'YEAR 3', 'A', 2026, 'matriculado', '2017-09-10', '2023-10-03', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Marta de Carli Corradi', 'YEAR 3', 'A', 2026, 'matriculado', '2018-03-15', '2023-12-01', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Laura de Oliveira Bogo', 'YEAR 3', 'A', 2026, 'matriculado', '2017-05-29', '2024-06-01', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Bernardo Gregoletto Mendes', 'YEAR 3', 'A', 2026, 'matriculado', '2017-11-21', '2024-08-28', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Alice Almeida Simon', 'YEAR 3', 'A', 2026, 'matriculado', '2018-02-15', '2026-02-13', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Augusto Krummenauer Pontel', 'BEAR CARE', 'A', 2027, 'matriculado', '2025-08-19', '2026-02-11', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Luísa Fiamenghi Dalla Vecchia', 'BEAR CARE', 'A', 2027, 'matriculado', '2026-03-26', '2026-03-03', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Leonardo Stedile Troes', 'BEAR CARE', 'A', 2027, 'matriculado', '2025-08-06', '2026-03-05', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maitê Castilhos Bosi', 'BEAR CARE', 'A', 2027, 'matriculado', '2025-12-06', '2026-03-11', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Augusto Cadore Guarise', 'BEAR CARE', 'A', 2027, 'matriculado', '2025-07-25', '2026-04-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Heloise Thomazoni Gil', 'BEAR CARE', 'A', 2027, 'matriculado', '2026-01-08', '2026-04-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Heloísa Bertuol Palaoro', 'BEAR CARE', 'A', 2027, 'matriculado', '2025-05-18', '2026-04-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antonella Thorell Franceschini', 'BEAR CARE', 'A', 2027, 'matriculado', '2025-02-27', '2026-04-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matteo Andreazza Conti', 'BEAR CARE', 'A', 2027, 'matriculado', '2026-01-24', '2026-04-07', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Martin Agnoletto Fernandes', 'BEAR CARE', 'A', 2027, 'matriculado', '2025-11-01', '2026-04-13', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Catarina Dantas Reis', 'BEAR CARE', 'A', 2027, 'matriculado', '2025-09-28', '2026-04-15', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Arthur Zanotto Casagrande Boff', 'TODDLER', 'A', 2027, 'matriculado', '2024-12-04', '2025-04-28', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'João Felipe de Almeida Reis', 'TODDLER', 'A', 2027, 'matriculado', '2024-06-24', '2025-06-12', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antonia Fanton Bongiolo', 'TODDLER', 'A', 2027, 'matriculado', '2024-05-17', '2025-07-10', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Malu Cardoso Moraes', 'TODDLER', 'A', 2027, 'matriculado', '2024-09-27', '2025-07-11', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Bernardo Fochesato Nadin', 'TODDLER', 'A', 2027, 'matriculado', '2025-01-14', '2025-09-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Rafael Brisotto Zart', 'TODDLER', 'A', 2027, 'matriculado', '2024-08-12', '2025-09-08', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Daniel Gotardo', 'TODDLER', 'A', 2027, 'matriculado', '2024-05-12', '2025-10-20', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Amália Rodrigues Alessi', 'TODDLER', 'A', 2027, 'matriculado', '2024-08-12', '2025-10-30', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matteo de Oliveira Rettore', 'TODDLER', 'A', 2027, 'matriculado', '2024-06-13', '2025-11-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Betina Giani Bidese', 'TODDLER', 'A', 2027, 'matriculado', '2024-05-17', '2025-11-11', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Martina Porciuncula', 'TODDLER', 'A', 2027, 'matriculado', '2025-05-02', '2026-01-28', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antonella Thorell Franceschini', 'TODDLER', 'A', 2027, 'matriculado', '2025-02-27', '2026-02-06', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Giovani Souza de Bastiani', 'TODDLER', 'A', 2027, 'matriculado', '2024-12-09', '2025-06-25', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Theo Vargas de Carvalho', 'TODDLER', 'A', 2027, 'matriculado', '2024-04-18', '2024-08-06', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Martina Bonalume', 'TODDLER', 'A', 2027, 'matriculado', '2025-02-13', '2025-12-03', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matteo Rech Carneiro', 'TODDLER', 'A', 2027, 'matriculado', '2024-07-06', '2026-02-23', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Carolina Muraro Andreazza', 'TODDLER', 'A', 2027, 'matriculado', '2024-08-17', '2026-02-20', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Giovana de Oliveira Bonatto', 'TODDLER', 'B', 2027, 'matriculado', '2024-11-22', '2026-03-03', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maria Alice Bossardi Raymondi', 'TODDLER', 'B', 2027, 'matriculado', '2024-12-11', '2026-03-05', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Pedro Collato Pedrotti', 'TODDLER', 'B', 2027, 'matriculado', '2023-04-23', '2026-03-05', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Luísa Gelatti Cataluna', 'TODDLER', 'B', 2027, 'matriculado', '2025-03-18', '2026-03-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Vicente Bertoldo Fichtner', 'TODDLER', 'B', 2027, 'matriculado', '2024-11-14', '2026-03-24', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Vicente dos Santos Borges', 'TODDLER', 'B', 2027, 'matriculado', '2024-07-17', '2026-04-06', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Franco Pelegrini Costa', 'TODDLER', 'B', 2027, 'matriculado', '2024-10-21', '2026-04-14', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antônio Abramo Maragno Perini', 'TODDLER', 'B', 2027, 'matriculado', '2024-04-26', '2026-04-14', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antônia Marin Dapper', 'TODDLER', 'B', 2027, 'matriculado', '2025-01-26', '2026-04-15', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Arthur Luiz Sebben Guitel', 'TODDLER', 'B', 2027, 'matriculado', '2025-03-30', '2026-04-17', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Felipe Luís Paviani Cella', 'TODDLER', 'B', 2027, 'matriculado', '2024-11-21', '2026-04-20', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Serena Rodrigues dos Santos', 'TODDLER', 'B', 2027, 'matriculado', '2024-09-09', '2026-05-02', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antônio Argenta', 'TODDLER', 'B', 2027, 'matriculado', '2024-10-31', '2026-05-02', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Conrado Bianchi Hemann', 'NURSERY', 'A', 2027, 'matriculado', '2023-07-24', '2024-04-05', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Guilherme Minuscoli Gregoletto', 'NURSERY', 'A', 2027, 'matriculado', '2023-04-03', '2024-06-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Carmel Camilo Pérsico', 'NURSERY', 'A', 2027, 'matriculado', '2023-04-18', '2024-07-11', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Augusto da Silva Gelain', 'NURSERY', 'A', 2027, 'matriculado', '2023-09-18', '2024-08-15', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Lilibeth Rezer Reis', 'NURSERY', 'A', 2027, 'matriculado', '2023-06-26', '2024-08-21', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Luca Dal Lago Armiliato', 'NURSERY', 'A', 2027, 'matriculado', '2023-08-01', '2024-10-28', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Eduardo Bortolotto da Silveira', 'NURSERY', 'A', 2027, 'matriculado', '2023-09-05', '2024-11-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Cecília Agnoletto Fernandes', 'NURSERY', 'A', 2027, 'matriculado', '2023-11-30', '2024-11-26', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Jade Consorte', 'NURSERY', 'A', 2027, 'matriculado', '2023-04-04', NULL, eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Mathias Mazzarollo', 'NURSERY', 'A', 2027, 'matriculado', '2023-11-13', '2025-02-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Augusto Klassmann Concer', 'NURSERY', 'A', 2027, 'matriculado', '2023-12-07', '2025-01-31', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Davi Boff Comandulli', 'NURSERY', 'A', 2027, 'matriculado', '2023-12-05', '2025-02-27', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Murilo Zinn Dotta', 'NURSERY', 'A', 2027, 'matriculado', '2023-11-28', '2025-04-01', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Liz Perizzollo Pacheco', 'NURSERY', 'A', 2027, 'matriculado', '2023-04-29', '2025-04-02', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Rafael Kich Guerra', 'NURSERY', 'A', 2027, 'matriculado', '2023-12-08', '2025-04-02', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Julia Azevedo Dornelles', 'NURSERY', 'A', 2027, 'matriculado', '2023-07-19', '2025-07-25', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Pedro Colla Susin', 'NURSERY', 'A', 2027, 'matriculado', '2023-09-27', '2025-11-18', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matteo de Oliveira Canuto', 'NURSERY', 'A', 2027, 'matriculado', '2023-11-01', '2025-04-03', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Murilo de Lima Abreu', 'NURSERY', 'B', 2027, 'matriculado', '2024-01-26', '2025-04-08', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matteo Luigi Porciuncula', 'NURSERY', 'B', 2027, 'matriculado', '2023-12-02', '2025-04-14', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Carlos de Vargas Soares', 'NURSERY', 'B', 2027, 'matriculado', '2024-01-02', '2025-04-15', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matteo Fagherazzi Lazzarin', 'NURSERY', 'B', 2027, 'matriculado', '2024-02-10', '2025-04-16', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Guilherme Momolli de Oliveira', 'NURSERY', 'B', 2027, 'matriculado', '2023-10-25', '2025-04-24', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Livia Fochesatto', 'NURSERY', 'B', 2027, 'matriculado', '2024-01-23', '2025-04-28', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matteo Piccinini Segalin', 'NURSERY', 'B', 2027, 'matriculado', '2023-12-23', '2025-04-29', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Isabella Costa Colonetti', 'NURSERY', 'B', 2027, 'matriculado', '2023-08-23', '2025-09-12', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Theodoro Biridi Heinen', 'NURSERY', 'B', 2027, 'matriculado', '2023-11-11', '2025-05-13', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matteo Olmi', 'NURSERY', 'B', 2027, 'matriculado', '2023-11-03', '2025-06-03', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Ravi Barboza Martins', 'NURSERY', 'B', 2027, 'matriculado', '2023-05-22', '2025-07-10', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Aurora Crestoni Kleber', 'NURSERY', 'B', 2027, 'matriculado', '2023-12-16', '2025-09-16', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Rafael dos Santos Pereira', 'NURSERY', 'B', 2027, 'matriculado', '2023-07-31', '2025-10-14', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Bianca NIcola de Prá', 'NURSERY', 'B', 2027, 'matriculado', '2023-10-15', '2025-10-29', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Guilherme Gottardo de David', 'NURSERY', 'B', 2027, 'matriculado', '2023-09-29', '2025-11-06', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Pedro Spagnolo', 'NURSERY', 'B', 2027, 'matriculado', '1900-01-10', '2025-11-07', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Sebastian Fetter Schneider', 'NURSERY', 'B', 2027, 'matriculado', '2024-02-04', '2025-07-25', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Sofia Pasin Colussi', 'NURSERY', 'B', 2027, 'matriculado', '2023-06-25', '2025-07-12', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Bianca Broliato Ciaas', 'NURSERY', 'C', 2027, 'matriculado', '2023-12-15', '2025-01-08', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Theo Masotti', 'NURSERY', 'C', 2027, 'matriculado', '2023-04-27', '2026-04-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Manuela Leite Bellé', 'NURSERY', 'C', 2027, 'matriculado', '2023-12-01', '2026-04-06', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Angelo Vendrame Melo', 'JK', 'A', 2027, 'matriculado', '2022-07-22', '2023-09-21', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antonella Bortoncello Fedrizzi', 'JK', 'A', 2027, 'matriculado', '2022-10-06', '2024-06-25', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Arthur de Souza Amaral', 'JK', 'A', 2027, 'matriculado', '2022-05-19', '2024-01-29', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Benício Werner Nesello', 'JK', 'A', 2027, 'matriculado', '2022-07-01', '2023-08-30', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Germano de Lima Abreu', 'JK', 'A', 2027, 'matriculado', '2022-07-01', '2024-07-15', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'João Fiamenghi Dalla Vecchia', 'JK', 'A', 2027, 'matriculado', '2023-03-02', '2024-07-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Laís Bof Gregoletto', 'JK', 'A', 2027, 'matriculado', '2022-06-19', '2024-04-16', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Luan Lemos Studt', 'JK', 'A', 2027, 'matriculado', '2022-11-11', '2024-07-24', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Martin Knopp da Silva Ramos', 'JK', 'A', 2027, 'matriculado', '2022-05-28', '2024-06-17', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matteo Barp Bertolassi', 'JK', 'A', 2027, 'matriculado', '2022-05-23', '2022-10-30', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matteo dos Santos Borges', 'JK', 'A', 2027, 'matriculado', '2022-09-15', '2024-06-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Olivia Cardoso Moraes', 'JK', 'A', 2027, 'matriculado', '2022-06-24', '2023-06-01', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Pedro Flores Vanni', 'JK', 'A', 2027, 'matriculado', '2022-10-29', '2023-10-05', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Pietro Furlan Bandeira', 'JK', 'A', 2027, 'matriculado', '2022-09-14', '2024-07-09', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Samuel Schimer', 'JK', 'A', 2027, 'matriculado', '2022-05-24', '2023-09-15', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Sofia Rech', 'JK', 'A', 2027, 'matriculado', '2022-06-30', '2023-12-20', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Vitoria Mota Winter', 'JK', 'A', 2027, 'matriculado', '2022-06-08', '2023-10-26', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Nicolas Calgaro Zucco', 'JK', 'A', 2027, 'matriculado', '2022-05-23', '2025-09-10', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Aurora Casagrande Valduga', 'JK', 'B', 2027, 'matriculado', '2022-08-16', '2024-10-22', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Aurora Martinelli Sgarbi', 'JK', 'B', 2027, 'matriculado', '2022-06-17', '2025-07-24', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Bento Tonezer Tedesco', 'JK', 'B', 2027, 'matriculado', '2023-03-17', '2024-09-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Bento Veronese Pan', 'JK', 'B', 2027, 'matriculado', '2023-02-16', '2025-06-09', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Bernardo Farias Triches', 'JK', 'B', 2027, 'matriculado', '2022-09-19', NULL, eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Davi de Araujo Rombaldi', 'JK', 'B', 2027, 'matriculado', '2022-11-16', '2025-05-05', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Eduardo de Moraes Celli', 'JK', 'B', 2027, 'matriculado', '2022-08-19', '2024-08-12', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Giovana Postali Rech', 'JK', 'B', 2027, 'matriculado', '2022-12-12', '2024-08-05', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Julia Vanin Pergher', 'JK', 'B', 2027, 'matriculado', '2022-04-26', '2025-04-22', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Leonardo da Rosa Silva', 'JK', 'B', 2027, 'matriculado', '2022-09-30', '2024-10-15', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Luiz Paulo de Almeida Reis', 'JK', 'B', 2027, 'matriculado', '2022-09-12', '2024-07-24', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Manuela Thorell Franceschini', 'JK', 'B', 2027, 'matriculado', '2022-11-19', '2024-12-11', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maria Clara Marin Dapper', 'JK', 'B', 2027, 'matriculado', '2022-11-26', '2024-11-08', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Martin Zolet Moscher', 'JK', 'B', 2027, 'matriculado', '2022-05-05', '2025-04-30', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Miguel Bonfant Flach', 'JK', 'B', 2027, 'matriculado', '2023-02-02', '2024-09-03', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Pedro Zampieron Bittencourt', 'JK', 'B', 2027, 'matriculado', '2022-11-14', '2025-05-21', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Pedro Alberto Zanotti Costantin', 'JK', 'B', 2027, 'matriculado', '2023-01-10', '2025-05-20', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maria Antonia del Gaudio Luz', 'JK', 'B', 2027, 'matriculado', '2022-10-27', '2025-08-20', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Rafael Marchett', 'JK', 'C', 2027, 'matriculado', '2022-10-14', '2025-08-11', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Arthur Kehl Picolli', 'JK', 'C', 2027, 'matriculado', '2023-02-02', '2025-09-02', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Leon Pelegrini Cosila', 'JK', 'C', 2027, 'matriculado', '2023-02-09', '2025-04-14', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Briana Marquetti de Oliveira', 'JK', 'C', 2027, 'matriculado', '2022-04-05', '2025-11-17', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Betina Daros Tondo Pereira', 'JK', 'C', 2027, 'matriculado', '2022-05-29', '2025-11-26', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Cecília Ferrari Nasser', 'JK', 'C', 2027, 'matriculado', '2023-02-05', '2026-01-27', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Manuela Stedile Troes', 'JK', 'C', 2027, 'matriculado', '2022-04-24', '2026-01-12', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antônio Dantas Reis', 'JK', 'C', 2027, 'matriculado', '2022-09-25', '2026-01-14', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Bernado Zottis Focchesato', 'JK', 'C', 2027, 'matriculado', '2022-09-19', '2026-01-16', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Cecília Rodrigues dos Santos', 'JK', 'C', 2027, 'matriculado', '2022-04-29', '2026-01-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maria Medeiros Donada', 'JK', 'C', 2027, 'matriculado', '2022-10-14', '2026-01-12', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antonio Zanrosso Paloschi', 'JK', 'C', 2027, 'matriculado', '2023-02-09', '2025-04-15', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Athena Legnaghi de Lucena', 'JK', 'C', 2027, 'matriculado', '2022-09-14', '2026-02-23', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'ANTONIETTA ELY PEREIRA', 'JK', 'C', 2027, 'matriculado', '2022-04-24', '2026-03-10', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Benício Reginatto', 'JK', 'C', 2027, 'matriculado', '2023-02-22', '2026-05-02', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Adele Lazarin', 'SK', 'A', 2027, 'matriculado', '2021-09-07', '2022-12-06', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antônio Dalzochio Seitenfus', 'SK', 'A', 2027, 'matriculado', '2021-07-27', '2023-01-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maria Luiza Chiarello Vargas', 'SK', 'A', 2027, 'matriculado', '2021-04-01', '2022-12-05', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Davi Lucas Fochesatto', 'SK', 'A', 2027, 'matriculado', '2021-05-18', '2023-03-24', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Olívia Chaves Bedin', 'SK', 'A', 2027, 'matriculado', '2021-09-24', '2022-11-29', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Theodoro Bertolazzi de Almeida', 'SK', 'A', 2027, 'matriculado', '2021-06-23', '2022-12-09', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Vicenzo Lusa Bergonsi', 'SK', 'A', 2027, 'matriculado', '2021-06-04', '2022-10-27', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antonella Barbosa Suzin', 'SK', 'A', 2027, 'matriculado', '2021-11-17', '2024-07-02', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Elisa Pedrotti Montes de Oca', 'SK', 'A', 2027, 'matriculado', '2021-04-26', '2024-01-03', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Valentin Pipe de David Variani', 'SK', 'A', 2027, 'matriculado', '2021-08-14', '2024-01-09', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maya Argenta', 'SK', 'A', 2027, 'matriculado', '2021-07-08', '2022-12-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Arthur Sebben Pretto', 'SK', 'A', 2027, 'matriculado', '2021-07-31', '2022-12-18', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Luiza Farias Randon', 'SK', 'A', 2027, 'matriculado', '2021-07-05', '2023-04-18', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Lara Mezzomo Schiavo', 'SK', 'A', 2027, 'matriculado', '2022-03-28', '2023-08-30', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Lucca Dickel de Lima', 'SK', 'A', 2027, 'matriculado', '2022-03-01', '2023-09-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Francisco Zanetti Ferrari', 'SK', 'A', 2027, 'matriculado', '2021-07-17', '2023-09-27', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antonio de Carli Corradi', 'SK', 'A', 2027, 'matriculado', '2021-10-21', '2023-12-01', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maitê Franco Zanrosso', 'SK', 'A', 2027, 'matriculado', '2021-11-25', '2024-07-01', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Giovana Souza Giacomet', 'SK', 'B', 2027, 'matriculado', '2021-12-10', '2024-07-30', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Romana Andretta Schauren', 'SK', 'B', 2027, 'matriculado', '2021-12-31', NULL, eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Vicente Giasson Lopes', 'SK', 'B', 2027, 'matriculado', '2022-02-08', '2024-10-11', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antonella Fedrizzi Brognoli', 'SK', 'B', 2027, 'matriculado', '2022-02-20', '2024-07-08', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Laura Bertoldo Fichtner', 'SK', 'B', 2027, 'matriculado', '2022-03-14', '2024-08-14', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Davi de Zorzi Carraro', 'SK', 'B', 2027, 'matriculado', '2021-08-13', '2025-01-27', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Martina Citton Scariot', 'SK', 'B', 2027, 'matriculado', '2021-08-19', '2025-01-29', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Alice Costa Munaro', 'SK', 'B', 2027, 'matriculado', '2021-07-23', '2025-09-29', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Luísa Laghetto Lessa', 'SK', 'B', 2027, 'matriculado', '2021-06-09', '2026-01-20', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Carolina Colussi Schmitt', 'SK', 'B', 2027, 'matriculado', '2030-12-30', '2026-02-11', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maya Alves de Mello', 'SK', 'B', 2027, 'matriculado', '2021-11-26', '2025-02-28', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Chloe Brylynskyi Ferreira Bortolini dos Anjos', 'SK', 'B', 2027, 'matriculado', '2021-09-21', '2026-03-18', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Cecília Bampi Stringari Muller', 'YEAR 1', 'A', 2027, 'matriculado', '2020-07-10', '2022-10-20', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Cecília Mezzomo Schiavo', 'YEAR 1', 'A', 2027, 'matriculado', '2020-07-20', '2022-10-24', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Dante Bessa Lima de Brito', 'YEAR 1', 'A', 2027, 'matriculado', '2020-04-20', '2022-10-27', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Giovana Muraro Andreazza', 'YEAR 1', 'A', 2027, 'matriculado', '2021-03-20', '2022-11-24', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Isabella de Oliveira Bonatto', 'YEAR 1', 'A', 2027, 'matriculado', '2020-10-05', '2022-10-11', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Júlia Rodrigues Sechin', 'YEAR 1', 'A', 2027, 'matriculado', '2020-05-24', '2022-10-26', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Milena Bampi Stringari Muller', 'YEAR 1', 'A', 2027, 'matriculado', '2020-07-10', '2022-10-20', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Vincenzo Tonella Heredia', 'YEAR 1', 'A', 2027, 'matriculado', '2020-11-22', '2023-08-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Júlia Stargherlin Rigo', 'YEAR 1', 'A', 2027, 'matriculado', '2020-11-12', '2023-07-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Rafael Piccoli Andreis', 'YEAR 1', 'A', 2027, 'matriculado', '2020-09-02', '2024-06-21', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antonio Arenhardt de Melo', 'YEAR 1', 'A', 2027, 'matriculado', '2020-11-14', '2024-09-03', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Lucas de Castro Favero', 'YEAR 1', 'A', 2027, 'matriculado', '2020-04-17', '2024-10-23', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Murilo Gelatti Cataluna', 'YEAR 1', 'A', 2027, 'matriculado', '2020-12-28', '2024-12-03', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Helena de Almeida Grandi', 'YEAR 1', 'A', 2027, 'matriculado', '2020-08-13', '2024-12-09', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Laura De Zorzi Lovat', 'YEAR 1', 'A', 2027, 'matriculado', '2020-07-18', '2024-02-07', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maria Helena Bossardi Raymondi', 'YEAR 1', 'A', 2027, 'matriculado', '2021-01-18', '2023-05-08', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maria Victoria Suzin', 'YEAR 1', 'A', 2027, 'matriculado', '2020-09-18', '2023-06-21', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Lara Hermione Lahm Freitas', 'YEAR 1', 'A', 2027, 'matriculado', '2020-04-29', '2023-11-13', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maya Armino Decimo', 'YEAR 1', 'A', 2027, 'matriculado', '2020-11-26', '2023-08-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Henry Manzato', 'YEAR 1', 'A', 2027, 'matriculado', '2020-07-07', '2023-10-03', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Vicente Nesello Ruziska', 'YEAR 1', 'A', 2027, 'matriculado', '2020-04-28', '2023-10-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Théo Zauza Ossani', 'YEAR 1', 'B', 2027, 'matriculado', '2020-09-04', '2024-03-04', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Joaquim Canalli de Queiroz', 'YEAR 1', 'B', 2027, 'matriculado', '2021-03-04', '2024-11-12', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Pedro Santini Paviani', 'YEAR 1', 'B', 2027, 'matriculado', '2020-05-10', '2025-07-03', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Nicolas Macagnan Riva', 'YEAR 1', 'B', 2027, 'matriculado', '2020-04-06', '2025-09-17', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Joaquim Daros Tondo Pereira', 'YEAR 1', 'B', 2027, 'matriculado', '2020-06-08', '2025-11-26', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Helena Monteiro Comerlatto', 'YEAR 1', 'B', 2027, 'matriculado', '2021-02-04', '2022-11-10', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Thomas Pretto Schoninger', 'YEAR 1', 'B', 2027, 'matriculado', '2021-01-18', '2024-10-30', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Felipe Ribeiro', 'YEAR 1', 'B', 2027, 'matriculado', '2021-01-27', '2024-07-09', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Lara Ramos Matinato', 'YEAR 1', 'B', 2027, 'matriculado', '2020-06-11', '2026-04-06', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Aurora Maragno Perini', 'YEAR 2', 'A', 2027, 'matriculado', '2019-08-03', '2022-11-07', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Carolina Vieira da Fonseca Zortea', 'YEAR 2', 'A', 2027, 'matriculado', '2019-06-22', '2022-11-08', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Celina Boff', 'YEAR 2', 'A', 2027, 'matriculado', '2020-03-12', '2022-10-15', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Daniel Kirsch Deon', 'YEAR 2', 'A', 2027, 'matriculado', '2019-08-25', '2022-11-10', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Lara Colle Ragazzon', 'YEAR 2', 'A', 2027, 'matriculado', '2019-08-19', '2022-12-12', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Lourenço Giovanella Pergher', 'YEAR 2', 'A', 2027, 'matriculado', '2019-12-17', '2022-10-27', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Pietra Zamboni Concli', 'YEAR 2', 'A', 2027, 'matriculado', '2019-06-21', '2022-11-30', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Frederico Franzosi Benatti', 'YEAR 2', 'A', 2027, 'matriculado', '2019-12-02', '2023-06-07', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Jannie Granetto', 'YEAR 2', 'A', 2027, 'matriculado', '2019-07-03', '2023-07-14', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Valentin Furtado Rodrigues', 'YEAR 2', 'A', 2027, 'matriculado', '2019-05-17', '2023-10-02', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Pedro Mandelli Miglioranza', 'YEAR 2', 'A', 2027, 'matriculado', '2019-10-17', '2023-10-02', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Thomas Sonda Ferrarini', 'YEAR 2', 'A', 2027, 'matriculado', '2019-11-06', '2024-12-02', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Theo de Aguida Bourcheidt', 'YEAR 2', 'A', 2027, 'matriculado', '2020-09-02', '2023-10-18', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Catherine de Vargas Soares', 'YEAR 2', 'A', 2027, 'matriculado', '2019-10-08', '2024-02-27', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Fernando Fellini', 'YEAR 2', 'A', 2027, 'matriculado', '2020-09-30', '2024-07-05', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antonella Rodrigues dos Santos', 'YEAR 2', 'A', 2027, 'matriculado', '2019-06-29', '2026-01-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matheus Vedana Lunardi', 'YEAR 2', 'B', 2027, 'matriculado', '2019-09-06', '2024-06-24', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maria Isabella Novello Rech', 'YEAR 2', 'B', 2027, 'matriculado', '2020-01-20', '2025-03-28', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Lara de Araujo Rombaldi', 'YEAR 2', 'B', 2027, 'matriculado', '2019-08-13', '2025-05-05', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Vicenzo Muni Sandi Viecili', 'YEAR 2', 'B', 2027, 'matriculado', '2019-09-18', '2025-05-20', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Joaquim Canevese Piroli', 'YEAR 2', 'B', 2027, 'matriculado', '2019-11-01', '2025-05-15', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Isabella Elisa Tobar Lacerda', 'YEAR 2', 'B', 2027, 'matriculado', '2019-12-30', '2025-05-30', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antonella Perozzo Soares', 'YEAR 2', 'B', 2027, 'matriculado', '2019-05-13', '2025-07-21', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Caleb Henrique Medeiros Sá', 'YEAR 2', 'B', 2027, 'matriculado', '2019-06-22', '2024-07-24', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Ravi Nicolini Slaviero', 'YEAR 2', 'B', 2027, 'matriculado', '2020-02-28', '2025-12-01', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matteo Chitolina Carniel', 'YEAR 2', 'B', 2027, 'matriculado', '2019-10-28', NULL, eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Clara Formolo Girardi', 'YEAR 3', 'A', 2027, 'matriculado', '2018-10-31', '2022-11-16', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Eduardo Bertolazzi de Almeida', 'YEAR 3', 'A', 2027, 'matriculado', '2019-02-18', '2022-12-09', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Enrico Susin De Davi', 'YEAR 3', 'A', 2027, 'matriculado', '2019-02-14', '2023-02-01', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Henrique Chiarello Vargas', 'YEAR 3', 'A', 2027, 'matriculado', '2019-01-06', '2022-12-05', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Larissa da Costa Correa', 'YEAR 3', 'A', 2027, 'matriculado', '2018-10-05', '2022-11-09', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Luca Martins Vanni', 'YEAR 3', 'A', 2027, 'matriculado', '2019-01-03', '2022-12-22', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Antonella Baggio Teles', 'YEAR 3', 'A', 2027, 'matriculado', '2018-04-21', '2023-06-15', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Pietro Olmi', 'YEAR 3', 'A', 2027, 'matriculado', '2019-04-10', '2022-10-28', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Sofia Bavaresco Pegorini', 'YEAR 3', 'A', 2027, 'matriculado', '2018-12-21', '2024-04-11', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Miguel Domingues de Lima', 'YEAR 3', 'A', 2027, 'matriculado', '2019-03-07', '2024-06-06', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Matteo Cindrade Londero', 'YEAR 3', 'A', 2027, 'matriculado', '2019-03-15', '2024-08-12', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Hannah Stein Pontalti Velho', 'YEAR 3', 'A', 2027, 'matriculado', '2018-09-08', '2024-06-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Maria Antônia Dutra Goulart', 'YEAR 3', 'A', 2027, 'matriculado', '2018-12-11', NULL, eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Gabriel Veber Campanharo', 'YEAR 3', 'A', 2027, 'matriculado', '2018-12-10', '2025-02-07', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Alice Cabanellos', 'YEAR 3', 'A', 2027, 'matriculado', '2111-11-11', '2025-11-17', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Mavie Luisa da Silva', 'YEAR 3', 'A', 2027, 'matriculado', '2018-06-28', '2024-01-15', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Marcos Luis Perini Chaves', 'YEAR 4', 'A', 2027, 'matriculado', '2017-06-23', '2023-01-31', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Sophia Duarte da Costa', 'YEAR 4', 'A', 2027, 'matriculado', '2018-01-12', '2022-11-11', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Sofia Mathias Netto de Prosdocimi', 'YEAR 4', 'A', 2027, 'matriculado', '2017-06-28', '2023-01-17', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Tomás Lima de Brito', 'YEAR 4', 'A', 2027, 'matriculado', '2017-11-08', '2022-10-27', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Lorenzo de Veiga Lima Barse', 'YEAR 4', 'A', 2027, 'matriculado', '2018-02-21', '2023-02-13', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Alice Fadanelli Bellenzier', 'YEAR 4', 'A', 2027, 'matriculado', '2018-03-02', '2023-05-17', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Guilherme Rambor', 'YEAR 4', 'A', 2027, 'matriculado', '2017-10-28', '2023-06-26', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Eduardo Rambor', 'YEAR 4', 'A', 2027, 'matriculado', '2017-10-28', '2023-06-26', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Stella Quadros Silvestre', 'YEAR 4', 'A', 2027, 'matriculado', '2017-09-24', '2023-07-18', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Alice Stangherlin Rigo', 'YEAR 4', 'A', 2027, 'matriculado', '2017-05-13', '2023-07-19', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Bianca Manzato', 'YEAR 4', 'A', 2027, 'matriculado', '2017-09-10', '2023-10-03', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Marta de Carli Corradi', 'YEAR 4', 'A', 2027, 'matriculado', '2018-03-15', '2023-12-01', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Laura de Oliveira Bogo', 'YEAR 4', 'A', 2027, 'matriculado', '2017-05-29', '2024-06-01', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Bernardo Gregoletto Mendes', 'YEAR 4', 'A', 2027, 'matriculado', '2017-11-21', '2024-08-28', eid);
  INSERT INTO crm_matriculas (nome_responsavel, nome_crianca, serie, turma, ano, status, data_nascimento, data_matricula, escola_id)
    VALUES ('—', 'Alice Almeida Simon', 'YEAR 4', 'A', 2027, 'matriculado', '2018-02-15', '2026-02-13', eid);

END $$;