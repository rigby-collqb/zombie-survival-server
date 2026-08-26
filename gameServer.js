const crypto = require('crypto');
const config = require('./config');
const AccountStore = require('./accounts');
const RoomGame = require('./roomGame');
const worldMaps = require('./worldMap');

const MAPS = Object.freeze(worldMaps.catalog().map(m => ({ id:m.id, name:m.name, description:m.description, theme:m.theme })));

class GameServer {
  constructor(io) {
    this.io = io;
    this.accounts = new AccountStore();
    this.rooms = new Map();
    this.accountSockets = new Map();
    this.invites = new Map();
    this._cleanupTimer = setInterval(() => this._cleanupRooms(), 30000);
    this._bind();
  }

  status() {
    let players = 0, activeRooms = 0;
    for (const r of this.rooms.values()) {
      players += r.members.size;
      if (r.started) activeRooms++;
    }
    return { online:true, version:'25.0.0', rooms:this.rooms.size, activeRooms, players, accounts:this.accounts.accounts.size };
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
      socket.on('leaderboard:get', (data, ack) => this._safe(ack, () => ack?.({success:true,rows:this.accounts.leaderboard(data?.limit||20)})));
      socket.on('social:list', (_data, ack) => this._safe(ack, () => this._socialList(socket, ack)));
      socket.on('social:request', (data, ack) => this._safe(ack, () => this._socialRequest(socket, data, ack)));
      socket.on('social:respond', (data, ack) => this._safe(ack, () => this._socialRespond(socket, data, ack)));
      socket.on('social:remove', (data, ack) => this._safe(ack, () => this._socialRemove(socket, data, ack)));
      socket.on('social:invite', (data, ack) => this._safe(ack, () => this._socialInvite(socket, data, ack)));
      socket.on('social:invite:respond', (data, ack) => this._safe(ack, () => this._socialInviteRespond(socket, data, ack)));

      socket.on('lobby:create', (data, ack) => this._safe(ack, () => this._createLobby(socket, data, ack, false)));
      socket.on('lobby:quick', (data, ack) => this._safe(ack, () => this._quickLobby(socket, data, ack)));
      socket.on('lobby:join', (data, ack) => this._safe(ack, () => this._joinLobby(socket, data, ack)));
      socket.on('lobby:resume', (data, ack) => this._safe(ack, () => this._resumeLobby(socket, data, ack)));
      socket.on('lobby:leave', (_data, ack) => this._safe(ack, () => { this._leaveLobby(socket); ack?.({success:true}); }));
      socket.on('lobby:ready', (data, ack) => this._safe(ack, () => this._readyLobby(socket, data, ack)));
      socket.on('lobby:map', (data, ack) => this._safe(ack, () => this._setLobbyMap(socket, data, ack)));
      socket.on('lobby:difficulty', (data, ack) => this._safe(ack, () => this._setLobbyDifficulty(socket, data, ack)));
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
      socket.on('player:use-item', (data, ack) => this._routeGame(socket, ack, g => g._handleUseItem(socket, data, ack)));
      socket.on('game:pause', (data, ack) => this._routeGame(socket, ack, g => g._handlePause(socket, data, ack)));
      socket.on('chat:send', (data, ack) => this._routeGame(socket, ack, g => g._handleChat(socket, data, ack)));
      socket.on('player:ping', data => this._routeGameNoAck(socket, g => g._handlePingReport(socket, data)));
      socket.on('player:leave', () => this._routeGameNoAck(socket, g => g._handleLeave(socket, false)));
      socket.on('ping:check', ack => ack?.({serverTime:Date.now()}));

      socket.on('disconnect', () => {
        const accountId=socket.data?.account?.id;
        this._leaveLobby(socket, true);
        this._untrackSocket(socket, accountId);
        if(accountId)this._pushSocialToFriends(accountId);
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

  _trackSocket(socket, account) {
    if(!account?.id)return;
    const oldId=socket.data?.trackedAccountId;
    if(oldId&&oldId!==account.id)this._untrackSocket(socket,oldId);
    socket.data.trackedAccountId=account.id;
    let set=this.accountSockets.get(account.id);if(!set){set=new Set();this.accountSockets.set(account.id,set);}set.add(socket.id);
  }

  _untrackSocket(socket, accountId) {
    const id=String(accountId||socket.data?.trackedAccountId||'');if(!id)return;
    const set=this.accountSockets.get(id);if(set){set.delete(socket.id);if(!set.size)this.accountSockets.delete(id);}socket.data.trackedAccountId=null;
  }

  _socketsForAccount(accountId) {
    const ids=this.accountSockets.get(String(accountId||''));if(!ids)return[];
    return [...ids].map(id=>this.io.sockets.sockets.get(id)).filter(Boolean);
  }

  _presenceFor(accountId) {
    const sockets=this._socketsForAccount(accountId);
    if(!sockets.length)return{status:'offline',roomCode:null};
    let status='online',roomCode=null;
    for(const socket of sockets){
      const room=this._roomOf(socket);if(!room)continue;
      roomCode=room.code;
      if(room.started){status='playing';break;}status='lobby';
    }
    return{status,roomCode};
  }

  _socialSnapshot(accountId) { return this.accounts.socialSnapshot(accountId,id=>this._presenceFor(id)); }
  _pushSocial(accountId) { const s=this._socialSnapshot(accountId);for(const socket of this._socketsForAccount(accountId))socket.emit('social:update',s); }
  _pushSocialToFriends(accountId) { const a=this.accounts.get(accountId);if(!a)return;this._pushSocial(accountId);for(const id of a.friends)this._pushSocial(id); }

  _accountBootstrap(socket, data, ack) {
    const result = this.accounts.bootstrap(data || {});
    if (result.success) {
      socket.data.account = this.accounts.get(result.account.id);
      this._trackSocket(socket,socket.data.account);
    }
    ack?.({...result, maps:MAPS, social:result.success?this._socialSnapshot(result.account.id):null, leaderboard:this.accounts.leaderboard(12)});
    if(result.success)this._pushSocialToFriends(result.account.id);
  }

  _profileSelect(socket, data, ack) {
    const account = this._requireAccount(socket, ack); if (!account) return;
    const result = this.accounts.select(account.id, data || {});
    if (result.success) {
      socket.data.account = this.accounts.get(account.id);
      const room = this._roomOf(socket);
      room?.game?.refreshPlayerProfile(socket, result.account);
      this._broadcastLobby(room);
      this._pushSocialToFriends(account.id);
    }
    ack?.(result);
  }

  _socialList(socket, ack){const a=this._requireAccount(socket,ack);if(!a)return;ack?.({success:true,social:this._socialSnapshot(a.id)});}
  _socialRequest(socket,data,ack){const a=this._requireAccount(socket,ack);if(!a)return;const r=this.accounts.requestFriend(a.id,data?.code);ack?.(r);if(r.success){this._pushSocial(a.id);if(r.target?.id)this._pushSocial(r.target.id);}}
  _socialRespond(socket,data,ack){const a=this._requireAccount(socket,ack);if(!a)return;const requesterId=String(data?.requesterId||'');const r=this.accounts.respondFriend(a.id,requesterId,data?.accept!==false);ack?.(r);if(r.success){this._pushSocial(a.id);this._pushSocial(requesterId);}}
  _socialRemove(socket,data,ack){const a=this._requireAccount(socket,ack);if(!a)return;const friendId=String(data?.friendId||'');const r=this.accounts.removeFriend(a.id,friendId);ack?.(r);if(r.success){this._pushSocial(a.id);this._pushSocial(friendId);}}

  _socialInvite(socket,data,ack){
    const a=this._requireAccount(socket,ack);if(!a)return;
    const friendId=String(data?.friendId||'');
    if(!this.accounts.areFriends(a.id,friendId))return ack?.({success:false,error:'not_friends'});
    const room=this._roomOf(socket);if(!room)return ack?.({success:false,error:'create_room_first'});
    if(room.started)return ack?.({success:false,error:'room_started'});
    if(room.members.size>=config.LOBBY_MAX_PLAYERS)return ack?.({success:false,error:'room_full'});
    const targets=this._socketsForAccount(friendId);if(!targets.length)return ack?.({success:false,error:'friend_offline'});
    const inviteId=crypto.randomUUID();
    const invite={id:inviteId,fromAccountId:a.id,fromName:a.name,toAccountId:friendId,roomCode:room.code,mapId:room.mapId,createdAt:Date.now(),expiresAt:Date.now()+30000};
    this.invites.set(inviteId,invite);
    for(const target of targets)target.emit('social:invite',invite);
    ack?.({success:true,inviteId});
  }

  _socialInviteRespond(socket,data,ack){
    const a=this._requireAccount(socket,ack);if(!a)return;
    const invite=this.invites.get(String(data?.inviteId||''));
    if(!invite||invite.toAccountId!==a.id||Date.now()>invite.expiresAt){if(invite)this.invites.delete(invite.id);return ack?.({success:false,error:'invite_expired'});}
    this.invites.delete(invite.id);
    const accepted=data?.accept===true;
    if(!accepted){for(const s of this._socketsForAccount(invite.fromAccountId))s.emit('social:invite:result',{inviteId:invite.id,accepted:false,name:a.name});return ack?.({success:true,accepted:false});}
    const room=this.rooms.get(invite.roomCode);if(!room)return ack?.({success:false,error:'room_not_found'});
    if(room.started)return ack?.({success:false,error:'room_started'});
    if(room.members.size>=config.LOBBY_MAX_PLAYERS)return ack?.({success:false,error:'room_full'});
    this._attachToRoom(socket,room,a,false);this._broadcastLobby(room);
    for(const s of this._socketsForAccount(invite.fromAccountId))s.emit('social:invite:result',{inviteId:invite.id,accepted:true,name:a.name});
    this._pushSocialToFriends(a.id);
    ack?.({success:true,accepted:true,lobby:this._roomSnapshot(room)});
  }

  _code() {
    const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt=0; attempt<50; attempt++) {
      let code=''; for(let i=0;i<config.LOBBY_CODE_LENGTH;i++)code+=alphabet[Math.floor(Math.random()*alphabet.length)];
      if(!this.rooms.has(code))return code;
    }
    return Math.random().toString(36).slice(2,2+config.LOBBY_CODE_LENGTH).toUpperCase();
  }

  _newRoom(socket, mapId='city', isPublic=false, mode='survival', difficulty='normal') {
    const code=this._code();
    const room={
      code, mapId:mode==='story'?'city':(MAPS.some(m=>m.id===mapId)?mapId:'city'), public:isPublic,
      mode:mode==='story'?'story':'survival', difficulty:config.DIFFICULTIES?.[difficulty]?difficulty:'normal',
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
      mode:room.mode||'survival',difficulty:room.difficulty||'normal',difficulties:Object.values(config.DIFFICULTIES).map(d=>({id:d.id,name:d.name,hudRestricted:!!d.hudRestricted})),maps:MAPS,
      members:[...room.members.values()].map(m=>({...m,isHost:m.socketId===room.hostSocketId})),
      canStart:room.members.size>0 && [...room.members.values()].every(m=>m.ready),
    };
  }

  _broadcastLobby(room) {
    if(!room)return;
    room.lastActivityAt=Date.now();
    this.io.to(`game:${room.code}`).emit('lobby:state',this._roomSnapshot(room));
    for(const m of room.members.values())this._pushSocialToFriends(m.accountId);
  }

  _attachToRoom(socket, room, account, ready=false) {
    const old=this._roomOf(socket);
    if(old && old.code!==room.code)this._leaveLobby(socket);
    socket.data.roomCode=room.code;
    socket.join(`game:${room.code}`);
    room.members.set(socket.id,this._member(socket,account,ready));
    room.lastActivityAt=Date.now();
    if(!room.hostSocketId)room.hostSocketId=socket.id;
    this._pushSocialToFriends(account.id);
  }

  _createLobby(socket, data, ack, isPublic=false) {
    const account=this._requireAccount(socket,ack); if(!account)return;
    const room=this._newRoom(socket,String(data?.mapId||'city'),isPublic,String(data?.mode||'survival'),String(data?.difficulty||'normal'));
    this._attachToRoom(socket,room,account,false);
    this._broadcastLobby(room);
    ack?.({success:true,lobby:this._roomSnapshot(room)});
  }

  _quickLobby(socket, data, ack) {
    const account=this._requireAccount(socket,ack); if(!account)return;
    const wantMode=String(data?.mode||'survival')==='story'?'story':'survival', wantDifficulty=config.DIFFICULTIES?.[String(data?.difficulty||'normal')]?String(data?.difficulty||'normal'):'normal';
    let room=[...this.rooms.values()].find(r=>r.public && !r.started && r.mode===wantMode && r.difficulty===wantDifficulty && r.members.size<Math.min(config.LOBBY_MAX_PLAYERS,4));
    if(!room)room=this._newRoom(socket,String(data?.mapId||'city'),true,String(data?.mode||'survival'),String(data?.difficulty||'normal'));
    this._attachToRoom(socket,room,account,true);
    if(!room.started){room.started=true;room.game=new RoomGame(this.io,room,this.accounts);}
    this._broadcastLobby(room);
    this.io.to(`game:${room.code}`).emit('lobby:started',{code:room.code,mapId:room.mapId,mode:room.mode,difficulty:room.difficulty});
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
    if(room.started)this.io.to(socket.id).emit('lobby:started',{code:room.code,mapId:room.mapId,mode:room.mode,difficulty:room.difficulty});
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
    if(room.mode==='story')return ack?.({success:false,error:'story_map_locked'});
    const mapId=String(data?.mapId||'');
    if(!MAPS.some(m=>m.id===mapId))return ack?.({success:false,error:'invalid_map'});
    room.mapId=mapId; this._broadcastLobby(room);
    ack?.({success:true,lobby:this._roomSnapshot(room)});
  }

  _setLobbyDifficulty(socket,data,ack){
    const room=this._roomOf(socket);if(!room)return ack?.({success:false,error:'not_in_room'});
    if(room.hostSocketId!==socket.id)return ack?.({success:false,error:'host_only'});
    if(room.started)return ack?.({success:false,error:'room_started'});
    const id=String(data?.difficulty||'normal');if(!config.DIFFICULTIES[id])return ack?.({success:false,error:'invalid_difficulty'});
    room.difficulty=id;this._broadcastLobby(room);ack?.({success:true,lobby:this._roomSnapshot(room)});
  }

  _startLobby(socket, ack) {
    const room=this._roomOf(socket); if(!room)return ack?.({success:false,error:'not_in_room'});
    if(room.hostSocketId!==socket.id)return ack?.({success:false,error:'host_only'});
    if(room.started)return ack?.({success:true,lobby:this._roomSnapshot(room),started:true});
    if(room.members.size<1 || ![...room.members.values()].every(m=>m.ready))return ack?.({success:false,error:'players_not_ready'});
    room.started=true; room.game=new RoomGame(this.io,room,this.accounts); room.lastActivityAt=Date.now();
    this._broadcastLobby(room);
    this.io.to(`game:${room.code}`).emit('lobby:started',{code:room.code,mapId:room.mapId,mode:room.mode,difficulty:room.difficulty});
    ack?.({success:true,lobby:this._roomSnapshot(room),started:true});
  }

  _roomOf(socket) { return this.rooms.get(String(socket.data?.roomCode||'')) || null; }

  _routeGame(socket, ack, fn) {
    try { const room=this._roomOf(socket);if(!room?.started||!room.game)return ack?.({success:false,error:'game_not_started'});fn(room.game); }
    catch(err) { console.error('[game route]',err); ack?.({success:false,error:'server_error'}); }
  }
  _routeGameNoAck(socket, fn) { try { const room=this._roomOf(socket); if(room?.started&&room.game)fn(room.game); } catch(err){console.error('[game route]',err);} }

  _leaveLobby(socket, disconnected=false) {
    const room=this._roomOf(socket); if(!room)return;
    const member=room.members.get(socket.id);
    if(room.game)room.game._handleLeave(socket, disconnected);
    room.members.delete(socket.id);
    socket.leave?.(`game:${room.code}`);
    socket.data.roomCode=null;
    if(room.hostSocketId===socket.id)room.hostSocketId=room.members.keys().next().value||null;
    room.lastActivityAt=Date.now();
    if(room.members.size===0){if(!disconnected){ room.game?.stop(); this.rooms.delete(room.code); }}else this._broadcastLobby(room);
    if(member?.accountId)this._pushSocialToFriends(member.accountId);
  }

  _cleanupRooms() {
    const now=Date.now();
    for(const [id,invite] of this.invites)if(now>invite.expiresAt)this.invites.delete(id);
    for(const [code,room] of this.rooms){if(room.members.size===0 && now-room.lastActivityAt>config.ROOM_IDLE_DELETE_MS){room.game?.stop();this.rooms.delete(code);}}
  }
}

GameServer.MAPS=MAPS;
module.exports=GameServer;
