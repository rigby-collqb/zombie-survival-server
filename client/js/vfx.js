const VFX_CONFIG={MAX_PARTICLES:620,TRACER_MS:105,CASING_LIFE:1.0,HIT_MARKER_MS:170,SHAKE_DECAY:20};
class VFXManager{
  constructor(){this.particles=[];this.particlePool=[];this.tracers=[];this.casings=[];this.floatingTexts=[];this.projectiles=[];this.rings=[];this.decals=[];this.lights=[];this.hitMarkerMs=0;this.hitMarkerType='normal';this.shake=0;this.masterVolume=.6;this._audioCtx=null;this.quality='high';this.maxParticles=620;this.maxDecals=140;this.effectScale=1;this._autoTier=null;this._lowFpsSamples=0;this._highFpsSamples=0;this.setQuality('auto');}
  reset(){this.particles.length=0;this.tracers.length=0;this.casings.length=0;this.floatingTexts.length=0;this.projectiles.length=0;this.rings.length=0;this.decals.length=0;this.lights.length=0;this.hitMarkerMs=0;this.shake=0;}
  setMasterVolume(v){this.masterVolume=Math.max(0,Math.min(1,Number(v)||0));}
  setQuality(mode='auto'){let q=mode;if(q==='auto'){const touch=(typeof matchMedia==='function'&&matchMedia('(pointer: coarse)').matches)||navigator.maxTouchPoints>0;const mem=Number(navigator.deviceMemory)||8,cores=Number(navigator.hardwareConcurrency)||8;q=this._autoTier||(touch&&(mem<=4||cores<=4)?'low':touch&&(mem<=6||cores<=6)?'medium':'high');}if(!['low','medium','high'].includes(q))q='high';this.quality=q;const cfg=q==='low'?[180,38,.48]:q==='medium'?[360,82,.72]:[620,140,1];this.maxParticles=cfg[0];this.maxDecals=cfg[1];this.effectScale=cfg[2];while(this.particles.length>this.maxParticles)this._releaseParticle(this.particles.shift());while(this.decals.length>this.maxDecals)this.decals.shift();return q;}
  reportFps(fps,requestedMode='auto'){if(requestedMode!=='auto'||!Number.isFinite(Number(fps)))return;fps=Number(fps);if(fps<42){this._lowFpsSamples++;this._highFpsSamples=0;}else if(fps>56){this._highFpsSamples++;this._lowFpsSamples=Math.max(0,this._lowFpsSamples-1);}else{this._lowFpsSamples=Math.max(0,this._lowFpsSamples-1);this._highFpsSamples=0;}if(this._lowFpsSamples>=6){this._lowFpsSamples=0;this._autoTier=this.quality==='high'?'medium':'low';this.setQuality('auto');}else if(this._highFpsSamples>=24){this._highFpsSamples=0;this._autoTier=this.quality==='low'?'medium':'high';this.setQuality('auto');}}
  _releaseParticle(p){if(!p)return;for(const k of Object.keys(p))delete p[k];if(this.particlePool.length<220)this.particlePool.push(p);}
  addShake(a){this.shake=Math.max(this.shake,Number(a)||0);}
  addHitMarker(headshot=false){this.hitMarkerMs=headshot?260:VFX_CONFIG.HIT_MARKER_MS;this.hitMarkerType=headshot?'headshot':'normal';if(headshot)this.addFloatingText('HEADSHOT!',null,null,'#ffd75b',true);}
  addFloatingText(text,x=null,y=null,color='#fff',screen=false){this.floatingTexts.push({text:String(text),x,y,color,screen,life:0.85,maxLife:0.85,vy:-28});}

  addShot({x,y,dirX,dirY,endX,endY,wallBlocked=false,intensity=1,weaponId='pistol',headshot=false}){
    if(![x,y,dirX,dirY,endX,endY].every(Number.isFinite))return;
    const style={pistol:{w:2,glow:6,c:'#ffe6a1'},smg:{w:1.5,glow:5,c:'#ffd86e'},shotgun:{w:2.4,glow:7,c:'#ffbd55'},rifle:{w:2.8,glow:8,c:'#fff0b5'}}[weaponId]||{w:2,glow:6,c:'#ffe6a1'};
    this.tracers.push({x1:x,y1:y,x2:endX,y2:endY,lifeMs:VFX_CONFIG.TRACER_MS,maxMs:VFX_CONFIG.TRACER_MS,...style});
    const mx=x+dirX*24,my=y+dirY*24;this._addSmoke(mx,my,Math.max(2,Math.round((weaponId==='shotgun'?7:3)*intensity)));this.lights.push({x:mx,y:my,r:weaponId==='shotgun'?105:weaponId==='rifle'?82:64,life:.07,maxLife:.07,color:'#ffd77a'});
    const sideX=-dirY,sideY=dirX;const casingCount=weaponId==='shotgun'?1:1;
    for(let i=0;i<casingCount;i++)this.casings.push({x:x-sideX*6,y:y-sideY*6,vx:sideX*(55+Math.random()*55)+dirX*(Math.random()-.5)*20,vy:sideY*(55+Math.random()*55)-38,life:VFX_CONFIG.CASING_LIFE,rotation:Math.random()*Math.PI,spin:(Math.random()-.5)*13});
    if(wallBlocked){this.addSparks(endX,endY,weaponId==='shotgun'?10:7);this._addDecal('impact',endX,endY,weaponId==='shotgun'?7:4);}
    if(headshot)this.addSparks(endX,endY,5);
  }

  addBlood(x,y,amount=14,headshot=false){
    amount=Math.max(1,Math.min(60,Math.round(amount*(headshot?1.45:1)*this.effectScale)));
    for(let i=0;i<amount;i++){const a=Math.random()*Math.PI*2,s=55+Math.random()*(headshot?250:180);this._pushParticle({type:'blood',x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-25,life:.28+Math.random()*.5,maxLife:.78,size:1.8+Math.random()*4.2});}
    if(Math.random()<.78)this._addDecal('blood',x+(Math.random()-.5)*10,y+(Math.random()-.5)*10,headshot?12+Math.random()*10:7+Math.random()*9);
    if(headshot){this.rings.push({x,y,r:2,maxR:42,life:.24,maxLife:.24,color:'#b51f1f'});this.addShake(3.5);}
  }
  _addDecal(type,x,y,size){if(this.decals.length>=this.maxDecals)this.decals.splice(0,Math.max(1,Math.ceil(this.maxDecals*.12)));this.decals.push({type,x,y,size,rotation:Math.random()*Math.PI,alpha:type==='blood'?.45:.32});}
  addSparks(x,y,amount=8){for(let i=0;i<amount;i++){const a=Math.random()*Math.PI*2,s=80+Math.random()*210;this._pushParticle({type:'spark',x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.12+Math.random()*.23,maxLife:.35,size:1+Math.random()*2});}}
  _addSmoke(x,y,amount=3){amount=Math.max(1,Math.round(amount*this.effectScale));for(let i=0;i<amount;i++)this._pushParticle({type:'smoke',x:x+(Math.random()-.5)*6,y:y+(Math.random()-.5)*6,vx:(Math.random()-.5)*24,vy:-12-Math.random()*22,life:.25+Math.random()*.3,maxLife:.55,size:3.5+Math.random()*5.5});}
  _pushParticle(data){if(this.particles.length>=this.maxParticles){const remove=Math.max(1,Math.floor(this.maxParticles*.08));for(let i=0;i<remove&&this.particles.length;i++)this._releaseParticle(this.particles.shift());}const p=this.particlePool.pop()||{};Object.assign(p,data);this.particles.push(p);return p;}


  addRevivePulse(x,y,complete=false){
    if(!Number.isFinite(x)||!Number.isFinite(y))return;
    this.rings.push({x,y,r:4,maxR:complete?70:42,life:complete?.52:.32,maxLife:complete?.52:.32,color:complete?'#8dff9c':'#62d976'});
    const n=complete?24:10;for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,sp=25+Math.random()*(complete?110:55);this._pushParticle({type:'revive',x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-18,life:.35+Math.random()*.35,maxLife:.7,size:1.6+Math.random()*3});}
    if(complete)this.addShake(2.5);
  }
  addDownedPulse(x,y){if(!Number.isFinite(x)||!Number.isFinite(y))return;this.rings.push({x,y,r:3,maxR:54,life:.38,maxLife:.38,color:'#d94a43'});}

  addExplosion(x,y,radius=110){
    this.rings.push({x,y,r:8,maxR:radius,life:.48,maxLife:.48,color:'#ffb13b'});this.addShake(11);
    for(let i=0,n=Math.max(16,Math.round(55*this.effectScale));i<n;i++){const a=Math.random()*Math.PI*2,s=50+Math.random()*300;this._pushParticle({type:i<30?'spark':'smoke',x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.3+Math.random()*.75,maxLife:1.05,size:2+Math.random()*7});}
  }
  addSpit(x,y,targetX,targetY){this.projectiles.push({type:'acid',x,y,startX:x,startY:y,targetX,targetY,t:0,duration:.34});}

  playWeaponSound(weaponId='pistol',distanceFactor=1){
    if(this.masterVolume<=0)return;
    try{
      if(!this._audioCtx)this._audioCtx=new(window.AudioContext||window.webkitAudioContext)();
      const ac=this._audioCtx;if(ac.state==='suspended')ac.resume().catch(()=>{});
      const now=ac.currentTime,g=ac.createGain(),osc=ac.createOscillator();
      const spec={pistol:[150,.07,.20],smg:[210,.045,.13],shotgun:[75,.14,.34],rifle:[110,.095,.27]}[weaponId]||[150,.07,.2];
      const vol=this.masterVolume*Math.max(.08,Math.min(1,distanceFactor))*spec[2];
      g.gain.setValueAtTime(vol,now);g.gain.exponentialRampToValueAtTime(.0001,now+spec[1]);osc.type=weaponId==='smg'?'square':'sawtooth';osc.frequency.setValueAtTime(spec[0],now);osc.frequency.exponentialRampToValueAtTime(Math.max(35,spec[0]*.35),now+spec[1]);osc.connect(g);g.connect(ac.destination);osc.start(now);osc.stop(now+spec[1]);
      const len=Math.floor(ac.sampleRate*spec[1]),buf=ac.createBuffer(1,len,ac.sampleRate),ch=buf.getChannelData(0);for(let i=0;i<len;i++)ch[i]=(Math.random()*2-1)*(1-i/len);
      const src=ac.createBufferSource(),ng=ac.createGain(),filter=ac.createBiquadFilter();src.buffer=buf;filter.type='bandpass';filter.frequency.value=weaponId==='shotgun'?550:weaponId==='rifle'?1000:1300;ng.gain.value=vol*.55;src.connect(filter);filter.connect(ng);ng.connect(ac.destination);src.start(now);
    }catch(_){}
  }

  update(dt){
    const ms=dt*1000;this.hitMarkerMs=Math.max(0,this.hitMarkerMs-ms);this.shake=Math.max(0,this.shake-VFX_CONFIG.SHAKE_DECAY*dt);
    for(let i=this.tracers.length-1;i>=0;i--){this.tracers[i].lifeMs-=ms;if(this.tracers[i].lifeMs<=0)this.tracers.splice(i,1);}
    for(let i=this.casings.length-1;i>=0;i--){const c=this.casings[i];c.life-=dt;c.x+=c.vx*dt;c.y+=c.vy*dt;c.vy+=170*dt;c.vx*=Math.pow(.15,dt);c.rotation+=c.spin*dt;if(c.life<=0)this.casings.splice(i,1);}
    for(let i=this.particles.length-1;i>=0;i--){const p=this.particles[i];p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;if(p.type==='blood'){p.vy+=175*dt;p.vx*=Math.pow(.2,dt);}else if(p.type==='smoke'){p.vx*=Math.pow(.12,dt);p.vy*=Math.pow(.3,dt);p.size+=8*dt;}else{p.vx*=Math.pow(.1,dt);p.vy*=Math.pow(.1,dt);}if(p.life<=0){this.particles.splice(i,1);this._releaseParticle(p);}}
    for(let i=this.floatingTexts.length-1;i>=0;i--){const f=this.floatingTexts[i];f.life-=dt;if(!f.screen&&Number.isFinite(f.y))f.y+=f.vy*dt;if(f.life<=0)this.floatingTexts.splice(i,1);}
    for(let i=this.projectiles.length-1;i>=0;i--){const p=this.projectiles[i];p.t+=dt/p.duration;const t=Math.min(1,p.t);p.x=p.startX+(p.targetX-p.startX)*t;p.y=p.startY+(p.targetY-p.startY)*t;if(t>=1){for(let k=0;k<12;k++){const a=Math.random()*Math.PI*2;this._pushParticle({type:'acid',x:p.x,y:p.y,vx:Math.cos(a)*(20+Math.random()*80),vy:Math.sin(a)*(20+Math.random()*80),life:.25+Math.random()*.25,maxLife:.5,size:2+Math.random()*3});}this.projectiles.splice(i,1);}}
    for(let i=this.rings.length-1;i>=0;i--){this.rings[i].life-=dt;if(this.rings[i].life<=0)this.rings.splice(i,1);}for(let i=this.lights.length-1;i>=0;i--){this.lights[i].life-=dt;if(this.lights[i].life<=0)this.lights.splice(i,1);}
  }
  applyScreenShake(ctx){if(this.shake<=.01)return;const s=Math.min(12,this.shake);ctx.translate((Math.random()-.5)*s*2,(Math.random()-.5)*s*2);}

  renderGround(ctx,camera){
    for(const d of this.decals){if(!camera.isPointVisible(d.x,d.y,d.size+6))continue;const s=camera.worldToScreen(d.x,d.y);ctx.save();ctx.translate(s.x,s.y);ctx.rotate(d.rotation);ctx.globalAlpha=d.alpha;ctx.fillStyle=d.type==='blood'?'#5d1111':'#171717';ctx.beginPath();ctx.ellipse(0,0,d.size,d.size*.55,0,0,Math.PI*2);ctx.fill();ctx.restore();}
  }

  renderWorld(ctx,camera){
    for(const l of this.lights){if(!camera.isPointVisible(l.x,l.y,l.r))continue;const s=camera.worldToScreen(l.x,l.y),a=Math.max(0,l.life/l.maxLife);ctx.save();ctx.globalCompositeOperation='lighter';ctx.globalAlpha=a*.55;const g=ctx.createRadialGradient(s.x,s.y,0,s.x,s.y,l.r);g.addColorStop(0,'rgba(255,236,170,.8)');g.addColorStop(1,'rgba(255,150,30,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(s.x,s.y,l.r,0,Math.PI*2);ctx.fill();ctx.restore();}
    for(const r of this.rings){if(!camera.isPointVisible(r.x,r.y,r.maxR))continue;const s=camera.worldToScreen(r.x,r.y),q=1-r.life/r.maxLife;ctx.save();ctx.globalAlpha=1-q;ctx.strokeStyle=r.color;ctx.lineWidth=5;ctx.beginPath();ctx.arc(s.x,s.y,8+q*r.maxR,0,Math.PI*2);ctx.stroke();ctx.restore();}
    for(const p of this.projectiles){if(!camera.isPointVisible(p.x,p.y,20))continue;const s=camera.worldToScreen(p.x,p.y);ctx.save();ctx.globalCompositeOperation='lighter';ctx.fillStyle='#72ff91';ctx.shadowColor='#72ff91';ctx.shadowBlur=12;ctx.beginPath();ctx.arc(s.x,s.y,5,0,Math.PI*2);ctx.fill();ctx.restore();}
    for(const p of this.particles){if(!camera.isPointVisible(p.x,p.y,20))continue;const s=camera.worldToScreen(p.x,p.y),a=Math.max(0,Math.min(1,p.life/p.maxLife));ctx.save();ctx.globalAlpha=a;ctx.fillStyle=p.type==='blood'?'#9d1717':p.type==='spark'?'#ffd66f':p.type==='acid'?'#65e987':p.type==='revive'?'#8dff9c':'#a6aaa6';ctx.beginPath();ctx.arc(s.x,s.y,p.size,0,Math.PI*2);ctx.fill();ctx.restore();}
    for(const c of this.casings){if(!camera.isPointVisible(c.x,c.y,12))continue;const s=camera.worldToScreen(c.x,c.y);ctx.save();ctx.translate(s.x,s.y);ctx.rotate(c.rotation);ctx.fillStyle='#c9aa63';ctx.fillRect(-2.5,-1,5,2);ctx.restore();}
    for(const t of this.tracers){const a=camera.worldToScreen(t.x1,t.y1),b=camera.worldToScreen(t.x2,t.y2),alpha=Math.max(0,t.lifeMs/t.maxMs);ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle=t.c;ctx.lineWidth=t.w;ctx.lineCap='round';ctx.shadowColor=t.c;ctx.shadowBlur=t.glow;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.shadowBlur=0;ctx.globalAlpha=alpha*.22;ctx.lineWidth=t.w+3;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.restore();}
    for(const f of this.floatingTexts){if(f.screen||!Number.isFinite(f.x)||!Number.isFinite(f.y))continue;const s=camera.worldToScreen(f.x,f.y);ctx.save();ctx.globalAlpha=Math.min(1,f.life/f.maxLife*1.5);ctx.fillStyle=f.color;ctx.font='bold 13px Arial';ctx.textAlign='center';ctx.fillText(f.text,s.x,s.y);ctx.restore();}
  }

  renderScreen(ctx,width,height){
    if(this.hitMarkerMs>0){const head=this.hitMarkerType==='headshot',alpha=Math.max(0,Math.min(1,this.hitMarkerMs/(head?260:VFX_CONFIG.HIT_MARKER_MS))),cx=width/2,cy=height/2,gap=head?6:7,len=head?11:8;ctx.save();ctx.globalAlpha=Math.min(1,alpha*1.6);ctx.strokeStyle=head?'#ffd75b':'#fff';ctx.lineWidth=head?3:2;ctx.lineCap='round';for(const sx of[-1,1])for(const sy of[-1,1]){ctx.beginPath();ctx.moveTo(cx+sx*(gap+len),cy+sy*(gap+len));ctx.lineTo(cx+sx*gap,cy+sy*gap);ctx.stroke();}ctx.restore();}
    for(const f of this.floatingTexts){if(!f.screen)continue;ctx.save();ctx.globalAlpha=Math.min(1,f.life/f.maxLife*1.7);ctx.fillStyle=f.color;ctx.font='900 22px Arial';ctx.textAlign='center';ctx.shadowColor='rgba(0,0,0,.8)';ctx.shadowBlur=8;ctx.fillText(f.text,width/2,height/2-52-(1-f.life/f.maxLife)*24);ctx.restore();}
  }
}
