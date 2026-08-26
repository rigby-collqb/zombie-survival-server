<?php
/**
 * respawn.php  (POST)
 * ------------------------------------------------------------
 * Chamado quando o jogador clica em RESPAWN na tela de "VOCÊ MORREU"
 * (item 34/35). O servidor decide a nova posição e restaura a vida —
 * o cliente só reflete o que vier daqui.
 *
 * Body esperado (JSON): { "token": "..." }
 * Resposta: { "success": true, "player": { "x","y","health","alive" } }
 * ------------------------------------------------------------
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/world_map.php';
require_once __DIR__ . '/zombie_engine.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  json_error('method_not_allowed', 405);
}

$input = read_json_body();
$token = extract_token($input);
if ($token === null) {
  json_error('invalid_token', 401);
}

$pdo = get_db();

$stmt = $pdo->prepare('SELECT id, alive FROM online_players WHERE session_token = :token LIMIT 1');
$stmt->execute(['token' => $token]);
$player = $stmt->fetch();

if (!$player) {
  json_error('invalid_player', 404);
}

// Já vivo (ex.: clique duplo no botão) — apenas devolve o estado atual,
// idempotente, sem escolher um novo spawn à toa.
if ((bool)$player['alive']) {
  $current = $pdo->prepare('SELECT x, y, health FROM online_players WHERE id = :pid');
  $current->execute(['pid' => $player['id']]);
  $row = $current->fetch();
  json_success(['player' => [
    'x' => (float)$row['x'], 'y' => (float)$row['y'], 'health' => (int)$row['health'], 'alive' => true,
  ]]);
}

$obstacles = get_world_obstacles();
$alivePlayersStmt = $pdo->query('SELECT id, x, y FROM online_players WHERE alive = 1');
$alivePlayers = $alivePlayersStmt->fetchAll();

// Reaproveita a mesma lógica de escolha de ponto válido dos zumbis
// (fora de obstáculos, dentro do mapa) — para o jogador usamos uma
// distância mínima menor entre jogadores (não precisa ser tão longe
// quanto o spawn de zumbi).
$spawn = null;
for ($attempt = 0; $attempt < 25; $attempt++) {
  $angle = mt_rand() / mt_getrandmax() * 2 * M_PI;
  $radius = mt_rand() / mt_getrandmax() * SPAWN_RADIUS;
  $x = clamp_number(SPAWN_CENTER_X + cos($angle) * $radius, 40, WORLD_WIDTH - 40);
  $y = clamp_number(SPAWN_CENTER_Y + sin($angle) * $radius, 40, WORLD_HEIGHT - 40);

  if (circle_hits_any_obstacle($x, $y, PLAYER_COLLISION_RADIUS + 10, $obstacles)) continue;
  $spawn = ['x' => $x, 'y' => $y];
  break;
}

if ($spawn === null) {
  // Fallback: centro do mapa (área de spawn original da Fase 2),
  // mesmo que não tenhamos confirmado ausência total de obstáculos.
  $spawn = ['x' => SPAWN_CENTER_X, 'y' => SPAWN_CENTER_Y];
}

$update = $pdo->prepare(
  'UPDATE online_players
   SET x = :x, y = :y, health = 100, alive = 1, last_update = NOW(3)
   WHERE id = :pid'
);
$update->execute(['x' => $spawn['x'], 'y' => $spawn['y'], 'pid' => $player['id']]);

json_success(['player' => [
  'x' => $spawn['x'], 'y' => $spawn['y'], 'health' => 100, 'alive' => true,
]]);
