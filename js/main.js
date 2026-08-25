/**
 * main.js
 * ------------------------------------------------------------
 * Ponto de entrada. Apenas instancia o Game — toda a lógica
 * fica nos módulos especializados (game.js, player.js, etc).
 * ------------------------------------------------------------
 */

window.addEventListener('DOMContentLoaded', () => {
  window.__game = new Game();
});
