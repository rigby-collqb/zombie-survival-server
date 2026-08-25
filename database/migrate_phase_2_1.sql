-- ============================================================
-- Zombie Survival Online — Fase 2.1 (otimização do multiplayer)
-- Migração INCREMENTAL: NÃO apaga a tabela existente, apenas
-- adiciona as colunas necessárias para dead reckoning/predição.
--
-- Como importar:
--   1. Abra o phpMyAdmin do seu site no painel do InfinityFree.
--   2. Selecione o banco de dados já usado pelo jogo.
--   3. Aba "SQL" -> cole o conteúdo deste arquivo -> "Executar".
--      (ou aba "Importar" -> escolha este arquivo -> "Executar")
-- ============================================================

ALTER TABLE online_players
  ADD COLUMN IF NOT EXISTS vx FLOAT NOT NULL DEFAULT 0 AFTER y,
  ADD COLUMN IF NOT EXISTS vy FLOAT NOT NULL DEFAULT 0 AFTER vx,
  ADD COLUMN IF NOT EXISTS moving TINYINT(1) NOT NULL DEFAULT 0 AFTER vy;
