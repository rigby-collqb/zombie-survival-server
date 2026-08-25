-- ============================================================
-- Zombie Survival Online — Fase 3 (zumbis + IA + combate)
-- Migração INCREMENTAL: NÃO apaga nenhuma tabela existente.
--
-- Como importar:
--   1. Abra o phpMyAdmin do seu site no painel do InfinityFree.
--   2. Selecione o banco de dados já usado pelo jogo.
--   3. Aba "SQL" -> cole o conteúdo deste arquivo -> "Executar".
-- ============================================================

-- Novas colunas em online_players: vida/morte controladas pelo
-- servidor, cooldown de tiro e contador de abates da sessão atual.
ALTER TABLE online_players
  ADD COLUMN IF NOT EXISTS alive TINYINT(1) NOT NULL DEFAULT 1 AFTER health,
  ADD COLUMN IF NOT EXISTS kills INT UNSIGNED NOT NULL DEFAULT 0 AFTER alive,
  ADD COLUMN IF NOT EXISTS last_shot DATETIME(3) NULL AFTER kills,
  ADD COLUMN IF NOT EXISTS aim_dir_x FLOAT NOT NULL DEFAULT 0 AFTER direction,
  ADD COLUMN IF NOT EXISTS aim_dir_y FLOAT NOT NULL DEFAULT 1 AFTER aim_dir_x;

-- Tabela de zumbis compartilhados entre todos os jogadores.
CREATE TABLE IF NOT EXISTS zombies (
  id              INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  x               FLOAT            NOT NULL,
  y               FLOAT            NOT NULL,
  health          SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  max_health      SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  speed           FLOAT            NOT NULL DEFAULT 70,
  state           VARCHAR(10)      NOT NULL DEFAULT 'idle', -- idle|wander|chase|attack|dead
  target_player_id INT UNSIGNED    NULL,
  direction_x     FLOAT            NOT NULL DEFAULT 0,
  direction_y     FLOAT            NOT NULL DEFAULT 1,
  wander_target_x FLOAT            NULL,
  wander_target_y FLOAT            NULL,
  state_timer     FLOAT            NOT NULL DEFAULT 0, -- segundos restantes no estado atual (IDLE) ou desde a morte (DEAD)
  last_attack_at  DATETIME(3)      NULL,
  spawn_x         FLOAT            NOT NULL,
  spawn_y         FLOAT            NOT NULL,
  last_update     DATETIME(3)      NOT NULL,
  created_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  KEY idx_state (state),
  KEY idx_last_update (last_update)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Observações:
--   * Nenhum DROP TABLE é usado — dados existentes de online_players
--     são preservados integralmente.
--   * "state" fica como VARCHAR simples (em vez de ENUM) para não
--     exigir outra migração caso um novo estado seja adicionado depois.
--   * target_player_id não tem FOREIGN KEY de propósito (jogadores são
--     removidos/recriados o tempo todo pelo cleanup por inatividade;
--     uma FK obrigaria lidar com isso em cascata sem necessidade real
--     aqui — o código PHP sempre valida se o alvo ainda existe).
