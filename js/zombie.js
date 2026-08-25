const ZOMBIE_VISUAL_CONFIG = {
  MAX_EXTRAPOLATION_MS: 450,
  SNAP_DISTANCE: 190,
  CORRECTION_SMOOTHING: 12,
  DEATH_FADE_MS: 900,
  HIT_FLASH_MS: 120,
  NEARBY_HEALTHBAR_DISTANCE: 180,
};

const ZOMBIE_STYLES = {
  normal:   { body:'#4a7a3a', dark:'#294a24', eye:'#d64032' },
  runner:   { body:'#6c9144', dark:'#3e5d29', eye:'#ff5140' },
  tank:     { body:'#46563c', dark:'#283125', eye:'#ff8b37' },
  exploder: { body:'#75612e', dark:'#403416', eye:'#ffc735' },
  spitter:  { body:'#47765e', dark:'#274738', eye:'#65ff9d' },
  boss:     { body:'#65373a', dark:'#361d20', eye:'#ff3636' },
};

class Zombie {
  constructor(data) {
    this.id = data.id;
    this.type = data.type || 'normal';
    this.maxHealth = data.maxHealth || 100;
    this.health = data.health;
    this.state = data.state;
    this.directionX = data.directionX || 0;
    this.directionY = data.directionY || 1;
    this.radius = Number(data.radius) || 15;
    this.speed = Number(data.speed) || 70;

    this.serverX = data.x;
    this.serverY = data.y;
    this._visualX = data.x;
    this._visualY = data.y;
    this.timeSinceSnapshot = 0;

    this._deathTimer = 0;
    this._hitFlashMs = 0;
    this._anim = Math.random() * Math.PI * 2;
    this.removed = false;
  }

  applySnapshot(data) {
    if (this.state !== 'dead' && data.state === 'dead') this._deathTimer = 0;
    this.serverX = data.x;
    this.serverY = data.y;
    this.health = data.health;
    this.maxHealth = data.maxHealth || this.maxHealth;
    this.state = data.state;
    this.directionX = data.directionX;
    this.directionY = data.directionY;
    this.type = data.type || this.type;
    this.radius = Number(data.radius) || this.radius;
    this.speed = Number(data.speed) || this.speed;
    this.timeSinceSnapshot = 0;
  }

  triggerHitFlash() { this._hitFlashMs = ZOMBIE_VISUAL_CONFIG.HIT_FLASH_MS; }

  update(dt) {
    this.timeSinceSnapshot += dt * 1000;
    const animSpeed = this.type === 'runner' ? 12 : this.type === 'tank' ? 4.2 : this.type === 'boss' ? 3.4 : 6.5;
    this._anim += dt * animSpeed;
    if (this._hitFlashMs > 0) this._hitFlashMs -= dt * 1000;

    if (this.state === 'dead') {
      this._deathTimer += dt * 1000;
      if (this._deathTimer >= ZOMBIE_VISUAL_CONFIG.DEATH_FADE_MS) this.removed = true;
      return;
    }

    const moving = this.state === 'chase' || this.state === 'wander';
    const speed = moving ? this.speed * (this.state === 'wander' ? 0.5 : 1) : 0;
    const sec = Math.min(this.timeSinceSnapshot, ZOMBIE_VISUAL_CONFIG.MAX_EXTRAPOLATION_MS) / 1000;
    const predictedX = this.serverX + this.directionX * speed * sec;
    const predictedY = this.serverY + this.directionY * speed * sec;
    const dx = predictedX - this._visualX;
    const dy = predictedY - this._visualY;
    const dist = Math.hypot(dx, dy);

    if (dist >= ZOMBIE_VISUAL_CONFIG.SNAP_DISTANCE) {
      this._visualX = predictedX;
      this._visualY = predictedY;
    } else {
      const t = 1 - Math.exp(-ZOMBIE_VISUAL_CONFIG.CORRECTION_SMOOTHING * dt);
      this._visualX += dx * t;
      this._visualY += dy * t;
    }
  }

  distanceTo(x, y) { return Math.hypot(this._visualX - x, this._visualY - y); }

  getHeadWorld() {
    const len = Math.hypot(this.directionX, this.directionY) || 1;
    return {
      x: this._visualX + (this.directionX / len) * this.radius * 0.38,
      y: this._visualY + (this.directionY / len) * this.radius * 0.38,
      radius: Math.max(5, this.radius * 0.36),
    };
  }

  _drawLimbs(ctx, x, y, r, style, moving, bob) {
    const len = Math.hypot(this.directionX, this.directionY) || 1;
    const fx = this.directionX / len;
    const fy = this.directionY / len;
    const sx = -fy;
    const sy = fx;
    const stride = moving ? Math.sin(this._anim) : 0;
    const lean = this.type === 'runner' ? 5 : 2;

    ctx.strokeStyle = this._hitFlashMs > 0 ? '#fff' : style.dark;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(3, r * (this.type === 'tank' || this.type === 'boss' ? 0.34 : 0.22));

    // Braços — o runner fica mais inclinado e o tank abre os braços.
    const armSpread = this.type === 'tank' || this.type === 'boss' ? 1.05 : 0.78;
    for (const side of [-1, 1]) {
      const ax = x + sx * r * 0.45 * side + fx * lean;
      const ay = y + sy * r * 0.45 * side + fy * lean + bob;
      const ex = ax + fx * r * 0.92 + sx * r * 0.22 * side * armSpread;
      const ey = ay + fy * r * 0.92 + sy * r * 0.22 * side * armSpread;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ex, ey); ctx.stroke();
    }

    // Pernas com passada alternada.
    ctx.lineWidth = Math.max(3, r * 0.2);
    for (const side of [-1, 1]) {
      const phase = stride * side;
      const lx = x - fx * r * 0.35 + sx * r * 0.3 * side;
      const ly = y - fy * r * 0.35 + sy * r * 0.3 * side + bob;
      const ex = lx - fx * r * (0.55 + phase * 0.14) + sx * phase * r * 0.18;
      const ey = ly - fy * r * (0.55 + phase * 0.14) + sy * phase * r * 0.18;
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(ex, ey); ctx.stroke();
    }
  }

  _drawTypeDetails(ctx, x, y, r, style, bob) {
    if (this.type === 'tank') {
      ctx.strokeStyle = '#73806a';
      ctx.lineWidth = Math.max(2, r * 0.12);
      ctx.beginPath(); ctx.arc(x, y + bob, r * 0.72, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
      ctx.fillStyle = '#313a2d';
      ctx.fillRect(x - r * 0.72, y - r * 0.28 + bob, r * 0.34, r * 0.28);
      ctx.fillRect(x + r * 0.38, y - r * 0.28 + bob, r * 0.34, r * 0.28);
    } else if (this.type === 'exploder') {
      const pulse = 0.5 + 0.5 * Math.sin(this._anim * 1.6);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.25 + pulse * 0.25;
      ctx.fillStyle = '#ffc735';
      ctx.beginPath(); ctx.arc(x, y + bob, r * (0.35 + pulse * 0.08), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (this.type === 'spitter') {
      const len = Math.hypot(this.directionX, this.directionY) || 1;
      const fx = this.directionX / len, fy = this.directionY / len;
      ctx.fillStyle = '#72e99a';
      ctx.beginPath(); ctx.arc(x + fx * r * 0.7, y + fy * r * 0.7 + bob, r * 0.18, 0, Math.PI * 2); ctx.fill();
    } else if (this.type === 'boss') {
      ctx.strokeStyle = '#b94848';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.65, y - r * 0.58 + bob);
      ctx.lineTo(x - r * 0.95, y - r * 1.0 + bob);
      ctx.moveTo(x + r * 0.65, y - r * 0.58 + bob);
      ctx.lineTo(x + r * 0.95, y - r * 1.0 + bob);
      ctx.stroke();
    }
  }

  render(ctx, camera, nearby) {
    const r = this.radius;
    if (!camera.isPointVisible(this._visualX, this._visualY, r + 70)) return;

    const s = camera.worldToScreen(this._visualX, this._visualY);
    const moving = this.state === 'chase' || this.state === 'wander';
    const bobStrength = this.type === 'runner' ? 2.2 : this.type === 'tank' ? 0.7 : 1.25;
    const bob = moving ? Math.sin(this._anim * 2) * bobStrength : Math.sin(this._anim) * 0.35;
    const style = ZOMBIE_STYLES[this.type] || ZOMBIE_STYLES.normal;
    const flashing = this._hitFlashMs > 0;
    let alpha = 1;

    if (this.state === 'dead') alpha = Math.max(0, 1 - this._deathTimer / ZOMBIE_VISUAL_CONFIG.DEATH_FADE_MS);

    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + r + 4, r * 0.82, Math.max(5, r * 0.3), 0, 0, Math.PI * 2);
    ctx.fill();

    if (this.type === 'exploder' && this.state !== 'dead') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.18 + 0.11 * Math.sin(this._anim * 1.4);
      ctx.fillStyle = '#ffc735';
      ctx.beginPath(); ctx.arc(s.x, s.y, r + 9, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    if (this.type === 'boss' && this.state !== 'dead') {
      ctx.save();
      ctx.globalAlpha = 0.23 + 0.08 * Math.sin(this._anim);
      ctx.strokeStyle = '#ff3d3d';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(s.x, s.y, r + 10, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    this._drawLimbs(ctx, s.x, s.y, r, style, moving, bob);

    ctx.fillStyle = flashing ? '#fff' : (this.state === 'dead' ? '#374035' : style.body);
    ctx.beginPath();
    const bodyScaleX = this.type === 'runner' ? 0.82 : this.type === 'tank' || this.type === 'boss' ? 1.12 : 1;
    ctx.ellipse(s.x, s.y + bob, r * bodyScaleX, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = this.type === 'tank' || this.type === 'boss' ? 3 : 2;
    ctx.stroke();

    this._drawTypeDetails(ctx, s.x, s.y, r, style, bob);

    if (this.state !== 'dead') {
      const head = this.getHeadWorld();
      const hs = camera.worldToScreen(head.x, head.y);
      const headRadius = Math.max(5, r * (this.type === 'tank' || this.type === 'boss' ? 0.53 : 0.48));

      ctx.fillStyle = flashing ? '#fff' : style.body;
      ctx.beginPath(); ctx.arc(hs.x, hs.y + bob, headRadius, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = style.dark;
      ctx.lineWidth = Math.max(1.5, r * 0.08);
      ctx.stroke();

      ctx.fillStyle = style.eye;
      const sideX = -this.directionY;
      const sideY = this.directionX;
      const eyeSpread = this.type === 'boss' ? 5 : 3;
      const eyeSize = this.type === 'boss' ? 3.2 : 2.1;
      ctx.beginPath();
      ctx.arc(hs.x + sideX * eyeSpread + this.directionX * 2, hs.y + sideY * eyeSpread + this.directionY * 2 + bob, eyeSize, 0, Math.PI * 2);
      ctx.arc(hs.x - sideX * eyeSpread + this.directionX * 2, hs.y - sideY * eyeSpread + this.directionY * 2 + bob, eyeSize, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    if (this.state !== 'dead' && (this.health < this.maxHealth || nearby || this.type === 'boss')) {
      this._renderHealthBar(ctx, s, r);
    }
  }

  _renderHealthBar(ctx, s, r) {
    const w = this.type === 'boss' ? 72 : 36;
    const h = this.type === 'boss' ? 7 : 4;
    const x = s.x - w / 2;
    const y = s.y - r - 18;
    const pct = Math.max(0, this.health / this.maxHealth);
    ctx.fillStyle = 'rgba(0,0,0,.65)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = this.type === 'boss' ? '#d63b3b' : (pct > .5 ? '#7bc96f' : pct > .25 ? '#e0c341' : '#d9534f');
    ctx.fillRect(x, y, w * pct, h);
  }
}
