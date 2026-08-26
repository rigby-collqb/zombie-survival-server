const worldMap = require('./worldMap');
const config = require('./config');

let nextZombieId = 1;

const ZOMBIE_TYPES = Object.freeze({
  normal:   { type: 'normal',   health: 1.00, speed: 1.00, radius: 15, damage: 10, reward: 10 },
  runner:   { type: 'runner',   health: 0.70, speed: 1.55, radius: 13, damage: 8,  reward: 14 },
  tank:     { type: 'tank',     health: 3.25, speed: 0.56, radius: 23, damage: 20, reward: 32 },
  exploder: { type: 'exploder', health: 1.15, speed: 0.90, radius: 17, damage: 28, reward: 22, explosionRadius: 115 },
  spitter:  { type: 'spitter',  health: 0.90, speed: 0.72, radius: 15, damage: 9,  reward: 20, spitRange: 270, spitCooldownMs: 1800 },
  boss:     { type: 'boss',     health: 8.00, speed: 0.68, radius: 33, damage: 28, reward: 250 },
});

class ZombieSystem {
  constructor() {
    this.zombies = new Map();
    this.healthMultiplier = 1;
    this.speedMultiplier = 1;
    this.maxZombiesThisRound = 0;
    this.totalSpawnedThisRound = 0;
    this.roundNumber = 0;
    this.bossSpawned = false;
    this.bossesSpawned = 0;
    this.bossCount = 0;
    this.bossPower = 1;
  }

  setRoundParameters({ totalZombies, healthMultiplier, speedMultiplier, roundNumber = 0, bossCount = 0, bossPower = 1 }) {
    this.zombies.clear();
    this.maxZombiesThisRound = totalZombies;
    this.healthMultiplier = healthMultiplier;
    this.speedMultiplier = speedMultiplier;
    this.roundNumber = roundNumber;
    this.totalSpawnedThisRound = 0;
    this.bossSpawned = false;
    this.bossesSpawned = 0;
    this.bossCount = Math.max(0, Number(bossCount) || 0);
    this.bossPower = Math.max(1, Number(bossPower) || 1);
  }

  get aliveCount() {
    let n = 0;
    for (const z of this.zombies.values()) if (z.state !== 'dead') n++;
    return n;
  }

  get remainingToSpawn() {
    return Math.max(0, this.maxZombiesThisRound - this.totalSpawnedThisRound);
  }

  isRoundComplete() {
    return this.remainingToSpawn === 0 && this.aliveCount === 0 && this.zombies.size === 0;
  }

  _pickType() {
    if (this.roundNumber > 0 && this.roundNumber % 5 === 0 && this.bossesSpawned < this.bossCount) {
      this.bossSpawned = true;
      this.bossesSpawned++;
      return 'boss';
    }

    const r = Math.random();
    const round = this.roundNumber;
    if (round >= 8 && r < 0.10) return 'tank';
    if (round >= 6 && r < 0.22) return 'spitter';
    if (round >= 4 && r < 0.34) return 'exploder';
    if (round >= 2 && r < 0.56) return 'runner';
    return 'normal';
  }

  _pickSpawnPoint(alivePlayers) {
    const margin = 80;
    for (let attempt = 0; attempt < 45; attempt++) {
      let x, y;
      if (alivePlayers.length > 0) {
        const anchor = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
        const a = Math.random() * Math.PI * 2;
        const d = config.ZOMBIE_MIN_SPAWN_DIST_FROM_PLAYER +
          Math.random() * (config.ZOMBIE_MAX_SPAWN_DIST_FROM_PLAYER - config.ZOMBIE_MIN_SPAWN_DIST_FROM_PLAYER);
        x = anchor.x + Math.cos(a) * d;
        y = anchor.y + Math.sin(a) * d;
      } else {
        x = margin + Math.random() * (config.WORLD_WIDTH - margin * 2);
        y = margin + Math.random() * (config.WORLD_HEIGHT - margin * 2);
      }

      x = Math.max(margin, Math.min(config.WORLD_WIDTH - margin, x));
      y = Math.max(margin, Math.min(config.WORLD_HEIGHT - margin, y));
      if (worldMap.circleHitsAnyObstacle(x, y, config.ZOMBIE_COLLISION_RADIUS + config.ZOMBIE_SPAWN_OBSTACLE_MARGIN)) continue;

      let tooClose = false;
      for (const p of alivePlayers) {
        if (Math.hypot(x - p.x, y - p.y) < config.ZOMBIE_MIN_SPAWN_DIST_FROM_PLAYER) { tooClose = true; break; }
      }
      if (!tooClose) return { x, y };
    }
    return null;
  }

  _spawnOne(alivePlayers) {
    const spot = this._pickSpawnPoint(alivePlayers);
    if (!spot) return false;

    const type = this._pickType();
    const spec = ZOMBIE_TYPES[type];
    const bossScale = type === 'boss' ? this.bossPower : 1;
    const maxHealth = Math.max(1, Math.round(config.ZOMBIE_BASE_HEALTH * this.healthMultiplier * spec.health * bossScale));
    const id = nextZombieId++;

    this.zombies.set(id, {
      id, type,
      x: spot.x, y: spot.y,
      health: maxHealth, maxHealth,
      radius: spec.radius,
      speed: config.ZOMBIE_BASE_SPEED * this.speedMultiplier * spec.speed,
      damage: Math.round(spec.damage * (type === 'boss' ? Math.min(2.2, this.bossPower) : 1)),
      reward: Math.round(spec.reward * (type === 'boss' ? this.bossPower : 1)),
      state: 'idle', targetPlayerId: null,
      directionX: 0, directionY: 1,
      wanderX: null, wanderY: null,
      stateTimer: config.ZOMBIE_IDLE_MIN_SECONDS + Math.random() * (config.ZOMBIE_IDLE_MAX_SECONDS - config.ZOMBIE_IDLE_MIN_SECONDS),
      lastAttackAt: 0, deadAt: 0,
    });
    this.totalSpawnedThisRound++;
    return true;
  }

  _ensurePopulation(alivePlayers) {
    if (this.remainingToSpawn <= 0) return;
    const room = config.MAX_ALIVE_ZOMBIES - this.aliveCount;
    const toSpawn = Math.min(this.remainingToSpawn, room, 3);
    for (let i = 0; i < toSpawn; i++) if (!this._spawnOne(alivePlayers)) break;
  }

  _dir(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, dist = Math.hypot(dx, dy);
    return dist < 0.0001 ? { x: 0, y: 0, dist: 0 } : { x: dx / dist, y: dy / dist, dist };
  }

  tick(dt, players, onPlayerDamage, onSpecial) {
    const now = Date.now();

    for (const [id, z] of this.zombies) {
      if (z.state === 'dead' && now - z.deadAt >= config.ZOMBIE_RESPAWN_DELAY_MS) this.zombies.delete(id);
    }

    this._ensurePopulation(players);

    for (const z of this.zombies.values()) {
      if (z.state === 'dead') continue;

      let nearest = null;
      let nearestDist = config.DETECTION_RADIUS + (z.type === 'boss' ? 180 : 0);
      for (const p of players) {
        const d = Math.hypot(p.x - z.x, p.y - z.y);
        if (d <= nearestDist) { nearest = p; nearestDist = d; }
      }

      if (nearest) {
        z.targetPlayerId = nearest.id;
        const dir = this._dir(z.x, z.y, nearest.x, nearest.y);
        if (dir.dist > 0.0001) { z.directionX = dir.x; z.directionY = dir.y; }

        const spec = ZOMBIE_TYPES[z.type];
        if (z.type === 'spitter' && nearestDist > 72 && nearestDist <= spec.spitRange) {
          z.state = 'attack';
          if (now - z.lastAttackAt >= spec.spitCooldownMs) {
            const wall = worldMap.raycastDistanceToObstacle(z.x, z.y, dir.x, dir.y, nearestDist);
            if (wall === null || wall >= nearestDist - 12) {
              z.lastAttackAt = now;
              onSpecial?.({ type: 'spit', zombie: z, player: nearest, damage: spec.damage });
            }
          }
        } else if (nearestDist <= (z.radius + config.PLAYER_COLLISION_RADIUS + 10)) {
          z.state = 'attack';
          if (now - z.lastAttackAt >= config.ATTACK_COOLDOWN_MS) {
            z.lastAttackAt = now;
            if (z.type === 'exploder') {
              z.state = 'dead';
              z.deadAt = now;
              onSpecial?.({ type: 'explode', zombie: z, radius: spec.explosionRadius, damage: spec.damage });
            } else {
              onPlayerDamage(nearest.id, z.damage);
            }
          }
        } else {
          z.state = 'chase';
          const nextX = z.x + dir.x * z.speed * dt;
          const nextY = z.y + dir.y * z.speed * dt;
          const moved = worldMap.resolveCircleMovement(z.x, z.y, nextX, nextY, z.radius);
          z.x = moved.x; z.y = moved.y;
        }
      } else {
        z.targetPlayerId = null;
        if (z.state === 'attack' || z.state === 'chase') {
          z.state = 'idle';
          z.stateTimer = config.ZOMBIE_IDLE_MIN_SECONDS + Math.random() * (config.ZOMBIE_IDLE_MAX_SECONDS - config.ZOMBIE_IDLE_MIN_SECONDS);
        } else if (z.state === 'idle') {
          z.stateTimer -= dt;
          if (z.stateTimer <= 0) {
            const a = Math.random() * Math.PI * 2, r = Math.random() * config.ZOMBIE_WANDER_RADIUS;
            z.wanderX = Math.max(20, Math.min(config.WORLD_WIDTH - 20, z.x + Math.cos(a) * r));
            z.wanderY = Math.max(20, Math.min(config.WORLD_HEIGHT - 20, z.y + Math.sin(a) * r));
            z.state = 'wander';
          }
        } else if (z.state === 'wander') {
          const dir = this._dir(z.x, z.y, z.wanderX ?? z.x, z.wanderY ?? z.y);
          if (dir.dist < 6) {
            z.state = 'idle';
            z.stateTimer = config.ZOMBIE_IDLE_MIN_SECONDS + Math.random() * (config.ZOMBIE_IDLE_MAX_SECONDS - config.ZOMBIE_IDLE_MIN_SECONDS);
          } else {
            z.directionX = dir.x; z.directionY = dir.y;
            const moved = worldMap.resolveCircleMovement(z.x, z.y, z.x + dir.x * z.speed * 0.5 * dt, z.y + dir.y * z.speed * 0.5 * dt, z.radius);
            z.x = moved.x; z.y = moved.y;
          }
        }
      }

      z.x = Math.max(z.radius, Math.min(config.WORLD_WIDTH - z.radius, z.x));
      z.y = Math.max(z.radius, Math.min(config.WORLD_HEIGHT - z.radius, z.y));
    }
  }

  applyDamage(zombieId, amount) {
    const z = this.zombies.get(Number(zombieId));
    if (!z || z.state === 'dead') return null;
    z.health = Math.max(0, z.health - Math.max(0, Number(amount) || 0));
    const died = z.health <= 0;
    if (died) { z.state = 'dead'; z.deadAt = Date.now(); }
    return { health: z.health, died, zombie: z };
  }

  _headPoint(z) {
    const len = Math.hypot(z.directionX, z.directionY) || 1;
    return {
      x: z.x + (z.directionX / len) * z.radius * 0.38,
      y: z.y + (z.directionY / len) * z.radius * 0.38,
      radius: Math.max(5, z.radius * 0.36),
    };
  }

  findHitZombie(originX, originY, dirX, dirY, maxDistance, wallDistance) {
    let best = null;
    let bestDistance = Infinity;

    for (const z of this.zombies.values()) {
      if (z.state === 'dead') continue;
      const maxAllowed = wallDistance === null ? maxDistance : Math.min(maxDistance, wallDistance);

      const head = this._headPoint(z);
      const hp = worldMap.pointDistanceToRay(head.x, head.y, originX, originY, dirX, dirY, maxDistance);
      const bp = worldMap.pointDistanceToRay(z.x, z.y, originX, originY, dirX, dirY, maxDistance);

      let part = null;
      let distance = Infinity;
      if (hp.distanceAlongRay >= 0 && hp.distanceAlongRay <= maxAllowed && hp.distanceFromRay <= head.radius) {
        part = 'head'; distance = hp.distanceAlongRay;
      } else if (bp.distanceAlongRay >= 0 && bp.distanceAlongRay <= maxAllowed && bp.distanceFromRay <= z.radius + 5) {
        part = 'body'; distance = bp.distanceAlongRay;
      }

      if (part && distance < bestDistance) {
        bestDistance = distance;
        best = { zombie: z, part, distance };
      }
    }
    return best;
  }

  getSnapshot() {
    const out = [];
    for (const z of this.zombies.values()) {
      out.push({
        id: z.id, type: z.type, x: z.x, y: z.y,
        health: z.health, maxHealth: z.maxHealth, state: z.state,
        directionX: z.directionX, directionY: z.directionY,
        radius: z.radius, speed: z.speed,
      });
    }
    return out;
  }

  // Snapshot compacto para tráfego mobile: [id,type,x,y,hp,maxHp,state,dx,dy,radius,speed]
  getCompactSnapshot() {
    const out = [];
    for (const z of this.zombies.values()) {
      out.push([z.id,z.type,Math.round(z.x*10)/10,Math.round(z.y*10)/10,z.health,z.maxHealth,z.state,Math.round(z.directionX*1000)/1000,Math.round(z.directionY*1000)/1000,z.radius,Math.round(z.speed*10)/10]);
    }
    return out;
  }
}

ZombieSystem.TYPES = ZOMBIE_TYPES;
module.exports = ZombieSystem;
