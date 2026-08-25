const config = require('./config');

const DEFINITIONS = Object.freeze([
  { id:'outpost_door', type:'door', label:'PORTA DO POSTO', x:2174, y:1950, width:20, height:110, range:92, initial:{open:false} },
  { id:'north_barricade', type:'barricade', label:'BARRICADA NORTE', x:1950, y:1799, width:100, height:22, range:100, cost:50, initial:{repaired:false} },
  { id:'outpost_generator', type:'generator', label:'GERADOR', x:1980, y:1990, width:42, height:42, range:96, initial:{on:false} },
  { id:'outpost_crate', type:'crate', label:'CAIXA DE SUPRIMENTOS', x:1895, y:2080, width:42, height:34, range:88, initial:{opened:false} },
  { id:'hospital_crate', type:'crate', label:'CAIXA MÉDICA', x:665, y:810, width:42, height:34, range:88, initial:{opened:false} },
  { id:'military_gate', type:'gate', label:'PORTÃO MILITAR', x:3130, y:2918, width:140, height:24, range:125, cost:600, initial:{unlocked:false,open:false} },
  { id:'military_crate', type:'crate', label:'CAIXA MILITAR', x:3295, y:3150, width:46, height:36, range:92, initial:{opened:false} },
  { id:'police_crate', type:'crate', label:'ARMÁRIO DA DELEGACIA', x:1690, y:610, width:46, height:36, range:92, initial:{opened:false} },
  { id:'market_crate', type:'crate', label:'ESTOQUE DO MERCADO', x:2715, y:680, width:46, height:36, range:92, initial:{opened:false} },
  { id:'hospital_medstation', type:'medstation', label:'ESTAÇÃO MÉDICA', x:755, y:785, width:42, height:42, range:92, cost:60, initial:{} },
  { id:'scrapyard_ammo', type:'ammo_station', label:'BANCADA DE MUNIÇÃO', x:1705, y:3340, width:50, height:36, range:92, cost:80, initial:{} },
]);

class InteractionSystem {
  constructor() {
    this.items = new Map();
    this._lastRound = 0;
    for (const def of DEFINITIONS) this.items.set(def.id, { ...def, state:{...def.initial} });
  }

  getSnapshot() {
    return [...this.items.values()].map(i=>({
      id:i.id,type:i.type,label:i.label,x:i.x,y:i.y,width:i.width,height:i.height,
      range:i.range,cost:i.cost||0,state:{...i.state}
    }));
  }

  _blocking(item) {
    if (item.type === 'door') return item.state.open !== true;
    if (item.type === 'gate') return item.state.open !== true;
    if (item.type === 'barricade') return item.state.repaired === true;
    return false;
  }

  getBlockingObstacles() {
    const out=[];
    for(const i of this.items.values()) if(this._blocking(i)) out.push({
      type:'interaction',subtype:i.type,interactionId:i.id,
      x:i.x,y:i.y,width:i.width,height:i.height,solid:true
    });
    return out;
  }

  onRoundState(round) {
    const n = Number(round?.number)||0;
    if (round?.state !== 'running' || n <= 0 || n === this._lastRound) return false;
    this._lastRound = n;
    let changed=false;
    for(const i of this.items.values()){
      if(i.type==='crate' && i.state.opened){i.state.opened=false;changed=true;}
    }
    return changed;
  }

  interact(player, id) {
    const item=this.items.get(String(id||''));
    if(!item||!player||!player.alive)return{success:false,error:'invalid_interaction'};
    const px=player.x+config.PLAYER_COLLISION_RADIUS,py=player.y+config.PLAYER_COLLISION_RADIUS;
    const cx=item.x+item.width/2,cy=item.y+item.height/2;
    if(Math.hypot(px-cx,py-cy)>(item.range||90))return{success:false,error:'too_far'};

    let reward=null;
    if(item.type==='door'){
      item.state.open=!item.state.open;
    }else if(item.type==='gate'){
      if(!item.state.unlocked){
        const cost=item.cost||0;
        if(player.money<cost)return{success:false,error:'not_enough_money'};
        player.money-=cost;item.state.unlocked=true;item.state.open=true;
      }else item.state.open=!item.state.open;
    }else if(item.type==='barricade'){
      if(item.state.repaired){item.state.repaired=false;}
      else{
        const cost=item.cost||0;
        if(player.money<cost)return{success:false,error:'not_enough_money'};
        player.money-=cost;item.state.repaired=true;
      }
    }else if(item.type==='generator'){
      if(item.state.on)return{success:false,error:'already_active'};
      item.state.on=true;
    }else if(item.type==='crate'){
      if(item.state.opened)return{success:false,error:'already_used'};
      item.state.opened=true;
      reward=this._giveCrateReward(player,item.id);
    }else if(item.type==='medstation'){
      if(player.health>=player.maxHealth)return{success:false,error:'health_full'};
      const cost=item.cost||0;if(player.money<cost)return{success:false,error:'not_enough_money'};
      player.money-=cost;const amount=Math.min(60,player.maxHealth-player.health);player.health+=amount;reward={kind:'health',amount};
    }else if(item.type==='ammo_station'){
      const state=player.weapons[player.activeWeaponId];if(!state)return{success:false,error:'invalid_weapon'};
      const cost=item.cost||0;if(player.money<cost)return{success:false,error:'not_enough_money'};
      player.money-=cost;const amount=45;state.reserve+=amount;reward={kind:'ammo',amount};
    }else return{success:false,error:'invalid_interaction'};

    return{success:true,item:this._public(item),reward};
  }

  _giveCrateReward(player,id){
    const r=Math.random();
    if((['hospital_crate','market_crate'].includes(id) && player.health<player.maxHealth) || (r>.66 && player.health<player.maxHealth)){
      const amount=Math.min(45,player.maxHealth-player.health);player.health+=amount;return{kind:'health',amount};
    }
    if(['military_crate','police_crate'].includes(id) || r<.48){
      const state=player.weapons[player.activeWeaponId];const amount=id==='military_crate'?60:id==='police_crate'?45:30;if(state)state.reserve+=amount;return{kind:'ammo',amount};
    }
    const amount=35+Math.floor(Math.random()*46);player.money+=amount;return{kind:'money',amount};
  }

  _public(i){return{id:i.id,type:i.type,label:i.label,x:i.x,y:i.y,width:i.width,height:i.height,range:i.range,cost:i.cost||0,state:{...i.state}};}
}

InteractionSystem.DEFINITIONS=DEFINITIONS;
module.exports=InteractionSystem;
