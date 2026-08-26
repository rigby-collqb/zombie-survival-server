const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, 'data', 'accounts.json');
const LEGACY_DEFAULT_SIGNING_KEY = 'zso-phase20-recovery-signing-key-change-me';
const SIGNING_KEY = process.env.PROFILE_SIGNING_KEY || LEGACY_DEFAULT_SIGNING_KEY;
const RECOVERY_VERIFY_KEYS = [...new Set([
  SIGNING_KEY,
  process.env.PROFILE_SIGNING_KEY_PREVIOUS || '',
  LEGACY_DEFAULT_SIGNING_KEY,
].filter(Boolean))];

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
function signPayload(obj, key=SIGNING_KEY) {
  const json = JSON.stringify(obj);
  return crypto.createHmac('sha256', key).update(json).digest('hex');
}
function recoverySignatureValid(payload, signature) {
  return RECOVERY_VERIFY_KEYS.some(key => safeEqualHex(signature, signPayload(payload, key)));
}

function safeEqualHex(a, b) {
  try {
    const ba = Buffer.from(String(a || ''), 'hex');
    const bb = Buffer.from(String(b || ''), 'hex');
    return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb);
  } catch (_) { return false; }
}
function uniqueIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).filter(Boolean))].slice(0, 250);
}
function friendCodeFor(id) {
  return crypto.createHash('sha256').update(`zso-friend:${String(id || '')}`).digest('hex').slice(0, 8).toUpperCase();
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
      friends: uniqueIds(raw.friends),
      friendRequests: uniqueIds(raw.friendRequests),
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Date.now(),
    };
    a.friends = a.friends.filter(id => id !== a.id);
    a.friendRequests = a.friendRequests.filter(id => id !== a.id && !a.friends.includes(id));
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
      fs.writeFileSync(tmp, JSON.stringify({ version:2, accounts:[...this.accounts.values()] }, null, 2));
      fs.renameSync(tmp, DATA_FILE);
    } catch (err) { console.warn('[accounts] falha ao salvar:', err.message); }
  }

  _public(a) {
    this._applyUnlocks(a);
    const currentLevelStart = Math.pow(Math.max(0, a.level - 1), 2) * 250;
    const nextLevelXp = Math.pow(a.level, 2) * 250;
    return {
      id:a.id, friendCode:friendCodeFor(a.id), name:a.name, xp:a.xp, level:a.level, coins:a.coins,
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
      id:a.id, name:a.name, xp:a.xp, coins:a.coins, stats:{...a.stats},
      unlockedSkins:[...a.unlockedSkins], unlockedWeaponSkins:[...a.unlockedWeaponSkins],
      selectedSkin:a.selectedSkin, selectedWeaponSkin:a.selectedWeaponSkin,
      friends:[...a.friends], friendRequests:[...a.friendRequests],
      updatedAt:a.updatedAt,
    };
    return { payload, signature:signPayload(payload) };
  }

  _restoreFromRecovery(token, recovery) {
    const payload = recovery?.payload;
    if (!payload || !recoverySignatureValid(payload, recovery?.signature)) return null;
    const name = cleanName(payload.name);
    if (!payload.id || !name) return null;
    const raw = {
      ...payload,
      tokenHash: tokenHash(token),
      name,
      xp:clampInt(payload.xp,0,100000000),
      coins:clampInt(payload.coins,0,100000000),
      stats:payload.stats,
      friends:payload.friends,
      friendRequests:payload.friendRequests,
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
        selectedSkin:'survivor_blue', selectedWeaponSkin:'default', friends:[], friendRequests:[], createdAt:Date.now(),
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

  findByFriendCode(code) {
    const wanted = String(code || '').trim().toUpperCase();
    if (!wanted) return null;
    for (const a of this.accounts.values()) if (friendCodeFor(a.id) === wanted) return a;
    return null;
  }

  areFriends(aId, bId) {
    const a=this.get(aId), b=this.get(bId);
    return !!(a && b && a.friends.includes(b.id) && b.friends.includes(a.id));
  }

  requestFriend(fromId, code) {
    const from=this.get(fromId); if(!from)return{success:false,error:'account_not_found'};
    const to=this.findByFriendCode(code); if(!to)return{success:false,error:'friend_not_found'};
    if(to.id===from.id)return{success:false,error:'cannot_add_self'};
    if(from.friends.includes(to.id))return{success:false,error:'already_friends'};
    if(to.friendRequests.includes(from.id))return{success:false,error:'request_already_sent'};
    // Se o outro já tinha mandado pedido, aceita automaticamente.
    if(from.friendRequests.includes(to.id)) return this.respondFriend(from.id, to.id, true);
    to.friendRequests.push(from.id);
    to.updatedAt=from.updatedAt=Date.now(); this._scheduleSave();
    return{success:true,target:this._socialPublic(to)};
  }

  respondFriend(accountId, requesterId, accept=true) {
    const a=this.get(accountId), from=this.get(requesterId);
    if(!a||!from)return{success:false,error:'account_not_found'};
    const idx=a.friendRequests.indexOf(from.id);
    if(idx<0)return{success:false,error:'request_not_found'};
    a.friendRequests.splice(idx,1);
    if(accept){
      if(!a.friends.includes(from.id))a.friends.push(from.id);
      if(!from.friends.includes(a.id))from.friends.push(a.id);
      from.friendRequests=from.friendRequests.filter(id=>id!==a.id);
    }
    a.updatedAt=from.updatedAt=Date.now(); this._scheduleSave();
    return{success:true,accepted:!!accept,friend:accept?this._socialPublic(from):null};
  }

  removeFriend(accountId, friendId) {
    const a=this.get(accountId), b=this.get(friendId);
    if(!a||!b)return{success:false,error:'account_not_found'};
    a.friends=a.friends.filter(id=>id!==b.id); b.friends=b.friends.filter(id=>id!==a.id);
    a.friendRequests=a.friendRequests.filter(id=>id!==b.id); b.friendRequests=b.friendRequests.filter(id=>id!==a.id);
    a.updatedAt=b.updatedAt=Date.now();this._scheduleSave();
    return{success:true};
  }

  _socialPublic(a) {
    if(!a)return null;this._applyUnlocks(a);
    return{id:a.id,friendCode:friendCodeFor(a.id),name:a.name,level:a.level,xp:a.xp,skinId:a.selectedSkin,stats:{...a.stats}};
  }

  socialSnapshot(accountId, presenceFn=()=>({status:'offline'})) {
    const a=this.get(accountId);if(!a)return null;
    const friends=a.friends.map(id=>this.get(id)).filter(Boolean).map(f=>({...this._socialPublic(f),...presenceFn(f.id)}));
    const requests=a.friendRequests.map(id=>this.get(id)).filter(Boolean).map(f=>this._socialPublic(f));
    const outgoing=[];
    for(const other of this.accounts.values())if(other.friendRequests.includes(a.id))outgoing.push(this._socialPublic(other));
    const order={playing:0,lobby:1,online:2,offline:3};
    friends.sort((x,y)=>(order[x.status]??9)-(order[y.status]??9)||x.name.localeCompare(y.name));
    return{friendCode:friendCodeFor(a.id),friends,requests,outgoing};
  }

  leaderboard(limit=20) {
    const rows=[...this.accounts.values()].map(a=>this._socialPublic(a));
    rows.sort((a,b)=>b.level-a.level||b.xp-a.xp||b.stats.highestRound-a.stats.highestRound||b.stats.kills-a.stats.kills||a.name.localeCompare(b.name));
    return rows.slice(0,Math.max(3,Math.min(50,Number(limit)||20))).map((r,i)=>({...r,rank:i+1}));
  }

  touch(id) { const a=this.get(id); if(a){a.updatedAt=Date.now();this._scheduleSave();} }
}

AccountStore.CHARACTER_SKINS = CHARACTER_SKINS;
AccountStore.WEAPON_SKINS = WEAPON_SKINS;
AccountStore.friendCodeFor = friendCodeFor;
module.exports = AccountStore;
