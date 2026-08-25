-- ============================================================
-- Zombie Survival Online — Fase 2 (multiplayer via PHP + MySQL)
-- Schema do MySQL compatível com InfinityFree Free Hosting.
--
-- Como importar:
--   1. Abra o phpMyAdmin do seu site no painel do InfinityFree.
--   2. Selecione o banco de dados criado para o jogo.
--   3. Aba "Importar" -> escolha este arquivo -> "Executar".
-- ============================================================

CREATE TABLE IF NOT EXISTS online_players (
  id            INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  session_token CHAR(64)        NOT NULL,
  name          VARCHAR(16)     NOT NULL,
  x             FLOAT           NOT NULL DEFAULT 0,
  y             FLOAT           NOT NULL DEFAULT 0,
  vx            FLOAT           NOT NULL DEFAULT 0,
  vy            FLOAT           NOT NULL DEFAULT 0,
  moving        TINYINT(1)      NOT NULL DEFAULT 0,
  direction     VARCHAR(10)     NOT NULL DEFAULT 'down',
  health        SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  last_update   DATETIME(3)     NOT NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_session_token (session_token),
  KEY idx_last_update (last_update)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Observações:
--   * Nenhuma senha ou dado de conta é armazenado aqui — ainda não
--     existe sistema de contas nesta fase, apenas sessões temporárias.
--   * idx_last_update acelera tanto o SELECT usado por players.php
--     (jogadores ativos) quanto o DELETE de limpeza (cleanup.php).
--   * uq_session_token garante um único registro por sessão e torna
--     o lookup em update.php/leave.php um acesso indexado direto.
