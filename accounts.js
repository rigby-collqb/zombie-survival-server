const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, 'data', 'accounts.json');
const SIGNING_KEY = process.env.PROFILE_SIGNING_KEY || 'zso-phase20-recovery-signing-key-change-me';

const CHARACTER_SKINS = Object.freeze({
  survivor_blue: { id:'survivor_blue', name:'Sobrevivente Azul', level:1, body:'#3fa9ff' },
  survivor_red:  { id:'survivor_red',  name:'Sobrevivente Vermelho', level:3, body:'#dc5555' },
  hazmat:        { id:'hazmat',        name:'Hazmat', level:5, body:'#e4d44d' },
  military:      { id:'military',      name:'Militar', level:8, body:'#6f8d5a' },
  shadow:        { id:'shadow',        name:'Shadow', level:12, body:'#7d62a8' },
});

const WEAPON_SKINS = Object.freeze({
  default: { id:'default', name:'Padrão', level:1, color:null },
  rusty:   { id:'rusty', name:'Ferrugem', level:4, color:'#8c5f42' },
  gold:    { id:'gold', name:'Dourada', level:7, color:'#d9b53f' },
  neon:    { id:'neon', name:'Neon', level:10, color:'#51e6cf' },
});

function clampInt(v, min, max) {
  const n = Math.floor(Number(v) || 0);
  return Math.max(min, Math.min(max, n));
}
function tokenHash(token) { return crypto.createHash('sha256').update(String(token || '')).digest('hex'); }
function cleanName(name) {
  return String(name || '').replace(/[<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, 16);
}
function levelFromXp(xp) {
  xp = Math.max(0, Number(xp) || 0);
  return Math.max(1, Math.floor(Math.sqrt(xp / 250)) + 1);
}
function signPayload(obj) {
  const json = JSON.stringify(obj);
  return crypto.createHmac('sha256', SIGNING_KEY).update(json).digest('hex');
}
function safeEqualHex(a, b) {
  try {
    const ba = Buffer.from(String(a || ''), 'hex');
    const bb = Buffer.from(String(b || ''), 'hex');
    return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb);
  } catch (_) { return false; }
}

class AccountStore {
  constructor() {
    this.accounts = new Map();
    this._saveTimer = null;
    this._load();
  }

  _load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      for (const raw of Array.isArray(parsed?.accounts) ? parsed.accounts : []) {
        if (!raw?.id || !raw?.tokenHash) continue;
        const a = this._normalize(raw);
        this.accounts.set(a.id, a);
      }
      console.log(`[accounts] ${this.accounts.size} conta(s) carregada(s)`);
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('[accounts] não foi possível carregar:', err.message);
    }
  }

  _normalize(raw) {
    const xp = clampInt(raw.xp, 0, 100000000);
    const level = levelFromXp(xp);
    const stats = raw.stats || {};
    const a = {
      id: String(raw.id || crypto.randomUUID()),
      tokenHash: String(raw.tokenHash || ''),
      name: cleanName(raw.name) || 'Sobrevivente',
      xp,
      level,
      coins: clampInt(raw.coins, 0, 100000000),
      stats: {
        kills: clampInt(stats.kills, 0, 100000000),
        headshots: clampInt(stats.headshots, 0, 100000000),
        revives: clampInt(stats.revives, 0, 100000000),
        highestRound: clampInt(stats.highestRound, 0, 100000),
        matches: clampInt(stats.matches, 0, 10000000),
      },
      unlockedSkins: Array.isArray(raw.unlockedSkins) ? raw.unlockedSkins.filter(id => CHARACTER_SKINS[id]) : ['survivor_blue'],
      unlockedWeaponSkins: Array.isArray(raw.unlockedWeaponSkins) ? raw.unlockedWeaponSkins.filter(id => WEAPON_SKINS[id]) : ['default'],
      selectedSkin: CHARACTER_SKINS[raw.selectedSkin] ? raw.selectedSkin : 'survivor_blue',
      selectedWeaponSkin: WEAPON_SKINS[raw.selectedWeaponSkin] ? raw.selectedWeaponSkin : 'default',
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Date.now(),
    };
    if (!a.unlockedSkins.includes('survivor_blue')) a.unlockedSkins.unshift('survivor_blue');
    if (!a.unlockedWeaponSkins.includes('default')) a.unlockedWeaponSkins.unshift('default');
    this._applyUnlocks(a);
    return a;
  }

  _applyUnlocks(a) {
    a.level = levelFromXp(a.xp);
    for (const s of Object.values(CHARACTER_SKINS)) if (a.level >= s.level && !a.unlockedSkins.includes(s.id)) a.unlockedSkins.push(s.id);
    for (const s of Object.values(WEAPON_SKINS)) if (a.level >= s.level && !a.unlockedWeaponSkins.includes(s.id)) a.unlockedWeaponSkins.push(s.id);
    if (!a.unlockedSkins.includes(a.selectedSkin)) a.selectedSkin = 'survivor_blue';
    if (!a.unlockedWeaponSkins.includes(a.selectedWeaponSkin)) a.selectedWeaponSkin = 'default';
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => { this._saveTimer = null; this._save(); }, 700);
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive:true });
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ version:1, accounts:[...this.accounts.values()] }, null, 2));
      fs.renameSync(tmp, DATA_FILE);
    } catch (err) { console.warn('[accounts] falha ao salvar:', err.message); }
  }

  _public(a) {
    this._applyUnlocks(a);
    const currentLevelStart = Math.pow(Math.max(0, a.level - 1), 2) * 250;
    const nextLevelXp = Math.pow(a.level, 2) * 250;
    return {
      id:a.id, name:a.name, xp:a.xp, level:a.level, coins:a.coins,
      xpIntoLevel:Math.max(0, a.xp - currentLevelStart),
      xpForNextLevel:Math.max(1, nextLevelXp - currentLevelStart),
      stats:{...a.stats},
      unlockedSkins:[...a.unlockedSkins],
      unlockedWeaponSkins:[...a.unlockedWeaponSkins],
      selectedSkin:a.selectedSkin,
      selectedWeaponSkin:a.selectedWeaponSkin,
      skins:Object.values(CHARACTER_SKINS).map(s=>({...s,unlocked:a.unlockedSkins.includes(s.id)})),
      weaponSkins:Object.values(WEAPON_SKINS).map(s=>({...s,unlocked:a.unlockedWeaponSkins.includes(s.id)})),
    };
  }

  _recovery(a) {
    const payload = {
      id:a.id, name:a.name, xp:a.xp, coins:a.coins, stats:a.stats,
      unlockedSkins:a.unlockedSkins, unlockedWeaponSkins:a.unlockedWeaponSkins,
      selectedSkin:a.selectedSkin, selectedWeaponSkin:a.selectedWeaponSkin,
      updatedAt:a.updatedAt,
    };
    return { payload, signature:signPayload(payload) };
  }

  _restoreFromRecovery(token, recovery) {
    const payload = recovery?.payload;
    if (!payload || !safeEqualHex(recovery?.signature, signPayload(payload))) return null;
    const name = cleanName(payload.name);
    if (!payload.id || !name) return null;
    const raw = {
      ...payload,
      tokenHash: tokenHash(token),
      name,
      xp:clampInt(payload.xp,0,100000000),
      coins:clampInt(payload.coins,0,100000000),
      stats:payload.stats,
    };
    const a = this._normalize(raw);
    this.accounts.set(a.id, a);
    this._scheduleSave();
    return a;
  }

  bootstrap({ token, name, recovery } = {}) {
    token = String(token || '').trim();
    let a = null;
    if (token) {
      const hash = tokenHash(token);
      for (const candidate of this.accounts.values()) {
        if (candidate.tokenHash === hash) { a = candidate; break; }
      }
      if (!a && recovery) a = this._restoreFromRecovery(token, recovery);
    }

    let created = false;
    if (!a) {
      const cleaned = cleanName(name);
      if (!cleaned) return { success:false, error:'name_required' };
      token = crypto.randomBytes(32).toString('hex');
      a = this._normalize({
        id:crypto.randomUUID(), tokenHash:tokenHash(token), name:cleaned,
        xp:0, coins:0, stats:{}, unlockedSkins:['survivor_blue'], unlockedWeaponSkins:['default'],
        selectedSkin:'survivor_blue', selectedWeaponSkin:'default', createdAt:Date.now(),
      });
      this.accounts.set(a.id, a);
      created = true;
      this._scheduleSave();
    }

    a.updatedAt = Date.now();
    return { success:true, created, token, account:this._public(a), recovery:this._recovery(a) };
  }

  get(id) { return this.accounts.get(String(id || '')) || null; }
  public(id) { const a=this.get(id); return a ? this._public(a) : null; }

  record(id, delta={}) {
    const a = this.get(id); if (!a) return null;
    a.xp = clampInt(a.xp + (Number(delta.xp)||0), 0, 100000000);
    a.coins = clampInt(a.coins + (Number(delta.coins)||0), 0, 100000000);
    if (delta.kills) a.stats.kills = clampInt(a.stats.kills + Number(delta.kills), 0, 100000000);
    if (delta.headshots) a.stats.headshots = clampInt(a.stats.headshots + Number(delta.headshots), 0, 100000000);
    if (delta.revives) a.stats.revives = clampInt(a.stats.revives + Number(delta.revives), 0, 100000000);
    if (delta.matches) a.stats.matches = clampInt(a.stats.matches + Number(delta.matches), 0, 10000000);
    if (delta.round) a.stats.highestRound = Math.max(a.stats.highestRound, clampInt(delta.round,0,100000));
    a.updatedAt = Date.now();
    this._applyUnlocks(a); this._scheduleSave();
    return { account:this._public(a), recovery:this._recovery(a) };
  }

  select(id, { skinId, weaponSkinId } = {}) {
    const a = this.get(id); if (!a) return {success:false,error:'account_not_found'};
    this._applyUnlocks(a);
    if (skinId) {
      if (!CHARACTER_SKINS[skinId] || !a.unlockedSkins.includes(skinId)) return {success:false,error:'skin_locked'};
      a.selectedSkin = skinId;
    }
    if (weaponSkinId) {
      if (!WEAPON_SKINS[weaponSkinId] || !a.unlockedWeaponSkins.includes(weaponSkinId)) return {success:false,error:'skin_locked'};
      a.selectedWeaponSkin = weaponSkinId;
    }
    a.updatedAt = Date.now(); this._scheduleSave();
    return {success:true, account:this._public(a), recovery:this._recovery(a)};
  }

  touch(id) { const a=this.get(id); if(a){a.updatedAt=Date.now();this._scheduleSave();} }
}

AccountStore.CHARACTER_SKINS = CHARACTER_SKINS;
AccountStore.WEAPON_SKINS = WEAPON_SKINS;
module.exports = AccountStore;
