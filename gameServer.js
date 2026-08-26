const config = require('./config');
const AccountStore = require('./accounts');
const RoomGame = require('./roomGame');

const MAPS = Object.freeze([
  { id:'city', name:'Cidade Abandonada', description:'Visual padrão e equilibrado.' },
  { id:'night', name:'Cidade à Noite', description:'Tema escuro, iluminação e VFX mais fortes.' },
  { id:'fog', name:'Zona de Névoa', description:'Atmosfera de neblina e visibilidade reduzida.' },
]);

class GameServer {
  constructor(io) {
    this.io = io;
    this.accounts = new AccountStore();
    this.rooms = new Map();
    this._cleanupTimer = setInterval(() => this._cleanupRooms(), 30000);
    this._bind();
  }

  status() {
    let players = 0, activeRooms = 0;
    for (const r of this.rooms.values()) {
      players += r.members.size;
      if (r.started) activeRooms++;
    }
    return { online:true, version:'20.0.0', rooms:this.rooms.size, activeRooms, players, accounts:this.accounts.accounts.size };
  }

  _safe(ack, fn) {
    try { fn(); } catch (err) {
      console.error('[socket]', err);
      ack?.({success:false,error:'server_error'});
    }
  }

  _bind() {
    this.io.on('connection', socket => {
      socket.on('account:bootstrap', (data, ack) => this._safe(ack, () => this._accountBootstrap(socket, data, ack)));
      socket.on('profile:select', (data, ack) => this._safe(ack, () => this._profileSelect(socket, data, ack)));

      socket.on('lobby:create', (data, ack) => this._safe(ack, () => this._createLobby(socket, data, ack, false)));
      socket.on('lobby:quick', (data, ack) => this._safe(ack, () => this._quickLobby(socket, data, ack)));
      socket.on('lobby:join', (data, ack) => this._safe(ack, () => this._joinLobby(socket, data, ack)));
      socket.on('lobby:resume', (data, ack) => this._safe(ack, () => this._resumeLobby(socket, data, ack)));
      socket.on('lobby:leave', (_data, ack) => this._safe(ack, () => { this._leaveLobby(socket); ack?.({success:true}); }));
      socket.on('lobby:ready', (data, ack) => this._safe(ack, () => this._readyLobby(socket, data, ack)));
      socket.on('lobby:map', (data, ack) => this._safe(ack, () => this._setLobbyMap(socket, data, ack)));
      socket.on('lobby:start', (_data, ack) => this._safe(ack, () => this._startLobby(socket, ack)));

      socket.on('player:join', (data, ack) => this._routeGame(socket, ack, g => g._handleJoin(socket, data, ack)));
      socket.on('player:state', data => this._routeGameNoAck(socket, g => g._handleState(socket, data)));
      socket.on('player:shoot', (data, ack) => this._routeGame(socket, ack, g => g._handleShoot(socket, data, ack)));
      socket.on('player:reload', (_data, ack) => this._routeGame(socket, ack, g => g._handleReload(socket, ack)));
      socket.on('player:switch', (data, ack) => this._routeGame(socket, ack, g => g._handleSwitch(socket, data, ack)));
      socket.on('loot:pickup', (data, ack) => this._routeGame(socket, ack, g => g._handleLootPickup(socket, data, ack)));
      socket.on('shop:buy', (data, ack) => this._routeGame(socket, ack, g => g._handleShopBuy(socket, data, ack)));
      socket.on('world:interact', (data, ack) => this._routeGame(socket, ack, g => g._handleWorldInteract(socket, data, ack)));
      socket.on('player:revive:start', (data, ack) => this._routeGame(socket, ack, g => g._handleReviveStart(socket, data, ack)));
      socket.on('player:revive:cancel', (data, ack) => this._routeGame(socket, ack, g => g._handleReviveCancel(socket, data, ack)));
      socket.on('player:respawn', (_data, ack) => this._routeGame(socket, ack, g => g._handleRespawn(socket, ack)));
      socket.on('player:ping', data => this._routeGameNoAck(socket, g => g._handlePingReport(socket, data)));
      socket.on('player:leave', () => this._routeGameNoAck(socket, g => g._handleLeave(socket, false)));
      socket.on('ping:check', ack => ack?.({serverTime:Date.now()}));

      socket.on('disconnect', () => {
        // _leaveLobby repassa disconnected=true ao RoomGame, que mantém
        // o estado da partida por uma janela curta para reconexão.
        this._leaveLobby(socket, true);
      });
    });
  }

  _requireAccount(socket, ack) {
    const account = socket.data?.account;
    if (!account) { ack?.({success:false,error:'account_required'}); return null; }
    const fresh = this.accounts.get(account.id);
    if (!fresh) { ack?.({success:false,error:'account_required'}); return null; }
    socket.data.account = fresh;
    return fresh;
  }

  _accountBootstrap(socket, data, ack) {
    const result = this.accounts.bootstrap(data || {});
    if (result.success) socket.data.account = this.accounts.get(result.account.id);
    ack?.({...result, maps:MAPS});
  }

  _profileSelect(socket, data, ack) {
    const account = this._requireAccount(socket, ack); if (!account) return;
    const result = this.accounts.select(account.id, data || {});
    if (result.success) {
      socket.data.account = this.accounts.get(account.id);
      const room = this._roomOf(socket);
      room?.game?.refreshPlayerProfile(socket, result.account);
      this._broadcastLobby(room);
    }
    ack?.(result);
  }

  _code() {
    const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt=0; attempt<50; attempt++) {
      let code=''; for(let i=0;i<config.LOBBY_CODE_LENGTH;i++)code+=alphabet[Math.floor(Math.random()*alphabet.length)];
      if(!this.rooms.has(code))return code;
    }
    return Math.random().toString(36).slice(2,2+config.LOBBY_CODE_LENGTH).toUpperCase();
  }

  _newRoom(socket, mapId='city', isPublic=false) {
    const code=this._code();
    const room={
      code, mapId:MAPS.some(m=>m.id===mapId)?mapId:'city', public:isPublic,
      hostSocketId:socket.id, members:new Map(), started:false, game:null,
      createdAt:Date.now(), lastActivityAt:Date.now(),
    };
    this.rooms.set(code,room);
    return room;
  }

  _member(socket, account, ready=false) {
    return {socketId:socket.id,accountId:account.id,name:account.name,ready,level:account.level,skinId:account.selectedSkin,ping:null};
  }

  _roomSnapshot(room) {
    if(!room)return null;
    return {
      code:room.code,mapId:room.mapId,hostId:room.hostSocketId,started:room.started,public:room.public,
      maps:MAPS,
      members:[...room.members.values()].map(m=>({...m,isHost:m.socketId===room.hostSocketId})),
      canStart:room.members.size>0 && [...room.members.values()].every(m=>m.ready),
    };
  }

  _broadcastLobby(room) {
    if(!room)return;
    room.lastActivityAt=Date.now();
    this.io.to(`game:${room.code}`).emit('lobby:state',this._roomSnapshot(room));
  }

  _attachToRoom(socket, room, account, ready=false) {
    const old=this._roomOf(socket);
    if(old && old.code!==room.code)this._leaveLobby(socket);
    socket.data.roomCode=room.code;
    socket.join(`game:${room.code}`);
    room.members.set(socket.id,this._member(socket,account,ready));
    room.lastActivityAt=Date.now();
    if(!room.hostSocketId)room.hostSocketId=socket.id;
  }

  _createLobby(socket, data, ack, isPublic=false) {
    const account=this._requireAccount(socket,ack); if(!account)return;
    const room=this._newRoom(socket,String(data?.mapId||'city'),isPublic);
    this._attachToRoom(socket,room,account,false);
    this._broadcastLobby(room);
    ack?.({success:true,lobby:this._roomSnapshot(room)});
  }

  _quickLobby(socket, data, ack) {
    const account=this._requireAccount(socket,ack); if(!account)return;
    let room=[...this.rooms.values()].find(r=>r.public && r.members.size<Math.min(config.LOBBY_MAX_PLAYERS,4));
    if(!room)room=this._newRoom(socket,String(data?.mapId||'city'),true);
    this._attachToRoom(socket,room,account,true);
    // Quick play entra numa sala pública existente (inclusive em andamento) ou cria uma nova.
    if(!room.started){
      room.started=true;
      room.game=new RoomGame(this.io,room,this.accounts);
    }
    this._broadcastLobby(room);
    this.io.to(`game:${room.code}`).emit('lobby:started',{code:room.code,mapId:room.mapId});
    ack?.({success:true,lobby:this._roomSnapshot(room),started:true});
  }

  _joinLobby(socket, data, ack) {
    const account=this._requireAccount(socket,ack); if(!account)return;
    const code=String(data?.code||'').trim().toUpperCase();
    const room=this.rooms.get(code);
    if(!room)return ack?.({success:false,error:'room_not_found'});
    if(room.started)return ack?.({success:false,error:'room_already_started'});
    if(room.members.size>=config.LOBBY_MAX_PLAYERS)return ack?.({success:false,error:'room_full'});
    this._attachToRoom(socket,room,account,false);
    this._broadcastLobby(room);
    ack?.({success:true,lobby:this._roomSnapshot(room)});
  }


  _resumeLobby(socket, data, ack) {
    const account=this._requireAccount(socket,ack); if(!account)return;
    const code=String(data?.code||'').trim().toUpperCase();
    const room=this.rooms.get(code); if(!room)return ack?.({success:false,error:'room_not_found'});
    if(room.members.size>=config.LOBBY_MAX_PLAYERS&&!room.members.has(socket.id))return ack?.({success:false,error:'room_full'});
    this._attachToRoom(socket,room,account,true);
    this._broadcastLobby(room);
    if(room.started)this.io.to(socket.id).emit('lobby:started',{code:room.code,mapId:room.mapId});
    ack?.({success:true,lobby:this._roomSnapshot(room),started:room.started});
  }

  _readyLobby(socket, data, ack) {
    const room=this._roomOf(socket); if(!room)return ack?.({success:false,error:'not_in_room'});
    const member=room.members.get(socket.id); if(!member)return ack?.({success:false,error:'not_in_room'});
    member.ready=data?.ready!==false;
    this._broadcastLobby(room);
    ack?.({success:true,lobby:this._roomSnapshot(room)});
  }

  _setLobbyMap(socket, data, ack) {
    const room=this._roomOf(socket); if(!room)return ack?.({success:false,error:'not_in_room'});
    if(room.hostSocketId!==socket.id)return ack?.({success:false,error:'host_only'});
    if(room.started)return ack?.({success:false,error:'room_started'});
    const mapId=String(data?.mapId||'');
    if(!MAPS.some(m=>m.id===mapId))return ack?.({success:false,error:'invalid_map'});
    room.mapId=mapId; this._broadcastLobby(room);
    ack?.({success:true,lobby:this._roomSnapshot(room)});
  }

  _startLobby(socket, ack) {
    const room=this._roomOf(socket); if(!room)return ack?.({success:false,error:'not_in_room'});
    if(room.hostSocketId!==socket.id)return ack?.({success:false,error:'host_only'});
    if(room.started)return ack?.({success:true,lobby:this._roomSnapshot(room),started:true});
    if(room.members.size<1 || ![...room.members.values()].every(m=>m.ready))return ack?.({success:false,error:'players_not_ready'});
    room.started=true; room.game=new RoomGame(this.io,room,this.accounts); room.lastActivityAt=Date.now();
    this._broadcastLobby(room);
    this.io.to(`game:${room.code}`).emit('lobby:started',{code:room.code,mapId:room.mapId});
    ack?.({success:true,lobby:this._roomSnapshot(room),started:true});
  }

  _roomOf(socket) { return this.rooms.get(String(socket.data?.roomCode||'')) || null; }

  _routeGame(socket, ack, fn) {
    try {
      const room=this._roomOf(socket);
      if(!room?.started||!room.game)return ack?.({success:false,error:'game_not_started'});
      fn(room.game);
    } catch(err) { console.error('[game route]',err); ack?.({success:false,error:'server_error'}); }
  }
  _routeGameNoAck(socket, fn) {
    try { const room=this._roomOf(socket); if(room?.started&&room.game)fn(room.game); } catch(err){console.error('[game route]',err);}
  }

  _leaveLobby(socket, disconnected=false) {
    const room=this._roomOf(socket); if(!room)return;
    if(room.game)room.game._handleLeave(socket, disconnected);
    room.members.delete(socket.id);
    socket.leave?.(`game:${room.code}`);
    socket.data.roomCode=null;
    if(room.hostSocketId===socket.id)room.hostSocketId=room.members.keys().next().value||null;
    room.lastActivityAt=Date.now();
    if(room.members.size===0){
      // Queda de rede: mantém sala/jogo por um período de graça para reconexão.
      if(!disconnected){ room.game?.stop(); this.rooms.delete(room.code); }
    }else this._broadcastLobby(room);
  }

  _cleanupRooms() {
    const now=Date.now();
    for(const [code,room] of this.rooms){
      if(room.members.size===0 && now-room.lastActivityAt>config.ROOM_IDLE_DELETE_MS){room.game?.stop();this.rooms.delete(code);}
    }
  }
}

GameServer.MAPS=MAPS;
module.exports=GameServer;
