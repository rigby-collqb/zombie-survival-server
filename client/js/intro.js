/**
 * IntroCutscene — Fase 23
 * Cutscene cinematográfica de abertura. Não depende do Game/Socket.IO.
 */
(function(){
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const ease=t=>{t=clamp(t);return t*t*(3-2*t);};
  const TAU=Math.PI*2;

  class IntroCutsceneController {
    constructor(){
      this.root=document.getElementById('intro-cutscene');
      this.canvas=document.getElementById('intro-canvas');
      this.ctx=this.canvas?.getContext('2d');
      this.caption=document.getElementById('intro-caption');
      this.timecode=document.getElementById('intro-timecode');
      this.audioButton=document.getElementById('intro-audio-button');
      this.skip=document.getElementById('intro-skip');
      this.audio=null;
      this.startedAt=0;
      this.elapsed=0;
      this.duration=40;
      this.done=false;
      this.resolve=null;
      this.raf=0;
      this.dpr=1;
      this.w=innerWidth;
      this.h=innerHeight;
      this.flash=0;
      this.lastScene=-1;
      this.seed=2317;
      this.reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches||false;
      this._boundResize=()=>this.resize();
      this._boundSkip=e=>{if(e?.target?.closest?.('.intro-audio-button'))return;this.finish(true);};
      this._boundKey=e=>{if(['Escape','Enter',' '].includes(e.key)){e.preventDefault();this.finish(true);}};
      this.resize();
    }

    play(){
      if(!this.root||!this.canvas||!this.ctx)return Promise.resolve();
      document.documentElement.classList.add('intro-active');
      this.root.classList.remove('hidden','intro-ending');
      this.root.setAttribute('aria-hidden','false');
      this.root.addEventListener('pointerdown',this._boundSkip,{passive:true});
      this.audioButton?.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();this._unlockAudio();},{passive:false});
      window.addEventListener('keydown',this._boundKey,{passive:false});
      window.addEventListener('resize',this._boundResize,{passive:true});
      window.visualViewport?.addEventListener('resize',this._boundResize,{passive:true});
      this._startAudio();
      this.startedAt=performance.now();
      this.raf=requestAnimationFrame(t=>this.loop(t));
      return new Promise(r=>this.resolve=r);
    }

    _unlockAudio(){
      if(!this.audio)return;
      try{
        if(Number.isFinite(this.elapsed))this.audio.currentTime=Math.min(this.duration-.1,Math.max(0,this.elapsed));
        this.audio.muted=false;
        this.audio.volume=.72;
        const p=this.audio.play();
        if(p?.then)p.then(()=>{this.root?.classList.remove('intro-audio-blocked');this.audioButton?.classList.add('hidden');}).catch(()=>{});
      }catch(_){}
    }

    _startAudio(){
      try{
        this.audio=new Audio('assets/audio/intro_cinematic.mp3?v=60');
        this.audio.preload='auto';
        this.audio.volume=.72;
        this.audio.playsInline=true;
        const p=this.audio.play();
        if(p?.catch)p.catch(()=>{
          // Autoplay pode ser bloqueado no primeiro acesso. A cutscene visual continua.
          this.root?.classList.add('intro-audio-blocked');
          this.audioButton?.classList.remove('hidden');
        });
      }catch(_){/* visual continua sem áudio */}
    }

    resize(){
      if(!this.canvas)return;
      this.w=Math.max(1,Math.round(window.visualViewport?.width||innerWidth));
      this.h=Math.max(1,Math.round(window.visualViewport?.height||innerHeight));
      this.dpr=Math.min(2,window.devicePixelRatio||1);
      this.canvas.width=Math.floor(this.w*this.dpr);
      this.canvas.height=Math.floor(this.h*this.dpr);
      this.canvas.style.width=this.w+'px';
      this.canvas.style.height=this.h+'px';
      this.ctx?.setTransform(this.dpr,0,0,this.dpr,0,0);
    }

    loop(now){
      if(this.done)return;
      this.elapsed=(now-this.startedAt)/1000;
      if(this.reduced)this.elapsed*=1.35;
      this.render(this.elapsed);
      if(this.elapsed>=this.duration)return this.finish(false);
      this.raf=requestAnimationFrame(t=>this.loop(t));
    }

    finish(skipped=false){
      if(this.done)return;
      this.done=true;
      cancelAnimationFrame(this.raf);
      this.root?.removeEventListener('pointerdown',this._boundSkip);
      window.removeEventListener('keydown',this._boundKey);
      window.removeEventListener('resize',this._boundResize);
      window.visualViewport?.removeEventListener('resize',this._boundResize);
      if(this.audio){
        const a=this.audio,start=a.volume,begin=performance.now();
        const fade=()=>{
          const p=clamp((performance.now()-begin)/420);
          a.volume=start*(1-p);
          if(p<1)requestAnimationFrame(fade);else{a.pause();a.src='';}
        };
        fade();
      }
      this.root?.classList.add('intro-ending');
      setTimeout(()=>{
        this.root?.classList.add('hidden');
        this.root?.setAttribute('aria-hidden','true');
        document.documentElement.classList.remove('intro-active');
        this.resolve?.({skipped});
      },skipped?240:900);
    }

    sceneFor(t){
      if(t<2.6)return 0;
      if(t<8.1)return 1;
      if(t<13.7)return 2;
      if(t<19.4)return 3;
      if(t<25.7)return 4;
      if(t<32.4)return 5;
      if(t<36.2)return 6;
      return 7;
    }

    render(t){
      const ctx=this.ctx,w=this.w,h=this.h;
      if(!ctx)return;
      const scene=this.sceneFor(t);
      if(scene!==this.lastScene){this.lastScene=scene;this.flash=.16;}
      this.flash=Math.max(0,this.flash-.016);
      ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
      ctx.clearRect(0,0,w,h);
      ctx.save();
      const shake=(scene===1||scene===5)?Math.max(0,Math.sin(t*18))*1.8:0;
      ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);
      switch(scene){
        case 0:this.renderOpening(t);break;
        case 1:this.renderGunfire(t-2.6);break;
        case 2:this.renderHospital(t-8.1);break;
        case 3:this.renderPanic(t-13.7);break;
        case 4:this.renderOutbreak(t-19.4);break;
        case 5:this.renderCollapse(t-25.7);break;
        case 6:this.renderSurvivor(t-32.4);break;
        case 7:this.renderTitle(t-36.2);break;
      }
      ctx.restore();
      this.drawFilm(t,scene);
      this.updateText(t,scene);
    }

    bgGradient(top='#080808',bottom='#1a0807'){
      const g=this.ctx.createLinearGradient(0,0,0,this.h);g.addColorStop(0,top);g.addColorStop(1,bottom);return g;
    }

    drawCityBase(offset=0,night=true){
      const c=this.ctx,w=this.w,h=this.h;
      c.fillStyle=this.bgGradient(night?'#050708':'#16100f',night?'#140505':'#2b0a08');c.fillRect(0,0,w,h);
      const horizon=h*.55;
      c.fillStyle=night?'#0b0d0e':'#171313';
      const widths=[.10,.15,.09,.18,.12,.13,.10,.15];let x=-w*.05-(offset%(w*.18));
      for(let i=0;x<w*1.1;i++){
        const bw=w*widths[i%widths.length],bh=h*(.18+((i*37)%120)/420);
        c.fillRect(x,horizon-bh,bw,bh);
        c.fillStyle=night?'rgba(156,28,19,.13)':'rgba(255,80,35,.08)';
        for(let yy=horizon-bh+18;yy<horizon-16;yy+=25)for(let xx=x+14;xx<x+bw-10;xx+=28)if((i+Math.floor(xx+yy))%4===0)c.fillRect(xx,yy,5,8);
        c.fillStyle=night?'#0b0d0e':'#171313';x+=bw+8;
      }
      const roadY=h*.67;
      c.fillStyle='#111212';c.fillRect(0,roadY,w,h-roadY);
      const rg=c.createLinearGradient(0,roadY,0,h);rg.addColorStop(0,'rgba(95,18,14,.12)');rg.addColorStop(1,'rgba(0,0,0,.6)');c.fillStyle=rg;c.fillRect(0,roadY,w,h-roadY);
      c.strokeStyle='rgba(210,196,158,.2)';c.lineWidth=2;c.setLineDash([35,40]);c.beginPath();c.moveTo(0,h*.84);c.lineTo(w,h*.84);c.stroke();c.setLineDash([]);
      return roadY;
    }

    drawHuman(x,y,scale=1,color='#171717',run=0,coat=false){
      const c=this.ctx;c.save();c.translate(x,y);c.scale(scale,scale);
      c.fillStyle=color;c.beginPath();c.arc(0,-31,8,0,TAU);c.fill();
      c.lineWidth=8;c.lineCap='round';c.strokeStyle=color;c.beginPath();c.moveTo(0,-22);c.lineTo(run*3,4);c.stroke();
      c.lineWidth=6;c.beginPath();c.moveTo(0,-14);c.lineTo(-13-run*6,-1+run*4);c.moveTo(0,-13);c.lineTo(13+run*8,-3-run*2);c.stroke();
      c.beginPath();c.moveTo(run*2,2);c.lineTo(-10-run*8,27);c.moveTo(run*2,2);c.lineTo(11+run*8,27);c.stroke();
      if(coat){c.fillStyle='rgba(225,229,225,.82)';c.beginPath();c.moveTo(-11,-20);c.lineTo(12,-20);c.lineTo(16,11);c.lineTo(-15,11);c.closePath();c.fill();}
      c.restore();
    }

    drawZombie(x,y,scale=1,phase=0,alpha=1){
      const c=this.ctx;c.save();c.globalAlpha=alpha;c.translate(x,y);c.scale(scale,scale);c.rotate(Math.sin(phase)*.07);
      c.fillStyle='#111514';c.beginPath();c.arc(1,-30,9,0,TAU);c.fill();
      c.strokeStyle='#111514';c.lineCap='round';c.lineWidth=9;c.beginPath();c.moveTo(0,-20);c.lineTo(-2,5);c.stroke();
      c.lineWidth=6;c.beginPath();c.moveTo(-1,-14);c.lineTo(-18+Math.sin(phase)*5,-1);c.moveTo(1,-13);c.lineTo(19+Math.cos(phase)*4,1);c.moveTo(-2,4);c.lineTo(-12,29);c.moveTo(-2,4);c.lineTo(10,29);c.stroke();
      c.fillStyle='rgba(231,31,24,.55)';c.fillRect(-4,-32,3,2);c.fillRect(4,-32,3,2);c.restore();
    }

    drawSoldier(x,y,scale=1,aim=1,muzzle=false){
      const c=this.ctx;this.drawHuman(x,y,scale,'#101413',0,false);c.save();c.translate(x,y);c.scale(scale,scale);c.strokeStyle='#050505';c.lineWidth=6;c.lineCap='square';c.beginPath();c.moveTo(5,-11);c.lineTo(34*aim,-11);c.stroke();c.fillStyle='#151a18';c.fillRect(-9,-28,18,7);
      if(muzzle){const mx=36*aim;c.fillStyle='rgba(255,235,146,.95)';c.beginPath();c.moveTo(mx,-11);c.lineTo(mx+18*aim,-19);c.lineTo(mx+12*aim,-11);c.lineTo(mx+18*aim,-3);c.closePath();c.fill();c.fillStyle='rgba(255,78,22,.6)';c.beginPath();c.arc(mx,-11,13,0,TAU);c.fill();}
      c.restore();
    }

    drawAmbulance(x,y,s=1,lights=true){
      const c=this.ctx;c.save();c.translate(x,y);c.scale(s,s);c.fillStyle='#ddd8cf';c.fillRect(-68,-34,136,52);c.fillStyle='#b32822';c.fillRect(-68,-8,136,9);c.fillStyle='#8b1616';c.fillRect(-14,-28,28,6);c.fillRect(-3,-39,6,28);c.fillStyle='#141819';c.fillRect(28,-28,27,18);c.fillStyle='#090909';c.beginPath();c.arc(-43,18,14,0,TAU);c.arc(43,18,14,0,TAU);c.fill();if(lights){c.fillStyle='rgba(231,34,32,.95)';c.fillRect(-10,-43,9,6);c.fillStyle='rgba(45,119,255,.95)';c.fillRect(2,-43,9,6);}c.restore();
    }

    drawStretcher(x,y,s=1){
      const c=this.ctx;c.save();c.translate(x,y);c.scale(s,s);c.strokeStyle='#b9b8ae';c.lineWidth=4;c.beginPath();c.moveTo(-45,0);c.lineTo(45,0);c.lineTo(34,17);c.moveTo(-34,0);c.lineTo(-25,17);c.stroke();c.fillStyle='#4c5556';c.fillRect(-43,-9,86,10);c.fillStyle='#050505';c.beginPath();c.arc(-25,20,5,0,TAU);c.arc(25,20,5,0,TAU);c.fill();c.fillStyle='#262829';c.beginPath();c.ellipse(3,-15,35,10,0,0,TAU);c.fill();c.restore();
    }

    renderOpening(t){
      const c=this.ctx,w=this.w,h=this.h;
      c.fillStyle='#020202';c.fillRect(0,0,w,h);
      const p=ease(t/2.5);c.fillStyle=`rgba(113,8,8,${.20*p})`;c.fillRect(0,0,w,h);
      const glow=c.createRadialGradient(w*.5,h*.55,0,w*.5,h*.55,w*.45);glow.addColorStop(0,`rgba(178,18,12,${.14*p})`);glow.addColorStop(1,'transparent');c.fillStyle=glow;c.fillRect(0,0,w,h);
      c.textAlign='center';c.fillStyle=`rgba(238,232,218,${p})`;c.font=`700 ${Math.max(11,w*.010)}px monospace`;c.letterSpacing='4px';c.fillText('03:17:42  ·  SETOR 11',w*.5,h*.49);
      c.fillStyle=`rgba(196,46,38,${p*.9})`;c.font=`900 ${Math.max(18,w*.019)}px Arial`;c.fillText('PRIMEIRAS CHAMADAS',w*.5,h*.55);
    }

    renderGunfire(t){
      const c=this.ctx,w=this.w,h=this.h;const road=this.drawCityBase(t*18,true);
      const redPulse=.06+.08*(.5+.5*Math.sin(t*5));c.fillStyle=`rgba(172,15,13,${redPulse})`;c.fillRect(0,0,w,h);
      // abandoned cars
      c.fillStyle='#191b1b';for(let i=0;i<4;i++){const x=w*(.1+i*.27)-t*20%(w*.2);c.fillRect(x,road+35+(i%2)*45,w*.11,h*.05);}
      const shots=[.55,.92,1.48,2.12,2.46,3.22,3.52,4.28,4.73];
      for(let i=0;i<3;i++){const muzzle=shots.some(s=>Math.abs(t-s)<.065)&&Math.floor((t*10+i))%3===i;this.drawSoldier(w*(.13+i*.095),road+80+i*9,.9,1,muzzle);}
      for(let i=0;i<9;i++){const zX=w*.63+i*w*.055-Math.max(0,t-1.2)*18;this.drawZombie(zX,road+82+(i%3)*16,.70+(i%3)*.08,t*2+i,.78);}
      // muzzle light wash
      if(shots.some(s=>Math.abs(t-s)<.08)){const g=c.createRadialGradient(w*.34,road+60,10,w*.34,road+60,w*.38);g.addColorStop(0,'rgba(255,181,71,.25)');g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(0,0,w,h);}
      c.fillStyle='rgba(0,0,0,.30)';c.fillRect(0,0,w,h);
    }

    renderHospital(t){
      const c=this.ctx,w=this.w,h=this.h;const p=clamp(t/5.6);
      c.fillStyle='#c7c2b6';c.fillRect(0,0,w,h);
      // corridor perspective
      const cx=w*.5,hy=h*.46;c.fillStyle='#9d9a91';c.beginPath();c.moveTo(0,0);c.lineTo(cx-w*.18,hy);c.lineTo(cx+w*.18,hy);c.lineTo(w,0);c.closePath();c.fill();c.fillStyle='#6b6964';c.beginPath();c.moveTo(0,h);c.lineTo(cx-w*.18,hy);c.lineTo(cx+w*.18,hy);c.lineTo(w,h);c.closePath();c.fill();
      c.strokeStyle='rgba(70,69,64,.35)';c.lineWidth=2;for(let i=0;i<7;i++){const y=lerp(hy,h,i/6);c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke();}
      // doors
      for(const side of [-1,1])for(let i=0;i<3;i++){const yy=h*(.24+i*.18),ww=w*(.08+i*.015),xx=side<0?w*(.06+i*.11):w*(.94-i*.11)-ww;c.fillStyle='#3d4545';c.fillRect(xx,yy,ww,h*.20);}
      const stX=lerp(w*.68,w*.37,p),stY=lerp(h*.68,h*.73,p);this.drawStretcher(stX,stY,.95);
      this.drawHuman(stX-65,stY+3,.88,'#182024',Math.sin(t*8),true);this.drawHuman(stX+67,stY+2,.88,'#182024',Math.sin(t*8+2),true);
      this.drawHuman(w*.20, h*.67,.82,'#273031',Math.sin(t*6),true);
      // emergency strobe
      const strobe=Math.sin(t*8)>0?.12:.035;c.fillStyle=`rgba(208,18,17,${strobe})`;c.fillRect(0,0,w,h);
      c.fillStyle='rgba(22,22,22,.20)';c.fillRect(0,0,w,h);
    }

    renderPanic(t){
      const c=this.ctx,w=this.w,h=this.h;const road=this.drawCityBase(t*38,false);
      const flare=c.createLinearGradient(0,0,w,0);flare.addColorStop(0,'rgba(40,80,160,.10)');flare.addColorStop(.5,'rgba(190,20,18,.13)');flare.addColorStop(1,'rgba(255,85,30,.08)');c.fillStyle=flare;c.fillRect(0,0,w,h);
      // ambulance passes
      this.drawAmbulance(w*.88-t*w*.18,road+48,.95,true);
      // crowd runs left
      for(let i=0;i<15;i++){
        const base=(i*83)%Math.max(300,w*1.2);const x=(w+160-((t*190+base)%(w+320)))-80;const y=road+62+(i%5)*30;this.drawHuman(x,y,.62+(i%4)*.07,['#111','#1a1717','#15191b'][i%3],Math.sin(t*11+i));
      }
      // panic cards / papers
      c.fillStyle='rgba(218,211,190,.45)';for(let i=0;i<18;i++){const x=(i*137+t*50)%w,y=road+20+((i*83+t*80)%Math.max(80,h-road-40));c.save();c.translate(x,y);c.rotate(t+i);c.fillRect(-4,-2,8,4);c.restore();}
      c.fillStyle='rgba(35,0,0,.12)';c.fillRect(0,0,w,h);
    }

    renderOutbreak(t){
      const c=this.ctx,w=this.w,h=this.h;c.fillStyle='#020303';c.fillRect(0,0,w,h);
      // alley walls
      const vg=c.createLinearGradient(0,0,w,0);vg.addColorStop(0,'#171818');vg.addColorStop(.23,'#050606');vg.addColorStop(.77,'#050606');vg.addColorStop(1,'#161717');c.fillStyle=vg;c.fillRect(0,0,w,h);
      c.fillStyle='rgba(120,10,8,.15)';c.fillRect(w*.46,0,w*.08,h);
      const fog=c.createRadialGradient(w*.5,h*.62,0,w*.5,h*.62,w*.42);fog.addColorStop(0,'rgba(170,29,20,.10)');fog.addColorStop(1,'transparent');c.fillStyle=fog;c.fillRect(0,0,w,h);
      for(let i=0;i<13;i++){const depth=(i%6)/6,appear=clamp((t-i*.16)/1.8),x=w*(.28+((i*47)%45)/100),y=h*(.52+depth*.30),s=.50+depth*.65;this.drawZombie(x+(i%2?1:-1)*Math.sin(t+i)*12,y,s,t*2+i,appear);}
      // foreground hand/glass hit on late scene
      if(t>3.7){const k=ease((t-3.7)/1.5);c.strokeStyle=`rgba(22,22,22,${.9*k})`;c.lineWidth=18;c.lineCap='round';c.beginPath();c.moveTo(w*.83,h*.82);c.lineTo(w*.68,h*.55);c.moveTo(w*.68,h*.55);c.lineTo(w*.60,h*.45);c.moveTo(w*.68,h*.55);c.lineTo(w*.76,h*.43);c.stroke();c.strokeStyle=`rgba(220,220,210,${.18*k})`;c.lineWidth=1;for(let i=0;i<11;i++){const a=i/11*TAU;c.beginPath();c.moveTo(w*.68,h*.55);c.lineTo(w*.68+Math.cos(a)*w*.24,h*.55+Math.sin(a)*h*.28);c.stroke();}}
      c.fillStyle='rgba(0,0,0,.18)';c.fillRect(0,0,w,h);
    }

    renderCollapse(t){
      const c=this.ctx,w=this.w,h=this.h;const road=this.drawCityBase(t*14,true);c.fillStyle='rgba(173,18,12,.10)';c.fillRect(0,0,w,h);
      // checkpoint barrier
      c.strokeStyle='#393a35';c.lineWidth=12;c.beginPath();c.moveTo(w*.30,road+72);c.lineTo(w*.72,road+72);c.stroke();for(let i=0;i<7;i++){c.fillStyle=i%2?'#8a2520':'#d0c7b6';c.fillRect(w*.31+i*w*.058,road+66,w*.035,11);}
      const shots=[1.0,1.28,2.12,3.38,3.72,4.88,5.45];for(let i=0;i<4;i++){const muzzle=shots.some(s=>Math.abs(t-s)<.07)&&i===Math.floor(t*3)%4;this.drawSoldier(w*(.18+i*.10),road+118,.88,1,muzzle);}
      for(let i=0;i<14;i++){const x=w*.72+i*w*.035-Math.max(0,t-1)*23,y=road+95+(i%4)*22;this.drawZombie(x,y,.68+(i%4)*.08,t*2+i,.9);}
      if(t>4.9){const p=ease((t-4.9)/1.1);c.save();c.translate(w*.51,road+72);c.rotate(p*.48);c.strokeStyle='#393a35';c.lineWidth=12;c.beginPath();c.moveTo(-w*.21,0);c.lineTo(w*.21,0);c.stroke();c.restore();}
      c.fillStyle='rgba(0,0,0,.28)';c.fillRect(0,0,w,h);
    }

    renderSurvivor(t){
      const c=this.ctx,w=this.w,h=this.h;c.fillStyle='#020202';c.fillRect(0,0,w,h);
      const glow=c.createRadialGradient(w*.5,h*.58,10,w*.5,h*.58,w*.45);glow.addColorStop(0,'rgba(176,30,18,.28)');glow.addColorStop(.55,'rgba(70,9,7,.12)');glow.addColorStop(1,'transparent');c.fillStyle=glow;c.fillRect(0,0,w,h);
      const p=ease(t/3.5),x=w*.5,y=lerp(h*.88,h*.70,p);this.drawHuman(x,y,1.8,'#090b0b',0,false);
      // weapon silhouette
      c.save();c.translate(x,y);c.scale(1.8,1.8);c.strokeStyle='#030303';c.lineWidth=7;c.beginPath();c.moveTo(5,-11);c.lineTo(34,-17);c.stroke();c.restore();
      // distant zombies
      for(let i=0;i<11;i++)this.drawZombie(w*(.08+i*.085),h*.78+(i%3)*15,.55+(i%2)*.1,t+i,.52);
      c.fillStyle=`rgba(0,0,0,${.55-.3*p})`;c.fillRect(0,0,w,h);
    }

    renderTitle(t){
      const c=this.ctx,w=this.w,h=this.h,p=ease(t/1.15),fade=1-clamp((t-3.15)/.65);c.fillStyle='#020202';c.fillRect(0,0,w,h);
      const g=c.createRadialGradient(w*.5,h*.48,0,w*.5,h*.48,w*.48);g.addColorStop(0,`rgba(155,22,17,${.18*p})`);g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(0,0,w,h);
      c.textAlign='center';c.shadowBlur=28;c.shadowColor='rgba(199,28,23,.45)';c.fillStyle=`rgba(237,232,219,${p*fade})`;c.font=`900 ${Math.max(38,Math.min(92,w*.07))}px Impact,Arial Black,sans-serif`;c.fillText('ZOMBIE',w*.5-w*.115,h*.49);c.fillStyle=`rgba(226,42,34,${p*fade})`;c.fillText('SURVIVAL',w*.5+w*.16,h*.49);c.shadowBlur=0;c.fillStyle=`rgba(218,214,202,${.62*p*fade})`;c.font=`700 ${Math.max(11,w*.012)}px Arial`;c.letterSpacing='8px';c.fillText('O N L I N E',w*.5,h*.56);c.letterSpacing='0px';c.fillStyle=`rgba(203,198,189,${.52*p*fade})`;c.font=`600 ${Math.max(10,w*.009)}px Arial`;c.fillText('A QUEDA FOI SÓ O COMEÇO.',w*.5,h*.66);
    }

    drawFilm(t,scene){
      const c=this.ctx,w=this.w,h=this.h;
      // vignette
      const v=c.createRadialGradient(w*.5,h*.5,Math.min(w,h)*.12,w*.5,h*.5,Math.max(w,h)*.72);v.addColorStop(0,'transparent');v.addColorStop(.68,'rgba(0,0,0,.10)');v.addColorStop(1,'rgba(0,0,0,.80)');c.fillStyle=v;c.fillRect(0,0,w,h);
      // grain
      c.save();c.globalAlpha=.055;c.fillStyle='#fff';const amount=Math.min(180,Math.floor(w*h/12000));for(let i=0;i<amount;i++){const x=(Math.sin((i+1)*12.9898+t*31.3)*43758.5453%1+1)%1*w,y=(Math.sin((i+17)*78.233+t*19.7)*12345.678%1+1)%1*h;c.fillRect(x,y,1+((i*7)%2),1);}c.restore();
      // scan flicker
      c.fillStyle=`rgba(255,255,255,${.008+.006*Math.sin(t*41)})`;c.fillRect(0,0,w,h);
      // cut flash
      if(this.flash>0){c.fillStyle=`rgba(241,232,217,${this.flash})`;c.fillRect(0,0,w,h);}
      // letterbox
      const bar=Math.max(28,h*.085);c.fillStyle='#000';c.fillRect(0,0,w,bar);c.fillRect(0,h-bar,w,bar);
      // subtle frame lines
      c.strokeStyle='rgba(255,255,255,.045)';c.lineWidth=1;c.strokeRect(7,bar+7,w-14,h-bar*2-14);
    }

    updateText(t,scene){
      if(this.timecode){const mins=String(Math.floor(t/60)).padStart(2,'0'),secs=String(Math.floor(t%60)).padStart(2,'0'),frames=String(Math.floor((t%1)*24)).padStart(2,'0');this.timecode.textContent=`REC  ${mins}:${secs}:${frames}`;}
      if(!this.caption)return;
      const data=[
        ['ARQUIVO DE EMERGÊNCIA','03:17 — PRIMEIRAS CHAMADAS'],
        ['SETOR 11','“CONTATO HOSTIL. REPITO: CONTATO HOSTIL.”'],
        ['HOSPITAL CENTRAL','PROTOCOLO DE CONTENÇÃO: FALHOU'],
        ['AVENIDA NORTE','CORRE! NÃO PARA!'],
        ['QUARENTENA','A INFECÇÃO JÁ ESTAVA DENTRO.'],
        ['ÚLTIMA LINHA','A CIDADE CAIU EM 17 MINUTOS.'],
        ['TRANSMISSÃO DESCONHECIDA','“SE VOCÊ ESTÁ OUVINDO... SOBREVIVA.”'],
        ['', '']
      ][scene];
      this.caption.innerHTML=data[0]?`<small>${data[0]}</small><b>${data[1]}</b>`:'';
    }
  }

  window.IntroCutscene={
    async play(){
      const ctrl=new IntroCutsceneController();
      window.__introCutscene=ctrl;
      return ctrl.play();
    }
  };
})();
