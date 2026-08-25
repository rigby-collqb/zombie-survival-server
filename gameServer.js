/**
 * gameServer.js
 * ------------------------------------------------------------
 * Autoridade única de: jogadores (posição/vida/kills), zumbis
 * (posição/IA/vida) e rounds. Um único game loop (setInterval a
 * 20Hz) simula tudo; snapshots de zumbis saem a 10Hz; estado de
 * round sai a 1Hz (+ imediatamente em qualquer transição).
 *
 * Eventos Socket.IO (cliente <-> servidor):
 *   player:join    (ack)      -> entra na partida
 *   player:state   (fire)     -> 20Hz, posição/direção/mira atuais
 *   player:shoot   (ack)      -> hitscan autoritativo da pistola
 *   player:respawn (ack)      -> respawn após morrer
 *   player:leave   (fire)     -> saída explícita
 *   ping:check     (ack)      -> medição de latência
 *
 *   player:joined  (broadcast, não-volatile) -> alguém entrou
 *   player:update  (broadcast, volatile)     -> posição/estado de alguém
 *   player:left    (broadcast, não-volatile) -> alguém saiu
 *   player:damage  (para o próprio jogador, não-volatile)
 *   player:death   (para o próprio jogador, não-volatile)
 *   player:shot    (broadcast, não-volatile) -> VFX do tiro remoto
 *
 *   zombies:snapshot (broadcast, volatile)     -> 10Hz
 *   round:state      (broadcast, não-volatile) -> 1Hz + em transições
 * ------------------------------------------------------------
 */

const config = require('./config');
const worldMap = require('./worldMap');
const ZombieSystem = require('./zombies');
const RoundSystem = require('./rounds');

class GameServer {
  constructor(io) {
    this.io = io;

    /** @type {Map<string, object>} chave = socket.id */
    this.players = new Map();

    this.zombieSystem = new ZombieSystem();
    this.roundSystem = new RoundSystem(this.zombieSystem);

    this._snapshotAccumulatorMs = 0;
    this._roundBroadcastAccumulatorMs = 0;

    this._bindSocketEvents();
    this._startLoop();
  }

  /* ============================================================ */
  /* SPAWN                                                          */
  /* ============================================================ */

  _pickPlayerSpawn() {
    for (let attempt = 0; attempt < 25; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * config.SPAWN_RADIUS;
      const x = Math.max(40, Math.min(config.WORLD_WIDTH - 40, config.SPAWN_CENTER_X + Math.cos(angle) * radius));
      const y = Math.max(40, Math.min(config.WORLD_HEIGHT - 40, config.SPAWN_CENTER_Y + Math.sin(angle) * radius));

      if (!worldMap.circleHitsAnyObstacle(x, y, config.PLAYER_COLLISION_RADIUS + 10)) {
        return { x, y };
      }
    }
    return { x: config.SPAWN_CENTER_X, y: config.SPAWN_CENTER_Y };
  }

  _publicPlayerSnapshot(p) {
    return {
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      direction: p.direction,
      moving: p.moving,
      vx: p.vx,
      vy: p.vy,
      aimDirX: p.aimDirX,
      aimDirY: p.aimDirY,
      health: p.health,
      alive: p.alive,
    };
  }

  /* ============================================================ */
  /* SOCKET EVENTS                                                  */
  /* ============================================================ */

  _bindSocketEvents() {
    this.io.on('connection', (socket) => {

      socket.on('player:join', (data, ack) => {
        try {
          this._handleJoin(socket, data, ack);
        } catch (err) {
          console.error('[player:join] erro:', err);
          ack && ack({ success: false, error: 'server_error' });
        }
      });

      socket.on('player:state', (data) => {
        try {
          this._handleState(socket, data);
        } catch (err) {
          console.error('[player:state] erro:', err);
        }
      });

      socket.on('player:shoot', (data, ack) => {
        try {
          this._handleShoot(socket, ack);
        } catch (err) {
          console.error('[player:shoot] erro:', err);
          ack && ack({ success: false, error: 'server_error' });
        }
      });

      socket.on('player:respawn', (_data, ack) => {
        try {
          this._handleRespawn(socket, ack);
        } catch (err) {
          console.error('[player:respawn] erro:', err);
          ack && ack({ success: false, error: 'server_error' });
        }
      });

      socket.on('player:leave', () => this._handleLeave(socket));
      socket.on('disconnect', () => this._handleLeave(socket));

      socket.on('ping:check', (ack) => { ack && ack(); });
    });
  }

  _handleJoin(socket, data, ack) {
    if (this.players.size >= config.MAX_PLAYERS) {
      ack && ack({ success: false, error: 'server_full' });
      return;
    }

    let name = String((data && data.name) || 'Sobrevivente').trim().slice(0, config.MAX_NAME_LENGTH);
    if (!name) name = 'Sobrevivente';

    const spawn = this._pickPlayerSpawn();

    const player = {
      id: socket.id,
      socketId: socket.id,
      name,
      x: spawn.x,
      y: spawn.y,
      direction: 'down',
      moving: false,
      vx: 0,
      vy: 0,
      aimDirX: 0,
      aimDirY: 1,
      health: 100,
      alive: true,
      kills: 0,
      lastShotAt: 0,
      lastStateAt: Date.now(),
    };

    this.players.set(socket.id, player);

    const others = [];
    for (const p of this.players.values()) {
      if (p.id !== player.id) others.push(this._publicPlayerSnapshot(p));
    }

    ack && ack({
      success: true,
      player: this._publicPlayerSnapshot(player),
      players: others,
      zombies: this.zombieSystem.getSnapshot(),
      round: this.roundSystem.getState(),
    });

    socket.broadcast.emit('player:joined', this._publicPlayerSnapshot(player));
  }

  _handleState(socket, data) {
    const player = this.players.get(socket.id);
    if (!player || !data) return;
    if (!player.alive) return; // item 34: jogador morto não se move

    const x = Number(data.x);
    const y = Number(data.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    // --- anti-teleporte, mesma ideia do antigo sync.php ---------------
    const now = Date.now();
    const dt = Math.max(0.02, Math.min((now - player.lastStateAt) / 1000, 2));
    const maxDistance = config.PLAYER_SPEED * dt * 1.8 + 40;
    const requested = Math.hypot(x - player.x, y - player.y);

    let finalX = x, finalY = y;
    if (requested > maxDistance && requested > 0) {
      const ratio = maxDistance / requested;
      finalX = player.x + (x - player.x) * ratio;
      finalY = player.y + (y - player.y) * ratio;
    }

    player.x = Math.max(0, Math.min(config.WORLD_WIDTH, finalX));
    player.y = Math.max(0, Math.min(config.WORLD_HEIGHT, finalY));
    player.direction = typeof data.direction === 'string' ? data.direction : player.direction;
    player.moving = data.moving === true;
    player.vx = Number.isFinite(Number(data.vx)) ? Number(data.vx) : 0;
    player.vy = Number.isFinite(Number(data.vy)) ? Number(data.vy) : 0;

    const aimX = Number(data.aimDirX);
    const aimY = Number(data.aimDirY);
    if (Number.isFinite(aimX) && Number.isFinite(aimY)) {
      const len = Math.hypot(aimX, aimY);
      if (len > 0.0001) {
        player.aimDirX = aimX / len;
        player.aimDirY = aimY / len;
      }
    }

    player.lastStateAt = now;

    socket.volatile.broadcast.emit('player:update', this._publicPlayerSnapshot(player));
  }

  _handleShoot(socket, ack) {
    const player = this.players.get(socket.id);
    if (!player) { ack && ack({ success: false, error: 'invalid_player' }); return; }
    if (!player.alive) { ack && ack({ success: false, error: 'player_dead' }); return; }

    const now = Date.now();
    if (now - player.lastShotAt < config.PISTOL_FIRE_RATE_MS) {
      ack && ack({ success: false, error: 'fire_rate_exceeded' });
      return;
    }

    const dirLen = Math.hypot(player.aimDirX, player.aimDirY);
    if (dirLen < 0.0001) { ack && ack({ success: false, error: 'invalid_direction' }); return; }
    const dirX = player.aimDirX / dirLen;
    const dirY = player.aimDirY / dirLen;

    player.lastShotAt = now;

    // Player.x/y representam o canto superior esquerdo do sprite no
    // cliente. O tiro nasce do centro para coincidir com o visual.
    const originX = player.x + config.PLAYER_COLLISION_RADIUS;
    const originY = player.y + config.PLAYER_COLLISION_RADIUS;

    const wallDistance = worldMap.raycastDistanceToObstacle(
      originX, originY, dirX, dirY, config.MAX_SHOOT_DISTANCE
    );
    const hitZombie = this.zombieSystem.findHitZombie(
      originX, originY, dirX, dirY, config.MAX_SHOOT_DISTANCE, wallDistance
    );

    let hit = false;
    let zombieId = null;
    let zombieHealth = null;
    let zombieDead = false;
    let endDistance = wallDistance ?? config.MAX_SHOOT_DISTANCE;

    if (hitZombie) {
      const projection = worldMap.pointDistanceToRay(
        hitZombie.x, hitZombie.y,
        originX, originY,
        dirX, dirY,
        config.MAX_SHOOT_DISTANCE
      );

      endDistance = Math.max(0, Math.min(config.MAX_SHOOT_DISTANCE, projection.distanceAlongRay));

      const result = this.zombieSystem.applyDamage(hitZombie.id, config.PISTOL_DAMAGE);
      hit = true;
      zombieId = hitZombie.id;
      zombieHealth = result ? result.health : 0;
      zombieDead = !!(result && result.died);

      if (zombieDead) player.kills++;
    }

    const shot = {
      shotId: `${socket.id}:${now}`,
      playerId: player.id,
      x: originX,
      y: originY,
      dirX,
      dirY,
      endX: originX + dirX * endDistance,
      endY: originY + dirY * endDistance,
      wallBlocked: !hit && wallDistance !== null,
      hit,
      zombieId,
      zombieDead,
      timestamp: now,
    };

    // Evento visual para os OUTROS clientes. O atirador já reproduz
    // o tiro imediatamente para não adicionar ping ao feedback local.
    socket.broadcast.emit('player:shot', shot);

    ack && ack({
      success: true,
      hit,
      wallBlocked: shot.wallBlocked,
      zombieId,
      zombieHealth,
      zombieDead,
      kills: player.kills,
      shot,
    });
  }

  _handleRespawn(socket, ack) {
    const player = this.players.get(socket.id);
    if (!player) { ack && ack({ success: false, error: 'invalid_player' }); return; }

    if (player.alive) {
      ack && ack({ success: true, player: { x: player.x, y: player.y, health: player.health, alive: true } });
      return;
    }

    const spawn = this._pickPlayerSpawn();
    player.x = spawn.x;
    player.y = spawn.y;
    player.health = 100;
    player.alive = true;
    player.lastStateAt = Date.now();

    ack && ack({ success: true, player: { x: player.x, y: player.y, health: player.health, alive: true } });

    socket.broadcast.emit('player:update', this._publicPlayerSnapshot(player));
  }

  _handleLeave(socket) {
    const player = this.players.get(socket.id);
    if (!player) return;

    this.players.delete(socket.id);
    socket.broadcast.emit('player:left', player.id);
  }

  /* ============================================================ */
  /* DANO DE ZUMBI -> JOGADOR (autoridade única de vida do player)  */
  /* ============================================================ */

  _applyZombieDamageToPlayer(playerId, amount) {
    const player = this.players.get(playerId);
    if (!player || !player.alive) return;

    player.health = Math.max(0, player.health - amount);

    const socket = this.io.sockets.sockets.get(player.socketId);
    if (socket) socket.emit('player:damage', { health: player.health, amount });

    if (player.health <= 0) {
      player.alive = false;
      if (socket) socket.emit('player:death', {});
    }

    this.io.emit('player:update', this._publicPlayerSnapshot(player));
  }

  /* ============================================================ */
  /* GAME LOOP                                                      */
  /* ============================================================ */

  _startLoop() {
    setInterval(() => this._tick(), config.SIMULATION_TICK_MS);
  }

  _tick() {
    const dt = config.SIMULATION_TICK_MS / 1000;

    const alivePlayers = [];
    for (const p of this.players.values()) {
      if (p.alive) alivePlayers.push({ id: p.id, x: p.x, y: p.y });
    }

    let roundChanged = false;
    this.roundSystem.tick(dt, this.players.size, () => { roundChanged = true; });

    if (this.roundSystem.state === 'running') {
      this.zombieSystem.tick(dt, alivePlayers, (playerId, amount) => {
        this._applyZombieDamageToPlayer(playerId, amount);
      });
    }

    this._snapshotAccumulatorMs += config.SIMULATION_TICK_MS;
    if (this._snapshotAccumulatorMs >= config.SNAPSHOT_INTERVAL_MS) {
      this._snapshotAccumulatorMs = 0;
      this.io.volatile.emit('zombies:snapshot', this.zombieSystem.getSnapshot());
    }

    this._roundBroadcastAccumulatorMs += config.SIMULATION_TICK_MS;
    if (roundChanged || this._roundBroadcastAccumulatorMs >= config.ROUND_BROADCAST_INTERVAL_MS) {
      this._roundBroadcastAccumulatorMs = 0;
      this.io.emit('round:state', this.roundSystem.getState());
    }
  }
}

module.exports = GameServer;
