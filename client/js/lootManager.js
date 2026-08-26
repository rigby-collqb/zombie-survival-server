class LootManager {
  constructor() {
    this.items = new Map();
  }

  applySnapshot(items) {
    if (!Array.isArray(items)) return;
    const seen = new Set();
    for (const raw of items) {
      if (!raw || raw.id == null) continue;
      const item = { ...raw, id:Number(raw.id), x:Number(raw.x), y:Number(raw.y) };
      if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) continue;
      seen.add(item.id); this.items.set(item.id, item);
    }
    for (const id of this.items.keys()) if (!seen.has(id)) this.items.delete(id);
  }

  add(item) {
    if (!item || item.id == null) return;
    this.items.set(Number(item.id), { ...item, id:Number(item.id), x:Number(item.x), y:Number(item.y) });
  }

  remove(id) { this.items.delete(Number(id)); }
  clear() { this.items.clear(); }

  nearest(x, y, maxDistance = 78) {
    let best = null, bestD = maxDistance;
    for (const item of this.items.values()) {
      const d = Math.hypot(item.x - x, item.y - y);
      if (d < bestD) { best = item; bestD = d; }
    }
    return best ? { item:best, distance:bestD } : null;
  }

  render(ctx, camera, nowMs = performance.now()) {
    for (const item of this.items.values()) {
      if (!camera.isPointVisible(item.x, item.y, 45)) continue;
      const s = camera.worldToScreen(item.x, item.y);
      const color = RARITY_COLORS[item.rarity] || RARITY_COLORS.common;
      const pulse = 0.65 + Math.sin(nowMs * 0.006 + item.id) * 0.2;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(s.x, s.y, 2, s.x, s.y, 24);
      glow.addColorStop(0, color);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = pulse * 0.55;
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(s.x, s.y, 24, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.fillStyle = '#171917';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(s.x - 10, s.y - 10, 20, 20, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const icon = item.kind === 'ammo' ? 'A' : item.kind === 'money' ? '$' : item.kind === 'medkit' ? '+' : 'W';
      ctx.fillText(icon, s.x, s.y + 0.5);
      ctx.font = '9px Arial'; ctx.fillStyle = '#fff';
      const label = item.kind === 'weapon' ? (clientWeapon(item.weaponId).name) : RARITY_LABELS[item.rarity];
      ctx.fillText(label, s.x, s.y + 22);
      ctx.restore();
    }
  }
}
