const EVENT_DEFS=Object.freeze({
  blackout:{id:'blackout',name:'BLACKOUT',description:'A energia caiu. A visibilidade despencou.',duration:24},
  horde:{id:'horde',name:'HORDA',description:'Uma massa de infectados foi atraída para a área.',duration:22},
  supply:{id:'supply',name:'SUPPLY DROP',description:'Um pacote de emergência caiu no mapa.',duration:18},
  bloodmoon:{id:'bloodmoon',name:'LUA DE SANGUE',description:'Os infectados ficaram mais rápidos e agressivos.',duration:24},
});
class RandomEventSystem{
  constructor(){this.active=null;this.remaining=0;this.untilNext=55+Math.random()*35;}
  reset(){this.active=null;this.remaining=0;this.untilNext=55+Math.random()*35;}
  tick(dt,running,onStart,onEnd){
    if(this.active){this.remaining-=dt;if(this.remaining<=0){const old=this.active;this.active=null;this.remaining=0;this.untilNext=60+Math.random()*45;onEnd?.(old);}return;}
    if(!running)return;
    this.untilNext-=dt;
    if(this.untilNext>0)return;
    const ids=Object.keys(EVENT_DEFS),id=ids[Math.floor(Math.random()*ids.length)],evt={...EVENT_DEFS[id],startedAt:Date.now()};
    this.active=evt;this.remaining=evt.duration;onStart?.(evt);
  }
  snapshot(){return this.active?{...this.active,remaining:Math.max(0,this.remaining)}:null;}
}
RandomEventSystem.DEFS=EVENT_DEFS;
module.exports=RandomEventSystem;
