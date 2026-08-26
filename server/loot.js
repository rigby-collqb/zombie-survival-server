const config = require('./config');
const { WEAPONS, getWeapon, createWeaponState } = require('./weapons');

let nextLootId = 1;
const RARITIES = {
  common: { label: 'Comum', weight: 70 },
  rare: { label: 'Raro', weight: 21 },
  epic: { label: 'Épico', weight: 7 },
  legendary: { label: 'Lendário', weight: 2 },
};

class LootSystem {
  constructor() {
    this.items = new Map();
  }

  _rarity() {
    const roll = Math.random() * 100;
    if (roll < 2) return 'legendary';
    if (roll < 9) return 'epic';
    if (roll < 30) return 'rare';
    return 'common';
  }

  _weaponForRarity(rarity) {
    if (rarity === 'legendary') return 'rifle';
    if (rarity === 'epic') return Math.random() < 0.55 ? 'shotgun' : 'rifle';
    if (rarity === 'rare') return Math.random() < 0.7 ? 'smg' : 'shotgun';
    return 'smg';
  }

  maybeDrop(zombie) {
    if (!zombie || this.items.size >= config.MAX_LOOT_ITEMS) return null;
    const chance = zombie.type === 'boss' ? 1 : (zombie.type === 'tank' ? 0.55 : 0.32);
    if (Math.random() > chance) return null;

    const rarity = this._rarity();
    const roll = Math.random();
    let kind = 'money';
    if (roll < 0.34) kind = 'ammo';
    else if (roll < 0.60) kind = 'money';
    else if (roll < 0.82) kind = 'medkit';
    else kind = 'weapon';

    let amount = 0;
    let weaponId = null;
    if (kind === 'money') amount = { common: 25, rare: 45, epic: 80, legendary: 150 }[rarity];
    if (kind === 'ammo') amount = { common: 18, rare: 30, epic: 45, legendary: 65 }[rarity];
    if (kind === 'medkit') amount = { common: 25, rare: 40, epic: 60, legendary: 100 }[rarity];
    if (kind === 'weapon') weaponId = this._weaponForRarity(rarity);

    const item = {
      id: nextLootId++, kind, rarity, amount, weaponId,
      x: zombie.x + (Math.random() - 0.5) * 16,
      y: zombie.y + (Math.random() - 0.5) * 16,
      createdAt: Date.now(),
    };
    this.items.set(item.id, item);
    return item;
  }

  tick() {
    const now = Date.now();
    for (const [id, item] of this.items) {
      if (now - item.createdAt > config.LOOT_LIFETIME_MS) this.items.delete(id);
    }
  }

  getSnapshot() {
    return [...this.items.values()].map(({ createdAt, ...item }) => item);
  }

  pickup(player, lootId) {
    const item = this.items.get(Number(lootId));
    if (!item || !player || !player.alive) return { success: false, error: 'invalid_loot' };
    const px = player.x + config.PLAYER_COLLISION_RADIUS;
    const py = player.y + config.PLAYER_COLLISION_RADIUS;
    if (Math.hypot(item.x - px, item.y - py) > config.PICKUP_DISTANCE) {
      return { success: false, error: 'too_far' };
    }

    if (item.kind === 'money') {
      player.money += item.amount;
    } else if (item.kind === 'medkit') {
      if (player.health >= player.maxHealth) return { success: false, error: 'health_full' };
      player.health = Math.min(player.maxHealth, player.health + item.amount);
    } else if (item.kind === 'ammo') {
      const state = player.weapons[player.activeWeaponId];
      if (!state) return { success: false, error: 'no_weapon' };
      state.reserve += item.amount;
    } else if (item.kind === 'weapon') {
      this._giveWeapon(player, item.weaponId);
    }

    this.items.delete(item.id);
    return { success: true, item };
  }

  _giveWeapon(player, weaponId) {
    if (!WEAPONS[weaponId]) return;
    if (!player.weapons[weaponId]) player.weapons[weaponId] = createWeaponState(weaponId);

    const existingSlot = player.slots.indexOf(weaponId);
    if (existingSlot >= 0) {
      player.activeSlot = existingSlot;
    } else if (player.slots.length < config.MAX_WEAPON_SLOTS) {
      player.slots.push(weaponId);
      player.activeSlot = player.slots.length - 1;
    } else {
      const oldId = player.slots[player.activeSlot];
      if (oldId !== 'pistol') delete player.weapons[oldId];
      player.slots[player.activeSlot] = weaponId;
    }
    player.activeWeaponId = player.slots[player.activeSlot];
    player.reloadEndAt = 0;
  }
}

module.exports = { LootSystem, RARITIES };
