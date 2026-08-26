<?php
/**
 * shoot.php  (POST)
 * ------------------------------------------------------------
 * Tiro da pistola (item 25/26 da Fase 3). HITSCAN autoritativo no
 * servidor: o cliente NUNCA diz "matei o zumbi X" (item 24) — ele
 * apenas informa o token e (opcionalmente) qual zumbi mirou; o
 * servidor recalcula o raio a partir da posição/direção de mira já
 * validadas em sync.php e decide sozinho o que foi atingido.
 *
 * Body esperado (JSON): { "token": "...", "zombieId": 7 }
 * ("zombieId" é só uma dica/telemetria — nunca é confiado sozinho.)
 *
 * Resposta:
 * { "success": true, "hit": bool, "wallBlocked": bool,
 *   "zombieId": int|null, "zombieHealth": int|null, "zombieDead": bool,
 *   "kills": int }
 * ------------------------------------------------------------
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/world_map.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  json_error('method_not_allowed', 405);
}

$input = read_json_body();
$token = extract_token($input);
if ($token === null) {
  json_error('invalid_token', 401);
}

$pdo = get_db();

$stmt = $pdo->prepare(
  'SELECT id, x, y, alive, aim_dir_x, aim_dir_y, kills,
          UNIX_TIMESTAMP(last_shot) AS last_shot_ts
   FROM online_players WHERE session_token = :token LIMIT 1'
);
$stmt->execute(['token' => $token]);
$player = $stmt->fetch();

if (!$player) {
  json_error('invalid_player', 404);
}
if (!(bool)$player['alive']) {
  json_error('player_dead', 403);
}

// --- Fire rate (item 23/51): rejeita spam acima do cooldown da arma --
if ($player['last_shot_ts'] !== null) {
  $elapsedMs = (microtime(true) - (float)$player['last_shot_ts']) * 1000;
  if ($elapsedMs < PISTOL_FIRE_RATE_MS) {
    json_error('fire_rate_exceeded', 429);
  }
}

$originX = (float)$player['x'];
$originY = (float)$player['y'];
$dirX = (float)$player['aim_dir_x'];
$dirY = (float)$player['aim_dir_y'];
$dirLen = hypot($dirX, $dirY);
if ($dirLen < 0.0001) {
  json_error('invalid_direction', 422);
}
$dirX /= $dirLen;
$dirY /= $dirLen;

// Consome o cooldown já aqui, mesmo que o tiro erre — o disparo em si
// já aconteceu (item 33: nunca deixar o cliente burlar o fire rate).
$markShot = $pdo->prepare('UPDATE online_players SET last_shot = NOW(3) WHERE id = :pid');
$markShot->execute(['pid' => $player['id']]);

$obstacles = get_world_obstacles();
$wallDistance = raycast_distance_to_obstacle($originX, $originY, $dirX, $dirY, MAX_SHOOT_DISTANCE, $obstacles);

// --- Encontra o zumbi vivo mais próximo NO CAMINHO do tiro -----------
$zombiesStmt = $pdo->query("SELECT id, x, y, health FROM zombies WHERE state != 'dead'");
$candidates = $zombiesStmt->fetchAll();

$hitZombie = null;
$hitDistance = null;

foreach ($candidates as $z) {
  $proj = point_distance_to_ray((float)$z['x'], (float)$z['y'], $originX, $originY, $dirX, $dirY, MAX_SHOOT_DISTANCE);
  if ($proj['distanceFromRay'] > (ZOMBIE_COLLISION_RADIUS + 10)) continue; // não está no caminho do raio
  if ($proj['distanceAlongRay'] > MAX_SHOOT_DISTANCE) continue;
  if ($wallDistance !== null && $proj['distanceAlongRay'] > $wallDistance) continue; // parede bloqueia antes (item 27)

  if ($hitDistance === null || $proj['distanceAlongRay'] < $hitDistance) {
    $hitDistance = $proj['distanceAlongRay'];
    $hitZombie = $z;
  }
}

$wallBlocked = ($hitZombie === null && $wallDistance !== null);

if ($hitZombie === null) {
  json_success([
    'hit' => false,
    'wallBlocked' => $wallBlocked,
    'zombieId' => null,
    'zombieHealth' => null,
    'zombieDead' => false,
    'kills' => (int)$player['kills'],
  ]);
}

// --- Aplica dano de forma segura para concorrência (item 40) ---------
$damageStmt = $pdo->prepare(
  "UPDATE zombies SET health = GREATEST(0, health - :dmg) WHERE id = :id AND state != 'dead'"
);
$damageStmt->execute(['dmg' => PISTOL_DAMAGE, 'id' => $hitZombie['id']]);

$freshStmt = $pdo->prepare('SELECT health FROM zombies WHERE id = :id');
$freshStmt->execute(['id' => $hitZombie['id']]);
$fresh = $freshStmt->fetch();
$newHealth = $fresh ? (int)$fresh['health'] : 0;

$zombieDead = false;
$kills = (int)$player['kills'];

if ($newHealth <= 0) {
  // Só QUEM primeiro conseguir fazer essa transição idle->dead recebe
  // o abate — evita duas mortes/duas contagens no mesmo zumbi (item 40).
  $killStmt = $pdo->prepare(
    "UPDATE zombies SET state = 'dead', state_timer = 0, last_update = NOW(3)
     WHERE id = :id AND state != 'dead' AND health <= 0"
  );
  $killStmt->execute(['id' => $hitZombie['id']]);

  if ($killStmt->rowCount() === 1) {
    $zombieDead = true;
    $incKills = $pdo->prepare('UPDATE online_players SET kills = kills + 1 WHERE id = :pid');
    $incKills->execute(['pid' => $player['id']]);
    $kills++;
  }
}

json_success([
  'hit' => true,
  'wallBlocked' => false,
  'zombieId' => (int)$hitZombie['id'],
  'zombieHealth' => $newHealth,
  'zombieDead' => $zombieDead,
  'kills' => $kills,
]);
