<?php
/**
 * sync.php  (POST)  — Fase 2.1 + Fase 3 (zumbis/combate)
 * ------------------------------------------------------------
 * Endpoint único de sincronização: atualiza a posição/mira do
 * jogador LOCAL, avança a simulação "lazy" dos zumbis (item 3 da
 * Fase 3 — não há game loop contínuo no InfinityFree), e devolve na
 * MESMA resposta o snapshot de jogadores + zumbis. Continua sendo a
 * ÚNICA requisição do loop principal (item 15/16 da Fase 3: não criar
 * um endpoint de zumbis separado no polling).
 *
 * Body esperado (JSON):
 * { "token": "...", "x":.., "y":.., "direction":.., "moving":.., "vx":.., "vy":..,
 *   "aimDirX":.., "aimDirY":.. }
 *
 * Resposta:
 * {
 *   "success": true,
 *   "serverTime": ..,
 *   "player": { "x","y","direction","health","alive","kills" },
 *   "players": [ {...} ],
 *   "zombies": [ { "id","x","y","health","maxHealth","state","directionX","directionY" } ],
 *   "count": N
 * }
 * ------------------------------------------------------------
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cleanup.php';
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

$rawX = $input['x'] ?? null;
$rawY = $input['y'] ?? null;
$direction = $input['direction'] ?? null;
$moving = !empty($input['moving']) ? 1 : 0;
$rawVx = $input['vx'] ?? 0;
$rawVy = $input['vy'] ?? 0;
$rawAimX = $input['aimDirX'] ?? null;
$rawAimY = $input['aimDirY'] ?? null;

if (!is_finite_number($rawX) || !is_finite_number($rawY)) {
  json_error('invalid_position', 422);
}

$validDirections = ['up', 'down', 'left', 'right'];
if (!is_string($direction) || !in_array($direction, $validDirections, true)) {
  $direction = null; // mantém a direção anterior armazenada
}

$vx = is_finite_number($rawVx) ? clamp_number((float)$rawVx, -PLAYER_SPEED * 1.5, PLAYER_SPEED * 1.5) : 0;
$vy = is_finite_number($rawVy) ? clamp_number((float)$rawVy, -PLAYER_SPEED * 1.5, PLAYER_SPEED * 1.5) : 0;

// Direção de mira (Fase 3, item 22): normalizamos no servidor — nunca
// confiamos em magnitude arbitrária vinda do cliente.
$aimDirX = 0.0; $aimDirY = 1.0;
if (is_finite_number($rawAimX) && is_finite_number($rawAimY)) {
  $len = hypot((float)$rawAimX, (float)$rawAimY);
  if ($len > 0.0001) {
    $aimDirX = (float)$rawAimX / $len;
    $aimDirY = (float)$rawAimY / $len;
  }
}

$x = clamp_number((float)$rawX, 0, WORLD_WIDTH);
$y = clamp_number((float)$rawY, 0, WORLD_HEIGHT);

$pdo = get_db();

$stmt = $pdo->prepare(
  'SELECT id, x, y, direction, alive, UNIX_TIMESTAMP(last_update) AS last_ts
   FROM online_players WHERE session_token = :token LIMIT 1'
);
$stmt->execute(['token' => $token]);
$current = $stmt->fetch();

if (!$current) {
  json_error('invalid_player', 404);
}

$selfId = (int)$current['id'];
$prevX = (float)$current['x'];
$prevY = (float)$current['y'];
$isAlive = (bool)$current['alive'];

if (!$isAlive) {
  // Jogador morto (aguardando respawn.php): mantém a última posição
  // válida, ignora qualquer x/y enviado pelo cliente (item 34).
  $x = $prevX;
  $y = $prevY;
  $vx = 0; $vy = 0; $moving = 0;
} else {
  // --- Validação anti-teleporte (igual a update.php) ---------------
  $now = microtime(true);
  $dt = $now - (float)$current['last_ts'];
  $dt = clamp_number($dt, 0.05, 5.0);

  $maxDistance = (PLAYER_SPEED * $dt * SPEED_TOLERANCE_FACTOR) + SPEED_TOLERANCE_PIXELS;
  $requestedDistance = hypot($x - $prevX, $y - $prevY);

  if ($requestedDistance > $maxDistance && $requestedDistance > 0) {
    $ratio = $maxDistance / $requestedDistance;
    $x = $prevX + ($x - $prevX) * $ratio;
    $y = $prevY + ($y - $prevY) * $ratio;
  }
}

$finalDirection = $direction ?? $current['direction'];

$update = $pdo->prepare(
  'UPDATE online_players
   SET x = :x, y = :y, vx = :vx, vy = :vy, moving = :moving,
       direction = :direction, aim_dir_x = :aimx, aim_dir_y = :aimy, last_update = NOW(3)
   WHERE session_token = :token'
);
$update->execute([
  'x'         => $x,
  'y'         => $y,
  'vx'        => $vx,
  'vy'        => $vy,
  'moving'    => $moving,
  'direction' => $finalDirection,
  'aimx'      => $aimDirX,
  'aimy'      => $aimDirY,
  'token'     => $token,
]);

// --- Fase 3: avança a simulação dos zumbis nesta mesma requisição ---
cleanup_stale_players($pdo);

$alivePlayersStmt = $pdo->query(
  'SELECT id, x, y FROM online_players WHERE alive = 1'
);
$alivePlayersForAI = $alivePlayersStmt->fetchAll();

$obstacles = get_world_obstacles();
$zombiesSnapshot = simulate_zombies($pdo, $obstacles, $alivePlayersForAI);

// --- Busca jogadores ativos (após a simulação, para health/alive
//     ficarem corretos caso algum zumbi tenha acabado de atacar) ----
$playersStmt = $pdo->query(
  'SELECT id, session_token, name, x, y, vx, vy, moving, direction,
          aim_dir_x, aim_dir_y, health, alive, kills
   FROM online_players
   ORDER BY id ASC'
);
$rows = $playersStmt->fetchAll();

$players = [];
$selfRow = null;
foreach ($rows as $row) {
  if ($row['session_token'] === $token) {
    $selfRow = $row;
    continue; // nunca retorna a si mesmo na lista de "outros"
  }
  $players[] = [
    'id'        => (int)$row['id'],
    'name'      => $row['name'],
    'x'         => (float)$row['x'],
    'y'         => (float)$row['y'],
    'vx'        => (float)$row['vx'],
    'vy'        => (float)$row['vy'],
    'moving'    => (bool)$row['moving'],
    'direction' => $row['direction'],
    'aimDirX'   => (float)$row['aim_dir_x'],
    'aimDirY'   => (float)$row['aim_dir_y'],
    'health'    => (int)$row['health'],
    'alive'     => (bool)$row['alive'],
    // NUNCA retornar session_token de outros jogadores.
  ];
}

json_success([
  'serverTime' => round(microtime(true) * 1000),
  'player' => [
    'x' => $selfRow ? (float)$selfRow['x'] : $x,
    'y' => $selfRow ? (float)$selfRow['y'] : $y,
    'direction' => $selfRow ? $selfRow['direction'] : $finalDirection,
    'health' => $selfRow ? (int)$selfRow['health'] : 100,
    'alive' => $selfRow ? (bool)$selfRow['alive'] : true,
    'kills' => $selfRow ? (int)$selfRow['kills'] : 0,
  ],
  'players' => $players,
  'zombies' => $zombiesSnapshot,
  'count'   => count($players) + 1, // +1 = o próprio jogador
]);
