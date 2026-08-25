<?php
/**
 * players.php  (GET)
 * ------------------------------------------------------------
 * Retorna a lista de jogadores atualmente ativos (last_update dentro
 * da janela de OFFLINE_TIMEOUT_SECONDS). Faz a limpeza de jogadores
 * antigos antes de consultar, já que não há processo em background
 * disponível no InfinityFree Free.
 *
 * Retorna apenas o necessário para renderização — nunca o token ou
 * qualquer outro dado sensível.
 *
 * Resposta:
 * {
 *   "success": true,
 *   "players": [ { "id":1,"name":"...","x":0,"y":0,"direction":"down","health":100 } ],
 *   "count": 1
 * }
 * ------------------------------------------------------------
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cleanup.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET' && $_SERVER['REQUEST_METHOD'] !== 'POST') {
  json_error('method_not_allowed', 405);
}

$pdo = get_db();
cleanup_stale_players($pdo);

// SELECT enxuto — só os campos necessários para desenhar os jogadores.
$stmt = $pdo->query(
  'SELECT id, name, x, y, direction, health, UNIX_TIMESTAMP(last_update) AS last_update
   FROM online_players
   ORDER BY id ASC'
);
$rows = $stmt->fetchAll();

$players = array_map(function ($row) {
  return [
    'id'          => (int)$row['id'],
    'name'        => $row['name'],
    'x'           => (float)$row['x'],
    'y'           => (float)$row['y'],
    'direction'   => $row['direction'],
    'health'      => (int)$row['health'],
    'last_update' => (float)$row['last_update'],
  ];
}, $rows);

json_success([
  'players' => $players,
  'count'   => count($players),
]);
