const NETWORK_CONFIG = {
  SOCKET_URL: 'https://zombie-survival-server.onrender.com',
  PLAYER_UPDATE_INTERVAL: 50,
  BACKGROUND_PLAYER_INTERVAL: 500,
  PING_INTERVAL: 3000,
  PING_SAMPLES: 5,
  SOCKET_TIMEOUT: 10000,
  NETWORK_DEBUG: false,
};

class NetworkManager {
  constructor() {
    this.playerId = null;
    this.playerName = null;
    this.socket = null;
    this.connected = false;
    this._socketJoined = false;
    this._socketEventsBound = false;
    this._joiningSocket = false;
    this._connectionLost = false;

    this.playerCount = 0;
    this.remotePlayers = new Map();
    this.pingMs = null;
    this._pingSamples = [];
    this._pingPending = false;

    this.localHealth = 100;
    this.localMaxHealth = 100;
    this.localAlive = true;
    this.localKills = 0;
    this.localHeadshots = 0;
    this.localMoney = 0;
    this.loadout = {
      slots:['pistol'], activeSlot:0, activeWeaponId:'pistol', ammo:12, reserve:72,
      weapons:{ pistol:{id:'pistol',ammo:12,reserve:72} },
      upgrades:{damage:0,reload:0,movement:0}, reloading:false, reloadRemainingMs:0, speed:220,
    };

    this.lastZombies = [];
    this.lastLoot = [];
    this.lastInteractions = [];
    this.round = { number:0, state:'waiting', countdownSeconds:0, zombiesTotal:0, zombiesAlive:0, zombiesRemaining:0, shopOpen:false };
    this.shopCatalog = null;

    this._localState = { x:0,y:0,direction:'down',moving:false,vx:0,vy:0,aimDirX:0,aimDirY:1 };
    this._playerTimer = null;
    this._pingTimer = null;

    this._callbacks = {
      onConnectionLost:null, onConnectionRestored:null, onServerFull:null,
      onPlayersUpdate:null, onZombiesUpdate:null, onRoundUpdate:null,
      onRemoteShot:null, onSelfUpdate:null, onLootUpdate:null,
      onZombieSpit:null, onZombieExplode:null, onRemoteReload:null,
      onInteractionUpdate:null,
    };

    document.addEventListener('visibilitychange', () => this._onVisibilityChange());
    window.addEventListener('pagehide', () => this._onUnload());
  }

  on(eventName, callback) { this._callbacks[eventName] = callback; }

  _getSocket() {
    if (this.socket) return this.socket;
    if (typeof io === 'undefined') throw new Error('socket_io_not_loaded');
    if (window.renderSocket && typeof window.renderSocket.emit === 'function') this.socket = window.renderSocket;
    else {
      this.socket = io(NETWORK_CONFIG.SOCKET_URL, {
        transports:['websocket','polling'], reconnection:true, reconnectionAttempts:Infinity,
        reconnectionDelay:1000, reconnectionDelayMax:5000, timeout:NETWORK_CONFIG.SOCKET_TIMEOUT
      });
      window.renderSocket = this.socket;
    }
    this._bindSocketEvents();
    return this.socket;
  }

  _bindSocketEvents() {
    if (!this.socket || this._socketEventsBound) return;
    this._socketEventsBound = true;

    this.socket.on('connect', () => {
      const restored = this._connectionLost;
      this.connected = true; this._connectionLost = false;
      if (restored) this._callbacks.onConnectionRestored?.();
      if (this.playerName && !this._socketJoined && !this._joiningSocket) this._rejoin();
    });

    this.socket.on('disconnect', () => {
      this.connected = false; this._socketJoined = false;
      if (this.playerName && !this._connectionLost) { this._connectionLost = true; this._callbacks.onConnectionLost?.(); }
    });

    this.socket.on('player:joined', data => this._mergeOnePlayer(data));
    this.socket.on('player:update', data => this._mergeOnePlayer(data));
    this.socket.on('player:left', id => { this.remotePlayers.delete(id); this._updatePlayerCount(); });
    this.socket.on('player:shot', shot => { if (shot && shot.playerId !== this.playerId) this._callbacks.onRemoteShot?.(shot); });
    this.socket.on('player:reload', data => { if (data?.playerId !== this.playerId) this._callbacks.onRemoteReload?.(data); });

    this.socket.on('player:self', self => this._applySelf(self));
    this.socket.on('player:damage', data => {
      if (data && typeof data.health === 'number') this.localHealth = data.health;
      if (data && typeof data.maxHealth === 'number') this.localMaxHealth = data.maxHealth;
    });
    this.socket.on('player:death', () => { this.localAlive = false; });

    this.socket.on('zombies:snapshot', zombies => {
      this.lastZombies = Array.isArray(zombies) ? zombies : [];
      this._callbacks.onZombiesUpdate?.(this.lastZombies);
    });
    this.socket.on('zombie:spit', data => this._callbacks.onZombieSpit?.(data));
    this.socket.on('zombie:explode', data => this._callbacks.onZombieExplode?.(data));

    this.socket.on('loot:snapshot', items => { this.lastLoot = Array.isArray(items) ? items : []; this._callbacks.onLootUpdate?.({ type:'snapshot', items:this.lastLoot }); });
    this.socket.on('loot:spawn', item => { if (item) { this.lastLoot = [...this.lastLoot.filter(x => Number(x.id)!==Number(item.id)), item]; this._callbacks.onLootUpdate?.({ type:'spawn', item }); } });
    this.socket.on('loot:removed', id => { this.lastLoot = this.lastLoot.filter(x => Number(x.id)!==Number(id)); this._callbacks.onLootUpdate?.({ type:'removed', id:Number(id) }); });

    this.socket.on('round:state', round => { if (round) { this.round = round; this._callbacks.onRoundUpdate?.(round); } });
    this.socket.on('world:interactions', items => { this.lastInteractions = Array.isArray(items)?items:[]; this._callbacks.onInteractionUpdate?.({type:'snapshot',items:this.lastInteractions}); });
    this.socket.on('world:interaction', item => { if(!item?.id)return; this.lastInteractions=[...this.lastInteractions.filter(x=>String(x.id)!==String(item.id)),item]; this._callbacks.onInteractionUpdate?.({type:'update',item}); });
  }

  _mergeOnePlayer(data) {
    if (!data || !data.id || data.id === this.playerId) return;
    const current = this.remotePlayers.get(data.id);
    if (current) current.applySnapshot(data); else this.remotePlayers.set(data.id, new RemotePlayer(data));
    this._updatePlayerCount();
  }

  _applySelf(self) {
    if (!self) return;
    if (typeof self.health === 'number') this.localHealth = self.health;
    if (typeof self.maxHealth === 'number') this.localMaxHealth = self.maxHealth;
    if (typeof self.alive === 'boolean') this.localAlive = self.alive;
    if (typeof self.kills === 'number') this.localKills = self.kills;
    if (typeof self.headshots === 'number') this.localHeadshots = self.headshots;
    if (typeof self.money === 'number') this.localMoney = self.money;
    this.loadout = { ...this.loadout, ...self, upgrades:{...this.loadout.upgrades,...(self.upgrades||{})} };
    this._callbacks.onSelfUpdate?.(this.loadout);
  }

  async _ensureSocketConnected() {
    const socket = this._getSocket();
    if (socket.connected) { this.connected = true; return; }
    await new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => { if(done)return; done=true; cleanup(); reject(new Error('socket_timeout')); }, NETWORK_CONFIG.SOCKET_TIMEOUT);
      const onConnect = () => { if(done)return; done=true; cleanup(); resolve(); };
      const cleanup = () => { clearTimeout(timer); socket.off('connect', onConnect); };
      socket.on('connect', onConnect); socket.connect();
    });
    this.connected = true;
  }

  async join(name) {
    name = String(name || 'Sobrevivente').trim().slice(0,16) || 'Sobrevivente';
    this.playerName = name;
    try { await this._ensureSocketConnected(); } catch (_) { throw new Error('render_unavailable'); }
    const result = await this._joinRender(name);
    if (!result?.success) { if (result?.error === 'server_full') this._callbacks.onServerFull?.(); throw new Error(result?.error || 'render_join_failed'); }
    this._consumeJoin(result);
    this._socketJoined = true;
    this._updatePlayerCount(); this._startLoops();
    return { player:{ ...result.player, health:this.localHealth, maxHealth:this.localMaxHealth, alive:this.localAlive, kills:this.localKills } };
  }

  _consumeJoin(result) {
    const p = result.player;
    this.playerId = p.id;
    this._localState = { x:Number(p.x),y:Number(p.y),direction:p.direction||'down',moving:false,vx:0,vy:0,aimDirX:p.aimDirX??0,aimDirY:p.aimDirY??1 };
    this._applySelf(result.self || p);
    this.remotePlayers.clear(); this._mergePlayers(result.players || []);
    this.lastZombies = Array.isArray(result.zombies) ? result.zombies : [];
    this.lastLoot = Array.isArray(result.loot) ? result.loot : [];
    if (result.round) this.round = result.round;
    if (result.shop) this.shopCatalog = result.shop;
    this.lastInteractions = Array.isArray(result.interactions) ? result.interactions : [];
  }

  async _joinRender(name) {
    this._joiningSocket = true;
    try { return await this._emitWithAck('player:join', { name }); }
    finally { this._joiningSocket = false; }
  }

  async _rejoin() {
    try {
      const r = await this._joinRender(this.playerName || 'Sobrevivente');
      if (!r?.success) return;
      this._consumeJoin(r); this._socketJoined = true; this._updatePlayerCount(); this._sendPlayerState();
      this._callbacks.onLootUpdate?.({type:'snapshot',items:this.lastLoot});
      this._callbacks.onRoundUpdate?.(this.round);
      this._callbacks.onInteractionUpdate?.({type:'snapshot',items:this.lastInteractions});
    } catch (_) {}
  }

  _emitWithAck(eventName, data, timeoutMs = NETWORK_CONFIG.SOCKET_TIMEOUT) {
    return new Promise((resolve,reject) => {
      if (!this.socket?.connected) return reject(new Error('socket_disconnected'));
      let done=false;
      const timer=setTimeout(()=>{if(done)return;done=true;reject(new Error('socket_ack_timeout'));},timeoutMs);
      this.socket.emit(eventName,data,response=>{if(done)return;done=true;clearTimeout(timer);resolve(response);});
    });
  }

  setLocalState(x,y,direction,moving=false,vx=0,vy=0,aimDirX=0,aimDirY=1) {
    if(Number.isFinite(x))this._localState.x=x; if(Number.isFinite(y))this._localState.y=y;
    this._localState.direction=direction||'down'; this._localState.moving=moving===true;
    this._localState.vx=Number.isFinite(vx)?vx:0; this._localState.vy=Number.isFinite(vy)?vy:0;
    this._localState.aimDirX=Number.isFinite(aimDirX)?aimDirX:0; this._localState.aimDirY=Number.isFinite(aimDirY)?aimDirY:1;
  }

  _sendPlayerState() {
    if(!this.socket?.connected||!this._socketJoined)return;
    const s=this._localState;
    this.socket.emit('player:state',{...s});
  }

  async shoot() {
    if(!this._socketJoined)return null;
    try { const r=await this._emitWithAck('player:shoot',{}); if(r?.self)this._applySelf(r.self); return r?.success?r:r; } catch(_){return null;}
  }
  async reload() {
    if(!this._socketJoined)return null;
    try { const r=await this._emitWithAck('player:reload',{}); if(r?.self)this._applySelf(r.self); return r; } catch(_){return null;}
  }
  async switchWeapon(slot=null) {
    if(!this._socketJoined)return null;
    try { const r=await this._emitWithAck('player:switch',slot===null?{}:{slot}); if(r?.self)this._applySelf(r.self); return r; } catch(_){return null;}
  }
  async pickupLoot(lootId) {
    if(!this._socketJoined)return null;
    try { const r=await this._emitWithAck('loot:pickup',{lootId}); if(r?.self)this._applySelf(r.self); return r; } catch(_){return null;}
  }
  async buy(itemId) {
    if(!this._socketJoined)return null;
    try { const r=await this._emitWithAck('shop:buy',{itemId}); if(r?.self)this._applySelf(r.self); return r; } catch(_){return null;}
  }
  async interact(id) {
    if(!this._socketJoined)return null;
    try { const r=await this._emitWithAck('world:interact',{id}); if(r?.self)this._applySelf(r.self); return r; } catch(_){return null;}
  }

  async respawn() {
    if(!this._socketJoined)return null;
    try {
      const r=await this._emitWithAck('player:respawn',{}); if(!r?.success)return null;
      if(r.self)this._applySelf(r.self);
      if(r.player){ if(Number.isFinite(Number(r.player.x)))this._localState.x=Number(r.player.x); if(Number.isFinite(Number(r.player.y)))this._localState.y=Number(r.player.y); }
      this._sendPlayerState(); return r.player||null;
    } catch(_){return null;}
  }

  _measurePing() {
    if(!this.socket?.connected||this._pingPending)return;
    this._pingPending=true; const start=performance.now();
    const timeout=setTimeout(()=>{this._pingPending=false;},5000);
    this.socket.emit('ping:check',()=>{clearTimeout(timeout);this._pingPending=false;this._recordPing(performance.now()-start);});
  }
  _recordPing(ms) { if(!Number.isFinite(ms))return; this._pingSamples.push(ms); if(this._pingSamples.length>NETWORK_CONFIG.PING_SAMPLES)this._pingSamples.shift(); this.pingMs=Math.round(this._pingSamples.reduce((a,b)=>a+b,0)/this._pingSamples.length); }

  _mergePlayers(players) {
    const seen=new Set();
    for(const data of players){if(!data?.id||data.id===this.playerId)continue;seen.add(data.id);const cur=this.remotePlayers.get(data.id);if(cur)cur.applySnapshot(data);else this.remotePlayers.set(data.id,new RemotePlayer(data));}
    for(const id of this.remotePlayers.keys())if(!seen.has(id))this.remotePlayers.delete(id);
  }
  _updatePlayerCount(){this.playerCount=this.remotePlayers.size+(this._socketJoined?1:0);this._callbacks.onPlayersUpdate?.(this.remotePlayers,this.playerCount,this.lastZombies);}

  _startLoops(){this._stopLoops();this._playerTimer=setInterval(()=>this._sendPlayerState(),this._currentPlayerInterval());this._pingTimer=setInterval(()=>this._measurePing(),NETWORK_CONFIG.PING_INTERVAL);this._sendPlayerState();this._measurePing();}
  _stopLoops(){if(this._playerTimer){clearInterval(this._playerTimer);this._playerTimer=null;}if(this._pingTimer){clearInterval(this._pingTimer);this._pingTimer=null;}}
  _currentPlayerInterval(){return document.hidden?NETWORK_CONFIG.BACKGROUND_PLAYER_INTERVAL:NETWORK_CONFIG.PLAYER_UPDATE_INTERVAL;}
  _onVisibilityChange(){if(this._socketJoined)this._startLoops();}

  async leave(){
    this._stopLoops(); if(this.socket?.connected&&this._socketJoined)this.socket.emit('player:leave');
    this._socketJoined=false;this.playerId=null;this.playerName=null;this.remotePlayers.clear();this.lastZombies=[];this.lastLoot=[];this.lastInteractions=[];this.playerCount=0;this.pingMs=null;
    this.localHealth=100;this.localMaxHealth=100;this.localAlive=true;this.localKills=0;this.localHeadshots=0;this.localMoney=0;
    this.round={number:0,state:'waiting',countdownSeconds:0,zombiesTotal:0,zombiesAlive:0,zombiesRemaining:0,shopOpen:false};
    this._pingSamples=[];this._connectionLost=false;
  }
  hasJoined(){return !!this._socketJoined;}
  _onUnload(){try{if(this.socket?.connected&&this._socketJoined)this.socket.emit('player:leave');}catch(_) {}}
}
