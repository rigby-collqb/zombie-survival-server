const WEAPONS = Object.freeze({
  pistol: Object.freeze({id:'pistol',name:'Pistola',damage:26,fireRateMs:300,magazineSize:12,startingReserve:72,reloadMs:1300,range:580,spread:.018,pellets:1,headshotMultiplier:2,recoil:2,shopPrice:0,rarity:'common'}),
  smg: Object.freeze({id:'smg',name:'SMG',damage:16,fireRateMs:95,magazineSize:30,startingReserve:120,reloadMs:1650,range:520,spread:.06,pellets:1,headshotMultiplier:1.75,recoil:1.45,shopPrice:500,rarity:'rare'}),
  shotgun: Object.freeze({id:'shotgun',name:'Shotgun',damage:14,fireRateMs:720,magazineSize:6,startingReserve:30,reloadMs:1900,range:410,spread:.22,pellets:7,headshotMultiplier:1.55,recoil:6.8,shopPrice:750,rarity:'epic'}),
  rifle: Object.freeze({id:'rifle',name:'Rifle',damage:38,fireRateMs:240,magazineSize:20,startingReserve:80,reloadMs:2000,range:720,spread:.012,pellets:1,headshotMultiplier:2.15,recoil:3.4,shopPrice:1000,rarity:'legendary'}),

  revolver: Object.freeze({id:'revolver',name:'Magnum .44',damage:74,fireRateMs:520,magazineSize:6,startingReserve:42,reloadMs:1850,range:690,spread:.016,pellets:1,headshotMultiplier:2.35,recoil:5.2,shopPrice:0,rarity:'epic',special:true}),
  sniper: Object.freeze({id:'sniper',name:'Sniper Viper',damage:118,fireRateMs:980,magazineSize:5,startingReserve:30,reloadMs:2350,range:1150,spread:.003,pellets:1,headshotMultiplier:2.7,recoil:7.8,shopPrice:0,rarity:'legendary',special:true}),
  lmg: Object.freeze({id:'lmg',name:'LMG Titan',damage:24,fireRateMs:110,magazineSize:72,startingReserve:216,reloadMs:3100,range:650,spread:.055,pellets:1,headshotMultiplier:1.7,recoil:2.2,shopPrice:0,rarity:'legendary',special:true}),
  crossbow: Object.freeze({id:'crossbow',name:'Besta Silenciosa',damage:96,fireRateMs:860,magazineSize:1,startingReserve:28,reloadMs:760,range:820,spread:.004,pellets:1,headshotMultiplier:2.3,recoil:2.5,shopPrice:0,rarity:'epic',special:true}),
  flamethrower: Object.freeze({id:'flamethrower',name:'Lança-Chamas',damage:11,fireRateMs:85,magazineSize:80,startingReserve:240,reloadMs:2700,range:245,spread:.11,pellets:2,headshotMultiplier:1,recoil:.45,shopPrice:0,rarity:'legendary',special:true,effect:'flame'}),
  arcgun: Object.freeze({id:'arcgun',name:'ARC-9 Experimental',damage:48,fireRateMs:330,magazineSize:18,startingReserve:72,reloadMs:2100,range:610,spread:.009,pellets:1,headshotMultiplier:2.1,recoil:3.1,shopPrice:0,rarity:'legendary',special:true,effect:'arc'}),
  axe: Object.freeze({id:'axe',name:'Machado de Resgate',damage:84,fireRateMs:620,magazineSize:1,startingReserve:0,reloadMs:0,range:88,spread:.11,pellets:1,headshotMultiplier:1.45,recoil:4.2,shopPrice:0,rarity:'rare',special:true,usesAmmo:false,melee:true}),
});

const MYSTERY_WEAPONS = Object.freeze(['smg','shotgun','rifle','revolver','sniper','lmg','crossbow','flamethrower','arcgun','axe']);

const SHOP = Object.freeze({
  weapons:Object.freeze({smg:500,shotgun:750,rifle:1000}),
  ammo:150,health:200,
  upgrades:Object.freeze({damage:[0,450,800,1250],reload:[0,400,750,1150],movement:[0,400,750,1150]})
});

function getWeapon(id){return WEAPONS[id]||WEAPONS.pistol;}
function createWeaponState(id){const w=getWeapon(id);return{id:w.id,ammo:w.usesAmmo===false?1:w.magazineSize,reserve:w.usesAmmo===false?0:w.startingReserve};}
function getUpgradedWeapon(id,level=0,perks={}){
  const base=getWeapon(id),lv=Math.max(0,Math.min(2,Number(level)||0));
  const damageScale=[1,1.35,1.78][lv],magScale=[1,1.18,1.36][lv],rangeScale=[1,1.07,1.14][lv],rateScale=[1,.94,.88][lv];
  return{...base,upgradeLevel:lv,displayName:lv===1?`${base.name} MK-II`:lv===2?`${base.name} MK-III`:base.name,
    damage:Math.round(base.damage*damageScale),magazineSize:Math.max(1,Math.round(base.magazineSize*magScale)),range:Math.round(base.range*rangeScale),fireRateMs:Math.max(55,Math.round(base.fireRateMs*rateScale)),headshotMultiplier:base.headshotMultiplier*(perks.deadeye?1.22:1)};
}
function rollMysteryWeapon(){
  const r=Math.random();
  if(r<.035)return'arcgun';if(r<.09)return'flamethrower';if(r<.17)return'sniper';if(r<.27)return'lmg';if(r<.40)return'crossbow';if(r<.52)return'revolver';if(r<.62)return'axe';if(r<.76)return'rifle';if(r<.89)return'shotgun';return'smg';
}
module.exports={WEAPONS,MYSTERY_WEAPONS,SHOP,getWeapon,getUpgradedWeapon,createWeaponState,rollMysteryWeapon};
