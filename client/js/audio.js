class AudioManager {
  constructor(){
    this.masterVolume=.6;this.ctx=null;this.master=null;
    this._round=null;this._lifeState='alive';this._gameActive=false;this._lastFootstep=0;this._lastGroan=0;this._lastHeartbeat=0;this._lastRoundKey='';
    this._musicDesired='menu';this._musicCurrent=null;this._musicFadeToken=0;
    this._tracks={
      menu:this._makeTrack('assets/audio/menu_terror.mp3',true,.46),
      explore:this._makeTrack('assets/audio/explore_suspense.mp3',true,.40),
      combat:this._makeTrack('assets/audio/combat_action.mp3',true,.46),
      boss:this._makeTrack('assets/audio/boss_action.mp3',true,.52),
      death:this._makeTrack('assets/audio/death_theme.mp3',false,.56),
    };
    const unlock=()=>this.unlock();
    window.addEventListener('pointerdown',unlock,{passive:true});window.addEventListener('keydown',unlock,{passive:true});
  }
  _makeTrack(src,loop,base){const a=new Audio(src);a.loop=loop;a.preload='auto';a.volume=0;a.dataset.base=String(base);return a;}
  setMasterVolume(v){this.masterVolume=Math.max(0,Math.min(1,Number(v)||0));if(this.master)this.master.gain.value=this.masterVolume;if(this._musicCurrent){const a=this._tracks[this._musicCurrent];if(a)a.volume=(Number(a.dataset.base)||.4)*this.masterVolume;}}
  unlock(){
    try{if(!this.ctx){this.ctx=new(window.AudioContext||window.webkitAudioContext)();this.master=this.ctx.createGain();this.master.gain.value=this.masterVolume;this.master.connect(this.ctx.destination);}if(this.ctx.state==='suspended')this.ctx.resume().catch(()=>{});}catch(_){}
    this._switchMusic(this._musicDesired,650);
  }
  setGameActive(active){this._gameActive=!!active;if(!active){this._musicDesired='menu';this._switchMusic('menu',900);}else this._selectMusicFromState();}
  setLifeState(state='alive'){this._lifeState=state;if(state==='dead'){this._musicDesired='death';this._switchMusic('death',260);}else this._selectMusicFromState();}
  setRoundState(round){this._round=round||null;this._selectMusicFromState();}
  _selectMusicFromState(){
    if(this._lifeState==='dead'){this._musicDesired='death';return this._switchMusic('death',260);}
    if(!this._gameActive){this._musicDesired='menu';return this._switchMusic('menu',800);}
    const r=this._round||{};
    let next='explore';
    if(r.state==='running'){
      if(r.bossRound)next='boss';
      else{const total=Math.max(1,Number(r.zombiesTotal)||1),remaining=Math.max(0,Number(r.zombiesRemaining)||0),intensity=1-Math.min(1,remaining/total);next=intensity>.30?'combat':'explore';}
    }
    if(this._lifeState==='downed')next='explore';
    this._musicDesired=next;this._switchMusic(next,900);
  }
  _switchMusic(name,fadeMs=700){
    const next=this._tracks[name];if(!next)return;
    if(this._musicCurrent===name){if(next.paused)next.play().catch(()=>{});return;}
    const previous=this._musicCurrent?this._tracks[this._musicCurrent]:null;
    this._musicCurrent=name;this._musicDesired=name;const token=++this._musicFadeToken;
    if(name==='death')next.currentTime=0;
    next.play().catch(()=>{});
    const target=(Number(next.dataset.base)||.4)*this.masterVolume,startNext=next.volume,startPrev=previous?.volume||0,start=performance.now();
    const tick=()=>{if(token!==this._musicFadeToken)return;const p=Math.min(1,(performance.now()-start)/Math.max(1,fadeMs)),ease=p*p*(3-2*p);next.volume=Math.max(0,Math.min(1,startNext+(target-startNext)*ease));if(previous)previous.volume=Math.max(0,startPrev*(1-ease));if(p<1)requestAnimationFrame(tick);else if(previous){previous.pause();if(previous!==this._tracks.death)previous.currentTime=0;}};requestAnimationFrame(tick);
  }
  _panFor(x,listenerX,max=700){if(!Number.isFinite(x)||!Number.isFinite(listenerX))return 0;return Math.max(-1,Math.min(1,(x-listenerX)/max));}
  _distanceGain(x,y,lx,ly,max=900){if(![x,y,lx,ly].every(Number.isFinite))return 1;const d=Math.hypot(x-lx,y-ly);return Math.max(.025,1-d/max);}
  _route(gain=1,pan=0){if(!this.ctx||!this.master)return null;const g=this.ctx.createGain();g.gain.value=Math.max(.0001,gain);let tail=g;if(this.ctx.createStereoPanner){const p=this.ctx.createStereoPanner();p.pan.value=Math.max(-1,Math.min(1,pan));g.connect(p);p.connect(this.master);tail=p;}else g.connect(this.master);return{gain:g,tail};}
  _tone(freq=180,duration=.08,gain=.1,type='sine',pan=0,slide=.55){if(this.masterVolume<=0)return;this.unlock();if(!this.ctx)return;const now=this.ctx.currentTime,r=this._route(gain,pan);if(!r)return;const o=this.ctx.createOscillator();o.type=type;o.frequency.setValueAtTime(Math.max(30,freq),now);o.frequency.exponentialRampToValueAtTime(Math.max(25,freq*slide),now+duration);r.gain.gain.setValueAtTime(Math.max(.0001,gain),now);r.gain.gain.exponentialRampToValueAtTime(.0001,now+duration);o.connect(r.gain);o.start(now);o.stop(now+duration+.01);}
  _noise(duration=.08,gain=.08,pan=0,low=450,high=2600){if(this.masterVolume<=0)return;this.unlock();if(!this.ctx)return;const len=Math.max(1,Math.floor(this.ctx.sampleRate*duration)),buf=this.ctx.createBuffer(1,len,this.ctx.sampleRate),d=buf.getChannelData(0);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*(1-i/len);const src=this.ctx.createBufferSource(),filter=this.ctx.createBiquadFilter(),r=this._route(gain,pan);filter.type='bandpass';filter.frequency.value=(low+high)/2;filter.Q.value=.7;src.buffer=buf;src.connect(filter);filter.connect(r.gain);const now=this.ctx.currentTime;r.gain.gain.setValueAtTime(gain,now);r.gain.gain.exponentialRampToValueAtTime(.0001,now+duration);src.start(now);}
  playWeapon(id='pistol',x=null,y=null,listener=null,remote=false){const lx=listener?.x,ly=listener?.y,dist=this._distanceGain(x,y,lx,ly,remote?1000:1600),pan=this._panFor(x,lx);const specs={pistol:[165,.075,.22,'sawtooth'],smg:[230,.045,.145,'square'],shotgun:[72,.15,.36,'sawtooth'],rifle:[112,.105,.31,'sawtooth']}[id]||[165,.075,.22,'sawtooth'];const g=specs[2]*dist*(remote ? 0.72 : 1);this._tone(specs[0],specs[1],g,specs[3],pan,.32);this._noise(specs[1]*1.25,g*.7,pan,id==='shotgun'?180:500,id==='rifle'?1800:2800);}
  playHit(headshot=false){this._tone(headshot?980:620,headshot?.07:.045,headshot?.11:.065,'square',0,.7);if(headshot)this._tone(1450,.055,.045,'sine',0,.7);}
  playKill(headshot=false){this._tone(headshot?520:390,.11,.085,'triangle',0,1.5);setTimeout(()=>this._tone(headshot?780:560,.11,.055,'triangle',0,1.15),55);}
  playReload(id='pistol'){this._noise(.05,.035,0,900,3800);setTimeout(()=>this._tone(id==='shotgun'?210:330,.045,.035,'square',0,.85),90);}
  playPickup(){this._tone(620,.07,.055,'sine',0,1.4);setTimeout(()=>this._tone(880,.08,.04,'sine',0,1.2),55);}
  playInteraction(type='door'){if(type==='medstation'){this._tone(520,.09,.05,'sine',0,1.3);setTimeout(()=>this._tone(720,.11,.04,'sine',0,1.2),80);}else if(type==='ammo_station'){this._noise(.06,.045,0,700,2600);setTimeout(()=>this._tone(250,.05,.035,'square',0,.85),70);}else if(type==='generator'){this._tone(70,.28,.075,'sawtooth',0,1.15);this._noise(.18,.035,0,90,450);}else if(type==='crate'){this._noise(.12,.07,0,280,1400);}else if(type==='gate'||type==='barricade'){this._tone(95,.14,.065,'square',0,.6);this._noise(.1,.045,0,120,900);}else this._tone(140,.09,.055,'triangle',0,.55);}
  playRound(round){const key=`${round?.state}:${round?.number}:${round?.countdownSeconds}`;if(key===this._lastRoundKey)return;this._lastRoundKey=key;if(round?.state==='running'){const base=round.bossRound?72:220;this._tone(base,.32,round.bossRound?.13:.08,'sawtooth',0,1.6);setTimeout(()=>this._tone(base*1.5,.3,round.bossRound?.1:.06,'triangle',0,1.25),170);}else if(round?.state==='intermission'){this._tone(380,.18,.06,'sine',0,1.3);setTimeout(()=>this._tone(520,.2,.05,'sine',0,1.2),150);}else if(round?.state==='countdown'&&round.countdownSeconds<=3)this._tone(260,.06,.04,'square',0,.8);}
  playDowned(){this.setLifeState('downed');this._tone(92,.32,.09,'sawtooth',0,.45);setTimeout(()=>this._tone(58,.24,.065,'sine',0,.7),130);}
  playReviveStart(){this._tone(280,.12,.045,'sine',0,1.18);setTimeout(()=>this._tone(350,.1,.035,'sine',0,1.12),90);}
  playReviveComplete(){this._tone(420,.13,.07,'triangle',0,1.35);setTimeout(()=>this._tone(620,.15,.06,'triangle',0,1.22),90);setTimeout(()=>this._tone(820,.16,.045,'sine',0,1.1),175);}
  playDeath(){this.setLifeState('dead');this._noise(.8,.055,0,35,240);this._tone(92,.7,.12,'sawtooth',0,.42);setTimeout(()=>this._tone(58,1.05,.11,'triangle',0,.52),330);}
  playRespawn(){this.setLifeState('alive');this._tone(240,.13,.05,'triangle',0,1.4);setTimeout(()=>this._tone(360,.17,.045,'triangle',0,1.25),100);}
  playExplosion(x,y,listener){const g=this._distanceGain(x,y,listener?.x,listener?.y,950),pan=this._panFor(x,listener?.x);this._tone(52,.28,.18*g,'sawtooth',pan,.35);this._noise(.34,.15*g,pan,60,700);}
  playSpit(x,y,listener){const g=this._distanceGain(x,y,listener?.x,listener?.y,650),pan=this._panFor(x,listener?.x);this._tone(310,.12,.04*g,'sine',pan,.55);this._noise(.12,.025*g,pan,250,1100);}
  playZombieGroan(z,listener){const dist=this._distanceGain(z._visualX,z._visualY,listener.x,listener.y,620),pan=this._panFor(z._visualX,listener.x,520);const type=z.type||'normal',base={runner:160,tank:62,exploder:92,spitter:120,boss:48,normal:92}[type]||92;this._tone(base,.3,.035*dist,'sawtooth',pan,.7);this._noise(.2,.018*dist,pan,80,500);}
  update(dt,player,zombies){if(!player||!this.ctx)return;const now=performance.now(),listener={x:player.x+player.width/2,y:player.y+player.height/2};
    const desired=player.alive===false?'dead':player.downed?'downed':'alive';if(desired!==this._lifeState)this.setLifeState(desired);
    if(player.moving&&player.alive!==false&&!player.downed&&now-this._lastFootstep>260){this._lastFootstep=now;this._noise(.045,.018,0,100,650);}
    const ratio=(Number(player.health)||0)/Math.max(1,Number(player.maxHealth)||100),heartbeatGap=player.downed?390:650;if((player.downed||ratio<.3)&&player.alive!==false&&now-this._lastHeartbeat>heartbeatGap){this._lastHeartbeat=now;this._tone(64,.12,.055,'sine',0,.65);setTimeout(()=>this._tone(58,.1,.045,'sine',0,.7),150);}
    if(now-this._lastGroan>1250){let nearest=null,best=Infinity;for(const z of zombies?.values?.()||[]){if(z.state==='dead')continue;const d=Math.hypot((z._visualX??z.x)-listener.x,(z._visualY??z.y)-listener.y);if(d<best){best=d;nearest=z;}}if(nearest&&best<620){this._lastGroan=now+Math.random()*650;this.playZombieGroan(nearest,listener);}}
  }
}
