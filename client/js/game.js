/**
 * game.js
 * ------------------------------------------------------------
 * Orquestra todos os sistemas (mapa, câmera, jogador, input, UI,
 * zumbis, combate) e roda o game loop principal com delta time.
 *
 * Estados do jogo: 'menu' | 'playing' | 'paused'
 *
 * Multiplayer (Fase 2 — PHP + MySQL, veja js/network.js):
 *   - this.localPlayer   -> o jogador controlado por este cliente,
 *     sempre se move instantaneamente (nunca espera o servidor);
 *   - this.remotePlayers -> Map<id, RemotePlayer>, a MESMA instância
 *     mantida por network.js — atualizada via polling em sync.php
 *     e interpolada aqui a cada frame para um movimento suave.
 *
 * Zumbis/combate (Fase 3):
 *   - this.zombieManager -> Map<id, Zombie>, populado a partir do
 *     mesmo sync.php (item 15 — sem endpoint de zumbis separado);
 *   - this.combat        -> cooldown de tiro, tracers, hit markers,
 *     kill feed; a autoridade de dano/morte é sempre o servidor
 *     (api/shoot.php) — este arquivo só REAGE às respostas.
 *
 * Este arquivo nunca chama fetch()/PHP diretamente — toda
 * comunicação passa por this.network (NetworkManager).
 * ------------------------------------------------------------
 */

const WORLD_WIDTH = 4000;
const WORLD_HEIGHT = 4000;
const MAP_SEED = 20260823;

const GameState = {
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused'
};

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');

    this.ui = new UIManager();
    this.input = new InputManager();

    // Fase 2: única instância da camada de rede. Nenhum outro módulo
    // do jogo fala com fetch()/PHP diretamente — tudo passa por aqui.
    this.network = new NetworkManager();
    this._bindNetworkEvents();

    // VFX + zumbis + combate.
    this.vfx = new VFXManager();
    this.audio = new AudioManager();
    this.zombieManager = new ZombieManager();
    this.lootManager = new LootManager();
    this.interactionManager = new InteractionManager();
    this.combat = new CombatManager(this.network, this.zombieManager, this.vfx, this.audio);

    this._viewportWidth = window.innerWidth;
    this._viewportHeight = window.innerHeight;

    this.state = GameState.MENU;

    this.gameMap = null;
    this.camera = null;
    this.localPlayer = null;

    /** @type {Map<number, RemotePlayer>} populado por network.js a partir de sync.php */
    this.remotePlayers = this.network.remotePlayers;

    this.matchElapsedSeconds = 0;

    // True enquanto o jogador local está morto aguardando respawn
    // (item 34) — bloqueia movimento/tiro sem sair de GameState.PLAYING
    // (o mundo continua rodando ao redor: zumbis, outros jogadores).
    this.localPlayerDead = false;
    this.localPlayerDowned = false;
    this._lastKnownHealth = 100;
    this._revives = new Map();
    this._reviveStartPending = false;
    this._requestedReviveTargetId = null;

    this._lastTimestamp = 0;
    this._fpsAccumulator = 0;
    this._fpsFrames = 0;
    this._fpsDisplay = 0;

    this._networkStatusAccumulator = 0;
    this._minimapAccumulator = 0;
    this._lastRoundVfxKey = '';

    // Fases 12-20
    this._accountBootstrapped = false;
    this._pendingPlayAfterAccount = false;
    this._spectatorIndex = 0;
    this._spectatorTargetId = null;
    this._scoreboardPinned = false;
    this._lastScoreboardHeld = false;
    this._fullscreenAttempted = false;

    this._boundLoop = this._loop.bind(this);

    this._bindUIEvents();
    this._bindResize();
    this.input.onEscape(() => this._handleEscape());
    this.input.setAimSensitivity(this.ui.settings.aimSensitivity);
    this.vfx.setQuality(this.ui.settings.vfxQuality);
    window.addEventListener('zso:settings', (e) => this._applySettings(e.detail || this.ui.settings));
    this._applySettings(this.ui.settings);
    this._updateAppHeight();
    this._bootstrapSavedAccount();
    this._refreshLeaderboard();
    this._leaderboardTimer=setInterval(()=>{if(this.state===GameState.MENU)this._refreshLeaderboard();},30000);
    this._accountRetryTimer=setInterval(()=>{if(this.state===GameState.MENU&&this.network.profile?.hasAccount?.()&&!this._accountBootstrapped)this._bootstrapSavedAccount();},5000);
  }

  /* ---------------------------------------------------------- */
  /* EVENTOS DE REDE (Fase 2)                                     */
  /* ---------------------------------------------------------- */

  _bindNetworkEvents() {
    this.network.on('onConnectionLost', () => this.ui.showConnectionLostOverlay());
    this.network.on('onConnectionRestored', () => this.ui.hideConnectionLostOverlay());
    this.network.on('onServerFull', () => {
      this._joinErrorMessage = 'Servidor cheio. Tente novamente em instantes.';
    });
    // Fase 4: rounds compartilhados, autoritativos no servidor Node.
    this.network.on('onRoundUpdate', (round) => { this.ui.updateRoundHud(round); this.audio.playRound(round); const key=`${round?.state}:${round?.number}`; if(key!==this._lastRoundVfxKey){this._lastRoundVfxKey=key;if(round?.state==='running'){this.vfx.addFloatingText(round.bossRound?`⚠ BOSS ROUND ${round.number}`:`ROUND ${round.number}`,null,null,round.bossRound?'#ff765f':'#f1e2bd',true);this.vfx.addShake(round.bossRound?10:3);}} });

    // Tiros remotos: arma, muzzle flash, tracer, sangue/faíscas.
    this.network.on('onRemoteShot', (shot) => {
      const remote = this.remotePlayers.get(shot.playerId);
      if (remote) remote.triggerMuzzleFlash(shot.weaponId || 'pistol');
      this.combat.playRemoteShot(shot);
    });

    this.network.on('onRemoteReload', (data) => {
      const remote = this.remotePlayers.get(data?.playerId);
      if (remote) remote.triggerReload(Number(data?.durationMs) || 0);
    });

    this.network.on('onSelfUpdate', () => {
      this._syncLocalCombatState();
    });

    this.network.on('onLootUpdate', (evt) => {
      if (!evt) return;
      if (evt.type === 'snapshot') this.lootManager.applySnapshot(evt.items || []);
      else if (evt.type === 'spawn') this.lootManager.add(evt.item);
      else if (evt.type === 'removed') this.lootManager.remove(evt.id);
    });

    this.network.on('onInteractionUpdate', (evt) => {
      if (!evt) return;
      if (evt.type === 'snapshot') this.interactionManager.applySnapshot(evt.items || []);
      else if (evt.type === 'update') this.interactionManager.update(evt.item);
      this._syncDynamicObstacles();
    });

    this.network.on('onPlayerDowned', (data) => {
      if (!data?.playerId) return;
      const target = data.playerId === this.network.playerId ? this.localPlayer : this.remotePlayers.get(data.playerId)?._player;
      if (target) {
        target.downed = true;
        const x=(target._renderX??target.x)+target.width/2,y=(target._renderY??target.y)+target.height/2;
        this.vfx.addDownedPulse(x,y);
      }
      if (data.playerId === this.network.playerId) {
        this.localPlayerDowned = true;
        this.ui.showDownedScreen();
        this.audio.playDowned();
      } else {
        const name=target?.name||'Aliado';this.ui.showKillFeed(`${name} CAIU · REVIVA!`);
      }
    });

    this.network.on('onReviveStart', (data) => {
      if (!data?.targetId) return;
      this._revives.set(String(data.targetId), {...data});
      if (data.reviverId === this.network.playerId || data.targetId === this.network.playerId) this.audio.playReviveStart();
    });

    this.network.on('onReviveCancel', (data) => {
      if (!data?.targetId) return;
      this._revives.delete(String(data.targetId));
      if (data.reviverId === this.network.playerId) this._requestedReviveTargetId = null;
    });

    this.network.on('onPlayerRevived', (data) => {
      if (!data?.playerId) return;
      this._revives.delete(String(data.playerId));
      const target = data.playerId === this.network.playerId ? this.localPlayer : this.remotePlayers.get(data.playerId)?._player;
      if (target) {
        target.downed=false;target.alive=true;if(Number.isFinite(Number(data.health)))target.health=Number(data.health);
        const x=(target._renderX??target.x)+target.width/2,y=(target._renderY??target.y)+target.height/2;
        this.vfx.addRevivePulse(x,y,true);
      }
      if (data.playerId === this.network.playerId) {
        this.localPlayerDowned=false;this.ui.hideDownedScreen();this.audio.setLifeState('alive');
      }
      if (data.reviverId === this.network.playerId) {
        this._requestedReviveTargetId=null;
        if (data.reward) this.ui.showKillFeed(`ALIADO REVIVIDO · +$${data.reward}`);
      } else if (data.playerId !== this.network.playerId) this.ui.showKillFeed('ALIADO REVIVIDO');
      this.audio.playReviveComplete();
    });

    this.network.on('onZombieSpit', (data) => {
      if (!data) return;
      this.vfx.addSpit(Number(data.x), Number(data.y), Number(data.targetX), Number(data.targetY));
      if(this.localPlayer)this.audio.playSpit(Number(data.x),Number(data.y),{x:this.localPlayer.x+this.localPlayer.width/2,y:this.localPlayer.y+this.localPlayer.height/2});
    });

    this.network.on('onZombieExplode', (data) => {
      if (!data) return;
      this.vfx.addExplosion(Number(data.x), Number(data.y), Number(data.radius) || 110);
      if(this.localPlayer)this.audio.playExplosion(Number(data.x),Number(data.y),{x:this.localPlayer.x+this.localPlayer.width/2,y:this.localPlayer.y+this.localPlayer.height/2});
    });

    this.network.on('onFeed', evt => this.ui.addFeed(evt));
    this.network.on('onScoreboard', rows => this.ui.updateScoreboard(rows, this.network.playerId, this.network.roomCode));
    this.network.on('onBossIncoming', evt => {
      this.ui.showBossIncoming(evt);
      this.vfx.addShake(12);
      this.vfx.addFloatingText(`⚠ BOSS ROUND ${evt?.round || ''} ⚠`, null, null, '#ff695b', true);
    });
    this.network.on('onLobbyUpdate', lobby => this.ui.updateLobby(lobby, this.network.socket?.id));
    this.network.on('onLobbyStarted', () => {
      if (this.state === GameState.MENU && !this._joining) this.startGame();
    });
    this.network.on('onProfileUpdate', account => {
      if(account)this._accountBootstrapped=true;
      this.ui.updateProfile(account, (type,id) => this._selectProfileSkin(type,id));
      if(this.localPlayer){this.localPlayer.skinId=account?.selectedSkin||this.localPlayer.skinId;this.localPlayer.weaponSkinId=account?.selectedWeaponSkin||this.localPlayer.weaponSkinId;}
    });
    this.network.on('onDeath', data => {this.ui.setDeathPenalty(data?.penalty||null);this.audio.playDeath();if(data?.penalty)this.ui.showKillFeed(`MORTE · -$${data.penalty.moneyLost||0} · -${data.penalty.scoreLost||0} PTS`);});
    this.network.on('onSocialUpdate', social => this._renderSocial(social));
    this.network.on('onFriendInvite', invite => this.ui.showFriendInvite(invite));
    this.network.on('onFriendInviteResult', result => {if(result?.accepted)this.ui.showKillFeed(`${result.name||'AMIGO'} ENTROU NA SALA`);});
    this.network.on('onLeaderboard', rows => this.ui.renderLeaderboard(rows||[]));
  }

  /* ---------------------------------------------------------- */
  /* EVENTOS DE UI                                               */
  /* ---------------------------------------------------------- */

  _bindUIEvents() {
    this.ui.el.btnPlay?.addEventListener('click', () => this._openPlayFlow());
    this.ui.el.btnProfile?.addEventListener('click', () => this._openProfile());
    this.ui.el.btnFriends?.addEventListener('click', () => this._openFriends());
    this.ui.el.btnRankingRefresh?.addEventListener('click', () => this._refreshLeaderboard());
    this.ui.el.btnSettings?.addEventListener('click', () => this.ui.showSettingsModal(false));
    this.ui.el.btnCredits?.addEventListener('click', () => this.ui.showCreditsModal());

    this.ui.el.btnAccountCreate?.addEventListener('click', () => this._createAccount());
    this.ui.el.inputAccountName?.addEventListener('keydown', e => { if(e.key==='Enter') this._createAccount(); });
    this.ui.el.btnCopyFriendCode?.addEventListener('click', async()=>{const code=this.network.social?.friendCode||this.network.account?.friendCode||'';try{await navigator.clipboard.writeText(code);this.ui.setFriendsMessage('Código copiado!',true);}catch(_){this.ui.setFriendsMessage(`Seu código: ${code}`,true);}});
    this.ui.el.inputFriendCode?.addEventListener('input',e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-F0-9]/g,'').slice(0,8));
    this.ui.el.inputFriendCode?.addEventListener('keydown',e=>{if(e.key==='Enter')this._addFriend();});
    this.ui.el.btnAddFriend?.addEventListener('click',()=>this._addFriend());
    this.ui.el.btnFriendInviteAccept?.addEventListener('click',()=>this._respondInvite(true));
    this.ui.el.btnFriendInviteDecline?.addEventListener('click',()=>this._respondInvite(false));

    this.ui.el.btnLobbyClose?.addEventListener('click', () => this._closeLobby());
    this.ui.el.btnQuickPlay?.addEventListener('click', () => this._quickPlay());
    this.ui.el.btnCreateRoom?.addEventListener('click', () => this._createRoom());
    this.ui.el.btnJoinRoom?.addEventListener('click', () => this._joinRoom());
    this.ui.el.inputRoomCode?.addEventListener('input', e => e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5));
    this.ui.el.inputRoomCode?.addEventListener('keydown', e => { if(e.key==='Enter') this._joinRoom(); });
    this.ui.el.btnCopyRoomCode?.addEventListener('click', async () => { try{await navigator.clipboard.writeText(this.network.roomCode||'');this.ui.setLobbyMessage('Código copiado!','room',true);}catch(_){this.ui.setLobbyMessage('Código: '+(this.network.roomCode||''),'room',true);} });
    this.ui.el.btnLobbyReady?.addEventListener('click', () => this._toggleLobbyReady());
    this.ui.el.btnLobbyStart?.addEventListener('click', () => this._startLobby());
    this.ui.el.btnLobbyLeave?.addEventListener('click', () => this._leaveLobby());
    this.ui.el.lobbyMapSelect?.addEventListener('change', e => {this.ui.previewLobbyMap?.(e.target.value);this._setLobbyMap(e.target.value);});

    this.ui.el.btnResume?.addEventListener('click', () => this.resume());
    this.ui.el.btnPauseSettings?.addEventListener('click', () => this.ui.showSettingsModal(true));
    this.ui.el.btnBackToMenu?.addEventListener('click', () => this.returnToMenu());
    this.ui.el.btnPauseMobile?.addEventListener('click', () => this._handleEscape());
    this.ui.el.btnRespawn?.addEventListener('click', () => this._handleRespawnClick());
    this.ui.el.btnDeathBackToMenu?.addEventListener('click', () => this.returnToMenu());
    this.ui.el.btnSpectatePrev?.addEventListener('click', () => this._cycleSpectator(-1));
    this.ui.el.btnSpectateNext?.addEventListener('click', () => this._cycleSpectator(1));
    this.ui.el.btnScoreboardHud?.addEventListener('click', () => {this._scoreboardPinned=!this._scoreboardPinned;this._updateScoreboardVisibility();});
    this.ui.el.btnMobileScore?.addEventListener('click', () => {this._scoreboardPinned=!this._scoreboardPinned;this._updateScoreboardVisibility();});

    this.ui.el.btnShopHud?.addEventListener('click', () => this._toggleShop());
    this.ui.el.inputVolume?.addEventListener('input', () => {this.vfx.setMasterVolume(this.ui.settings.volume/100);this.audio.setMasterVolume(this.ui.settings.volume/100);});
    this.ui.el.btnFullscreenHud?.addEventListener('click', () => this._requestMobileFullscreen(true));
    this.ui.el.btnSettingsFullscreen?.addEventListener('click', () => this._requestMobileFullscreen(true));
  }

  _bindResize() {
    const resize = () => { this._updateAppHeight(); this._resizeCanvas(); };
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', () => this._updateAppHeight());
    window.addEventListener('orientationchange', () => { setTimeout(resize, 120); setTimeout(resize, 420); });
    document.addEventListener('fullscreenchange', () => setTimeout(resize, 40));
  }

  _updateAppHeight() {
    const h = Math.max(1, Math.round(window.visualViewport?.height || window.innerHeight));
    document.documentElement.style.setProperty('--app-height', `${h}px`);
  }

  async _requestMobileFullscreen(force=false) {
    if (!this.input.isTouchDevice && !force) return false;
    this._fullscreenAttempted = true;
    try {
      const root=document.documentElement;
      if(!document.fullscreenElement && root.requestFullscreen) await root.requestFullscreen({navigationUI:'hide'});
    } catch(_) {}
    try { await screen.orientation?.lock?.('landscape'); } catch(_) {}
    try { window.scrollTo(0,1); } catch(_) {}
    setTimeout(()=>{this._updateAppHeight();this._resizeCanvas();},120);
    return !!document.fullscreenElement;
  }

  _applySettings(settings={}) {
    this.input.setAimSensitivity(settings.aimSensitivity);
    this.input.setHudMode(settings.hudMode||'auto');
    this.ui.applyHudMode(settings.hudMode||'auto');
    this.vfx.setQuality(settings.vfxQuality || 'auto');
    this.vfx.setMasterVolume((Number(settings.volume)||0)/100);
    this.audio.setMasterVolume((Number(settings.volume)||0)/100);
  }

  /** Tenta travar a orientação em paisagem (não garantido em todo navegador). */
  _tryLockLandscape() {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {
        // Ignorado de propósito: nem todo navegador/contexto permite
        // travar a orientação (ex.: fora de tela cheia). O overlay de
        // CSS "VIRE O CELULAR" cobre esse caso de qualquer forma.
      });
    }
  }

  async _bootstrapSavedAccount() {
    if (!this.network.profile?.hasAccount?.()) return;
    try {
      const r=await this.network.bootstrapAccount('');
      if(r?.success){this._accountBootstrapped=true;this.ui.updateProfile(this.network.account,(type,id)=>this._selectProfileSkin(type,id));this._renderSocial(this.network.social);this.ui.renderLeaderboard(this.network.leaderboard||[]);}
    } catch(_) {}
  }

  async _ensureAccount() {
    if(this._accountBootstrapped && this.network.account) return true;
    if(this.network.profile?.hasAccount?.()){
      const r=await this.network.bootstrapAccount('');
      if(r?.success){this._accountBootstrapped=true;this.ui.updateProfile(this.network.account,(type,id)=>this._selectProfileSkin(type,id));this._renderSocial(this.network.social);this.ui.renderLeaderboard(this.network.leaderboard||[]);return true;}
    }
    return false;
  }

  async _openPlayFlow() {
    this._requestMobileFullscreen(false);
    if(!await this._ensureAccount()){this._pendingPlayAfterAccount=true;this.ui.showAccountModal();return;}
    this.ui.showLobbyHome(this.network.maps);
  }

  async _createAccount() {
    const name=this.ui.getAccountName();
    if(name.length<2){this.ui.setAccountMessage('Use pelo menos 2 caracteres.');return;}
    this.ui.el.btnAccountCreate.disabled=true;this.ui.setAccountMessage('Criando...');
    try{
      const r=await this.network.bootstrapAccount(name);
      if(!r?.success){this.ui.setAccountMessage(r?.error==='name_required'?'Escolha um nome válido.':'Não foi possível criar a conta.');return;}
      this._accountBootstrapped=true;this.ui.hideAccountModal();this.ui.updateProfile(this.network.account,(type,id)=>this._selectProfileSkin(type,id));this._renderSocial(this.network.social);this.ui.renderLeaderboard(this.network.leaderboard||[]);
      if(this._pendingPlayAfterAccount){this._pendingPlayAfterAccount=false;this.ui.showLobbyHome(this.network.maps);}
    }catch(_){this.ui.setAccountMessage('Servidor indisponível. Tente novamente.');}
    finally{this.ui.el.btnAccountCreate.disabled=false;}
  }

  async _openProfile(){
    if(!await this._ensureAccount()){this._pendingPlayAfterAccount=false;this.ui.showAccountModal();return;}
    this.ui.updateProfile(this.network.account,(type,id)=>this._selectProfileSkin(type,id));this.ui.showProfile();
  }

  async _selectProfileSkin(type,id){
    const r=await this.network.selectProfile(type==='character'?{skinId:id}:{weaponSkinId:id});
    if(r?.success){this.ui.updateProfile(this.network.account,(t,v)=>this._selectProfileSkin(t,v));if(this.localPlayer){this.localPlayer.skinId=this.network.account.selectedSkin;this.localPlayer.weaponSkinId=this.network.account.selectedWeaponSkin;}}
  }

  _renderSocial(social=this.network.social){
    const accountCode=this.network.account?.friendCode||this.network.profile?.account?.friendCode||'';
    const merged={...(social||{}),friendCode:(social?.friendCode&&social.friendCode!=='--------')?social.friendCode:(accountCode||'--------')};
    this.ui.updateSocial(merged,{canInvite:!!this.network.roomCode&&!this.network.lobby?.started,onRespond:(id,accept)=>this._respondFriend(id,accept),onInvite:id=>this._inviteFriend(id),onRemove:id=>this._removeFriend(id)});
  }
  async _openFriends(){if(!await this._ensureAccount()){this._pendingPlayAfterAccount=false;this.ui.showAccountModal();return;}this.ui.showFriends();this._renderSocial(this.network.social);const r=await this.network.getSocial();if(r?.success)this._renderSocial(r.social);}
  async _addFriend(){const code=String(this.ui.el.inputFriendCode?.value||'').trim().toUpperCase();if(code.length!==8){this.ui.setFriendsMessage('Digite um código de 8 caracteres.');return;}this.ui.setFriendsMessage('Enviando pedido...');const r=await this.network.addFriend(code);const msg={friend_not_found:'Código não encontrado.',cannot_add_self:'Você não pode se adicionar.',already_friends:'Vocês já são amigos.',request_already_sent:'Pedido já enviado.'}[r?.error];if(r?.success){this.ui.setFriendsMessage('Pedido enviado!',true);if(this.ui.el.inputFriendCode)this.ui.el.inputFriendCode.value='';this._renderSocial(this.network.social);}else this.ui.setFriendsMessage(msg||'Não foi possível enviar o pedido.');}
  async _respondFriend(id,accept){const r=await this.network.respondFriend(id,accept);if(r?.success){this.ui.setFriendsMessage(accept?'Amigo adicionado!':'Pedido recusado.',true);this._renderSocial(this.network.social);}}
  async _removeFriend(id){const r=await this.network.removeFriend(id);if(r?.success){this.ui.setFriendsMessage('Amigo removido.',true);this._renderSocial(this.network.social);}}
  async _inviteFriend(id){const r=await this.network.inviteFriend(id);const msg={create_room_first:'Crie/entre em uma sala primeiro.',room_started:'A partida já começou.',friend_offline:'Esse amigo está offline.',room_full:'Sala cheia.',not_friends:'Vocês não são amigos.'}[r?.error];this.ui.setFriendsMessage(r?.success?'Convite enviado!':(msg||'Não foi possível convidar.'),!!r?.success);}
  async _respondInvite(accept){const invite=this.network.pendingInvite;if(!invite){this.ui.hideFriendInvite();return;}const r=await this.network.respondInvite(invite.id,accept);this.ui.hideFriendInvite();if(r?.success&&r.accepted&&r.lobby){this.ui.showLobbyRoom(r.lobby,this.network.socket?.id);this._renderSocial(this.network.social);}else if(accept&&!r?.success)this.ui.showKillFeed('CONVITE EXPIRADO');}
  async _refreshLeaderboard(){const r=await this.network.getLeaderboard(12);if(r?.success)this.ui.renderLeaderboard(r.rows||[]);}

  async _quickPlay(){this._requestMobileFullscreen(false);this.ui.setLobbyMessage('Procurando partida...','home');const r=await this.network.quickLobby(this.ui.el.lobbyMapSelect?.value||'city');if(!r?.success){this.ui.setLobbyMessage('Não foi possível entrar no jogo rápido.','home');return;}this.ui.showLobbyRoom(r.lobby,this.network.socket?.id);if(r.started&&!this._joining)this.startGame();}
  async _createRoom(){this.ui.setLobbyMessage('Criando sala...','home');const r=await this.network.createLobby(this.ui.el.lobbyMapSelect?.value||'city');if(!r?.success){this.ui.setLobbyMessage('Não foi possível criar a sala.','home');return;}this.ui.showLobbyRoom(r.lobby,this.network.socket?.id);this.network.getSocial().then(()=>this._renderSocial(this.network.social));}
  async _joinRoom(){const code=String(this.ui.el.inputRoomCode?.value||'').trim().toUpperCase();if(code.length<4){this.ui.setLobbyMessage('Digite o código da sala.','home');return;}this.ui.setLobbyMessage('Entrando...','home');const r=await this.network.joinLobby(code);if(!r?.success){const msg={room_not_found:'Sala não encontrada.',room_already_started:'A partida já começou.',room_full:'Sala cheia.'}[r?.error]||'Não foi possível entrar.';this.ui.setLobbyMessage(msg,'home');return;}this.ui.showLobbyRoom(r.lobby,this.network.socket?.id);this.network.getSocial().then(()=>this._renderSocial(this.network.social));}
  async _leaveLobby(){await this.network.leaveLobby();this.ui.showLobbyHome(this.network.maps);}
  async _closeLobby(){if(this.network.roomCode)await this.network.leaveLobby();this.ui.hideLobby();}
  async _toggleLobbyReady(){const me=(this.network.lobby?.members||[]).find(m=>m.socketId===this.network.socket?.id);const r=await this.network.setLobbyReady(!me?.ready);if(r?.success&&r.lobby){this.network.lobby=r.lobby;this.ui.updateLobby(r.lobby,this.network.socket?.id);}}
  async _setLobbyMap(mapId){const r=await this.network.setLobbyMap(mapId);if(!r?.success)this.ui.setLobbyMessage(r?.error==='host_only'?'Só o host escolhe o mapa.':'Não foi possível trocar o mapa.','room');}
  async _startLobby(){this._requestMobileFullscreen(false);const r=await this.network.startLobby();if(!r?.success){this.ui.setLobbyMessage(r?.error==='players_not_ready'?'Todos precisam marcar PRONTO.':'Não foi possível iniciar.','room');return;}if(r.started&&!this._joining)this.startGame();}

  _cycleSpectator(dir=1){const ids=[...this.remotePlayers.entries()].filter(([,r])=>r?._player?.alive!==false).map(([id])=>id);if(!ids.length){this._spectatorTargetId=null;this.ui.updateSpectator(null);return;}let index=ids.indexOf(this._spectatorTargetId);if(index<0)index=0;else index=(index+dir+ids.length)%ids.length;this._spectatorTargetId=ids[index];this.ui.updateSpectator(this.remotePlayers.get(this._spectatorTargetId)?._player?.name||'Aliado');}
  _getSpectatorTarget(){if(!this.localPlayerDead)return null;let r=this.remotePlayers.get(this._spectatorTargetId);if(!r||r._player?.alive===false){this._cycleSpectator(1);r=this.remotePlayers.get(this._spectatorTargetId);}return r||null;}
  _updateScoreboardVisibility(){const show=this._scoreboardPinned||this.input.isScoreboardHeld();if(show)this.ui.showScoreboard();else this.ui.hideScoreboard();}

  _handleEscape() {
    if (this.state === GameState.PLAYING) {
      this.pause();
    } else if (this.state === GameState.PAUSED) {
      this.resume();
    }
  }

  async _handleRespawnClick() {
    if (this.ui.el.btnRespawn.disabled) return;
    const player = await this.network.respawn();
    if (!player) return; // falha de rede — o botão continua ativo, pode tentar de novo

    this.localPlayer.x = player.x;
    this.localPlayer.y = player.y;
    this.localPlayer.health = player.health;
    this.localPlayer.alive = true;
    this.localPlayer.downed = false;
    this.localPlayerDowned = false;
    this._lastKnownHealth = player.health;
    this.camera.snapTo(player.x + this.localPlayer.width / 2, player.y + this.localPlayer.height / 2);

    this.localPlayerDead = false;this._spectatorTargetId=null;this._spectatorIndex=0;
    this.ui.hideDeathScreen();
    this.ui.hideDownedScreen();
    this.ui.setDeathPenalty(null);
    this.audio.playRespawn();
  }


  _syncLocalCombatState() {
    const loadout = this.network.loadout || {};
    if (this.localPlayer) {
      this.localPlayer.setWeapon(loadout.activeWeaponId || 'pistol');
      if (Number.isFinite(Number(loadout.speed))) this.localPlayer.speed = Number(loadout.speed);
      const weapon = clientWeapon(loadout.activeWeaponId || 'pistol');
      this.localPlayer.setReloadState(
        loadout.reloading ? Number(loadout.reloadRemainingMs) || 0 : 0,
        weapon.reloadMs
      );
      this.localPlayer.maxHealth = this.network.localMaxHealth || this.localPlayer.maxHealth;
      this.localPlayer.downed = this.network.localDowned === true;
      this.localPlayer.skinId = this.network.account?.selectedSkin || loadout.skinId || this.localPlayer.skinId;
      this.localPlayer.weaponSkinId = this.network.account?.selectedWeaponSkin || loadout.weaponSkinId || this.localPlayer.weaponSkinId;
    }
    this.ui.updateCombatHud(
      loadout,
      this.network.localMoney,
      this.network.localKills,
      this.network.localHeadshots,
      this.network.localScore
    );
    this.ui.updateShop(this.network.shopCatalog, {
      ...loadout,
      money: this.network.localMoney,
    });
  }

  _syncDynamicObstacles() {
    if (this.gameMap) this.gameMap.setDynamicObstacles(this.interactionManager.getBlockingObstacles());
  }

  _nearestDownedAlly(maxDistance=92) {
    if (!this.localPlayer) return null;
    const cx=this.localPlayer.x+this.localPlayer.width/2,cy=this.localPlayer.y+this.localPlayer.height/2;
    let best=null,bestD=maxDistance;
    for(const [id,remote] of this.remotePlayers){
      const rp=remote?._player;if(!rp||rp.alive===false||rp.downed!==true)continue;
      const rx=(remote._visualX??rp.x)+rp.width/2,ry=(remote._visualY??rp.y)+rp.height/2,d=Math.hypot(rx-cx,ry-cy);
      if(d<=bestD){bestD=d;best={id:String(id),name:rp.name||'Aliado',distance:d,remote};}
    }
    return best;
  }

  _activeReviveByMe() {
    for(const [targetId,r] of this._revives){if(r?.reviverId===this.network.playerId)return{targetId,...r};}
    return null;
  }

  _cancelMyRevive(targetId) {
    if(!targetId)return;
    this._revives.delete(String(targetId));
    this._requestedReviveTargetId=null;
    this.network.cancelRevive(targetId).catch?.(()=>{});
  }

  _updateReviveFlow() {
    const nearest=this._nearestDownedAlly(92);
    let active=this._activeReviveByMe();
    const blocked=this.localPlayerDead||this.localPlayerDowned||this.ui.isShopOpen();
    const held=this.input.isInteractHeld();

    if(blocked){
      if(active)this._cancelMyRevive(active.targetId);
      this.ui.updateRevivePrompt(null,null);
      return nearest;
    }

    if(held&&nearest){
      if(active&&String(active.targetId)!==String(nearest.id)){this._cancelMyRevive(active.targetId);active=null;}
      if(!active&&!this._reviveStartPending&&this._requestedReviveTargetId!==nearest.id){
        this._reviveStartPending=true;this._requestedReviveTargetId=nearest.id;
        this.network.startRevive(nearest.id).then(r=>{
          this._reviveStartPending=false;
          if(!r?.success){this._requestedReviveTargetId=null;if(r?.error==='already_reviving')this.ui.showKillFeed('OUTRO ALIADO JÁ ESTÁ REVIVENDO');}
        }).catch(()=>{this._reviveStartPending=false;this._requestedReviveTargetId=null;});
      }
    }else if(active){
      this._cancelMyRevive(active.targetId);active=null;
    }else if(!held){
      this._requestedReviveTargetId=null;
    }

    active=this._activeReviveByMe();
    let display=null;
    if(active){
      const elapsed=Date.now()-Number(active.startedAt||Date.now()),duration=Math.max(1,Number(active.durationMs)||3200);
      const target=this.remotePlayers.get(active.targetId)?._player;
      display={...active,targetName:target?.name||nearest?.name||'Aliado',progress:Math.max(0,Math.min(1,elapsed/duration))};
      if(target){const x=(target._renderX??target.x)+target.width/2,y=(target._renderY??target.y)+target.height/2;if(Math.floor(elapsed/280)!==Math.floor((elapsed-16)/280))this.vfx.addRevivePulse(x,y,false);}
    }
    this.ui.updateRevivePrompt(nearest,display);
    return nearest;
  }

  async _interactNearest() {
    if (!this.localPlayer || this.localPlayerDead || this.localPlayerDowned) return;
    if (this._nearestDownedAlly(92)) return;
    const cx=this.localPlayer.x+this.localPlayer.width/2,cy=this.localPlayer.y+this.localPlayer.height/2;
    const nearest=this.interactionManager.nearest(cx,cy,115);
    if(!nearest)return;
    const r=await this.network.interact(nearest.item.id);
    if(!r?.success){const msg={not_enough_money:'DINHEIRO INSUFICIENTE',already_active:'GERADOR JÁ ESTÁ LIGADO',already_used:'CAIXA VAZIA',too_far:'CHEGUE MAIS PERTO',health_full:'VIDA JÁ ESTÁ CHEIA',invalid_weapon:'ARMA INVÁLIDA'}[r?.error]||'NÃO FOI POSSÍVEL USAR';this.ui.showKillFeed(msg);return;}
    if(r.item)this.interactionManager.update(r.item);this._syncDynamicObstacles();this.audio.playInteraction(r.item?.type||nearest.item.type);
    if(r.reward){const t=r.reward.kind==='money'?`+$${r.reward.amount}`:r.reward.kind==='ammo'?`+${r.reward.amount} MUNIÇÃO`:`+${r.reward.amount} VIDA`;this.ui.showKillFeed(t);this.audio.playPickup();}
    else this.ui.showKillFeed(r.item?.label||'INTERAÇÃO CONCLUÍDA');
    this._syncLocalCombatState();
  }

  _toggleShop() {
    if (this.ui.isShopOpen()) {
      this.ui.hideShop();
      return;
    }
    if (this.network.round?.state !== 'intermission') {
      this.ui.showShopMessage('A loja abre entre os rounds.');
      return;
    }
    this.ui.showShop(
      this.network.shopCatalog,
      { ...this.network.loadout, money: this.network.localMoney },
      (itemId) => this._buyShopItem(itemId)
    );
  }

  async _buyShopItem(itemId) {
    const result = await this.network.buy(itemId);
    if (!result?.success) {
      const messages = {
        not_enough_money: 'Dinheiro insuficiente.',
        already_owned: 'Você já possui essa arma.',
        health_full: 'Sua vida já está cheia.',
        max_level: 'Upgrade já está no nível máximo.',
        shop_closed: 'A loja fechou.',
      };
      this.ui.showShopMessage(messages[result?.error] || 'Não foi possível comprar.');
      return;
    }
    this._syncLocalCombatState();
    this.ui.showShopMessage('Compra realizada!', true);
  }

  async _pickupNearestLoot() {
    if (!this.localPlayer || this.localPlayerDead || this.localPlayerDowned) return;
    const centerX = this.localPlayer.x + this.localPlayer.width / 2;
    const centerY = this.localPlayer.y + this.localPlayer.height / 2;
    const nearest = this.lootManager.nearest(centerX, centerY, 82);
    if (!nearest) return;
    const result = await this.network.pickupLoot(nearest.item.id);
    if (!result?.success) return;
    const item = result.item || nearest.item;
    const label = item.kind === 'money' ? `+$${item.amount}`
      : item.kind === 'ammo' ? `+${item.amount} MUNIÇÃO`
      : item.kind === 'medkit' ? `+${item.amount} VIDA`
      : `${clientWeapon(item.weaponId).name.toUpperCase()} COLETADA`;
    this.ui.showKillFeed(label);
    this.audio.playPickup();
    this._syncLocalCombatState();
  }

  _handleGameplayActions() {
    const interactPressed=this.input.consumeAction('interact');
    if (this.localPlayerDead || this.localPlayerDowned) return;
    if (this.input.consumeAction('reload')) {
      this.network.reload().then((r) => {
        if (r?.success) { this._syncLocalCombatState(); this.audio.playReload(this.network.loadout?.activeWeaponId||'pistol'); }
      });
    }
    if (this.input.consumeAction('slot1')) this.network.switchWeapon(0).then(() => this._syncLocalCombatState());
    if (this.input.consumeAction('slot2')) this.network.switchWeapon(1).then(() => this._syncLocalCombatState());
    if (this.input.consumeAction('switchNext')) this.network.switchWeapon(null).then(() => this._syncLocalCombatState());
    if (interactPressed && !this._nearestDownedAlly(92)) this._interactNearest();
    if (this.input.consumeAction('pickup')) this._pickupNearestLoot();
    if (this.input.consumeAction('shop')) this._toggleShop();
  }

  /* ---------------------------------------------------------- */
  /* CICLO DE VIDA DO JOGO                                        */
  /* ---------------------------------------------------------- */

  async startGame() {
    if (this._joining) return;
    this._joining = true;

    const name = this.network.account?.name || this.network.profile?.name?.() || 'Sobrevivente';
    let joinData;
    try {
      joinData = await this.network.join(name);
    } catch (err) {
      this._joining = false;
      const message = this._joinErrorMessage
        || 'Não foi possível entrar no jogo. Verifique sua conexão e tente novamente.';
      this._joinErrorMessage = null;
      alert(message); // eslint-disable-line no-alert -- feedback simples, sem modal dedicado nesta fase
      return;
    }
    this._joining = false;

    this.ui.hideLobby();
    this.ui.showGameScreen();
    this._resizeCanvas();
    this._tryLockLandscape();

    // Gera o mundo (determinístico pela seed — igual em todos os clientes)
    this.gameMap = new GameMap(WORLD_WIDTH, WORLD_HEIGHT, MAP_SEED, this.network.mapId || 'city');

    // Posição inicial validada/atribuída pelo servidor (join.php), não
    // escolhida pelo cliente — evita todo mundo nascer empilhado.
    const spawn = joinData.player;
    this.localPlayer = new Player({
      id: String(spawn.id),
      name: spawn.name,
      x: spawn.x,
      y: spawn.y
    });
    this.localPlayer.alive = spawn.alive ?? true;
    this.localPlayer.skinId = this.network.account?.selectedSkin || this.network.loadout?.skinId || 'survivor_blue';
    this.localPlayer.weaponSkinId = this.network.account?.selectedWeaponSkin || this.network.loadout?.weaponSkinId || 'default';
    this.localPlayer.downed = spawn.downed ?? this.network.localDowned ?? false;
    this.localPlayerDowned = this.localPlayer.downed;
    this._lastKnownHealth = spawn.health ?? 100;

    // A câmera trabalha em pixels CSS. canvas.width/height são pixels
    // físicos (DPR) e no mobile podem ser 2x/3x maiores, o que empurrava
    // o jogador para o canto da tela.
    this.camera = new Camera(this._viewportWidth, this._viewportHeight, WORLD_WIDTH, WORLD_HEIGHT);
    this.camera.snapTo(
      spawn.x + this.localPlayer.width / 2,
      spawn.y + this.localPlayer.height / 2
    );

    this.localPlayerDead = false;this._spectatorTargetId=null;this.ui.updateSpectator(null);
    this.ui.hideDeathScreen();

    this.ui.updatePlayerName(this.localPlayer.name);
    this.ui.updateHealth(this.localPlayer.health, this.localPlayer.maxHealth);
    this.ui.updateNetworkStatus({ connected: true, playerCount: 1, pingMs: null });
    this.ui.updateRoundHud(this.network.round);
    this.lootManager.applySnapshot(this.network.lastLoot);
    this.interactionManager.applySnapshot(this.network.lastInteractions);
    this._syncDynamicObstacles();
    this.vfx.setMasterVolume(this.ui.settings.volume / 100);
    this.audio.setMasterVolume(this.ui.settings.volume / 100);
    this.audio.unlock();
    this.audio.setGameActive(true);
    this.audio.setRoundState(this.network.round);
    this._syncLocalCombatState();

    this.matchElapsedSeconds = 0;
    this.state = GameState.PLAYING;

    this._lastTimestamp = performance.now();
    requestAnimationFrame(this._boundLoop);
  }

  pause() {
    if (this.state !== GameState.PLAYING) return;
    this.state = GameState.PAUSED;
    this.ui.showPauseMenu();
  }

  resume() {
    if (this.state !== GameState.PAUSED) return;
    this.ui.hidePauseMenu();
    this.state = GameState.PLAYING;
    this._lastTimestamp = performance.now();
    requestAnimationFrame(this._boundLoop);
  }

  returnToMenu() {
    this.state = GameState.MENU;
    this.ui.hidePauseMenu();
    this.ui.hideDeathScreen();
    this.ui.showMainMenu();
    this.ui.hideConnectionLostOverlay();
    this.ui.hideScoreboard();this._scoreboardPinned=false;

    // Avisa o servidor que saímos de forma limpa (item 11). Não espera
    // a resposta para não travar a transição de tela.
    this.network.leave();

    // Libera as referências do mundo atual (nova partida gera tudo de novo)
    this.gameMap = null;
    this.camera = null;
    this.localPlayer = null;
    this.localPlayerDead = false;
    this.localPlayerDowned = false;
    this._revives.clear();this._reviveStartPending=false;this._requestedReviveTargetId=null;
    this.ui.hideDownedScreen();this.ui.updateRevivePrompt(null,null);
    this.zombieManager.zombies.clear();
    this.lootManager.clear();
    this.interactionManager.clear();
    this.vfx.reset();
    this.audio.setGameActive(false);
  }

  /* ---------------------------------------------------------- */
  /* CANVAS / RESPONSIVIDADE                                     */
  /* ---------------------------------------------------------- */

  _resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const vv = window.visualViewport;
    // visualViewport exclui a barra do navegador quando ela está visível e
    // evita o canvas ficar escondido atrás do Chrome/Safari mobile.
    const width = Math.max(1, Math.round(vv?.width || rect.width || window.innerWidth));
    const height = Math.max(1, Math.round(vv?.height || rect.height || window.innerHeight));

    this._viewportWidth = width;
    this._viewportHeight = height;

    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';

    // Toda a lógica de câmera/render continua em pixels CSS.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (this.camera) {
      this.camera.resize(width, height);

      // Resize/orientationchange nunca move o jogador no mundo; apenas
      // recentraliza a câmera usando o centro visual do player.
      if (this.localPlayer) {
        this.camera.snapTo(
          this.localPlayer.x + this.localPlayer.width / 2,
          this.localPlayer.y + this.localPlayer.height / 2
        );
      }
    }
  }

  /* ---------------------------------------------------------- */
  /* GAME LOOP                                                    */
  /* ---------------------------------------------------------- */

  _loop(timestamp) {
    if (this.state !== GameState.PLAYING) return; // pausa interrompe o loop

    let dt = (timestamp - this._lastTimestamp) / 1000;
    this._lastTimestamp = timestamp;
    // Evita "saltos" grandes (ex.: aba voltou do background)
    dt = Math.min(dt, 0.05);

    this._updateFps(dt);
    this._update(dt);
    this._render();

    requestAnimationFrame(this._boundLoop);
  }

  _updateFps(dt) {
    this._fpsAccumulator += dt;
    this._fpsFrames++;
    if (this._fpsAccumulator >= 0.5) {
      this._fpsDisplay = Math.round(this._fpsFrames / this._fpsAccumulator);
      this._fpsAccumulator = 0;
      this._fpsFrames = 0;
      this.ui.updateFps(this._fpsDisplay);
      this.vfx.reportFps?.(this._fpsDisplay, this.ui.settings.vfxQuality || 'auto');
    }
  }

  _update(dt) {
    this.matchElapsedSeconds += dt;

    // --- Fase 3: aplica o estado autoritativo (health/alive/kills) ---
    // vindo da última resposta de sync.php, ANTES de decidir input —
    // um jogador morto não deve conseguir se mover/atirar mesmo que o
    // clique/tecla já esteja pressionado (item 34).
    this.input.update(dt);
    this._applyAuthoritativeState();
    this._handleGameplayActions();
    if(this.input.consumeAction('scoreboardToggle'))this._scoreboardPinned=!this._scoreboardPinned;
    if(this.input.consumeAction('spectatePrev'))this._cycleSpectator(-1);
    if(this.input.consumeAction('spectateNext'))this._cycleSpectator(1);
    this._updateScoreboardVisibility();

    const move = this.localPlayerDead || this.localPlayerDowned || this.ui.isShopOpen() ? { x: 0, y: 0 } : this.input.getMoveVector();
    this.localPlayer.updatePlayer(dt, move.x, move.y, this.gameMap);
    this.localPlayer.updateWeaponVisuals(dt);

    const spectator = this._getSpectatorTarget();
    const followPlayer = spectator?._player || this.localPlayer;
    const followX = spectator ? spectator._visualX + followPlayer.width / 2 : this.localPlayer.x + this.localPlayer.width / 2;
    const followY = spectator ? spectator._visualY + followPlayer.height / 2 : this.localPlayer.y + this.localPlayer.height / 2;
    this.camera.follow(followX, followY, dt);
    if(this.localPlayerDead)this.ui.updateSpectator(spectator?._player?.name||null);

    // --- Mira contínua + tiro (itens 20-23) ---------------------------
    if (!this.localPlayerDead && !this.localPlayerDowned && !this.ui.isShopOpen()) {
      this._updateAimingAndShooting(dt);
    }

    // O movimento local é sempre instantâneo (nunca espera o PHP).
    // Aqui só informamos à camada de rede qual é o estado atual; o
    // envio real acontece no timer interno de network.js, em intervalo
    // bem menor que os 60 FPS do loop de render (evita sobrecarregar
    // a hospedagem compartilhada).
    this.network.setLocalState(
      this.localPlayer.x, this.localPlayer.y, this.localPlayer.direction,
      this.localPlayer.moving, this.localPlayer.vx, this.localPlayer.vy,
      this.localPlayer.aimDirX, this.localPlayer.aimDirY
    );

    // Jogadores remotos nunca são movidos por input local — apenas
    // suavizados (interpolados) em direção ao último snapshot recebido
    // via network.js.
    for (const remote of this.remotePlayers.values()) {
      remote.interpolate(dt);
    }

    const nearDownedAlly=this._updateReviveFlow();

    // --- Fase 3: zumbis + combate --------------------------------------
    this.zombieManager.applySnapshots(this.network.lastZombies);
    this.zombieManager.update(dt);
    this.combat.update(dt);
    this.vfx.update(dt);
    this.audio.update(dt, this.localPlayer, this.zombieManager.zombies);
    this.audio.setRoundState(this.network.round);

    const lootCenterX = this.localPlayer.x + this.localPlayer.width / 2;
    const lootCenterY = this.localPlayer.y + this.localPlayer.height / 2;
    this.ui.updateLootPrompt((this.localPlayerDowned||nearDownedAlly)?null:this.lootManager.nearest(lootCenterX, lootCenterY, 82));
    const nearInteraction=this.localPlayerDowned?null:this.interactionManager.nearest(lootCenterX,lootCenterY,115);
    this.ui.updateInteractionPrompt(nearDownedAlly?null:nearInteraction,this.interactionManager);
    this.ui.updateZone(this.gameMap.getZoneAt(lootCenterX,lootCenterY));
    this.ui.updateAllies(this.remotePlayers);
    this._minimapAccumulator+=dt;if(this._minimapAccumulator>=.16){this._minimapAccumulator=0;this._renderMinimap();}

    // Fase 4: HUD de round/zumbis usa o estado autoritativo do
    // servidor (network.round), não uma contagem local.
    this.ui.updateRoundHud(this.network.round);

    this.ui.updateHealth(this.localPlayer.health, this.localPlayer.maxHealth);
    if(this.localPlayerDowned){
      const remaining=Math.max(0,((Number(this.network.localBleedOutEndAt)||0)-Date.now())/1000);
      const revive=[...this._revives.values()].find(r=>r.targetId===this.network.playerId);
      let status='AGUARDE UM ALIADO';if(revive){const reviver=this.remotePlayers.get(revive.reviverId)?._player;status=`${String(reviver?.name||'ALIADO').toUpperCase()} ESTÁ TE REVIVENDO`;}
      this.ui.updateDowned(remaining,status);
    }
    this.ui.updateClock(this.matchElapsedSeconds);
    this._updateNetworkHud(dt);
  }

  /** Sincroniza health/alive/kills autoritativos do servidor no Player local. */
  _applyAuthoritativeState() {
    const newHealth = this.network.localHealth;
    const newAlive = this.network.localAlive;
    const newDowned = this.network.localDowned === true;

    if (typeof newHealth === 'number' && newHealth < this._lastKnownHealth && !newDowned) this.ui.flashDamage();
    this._lastKnownHealth = newHealth;

    this.localPlayer.health = newHealth;
    this.localPlayer.maxHealth = this.network.localMaxHealth || this.localPlayer.maxHealth;
    this.localPlayer.alive = newAlive;
    this.localPlayer.downed = newDowned;
    this.localPlayerDowned = newDowned && newAlive;

    if (this.localPlayerDowned) {
      this.localPlayerDead = false;
      this.ui.hideDeathScreen();
      this.ui.showDownedScreen();
    } else if (!newAlive) {
      if (!this.localPlayerDead) {
        this.localPlayerDead = true;
        this.ui.hideDownedScreen();
        this._spectatorTargetId=null;this._cycleSpectator(1);
        this.ui.showDeathScreen();
      }
    } else {
      if (this.localPlayerDead || this.localPlayerDowned === false) {
        this.localPlayerDead = false;
        this.ui.hideDeathScreen();
        this.ui.hideDownedScreen();
      }
    }
  }

  /** Calcula a direção de mira (mouse/stick) e decide se deve disparar. */
  _updateAimingAndShooting(dt) {
    const centerX = this.localPlayer.x + this.localPlayer.width / 2;
    const centerY = this.localPlayer.y + this.localPlayer.height / 2;

    let aimX = this.localPlayer.aimDirX;
    let aimY = this.localPlayer.aimDirY;
    let firing = false;

    if (this.input.isTouchDevice) {
      if (this.input.isShootTouchActive()) {
        const v = this.input.getShootTouchVector();
        const len = Math.hypot(v.x, v.y);
        if (len > 0.05) { aimX = v.x / len; aimY = v.y / len; }
        firing = true; // segurar o stick direito = atirar continuamente (item 21)
      }
    } else {
      const mouse = this.input.getMousePosition();
      const playerScreen = this.camera.worldToScreen(centerX, centerY);
      const dx = mouse.x - playerScreen.x;
      const dy = mouse.y - playerScreen.y;
      const len = Math.hypot(dx, dy);
      if (len > 4) { aimX = dx / len; aimY = dy / len; }
      firing = this.input.isMouseDown();
    }

    this.localPlayer.setAim(aimX, aimY);

    if (firing && this.combat.canShoot()) {
      const weapon = clientWeapon(this.network.loadout?.activeWeaponId || 'pistol');
      const didShoot = this.combat.tryShoot(
        centerX, centerY, aimX, aimY,
        this.gameMap.getAllObstacles(),
        (result) => {
          // O kill feed oficial vem do servidor com nome/score corretos.
          // Aqui fica só o feedback instantâneo local para não duplicar mensagens.
          if (result?.headshot) this.vfx.addFloatingText(result.killed ? 'HEADSHOT · KILL' : 'HEADSHOT!', null, null, '#ffd75b', true);
          else if (result?.killed) this.vfx.addFloatingText('ELIMINADO', null, null, '#f3efe1', true);
          this._syncLocalCombatState();
        }
      );
      if (didShoot) {
        this.localPlayer.triggerMuzzleFlash(weapon.id);
        this.localPlayer.triggerRecoil(weapon.recoil);
        if(this.input.isTouchDevice && this.ui.settings.vibration!==false) navigator.vibrate?.(weapon.id==='shotgun'?18:8);
      }
    }
  }

  _updateNetworkHud(dt) {
    this._networkStatusAccumulator += dt;
    if (this._networkStatusAccumulator < 0.5) return;
    this._networkStatusAccumulator = 0;

    this.ui.updateNetworkStatus({
      connected: this.network.connected,
      playerCount: this.network.playerCount || (this.remotePlayers.size + 1),
      pingMs: this.network.pingMs,
      roomCode: this.network.roomCode
    });
    this.ui.updateScoreboard(this.network.scoreboard, this.network.playerId, this.network.roomCode);
  }

  _renderMinimap() {
    const canvas=this.ui.el.hudMinimap;if(!canvas||!this.localPlayer)return;const c=canvas.getContext('2d'),w=canvas.width,h=canvas.height,sx=w/WORLD_WIDTH,sy=h/WORLD_HEIGHT;c.clearRect(0,0,w,h);c.fillStyle='#182218';c.fillRect(0,0,w,h);
    c.strokeStyle='rgba(205,194,145,.18)';c.lineWidth=3;for(const road of this.gameMap.roads){c.beginPath();c.moveTo(road.x1*sx,road.y1*sy);c.lineTo(road.x2*sx,road.y2*sy);c.stroke();}
    c.strokeStyle='rgba(255,255,255,.10)';c.lineWidth=1;for(const z of this.gameMap.zones){c.strokeRect(z.x*sx,z.y*sy,z.width*sx,z.height*sy);}
    for(const i of this.interactionManager.items.values()){if(i.type==='generator'&&i.state?.on){c.fillStyle='#7cff78';c.fillRect((i.x+i.width/2)*sx-2,(i.y+i.height/2)*sy-2,4,4);}else if(i.type==='gate'&&!i.state?.open){c.fillStyle='#e0b34d';c.fillRect((i.x+i.width/2)*sx-2,(i.y+i.height/2)*sy-2,4,4);}}
    for(const z of this.zombieManager.zombies.values()){if(z.state==='dead')continue;c.fillStyle=z.type==='boss'?'#ff674f':'#a23d34';c.fillRect((z._visualX??z.x)*sx-1,(z._visualY??z.y)*sy-1,z.type==='boss'?4:2,z.type==='boss'?4:2);}
    for(const r of this.remotePlayers.values()){const p=r._player;c.fillStyle=p?.downed?'#ffd069':p?.alive===false?'#705c55':'#e2c751';c.beginPath();c.arc((r._visualX+p.width/2)*sx,(r._visualY+p.height/2)*sy,2.2,0,Math.PI*2);c.fill();}
    const px=(this.localPlayer.x+this.localPlayer.width/2)*sx,py=(this.localPlayer.y+this.localPlayer.height/2)*sy;c.fillStyle='#58b6ff';c.beginPath();c.arc(px,py,3.4,0,Math.PI*2);c.fill();c.strokeStyle='rgba(88,182,255,.35)';c.beginPath();c.arc(px,py,11,0,Math.PI*2);c.stroke();
  }

  _renderReviveLinks(ctx) {
    for(const [targetId,r] of this._revives){
      const target=targetId===this.network.playerId?this.localPlayer:this.remotePlayers.get(targetId)?._player;
      const reviver=r.reviverId===this.network.playerId?this.localPlayer:this.remotePlayers.get(r.reviverId)?._player;
      if(!target||!reviver)continue;
      const tx=(target._renderX??target.x)+target.width/2,ty=(target._renderY??target.y)+target.height/2;
      const rx=(reviver._renderX??reviver.x)+reviver.width/2,ry=(reviver._renderY??reviver.y)+reviver.height/2;
      const a=this.camera.worldToScreen(rx,ry),b=this.camera.worldToScreen(tx,ty);
      const progress=Math.max(0,Math.min(1,(Date.now()-Number(r.startedAt||Date.now()))/Math.max(1,Number(r.durationMs)||3200)));
      ctx.save();ctx.strokeStyle='rgba(130,255,146,.45)';ctx.lineWidth=2;ctx.setLineDash([6,7]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
      ctx.strokeStyle='#8dff9c';ctx.lineWidth=4;ctx.beginPath();ctx.arc(b.x,b.y,25,-Math.PI/2,-Math.PI/2+Math.PI*2*progress);ctx.stroke();ctx.restore();
    }
  }

  _renderOffscreenAllies(ctx){
    if(!this.camera||!this.localPlayer)return;const w=this._viewportWidth,h=this._viewportHeight,margin=34;
    for(const remote of this.remotePlayers.values()){
      const p=remote?._player;if(!p||p.alive===false)continue;const wx=remote._visualX+p.width/2,wy=remote._visualY+p.height/2;if(this.camera.isPointVisible(wx,wy,35))continue;
      const s=this.camera.worldToScreen(wx,wy),cx=w/2,cy=h/2,dx=s.x-cx,dy=s.y-cy,len=Math.hypot(dx,dy)||1,nx=dx/len,ny=dy/len;
      const scale=Math.min(Math.abs((w/2-margin)/(nx||1e-6)),Math.abs((h/2-margin)/(ny||1e-6)));const x=cx+nx*scale,y=cy+ny*scale,ang=Math.atan2(ny,nx),dist=Math.round(Math.hypot(wx-(this.localPlayer.x+this.localPlayer.width/2),wy-(this.localPlayer.y+this.localPlayer.height/2)));
      ctx.save();ctx.translate(x,y);ctx.rotate(ang);ctx.fillStyle=p.downed?'#ffcf63':'#e3d25d';ctx.beginPath();ctx.moveTo(10,0);ctx.lineTo(-7,-6);ctx.lineTo(-7,6);ctx.closePath();ctx.fill();ctx.rotate(-ang);ctx.font='700 9px Segoe UI';ctx.textAlign='center';ctx.fillStyle=p.downed?'#ffd46e':'#eee6be';ctx.fillText(`${p.name} · ${dist}u`,0,17);ctx.restore();
    }
  }

  _render() {
    const ctx = this.ctx;
    ctx.save();

    // Screen shake afeta o mundo inteiro, mas não o HUD.
    this.vfx.applyScreenShake(ctx);

    this.gameMap.render(ctx, this.camera);
    this.vfx.renderGround(ctx, this.camera);
    this.interactionManager.render(ctx, this.camera);
    this.lootManager.render(ctx, this.camera);

    // Zumbis atrás dos jogadores.
    this.zombieManager.render(ctx, this.camera, this.localPlayer);

    // Jogadores remotos, depois o local.
    for (const remote of this.remotePlayers.values()) {
      remote.render(ctx, this.camera);
    }
    this.localPlayer.renderPlayer(ctx, this.camera);

    this._renderReviveLinks(ctx);

    // Partículas, casquilhos e tracers.
    this.combat.render(ctx, this.camera);

    ctx.restore();

    // Hit marker fica preso ao centro da tela e não sofre screen shake.
    this.vfx.renderScreen(ctx, this._viewportWidth, this._viewportHeight);
    this._renderOffscreenAllies(ctx);
  }
}
