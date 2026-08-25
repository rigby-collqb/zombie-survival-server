class ZombieManager{
  constructor(){this.zombies=new Map();}
  _normalizeSnapshot(d){
    if(!d||d.id==null)return null;const x=Number(d.x),y=Number(d.y);if(!Number.isFinite(x)||!Number.isFinite(y))return null;
    return{...d,id:Number(d.id),x,y,health:Number(d.health)||0,maxHealth:Number(d.maxHealth)||100,directionX:Number(d.directionX)||0,directionY:Number(d.directionY)||1,state:d.state||'idle',type:d.type||'normal',radius:Number(d.radius)||15,speed:Number(d.speed)||70};
  }
  applySnapshots(list){
    if(!Array.isArray(list))return;const seen=new Set();
    for(const raw of list){const d=this._normalizeSnapshot(raw);if(!d)continue;seen.add(d.id);let z=this.zombies.get(d.id);if(z)z.applySnapshot(d);else{z=new Zombie(d);this.zombies.set(d.id,z);}z.x=d.x;z.y=d.y;}
    for(const id of this.zombies.keys())if(!seen.has(id))this.zombies.delete(id);
  }
  update(dt){for(const[id,z]of this.zombies){z.update(dt);if(z.removed)this.zombies.delete(id);}}
  render(ctx,camera,p){if(!ctx||!camera||!p)return;const cx=p.x+p.width/2,cy=p.y+p.height/2;for(const z of this.zombies.values()){if(!Number.isFinite(z._visualX)||!Number.isFinite(z._visualY))continue;z.render(ctx,camera,z.distanceTo(cx,cy)<ZOMBIE_VISUAL_CONFIG.NEARBY_HEALTHBAR_DISTANCE);}}
  getAliveCount(){let n=0;for(const z of this.zombies.values())if(!z.removed&&z.state!=='dead')n++;return n;}
  triggerHitFlash(id){this.zombies.get(Number(id))?.triggerHitFlash();}
  findZombieAlongRay(ox,oy,dx,dy,maxDistance){
    let best=null,bestD=Infinity;
    for(const z of this.zombies.values()){
      if(z.state==='dead')continue;const zx=z._visualX,zy=z._visualY;const vx=zx-ox,vy=zy-oy,t=vx*dx+vy*dy;if(t<0||t>maxDistance)continue;
      const px=ox+dx*t,py=oy+dy*t,dist=Math.hypot(zx-px,zy-py);if(dist<=z.radius+8&&t<bestD){bestD=t;best=z;}
    }
    return best?{zombie:best,distance:bestD}:null;
  }
}
