const config = require('./config');
const worldMaps = require('./worldMap');
const ZombieSystem = require('./zombies');
const RoundSystem = require('./rounds');
const { LootSystem } = require('./loot');
const { WEAPONS, SHOP, getWeapon, getUpgradedWeapon, createWeaponState, rollMysteryWeapon } = require('./weapons');
const InteractionSystem = require('./interactions');
const StorySystem = require('./story');
const RandomEventSystem = require('./randomEvents');
const { ACHIEVEMENTS } = require('./achievements');

class RoomGame {
  constructor(io, room, accounts) {
    this.io = io;
    this.room = room;
    this.accounts = accounts;
    this.roomName = `game:${room.code}`;
    this.players = new Map();
    this.mode = room.mode === 'story' ? 'story' : 'survival';
    this.difficultyId = config.DIFFICULTIES?.[room.difficulty]?.id || 'normal';
    this.difficulty = config.DIFFICULTIES?.[this.difficultyId] || config.DIFFICULTIES.normal;
    this.storySystem = this.mode === 'story' ? new StorySystem() : null;
    if (this.storySystem) room.mapId = this.storySystem.chapter().mapId;
    this.worldMap = worldMaps.create(room.mapId || 'city');
    this.zombieSystem = new ZombieSystem(this.worldMap);
    this.zombieSystem.setDifficulty(this.difficultyId);
    this.roundSystem = new RoundSystem(this.zombieSystem);
    this.lootSystem = new LootSystem();
    this.lootSystem.setDropMultiplier(this.difficulty?.loot || 1);
    this.interactionSystem = new InteractionSystem(this.worldMap.id);
    this.eventSystem = new RandomEventSystem();
    this.paused = false;
    this.pauseStartedAt = 0;
    // A introdução de cada capítulo congela a simulação autoritativa.
    this.cinematicUntil = this.storySystem ? Date.now() + config.STORY_CINEMATIC_MS : 0;
    this.gameOver = false;
    this.startedAt = Date.now();
    this._chatAt = new Map();
    this.worldMap.setDynamicObstacles(this.interactionSystem.getBlockingObstacles());
    this._snapshotAccumulatorMs = 0;
    this._roundAccumulatorMs = 0;
    this._lootAccumulatorMs = 0;
    this._scoreAccumulatorMs = 0;
    this._lastRoundState = this.roundSystem.getState();
    this._loopTimer = null;
    this._startLoop();
  }

  _setWorldContext() {
    this.worldMap.setDynamicObstacles(this.interactionSystem.getBlockingObstacles());
  }

  _emitRoom(event, data) { this.io.to(this.roomName).emit(event, data); }

  stop() { if (this._loopTimer) { clearInterval(this._loopTimer); this._loopTimer = null; } }
  isEmpty() { return this.players.size === 0; }

  _feed(text, type='info', extra={}) {
    this._emitRoom('game:feed', { id:`${Date.now()}:${Math.random().toString(36).slice(2,7)}`, text, type, timestamp:Date.now(), ...extra });
  }

  _scoreboard() {
    return [...this.players.values()].filter(p=>p.connected!==false).map(p => ({
      id:p.id,name:p.name,score:p.score||0,kills:p.kills||0,headshots:p.headshots||0,revives:p.revives||0,
      alive:p.alive,downed:p.downed===true,ping:p.ping??null,skinId:p.skinId||'survivor_blue', weaponId:p.activeWeaponId||'pistol', weaponLevel:p.weaponLevels?.[p.activeWeaponId]||0,
      xpEarned:p.session?.xpEarned||0,coinsEarned:p.session?.coinsEarned||0,bosses:p.session?.bosses||0,
    })).sort((a,b)=>b.score-a.score||b.kills-a.kills||a.name.localeCompare(b.name));
  }

  _emitScoreboard() { this._emitRoom('scoreboard:update', this._scoreboard()); }

  _handlePingReport(socket, data) {
    const p=this.players.get(socket.id); if(!p)return;
    const ms=Number(data?.ping); if(Number.isFinite(ms))p.ping=Math.max(0,Math.min(999,Math.round(ms)));
  }

  refreshPlayerProfile(socket, account) {
    const p=this.players.get(socket.id); if(!p||!account)return;
    p.skinId=account.selectedSkin||p.skinId;
    p.weaponSkinId=account.selectedWeaponSkin||p.weaponSkinId;
    this._emitRoom('player:update',this._publicPlayerSnapshot(p));
    this._emitSelf(p);
  }

  _profileReward(p, delta) {
    if (!p?.accountId || !this.accounts) return;
    if(p.session){p.session.xpEarned=(p.session.xpEarned||0)+(Number(delta?.xp)||0);p.session.coinsEarned=(p.session.coinsEarned||0)+(Number(delta?.coins)||0);}
    const update = this.accounts.record(p.accountId, delta);
    if (!update) return;
    const socket = this.io.sockets.sockets.get(p.socketId);
    if (socket) socket.emit('profile:update', update);
    const account = update.account;
    if (account) { p.skinId = account.selectedSkin; p.weaponSkinId = account.selectedWeaponSkin; }
  }

  _applyRoundCompleteRewards(roundNumber) {
    const rewardScale=this.difficulty?.reward||1;
    const scoreGain = Math.round((config.SCORE_ROUND_SURVIVE_BASE + Math.max(0, roundNumber) * config.SCORE_ROUND_SURVIVE_PER_ROUND)*rewardScale);
    for (const p of this.players.values()) {
      if (!p.alive || p.connected===false) continue;
      p.score = (p.score || 0) + scoreGain;
      this._profileReward(p, { xp:Math.round((config.PROFILE_XP_ROUND_BASE + roundNumber * 3)*rewardScale), coins:Math.max(1,Math.round((config.PROFILE_COIN_ROUND_BASE + Math.floor(roundNumber/2))*rewardScale)), round:roundNumber });
      this._emitSelf(p);
    }
    this._feed(`ROUND ${roundNumber} CONCLUÍDO · +${scoreGain} PONTOS`, 'round', { round:roundNumber });
    this._emitScoreboard();
  }

  _pickPlayerSpawn() {
    const spawn = this.worldMap.getSpawn();
    const radius = Math.max(40, Number(spawn.radius) || config.SPAWN_RADIUS);
    const pr = config.PLAYER_COLLISION_RADIUS;
    const isSafe = (x,y) => !this.worldMap.circleHitsAnyObstacle(x + pr, y + pr, pr + 10);

    // x/y do Player são o canto superior esquerdo; colisão usa o centro.
    // Testar o canto como se fosse o centro fazia alguns spawns (Hospital,
    // principalmente) nascerem encostados/dentro de paredes.
    for (let attempt = 0; attempt < 90; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      const x = Math.max(24, Math.min(this.worldMap.width - pr * 2 - 24, Number(spawn.x) + Math.cos(a) * r));
      const y = Math.max(24, Math.min(this.worldMap.height - pr * 2 - 24, Number(spawn.y) + Math.sin(a) * r));
      if (isSafe(x,y)) return { x, y };
    }

    // Fallback determinístico em anéis: nunca devolve silenciosamente um
    // ponto conhecido como sólido só porque as tentativas aleatórias falharam.
    const baseX = Number(spawn.x) || config.SPAWN_CENTER_X;
    const baseY = Number(spawn.y) || config.SPAWN_CENTER_Y;
    for (let rr = 0; rr <= Math.max(radius, 420); rr += 28) {
      const steps = Math.max(8, Math.ceil((Math.PI * 2 * Math.max(rr, 28)) / 36));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = Math.max(24, Math.min(this.worldMap.width - pr * 2 - 24, baseX + Math.cos(a) * rr));
        const y = Math.max(24, Math.min(this.worldMap.height - pr * 2 - 24, baseY + Math.sin(a) * rr));
        if (isSafe(x,y)) return {x,y};
      }
    }
    // Último fallback central, apenas para evitar crash em mapa inválido.
    return { x: Math.max(24,Math.min(this.worldMap.width-pr*2-24,baseX)), y: Math.max(24,Math.min(this.worldMap.height-pr*2-24,baseY)) };
  }

  _playerSpeed(p) {
    const perk = p.perks?.fleet_feet ? 1.12 : 1;
    return config.PLAYER_SPEED * (1 + p.upgrades.movement * config.MOVEMENT_UPGRADE_PER_LEVEL) * perk;
  }

  _effectiveWeapon(p, weaponId = p.activeWeaponId) {
    return getUpgradedWeapon(weaponId, p.weaponLevels?.[weaponId] || 0, p.perks || {});
  }

  _connectedCount() { return [...this.players.values()].filter(p => p.connected !== false).length; }

  _awardAchievement(p, id) {
    if (!p?.accountId || !this.accounts || !ACHIEVEMENTS[id]) return null;
    const result = this.accounts.grantAchievement(p.accountId, id);
    if (!result) return null;
    const socket = this.io.sockets.sockets.get(p.socketId);
    socket?.emit('achievement:unlock', { achievement: result.achievement, account: result.account, recovery: result.recovery });
    socket?.emit('profile:update', result);
    this._feed(`${p.name} desbloqueou: ${result.achievement.name}`, 'achievement', { playerId:p.id, achievementId:id });
    return result;
  }

  _eventModifiers() {
    const id = this.eventSystem?.active?.id;
    if (id === 'bloodmoon') return { speed:1.34, damage:1.28, spawnBurst:1.25 };
    if (id === 'horde') return { speed:1.08, damage:1, spawnBurst:2.2 };
    return { speed:1, damage:1, spawnBurst:1 };
  }

  _storySnapshot() { return this.storySystem?.snapshot?.() || null; }


  _publicPlayerSnapshot(p) {
    return {
      id: p.id, name: p.name, x: p.x, y: p.y,
      direction: p.direction, moving: p.moving, vx: p.vx, vy: p.vy,
      aimDirX: p.aimDirX, aimDirY: p.aimDirY,
      health: p.health, maxHealth: p.maxHealth, alive: p.alive, downed: p.downed === true,
      weaponId: p.activeWeaponId, weaponLevel: p.weaponLevels?.[p.activeWeaponId] || 0,
      ping: p.ping ?? null, score: p.score || 0,
      skinId: p.skinId || 'survivor_blue', weaponSkinId: p.weaponSkinId || 'default',
      healthRatio: p.maxHealth ? p.health / p.maxHealth : 0,
    };
  }

  _selfSnapshot(p) {
    this._finishReloadIfDue(p);
    const active = p.weapons[p.activeWeaponId] || createWeaponState('pistol');
    return {
      id: p.id,
      health: p.health, maxHealth: p.maxHealth, alive: p.alive,
      kills: p.kills, headshots: p.headshots, revives: p.revives || 0, money: p.money, score:p.score||0,
      downed: p.downed === true, bleedOutEndAt: p.bleedOutEndAt || 0,
      bleedOutRemainingMs: p.downed ? Math.max(0, (p.bleedOutEndAt || 0) - Date.now()) : 0,
      slots: [...p.slots], activeSlot: p.activeSlot, activeWeaponId: p.activeWeaponId,
      ammo: active.ammo, reserve: active.reserve,
      weapons: Object.fromEntries(Object.entries(p.weapons).map(([id, s]) => [id, { id, ammo: s.ammo, reserve: s.reserve, level:p.weaponLevels?.[id]||0 }])),
      weaponLevels: { ...(p.weaponLevels || {}) },
      items: { ...(p.items || {medkit:0,grenade:0}) },
      perks: { ...(p.perks || {}) },
      upgrades: { ...p.upgrades },
      mode:this.mode, difficulty:this.difficultyId, story:this._storySnapshot(), event:this.eventSystem?.snapshot?.()||null,
      reloading: p.reloadEndAt > Date.now(),
      reloadRemainingMs: Math.max(0, p.reloadEndAt - Date.now()),
      speed: this._playerSpeed(p), skinId:p.skinId||'survivor_blue', weaponSkinId:p.weaponSkinId||'default',
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

  _safe(ack, fn) {
    try { fn(); } catch (err) {
      console.error('[socket] erro:', err);
      ack && ack({ success: false, error: 'server_error' });
    }
  }

  _handleJoin(socket, data, ack) {
    this._setWorldContext();
    const account = socket.data?.account || null;
    const now = Date.now();

    // Reconexão: preserva loadout, score, posição e progresso da partida
    // por alguns segundos, mas troca o ID/socket antigo pelo novo.
    let p = null;
    let reconnected = false;
    if (account?.id) {
      const existing = [...this.players.values()].find(x => x.accountId === account.id);
      if (existing && existing.connected !== false) return ack && ack({ success:false, error:'already_in_game' });
      if (existing) {
        const age = now - Number(existing.disconnectedAt || now);
        if (age <= config.OFFLINE_TIMEOUT_MS) {
          const oldId = existing.id;
          this.players.delete(oldId);
          p = existing;
          p.id = socket.id; p.socketId = socket.id; p.connected = true; p.disconnectedAt = 0;
          p.lastStateAt = now; p.ping = null;
          p.skinId = account.selectedSkin || p.skinId;
          p.weaponSkinId = account.selectedWeaponSkin || p.weaponSkinId;
          this.players.set(p.id, p);
          reconnected = true;
        } else this.players.delete(existing.id);
      }
    }

    if (!p) {
      const connectedCount=[...this.players.values()].filter(x=>x.connected!==false).length;
      if (connectedCount >= config.MAX_PLAYERS) return ack && ack({ success: false, error: 'server_full' });
      const name = account?.name || String(data?.name || 'Sobrevivente').trim().slice(0, config.MAX_NAME_LENGTH) || 'Sobrevivente';
      const spawn = this._pickPlayerSpawn();
      const pistol = createWeaponState('pistol');
      p = {
        id: socket.id, socketId: socket.id, accountId:account?.id||null, name,
        x: spawn.x, y: spawn.y, direction: 'down', moving: false, vx: 0, vy: 0,
        aimDirX: 0, aimDirY: 1,
        health: 100, maxHealth: 100, alive: true, downed: false, invulnerableUntil:0,
        bleedOutEndAt: 0, reviveBy: null, reviveStartedAt: 0,
        kills: 0, headshots: 0, revives: 0, money: 0, score:0, ping:null,
        skinId:account?.selectedSkin||'survivor_blue', weaponSkinId:account?.selectedWeaponSkin||'default',
        weapons: { pistol }, slots: ['pistol'], activeSlot: 0, activeWeaponId: 'pistol',
        weaponLevels:{pistol:0}, items:{medkit:1,grenade:0}, perks:{},
        upgrades: { damage: 0, reload: 0, movement: 0 },
        lastShotAt: 0, reloadEndAt: 0, reloadWeaponId: null,
        lastChatAt:0, session:{shots:0,hits:0,bosses:0,weaponKills:{},xpEarned:0,coinsEarned:0,startedAt:now},
        lastStateAt: now, connected:true, disconnectedAt:0,
      };
      this.players.set(socket.id, p);
    }

    const others = [...this.players.values()].filter(o => o.id !== p.id && o.connected!==false).map(o => this._publicPlayerSnapshot(o));
    ack && ack({
      success: true,
      player: this._publicPlayerSnapshot(p),
      self: this._selfSnapshot(p),
      players: others,
      zombies: this.zombieSystem.getSnapshot(),
      loot: this.lootSystem.getSnapshot(),
      round: this.roundSystem.getState(),
      shop: this._shopCatalog(),
      interactions: this.interactionSystem.getSnapshot(),
      room:{ code:this.room.code, mapId:this.room.mapId, hostId:this.room.hostSocketId, mode:this.mode, difficulty:this.difficultyId },
      mode:this.mode, difficulty:this.difficultyId, story:this._storySnapshot(), event:this.eventSystem.snapshot(), paused:this.paused,
      scoreboard:this._scoreboard(),
    });
    socket.to(this.roomName).emit('player:joined', this._publicPlayerSnapshot(p));
    if(!p._matchRecorded && p.accountId){p._matchRecorded=true;this._profileReward(p,{matches:1});}
    this._feed(reconnected ? `${p.name} reconectou` : `${p.name} entrou na partida`, 'join', {playerId:p.id});
    this._emitScoreboard();
  }

  _handleState(socket, data) {
    this._setWorldContext();
    const p = this.players.get(socket.id);
    if (!p || !data || !p.alive || p.downed) return;
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
    fx = Math.max(0, Math.min(config.WORLD_WIDTH - config.PLAYER_COLLISION_RADIUS * 2, fx));
    fy = Math.max(0, Math.min(config.WORLD_HEIGHT - config.PLAYER_COLLISION_RADIUS * 2, fy));
    const oldCx = p.x + config.PLAYER_COLLISION_RADIUS;
    const oldCy = p.y + config.PLAYER_COLLISION_RADIUS;
    const targetCx = fx + config.PLAYER_COLLISION_RADIUS;
    const targetCy = fy + config.PLAYER_COLLISION_RADIUS;
    const resolved = this.worldMap.resolveCircleMovement(oldCx, oldCy, targetCx, targetCy, config.PLAYER_COLLISION_RADIUS);
    p.x = resolved.x - config.PLAYER_COLLISION_RADIUS;
    p.y = resolved.y - config.PLAYER_COLLISION_RADIUS;
    p.direction = typeof data.direction === 'string' ? data.direction : p.direction;
    p.moving = data.moving === true;
    p.vx = Number.isFinite(Number(data.vx)) ? Number(data.vx) : 0;
    p.vy = Number.isFinite(Number(data.vy)) ? Number(data.vy) : 0;
    const ax = Number(data.aimDirX), ay = Number(data.aimDirY), len = Math.hypot(ax, ay);
    if (Number.isFinite(ax) && Number.isFinite(ay) && len > 0.0001) { p.aimDirX = ax / len; p.aimDirY = ay / len; }
    p.lastStateAt = now;
    socket.to(this.roomName).volatile.emit('player:update', this._publicPlayerSnapshot(p));
  }

  _finishReloadIfDue(p) {
    if (!p.reloadEndAt || Date.now() < p.reloadEndAt) return false;
    const state = p.weapons[p.reloadWeaponId];
    const weapon = this._effectiveWeapon(p, p.reloadWeaponId);
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
    if (!p || !p.alive || p.downed) return ack && ack({ success: false, error: 'invalid_player' });
    this._finishReloadIfDue(p);
    const state = p.weapons[p.activeWeaponId], weapon = this._effectiveWeapon(p);
    if (!state || state.ammo >= weapon.magazineSize || state.reserve <= 0) return ack && ack({ success: false, error: 'reload_not_needed', self: this._selfSnapshot(p) });
    if (p.reloadEndAt > Date.now()) return ack && ack({ success: false, error: 'already_reloading', self: this._selfSnapshot(p) });
    const perkMult = p.perks?.quick_hands ? 0.72 : 1;
    const multiplier = Math.max(0.50, (1 - p.upgrades.reload * config.RELOAD_UPGRADE_PER_LEVEL) * perkMult);
    p.reloadEndAt = Date.now() + Math.round(weapon.reloadMs * multiplier);
    p.reloadWeaponId = p.activeWeaponId;
    const self = this._selfSnapshot(p);
    socket.to(this.roomName).emit('player:reload', { playerId: p.id, weaponId: p.activeWeaponId, durationMs: self.reloadRemainingMs });
    ack && ack({ success: true, self });
  }

  _handleSwitch(socket, data, ack) {
    const p = this.players.get(socket.id);
    if (!p || !p.alive || p.downed) return ack && ack({ success: false, error: 'invalid_player' });
    let slot = Number(data?.slot);
    if (!Number.isInteger(slot)) slot = (p.activeSlot + 1) % p.slots.length;
    if (slot < 0 || slot >= p.slots.length) return ack && ack({ success: false, error: 'invalid_slot' });
    p.activeSlot = slot; p.activeWeaponId = p.slots[slot]; p.reloadEndAt = 0; p.reloadWeaponId = null;
    this._emitRoom('player:update', this._publicPlayerSnapshot(p));
    ack && ack({ success: true, self: this._selfSnapshot(p) });
  }

  _spreadDirection(baseX, baseY, spread) {
    const angle = Math.atan2(baseY, baseX) + (Math.random() - 0.5) * spread;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  }

  _handleShoot(socket, _data, ack) {
    this._setWorldContext();
    const p = this.players.get(socket.id);
    if (!p || !p.alive || p.downed) return ack && ack({ success:false, error:'invalid_player' });
    if (this.paused) return ack && ack({ success:false, error:'game_paused' });
    this._finishReloadIfDue(p);
    if (p.reloadEndAt > Date.now()) return ack && ack({ success:false, error:'reloading', self:this._selfSnapshot(p) });

    const weapon = this._effectiveWeapon(p);
    if(weapon.id==='arcgun')this._awardAchievement(p,'arsenal_master');
    const state = p.weapons[p.activeWeaponId];
    const now = Date.now();
    if (!state) return ack && ack({ success:false, error:'weapon_missing' });
    if (now - p.lastShotAt < weapon.fireRateMs) return ack && ack({ success:false, error:'fire_rate_exceeded', self:this._selfSnapshot(p) });
    if (weapon.usesAmmo !== false && state.ammo <= 0) return ack && ack({ success:false, error:'no_ammo', self:this._selfSnapshot(p) });

    const len = Math.hypot(p.aimDirX, p.aimDirY);
    if (len < .0001) return ack && ack({success:false,error:'invalid_direction'});
    const baseX=p.aimDirX/len, baseY=p.aimDirY/len;
    const originX=p.x+config.PLAYER_COLLISION_RADIUS, originY=p.y+config.PLAYER_COLLISION_RADIUS;
    p.lastShotAt=now;
    const lucky = p.perks?.lucky_chamber && Math.random() < .18;
    if (weapon.usesAmmo !== false && !lucky) state.ammo--;
    p.session.shots=(p.session.shots||0)+1;

    const rays=[]; let hitAny=false, anyHeadshot=false, killed=false, headshotAwarded=false;
    const killedIds=new Set();
    const pellets=Math.max(1,weapon.pellets||1);

    for(let pellet=0;pellet<pellets;pellet++){
      const dir=this._spreadDirection(baseX,baseY,weapon.spread||0);
      const wallDistance=this.worldMap.raycastDistanceToObstacle(originX,originY,dir.x,dir.y,weapon.range);
      const hit=this.zombieSystem.findHitZombie(originX,originY,dir.x,dir.y,weapon.range,wallDistance);
      let endDistance=wallDistance??weapon.range,zombieId=null,headshot=false,zombieDead=false;
      if(hit){
        endDistance=Math.max(0,Math.min(weapon.range,hit.distance)); zombieId=hit.zombie.id; headshot=hit.part==='head';
        const damageBoost=1+p.upgrades.damage*config.DAMAGE_UPGRADE_PER_LEVEL;
        let damage=Math.round(weapon.damage*damageBoost*(headshot?weapon.headshotMultiplier:1));
        if(weapon.effect==='flame') damage=Math.round(damage*.82 + 4);
        const result=this.zombieSystem.applyDamage(zombieId,damage);
        zombieDead=result?.died===true; hitAny=true; anyHeadshot ||= headshot; p.session.hits=(p.session.hits||0)+1;

        if(headshot&&!headshotAwarded){
          headshotAwarded=true;p.headshots++;p.score=(p.score||0)+config.SCORE_HEADSHOT;
          this._profileReward(p,{xp:config.PROFILE_XP_HEADSHOT,headshots:1,hits:1,shots:0});
        }
        if(result?.died&&!killedIds.has(zombieId)){
          killedIds.add(zombieId);killed=true;p.kills++;p.score=(p.score||0)+config.SCORE_KILL;
          const rewardScale=this.difficulty?.reward||1;
          p.money+=Math.round(((result.zombie.reward||config.KILL_REWARD)+(headshot?config.HEADSHOT_BONUS:0))*rewardScale);
          p.session.weaponKills[p.activeWeaponId]=(p.session.weaponKills[p.activeWeaponId]||0)+1;
          const delta={xp:config.PROFILE_XP_KILL,coins:Math.max(1,Math.round(config.PROFILE_COIN_KILL*rewardScale)),kills:1,weaponKill:p.activeWeaponId};
          if(result.zombie.type==='boss'){delta.bossesKilled=1;p.session.bosses=(p.session.bosses||0)+1;}
          this._profileReward(p,delta);
          this._awardAchievement(p,'first_blood');
          if(result.zombie.type==='boss'){
            const acc=this.accounts?.get?.(p.accountId);if((acc?.stats?.bossesKilled||0)>=10)this._awardAchievement(p,'boss_hunter');
          }
          const typeName={normal:'Zumbi',runner:'Corredor',tank:'Tanque',exploder:'Explosivo',spitter:'Cuspidor',boss:'BOSS'}[result.zombie.type]||'Zumbi';
          this._feed(headshot?`${p.name} eliminou ${typeName} · HEADSHOT`:`${p.name} eliminou ${typeName}`,headshot?'headshot':'kill',{playerId:p.id,zombieType:result.zombie.type});
          const drop=this.lootSystem.maybeDrop(result.zombie);if(drop)this._emitRoom('loot:spawn',{...drop,createdAt:undefined});
          if(result.zombie.type==='exploder')this._explodeZombie(result.zombie);
        }
      }
      rays.push({x:originX,y:originY,dirX:dir.x,dirY:dir.y,endX:originX+dir.x*endDistance,endY:originY+dir.y*endDistance,wallBlocked:!hit&&wallDistance!==null,hit:!!hit,zombieId,headshot,zombieDead});
    }

    if(hitAny&&!headshotAwarded)this._profileReward(p,{hits:1});
    this._profileReward(p,{shots:1});
    const shot={shotId:`${socket.id}:${now}`,playerId:p.id,weaponId:weapon.id,weaponLevel:weapon.upgradeLevel||0,effect:weapon.effect||null,rays,timestamp:now,lucky};
    socket.to(this.roomName).emit('player:shot',shot);
    if(killed||headshotAwarded)this._emitScoreboard();
    const self=this._selfSnapshot(p);
    ack&&ack({success:true,hit:hitAny,headshot:anyHeadshot,zombieDead:killed,lucky,kills:p.kills,headshots:p.headshots,money:p.money,score:p.score||0,shot,self});
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
    this._emitRoom('zombie:explode', { zombieId: z.id, x: z.x, y: z.y, radius });
  }

  _handleZombieSpecial(evt) {
    if (evt.type === 'spit') {
      this._applyZombieDamageToPlayer(evt.player.id, evt.damage);
      this._emitRoom('zombie:spit', { zombieId: evt.zombie.id, x: evt.zombie.x, y: evt.zombie.y, targetX: evt.player.x, targetY: evt.player.y });
    } else if (evt.type === 'explode') {
      this._explodeZombie(evt.zombie);
    }
  }

  _handleLootPickup(socket, data, ack) {
    const p = this.players.get(socket.id);
    if (!p || !p.alive || p.downed) return ack && ack({ success: false, error: 'invalid_player' });
    const result = this.lootSystem.pickup(p, data?.lootId);
    if (!result.success) return ack && ack(result);
    this._emitRoom('loot:removed', Number(result.item.id));
    const self = this._selfSnapshot(p);
    this._emitSelf(p);
    // Weapon loot can change the equipped weapon; broadcast so remote players
    // update the gun shown in their hands immediately.
    this._emitRoom('player:update', this._publicPlayerSnapshot(p));
    ack && ack({ success: true, item: result.item, self });
  }

  _giveShopWeapon(p, weaponId) {
    if (!WEAPONS[weaponId] || weaponId === 'pistol') return false;
    if (p.weapons[weaponId]) {
      p.activeSlot = p.slots.indexOf(weaponId); p.activeWeaponId = weaponId; return true;
    }
    p.weapons[weaponId] = createWeaponState(weaponId);
    p.weaponLevels = p.weaponLevels || {}; if (p.weaponLevels[weaponId] == null) p.weaponLevels[weaponId] = 0;
    if (p.slots.length < config.MAX_WEAPON_SLOTS) {
      p.slots.push(weaponId); p.activeSlot = p.slots.length - 1;
    } else {
      const old = p.slots[p.activeSlot];
      if (old !== 'pistol') { delete p.weapons[old]; delete p.weaponLevels[old]; }
      p.slots[p.activeSlot] = weaponId;
    }
    p.activeWeaponId = weaponId; return true;
  }

  _handleShopBuy(socket, data, ack) {
    const p = this.players.get(socket.id);
    if (!p || !p.alive || p.downed) return ack && ack({ success: false, error: 'invalid_player' });
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
      const w = this._effectiveWeapon(p), s = p.weapons[p.activeWeaponId];
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
    this._emitRoom('player:update', this._publicPlayerSnapshot(p));
    const self = this._selfSnapshot(p); this._emitSelf(p);
    ack && ack({ success: true, self });
  }

  _handleWorldInteract(socket, data, ack) {
    this._setWorldContext();
    const p=this.players.get(socket.id);
    if(!p||!p.alive||p.downed)return ack&&ack({success:false,error:'invalid_player'});
    const id=String(data?.id||''), item=this.interactionSystem.get(id);
    if(this.storySystem){const gate=this.storySystem.canInteract(id);if(!gate.allowed)return ack&&ack({success:false,error:gate.error||'story_locked',missingId:gate.missingId,missingLabel:gate.missingLabel,self:this._selfSnapshot(p),story:this._storySnapshot()});}
    const result=this.interactionSystem.interact(p,id);
    if(!result.success)return ack&&ack({...result,self:this._selfSnapshot(p)});
    let reward=result.reward||null;

    if(result.special&&item){
      if(item.type==='perk_machine'){
        const perkId=item.perkId, cost=config.PERK_COSTS?.[perkId]??item.cost??900;
        p.perks=p.perks||{};
        if(p.perks[perkId])return ack&&ack({success:false,error:'perk_owned',self:this._selfSnapshot(p)});
        if(Object.keys(p.perks).length>=config.MAX_PERKS)return ack&&ack({success:false,error:'perk_limit',self:this._selfSnapshot(p)});
        if(p.money<cost)return ack&&ack({success:false,error:'not_enough_money',self:this._selfSnapshot(p)});
        p.money-=cost;p.perks[perkId]=true;
        if(perkId==='iron_heart'){const old=p.maxHealth;p.maxHealth=Math.max(p.maxHealth,135);p.health=Math.min(p.maxHealth,p.health+(p.maxHealth-old));}
        reward={kind:'perk',perkId,cost};
        this._feed(`${p.name} ativou ${item.label}`,'perk',{playerId:p.id,perkId});
        if(Object.keys(p.perks).length>=4)this._awardAchievement(p,'perk_collector');
      }else if(item.type==='mystery_box'){
        const cost=config.MYSTERY_BOX_COST;
        if(p.money<cost)return ack&&ack({success:false,error:'not_enough_money',self:this._selfSnapshot(p)});
        p.money-=cost;const weaponId=rollMysteryWeapon();this._giveShopWeapon(p,weaponId);
        const w=getWeapon(weaponId);reward={kind:'mystery',weaponId,name:w.name,rarity:w.rarity,cost};
        this._feed(`${p.name} tirou ${w.name} na Caixa do Acaso`,'mystery',{playerId:p.id,weaponId,rarity:w.rarity});
        if(w.rarity==='legendary')this._awardAchievement(p,'mystery_legendary');
      }else if(item.type==='pack_station'){
        const wid=p.activeWeaponId, level=p.weaponLevels?.[wid]||0;
        if(level>=2)return ack&&ack({success:false,error:'pack_max',self:this._selfSnapshot(p)});
        const next=level+1,cost=config.PACK_A_PUNCH_COSTS[next]||5000;
        if(p.money<cost)return ack&&ack({success:false,error:'not_enough_money',self:this._selfSnapshot(p)});
        p.money-=cost;p.weaponLevels[wid]=next;
        const upgraded=this._effectiveWeapon(p,wid),state=p.weapons[wid];
        state.ammo=Math.max(state.ammo,upgraded.magazineSize);state.reserve+=Math.round(upgraded.magazineSize*1.5);
        reward={kind:'pack',weaponId:wid,level:next,name:upgraded.displayName,cost};
        this._feed(`${p.name} evoluiu ${upgraded.displayName}`,'pack',{playerId:p.id,weaponId:wid,level:next});
        if(next>=2)this._awardAchievement(p,'pack_master');
      }
    }

    if(this.storySystem){
      // No último capítulo, baixar o Arquivo Éden também libera a arma experimental.
      if(id==='lab_terminal' && !p.weapons.arcgun){
        this._giveShopWeapon(p,'arcgun');
        const slot=p.slots.indexOf('arcgun'); if(slot>=0){p.activeSlot=slot;p.activeWeaponId='arcgun';}
        this._feed(`${p.name} recuperou a ARC-9 do Projeto Éden`,'story',{playerId:p.id,weaponId:'arcgun'});
        this._awardAchievement(p,'arsenal_master');
      }
      const changed=this.storySystem.onInteraction(id);
      if(changed){
        this._emitRoom('story:update',this._storySnapshot());
        this._feed(`OBJETIVO ATUALIZADO · ${item?.label||id}`,'story');
        this._maybeBeginStoryTransition();
      }
    }

    this.worldMap.setDynamicObstacles(this.interactionSystem.getBlockingObstacles());
    this._emitRoom('world:interaction',this.interactionSystem.getSnapshot().find(x=>x.id===id)||result.item);
    const self=this._selfSnapshot(p);this._emitSelf(p);this._emitRoom('player:update',this._publicPlayerSnapshot(p));
    ack&&ack({success:true,item:result.item,reward,self,story:this._storySnapshot()});
  }

  _handleUseItem(socket,data,ack){
    const p=this.players.get(socket.id);if(!p||!p.alive||p.downed)return ack?.({success:false,error:'invalid_player'});
    const itemId=String(data?.itemId||'');p.items=p.items||{medkit:0,grenade:0};
    if(itemId==='medkit'){
      if(p.items.medkit<=0)return ack?.({success:false,error:'no_medkit',self:this._selfSnapshot(p)});
      if(p.health>=p.maxHealth)return ack?.({success:false,error:'health_full',self:this._selfSnapshot(p)});
      p.items.medkit--;const amount=Math.min(config.MEDKIT_HEAL,p.maxHealth-p.health);p.health+=amount;
      this._emitRoom('player:item',{playerId:p.id,itemId:'medkit',x:p.x,y:p.y,amount});this._emitRoom('player:update',this._publicPlayerSnapshot(p));this._emitSelf(p);
      return ack?.({success:true,itemId,amount,self:this._selfSnapshot(p)});
    }
    if(itemId==='grenade'){
      if(p.items.grenade<=0)return ack?.({success:false,error:'no_grenade',self:this._selfSnapshot(p)});
      p.items.grenade--;const cx=p.x+config.PLAYER_COLLISION_RADIUS+p.aimDirX*config.GRENADE_THROW_DISTANCE,cy=p.y+config.PLAYER_COLLISION_RADIUS+p.aimDirY*config.GRENADE_THROW_DISTANCE;
      const hits=this.zombieSystem.damageInRadius(cx,cy,config.GRENADE_RADIUS,config.GRENADE_DAMAGE)||[];
      for(const r of hits){if(r?.died){p.kills++;p.score+=config.SCORE_KILL;p.money+=Math.round((r.zombie?.reward||config.KILL_REWARD)*(this.difficulty?.reward||1));this._profileReward(p,{kills:1,xp:config.PROFILE_XP_KILL,coins:config.PROFILE_COIN_KILL,weaponKill:'grenade'});}}
      this._emitRoom('grenade:explode',{playerId:p.id,x:cx,y:cy,radius:config.GRENADE_RADIUS});this._emitSelf(p);if(hits.length)this._emitScoreboard();
      return ack?.({success:true,itemId,hits:hits.length,self:this._selfSnapshot(p)});
    }
    ack?.({success:false,error:'invalid_item'});
  }

  _handleChat(socket,data,ack){
    const p=this.players.get(socket.id);if(!p)return ack?.({success:false,error:'invalid_player'});
    const now=Date.now();if(now-(p.lastChatAt||0)<config.CHAT_COOLDOWN_MS)return ack?.({success:false,error:'chat_cooldown'});
    const quick=String(data?.quick||'').toUpperCase();const quickMap={HELP:'SOCORRO!',AMMO:'PRECISO DE MUNIÇÃO!',ZOMBIE:'ZUMBI AQUI!',FOLLOW:'VEM COMIGO!'};
    let text=quickMap[quick]||String(data?.text||'').replace(/[<>]/g,'').trim().slice(0,100);
    if(!text)return ack?.({success:false,error:'empty_message'});p.lastChatAt=now;
    const msg={id:`chat:${now}:${p.id}`,playerId:p.id,name:p.name,text,quick:quick||null,timestamp:now};this._emitRoom('chat:message',msg);ack?.({success:true,message:msg});
  }

  _shiftTimers(ms){
    if(!ms)return;for(const p of this.players.values()){
      for(const k of ['reloadEndAt','bleedOutEndAt','invulnerableUntil','reviveStartedAt','lastShotAt'])if(p[k])p[k]+=ms;
      p.lastStateAt=Date.now();
    }
    this.zombieSystem.shiftTime(ms);this.lootSystem.shiftTime(ms);if(this.storySystem?.transitionAt)this.storySystem.transitionAt+=ms;if(this.cinematicUntil)this.cinematicUntil+=ms;
  }

  _handlePause(socket,data,ack){
    const p=this.players.get(socket.id);if(!p)return ack?.({success:false,error:'invalid_player'});
    if(!config.SINGLEPLAYER_PAUSE_ALLOWED||this._connectedCount()!==1)return ack?.({success:false,error:'multiplayer_cannot_pause',paused:false});
    const want=data?.paused===true;
    if(want&&!this.paused){this.paused=true;this.pauseStartedAt=Date.now();this._emitRoom('game:paused',{paused:true,playerId:p.id});}
    else if(!want&&this.paused){const elapsed=Math.max(0,Date.now()-this.pauseStartedAt);this._shiftTimers(elapsed);this.paused=false;this.pauseStartedAt=0;this._emitRoom('game:paused',{paused:false,elapsedMs:elapsed,playerId:p.id});}
    ack?.({success:true,paused:this.paused,singlePlayer:true});
  }

  _maybeBeginStoryTransition(){
    if(!this.storySystem||!this.storySystem.isChapterComplete()||this.storySystem.state!=='active')return;
    if(this.storySystem.beginTransition(config.STORY_CHAPTER_TRANSITION_MS)){
      const snap=this._storySnapshot();this._emitRoom('story:chapter:complete',snap);this._feed(`${snap.chapter.title} CONCLUÍDO`,'story');
    }
  }

  _switchStoryChapter(){
    const result=this.storySystem.advance();
    if(result.finished){
      for(const p of this.players.values())if(p.accountId){this._profileReward(p,{storyCompletions:1,storyProgress:5,xp:500,coins:75});this._awardAchievement(p,'story_complete');if(this.storySystem.intel.size>=StorySystem.CHAPTERS.length)this._awardAchievement(p,'truth_seeker');}
      this.gameOver=true;this._emitGameOver('story_complete');return;
    }
    this.room.mapId=result.chapter.mapId;this.worldMap=worldMaps.create(result.chapter.mapId);this.zombieSystem=new ZombieSystem(this.worldMap);this.zombieSystem.setDifficulty(this.difficultyId);this.roundSystem=new RoundSystem(this.zombieSystem);this.lootSystem=new LootSystem();this.lootSystem.setDropMultiplier(this.difficulty?.loot||1);this.interactionSystem=new InteractionSystem(this.worldMap.id);this.eventSystem.reset();this._setWorldContext();this._lastRoundState=this.roundSystem.getState();
    for(const p of this.players.values()){const sp=this._pickPlayerSpawn();p.x=sp.x;p.y=sp.y;p.health=p.maxHealth;p.alive=true;p.downed=false;p.lastStateAt=Date.now();}
    this.cinematicUntil=Date.now()+config.STORY_CINEMATIC_MS;
    for(const p of this.players.values()) if(p.accountId) this._profileReward(p,{storyProgress:this.storySystem.chapterIndex+1,xp:90,coins:12});
    const payload={mapId:this.room.mapId,story:this._storySnapshot(),round:this.roundSystem.getState(),interactions:this.interactionSystem.getSnapshot(),zombies:this.zombieSystem.getSnapshot(),loot:this.lootSystem.getSnapshot(),players:[...this.players.values()].map(p=>this._publicPlayerSnapshot(p)),cinematicUntil:this.cinematicUntil};
    this._emitRoom('story:chapter',payload);for(const p of this.players.values())this._emitSelf(p);
  }

  _emitGameOver(reason='defeat'){
    if(this._gameOverEmitted)return;this._gameOverEmitted=true;
    const rows=this._scoreboard(),mvp=rows[0]||null,duration=Math.max(0,Date.now()-this.startedAt);
    for(const p of this.players.values())if(p.accountId){const sec=Math.round(duration/1000);this._profileReward(p,{timePlayedSeconds:sec,mapPlayed:this.room.mapId,round:this.roundSystem.number||0});}
    this._emitRoom('game:over',{reason,mode:this.mode,difficulty:this.difficultyId,durationMs:duration,round:this.roundSystem.number||0,scoreboard:rows,mvp,story:this._storySnapshot()});
  }

  _distancePlayers(a, b) {
    const ax = a.x + config.PLAYER_COLLISION_RADIUS;
    const ay = a.y + config.PLAYER_COLLISION_RADIUS;
    const bx = b.x + config.PLAYER_COLLISION_RADIUS;
    const by = b.y + config.PLAYER_COLLISION_RADIUS;
    return Math.hypot(ax - bx, ay - by);
  }

  _handleReviveStart(socket, data, ack) {
    const reviver = this.players.get(socket.id);
    const target = this.players.get(String(data?.targetId || ''));
    if (!reviver || !reviver.alive || reviver.downed) return ack && ack({success:false,error:'invalid_reviver'});
    if (!target || !target.alive || !target.downed) return ack && ack({success:false,error:'invalid_target'});
    if (target.id === reviver.id) return ack && ack({success:false,error:'invalid_target'});
    if (this._distancePlayers(reviver, target) > config.REVIVE_RANGE) return ack && ack({success:false,error:'too_far'});
    if (target.reviveBy && target.reviveBy !== reviver.id) return ack && ack({success:false,error:'already_reviving'});

    target.reviveBy = reviver.id;
    target.reviveStartedAt = Date.now();
    const evt = { targetId:target.id, reviverId:reviver.id, startedAt:target.reviveStartedAt, durationMs:config.REVIVE_DURATION_MS };
    this._emitRoom('player:revive:start', evt);
    ack && ack({success:true, ...evt});
  }

  _cancelRevive(target, reason='cancelled') {
    if (!target?.reviveBy) return;
    const evt = {targetId:target.id, reviverId:target.reviveBy, reason};
    target.reviveBy = null;
    target.reviveStartedAt = 0;
    this._emitRoom('player:revive:cancel', evt);
  }

  _handleReviveCancel(socket, data, ack) {
    const target = this.players.get(String(data?.targetId || ''));
    if (!target || target.reviveBy !== socket.id) return ack && ack({success:false,error:'not_reviving'});
    this._cancelRevive(target, 'released');
    ack && ack({success:true});
  }

  _completeRevive(target, reviver) {
    if (!target || !reviver || !target.downed) return;
    target.downed = false;
    target.health = Math.max(1, Math.round(target.maxHealth * config.REVIVE_HEALTH_RATIO));
    target.invulnerableUntil = Date.now() + config.REVIVE_INVULNERABILITY_MS;
    target.bleedOutEndAt = 0;
    target.reviveBy = null;
    target.reviveStartedAt = 0;
    reviver.revives = (reviver.revives || 0) + 1;
    reviver.money += config.REVIVE_REWARD;
    reviver.score=(reviver.score||0)+config.SCORE_REVIVE;
    this._profileReward(reviver,{xp:config.PROFILE_XP_REVIVE,coins:config.PROFILE_COIN_REVIVE,revives:1});
    this._feed(`${reviver.name} reviveu ${target.name}`,'revive',{playerId:reviver.id,targetId:target.id});

    const evt = {playerId:target.id, reviverId:reviver.id, health:target.health, maxHealth:target.maxHealth, reward:config.REVIVE_REWARD, invulnerableMs:config.REVIVE_INVULNERABILITY_MS};
    this._emitRoom('player:revived', evt);
    this._emitRoom('player:update', this._publicPlayerSnapshot(target));
    this._emitRoom('player:update', this._publicPlayerSnapshot(reviver));
    this._emitSelf(target);
    this._emitSelf(reviver);
    this._emitScoreboard();
  }

  _downPlayer(p) {
    if (!p || p.downed || !p.alive) return;
    p.health = 0;
    p.downed = true;
    p.bleedOutEndAt = Date.now() + config.BLEEDOUT_MS;
    p.reviveBy = null;
    p.reviveStartedAt = 0;
    p.reloadEndAt = 0;
    p.reloadWeaponId = null;
    const evt = {playerId:p.id, bleedOutEndAt:p.bleedOutEndAt, bleedOutMs:config.BLEEDOUT_MS};
    this._emitRoom('player:downed', evt);
    this._emitRoom('player:update', this._publicPlayerSnapshot(p));
    this._emitSelf(p);
    this._feed(`${p.name} foi derrubado`,'downed',{playerId:p.id});
    this._emitScoreboard();
  }

  _killPlayer(p, reason='damage') {
    if (!p) return;
    if (p.reviveBy) this._cancelRevive(p, 'target_dead');

    const moneyBefore=Math.max(0,Number(p.money)||0);
    const scoreBefore=Math.max(0,Number(p.score)||0);
    const moneyLost=Math.min(moneyBefore,Math.floor(moneyBefore*config.DEATH_MONEY_LOSS_RATIO));
    const scoreLost=Math.min(scoreBefore,Math.floor(scoreBefore*config.DEATH_SCORE_LOSS_RATIO));
    p.money=moneyBefore-moneyLost;
    p.score=scoreBefore-scoreLost;

    // Morte total: perde armas compradas/lootadas e volta para a pistola básica.
    const pistol=createWeaponState('pistol');
    p.weapons={pistol};p.weaponLevels={pistol:0};p.slots=['pistol'];p.activeSlot=0;p.activeWeaponId='pistol';

    p.health = 0;
    p.alive = false;
    p.downed = false;
    p.invulnerableUntil = 0;
    p.bleedOutEndAt = 0;
    p.reviveBy = null;
    p.reviveStartedAt = 0;
    p.reloadEndAt = 0;
    p.reloadWeaponId = null;
    const socket = this.io.sockets.sockets.get(p.socketId);
    const penalty={moneyLost,scoreLost,weaponsReset:true,money:p.money,score:p.score};
    if (socket) socket.emit('player:death', {reason,penalty});
    this._emitRoom('player:update', this._publicPlayerSnapshot(p));
    this._emitSelf(p);
    this._feed(`${p.name} morreu · -$${moneyLost} · -${scoreLost} PTS`,'death',{playerId:p.id,reason,moneyLost,scoreLost});
    this._profileReward(p,{deaths:1});
    this._emitScoreboard();
  }

  _handleRespawn(socket, ack) {
    this._setWorldContext();
    const p = this.players.get(socket.id);
    if (!p) return ack && ack({ success: false, error: 'invalid_player' });
    if (this.gameOver) return ack && ack({success:false,error:'game_over'});
    if (p.downed) return ack && ack({ success:false, error:'still_downed', self:this._selfSnapshot(p) });
    if (!p.alive) {
      const spawn = this._pickPlayerSpawn();
      p.x = spawn.x; p.y = spawn.y; p.health = p.maxHealth; p.alive = true; p.downed = false; p.invulnerableUntil=Date.now()+500;
      p.bleedOutEndAt = 0; p.reviveBy = null; p.reviveStartedAt = 0;
      p.lastStateAt = Date.now(); p.reloadEndAt = 0; p.reloadWeaponId = null;
    }
    ack && ack({ success: true, player: { x: p.x, y: p.y, health: p.health, maxHealth: p.maxHealth, alive: true }, self: this._selfSnapshot(p) });
    socket.to(this.roomName).emit('player:update', this._publicPlayerSnapshot(p));
    this._emitScoreboard();
  }

  _handleLeave(socket, disconnected=false) {
    const p = this.players.get(socket.id);
    if (!p) return;
    for (const target of this.players.values()) {
      if (target.reviveBy === p.id) this._cancelRevive(target, 'reviver_left');
    }
    if (p.reviveBy) this._cancelRevive(p, 'target_left');
    socket.to(this.roomName).emit('player:left', p.id);
    if (disconnected) {
      p.connected=false; p.disconnectedAt=Date.now(); p.moving=false; p.vx=0; p.vy=0; p.ping=null;
      this._feed(`${p.name} perdeu a conexão`,'leave',{playerId:p.id});
    } else {
      this.players.delete(socket.id);
      this._feed(`${p.name} saiu da partida`,'leave',{playerId:p.id});
    }
    this._emitScoreboard();
  }

  _applyZombieDamageToPlayer(playerId, amount) {
    const p = this.players.get(playerId);
    if (!p || !p.alive || p.downed) return;
    if (Number(p.invulnerableUntil)||0 > Date.now()) return;
    p.health = Math.max(0, p.health - Math.max(0, Number(amount) || 0));
    const socket = this.io.sockets.sockets.get(p.socketId);
    if (socket) socket.emit('player:damage', { health: p.health, maxHealth: p.maxHealth, amount });
    if (p.health <= 0) {
      const hasTeammate = [...this.players.values()].some(o => o.id !== p.id && o.connected!==false && o.alive && !o.downed);
      if (hasTeammate) this._downPlayer(p);
      else this._killPlayer(p, 'damage');
      return;
    }
    this._emitRoom('player:update', this._publicPlayerSnapshot(p));
  }

  _startLoop() { this.stop(); this._loopTimer=setInterval(() => this._tick(), config.SIMULATION_TICK_MS); }

  _tick() {
    this._setWorldContext();
    const dt=config.SIMULATION_TICK_MS/1000, now=Date.now();

    // Pausa real em single-player: o relógio autoritativo inteiro congela.
    if(this.paused)return;
    if(this.gameOver)return;
    if(this.cinematicUntil>Date.now())return;

    for(const p of [...this.players.values()]){
      if(p.connected!==false&&this._finishReloadIfDue(p))this._emitSelf(p);
      if(p.connected===false&&now-Number(p.disconnectedAt||now)>config.OFFLINE_TIMEOUT_MS)this.players.delete(p.id);
    }

    for(const p of this.players.values()){
      if(!p.downed)continue;
      if(p.bleedOutEndAt&&now>=p.bleedOutEndAt){this._killPlayer(p,'bleedout');continue;}
      if(p.reviveBy){
        const reviver=this.players.get(p.reviveBy);
        if(!reviver||!reviver.alive||reviver.downed||this._distancePlayers(reviver,p)>config.REVIVE_RANGE)this._cancelRevive(p,'interrupted');
        else if(now-p.reviveStartedAt>=config.REVIVE_DURATION_MS)this._completeRevive(p,reviver);
      }
    }

    const connectedPlayers=[...this.players.values()].filter(p=>p.connected!==false);
    if(connectedPlayers.length&&connectedPlayers.every(p=>!p.alive&&!p.downed)){
      this.gameOver=true;this._emitGameOver('dominated');return;
    }
    const alivePlayers=connectedPlayers.filter(p=>p.alive&&!p.downed).map(p=>({id:p.id,x:p.x+config.PLAYER_COLLISION_RADIUS,y:p.y+config.PLAYER_COLLISION_RADIUS}));

    const previousRound=this._lastRoundState||this.roundSystem.getState();let roundChanged=false;
    this.roundSystem.tick(dt,connectedPlayers.length,()=>{roundChanged=true;});
    const currentRound=this.roundSystem.getState();

    if(roundChanged&&this.interactionSystem.onRoundState(currentRound)){
      this.worldMap.setDynamicObstacles(this.interactionSystem.getBlockingObstacles());
      this._emitRoom('world:interactions',this.interactionSystem.getSnapshot());
    }
    if(roundChanged){
      if(previousRound.state==='running'&&currentRound.state==='intermission'){
        this._applyRoundCompleteRewards(previousRound.number);
        if(this.storySystem){
          if(this.storySystem.onRoundComplete(previousRound.number))this._emitRoom('story:update',this._storySnapshot());
          this._maybeBeginStoryTransition();
        }
        for(const p of connectedPlayers){if(previousRound.number>=20)this._awardAchievement(p,'round_20');if(this.difficultyId==='nightmare'&&previousRound.number>=10)this._awardAchievement(p,'nightmare_10');}
      }
      if(currentRound.state==='running'&&previousRound.state!=='running'){
        if(currentRound.bossRound){this._emitRoom('boss:incoming',{round:currentRound.number,count:currentRound.bossCount||1});this._feed(`⚠ BOSS INCOMING · ROUND ${currentRound.number} ⚠`,'boss',{round:currentRound.number});}
        else this._feed(`ROUND ${currentRound.number} COMEÇOU`,'round',{round:currentRound.number});
      }
      this._lastRoundState=currentRound;
    }

    // Eventos aleatórios compartilhados e autoritativos.
    this.eventSystem.tick(dt,this.roundSystem.state==='running',evt=>{
      this.zombieSystem.setEventModifiers(this._eventModifiers());
      if(evt.id==='horde'){
        const extra=this.zombieSystem.addHordeQuota(Math.max(8,Math.min(18,6+Math.floor((this.roundSystem.number||1)*1.25))));
        this._feed(`HORDA · +${extra} INFECTADOS`,'event',{eventId:'horde',extra});
      }
      if(evt.id==='supply'){
        const anchor=alivePlayers[0]||this.worldMap.getSpawn();
        const x=Math.max(100,Math.min(this.worldMap.width-100,(anchor.x||2000)+120)),y=Math.max(100,Math.min(this.worldMap.height-100,(anchor.y||2000)+80));
        const drops=this.lootSystem.spawnSupplyDrop(x,y);for(const drop of drops)this._emitRoom('loot:spawn',drop);
        this._emitRoom('supply:drop',{x,y});
      }
      this._emitRoom('event:start',{...evt,event:this.eventSystem.snapshot()});this._feed(`⚠ ${evt.name} ⚠`,'event',{eventId:evt.id});
    },evt=>{this.zombieSystem.setEventModifiers({});this._emitRoom('event:end',{id:evt.id});for(const p of connectedPlayers)if(p.alive&&!p.downed)this._awardAchievement(p,'event_survivor');});

    if(this.roundSystem.state==='running'&&connectedPlayers.length>0){
      this.zombieSystem.tick(dt,alivePlayers,(playerId,amount)=>this._applyZombieDamageToPlayer(playerId,amount),evt=>this._handleZombieSpecial(evt));
    }
    this.lootSystem.tick();

    if(this.storySystem?.readyToAdvance()){
      this._switchStoryChapter();
      return;
    }

    this._snapshotAccumulatorMs+=config.SIMULATION_TICK_MS;
    if(this._snapshotAccumulatorMs>=config.SNAPSHOT_INTERVAL_MS){this._snapshotAccumulatorMs=0;this.io.to(this.roomName).volatile.emit('zombies:snapshot:compact',this.zombieSystem.getCompactSnapshot());}
    this._roundAccumulatorMs+=config.SIMULATION_TICK_MS;
    if(roundChanged||this._roundAccumulatorMs>=config.ROUND_BROADCAST_INTERVAL_MS){this._roundAccumulatorMs=0;this._emitRoom('round:state',currentRound);}
    this._scoreAccumulatorMs+=config.SIMULATION_TICK_MS;if(this._scoreAccumulatorMs>=1000){this._scoreAccumulatorMs=0;this._emitScoreboard();}
    this._lootAccumulatorMs+=config.SIMULATION_TICK_MS;if(this._lootAccumulatorMs>=config.LOOT_BROADCAST_INTERVAL_MS){this._lootAccumulatorMs=0;this.io.to(this.roomName).volatile.emit('loot:snapshot',this.lootSystem.getSnapshot());}
  }

}

module.exports = RoomGame;
