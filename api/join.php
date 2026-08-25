<?php
/**
 * join.php  (POST)
 * ------------------------------------------------------------
 * Entrada de um novo jogador na partida compartilhada.
 *
 * Body esperado (JSON): { "name": "Sobrevivente" }
 *
 * Resposta de sucesso:
 * {
 *   "success": true,
 *   "player": { "id": 1, "token": "...", "name": "...", "x": 0, "y": 0,
 *               "health": 100 },
 *   "world": { "width": 4000, "height": 4000 }
 * }
 * ------------------------------------------------------------
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cleanup.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  json_error('method_not_allowed', 405);
}

$input = read_json_body();
$name = sanitize_player_name($input['name'] ?? null);

if ($name === null) {
  json_error('invalid_name', 422);
}

$pdo = get_db();
cleanup_stale_players($pdo);

// Verifica limite de jogadores simultâneos.
$countStmt = $pdo->query('SELECT COUNT(*) AS total FROM online_players');
$total = (int)$countStmt->fetch()['total'];

if ($total >= MAX_PLAYERS) {
  json_error('server_full', 503);
}

// Token de sessão seguro — o cliente nunca escolhe o próprio ID.
$token = bin2hex(random_bytes(32));

// Posição de spawn: um ponto aleatório dentro de um pequeno raio ao
// redor do centro do mapa, para não empilhar todo mundo no mesmo pixel.
$angle = mt_rand() / mt_getrandmax() * 2 * M_PI;
$radius = mt_rand() / mt_getrandmax() * SPAWN_RADIUS;
$spawnX = clamp_number(SPAWN_CENTER_X + cos($angle) * $radius, 0, WORLD_WIDTH);
$spawnY = clamp_number(SPAWN_CENTER_Y + sin($angle) * $radius, 0, WORLD_HEIGHT);

$stmt = $pdo->prepare(
  'INSERT INTO online_players (session_token, name, x, y, direction, health, last_update)
   VALUES (:token, :name, :x, :y, :direction, :health, NOW(3))'
);
$stmt->execute([
  'token'     => $token,
  'name'      => $name,
  'x'         => $spawnX,
  'y'         => $spawnY,
  'direction' => 'down',
  'health'    => 100,
]);

$playerId = (int)$pdo->lastInsertId();

json_success([
  'player' => [
    'id'     => $playerId,
    'token'  => $token,
    'name'   => $name,
    'x'      => $spawnX,
    'y'      => $spawnY,
    'direction' => 'down',
    'health' => 100,
    'alive'  => true,
    'kills'  => 0,
  ],
  'world' => [
    'width'  => WORLD_WIDTH,
    'height' => WORLD_HEIGHT,
  ],
]);
