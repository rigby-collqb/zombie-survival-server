class CombatManager {
  constructor(network, zombieManager, vfx, audio=null) {
    this.network = network;
    this.zombieManager = zombieManager;
    this.vfx = vfx;
    this.audio = audio;
    this._lastShotAt = 0;
  }

  get weaponId() { return this.network.loadout?.activeWeaponId || 'pistol'; }
  get weapon() { return clientWeapon(this.weaponId); }

  canShoot() {
    const l = this.network.loadout || {};
    if (l.reloading || Number(l.ammo) <= 0) return false;
    return performance.now() - this._lastShotAt >= this.weapon.fireRateMs;
  }

  _spreadDirection(dx, dy, spread) {
    const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * spread;
    return { x: Math.cos(a), y: Math.sin(a) };
  }

  tryShoot(originX, originY, dirX, dirY, obstacles, onResult) {
    if (!this.canShoot()) return false;
    this._lastShotAt = performance.now();
    const weapon = this.weapon;

    // Feedback local instantâneo. O servidor continua decidindo hits/dano.
    for (let i = 0; i < weapon.pellets; i++) {
      const d = this._spreadDirection(dirX, dirY, weapon.spread);
      const wallDistance = this._raycastObstacles(originX, originY, d.x, d.y, weapon.maxRange, obstacles);
      const zombieHit = this.zombieManager.findZombieAlongRay(originX, originY, d.x, d.y, weapon.maxRange);
      let length = wallDistance ?? weapon.maxRange;
      let wallBlocked = wallDistance !== null;
      if (zombieHit && (wallDistance === null || zombieHit.distance < wallDistance)) {
        length = zombieHit.distance;
        wallBlocked = false;
      }
      this.vfx.addShot({
        x: originX, y: originY, dirX: d.x, dirY: d.y,
        endX: originX + d.x * length, endY: originY + d.y * length,
        wallBlocked, weaponId: weapon.id,
      });
    }

    this.vfx.addShake(weapon.recoil);
    this.audio?.playWeapon(weapon.id, originX, originY, {x:originX,y:originY}, false);

    this.network.shoot().then((data) => {
      if (!data?.success) {
        if (data?.error === 'no_ammo') onResult?.({ type: 'empty' });
        return;
      }

      let strongestHeadshot = false;
      const hitIds = new Set();
      for (const ray of data.shot?.rays || []) {
        if (!ray.hit || ray.zombieId == null) continue;
        hitIds.add(Number(ray.zombieId));
        strongestHeadshot ||= ray.headshot === true;
        const zombie = this.zombieManager.zombies.get(Number(ray.zombieId));
        if (zombie) {
          zombie.triggerHitFlash();
          const bx = Number.isFinite(Number(ray.endX)) ? Number(ray.endX) : zombie._visualX;
          const by = Number.isFinite(Number(ray.endY)) ? Number(ray.endY) : zombie._visualY;
          this.vfx.addBlood(bx, by, ray.zombieDead ? 28 : 13, ray.headshot === true);
        }
      }

      if (hitIds.size) { this.vfx.addHitMarker(strongestHeadshot); this.audio?.playHit(strongestHeadshot); }
      if (data.zombieDead) { this.vfx.addShake(weapon.id === 'shotgun' ? 7 : 4); this.audio?.playKill(strongestHeadshot); }
      onResult?.({
        type: 'shot',
        hit: data.hit,
        headshot: data.headshot,
        killed: data.zombieDead,
        kills: data.kills,
        money: data.money,
      });
    }).catch(() => {});
    return true;
  }

  playRemoteShot(shot) {
    if (!shot) return;
    const weaponId = shot.weaponId || 'pistol';
    const rays = Array.isArray(shot.rays) ? shot.rays : [];
    for (const ray of rays) {
      const nums = [ray.x, ray.y, ray.dirX, ray.dirY, ray.endX, ray.endY].map(Number);
      if (!nums.every(Number.isFinite)) continue;
      this.vfx.addShot({
        x: nums[0], y: nums[1], dirX: nums[2], dirY: nums[3], endX: nums[4], endY: nums[5],
        wallBlocked: ray.wallBlocked === true, weaponId, intensity: 0.85, headshot: ray.headshot === true,
      });
      if (ray.hit && ray.zombieId != null) {
        const z = this.zombieManager.zombies.get(Number(ray.zombieId));
        if (z) {
          z.triggerHitFlash();
          const bx = Number.isFinite(Number(ray.endX)) ? Number(ray.endX) : z._visualX;
          const by = Number.isFinite(Number(ray.endY)) ? Number(ray.endY) : z._visualY;
          this.vfx.addBlood(bx, by, ray.zombieDead ? 24 : 10, ray.headshot === true);
        }
      }
    }
    const first=rays[0]; if(first){ const lp=window.__game?.localPlayer; const listener=lp?{x:lp.x+lp.width/2,y:lp.y+lp.height/2}:null; this.audio?.playWeapon(weaponId,Number(first.x),Number(first.y),listener,true); }
  }

  _raycastObstacles(ox, oy, dx, dy, maxDistance, obstacles) {
    const step = 8;
    for (let traveled = 0; traveled <= maxDistance; traveled += step) {
      const px = ox + dx * traveled, py = oy + dy * traveled;
      for (const o of obstacles) {
        if (!o.solid) continue;
        if (px >= o.x && px <= o.x + o.width && py >= o.y && py <= o.y + o.height) return traveled;
      }
    }
    return null;
  }
  update(_dt) {}
  render(ctx, camera) { this.vfx.renderWorld(ctx, camera); }
}
