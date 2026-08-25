/**
 * zombies.js
 * ------------------------------------------------------------
 * Simulação de zumbis EM TEMPO REAL no servidor Node (substitui a
 * simulação "lazy" que existia em api/zombie_engine.php — aquele
 * arquivo continua no projeto como legado, mas não é mais chamado).
 *
 * Como o game loop aqui é contínuo (setInterval a 20Hz, veja
 * gameServer.js), cada tick já tem um dt fixo e um único processo
 * Node processa tudo em sequência — nada de "optimistic concurrency"
 * como no PHP (não existe corrida entre requisições concorrentes).
 *
 * Estados: idle -> wander -> idle -> chase -> attack -> (volta pra
 * chase/idle) -> dead. Mesmo comportamento do PHP antigo, só que
 * avançado a cada tick real em vez de "desde o último sync".
 * ------------------------------------------------------------
 */

const worldMap = require('./worldMap');
const config = require('./config');

let nextZombieId = 1;

class ZombieSystem {
  constructor() {
    /** @type {Map<number, object>} */
    this.zombies = new Map();

    this.healthMultiplier = 1;
    this.speedMultiplier = 1;
    this.maxZombiesThisRound = 0;
    this.totalSpawnedThisRound = 0;
  }

  /** Chamado no início de cada round (round:start). */
  setRoundParameters({ totalZombies, healthMultiplier, speedMultiplier }) {
    this.zombies.clear();
    this.maxZombiesThisRound = totalZombies;
    this.healthMultiplier = healthMultiplier;
    this.speedMultiplier = speedMultiplier;
    this.totalSpawnedThisRound = 0;
  }

  get aliveCount() {
    let total = 0;
    for (const z of this.zombies.values()) {
      if (z.state !== 'dead') total++;
    }
    return total;
  }

  get remainingToSpawn() {
    return Math.max(0, this.maxZombiesThisRound - this.totalSpawnedThisRound);
  }

  /** Round acaba quando já nasceram todos os zumbis dele e nenhum está mais vivo. */
  isRoundComplete() {
    return this.remainingToSpawn === 0 && this.aliveCount === 0 && this.zombies.size === 0;
  }

  _zombieSpeed() {
    return config.ZOMBIE_BASE_SPEED * this.speedMultiplier;
  }

  _zombieMaxHealth() {
    return Math.round(config.ZOMBIE_BASE_HEALTH * this.healthMultiplier);
  }

  _pickSpawnPoint(alivePlayers) {
    const margin = 80;
    for (let attempt = 0; attempt < 25; attempt++) {
      const x = margin + Math.random() * (config.WORLD_WIDTH - margin * 2);
      const y = margin + Math.random() * (config.WORLD_HEIGHT - margin * 2);

      if (worldMap.circleHitsAnyObstacle(x, y, config.ZOMBIE_COLLISION_RADIUS + config.ZOMBIE_SPAWN_OBSTACLE_MARGIN)) {
        continue;
      }

      let tooClose = false;
      for (const p of alivePlayers) {
        if (Math.hypot(x - p.x, y - p.y) < config.ZOMBIE_MIN_SPAWN_DIST_FROM_PLAYER) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      return { x, y };
    }
    return null;
  }

  _spawnOne(alivePlayers) {
    const spot = this._pickSpawnPoint(alivePlayers);
    if (!spot) return false;

    const id = nextZombieId++;
    const idleTimer = config.ZOMBIE_IDLE_MIN_SECONDS +
      Math.random() * (config.ZOMBIE_IDLE_MAX_SECONDS - config.ZOMBIE_IDLE_MIN_SECONDS);

    this.zombies.set(id, {
      id,
      x: spot.x,
      y: spot.y,
      health: this._zombieMaxHealth(),
      maxHealth: this._zombieMaxHealth(),
      state: 'idle',
      targetPlayerId: null,
      directionX: 0,
      directionY: 1,
      wanderX: null,
      wanderY: null,
      stateTimer: idleTimer,
      lastAttackAt: 0,
      deadAt: 0,
    });

    this.totalSpawnedThisRound++;
    return true;
  }

  /** Repõe zumbis até o limite do round (e o teto de segurança global). */
  _ensurePopulation(alivePlayers) {
    const missingForRound = this.remainingToSpawn;
    if (missingForRound <= 0) return;

    const roomForMore = config.MAX_ALIVE_ZOMBIES - this.aliveCount;
    const toSpawn = Math.min(missingForRound, roomForMore, 3); // no máx. 3 por tick — evita picos de CPU

    for (let i = 0; i < toSpawn; i++) {
      if (!this._spawnOne(alivePlayers)) break;
    }
  }

  _normalizedDirection(fromX, fromY, toX, toY) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.0001) return { x: 0, y: 0, dist: 0 };
    return { x: dx / dist, y: dy / dist, dist };
  }

  /**
   * Avança a simulação um tick. `players` é um array de jogadores
   * VIVOS { id, x, y }. `onPlayerDamage(playerId, amount)` é chamado
   * quando um zumbi ataca — quem decide vida/morte do jogador é o
   * GameServer (mantém o player.js autoritativo em um só lugar).
   */
  tick(dt, players, onPlayerDamage) {
    const now = Date.now();

    // --- remove zumbis mortos depois do tempo de fade -----------------
    for (const [id, z] of this.zombies) {
      if (z.state === 'dead' && now - z.deadAt >= config.ZOMBIE_RESPAWN_DELAY_MS) {
        this.zombies.delete(id);
      }
    }

    this._ensurePopulation(players);

    const obstacles = worldMap.getObstacles();
    const speed = this._zombieSpeed();

    for (const z of this.zombies.values()) {
      if (z.state === 'dead') continue;

      // --- 1. Detecção: jogador vivo mais próximo -------------------
      let nearest = null;
      let nearestDist = config.DETECTION_RADIUS;
      for (const p of players) {
        const d = Math.hypot(p.x - z.x, p.y - z.y);
        if (d <= nearestDist) {
          nearestDist = d;
          nearest = p;
        }
      }

      if (nearest) {
        z.targetPlayerId = nearest.id;

        if (nearestDist <= config.ATTACK_RANGE) {
          z.state = 'attack';
          const dir = this._normalizedDirection(z.x, z.y, nearest.x, nearest.y);
          if (dir.dist > 0.0001) { z.directionX = dir.x; z.directionY = dir.y; }

          if (now - z.lastAttackAt >= config.ATTACK_COOLDOWN_MS) {
            z.lastAttackAt = now;
            onPlayerDamage(nearest.id, config.ZOMBIE_ATTACK_DAMAGE);
          }
        } else {
          z.state = 'chase';
          const dir = this._normalizedDirection(z.x, z.y, nearest.x, nearest.y);
          z.directionX = dir.x; z.directionY = dir.y;

          const nextX = z.x + dir.x * speed * dt;
          const nextY = z.y + dir.y * speed * dt;
          const moved = worldMap.resolveCircleMovement(z.x, z.y, nextX, nextY, config.ZOMBIE_COLLISION_RADIUS);
          z.x = moved.x; z.y = moved.y;
        }
      } else {
        z.targetPlayerId = null;

        if (z.state === 'attack' || z.state === 'chase') {
          z.state = 'idle';
          z.stateTimer = config.ZOMBIE_IDLE_MIN_SECONDS +
            Math.random() * (config.ZOMBIE_IDLE_MAX_SECONDS - config.ZOMBIE_IDLE_MIN_SECONDS);
        } else if (z.state === 'idle') {
          z.stateTimer -= dt;
          if (z.stateTimer <= 0) {
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * config.ZOMBIE_WANDER_RADIUS;
            z.wanderX = Math.max(20, Math.min(config.WORLD_WIDTH - 20, z.x + Math.cos(angle) * radius));
            z.wanderY = Math.max(20, Math.min(config.WORLD_HEIGHT - 20, z.y + Math.sin(angle) * radius));
            z.state = 'wander';
          }
        } else if (z.state === 'wander') {
          if (z.wanderX === null || z.wanderY === null) {
            z.state = 'idle';
            z.stateTimer = config.ZOMBIE_IDLE_MIN_SECONDS;
          } else {
            const dir = this._normalizedDirection(z.x, z.y, z.wanderX, z.wanderY);
            if (dir.dist < 6) {
              z.state = 'idle';
              z.stateTimer = config.ZOMBIE_IDLE_MIN_SECONDS +
                Math.random() * (config.ZOMBIE_IDLE_MAX_SECONDS - config.ZOMBIE_IDLE_MIN_SECONDS);
            } else {
              z.directionX = dir.x; z.directionY = dir.y;
              const wanderSpeed = speed * 0.5;
              const nextX = z.x + dir.x * wanderSpeed * dt;
              const nextY = z.y + dir.y * wanderSpeed * dt;
              const moved = worldMap.resolveCircleMovement(z.x, z.y, nextX, nextY, config.ZOMBIE_COLLISION_RADIUS);
              z.x = moved.x; z.y = moved.y;
            }
          }
        }
      }

      z.x = Math.max(20, Math.min(config.WORLD_WIDTH - 20, z.x));
      z.y = Math.max(20, Math.min(config.WORLD_HEIGHT - 20, z.y));
    }
  }

  /** Aplica dano de tiro (item: servidor nunca confia em kill do cliente). */
  applyDamage(zombieId, amount) {
    const z = this.zombies.get(zombieId);
    if (!z || z.state === 'dead') return null;

    z.health = Math.max(0, z.health - amount);
    let died = false;

    if (z.health <= 0) {
      z.state = 'dead';
      z.deadAt = Date.now();
      died = true;
    }

    return { health: z.health, died };
  }

  /** Zumbi mais próximo no caminho do tiro (mesmo hitscan de api/shoot.php). */
  findHitZombie(originX, originY, dirX, dirY, maxDistance, wallDistance) {
    let hit = null;
    let hitDistance = Infinity;

    for (const z of this.zombies.values()) {
      if (z.state === 'dead') continue;

      const proj = worldMap.pointDistanceToRay(z.x, z.y, originX, originY, dirX, dirY, maxDistance);
      if (proj.distanceFromRay > config.ZOMBIE_COLLISION_RADIUS + 10) continue;
      if (proj.distanceAlongRay > maxDistance) continue;
      if (wallDistance !== null && proj.distanceAlongRay > wallDistance) continue;

      if (proj.distanceAlongRay < hitDistance) {
        hitDistance = proj.distanceAlongRay;
        hit = z;
      }
    }

    return hit;
  }

  getSnapshot() {
    const snapshot = [];
    for (const z of this.zombies.values()) {
      snapshot.push({
        id: z.id,
        x: z.x,
        y: z.y,
        health: z.health,
        maxHealth: z.maxHealth,
        state: z.state,
        directionX: z.directionX,
        directionY: z.directionY,
      });
    }
    return snapshot;
  }
}

module.exports = ZombieSystem;
