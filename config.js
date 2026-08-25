/**
 * config.js
 * ------------------------------------------------------------
 * Constantes do GameServer. Espelham os mesmos valores usados no
 * PHP (api/config.php) e no cliente (js/game.js / js/player.js) —
 * WORLD_WIDTH/HEIGHT e MAP_SEED especialmente precisam ficar
 * idênticos nos três lugares, senão zumbis/colisão divergem do
 * que o jogador vê.
 * ------------------------------------------------------------
 */

module.exports = {
  PORT: process.env.PORT || 3000,

  // --- Mundo (igual a js/game.js e api/config.php) ------------------
  WORLD_WIDTH: 4000,
  WORLD_HEIGHT: 4000,
  MAP_SEED: 20260823,

  SPAWN_CENTER_X: 2000,
  SPAWN_CENTER_Y: 2000,
  SPAWN_RADIUS: 160,

  PLAYER_SPEED: 220,
  PLAYER_COLLISION_RADIUS: 14,
  MAX_PLAYERS: 20,
  MAX_NAME_LENGTH: 16,

  // --- Zumbis (base do round 1 — ver ROUND_SCALING abaixo) ----------
  ZOMBIE_BASE_HEALTH: 100,
  ZOMBIE_BASE_SPEED: 70,
  ZOMBIE_COLLISION_RADIUS: 14,
  DETECTION_RADIUS: 350,
  ATTACK_RANGE: 42,
  ZOMBIE_ATTACK_DAMAGE: 10,
  ATTACK_COOLDOWN_MS: 1000,
  ZOMBIE_RESPAWN_DELAY_MS: 900, // tempo em 'dead' antes de sumir do snapshot
  ZOMBIE_MIN_SPAWN_DIST_FROM_PLAYER: 500,
  ZOMBIE_SPAWN_OBSTACLE_MARGIN: 24,
  ZOMBIE_WANDER_RADIUS: 140,
  ZOMBIE_IDLE_MIN_SECONDS: 1.5,
  ZOMBIE_IDLE_MAX_SECONDS: 4.0,
  MAX_ALIVE_ZOMBIES: 60, // limite de segurança, nunca ultrapassa mesmo em rounds altos

  // --- Combate -------------------------------------------------------
  PISTOL_DAMAGE: 25,
  PISTOL_FIRE_RATE_MS: 350,
  MAX_SHOOT_DISTANCE: 520,

  // --- Ticks -----------------------------------------------------------
  SIMULATION_TICK_MS: 50,   // 20Hz — IA/movimento/colisão
  SNAPSHOT_INTERVAL_MS: 100, // 10Hz — broadcast de zombies:snapshot
  ROUND_BROADCAST_INTERVAL_MS: 1000, // HUD não precisa de mais que 1Hz

  // --- Rounds ----------------------------------------------------------
  ROUND_START_COUNTDOWN_SECONDS: 5,
  ROUND_INTERMISSION_SECONDS: 8,
  ROUND_BASE_ZOMBIES: 10,
  ROUND_ZOMBIES_PER_ROUND: 5,
  ROUND_HEALTH_MULTIPLIER_PER_ROUND: 0.08,
  ROUND_SPEED_MULTIPLIER_PER_ROUND: 0.025,

  OFFLINE_TIMEOUT_MS: 20000, // desconecta jogador sem 'player:state' há esse tempo
};
