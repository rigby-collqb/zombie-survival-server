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
    this._lastKnownHealth = 100;

    this._lastTimestamp = 0;
    this._fpsAccumulator = 0;
    this._fpsFrames = 0;
    this._fpsDisplay = 0;

    this._networkStatusAccumulator = 0;
    this._minimapAccumulator = 0;
    this._lastRoundVfxKey = '';

    this._boundLoop = this._loop.bind(this);

    this._bindUIEvents();
    this._bindResize();
    this.input.onEscape(() => this._handleEscape());
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
  }

  /* ---------------------------------------------------------- */
  /* EVENTOS DE UI                                               */
  /* ---------------------------------------------------------- */

  _bindUIEvents() {
    this.ui.el.btnPlay.addEventListener('click', () => this.startGame());
    this.ui.el.btnSettings.addEventListener('click', () => this.ui.showSettingsModal());
    this.ui.el.btnCredits.addEventListener('click', () => this.ui.showCreditsModal());

    this.ui.el.btnResume.addEventListener('click', () => this.resume());
    this.ui.el.btnPauseSettings.addEventListener('click', () => this.ui.showSettingsModal());
    this.ui.el.btnBackToMenu.addEventListener('click', () => this.returnToMenu());
    this.ui.el.btnPauseMobile.addEventListener('click', () => this._handleEscape());

    if (this.ui.el.btnRespawn) {
      this.ui.el.btnRespawn.addEventListener('click', () => this._handleRespawnClick());
    }
    if (this.ui.el.btnDeathBackToMenu) {
      this.ui.el.btnDeathBackToMenu.addEventListener('click', () => this.returnToMenu());
    }

    this.ui.el.btnShopHud?.addEventListener('click', () => this._toggleShop());
    this.ui.el.inputVolume?.addEventListener('input', () => {
      this.vfx.setMasterVolume(this.ui.settings.volume / 100);
      this.audio.setMasterVolume(this.ui.settings.volume / 100);
    });
  }

  _bindResize() {
    window.addEventListener('resize', () => this._resizeCanvas());
    // Em alguns navegadores mobile, 'resize' não dispara imediatamente
    // ao girar o aparelho — 'orientationchange' garante que a câmera,
    // o joystick e o HUD sejam recalculados no novo tamanho de tela.
    window.addEventListener('orientationchange', () => {
      setTimeout(() => this._resizeCanvas(), 100);
    });
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
    this._lastKnownHealth = player.health;
    this.camera.snapTo(player.x + this.localPlayer.width / 2, player.y + this.localPlayer.height / 2);

    this.localPlayerDead = false;
    this.ui.hideDeathScreen();
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
    }
    this.ui.updateCombatHud(
      loadout,
      this.network.localMoney,
      this.network.localKills,
      this.network.localHeadshots
    );
    this.ui.updateShop(this.network.shopCatalog, {
      ...loadout,
      money: this.network.localMoney,
    });
  }

  _syncDynamicObstacles() {
    if (this.gameMap) this.gameMap.setDynamicObstacles(this.interactionManager.getBlockingObstacles());
  }

  async _interactNearest() {
    if (!this.localPlayer || this.localPlayerDead) return;
    const cx=this.localPlayer.x+this.localPlayer.width/2,cy=this.localPlayer.y+this.localPlayer.height/2;
    const nearest=this.interactionManager.nearest(cx,cy,115);
    if(!nearest)return;
    const r=await this.network.interact(nearest.item.id);
    if(!r?.success){const msg={not_enough_money:'DINHEIRO INSUFICIENTE',already_active:'GERADOR JÁ ESTÁ LIGADO',already_used:'CAIXA VAZIA',too_far:'CHEGUE MAIS PERTO'}[r?.error]||'NÃO FOI POSSÍVEL USAR';this.ui.showKillFeed(msg);return;}
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
    if (!this.localPlayer || this.localPlayerDead) return;
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
    if (this.input.consumeAction('reload')) {
      this.network.reload().then((r) => {
        if (r?.success) { this._syncLocalCombatState(); this.audio.playReload(this.network.loadout?.activeWeaponId||'pistol'); }
      });
    }
    if (this.input.consumeAction('slot1')) this.network.switchWeapon(0).then(() => this._syncLocalCombatState());
    if (this.input.consumeAction('slot2')) this.network.switchWeapon(1).then(() => this._syncLocalCombatState());
    if (this.input.consumeAction('switchNext')) this.network.switchWeapon(null).then(() => this._syncLocalCombatState());
    if (this.input.consumeAction('interact')) this._interactNearest();
    if (this.input.consumeAction('pickup')) this._pickupNearestLoot();
    if (this.input.consumeAction('shop')) this._toggleShop();
  }

  /* ---------------------------------------------------------- */
  /* CICLO DE VIDA DO JOGO                                        */
  /* ---------------------------------------------------------- */

  async startGame() {
    if (this._joining) return;
    this._joining = true;

    const name = this.ui.settings.playerName || 'Sobrevivente';
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

    this.ui.showGameScreen();
    this._resizeCanvas();
    this._tryLockLandscape();

    // Gera o mundo (determinístico pela seed — igual em todos os clientes)
    this.gameMap = new GameMap(WORLD_WIDTH, WORLD_HEIGHT, MAP_SEED);

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
    this._lastKnownHealth = spawn.health ?? 100;

    // A câmera trabalha em pixels CSS. canvas.width/height são pixels
    // físicos (DPR) e no mobile podem ser 2x/3x maiores, o que empurrava
    // o jogador para o canto da tela.
    this.camera = new Camera(this._viewportWidth, this._viewportHeight, WORLD_WIDTH, WORLD_HEIGHT);
    this.camera.snapTo(
      spawn.x + this.localPlayer.width / 2,
      spawn.y + this.localPlayer.height / 2
    );

    this.localPlayerDead = false;
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

    // Avisa o servidor que saímos de forma limpa (item 11). Não espera
    // a resposta para não travar a transição de tela.
    this.network.leave();

    // Libera as referências do mundo atual (nova partida gera tudo de novo)
    this.gameMap = null;
    this.camera = null;
    this.localPlayer = null;
    this.localPlayerDead = false;
    this.zombieManager.zombies.clear();
    this.lootManager.clear();
    this.interactionManager.clear();
    this.vfx.reset();
  }

  /* ---------------------------------------------------------- */
  /* CANVAS / RESPONSIVIDADE                                     */
  /* ---------------------------------------------------------- */

  _resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();

    // Quando a tela do jogo ainda está oculta, getBoundingClientRect()
    // pode retornar 0. Nesse caso usamos o viewport.
    const width = Math.max(1, Math.round(rect.width || window.innerWidth));
    const height = Math.max(1, Math.round(rect.height || window.innerHeight));

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
    }
  }

  _update(dt) {
    this.matchElapsedSeconds += dt;

    // --- Fase 3: aplica o estado autoritativo (health/alive/kills) ---
    // vindo da última resposta de sync.php, ANTES de decidir input —
    // um jogador morto não deve conseguir se mover/atirar mesmo que o
    // clique/tecla já esteja pressionado (item 34).
    this._applyAuthoritativeState();
    this._handleGameplayActions();

    const move = this.localPlayerDead || this.ui.isShopOpen() ? { x: 0, y: 0 } : this.input.getMoveVector();
    this.localPlayer.updatePlayer(dt, move.x, move.y, this.gameMap);
    this.localPlayer.updateWeaponVisuals(dt);

    this.camera.follow(
      this.localPlayer.x + this.localPlayer.width / 2,
      this.localPlayer.y + this.localPlayer.height / 2,
      dt
    );

    // --- Mira contínua + tiro (itens 20-23) ---------------------------
    if (!this.localPlayerDead && !this.ui.isShopOpen()) {
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

    // --- Fase 3: zumbis + combate --------------------------------------
    this.zombieManager.applySnapshots(this.network.lastZombies);
    this.zombieManager.update(dt);
    this.combat.update(dt);
    this.vfx.update(dt);
    this.audio.update(dt, this.localPlayer, this.zombieManager.zombies);
    this.audio.setRoundState(this.network.round);

    const lootCenterX = this.localPlayer.x + this.localPlayer.width / 2;
    const lootCenterY = this.localPlayer.y + this.localPlayer.height / 2;
    this.ui.updateLootPrompt(this.lootManager.nearest(lootCenterX, lootCenterY, 82));
    const nearInteraction=this.interactionManager.nearest(lootCenterX,lootCenterY,115);
    this.ui.updateInteractionPrompt(nearInteraction,this.interactionManager);
    this.ui.updateZone(this.gameMap.getZoneAt(lootCenterX,lootCenterY));
    this.ui.updateAllies(this.remotePlayers);
    this._minimapAccumulator+=dt;if(this._minimapAccumulator>=.16){this._minimapAccumulator=0;this._renderMinimap();}

    // Fase 4: HUD de round/zumbis usa o estado autoritativo do
    // servidor (network.round), não uma contagem local.
    this.ui.updateRoundHud(this.network.round);

    this.ui.updateHealth(this.localPlayer.health, this.localPlayer.maxHealth);
    this.ui.updateClock(this.matchElapsedSeconds);
    this._updateNetworkHud(dt);
  }

  /** Sincroniza health/alive/kills autoritativos do servidor no Player local. */
  _applyAuthoritativeState() {
    const newHealth = this.network.localHealth;
    const newAlive = this.network.localAlive;

    if (typeof newHealth === 'number' && newHealth < this._lastKnownHealth) {
      this.ui.flashDamage(); // item 33
    }
    this._lastKnownHealth = newHealth;

    this.localPlayer.health = newHealth;
    this.localPlayer.maxHealth = this.network.localMaxHealth || this.localPlayer.maxHealth;
    this.localPlayer.alive = newAlive;

    if (!newAlive && !this.localPlayerDead) {
      this.localPlayerDead = true;
      this.ui.showDeathScreen(); // item 34
    } else if (newAlive && this.localPlayerDead) {
      // Servidor já confirmou o respawn (ex.: outra aba/clique duplo) —
      // mantém a UI consistente mesmo sem passar por _handleRespawnClick.
      this.localPlayerDead = false;
      this.ui.hideDeathScreen();
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
          if (result?.headshot) this.ui.showKillFeed(result.killed ? 'HEADSHOT · ZUMBI ELIMINADO' : 'HEADSHOT', true);
          else if (result?.killed) this.ui.showKillFeed('ZUMBI ELIMINADO');
          this._syncLocalCombatState();
        }
      );
      if (didShoot) {
        this.localPlayer.triggerMuzzleFlash(weapon.id);
        this.localPlayer.triggerRecoil(weapon.recoil);
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
      pingMs: this.network.pingMs
    });
  }

  _renderMinimap() {
    const canvas=this.ui.el.hudMinimap;if(!canvas||!this.localPlayer)return;const c=canvas.getContext('2d'),w=canvas.width,h=canvas.height,sx=w/WORLD_WIDTH,sy=h/WORLD_HEIGHT;c.clearRect(0,0,w,h);c.fillStyle='#182218';c.fillRect(0,0,w,h);
    c.strokeStyle='rgba(205,194,145,.18)';c.lineWidth=3;for(const road of this.gameMap.roads){c.beginPath();c.moveTo(road.x1*sx,road.y1*sy);c.lineTo(road.x2*sx,road.y2*sy);c.stroke();}
    c.strokeStyle='rgba(255,255,255,.10)';c.lineWidth=1;for(const z of this.gameMap.zones){c.strokeRect(z.x*sx,z.y*sy,z.width*sx,z.height*sy);}
    for(const i of this.interactionManager.items.values()){if(i.type==='generator'&&i.state?.on){c.fillStyle='#7cff78';c.fillRect((i.x+i.width/2)*sx-2,(i.y+i.height/2)*sy-2,4,4);}else if(i.type==='gate'&&!i.state?.open){c.fillStyle='#e0b34d';c.fillRect((i.x+i.width/2)*sx-2,(i.y+i.height/2)*sy-2,4,4);}}
    for(const z of this.zombieManager.zombies.values()){if(z.state==='dead')continue;c.fillStyle=z.type==='boss'?'#ff674f':'#a23d34';c.fillRect((z._visualX??z.x)*sx-1,(z._visualY??z.y)*sy-1,z.type==='boss'?4:2,z.type==='boss'?4:2);}
    for(const r of this.remotePlayers.values()){const p=r._player;c.fillStyle=p?.alive===false?'#705c55':'#e2c751';c.beginPath();c.arc((r._visualX+p.width/2)*sx,(r._visualY+p.height/2)*sy,2.2,0,Math.PI*2);c.fill();}
    const px=(this.localPlayer.x+this.localPlayer.width/2)*sx,py=(this.localPlayer.y+this.localPlayer.height/2)*sy;c.fillStyle='#58b6ff';c.beginPath();c.arc(px,py,3.4,0,Math.PI*2);c.fill();c.strokeStyle='rgba(88,182,255,.35)';c.beginPath();c.arc(px,py,11,0,Math.PI*2);c.stroke();
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

    // Partículas, casquilhos e tracers.
    this.combat.render(ctx, this.camera);

    ctx.restore();

    // Hit marker fica preso ao centro da tela e não sofre screen shake.
    this.vfx.renderScreen(ctx, this._viewportWidth, this._viewportHeight);
  }
}
