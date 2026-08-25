<?php
/**
 * cleanup.php
 * ------------------------------------------------------------
 * Não é um endpoint chamado pelo cliente. Como o InfinityFree Free
 * não permite cron jobs / processos persistentes, a "limpeza" de
 * jogadores inativos é feita sob demanda: toda vez que join.php ou
 * players.php rodam, eles chamam cleanup_stale_players() primeiro.
 * ------------------------------------------------------------
 */

/**
 * Remove do banco jogadores cuja última atualização é mais antiga
 * que OFFLINE_TIMEOUT_SECONDS. Barato (um DELETE indexado) e seguro
 * de rodar em toda requisição.
 */
function cleanup_stale_players(PDO $pdo): void {
  $stmt = $pdo->prepare(
    'DELETE FROM online_players WHERE last_update < (NOW() - INTERVAL :timeout SECOND)'
  );
  $stmt->execute(['timeout' => OFFLINE_TIMEOUT_SECONDS]);
}
