const config = require('./config');
const worldMap = require('./worldMap');
const ZombieSystem = require('./zombies');
const RoundSystem = require('./rounds');
const { LootSystem } = require('./loot');
const { WEAPONS, SHOP, getWeapon, createWeaponState } = require('./weapons');

class GameServer {
  constructor(io) {
    this.io = io;
    this.players = new Map();
    this.zombieSystem = new ZombieSystem();
    this.roundSystem = new RoundSystem(this.zombieSystem);
    this.lootSystem = new LootSystem();
    this._snapshotAccumulatorMs = 0;
    this._roundAccumulatorMs = 0;
    this._lootAccumulatorMs = 0;
    this._bindSocketEvents();
    this._startLoop();
  }

  _pickPlayerSpawn() {
    for (let attempt = 0; attempt < 30; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * config.SPAWN_RADIUS;
      const x = Math.max(40, Math.min(config.WORLD_WIDTH - 40, config.SPAWN_CENTER_X + Math.cos(a) * r));
      const y = Math.max(40, Math.min(config.WORLD_HEIGHT - 40, config.SPAWN_CENTER_Y + Math.sin(a) * r));
      if (!worldMap.circleHitsAnyObstacle(x, y, config.PLAYER_COLLISION_RADIUS + 10)) return { x, y };
    }
    return { x: config.SPAWN_CENTER_X, y: config.SPAWN_CENTER_Y };
  }

  _playerSpeed(p) {
    return config.PLAYER_SPEED * (1 + p.upgrades.movement * config.MOVEMENT_UPGRADE_PER_LEVEL);
  }

  _publicPlayerSnapshot(p) {
    return {
      id: p.id, name: p.name, x: p.x, y: p.y,
      direction: p.direction, moving: p.moving, vx: p.vx, vy: p.vy,
      aimDirX: p.aimDirX, aimDirY: p.aimDirY,
      health: p.health, maxHealth: p.maxHealth, alive: p.alive,
      weaponId: p.activeWeaponId,
    };
  }

  _selfSnapshot(p) {
    this._finishReloadIfDue(p);
    const active = p.weapons[p.activeWeaponId] || createWeaponState('pistol');
    return {
      id: p.id,
      health: p.health, maxHealth: p.maxHealth, alive: p.alive,
      kills: p.kills, headshots: p.headshots, money: p.money,
      slots: [...p.slots], activeSlot: p.activeSlot, activeWeaponId: p.activeWeaponId,
      ammo: active.ammo, reserve: active.reserve,
      weapons: Object.fromEntries(Object.entries(p.weapons).map(([id, s]) => [id, { id, ammo: s.ammo, reserve: s.reserve }])),
      upgrades: { ...p.upgrades },
      reloading: p.reloadEndAt > Date.now(),
      reloadRemainingMs: Math.max(0, p.reloadEndAt - Date.now()),
      speed: this._playerSpeed(p),
    };
  }

  _emitSelf(p) {
    const socket = this.io.sockets.sockets.get(p.socketId);
    if (socket) socket.emit('player:self', this._selfSnapshot(p));
  }

  _shopCatalog() {
    return {
      weapons: Object.values(WEAPONS).filter(w => w.shopPrice > 0).map(w => ({ id: w.id, name: w.name, price: w.shopPrice, rarity: w.rarity })),
      ammo: { id: 'ammo', name: 'Munição', price: SHOP.ammo },
      health: { id: 'health', name: 'Kit médico', price: SHOP.health },
      upgrades: {
        damage: SHOP.upgrades.damage,
        reload: SHOP.upgrades.reload,
        movement: SHOP.upgrades.movement,
      },
    };
  }

  _bindSocketEvents() {
    this.io.on('connection', socket => {
      socket.on('player:join', (data, ack) => this._safe(ack, () => this._handleJoin(socket, data, ack)));
      socket.on('player:state', data => { try { this._handleState(socket, data); } catch (e) { console.error('[state]', e); } });
      socket.on('player:shoot', (data, ack) => this._safe(ack, () => this._handleShoot(socket, data, ack)));
      socket.on('player:reload', (_data, ack) => this._safe(ack, () => this._handleReload(socket, ack)));
      socket.on('player:switch', (data, ack) => this._safe(ack, () => this._handleSwitch(socket, data, ack)));
      socket.on('loot:pickup', (data, ack) => this._safe(ack, () => this._handleLootPickup(socket, data, ack)));
      socket.on('shop:buy', (data, ack) => this._safe(ack, () => this._handleShopBuy(socket, data, ack)));
      socket.on('player:respawn', (_data, ack) => this._safe(ack, () => this._handleRespawn(socket, ack)));
      socket.on('player:leave', () => this._handleLeave(socket));
      socket.on('disconnect', () => this._handleLeave(socket));
      socket.on('ping:check', ack => ack && ack());
    });
  }

  _safe(ack, fn) {
    try { fn(); } catch (err) {
      console.error('[socket] erro:', err);
      ack && ack({ success: false, error: 'server_error' });
    }
  }

  _handleJoin(socket, data, ack) {
    if (this.players.size >= config.MAX_PLAYERS) return ack && ack({ success: false, error: 'server_full' });
    let name = String(data?.name || 'Sobrevivente').trim().slice(0, config.MAX_NAME_LENGTH) || 'Sobrevivente';
    const spawn = this._pickPlayerSpawn();
    const pistol = createWeaponState('pistol');
    const p = {
      id: socket.id, socketId: socket.id, name,
      x: spawn.x, y: spawn.y, direction: 'down', moving: false, vx: 0, vy: 0,
      aimDirX: 0, aimDirY: 1,
      health: 100, maxHealth: 100, alive: true,
      kills: 0, headshots: 0, money: 0,
      weapons: { pistol }, slots: ['pistol'], activeSlot: 0, activeWeaponId: 'pistol',
      upgrades: { damage: 0, reload: 0, movement: 0 },
      lastShotAt: 0, reloadEndAt: 0, reloadWeaponId: null,
      lastStateAt: Date.now(),
    };
    this.players.set(socket.id, p);

    const others = [...this.players.values()].filter(o => o.id !== p.id).map(o => this._publicPlayerSnapshot(o));
    ack && ack({
      success: true,
      player: this._publicPlayerSnapshot(p),
      self: this._selfSnapshot(p),
      players: others,
      zombies: this.zombieSystem.getSnapshot(),
      loot: this.lootSystem.getSnapshot(),
      round: this.roundSystem.getState(),
      shop: this._shopCatalog(),
    });
    socket.broadcast.emit('player:joined', this._publicPlayerSnapshot(p));
  }

  _handleState(socket, data) {
    const p = this.players.get(socket.id);
    if (!p || !data || !p.alive) return;
    const x = Number(data.x), y = Number(data.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const now = Date.now();
    const dt = Math.max(0.02, Math.min((now - p.lastStateAt) / 1000, 2));
    const maxDistance = this._playerSpeed(p) * dt * 1.8 + 40;
    const requested = Math.hypot(x - p.x, y - p.y);
    let fx = x, fy = y;
    if (requested > maxDistance && requested > 0) {
      const ratio = maxDistance / requested;
      fx = p.x + (x - p.x) * ratio; fy = p.y + (y - p.y) * ratio;
    }
    p.x = Math.max(0, Math.min(config.WORLD_WIDTH, fx));
    p.y = Math.max(0, Math.min(config.WORLD_HEIGHT, fy));
    p.direction = typeof data.direction === 'string' ? data.direction : p.direction;
    p.moving = data.moving === true;
    p.vx = Number.isFinite(Number(data.vx)) ? Number(data.vx) : 0;
    p.vy = Number.isFinite(Number(data.vy)) ? Number(data.vy) : 0;
    const ax = Number(data.aimDirX), ay = Number(data.aimDirY), len = Math.hypot(ax, ay);
    if (Number.isFinite(ax) && Number.isFinite(ay) && len > 0.0001) { p.aimDirX = ax / len; p.aimDirY = ay / len; }
    p.lastStateAt = now;
    socket.volatile.broadcast.emit('player:update', this._publicPlayerSnapshot(p));
  }

  _finishReloadIfDue(p) {
    if (!p.reloadEndAt || Date.now() < p.reloadEndAt) return false;
    const state = p.weapons[p.reloadWeaponId];
    const weapon = getWeapon(p.reloadWeaponId);
    if (state) {
      const needed = Math.max(0, weapon.magazineSize - state.ammo);
      const moved = Math.min(needed, state.reserve);
      state.ammo += moved; state.reserve -= moved;
    }
    p.reloadEndAt = 0; p.reloadWeaponId = null;
    return true;
  }

  _handleReload(socket, ack) {
    const p = this.players.get(socket.id);
    if (!p || !p.alive) return ack && ack({ success: false, error: 'invalid_player' });
    this._finishReloadIfDue(p);
    const state = p.weapons[p.activeWeaponId], weapon = getWeapon(p.activeWeaponId);
    if (!state || state.ammo >= weapon.magazineSize || state.reserve <= 0) return ack && ack({ success: false, error: 'reload_not_needed', self: this._selfSnapshot(p) });
    if (p.reloadEndAt > Date.now()) return ack && ack({ success: false, error: 'already_reloading', self: this._selfSnapshot(p) });
    const multiplier = Math.max(0.65, 1 - p.upgrades.reload * config.RELOAD_UPGRADE_PER_LEVEL);
    p.reloadEndAt = Date.now() + Math.round(weapon.reloadMs * multiplier);
    p.reloadWeaponId = p.activeWeaponId;
    const self = this._selfSnapshot(p);
    socket.broadcast.emit('player:reload', { playerId: p.id, weaponId: p.activeWeaponId, durationMs: self.reloadRemainingMs });
    ack && ack({ success: true, self });
  }

  _handleSwitch(socket, data, ack) {
    const p = this.players.get(socket.id);
    if (!p || !p.alive) return ack && ack({ success: false, error: 'invalid_player' });
    let slot = Number(data?.slot);
    if (!Number.isInteger(slot)) slot = (p.activeSlot + 1) % p.slots.length;
    if (slot < 0 || slot >= p.slots.length) return ack && ack({ success: false, error: 'invalid_slot' });
    p.activeSlot = slot; p.activeWeaponId = p.slots[slot]; p.reloadEndAt = 0; p.reloadWeaponId = null;
    this.io.emit('player:update', this._publicPlayerSnapshot(p));
    ack && ack({ success: true, self: this._selfSnapshot(p) });
  }

  _spreadDirection(baseX, baseY, spread) {
    const angle = Math.atan2(baseY, baseX) + (Math.random() - 0.5) * spread;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  }

  _handleShoot(socket, _data, ack) {
    const p = this.players.get(socket.id);
    if (!p || !p.alive) return ack && ack({ success: false, error: 'invalid_player' });
    this._finishReloadIfDue(p);
    if (p.reloadEndAt > Date.now()) return ack && ack({ success: false, error: 'reloading', self: this._selfSnapshot(p) });

    const weapon = getWeapon(p.activeWeaponId);
    const state = p.weapons[p.activeWeaponId];
    const now = Date.now();
    if (!state) return ack && ack({ success: false, error: 'weapon_missing' });
    if (now - p.lastShotAt < weapon.fireRateMs) return ack && ack({ success: false, error: 'fire_rate_exceeded', self: this._selfSnapshot(p) });
    if (state.ammo <= 0) return ack && ack({ success: false, error: 'no_ammo', self: this._selfSnapshot(p) });

    const len = Math.hypot(p.aimDirX, p.aimDirY);
    if (len < 0.0001) return ack && ack({ success: false, error: 'invalid_direction' });
    const baseX = p.aimDirX / len, baseY = p.aimDirY / len;
    const originX = p.x + config.PLAYER_COLLISION_RADIUS;
    const originY = p.y + config.PLAYER_COLLISION_RADIUS;
    p.lastShotAt = now; state.ammo--;

    const rays = [];
    let hitAny = false, anyHeadshot = false, killed = false;
    const killedIds = new Set();

    for (let pellet = 0; pellet < weapon.pellets; pellet++) {
      const dir = this._spreadDirection(baseX, baseY, weapon.spread);
      const wallDistance = worldMap.raycastDistanceToObstacle(originX, originY, dir.x, dir.y, weapon.range);
      const hit = this.zombieSystem.findHitZombie(originX, originY, dir.x, dir.y, weapon.range, wallDistance);
      let endDistance = wallDistance ?? weapon.range;
      let zombieId = null, headshot = false, zombieDead = false;

      if (hit) {
        endDistance = Math.max(0, Math.min(weapon.range, hit.distance));
        zombieId = hit.zombie.id; headshot = hit.part === 'head';
        const damageBoost = 1 + p.upgrades.damage * config.DAMAGE_UPGRADE_PER_LEVEL;
        const damage = Math.round(weapon.damage * damageBoost * (headshot ? weapon.headshotMultiplier : 1));
        const result = this.zombieSystem.applyDamage(zombieId, damage);
        zombieDead = result?.died === true;
        hitAny = true; anyHeadshot ||= headshot;
        if (result?.died && !killedIds.has(zombieId)) {
          killedIds.add(zombieId); killed = true; p.kills++;
          if (headshot) p.headshots++;
          p.money += (result.zombie.reward || config.KILL_REWARD) + (headshot ? config.HEADSHOT_BONUS : 0);
          const drop = this.lootSystem.maybeDrop(result.zombie);
          if (drop) this.io.emit('loot:spawn', { ...drop, createdAt: undefined });
          if (result.zombie.type === 'exploder') this._explodeZombie(result.zombie);
        }
      }

      rays.push({
        x: originX, y: originY, dirX: dir.x, dirY: dir.y,
        endX: originX + dir.x * endDistance, endY: originY + dir.y * endDistance,
        wallBlocked: !hit && wallDistance !== null,
        hit: !!hit, zombieId, headshot, zombieDead,
      });
    }

    const shot = { shotId: `${socket.id}:${now}`, playerId: p.id, weaponId: weapon.id, rays, timestamp: now };
    socket.broadcast.emit('player:shot', shot);
    const self = this._selfSnapshot(p);
    ack && ack({ success: true, hit: hitAny, headshot: anyHeadshot, zombieDead: killed, kills: p.kills, headshots: p.headshots, money: p.money, shot, self });
  }

  _explodeZombie(z) {
    const radius = ZombieSystem.TYPES.exploder.explosionRadius;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const px = p.x + config.PLAYER_COLLISION_RADIUS, py = p.y + config.PLAYER_COLLISION_RADIUS;
      const d = Math.hypot(px - z.x, py - z.y);
      if (d <= radius) {
        const scale = 1 - d / radius;
        this._applyZombieDamageToPlayer(p.id, Math.max(8, Math.round(28 * scale)));
      }
    }
    this.io.emit('zombie:explode', { zombieId: z.id, x: z.x, y: z.y, radius });
  }

  _handleZombieSpecial(evt) {
    if (evt.type === 'spit') {
      this._applyZombieDamageToPlayer(evt.player.id, evt.damage);
      this.io.emit('zombie:spit', { zombieId: evt.zombie.id, x: evt.zombie.x, y: evt.zombie.y, targetX: evt.player.x, targetY: evt.player.y });
    } else if (evt.type === 'explode') {
      this._explodeZombie(evt.zombie);
    }
  }

  _handleLootPickup(socket, data, ack) {
    const p = this.players.get(socket.id);
    if (!p) return ack && ack({ success: false, error: 'invalid_player' });
    const result = this.lootSystem.pickup(p, data?.lootId);
    if (!result.success) return ack && ack(result);
    this.io.emit('loot:removed', Number(result.item.id));
    const self = this._selfSnapshot(p);
    this._emitSelf(p);
    // Weapon loot can change the equipped weapon; broadcast so remote players
    // update the gun shown in their hands immediately.
    this.io.emit('player:update', this._publicPlayerSnapshot(p));
    ack && ack({ success: true, item: result.item, self });
  }

  _giveShopWeapon(p, weaponId) {
    if (!WEAPONS[weaponId] || weaponId === 'pistol') return false;
    if (p.weapons[weaponId]) {
      p.activeSlot = p.slots.indexOf(weaponId); p.activeWeaponId = weaponId; return true;
    }
    p.weapons[weaponId] = createWeaponState(weaponId);
    if (p.slots.length < config.MAX_WEAPON_SLOTS) {
      p.slots.push(weaponId); p.activeSlot = p.slots.length - 1;
    } else {
      const old = p.slots[p.activeSlot];
      if (old !== 'pistol') delete p.weapons[old];
      p.slots[p.activeSlot] = weaponId;
    }
    p.activeWeaponId = weaponId; return true;
  }

  _handleShopBuy(socket, data, ack) {
    const p = this.players.get(socket.id);
    if (!p) return ack && ack({ success: false, error: 'invalid_player' });
    if (this.roundSystem.state !== 'intermission') return ack && ack({ success: false, error: 'shop_closed' });
    const itemId = String(data?.itemId || '');
    let price = 0;

    if (WEAPONS[itemId] && WEAPONS[itemId].shopPrice > 0) {
      if (p.weapons[itemId]) return ack && ack({ success: false, error: 'already_owned', self: this._selfSnapshot(p) });
      price = WEAPONS[itemId].shopPrice;
      if (p.money < price) return ack && ack({ success: false, error: 'not_enough_money' });
      p.money -= price; this._giveShopWeapon(p, itemId);
    } else if (itemId === 'ammo') {
      price = SHOP.ammo;
      if (p.money < price) return ack && ack({ success: false, error: 'not_enough_money' });
      const w = getWeapon(p.activeWeaponId), s = p.weapons[p.activeWeaponId];
      p.money -= price; s.reserve += Math.max(w.magazineSize * 3, Math.round(w.startingReserve * 0.5));
    } else if (itemId === 'health') {
      price = SHOP.health;
      if (p.health >= p.maxHealth) return ack && ack({ success: false, error: 'health_full' });
      if (p.money < price) return ack && ack({ success: false, error: 'not_enough_money' });
      p.money -= price; p.health = p.maxHealth;
    } else if (itemId.startsWith('upgrade:')) {
      const key = itemId.split(':')[1];
      if (!['damage', 'reload', 'movement'].includes(key)) return ack && ack({ success: false, error: 'invalid_item' });
      const current = p.upgrades[key];
      if (current >= config.MAX_UPGRADE_LEVEL) return ack && ack({ success: false, error: 'max_level' });
      price = SHOP.upgrades[key][current + 1];
      if (p.money < price) return ack && ack({ success: false, error: 'not_enough_money' });
      p.money -= price; p.upgrades[key]++;
    } else {
      return ack && ack({ success: false, error: 'invalid_item' });
    }

    p.reloadEndAt = 0; p.reloadWeaponId = null;
    this.io.emit('player:update', this._publicPlayerSnapshot(p));
    const self = this._selfSnapshot(p); this._emitSelf(p);
    ack && ack({ success: true, self });
  }

  _handleRespawn(socket, ack) {
    const p = this.players.get(socket.id);
    if (!p) return ack && ack({ success: false, error: 'invalid_player' });
    if (!p.alive) {
      const spawn = this._pickPlayerSpawn();
      p.x = spawn.x; p.y = spawn.y; p.health = p.maxHealth; p.alive = true;
      p.lastStateAt = Date.now(); p.reloadEndAt = 0; p.reloadWeaponId = null;
    }
    ack && ack({ success: true, player: { x: p.x, y: p.y, health: p.health, maxHealth: p.maxHealth, alive: true }, self: this._selfSnapshot(p) });
    socket.broadcast.emit('player:update', this._publicPlayerSnapshot(p));
  }

  _handleLeave(socket) {
    const p = this.players.get(socket.id);
    if (!p) return;
    this.players.delete(socket.id);
    socket.broadcast.emit('player:left', p.id);
  }

  _applyZombieDamageToPlayer(playerId, amount) {
    const p = this.players.get(playerId);
    if (!p || !p.alive) return;
    p.health = Math.max(0, p.health - Math.max(0, Number(amount) || 0));
    const socket = this.io.sockets.sockets.get(p.socketId);
    if (socket) socket.emit('player:damage', { health: p.health, maxHealth: p.maxHealth, amount });
    if (p.health <= 0) { p.alive = false; p.reloadEndAt = 0; if (socket) socket.emit('player:death', {}); }
    this.io.emit('player:update', this._publicPlayerSnapshot(p));
  }

  _startLoop() { setInterval(() => this._tick(), config.SIMULATION_TICK_MS); }

  _tick() {
    const dt = config.SIMULATION_TICK_MS / 1000;
    const now = Date.now();

    for (const p of [...this.players.values()]) {
      if (this._finishReloadIfDue(p)) this._emitSelf(p);
      if (now - p.lastStateAt > config.OFFLINE_TIMEOUT_MS) {
        const s = this.io.sockets.sockets.get(p.socketId);
        if (!s || !s.connected) this.players.delete(p.id);
      }
    }

    const alivePlayers = [...this.players.values()].filter(p => p.alive).map(p => ({ id: p.id, x: p.x + config.PLAYER_COLLISION_RADIUS, y: p.y + config.PLAYER_COLLISION_RADIUS }));
    let roundChanged = false;
    this.roundSystem.tick(dt, this.players.size, () => { roundChanged = true; });

    if (this.roundSystem.state === 'running') {
      this.zombieSystem.tick(dt, alivePlayers,
        (playerId, amount) => this._applyZombieDamageToPlayer(playerId, amount),
        evt => this._handleZombieSpecial(evt));
    }

    this.lootSystem.tick();

    this._snapshotAccumulatorMs += config.SIMULATION_TICK_MS;
    if (this._snapshotAccumulatorMs >= config.SNAPSHOT_INTERVAL_MS) {
      this._snapshotAccumulatorMs = 0;
      this.io.volatile.emit('zombies:snapshot', this.zombieSystem.getSnapshot());
    }

    this._roundAccumulatorMs += config.SIMULATION_TICK_MS;
    if (roundChanged || this._roundAccumulatorMs >= config.ROUND_BROADCAST_INTERVAL_MS) {
      this._roundAccumulatorMs = 0;
      this.io.emit('round:state', this.roundSystem.getState());
    }

    this._lootAccumulatorMs += config.SIMULATION_TICK_MS;
    if (this._lootAccumulatorMs >= config.LOOT_BROADCAST_INTERVAL_MS) {
      this._lootAccumulatorMs = 0;
      this.io.volatile.emit('loot:snapshot', this.lootSystem.getSnapshot());
    }
  }
}

module.exports = GameServer;
