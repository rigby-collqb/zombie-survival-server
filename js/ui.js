class UIManager {
  constructor() {
    this.el = {
      mainMenu:document.getElementById('main-menu'),gameScreen:document.getElementById('game-screen'),
      btnPlay:document.getElementById('btn-play'),btnSettings:document.getElementById('btn-settings'),btnCredits:document.getElementById('btn-credits'),
      settingsModal:document.getElementById('settings-modal'),creditsModal:document.getElementById('credits-modal'),pauseMenu:document.getElementById('pause-menu'),
      inputPlayerName:document.getElementById('input-player-name'),inputVolume:document.getElementById('input-volume'),inputShowFps:document.getElementById('input-show-fps'),
      btnResume:document.getElementById('btn-resume'),btnPauseSettings:document.getElementById('btn-pause-settings'),btnBackToMenu:document.getElementById('btn-back-to-menu'),btnPauseMobile:document.getElementById('btn-pause-mobile'),
      hudHealthFill:document.getElementById('hud-health-bar-fill'),hudHealthText:document.getElementById('hud-health-text'),hudPlayerName:document.getElementById('hud-player-name'),hudClock:document.getElementById('hud-clock'),hudFps:document.getElementById('hud-fps'),
      hudNetworkDot:document.getElementById('hud-network-dot'),hudNetworkPlayers:document.getElementById('hud-network-players'),hudNetworkPing:document.getElementById('hud-network-ping'),connectionLostOverlay:document.getElementById('connection-lost-overlay'),
      hudKills:document.getElementById('hud-kills'),hudHeadshots:document.getElementById('hud-headshots'),hudWeapon:document.getElementById('hud-weapon'),hudAmmo:document.getElementById('hud-ammo'),hudMoney:document.getElementById('hud-money'),hudReload:document.getElementById('hud-reload'),
      killFeed:document.getElementById('kill-feed'),hudRound:document.getElementById('hud-round'),hudZombies:document.getElementById('hud-zombies'),roundBanner:document.getElementById('round-banner'),roundBannerTitle:document.getElementById('round-banner-title'),roundBannerSubtitle:document.getElementById('round-banner-subtitle'),
      damageFlash:document.getElementById('damage-flash-overlay'),deathScreen:document.getElementById('death-screen'),deathRespawnCountdown:document.getElementById('death-respawn-countdown'),btnRespawn:document.getElementById('btn-respawn'),btnDeathBackToMenu:document.getElementById('btn-death-back-to-menu'),
      btnShopHud:document.getElementById('btn-shop-hud'),btnMobileShop:document.getElementById('btn-mobile-shop'),shopModal:document.getElementById('shop-modal'),shopItems:document.getElementById('shop-items'),shopMoney:document.getElementById('shop-money'),shopMessage:document.getElementById('shop-message'),btnShopClose:document.getElementById('btn-shop-close'),
      lootPrompt:document.getElementById('loot-prompt'),interactionPrompt:document.getElementById('interaction-prompt'),
      hudZone:document.getElementById('hud-zone'),hudWeaponIcon:document.getElementById('hud-weapon-icon'),hudSlot1:document.getElementById('hud-slot-1'),hudSlot2:document.getElementById('hud-slot-2'),hudLowAmmo:document.getElementById('hud-low-ammo'),
      hudRoundProgressFill:document.getElementById('hud-round-progress-fill'),hudMinimap:document.getElementById('hud-minimap'),hudAllies:document.getElementById('hud-allies'),lowHealthVignette:document.getElementById('low-health-vignette'),
    };
    this.settings={playerName:'Sobrevivente',volume:60,showFps:false};
    this._shopCatalog=null;this._shopSelf=null;this._shopBuyCallback=null;
    this._bindCloseButtons();this._bindSettingsInputs();
    this.el.btnShopClose?.addEventListener('click',()=>this.hideShop());
  }

  _bindCloseButtons(){document.querySelectorAll('[data-close]').forEach(btn=>btn.addEventListener('click',()=>document.getElementById(btn.getAttribute('data-close'))?.classList.add('hidden')));}
  _bindSettingsInputs(){
    this.el.inputPlayerName?.addEventListener('input',e=>{this.settings.playerName=e.target.value.trim()||'Sobrevivente';if(this.el.hudPlayerName)this.el.hudPlayerName.textContent=this.settings.playerName;});
    this.el.inputVolume?.addEventListener('input',e=>{this.settings.volume=Number(e.target.value);});
    this.el.inputShowFps?.addEventListener('change',e=>{this.settings.showFps=e.target.checked;this.el.hudFps?.classList.toggle('hidden',!this.settings.showFps);});
  }
  showSettingsModal(){this.el.settingsModal?.classList.remove('hidden');} showCreditsModal(){this.el.creditsModal?.classList.remove('hidden');}
  showMainMenu(){this.el.mainMenu?.classList.remove('hidden');this.el.gameScreen?.classList.add('hidden');this.el.pauseMenu?.classList.add('hidden');this.hideShop();}
  showGameScreen(){this.el.mainMenu?.classList.add('hidden');this.el.gameScreen?.classList.remove('hidden');}
  showPauseMenu(){this.el.pauseMenu?.classList.remove('hidden');} hidePauseMenu(){this.el.pauseMenu?.classList.add('hidden');}

  updateHealth(current,max){const m=Math.max(1,Number(max)||100),c=Math.max(0,Number(current)||0),pct=Math.max(0,Math.min(100,c/m*100));if(this.el.hudHealthFill){this.el.hudHealthFill.style.width=pct+'%';this.el.hudHealthFill.classList.toggle('low-health',pct<=30);}if(this.el.hudHealthText)this.el.hudHealthText.textContent=`${Math.round(c)}/${Math.round(m)}`;this.el.lowHealthVignette?.classList.toggle('active',pct<=30&&c>0);}
  updatePlayerName(name){if(this.el.hudPlayerName)this.el.hudPlayerName.textContent=name;}
  updateClock(sec){const m=Math.floor(sec/60).toString().padStart(2,'0'),s=Math.floor(sec%60).toString().padStart(2,'0');if(this.el.hudClock)this.el.hudClock.textContent=`${m}:${s}`;}
  updateFps(fps){if(this.settings.showFps&&this.el.hudFps)this.el.hudFps.textContent=`FPS: ${fps}`;}
  updateNetworkStatus({connected,playerCount,pingMs}){if(this.el.hudNetworkDot){this.el.hudNetworkDot.textContent=connected?'🟢':'🔴';this.el.hudNetworkDot.classList.toggle('hud-network-dot-offline',!connected);}if(typeof playerCount==='number'&&this.el.hudNetworkPlayers)this.el.hudNetworkPlayers.textContent=`Jogadores: ${playerCount}`;if(this.el.hudNetworkPing)this.el.hudNetworkPing.textContent=pingMs==null?'Ping: --ms':`Ping: ${pingMs}ms`;}
  showConnectionLostOverlay(){this.el.connectionLostOverlay?.classList.remove('hidden');} hideConnectionLostOverlay(){this.el.connectionLostOverlay?.classList.add('hidden');}

  updateCombatHud(loadout,money=0,kills=0,headshots=0){
    const id=loadout?.activeWeaponId||'pistol',w=clientWeapon(id);if(this.el.hudWeapon)this.el.hudWeapon.textContent=w.name.toUpperCase();if(this.el.hudWeaponIcon){this.el.hudWeaponIcon.textContent={pistol:'⌐',smg:'▰',shotgun:'═',rifle:'▱'}[id]||'⌐';this.el.hudWeaponIcon.dataset.weapon=id;}
    const ammo=Math.max(0,Number(loadout?.ammo)||0),reserve=Math.max(0,Number(loadout?.reserve)||0);if(this.el.hudAmmo){this.el.hudAmmo.textContent=`${ammo} / ${reserve}`;this.el.hudAmmo.classList.toggle('hud-ammo-low',ammo>0&&ammo<=Math.max(2,Math.ceil((w.magazineSize||12)*.25)));this.el.hudAmmo.classList.toggle('hud-ammo-empty',ammo===0);}if(this.el.hudLowAmmo)this.el.hudLowAmmo.classList.toggle('hidden',!(ammo<=Math.max(2,Math.ceil((w.magazineSize||12)*.25))));
    if(this.el.hudMoney)this.el.hudMoney.textContent=`$${Math.max(0,Math.round(Number(money)||0))}`;
    if(this.el.hudKills)this.el.hudKills.textContent=`Kills: ${Math.max(0,Number(kills)||0)}`;
    if(this.el.hudHeadshots)this.el.hudHeadshots.textContent=`HS: ${Math.max(0,Number(headshots)||0)}`;
    const slots=Array.isArray(loadout?.slots)?loadout.slots:[];const active=Number(loadout?.activeSlot)||0;if(this.el.hudSlot1){this.el.hudSlot1.textContent=`1 · ${slots[0]?clientWeapon(slots[0]).name.toUpperCase():'—'}`;this.el.hudSlot1.classList.toggle('hud-slot-active',active===0);}if(this.el.hudSlot2){this.el.hudSlot2.textContent=`2 · ${slots[1]?clientWeapon(slots[1]).name.toUpperCase():'—'}`;this.el.hudSlot2.classList.toggle('hud-slot-active',active===1);}if(this.el.hudReload)this.el.hudReload.classList.toggle('hidden',!loadout?.reloading);
    if(this.el.shopMoney)this.el.shopMoney.textContent=`$${Math.max(0,Math.round(Number(money)||0))}`;
  }

  updateRoundHud(round){
    if(!round)return;const remaining=Number(round.zombiesRemaining??round.zombiesAlive)||0,total=Math.max(0,Number(round.zombiesTotal)||0);if(this.el.hudRound)this.el.hudRound.textContent=`Round: ${round.number}`;if(this.el.hudZombies)this.el.hudZombies.textContent=`Zumbis: ${remaining}/${total}`;if(this.el.hudRoundProgressFill){const done=total>0?Math.max(0,Math.min(1,(total-remaining)/total)):0;this.el.hudRoundProgressFill.style.width=`${Math.round(done*100)}%`;}
    this.setShopAvailable(round.state==='intermission');
    if(!this.el.roundBanner)return;
    if(round.state==='countdown')this._showRoundBanner(round.bossRound?`⚠ BOSS ROUND ${round.number}`:`ROUND ${round.number}`,`COMEÇANDO EM ${round.countdownSeconds}...`);
    else if(round.state==='intermission')this._showRoundBanner('ROUND COMPLETO',`LOJA ABERTA · PRÓXIMO ROUND EM ${round.countdownSeconds}...`);
    else if(round.state==='waiting')this._showRoundBanner('AGUARDANDO JOGADORES','');
    else this._hideRoundBanner();
  }
  _showRoundBanner(t,s){this.el.roundBanner?.classList.remove('hidden');if(this.el.roundBannerTitle)this.el.roundBannerTitle.textContent=t;if(this.el.roundBannerSubtitle)this.el.roundBannerSubtitle.textContent=s;}
  _hideRoundBanner(){this.el.roundBanner?.classList.add('hidden');}

  showKillFeed(text,headshot=false){if(!this.el.killFeed)return;this.el.killFeed.textContent=text;this.el.killFeed.style.color=headshot?'#ffd75b':'';this.el.killFeed.classList.remove('hidden','kill-feed-pop');void this.el.killFeed.offsetWidth;this.el.killFeed.classList.add('kill-feed-pop');clearTimeout(this._killFeedTimer);this._killFeedTimer=setTimeout(()=>this.el.killFeed.classList.add('hidden'),1600);}
  flashDamage(){if(!this.el.damageFlash)return;this.el.damageFlash.classList.remove('damage-flash-active');void this.el.damageFlash.offsetWidth;this.el.damageFlash.classList.add('damage-flash-active');}

  updateLootPrompt(nearest){
    if(!this.el.lootPrompt)return;if(!nearest){this.el.lootPrompt.classList.add('hidden');return;}
    const i=nearest.item;let label=i.kind==='ammo'?'MUNIÇÃO':i.kind==='money'?`$${i.amount}`:i.kind==='medkit'?'KIT MÉDICO':clientWeapon(i.weaponId).name.toUpperCase();
    this.el.lootPrompt.textContent=`F / PEGAR — ${label} · ${RARITY_LABELS[i.rarity]||'Comum'}`;this.el.lootPrompt.classList.remove('hidden');
  }

  updateZone(zone){if(this.el.hudZone)this.el.hudZone.textContent=zone?.name||String(zone||'ZONA SELVAGEM');}
  updateAllies(remotes){if(!this.el.hudAllies)return;this.el.hudAllies.innerHTML='';for(const r of remotes.values()){const p=r?._player;if(!p)continue;const row=document.createElement('div');row.className='hud-ally';const n=document.createElement('span');n.textContent=p.name||'Aliado';const hp=document.createElement('span');hp.className=p.alive===false?'hud-ally-dead':'hud-ally-health';hp.textContent=p.alive===false?'MORTO':`${Math.max(0,Math.round(p.health||0))}HP`;row.append(n,hp);this.el.hudAllies.appendChild(row);}}
  updateInteractionPrompt(nearest,manager){if(!this.el.interactionPrompt)return;if(!nearest){this.el.interactionPrompt.classList.add('hidden');return;}const i=nearest.item,label=manager?.promptFor?.(i)||i.label||'INTERAGIR';this.el.interactionPrompt.textContent=`E / USAR — ${label}`;this.el.interactionPrompt.classList.remove('hidden');}

  setShopAvailable(on){this.el.btnShopHud?.classList.toggle('hidden',!on);this.el.btnMobileShop?.classList.toggle('hidden',!on);if(!on)this.hideShop();}
  showShop(catalog,self,onBuy){if(!catalog||!this.el.shopModal)return;this._shopCatalog=catalog;this._shopSelf=self;this._shopBuyCallback=onBuy;this.el.shopModal.classList.remove('hidden');this.renderShop(catalog,self);}
  hideShop(){this.el.shopModal?.classList.add('hidden');}
  isShopOpen(){return !!this.el.shopModal&&!this.el.shopModal.classList.contains('hidden');}
  updateShop(catalog,self){this._shopCatalog=catalog||this._shopCatalog;this._shopSelf=self||this._shopSelf;if(this.isShopOpen())this.renderShop(this._shopCatalog,this._shopSelf);}
  showShopMessage(text,good=false){if(!this.el.shopMessage)return;this.el.shopMessage.textContent=text||'';this.el.shopMessage.style.color=good?'#79d77f':'#e2b76a';}

  renderShop(catalog,self){
    if(!this.el.shopItems||!catalog)return;this.el.shopItems.innerHTML='';if(this.el.shopMoney)this.el.shopMoney.textContent=`$${Math.max(0,Number(self?.money)||0)}`;
    const cards=[];
    for(const w of catalog.weapons||[])cards.push({id:w.id,title:w.name,desc:`Arma ${RARITY_LABELS[w.rarity]||''}. Compra ocupa um dos 2 slots.`,price:w.price,rarity:w.rarity,owned:!!self?.weapons?.[w.id]});
    cards.push({id:'ammo',title:'Munição',desc:'Reabastece a reserva da arma atual.',price:catalog.ammo?.price||150});
    cards.push({id:'health',title:'Vida',desc:'Recupera sua vida até o máximo.',price:catalog.health?.price||200});
    const names={damage:'Dano',reload:'Recarga',movement:'Movimento'};
    for(const key of['damage','reload','movement']){const lvl=Number(self?.upgrades?.[key])||0,prices=catalog.upgrades?.[key]||[],max=prices.length-1;cards.push({id:`upgrade:${key}`,title:`${names[key]} ${lvl}/${max}`,desc:key==='damage'?'+10% de dano por nível':key==='reload'?'Recarga 10% mais rápida por nível':'+6% de velocidade por nível',price:lvl<max?prices[lvl+1]:0,maxed:lvl>=max});}
    for(const c of cards){const card=document.createElement('div');card.className=`shop-card ${c.rarity?`shop-rarity-${c.rarity}`:''}`;const title=document.createElement('div');title.className='shop-card-title';title.textContent=c.title;const desc=document.createElement('div');desc.className='shop-card-desc';desc.textContent=c.desc;const bottom=document.createElement('div');bottom.className='shop-card-bottom';const price=document.createElement('span');price.className='shop-card-price';price.textContent=c.maxed?'MÁX':c.owned?'COMPRADA':`$${c.price}`;const btn=document.createElement('button');btn.className='shop-buy-btn';btn.textContent=c.maxed?'MÁX':c.owned?'EQUIPADA':'COMPRAR';btn.disabled=!!(c.maxed||c.owned);btn.addEventListener('click',async()=>{btn.disabled=true;await this._shopBuyCallback?.(c.id);btn.disabled=false;});bottom.append(price,btn);card.append(title,desc,bottom);this.el.shopItems.appendChild(card);}
  }

  showDeathScreen(){if(!this.el.deathScreen)return;this.el.deathScreen.classList.remove('hidden');let remaining=3;if(this.el.btnRespawn)this.el.btnRespawn.disabled=true;if(this.el.deathRespawnCountdown)this.el.deathRespawnCountdown.textContent=`Aguarde ${remaining}s...`;clearTimeout(this._deathCountdownTimer);const tick=()=>{remaining--;if(remaining<=0){if(this.el.btnRespawn)this.el.btnRespawn.disabled=false;if(this.el.deathRespawnCountdown)this.el.deathRespawnCountdown.textContent='';}else{if(this.el.deathRespawnCountdown)this.el.deathRespawnCountdown.textContent=`Aguarde ${remaining}s...`;this._deathCountdownTimer=setTimeout(tick,1000);}};this._deathCountdownTimer=setTimeout(tick,1000);}
  hideDeathScreen(){this.el.deathScreen?.classList.add('hidden');clearTimeout(this._deathCountdownTimer);}
}
