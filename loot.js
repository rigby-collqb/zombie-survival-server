const config = require('./config');
const { WEAPONS, createWeaponState } = require('./weapons');

let nextLootId = 1;
const RARITIES = {
  common:{label:'Comum',weight:70},rare:{label:'Raro',weight:21},epic:{label:'Épico',weight:7},legendary:{label:'Lendário',weight:2},
};

class LootSystem {
  constructor(){this.items=new Map();this.dropMultiplier=1;}
  setDropMultiplier(v=1){this.dropMultiplier=Math.max(.3,Math.min(2,Number(v)||1));}
  _rarity(){const roll=Math.random()*100;if(roll<2)return'legendary';if(roll<9)return'epic';if(roll<30)return'rare';return'common';}
  _weaponForRarity(r){if(r==='legendary')return Math.random()<.35?'revolver':'rifle';if(r==='epic')return Math.random()<.35?'crossbow':Math.random()<.6?'shotgun':'rifle';if(r==='rare')return Math.random()<.72?'smg':'shotgun';return'smg';}
  maybeDrop(zombie){
    if(!zombie||this.items.size>=config.MAX_LOOT_ITEMS)return null;
    const base=zombie.type==='boss'?1:(zombie.elite?0.68:zombie.type==='tank'?0.55:0.32);if(Math.random()>Math.min(1,base*this.dropMultiplier))return null;
    let rarity=this._rarity();if(zombie.elite&&rarity==='common'&&Math.random()<.62)rarity='rare';if(zombie.type==='boss'&&rarity==='common')rarity='epic';const roll=Math.random();let kind='money';
    if(roll<.27)kind='ammo';else if(roll<.50)kind='money';else if(roll<.69)kind='medkit';else if(roll<.79)kind='grenade';else kind='weapon';
    let amount=0,weaponId=null;
    if(kind==='money')amount={common:25,rare:45,epic:80,legendary:150}[rarity];
    if(kind==='ammo')amount={common:18,rare:30,epic:45,legendary:65}[rarity];
    if(kind==='medkit')amount=1;
    if(kind==='grenade')amount=1;
    if(kind==='weapon')weaponId=this._weaponForRarity(rarity);
    const item={id:nextLootId++,kind,rarity,amount,weaponId,x:zombie.x+(Math.random()-.5)*16,y:zombie.y+(Math.random()-.5)*16,createdAt:Date.now()};
    this.items.set(item.id,item);return item;
  }
  spawnSupplyDrop(x,y){
    const items=[];
    const defs=[
      {kind:'money',rarity:'epic',amount:180},{kind:'ammo',rarity:'epic',amount:70},{kind:'medkit',rarity:'rare',amount:1},{kind:'grenade',rarity:'rare',amount:1},
    ];
    for(let i=0;i<defs.length;i++){
      if(this.items.size>=config.MAX_LOOT_ITEMS)break;const a=i/defs.length*Math.PI*2,def=defs[i];const item={id:nextLootId++,...def,weaponId:null,x:x+Math.cos(a)*36,y:y+Math.sin(a)*36,createdAt:Date.now()};this.items.set(item.id,item);items.push(item);
    }
    return items;
  }
  shiftTime(ms){for(const item of this.items.values())item.createdAt+=ms;}
  tick(){const now=Date.now();for(const[id,item]of this.items)if(now-item.createdAt>config.LOOT_LIFETIME_MS)this.items.delete(id);}
  getSnapshot(){return[...this.items.values()].map(({createdAt,...item})=>item);}
  pickup(player,lootId){
    const item=this.items.get(Number(lootId));if(!item||!player||!player.alive)return{success:false,error:'invalid_loot'};
    const px=player.x+config.PLAYER_COLLISION_RADIUS,py=player.y+config.PLAYER_COLLISION_RADIUS;if(Math.hypot(item.x-px,item.y-py)>config.PICKUP_DISTANCE)return{success:false,error:'too_far'};
    player.items=player.items||{medkit:0,grenade:0};
    if(item.kind==='money')player.money+=item.amount;
    else if(item.kind==='medkit'){if(player.items.medkit>=config.MAX_MEDKITS)return{success:false,error:'inventory_full'};player.items.medkit++;}
    else if(item.kind==='grenade'){if(player.items.grenade>=config.MAX_GRENADES)return{success:false,error:'inventory_full'};player.items.grenade++;}
    else if(item.kind==='ammo'){const state=player.weapons[player.activeWeaponId];if(!state)return{success:false,error:'no_weapon'};state.reserve+=item.amount;}
    else if(item.kind==='weapon')this._giveWeapon(player,item.weaponId);
    this.items.delete(item.id);return{success:true,item};
  }
  _giveWeapon(player,weaponId){
    if(!WEAPONS[weaponId])return;player.weaponLevels=player.weaponLevels||{};
    if(!player.weapons[weaponId])player.weapons[weaponId]=createWeaponState(weaponId);if(player.weaponLevels[weaponId]==null)player.weaponLevels[weaponId]=0;
    const existing=player.slots.indexOf(weaponId);if(existing>=0)player.activeSlot=existing;else if(player.slots.length<config.MAX_WEAPON_SLOTS){player.slots.push(weaponId);player.activeSlot=player.slots.length-1;}else{const old=player.slots[player.activeSlot];if(old!=='pistol'){delete player.weapons[old];delete player.weaponLevels[old];}player.slots[player.activeSlot]=weaponId;}player.activeWeaponId=player.slots[player.activeSlot];player.reloadEndAt=0;
  }
}
module.exports={LootSystem,RARITIES};
