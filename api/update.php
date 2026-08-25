<?php
/**
 * update.php  (POST)
 * ------------------------------------------------------------
 * Recebe a posição/direção mais recente do jogador LOCAL e persiste
 * no banco, após validar tudo no servidor (nunca confiar no cliente).
 *
 * Body esperado (JSON):
 * { "token": "...", "x": 1234.5, "y": 987.6, "direction": "down" }
 *
 * Validações:
 *  - token precisa existir;
 *  - x/y precisam ser números finitos (rejeita NaN/Infinity);
 *  - x/y são restringidos aos limites do mapa;
 *  - direção precisa ser um dos 4 valores válidos;
 *  - anti-teleporte: a distância percorrida desde a última atualização
 *    não pode exceder o que a velocidade do jogador permitiria (com
 *    uma tolerância para lag/latência) — se exceder, a posição é
 *    LIMITADA (não rejeitada, e ninguém é banido nesta fase).
 * ------------------------------------------------------------
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/helpers.php';

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

if (!is_finite_number($rawX) || !is_finite_number($rawY)) {
  json_error('invalid_position', 422);
}

$validDirections = ['up', 'down', 'left', 'right'];
if (!is_string($direction) || !in_array($direction, $validDirections, true)) {
  $direction = null; // mantém a direção anterior armazenada
}

$x = clamp_number((float)$rawX, 0, WORLD_WIDTH);
$y = clamp_number((float)$rawY, 0, WORLD_HEIGHT);

$pdo = get_db();

$stmt = $pdo->prepare(
  'SELECT x, y, direction, UNIX_TIMESTAMP(last_update) AS last_ts
   FROM online_players WHERE session_token = :token LIMIT 1'
);
$stmt->execute(['token' => $token]);
$current = $stmt->fetch();

if (!$current) {
  // Token não existe mais (jogador foi limpo por inatividade, por
  // exemplo). O cliente deve tratar isso refazendo join().
  json_error('invalid_player', 404);
}

$prevX = (float)$current['x'];
$prevY = (float)$current['y'];

// --- Validação anti-teleporte -----------------------------------
$now = microtime(true);
$dt = $now - (float)$current['last_ts'];
// Protege contra dt absurdo (relógio, primeira atualização, etc.)
$dt = clamp_number($dt, 0.05, 5.0);

$maxDistance = (PLAYER_SPEED * $dt * SPEED_TOLERANCE_FACTOR) + SPEED_TOLERANCE_PIXELS;
$requestedDistance = hypot($x - $prevX, $y - $prevY);

if ($requestedDistance > $maxDistance && $requestedDistance > 0) {
  // Limita o deslocamento na mesma direção, em vez de rejeitar.
  $ratio = $maxDistance / $requestedDistance;
  $x = $prevX + ($x - $prevX) * $ratio;
  $y = $prevY + ($y - $prevY) * $ratio;
}

$finalDirection = $direction ?? $current['direction'];

$update = $pdo->prepare(
  'UPDATE online_players
   SET x = :x, y = :y, direction = :direction, last_update = NOW(3)
   WHERE session_token = :token'
);
$update->execute([
  'x'         => $x,
  'y'         => $y,
  'direction' => $finalDirection,
  'token'     => $token,
]);

json_success([
  'player' => [
    'x' => $x,
    'y' => $y,
    'direction' => $finalDirection,
  ],
]);
