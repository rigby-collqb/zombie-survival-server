/**
 * collision.js
 * ------------------------------------------------------------
 * Sistema de colisão genérico baseado em retângulos (AABB).
 *
 * Este módulo não sabe nada sobre "jogador", "zumbi" ou "mapa" —
 * ele apenas resolve colisões entre retângulos. Isso permite que,
 * nas próximas fases, zumbis, outros jogadores e objetos
 * interativos usem exatamente o mesmo sistema.
 * ------------------------------------------------------------
 */

const Collision = {

  /**
   * Verifica se dois retângulos (AABB) se sobrepõem.
   * Cada retângulo: { x, y, width, height } com x/y no canto superior esquerdo.
   */
  rectsIntersect(a, b) {
    return (
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y
    );
  },

  /**
   * Retorna a lista de obstáculos que colidem com o retângulo informado.
   * `obstacles` deve ser uma lista de objetos com { x, y, width, height, solid }.
   */
  getCollisions(rect, obstacles) {
    const result = [];
    for (let i = 0; i < obstacles.length; i++) {
      const obs = obstacles[i];
      if (!obs.solid) continue;
      if (this.rectsIntersect(rect, obs)) {
        result.push(obs);
      }
    }
    return result;
  },

  /**
   * Tenta mover um retângulo de (x,y) até (nextX,nextY), resolvendo colisões
   * eixo a eixo (permite "deslizar" ao longo de paredes, em vez de travar).
   *
   * Retorna a posição final permitida { x, y }.
   */
  resolveMovement(entityRect, nextX, nextY, obstacles) {
    // Testa o eixo X isoladamente
    const testX = { ...entityRect, x: nextX, y: entityRect.y };
    let resolvedX = entityRect.x;
    if (this.getCollisions(testX, obstacles).length === 0) {
      resolvedX = nextX;
    }

    // Testa o eixo Y isoladamente (usando o X já resolvido)
    const testY = { ...entityRect, x: resolvedX, y: nextY };
    let resolvedY = entityRect.y;
    if (this.getCollisions(testY, obstacles).length === 0) {
      resolvedY = nextY;
    }

    return { x: resolvedX, y: resolvedY };
  },

  /**
   * Restringe um retângulo aos limites do mundo (não sair do mapa).
   */
  clampToWorld(rect, worldWidth, worldHeight) {
    let x = Math.max(0, Math.min(rect.x, worldWidth - rect.width));
    let y = Math.max(0, Math.min(rect.y, worldHeight - rect.height));
    return { x, y };
  }
};
