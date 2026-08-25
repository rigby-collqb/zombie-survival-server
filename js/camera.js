/**
 * camera.js
 * ------------------------------------------------------------
 * Câmera 2D que segue uma entidade (jogador) suavemente.
 *
 * Importante para o multiplayer futuro: a câmera é um objeto
 * independente do jogador. Cada cliente terá SUA PRÓPRIA
 * instância de Camera apontando para o jogador local — jogadores
 * remotos nunca controlam a câmera, apenas são desenhados
 * relativamente a ela.
 * ------------------------------------------------------------
 */

class Camera {
  constructor(viewWidth, viewHeight, worldWidth, worldHeight) {
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;

    // x,y = canto superior esquerdo da câmera no mundo
    this.x = 0;
    this.y = 0;

    this.smoothing = 8; // quanto maior, mais rápido a câmera alcança o alvo
  }

  resize(viewWidth, viewHeight) {
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
  }

  /**
   * Move a câmera suavemente em direção ao centro do alvo (jogador).
   * dt em segundos.
   */
  follow(targetX, targetY, dt) {
    const desiredX = targetX - this.viewWidth / 2;
    const desiredY = targetY - this.viewHeight / 2;

    // Interpolação exponencial (suave e independente de framerate)
    const t = 1 - Math.exp(-this.smoothing * dt);
    this.x += (desiredX - this.x) * t;
    this.y += (desiredY - this.y) * t;

    this._clampToWorld();
  }

  /** Posiciona a câmera instantaneamente (usado ao iniciar a partida). */
  snapTo(targetX, targetY) {
    this.x = targetX - this.viewWidth / 2;
    this.y = targetY - this.viewHeight / 2;
    this._clampToWorld();
  }

  _clampToWorld() {
    const maxX = Math.max(0, this.worldWidth - this.viewWidth);
    const maxY = Math.max(0, this.worldHeight - this.viewHeight);
    this.x = Math.max(0, Math.min(this.x, maxX));
    this.y = Math.max(0, Math.min(this.y, maxY));
  }

  worldToScreen(x, y) {
    return { x: x - this.x, y: y - this.y };
  }

  screenToWorld(x, y) {
    return { x: x + this.x, y: y + this.y };
  }

  /* -------- Testes de visibilidade (culling para performance) -------- */

  isRectVisible(rect) {
    return (
      rect.x < this.x + this.viewWidth &&
      rect.x + rect.width > this.x &&
      rect.y < this.y + this.viewHeight &&
      rect.y + rect.height > this.y
    );
  }

  isPointVisible(x, y, margin = 0) {
    return (
      x + margin > this.x &&
      x - margin < this.x + this.viewWidth &&
      y + margin > this.y &&
      y - margin < this.y + this.viewHeight
    );
  }

  isCircleVisible(x, y, radius) {
    return this.isPointVisible(x, y, radius);
  }
}
