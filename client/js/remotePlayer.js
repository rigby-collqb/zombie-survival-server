const REMOTE_PLAYER_CONFIG={MAX_EXTRAPOLATION_MS:500,SNAP_DISTANCE:250,CORRECTION_SMOOTHING:12};
class RemotePlayer{
  constructor(data){
    this.id=data.id;this._player=new Player({id:String(data.id),name:data.name,x:data.x,y:data.y});
    this._player.direction=data.direction||'down';this._player.health=data.health??100;this._player.maxHealth=data.maxHealth??100;this._player.alive=data.alive??true;this._player.downed=data.downed??false;
    this._player.aimDirX=data.aimDirX??0;this._player.aimDirY=data.aimDirY??1;this._player.currentWeapon=data.weaponId||'pistol';this._player.skinId=data.skinId||'survivor_blue';this._player.weaponSkinId=data.weaponSkinId||'default';this._player.ping=Number.isFinite(Number(data.ping))?Number(data.ping):null;this._player.score=Number(data.score)||0;
    this._visualX=data.x;this._visualY=data.y;this.serverX=data.x;this.serverY=data.y;this.velocityX=data.vx||0;this.velocityY=data.vy||0;this.moving=!!data.moving;this.timeSinceLastSnapshot=0;
  }
  applySnapshot(data){
    this.serverX=data.x;this.serverY=data.y;this.velocityX=data.vx||0;this.velocityY=data.vy||0;this.moving=!!data.moving;this.timeSinceLastSnapshot=0;
    this._player.direction=data.direction||this._player.direction;this._player.health=data.health??this._player.health;this._player.maxHealth=data.maxHealth??this._player.maxHealth;this._player.alive=data.alive??this._player.alive;this._player.downed=data.downed??this._player.downed;
    this._player.aimDirX=data.aimDirX??this._player.aimDirX;this._player.aimDirY=data.aimDirY??this._player.aimDirY;this._player.name=data.name||this._player.name;if(data.weaponId)this._player.currentWeapon=data.weaponId;if(data.skinId)this._player.skinId=data.skinId;if(data.weaponSkinId)this._player.weaponSkinId=data.weaponSkinId;if(data.ping!==undefined)this._player.ping=Number.isFinite(Number(data.ping))?Number(data.ping):null;if(data.score!==undefined)this._player.score=Number(data.score)||0;
  }
  interpolate(dt){
    this.timeSinceLastSnapshot+=dt*1000;const sec=Math.min(this.timeSinceLastSnapshot,REMOTE_PLAYER_CONFIG.MAX_EXTRAPOLATION_MS)/1000;
    const px=this.moving?this.serverX+this.velocityX*sec:this.serverX,py=this.moving?this.serverY+this.velocityY*sec:this.serverY;
    const dx=px-this._visualX,dy=py-this._visualY,d=Math.hypot(dx,dy);
    if(d>=REMOTE_PLAYER_CONFIG.SNAP_DISTANCE){this._visualX=px;this._visualY=py;}else{const t=1-Math.exp(-REMOTE_PLAYER_CONFIG.CORRECTION_SMOOTHING*dt);this._visualX+=dx*t;this._visualY+=dy*t;}
    this._player.x=this._visualX;this._player.y=this._visualY;this._player._renderX=this._visualX;this._player._renderY=this._visualY;this._player.updateWeaponVisuals(dt);
  }
  triggerMuzzleFlash(weaponId){this._player.triggerMuzzleFlash(weaponId);this._player.triggerRecoil(clientWeapon(weaponId).recoil*.6);}
  triggerReload(durationMs){this._player.setReloadState(durationMs,durationMs);}
  render(ctx,camera){this._player.renderRemotePlayer(ctx,camera);}
}
