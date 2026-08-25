const WEAPONS = Object.freeze({
  pistol: Object.freeze({
    id: 'pistol', name: 'Pistola', damage: 26, fireRateMs: 300,
    magazineSize: 12, startingReserve: 72, reloadMs: 1300,
    range: 580, spread: 0.018, pellets: 1, headshotMultiplier: 2.0,
    recoil: 2.0, shopPrice: 0, rarity: 'common'
  }),
  smg: Object.freeze({
    id: 'smg', name: 'SMG', damage: 16, fireRateMs: 95,
    magazineSize: 30, startingReserve: 120, reloadMs: 1650,
    range: 520, spread: 0.06, pellets: 1, headshotMultiplier: 1.75,
    recoil: 1.45, shopPrice: 500, rarity: 'rare'
  }),
  shotgun: Object.freeze({
    id: 'shotgun', name: 'Shotgun', damage: 14, fireRateMs: 720,
    magazineSize: 6, startingReserve: 30, reloadMs: 1900,
    range: 410, spread: 0.22, pellets: 7, headshotMultiplier: 1.55,
    recoil: 6.8, shopPrice: 750, rarity: 'epic'
  }),
  rifle: Object.freeze({
    id: 'rifle', name: 'Rifle', damage: 38, fireRateMs: 240,
    magazineSize: 20, startingReserve: 80, reloadMs: 2000,
    range: 720, spread: 0.012, pellets: 1, headshotMultiplier: 2.15,
    recoil: 3.4, shopPrice: 1000, rarity: 'legendary'
  })
});

const SHOP = Object.freeze({
  weapons: Object.freeze({ smg: 500, shotgun: 750, rifle: 1000 }),
  ammo: 150,
  health: 200,
  upgrades: Object.freeze({ damage: [0, 450, 800, 1250], reload: [0, 400, 750, 1150], movement: [0, 400, 750, 1150] })
});

function getWeapon(id) {
  return WEAPONS[id] || WEAPONS.pistol;
}

function createWeaponState(id) {
  const w = getWeapon(id);
  return { id: w.id, ammo: w.magazineSize, reserve: w.startingReserve };
}

module.exports = { WEAPONS, SHOP, getWeapon, createWeaponState };
