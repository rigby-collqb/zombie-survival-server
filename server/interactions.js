const config = require('./config');

const MAP_DEFINITIONS = Object.freeze({
  city:[
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
  ],
  hospital:[
    {id:'hospital_courtyard_gate',type:'gate',label:'PORTÃO DA EMERGÊNCIA',x:1800,y:1738,width:360,height:24,range:150,cost:0,initial:{unlocked:false,open:false}},
    {id:'hospital_generator',type:'generator',label:'GERADOR DE EMERGÊNCIA',x:1880,y:3430,width:46,height:46,range:98,initial:{on:false}},
    {id:'hospital_medstation',type:'medstation',label:'ESTAÇÃO MÉDICA',x:2070,y:3430,width:44,height:44,range:96,cost:45,initial:{}},
    {id:'hospital_supply',type:'crate',label:'SUPRIMENTOS DA EVACUAÇÃO',x:2190,y:3428,width:48,height:38,range:94,initial:{opened:false}},
    {id:'morgue_crate',type:'crate',label:'ARMÁRIO DA MORGUE',x:910,y:1160,width:46,height:36,range:92,initial:{opened:false}},
    {id:'pharmacy_crate',type:'crate',label:'ESTOQUE DA FARMÁCIA',x:3400,y:2680,width:46,height:36,range:92,initial:{opened:false}},
  ],
  forest:[
    {id:'ranger_barricade',type:'barricade',label:'BARRICADA DO POSTO',x:1950,y:1707,width:100,height:20,range:100,cost:35,initial:{repaired:false}},
    {id:'ranger_generator',type:'generator',label:'GERADOR DO POSTO',x:1770,y:2180,width:44,height:44,range:96,initial:{on:false}},
    {id:'ranger_crate',type:'crate',label:'CAIXA DO GUARDA FLORESTAL',x:2180,y:2160,width:46,height:36,range:92,initial:{opened:false}},
    {id:'camp_crate',type:'crate',label:'SUPRIMENTOS DO ACAMPAMENTO',x:930,y:3320,width:46,height:36,range:92,initial:{opened:false}},
    {id:'sawmill_ammo',type:'ammo_station',label:'BANCADA DA SERRARIA',x:2800,y:3340,width:52,height:36,range:94,cost:70,initial:{}},
  ],
  military:[
    {id:'omega_gate',type:'gate',label:'PORTÃO ÔMEGA',x:2000,y:3043,width:300,height:28,range:150,cost:0,initial:{unlocked:false,open:false}},
    {id:'checkpoint_crate',type:'crate',label:'CAIXA DO CHECKPOINT',x:820,y:3380,width:48,height:38,range:94,initial:{opened:false}},
    {id:'omega_generator',type:'generator',label:'GERADOR TÁTICO',x:1900,y:2840,width:46,height:46,range:96,initial:{on:false}},
    {id:'omega_ammo',type:'ammo_station',label:'ARSENAL',x:2870,y:2350,width:54,height:38,range:96,cost:60,initial:{}},
    {id:'omega_med',type:'medstation',label:'POSTO MÉDICO',x:1550,y:1610,width:44,height:44,range:94,cost:55,initial:{}},
    {id:'omega_crate',type:'crate',label:'CAIXA MILITAR',x:3200,y:2480,width:50,height:38,range:94,initial:{opened:false}},
  ],
  industrial:[
    {id:'factory_generator',type:'generator',label:'GERADOR DA FÁBRICA',x:1070,y:760,width:48,height:48,range:98,initial:{on:false}},
    {id:'factory_crate',type:'crate',label:'CAIXA DE FERRAMENTAS',x:920,y:780,width:48,height:38,range:94,initial:{opened:false}},
    {id:'warehouse_crate',type:'crate',label:'ESTOQUE DO ARMAZÉM',x:1350,y:3260,width:48,height:38,range:94,initial:{opened:false}},
    {id:'industrial_ammo',type:'ammo_station',label:'BANCADA INDUSTRIAL',x:1680,y:2860,width:54,height:38,range:96,cost:75,initial:{}},
    {id:'power_med',type:'medstation',label:'KIT DE EMERGÊNCIA',x:2810,y:3200,width:44,height:44,range:94,cost:55,initial:{}},
  ],
});

class InteractionSystem {
  constructor(mapId='city') {
    this.mapId=MAP_DEFINITIONS[mapId]?mapId:'city';
    this.items=new Map();this._lastRound=0;
    for(const def of MAP_DEFINITIONS[this.mapId])this.items.set(def.id,{...def,state:{...(def.initial||{})}});
  }
  getSnapshot(){return[...this.items.values()].map(i=>({id:i.id,type:i.type,label:i.label,x:i.x,y:i.y,width:i.width,height:i.height,range:i.range,cost:i.cost||0,state:{...i.state}}));}
  _blocking(i){if(i.type==='door'||i.type==='gate')return i.state.open!==true;if(i.type==='barricade')return i.state.repaired===true;return false;}
  getBlockingObstacles(){const out=[];for(const i of this.items.values())if(this._blocking(i))out.push({type:'interaction',subtype:i.type,interactionId:i.id,x:i.x,y:i.y,width:i.width,height:i.height,solid:true});return out;}
  onRoundState(round){const n=Number(round?.number)||0;if(round?.state!=='running'||n<=0||n===this._lastRound)return false;this._lastRound=n;let changed=false;for(const i of this.items.values())if(i.type==='crate'&&i.state.opened){i.state.opened=false;changed=true;}return changed;}
  interact(player,id){
    const item=this.items.get(String(id||''));if(!item||!player||!player.alive)return{success:false,error:'invalid_interaction'};
    const px=player.x+config.PLAYER_COLLISION_RADIUS,py=player.y+config.PLAYER_COLLISION_RADIUS,cx=item.x+item.width/2,cy=item.y+item.height/2;if(Math.hypot(px-cx,py-cy)>(item.range||90))return{success:false,error:'too_far'};
    let reward=null;
    if(item.type==='door')item.state.open=!item.state.open;
    else if(item.type==='gate'){if(!item.state.unlocked){const cost=item.cost||0;if(player.money<cost)return{success:false,error:'not_enough_money'};player.money-=cost;item.state.unlocked=true;item.state.open=true;}else item.state.open=!item.state.open;}
    else if(item.type==='barricade'){if(item.state.repaired)item.state.repaired=false;else{const cost=item.cost||0;if(player.money<cost)return{success:false,error:'not_enough_money'};player.money-=cost;item.state.repaired=true;}}
    else if(item.type==='generator'){if(item.state.on)return{success:false,error:'already_active'};item.state.on=true;}
    else if(item.type==='crate'){if(item.state.opened)return{success:false,error:'already_used'};item.state.opened=true;reward=this._giveCrateReward(player,item.id);}
    else if(item.type==='medstation'){if(player.health>=player.maxHealth)return{success:false,error:'health_full'};const cost=item.cost||0;if(player.money<cost)return{success:false,error:'not_enough_money'};player.money-=cost;const amount=Math.min(60,player.maxHealth-player.health);player.health+=amount;reward={kind:'health',amount};}
    else if(item.type==='ammo_station'){const state=player.weapons[player.activeWeaponId];if(!state)return{success:false,error:'invalid_weapon'};const cost=item.cost||0;if(player.money<cost)return{success:false,error:'not_enough_money'};player.money-=cost;const amount=45;state.reserve+=amount;reward={kind:'ammo',amount};}
    else return{success:false,error:'invalid_interaction'};
    return{success:true,item:this._public(item),reward};
  }
  _giveCrateReward(player,id){const r=Math.random();if((id.includes('hospital')||id.includes('pharmacy'))&&player.health<player.maxHealth||r>.7&&player.health<player.maxHealth){const amount=Math.min(45,player.maxHealth-player.health);player.health+=amount;return{kind:'health',amount};}if(id.includes('military')||id.includes('omega')||id.includes('police')||r<.5){const state=player.weapons[player.activeWeaponId],amount=id.includes('military')||id.includes('omega')?60:35;if(state)state.reserve+=amount;return{kind:'ammo',amount};}const amount=35+Math.floor(Math.random()*46);player.money+=amount;return{kind:'money',amount};}
  _public(i){return{id:i.id,type:i.type,label:i.label,x:i.x,y:i.y,width:i.width,height:i.height,range:i.range,cost:i.cost||0,state:{...i.state}};}
}
InteractionSystem.MAP_DEFINITIONS=MAP_DEFINITIONS;
module.exports=InteractionSystem;
