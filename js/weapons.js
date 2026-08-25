const CLIENT_WEAPONS = Object.freeze({
  pistol: { id:'pistol', name:'Pistola', fireRateMs:300, maxRange:580, spread:0.018, pellets:1, recoil:2.0, magazineSize:12, reloadMs:1300, rarity:'common' },
  smg: { id:'smg', name:'SMG', fireRateMs:95, maxRange:520, spread:0.06, pellets:1, recoil:1.45, magazineSize:30, reloadMs:1650, rarity:'rare' },
  shotgun: { id:'shotgun', name:'Shotgun', fireRateMs:720, maxRange:410, spread:0.22, pellets:7, recoil:6.8, magazineSize:6, reloadMs:1900, rarity:'epic' },
  rifle: { id:'rifle', name:'Rifle', fireRateMs:240, maxRange:720, spread:0.012, pellets:1, recoil:3.4, magazineSize:20, reloadMs:2000, rarity:'legendary' },
});

const RARITY_LABELS = Object.freeze({ common:'Comum', rare:'Raro', epic:'Épico', legendary:'Lendário' });
const RARITY_COLORS = Object.freeze({ common:'#d4d4d4', rare:'#4aa3ff', epic:'#b868ff', legendary:'#ffbd38' });

function clientWeapon(id) { return CLIENT_WEAPONS[id] || CLIENT_WEAPONS.pistol; }
