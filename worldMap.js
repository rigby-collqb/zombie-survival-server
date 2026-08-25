/**
 * worldMap.js
 * ------------------------------------------------------------
 * Porta para Node das mesmas funções de colisão de api/world_map.php
 * (que por sua vez espelham js/collision.js). Carrega os obstáculos
 * estáticos gerados por tools/export_obstacles.js — o MESMO arquivo
 * que o PHP usa (data/world_obstacles.json é uma cópia de
 * database/world_obstacles.json) — para que zumbis/tiros no servidor
 * Node respeitem exatamente as mesmas paredes/árvores/casas que o
 * cliente desenha.
 *
 * Se o mapa mudar um dia (nova seed/tamanho), rode de novo
 * tools/export_obstacles.js e copie o JSON para server/data/.
 * ------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

let obstacles = [];

try {
  const raw = fs.readFileSync(path.join(__dirname, 'data', 'world_obstacles.json'), 'utf8');
  const data = JSON.parse(raw);
  obstacles = Array.isArray(data.obstacles) ? data.obstacles : [];
} catch (err) {
  console.error('[worldMap] Falha ao carregar world_obstacles.json:', err.message);
  obstacles = [];
}

function getObstacles() {
  return obstacles;
}

/** Mesmo teste AABB de js/collision.js / api/world_map.php. */
function rectsIntersect(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Círculo x obstáculos sólidos (usado para spawn e ataque). */
function circleHitsAnyObstacle(cx, cy, radius) {
  for (const o of obstacles) {
    const rectX = o.x - radius;
    const rectY = o.y - radius;
    const rectW = o.width + radius * 2;
    const rectH = o.height + radius * 2;
    if (cx >= rectX && cx <= rectX + rectW && cy >= rectY && cy <= rectY + rectH) {
      return true;
    }
  }
  return false;
}

/** Resolve movimento eixo-a-eixo contra obstáculos (mesmo algoritmo do Collision.resolveMovement). */
function resolveCircleMovement(x, y, nextX, nextY, radius) {
  const d = radius * 2;
  const rectAt = (px, py) => ({ x: px - radius, y: py - radius, width: d, height: d });

  const hitsAny = (rect) => {
    for (const o of obstacles) {
      if (rectsIntersect(rect, o)) return true;
    }
    return false;
  };

  let resolvedX = x;
  if (!hitsAny(rectAt(nextX, y))) resolvedX = nextX;

  let resolvedY = y;
  if (!hitsAny(rectAt(resolvedX, nextY))) resolvedY = nextY;

  return { x: resolvedX, y: resolvedY };
}

/** Raycast simples em passos fixos — mesma ideia de api/world_map.php. */
function raycastDistanceToObstacle(ox, oy, dx, dy, maxDistance) {
  const step = 8;
  for (let traveled = 0; traveled <= maxDistance; traveled += step) {
    const px = ox + dx * traveled;
    const py = oy + dy * traveled;
    for (const o of obstacles) {
      if (px >= o.x && px <= o.x + o.width && py >= o.y && py <= o.y + o.height) {
        return traveled;
      }
    }
  }
  return null;
}

/** Distância de um ponto até o segmento de raio (para hitscan). */
function pointDistanceToRay(px, py, ox, oy, dx, dy, maxDistance) {
  const vx = px - ox;
  const vy = py - oy;
  let t = vx * dx + vy * dy;
  t = Math.max(0, Math.min(maxDistance, t));
  const closestX = ox + dx * t;
  const closestY = oy + dy * t;
  const dist = Math.hypot(px - closestX, py - closestY);
  return { distanceAlongRay: t, distanceFromRay: dist };
}

module.exports = {
  getObstacles,
  circleHitsAnyObstacle,
  resolveCircleMovement,
  raycastDistanceToObstacle,
  pointDistanceToRay,
};
