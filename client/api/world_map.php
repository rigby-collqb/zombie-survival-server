<?php
/**
 * world_map.php
 * ------------------------------------------------------------
 * O mapa (js/map.js) é gerado no CLIENTE por um PRNG determinístico
 * a partir de MAP_SEED — o servidor nunca teve essa geometria.
 *
 * Em vez de reimplementar o PRNG em PHP (frágil: qualquer diferença
 * de arredondamento faria zumbis/tiros divergirem do que o jogador
 * vê), rodamos a MESMA geração uma única vez em Node
 * (tools/export_obstacles.js, cópia fiel de js/map.js) e exportamos
 * apenas os obstáculos SÓLIDOS (usados na colisão) para
 * database/world_obstacles.json.
 *
 * Se no futuro o mapa mudar (nova seed, novo tamanho, nova geração),
 * rode `node tools/export_obstacles.js` de novo para atualizar esse
 * JSON — os dois lados (cliente e servidor) continuam sempre iguais
 * porque os dois partem do mesmo código de geração.
 *
 * Este arquivo NÃO duplica lógica de colisão (item 11 do pedido):
 * reaproveita o mesmo teste de interseção AABB que collision.js usa
 * no cliente (rects_intersect) e adiciona só o necessário para
 * zumbis/hitscan (círculo x retângulo, raycast simples).
 * ------------------------------------------------------------
 */

/** Retorna a lista de obstáculos sólidos do mapa (cacheado por requisição). */
function get_world_obstacles(): array {
  static $obstacles = null;
  if ($obstacles !== null) {
    return $obstacles;
  }

  $path = __DIR__ . '/../database/world_obstacles.json';
  $raw = @file_get_contents($path);
  if ($raw === false) {
    $obstacles = [];
    return $obstacles;
  }

  $data = json_decode($raw, true);
  $obstacles = (is_array($data) && isset($data['obstacles'])) ? $data['obstacles'] : [];
  return $obstacles;
}

/** Mesmo teste AABB de js/collision.js (Collision.rectsIntersect). */
function rects_intersect(array $a, array $b): bool {
  return (
    $a['x'] < $b['x'] + $b['width'] &&
    $a['x'] + $a['width'] > $b['x'] &&
    $a['y'] < $b['y'] + $b['height'] &&
    $a['y'] + $a['height'] > $b['y']
  );
}

/** Verifica se um círculo (ex.: zumbi, jogador) colide com algum obstáculo sólido. */
function circle_hits_any_obstacle(float $cx, float $cy, float $radius, array $obstacles): bool {
  foreach ($obstacles as $o) {
    // Retângulo expandido pelo raio == teste círculo x AABB simplificado.
    $rect = [
      'x' => $o['x'] - $radius, 'y' => $o['y'] - $radius,
      'width' => $o['width'] + $radius * 2, 'height' => $o['height'] + $radius * 2,
    ];
    if ($cx >= $rect['x'] && $cx <= $rect['x'] + $rect['width'] &&
        $cy >= $rect['y'] && $cy <= $rect['y'] + $rect['height']) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve movimento eixo-a-eixo contra obstáculos (mesmo algoritmo de
 * Collision.resolveMovement em collision.js), para uma entidade
 * circular simplificada como um AABB do tamanho de seu diâmetro.
 */
function resolve_circle_movement(float $x, float $y, float $nextX, float $nextY, float $radius, array $obstacles): array {
  $d = $radius * 2;

  $rectAt = fn($px, $py) => ['x' => $px - $radius, 'y' => $py - $radius, 'width' => $d, 'height' => $d];

  $hitsAny = function ($rect) use ($obstacles) {
    foreach ($obstacles as $o) {
      if (rects_intersect($rect, $o)) return true;
    }
    return false;
  };

  $resolvedX = $x;
  if (!$hitsAny($rectAt($nextX, $y))) {
    $resolvedX = $nextX;
  }

  $resolvedY = $y;
  if (!$hitsAny($rectAt($resolvedX, $nextY))) {
    $resolvedY = $nextY;
  }

  return ['x' => $resolvedX, 'y' => $resolvedY];
}

/**
 * Raycast simples: caminha do ponto de origem até maxDistance na
 * direção (dx,dy) (já normalizada) em passos fixos, e retorna a
 * distância até o primeiro obstáculo sólido atingido, ou null se o
 * raio não bateu em nada dentro do alcance.
 * Passos de 8px são suficientes para os obstáculos deste mapa
 * (menor obstáculo sólido tem ~8px de lado) sem custo alto de CPU.
 */
function raycast_distance_to_obstacle(float $ox, float $oy, float $dx, float $dy, float $maxDistance, array $obstacles): ?float {
  $step = 8.0;
  $traveled = 0.0;
  while ($traveled <= $maxDistance) {
    $px = $ox + $dx * $traveled;
    $py = $oy + $dy * $traveled;
    foreach ($obstacles as $o) {
      if ($px >= $o['x'] && $px <= $o['x'] + $o['width'] &&
          $py >= $o['y'] && $py <= $o['y'] + $o['height']) {
        return $traveled;
      }
    }
    $traveled += $step;
  }
  return null;
}

/**
 * Distância do ponto (px,py) ao segmento de raio que vai de (ox,oy)
 * na direção (dx,dy) por até maxDistance — usada para checar se um
 * zumbi/jogador está "no caminho" do tiro (aproximação por círculo,
 * suficiente para hitscan 2D simples).
 */
function point_distance_to_ray(float $px, float $py, float $ox, float $oy, float $dx, float $dy, float $maxDistance): array {
  $vx = $px - $ox;
  $vy = $py - $oy;
  $t = $vx * $dx + $vy * $dy; // projeção escalar na direção do raio
  $t = max(0.0, min($maxDistance, $t));
  $closestX = $ox + $dx * $t;
  $closestY = $oy + $dy * $t;
  $dist = hypot($px - $closestX, $py - $closestY);
  return ['distanceAlongRay' => $t, 'distanceFromRay' => $dist];
}
