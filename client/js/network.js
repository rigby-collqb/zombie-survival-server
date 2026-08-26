const NETWORK_CONFIG = {
  SOCKET_URL:'https://zombie-survival-server.onrender.com',
  PLAYER_UPDATE_INTERVAL:50,
  BACKGROUND_PLAYER_INTERVAL:500,
  PING_INTERVAL:3000,
  PING_SAMPLES:5,
  SOCKET_TIMEOUT:10000,
  NETWORK_DEBUG:false,
};

class NetworkManager {
  constructor() {
    this.profile = window.__zsoProfile || new ProfileManager();
    this.account = this.profile.account || null;
    this.maps = [];
    this.lobby = null;
    this.roomCode = null;
    this.mapId = 'city';

    this.playerId=null;this.playerName=this.account?.name||null;
    this.socket=null;this.connected=false;this._socketJoined=false;this._socketEventsBound=false;this._joiningSocket=false;this._connectionLost=false;this._accountBootstrapPromise=null;
    this.playerCount=0;this.remotePlayers=new Map();this.pingMs=null;this._pingSamples=[];this._pingPending=false;

    this.localHealth=100;this.localMaxHealth=100;this.localAlive=true;this.localDowned=false;this.localBleedOutEndAt=0;
    this.localRevives=0;this.localKills=0;this.localHeadshots=0;this.localMoney=0;this.localScore=0;
    this.loadout={slots:['pistol'],activeSlot:0,activeWeaponId:'pistol',ammo:12,reserve:72,weapons:{pistol:{id:'pistol',ammo:12,reserve:72}},upgrades:{damage:0,reload:0,movement:0},reloading:false,reloadRemainingMs:0,speed:220,skinId:'survivor_blue',weaponSkinId:'default'};

    this.lastZombies=[];this.lastLoot=[];this.lastInteractions=[];
    this.round={number:0,state:'waiting',countdownSeconds:0,zombiesTotal:0,zombiesAlive:0,zombiesRemaining:0,shopOpen:false};
    this.shopCatalog=null;this.scoreboard=[];this.social={friendCode:'--------',friends:[],requests:[],outgoing:[]};this.leaderboard=[];this.pendingInvite=null;

    this._localState={x:0,y:0,direction:'down',moving:false,vx:0,vy:0,aimDirX:0,aimDirY:1};
    this._playerTimer=null;this._pingTimer=null;
    this._callbacks={
      onConnectionLost:null,onConnectionRestored:null,onServerFull:null,onPlayersUpdate:null,onZombiesUpdate:null,onRoundUpdate:null,
      onRemoteShot:null,onSelfUpdate:null,onLootUpdate:null,onZombieSpit:null,onZombieExplode:null,onRemoteReload:null,
      onInteractionUpdate:null,onPlayerDowned:null,onReviveStart:null,onReviveCancel:null,onPlayerRevived:null,
      onFeed:null,onScoreboard:null,onBossIncoming:null,onLobbyUpdate:null,onLobbyStarted:null,onProfileUpdate:null,onDeath:null,onSocialUpdate:null,onFriendInvite:null,onFriendInviteResult:null,onLeaderboard:null,
    };

    document.addEventListener('visibilitychange',()=>this._onVisibilityChange());
    window.addEventListener('pagehide',()=>this._onUnload());
  }

  on(eventName,callback){this._callbacks[eventName]=callback;}

  _getSocket(){
    if(this.socket)return this.socket;
    if(typeof io==='undefined')throw new Error('socket_io_not_loaded');
    if(window.renderSocket&&typeof window.renderSocket.emit==='function')this.socket=window.renderSocket;
    else{
      this.socket=io(NETWORK_CONFIG.SOCKET_URL,{transports:['websocket','polling'],reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:1000,reconnectionDelayMax:5000,timeout:NETWORK_CONFIG.SOCKET_TIMEOUT});
      window.renderSocket=this.socket;
    }
    this._bindSocketEvents();return this.socket;
  }

  _bindSocketEvents(){
    if(!this.socket||this._socketEventsBound)return;this._socketEventsBound=true;
    this.socket.on('connect',async()=>{
      const restored=this._connectionLost;this.connected=true;this._connectionLost=false;

      // Render Free pode acordar DEPOIS da primeira tentativa da home.
      // Autentica/reautentica a conta em TODO connect para que código de
      // amigo e ranking se recuperem sozinhos quando o servidor acordar.
      if(this.profile?.hasAccount?.()){
        try{await this.bootstrapAccount('');}catch(_){}
      }
      if(restored)this._callbacks.onConnectionRestored?.();

      if(this.playerName&&this.roomCode&&!this._socketJoined&&!this._joiningSocket){try{await this._rejoin();}catch(_){} }
      else if(restored&&this.roomCode){try{await this._resumeRoom();}catch(_){} }
    });
    this.socket.on('disconnect',()=>{this.connected=false;this._socketJoined=false;if((this.playerName||this.roomCode)&&!this._connectionLost){this._connectionLost=true;this._callbacks.onConnectionLost?.();}});

    this.socket.on('lobby:state',lobby=>{if(!lobby)return;this.lobby=lobby;this.roomCode=lobby.code||this.roomCode;this.mapId=lobby.mapId||this.mapId;this._callbacks.onLobbyUpdate?.(lobby);});
    this.socket.on('lobby:started',data=>{if(data?.code)this.roomCode=data.code;if(data?.mapId)this.mapId=data.mapId;this._callbacks.onLobbyStarted?.(data);});
    this.socket.on('profile:update',update=>this._applyProfileResult({success:true,...update}));
    this.socket.on('social:update',social=>{if(social){this.social=social;this._callbacks.onSocialUpdate?.(social);}});
    this.socket.on('social:invite',invite=>{this.pendingInvite=invite||null;this._callbacks.onFriendInvite?.(invite);});
    this.socket.on('social:invite:result',result=>this._callbacks.onFriendInviteResult?.(result));
    this.socket.on('leaderboard:update',rows=>{this.leaderboard=Array.isArray(rows)?rows:[];this._callbacks.onLeaderboard?.(this.leaderboard);});

    this.socket.on('player:joined',d=>this._mergeOnePlayer(d));
    this.socket.on('player:update',d=>this._mergeOnePlayer(d));
    this.socket.on('player:left',id=>{this.remotePlayers.delete(id);this._updatePlayerCount();});
    this.socket.on('player:shot',shot=>{if(shot&&shot.playerId!==this.playerId)this._callbacks.onRemoteShot?.(shot);});
    this.socket.on('player:reload',d=>{if(d?.playerId!==this.playerId)this._callbacks.onRemoteReload?.(d);});
    this.socket.on('player:self',self=>this._applySelf(self));
    this.socket.on('player:damage',d=>{if(typeof d?.health==='number')this.localHealth=d.health;if(typeof d?.maxHealth==='number')this.localMaxHealth=d.maxHealth;});
    this.socket.on('player:downed',d=>{if(d?.playerId===this.playerId){this.localDowned=true;this.localAlive=true;this.localHealth=0;this.localBleedOutEndAt=Number(d.bleedOutEndAt)||0;}this._callbacks.onPlayerDowned?.(d);});
    this.socket.on('player:revive:start',d=>this._callbacks.onReviveStart?.(d));
    this.socket.on('player:revive:cancel',d=>this._callbacks.onReviveCancel?.(d));
    this.socket.on('player:revived',d=>{if(d?.playerId===this.playerId){this.localDowned=false;this.localAlive=true;this.localHealth=Number(d.health)||this.localHealth;this.localBleedOutEndAt=0;}this._callbacks.onPlayerRevived?.(d);});
    this.socket.on('player:death',data=>{this.localAlive=false;this.localDowned=false;this.localBleedOutEndAt=0;if(data?.penalty){if(typeof data.penalty.money==='number')this.localMoney=data.penalty.money;if(typeof data.penalty.score==='number')this.localScore=data.penalty.score;}this._callbacks.onDeath?.(data||{});});

    this.socket.on('zombies:snapshot',z=>this._setZombies(z));
    this.socket.on('zombies:snapshot:compact',rows=>this._setCompactZombies(rows));
    this.socket.on('zombie:spit',d=>this._callbacks.onZombieSpit?.(d));
    this.socket.on('zombie:explode',d=>this._callbacks.onZombieExplode?.(d));

    this.socket.on('loot:snapshot',items=>{this.lastLoot=Array.isArray(items)?items:[];this._callbacks.onLootUpdate?.({type:'snapshot',items:this.lastLoot});});
    this.socket.on('loot:spawn',item=>{if(item){this.lastLoot=[...this.lastLoot.filter(x=>Number(x.id)!==Number(item.id)),item];this._callbacks.onLootUpdate?.({type:'spawn',item});}});
    this.socket.on('loot:removed',id=>{this.lastLoot=this.lastLoot.filter(x=>Number(x.id)!==Number(id));this._callbacks.onLootUpdate?.({type:'removed',id:Number(id)});});
    this.socket.on('round:state',round=>{if(round){this.round=round;this._callbacks.onRoundUpdate?.(round);}});
    this.socket.on('world:interactions',items=>{this.lastInteractions=Array.isArray(items)?items:[];this._callbacks.onInteractionUpdate?.({type:'snapshot',items:this.lastInteractions});});
    this.socket.on('world:interaction',item=>{if(!item?.id)return;this.lastInteractions=[...this.lastInteractions.filter(x=>String(x.id)!==String(item.id)),item];this._callbacks.onInteractionUpdate?.({type:'update',item});});

    this.socket.on('game:feed',evt=>this._callbacks.onFeed?.(evt));
    this.socket.on('scoreboard:update',rows=>{this.scoreboard=Array.isArray(rows)?rows:[];this._callbacks.onScoreboard?.(this.scoreboard);});
    this.socket.on('boss:incoming',evt=>this._callbacks.onBossIncoming?.(evt));
  }

  _setZombies(z){this.lastZombies=Array.isArray(z)?z:[];this._callbacks.onZombiesUpdate?.(this.lastZombies);}
  _setCompactZombies(rows){
    if(!Array.isArray(rows))return;
    this.lastZombies=rows.map(r=>Array.isArray(r)?{id:r[0],type:r[1],x:r[2],y:r[3],health:r[4],maxHealth:r[5],state:r[6],directionX:r[7],directionY:r[8],radius:r[9],speed:r[10]}:r).filter(Boolean);
    this._callbacks.onZombiesUpdate?.(this.lastZombies);
  }

  _mergeOnePlayer(data){if(!data?.id||data.id===this.playerId)return;const cur=this.remotePlayers.get(data.id);if(cur)cur.applySnapshot(data);else this.remotePlayers.set(data.id,new RemotePlayer(data));this._updatePlayerCount();}
  _mergePlayers(players){const seen=new Set();for(const d of Array.isArray(players)?players:[]){if(!d?.id||d.id===this.playerId)continue;seen.add(d.id);const cur=this.remotePlayers.get(d.id);if(cur)cur.applySnapshot(d);else this.remotePlayers.set(d.id,new RemotePlayer(d));}for(const id of this.remotePlayers.keys())if(!seen.has(id))this.remotePlayers.delete(id);}
  _updatePlayerCount(){this.playerCount=this.remotePlayers.size+(this._socketJoined?1:0);this._callbacks.onPlayersUpdate?.(this.remotePlayers,this.playerCount,this.lastZombies);}

  _applySelf(self){
    if(!self)return;
    if(typeof self.health==='number')this.localHealth=self.health;if(typeof self.maxHealth==='number')this.localMaxHealth=self.maxHealth;if(typeof self.alive==='boolean')this.localAlive=self.alive;if(typeof self.downed==='boolean')this.localDowned=self.downed;if(typeof self.bleedOutEndAt==='number')this.localBleedOutEndAt=self.bleedOutEndAt;
    if(typeof self.revives==='number')this.localRevives=self.revives;if(typeof self.kills==='number')this.localKills=self.kills;if(typeof self.headshots==='number')this.localHeadshots=self.headshots;if(typeof self.money==='number')this.localMoney=self.money;if(typeof self.score==='number')this.localScore=self.score;
    this.loadout={...this.loadout,...self,upgrades:{...this.loadout.upgrades,...(self.upgrades||{})}};this._callbacks.onSelfUpdate?.(this.loadout);
  }

  _applyProfileResult(result){
    if(!result?.success)return result;
    this.profile.apply(result);this.account=this.profile.account;this.playerName=this.account?.name||this.playerName;
    this._callbacks.onProfileUpdate?.(this.account);return result;
  }

  async _ensureSocketConnected(){const socket=this._getSocket();if(socket.connected){this.connected=true;return;}await new Promise((resolve,reject)=>{let done=false;const timer=setTimeout(()=>{if(done)return;done=true;cleanup();reject(new Error('socket_timeout'));},NETWORK_CONFIG.SOCKET_TIMEOUT);const onConnect=()=>{if(done)return;done=true;cleanup();resolve();};const cleanup=()=>{clearTimeout(timer);socket.off('connect',onConnect);};socket.on('connect',onConnect);socket.connect();});this.connected=true;}
  _emitWithAck(eventName,data,timeoutMs=NETWORK_CONFIG.SOCKET_TIMEOUT){return new Promise((resolve,reject)=>{if(!this.socket?.connected)return reject(new Error('socket_disconnected'));let done=false;const timer=setTimeout(()=>{if(done)return;done=true;reject(new Error('socket_ack_timeout'));},timeoutMs);this.socket.emit(eventName,data,response=>{if(done)return;done=true;clearTimeout(timer);resolve(response);});});}

  async bootstrapAccount(name=''){
    // Evita duas autenticações concorrentes (constructor + evento connect).
    if(this._accountBootstrapPromise)return this._accountBootstrapPromise;
    this._accountBootstrapPromise=(async()=>{
      await this._ensureSocketConnected();
      const r=await this._emitWithAck('account:bootstrap',this.profile.bootstrapPayload(name),15000);
      if(r?.success){
        this.maps=Array.isArray(r.maps)?r.maps:this.maps;
        if(r.social)this.social=r.social;
        if(Array.isArray(r.leaderboard))this.leaderboard=r.leaderboard;
        this._applyProfileResult(r);
        this._callbacks.onSocialUpdate?.(this.social);
        this._callbacks.onLeaderboard?.(this.leaderboard);
      }
      return r;
    })();
    try{return await this._accountBootstrapPromise;}finally{this._accountBootstrapPromise=null;}
  }
  async selectProfile({skinId=null,weaponSkinId=null}={}){try{const r=await this._emitWithAck('profile:select',{skinId,weaponSkinId});if(r?.success)this._applyProfileResult(r);return r;}catch(_){return null;}}
  async getLeaderboard(limit=20){
    limit=Math.max(3,Math.min(50,Number(limit)||20));
    try{
      await this._ensureSocketConnected();
      const r=await this._emitWithAck('leaderboard:get',{limit},6500);
      if(r?.success){this.leaderboard=Array.isArray(r.rows)?r.rows:[];this._callbacks.onLeaderboard?.(this.leaderboard);return r;}
    }catch(_){}
    // Fallback HTTP: ranking não depende de autenticação e assim continua
    // carregando mesmo se um ACK do Socket.IO se perder durante cold-start.
    try{
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),9000);
      const res=await fetch(`${NETWORK_CONFIG.SOCKET_URL}/api/leaderboard?limit=${limit}`,{cache:'no-store',signal:controller.signal});
      clearTimeout(timer);
      if(!res.ok)return null;
      const r=await res.json();
      if(r?.success){this.leaderboard=Array.isArray(r.rows)?r.rows:[];this._callbacks.onLeaderboard?.(this.leaderboard);}return r;
    }catch(_){return null;}
  }
  async getSocial(){try{await this._ensureSocketConnected();const r=await this._emitWithAck('social:list',{});if(r?.success&&r.social){this.social=r.social;this._callbacks.onSocialUpdate?.(this.social);}return r;}catch(_){return null;}}
  async addFriend(code){try{const r=await this._emitWithAck('social:request',{code:String(code||'').trim().toUpperCase()});if(r?.success)await this.getSocial();return r;}catch(_){return null;}}
  async respondFriend(requesterId,accept=true){try{const r=await this._emitWithAck('social:respond',{requesterId:String(requesterId||''),accept:!!accept});if(r?.success)await this.getSocial();return r;}catch(_){return null;}}
  async removeFriend(friendId){try{const r=await this._emitWithAck('social:remove',{friendId:String(friendId||'')});if(r?.success)await this.getSocial();return r;}catch(_){return null;}}
  async inviteFriend(friendId){try{return await this._emitWithAck('social:invite',{friendId:String(friendId||'')});}catch(_){return null;}}
  async respondInvite(inviteId,accept){try{const r=await this._emitWithAck('social:invite:respond',{inviteId:String(inviteId||''),accept:!!accept});if(r?.success&&r.lobby){this.lobby=r.lobby;this.roomCode=r.lobby.code;this.mapId=r.lobby.mapId||this.mapId;this._callbacks.onLobbyUpdate?.(r.lobby);}this.pendingInvite=null;return r;}catch(_){return null;}}

  async createLobby(mapId='city'){try{await this._ensureSocketConnected();const r=await this._emitWithAck('lobby:create',{mapId});if(r?.success){this.lobby=r.lobby;this.roomCode=r.lobby?.code;this.mapId=r.lobby?.mapId||mapId;}return r;}catch(_){return null;}}
  async quickLobby(mapId='city'){try{await this._ensureSocketConnected();const r=await this._emitWithAck('lobby:quick',{mapId});if(r?.success){this.lobby=r.lobby;this.roomCode=r.lobby?.code;this.mapId=r.lobby?.mapId||mapId;}return r;}catch(_){return null;}}
  async joinLobby(code){try{await this._ensureSocketConnected();const r=await this._emitWithAck('lobby:join',{code:String(code||'').toUpperCase()});if(r?.success){this.lobby=r.lobby;this.roomCode=r.lobby?.code;this.mapId=r.lobby?.mapId||'city';}return r;}catch(_){return null;}}
  async setLobbyReady(ready=true){try{return await this._emitWithAck('lobby:ready',{ready});}catch(_){return null;}}
  async setLobbyMap(mapId){try{return await this._emitWithAck('lobby:map',{mapId});}catch(_){return null;}}
  async startLobby(){try{return await this._emitWithAck('lobby:start',{});}catch(_){return null;}}
  async _resumeRoom(){if(!this.roomCode)return null;try{const r=await this._emitWithAck('lobby:resume',{code:this.roomCode});if(r?.success){this.lobby=r.lobby;this.mapId=r.lobby?.mapId||this.mapId;}return r;}catch(_){return null;}}
  async leaveLobby(){try{if(this.socket?.connected&&this.roomCode)await this._emitWithAck('lobby:leave',{},2500);}catch(_){}this.lobby=null;this.roomCode=null;}

  async join(name){
    if(!this.account){const a=await this.bootstrapAccount(name);if(!a?.success)throw new Error(a?.error||'account_required');}
    name=this.account?.name||String(name||'Sobrevivente').trim().slice(0,16)||'Sobrevivente';this.playerName=name;
    if(!this.roomCode)throw new Error('lobby_required');
    try{await this._ensureSocketConnected();}catch(_){throw new Error('render_unavailable');}
    const result=await this._joinRender(name);if(!result?.success){if(result?.error==='server_full')this._callbacks.onServerFull?.();throw new Error(result?.error||'render_join_failed');}
    this._consumeJoin(result);this._socketJoined=true;this._updatePlayerCount();this._startLoops();
    return{player:{...result.player,health:this.localHealth,maxHealth:this.localMaxHealth,alive:this.localAlive,downed:this.localDowned,kills:this.localKills},room:result.room};
  }
  _consumeJoin(result){const p=result.player;this.playerId=p.id;this._localState={x:Number(p.x),y:Number(p.y),direction:p.direction||'down',moving:false,vx:0,vy:0,aimDirX:p.aimDirX??0,aimDirY:p.aimDirY??1};this._applySelf(result.self||p);this.remotePlayers.clear();this._mergePlayers(result.players||[]);this._setZombies(result.zombies||[]);this.lastLoot=Array.isArray(result.loot)?result.loot:[];if(result.round)this.round=result.round;if(result.shop)this.shopCatalog=result.shop;this.lastInteractions=Array.isArray(result.interactions)?result.interactions:[];if(result.room){this.roomCode=result.room.code||this.roomCode;this.mapId=result.room.mapId||this.mapId;}this.scoreboard=Array.isArray(result.scoreboard)?result.scoreboard:[];this._callbacks.onScoreboard?.(this.scoreboard);}
  async _joinRender(name){this._joiningSocket=true;try{return await this._emitWithAck('player:join',{name,roomCode:this.roomCode});}finally{this._joiningSocket=false;}}
  async _rejoin(){try{const resumed=await this._resumeRoom();if(!resumed?.success)return;const r=await this._joinRender(this.playerName||this.account?.name||'Sobrevivente');if(!r?.success)return;this._consumeJoin(r);this._socketJoined=true;this._updatePlayerCount();this._sendPlayerState();this._callbacks.onLootUpdate?.({type:'snapshot',items:this.lastLoot});this._callbacks.onRoundUpdate?.(this.round);this._callbacks.onInteractionUpdate?.({type:'snapshot',items:this.lastInteractions});}catch(_) {}}

  setLocalState(x,y,direction,moving=false,vx=0,vy=0,aimDirX=0,aimDirY=1){if(Number.isFinite(x))this._localState.x=x;if(Number.isFinite(y))this._localState.y=y;this._localState.direction=direction||'down';this._localState.moving=moving===true;this._localState.vx=Number.isFinite(vx)?vx:0;this._localState.vy=Number.isFinite(vy)?vy:0;this._localState.aimDirX=Number.isFinite(aimDirX)?aimDirX:0;this._localState.aimDirY=Number.isFinite(aimDirY)?aimDirY:1;}
  _sendPlayerState(){if(!this.socket?.connected||!this._socketJoined)return;this.socket.emit('player:state',{...this._localState});}
  async shoot(){if(!this._socketJoined)return null;try{const r=await this._emitWithAck('player:shoot',{});if(r?.self)this._applySelf(r.self);return r;}catch(_){return null;}}
  async reload(){if(!this._socketJoined)return null;try{const r=await this._emitWithAck('player:reload',{});if(r?.self)this._applySelf(r.self);return r;}catch(_){return null;}}
  async switchWeapon(slot=null){if(!this._socketJoined)return null;try{const r=await this._emitWithAck('player:switch',slot===null?{}:{slot});if(r?.self)this._applySelf(r.self);return r;}catch(_){return null;}}
  async pickupLoot(lootId){if(!this._socketJoined)return null;try{const r=await this._emitWithAck('loot:pickup',{lootId});if(r?.self)this._applySelf(r.self);return r;}catch(_){return null;}}
  async buy(itemId){if(!this._socketJoined)return null;try{const r=await this._emitWithAck('shop:buy',{itemId});if(r?.self)this._applySelf(r.self);return r;}catch(_){return null;}}
  async interact(id){if(!this._socketJoined)return null;try{const r=await this._emitWithAck('world:interact',{id});if(r?.self)this._applySelf(r.self);return r;}catch(_){return null;}}
  async startRevive(targetId){if(!this._socketJoined)return null;try{return await this._emitWithAck('player:revive:start',{targetId:String(targetId||'')});}catch(_){return null;}}
  async cancelRevive(targetId){if(!this._socketJoined)return null;try{return await this._emitWithAck('player:revive:cancel',{targetId:String(targetId||'')});}catch(_){return null;}}
  async respawn(){if(!this._socketJoined)return null;try{const r=await this._emitWithAck('player:respawn',{});if(!r?.success)return null;if(r.self)this._applySelf(r.self);if(r.player){if(Number.isFinite(Number(r.player.x)))this._localState.x=Number(r.player.x);if(Number.isFinite(Number(r.player.y)))this._localState.y=Number(r.player.y);}this._sendPlayerState();return r.player||null;}catch(_){return null;}}

  _measurePing(){if(!this.socket?.connected||this._pingPending)return;this._pingPending=true;const start=performance.now();const timeout=setTimeout(()=>{this._pingPending=false;},5000);this.socket.emit('ping:check',()=>{clearTimeout(timeout);this._pingPending=false;this._recordPing(performance.now()-start);if(this._socketJoined)this.socket.emit('player:ping',{ping:this.pingMs});});}
  _recordPing(ms){if(!Number.isFinite(ms))return;this._pingSamples.push(ms);if(this._pingSamples.length>NETWORK_CONFIG.PING_SAMPLES)this._pingSamples.shift();this.pingMs=Math.round(this._pingSamples.reduce((a,b)=>a+b,0)/this._pingSamples.length);}
  _startLoops(){this._stopLoops();this._playerTimer=setInterval(()=>this._sendPlayerState(),this._currentPlayerInterval());this._pingTimer=setInterval(()=>this._measurePing(),NETWORK_CONFIG.PING_INTERVAL);this._sendPlayerState();this._measurePing();}
  _stopLoops(){if(this._playerTimer){clearInterval(this._playerTimer);this._playerTimer=null;}if(this._pingTimer){clearInterval(this._pingTimer);this._pingTimer=null;}}
  _currentPlayerInterval(){return document.hidden?NETWORK_CONFIG.BACKGROUND_PLAYER_INTERVAL:NETWORK_CONFIG.PLAYER_UPDATE_INTERVAL;}
  _onVisibilityChange(){if(this._socketJoined)this._startLoops();}

  async leave(){
    this._stopLoops();try{if(this.socket?.connected&&this._socketJoined)this.socket.emit('player:leave');}catch(_){}
    try{if(this.socket?.connected&&this.roomCode)this.socket.emit('lobby:leave',{});}catch(_){}
    this._socketJoined=false;this.playerId=null;this.remotePlayers.clear();this.lastZombies=[];this.lastLoot=[];this.lastInteractions=[];this.playerCount=0;this.pingMs=null;this.scoreboard=[];this.lobby=null;this.roomCode=null;
    this.localHealth=100;this.localMaxHealth=100;this.localAlive=true;this.localDowned=false;this.localBleedOutEndAt=0;this.localRevives=0;this.localKills=0;this.localHeadshots=0;this.localMoney=0;this.localScore=0;
    this.round={number:0,state:'waiting',countdownSeconds:0,zombiesTotal:0,zombiesAlive:0,zombiesRemaining:0,shopOpen:false};this._pingSamples=[];this._connectionLost=false;
  }
  hasJoined(){return !!this._socketJoined;}
  _onUnload(){try{if(this.socket?.connected&&this._socketJoined)this.socket.emit('player:leave');}catch(_) {}}
}
