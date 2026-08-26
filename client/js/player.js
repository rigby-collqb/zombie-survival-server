let __playerIdCounter = 0;
function generatePlayerId() { __playerIdCounter++; return `local-${Date.now()}-${__playerIdCounter}`; }

class Player {
  constructor({ id=null, name='Sobrevivente', x=0, y=0 }={}) {
    this.id=id||generatePlayerId(); this.name=name; this.x=x; this.y=y;
    this.direction='down'; this.moving=false; this.vx=0; this.vy=0;
    this.health=100; this.maxHealth=100; this.alive=true; this.downed=false;
    this.aimDirX=0; this.aimDirY=1; this.currentWeapon='pistol';
    this.skinId='survivor_blue';this.weaponSkinId='default';this.ping=null;this.score=0;
    this.kills=0; this.speed=220; this.width=28; this.height=28;
    this._renderX=x; this._renderY=y;
    this._muzzleFlashMs=0; this._weaponKick=0; this._reloadMs=0; this._reloadTotalMs=0;
  }

  getCollisionRect(){const pad=6;return{x:this.x+pad,y:this.y+pad*1.4,width:this.width-pad*2,height:this.height-pad*1.4};}

  updatePlayer(dt,moveX,moveY,gameMap){
    this.moving=moveX!==0||moveY!==0;
    if(this.moving){
      this.direction=this._directionFromVector(moveX,moveY,this.direction);
      this.vx=moveX*this.speed;this.vy=moveY*this.speed;
      const nextX=this.x+moveX*this.speed*dt,nextY=this.y+moveY*this.speed*dt;
      const rect=this.getCollisionRect(),offX=rect.x-this.x,offY=rect.y-this.y;
      const nearby=gameMap.getObstaclesNear(this.x+this.width/2,this.y+this.height/2,140);
      const res=Collision.resolveMovement(rect,nextX+offX,nextY+offY,nearby);
      this.x=res.x-offX;this.y=res.y-offY;
      const c=Collision.clampToWorld({x:this.x,y:this.y,width:this.width,height:this.height},gameMap.width,gameMap.height);
      this.x=c.x;this.y=c.y;
    } else {this.vx=0;this.vy=0;}
    this._renderX=this.x;this._renderY=this.y;
  }

  updateRemotePlayer(s){
    this.x=s.x;this.y=s.y;this.direction=s.direction??this.direction;this.moving=s.moving??false;
    this.health=s.health??this.health;this.maxHealth=s.maxHealth??this.maxHealth;this.alive=s.alive??this.alive;this.downed=s.downed??this.downed;
    if(typeof s.aimDirX==='number')this.aimDirX=s.aimDirX;if(typeof s.aimDirY==='number')this.aimDirY=s.aimDirY;
    if(s.weaponId)this.currentWeapon=s.weaponId;if(s.skinId)this.skinId=s.skinId;if(s.weaponSkinId)this.weaponSkinId=s.weaponSkinId;if(Number.isFinite(Number(s.ping)))this.ping=Number(s.ping);if(Number.isFinite(Number(s.score)))this.score=Number(s.score);
    this._renderX=this.x;this._renderY=this.y;
  }

  setAim(x,y){this.aimDirX=x;this.aimDirY=y;}
  setWeapon(id){if(id)this.currentWeapon=id;}
  setReloadState(remainingMs,totalMs){this._reloadMs=Math.max(0,Number(remainingMs)||0);this._reloadTotalMs=Math.max(this._reloadMs,Number(totalMs)||this._reloadMs);}
  triggerMuzzleFlash(weaponId=this.currentWeapon){this.currentWeapon=weaponId||this.currentWeapon;this._muzzleFlashMs=this.currentWeapon==='shotgun'?105:70;}
  triggerRecoil(amount=2){this._weaponKick=Math.max(this._weaponKick,Number(amount)||0);}

  updateWeaponVisuals(dt){
    if(this._muzzleFlashMs>0)this._muzzleFlashMs-=dt*1000;
    if(this._reloadMs>0)this._reloadMs=Math.max(0,this._reloadMs-dt*1000);
    this._weaponKick*=Math.pow(0.025,dt);
  }

  _directionFromVector(x,y,cur){if(Math.abs(x)>Math.abs(y))return x>0?'right':'left';if(y!==0)return y>0?'down':'up';return cur;}
  renderPlayer(ctx,camera){this._renderAt(ctx,camera,this._renderX,this._renderY,clientCharacterSkin(this.skinId).body);}
  renderRemotePlayer(ctx,camera){this._renderAt(ctx,camera,this._renderX,this._renderY,clientCharacterSkin(this.skinId).body);this._renderNameTag(ctx,camera);}

  _weaponStyle(){
    const id=this.currentWeapon;
    let base;
    if(id==='smg')base={length:24,width:5,color:'#25292b',flash:'#ffe06a'};
    else if(id==='shotgun')base={length:30,width:7,color:'#3b3129',flash:'#ffbb45'};
    else if(id==='rifle')base={length:34,width:5,color:'#202426',flash:'#fff0a8'};
    else base={length:20,width:4,color:'#2a2a2a',flash:'#ffe39a'};
    const skin=clientWeaponSkin(this.weaponSkinId);if(skin.color)base={...base,color:skin.color};
    return base;
  }

  _renderAt(ctx,camera,worldX,worldY,bodyColor){
    const s=camera.worldToScreen(worldX,worldY),cx=s.x+this.width/2,cy=s.y+this.height/2,dead=this.alive===false,downed=this.downed===true;
    ctx.fillStyle='rgba(0,0,0,.3)';ctx.beginPath();ctx.ellipse(cx,s.y+this.height+2,this.width*.4,6,0,0,Math.PI*2);ctx.fill();
    ctx.save();if(dead)ctx.globalAlpha=.45;
    if(downed){
      ctx.translate(cx,cy);ctx.rotate(-0.38);ctx.fillStyle='#a45a42';ctx.beginPath();ctx.ellipse(0,0,this.width*.62,this.height*.34,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(0,0,0,.5)';ctx.lineWidth=2;ctx.stroke();
      ctx.fillStyle='#ffd36a';ctx.font='900 12px Arial';ctx.textAlign='center';ctx.fillText('!',0,-16);ctx.restore();return;
    }
    ctx.fillStyle=dead?'#6a6a6a':bodyColor;ctx.beginPath();ctx.arc(cx,cy,this.width/2,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(0,0,0,.4)';ctx.lineWidth=2;ctx.stroke();
    if(!dead){
      const aim=this._aimVector(),style=this._weaponStyle();
      const reloadPct=this._reloadTotalMs>0&&this._reloadMs>0?1-this._reloadMs/this._reloadTotalMs:0;
      const reloadAngle=this._reloadMs>0?Math.sin(reloadPct*Math.PI)*0.8:0;
      const angle=Math.atan2(aim.y,aim.x)+reloadAngle;
      const ax=Math.cos(angle),ay=Math.sin(angle);
      const kick=Math.min(7,this._weaponKick);
      const gunLength=this.width/2+style.length-kick;
      ctx.strokeStyle=style.color;ctx.lineWidth=style.width;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+ax*gunLength,cy+ay*gunLength);ctx.stroke();
      if(this._muzzleFlashMs>0){
        const mx=cx+ax*gunLength,my=cy+ay*gunLength,sideX=-ay,sideY=ax;
        const size=this.currentWeapon==='shotgun'?28:(this.currentWeapon==='rifle'?23:18);
        ctx.save();ctx.globalCompositeOperation='lighter';
        const glow=ctx.createRadialGradient(mx,my,0,mx,my,size);glow.addColorStop(0,'rgba(255,255,225,.98)');glow.addColorStop(.35,'rgba(255,210,80,.78)');glow.addColorStop(1,'rgba(255,120,20,0)');ctx.fillStyle=glow;ctx.beginPath();ctx.arc(mx,my,size,0,Math.PI*2);ctx.fill();
        ctx.fillStyle=style.flash;ctx.beginPath();ctx.moveTo(mx,my);ctx.lineTo(mx+ax*size*1.3+sideX*size*.35,my+ay*size*1.3+sideY*size*.35);ctx.lineTo(mx+ax*size*.72,my+ay*size*.72);ctx.lineTo(mx+ax*size*1.3-sideX*size*.35,my+ay*size*1.3-sideY*size*.35);ctx.closePath();ctx.fill();ctx.restore();
      }
    }
    ctx.restore();
  }

  _aimVector(){const len=Math.hypot(this.aimDirX,this.aimDirY);return len<.0001?this._directionVector():{x:this.aimDirX/len,y:this.aimDirY/len};}
  _directionVector(){switch(this.direction){case'up':return{x:0,y:-1};case'down':return{x:0,y:1};case'left':return{x:-1,y:0};case'right':return{x:1,y:0};default:return{x:0,y:1};}}
  _renderNameTag(ctx,camera){
    const s=camera.worldToScreen(this._renderX,this._renderY),cx=s.x+this.width/2;
    const label=this.downed?`${this.name} · CAÍDO`:this.name;
    ctx.save();ctx.textAlign='center';ctx.font='700 11px Segoe UI,sans-serif';ctx.fillStyle=this.downed?'#ffd36a':'rgba(245,245,240,.95)';ctx.shadowColor='rgba(0,0,0,.8)';ctx.shadowBlur=3;ctx.fillText(label,cx,s.y-16);
    if(this.ping!=null){ctx.font='9px Segoe UI,sans-serif';ctx.fillStyle=this.ping<100?'#8ff5a1':this.ping<200?'#f1d66b':'#ff7d72';ctx.fillText(`${Math.round(this.ping)}ms`,cx,s.y-5);}
    const pct=Math.max(0,Math.min(1,(Number(this.health)||0)/Math.max(1,Number(this.maxHealth)||100))),w=34,h=4;ctx.shadowBlur=0;ctx.fillStyle='rgba(0,0,0,.55)';ctx.fillRect(cx-w/2,s.y+this.height+7,w,h);ctx.fillStyle=pct>.55?'#69cf78':pct>.25?'#e0bb50':'#d95750';ctx.fillRect(cx-w/2,s.y+this.height+7,w*pct,h);ctx.restore();
  }
}
