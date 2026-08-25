/**
 * rounds.js
 * ------------------------------------------------------------
 * Máquina de estados dos rounds (item 2 do pedido da Fase 4).
 * Fluxo: waiting -> countdown -> running -> intermission -> running
 * (round+1) -> intermission -> ... "intermission" já FAZ o papel do
 * "PRÓXIMO ROUND EM 8" — não existe um segundo countdown separado
 * entre rounds, só no primeiro round (saindo de "waiting").
 *
 * Sem jogadores conectados, a partida volta para 'waiting' (reset
 * simples — aceitável nesta fase, igual a "se o Render reiniciar").
 * ------------------------------------------------------------
 */

const config = require('./config');

class RoundSystem {
  constructor(zombieSystem) {
    this.zombieSystem = zombieSystem;
    this.number = 0;
    this.state = 'waiting'; // waiting | countdown | running | intermission
    this.timer = 0; // segundos restantes (countdown/intermission)
  }

  _computeRoundConfig(round) {
    const totalZombies = config.ROUND_BASE_ZOMBIES + (round - 1) * config.ROUND_ZOMBIES_PER_ROUND;
    const healthMultiplier = 1 + round * config.ROUND_HEALTH_MULTIPLIER_PER_ROUND;
    const speedMultiplier = 1 + round * config.ROUND_SPEED_MULTIPLIER_PER_ROUND;
    return { totalZombies, healthMultiplier, speedMultiplier };
  }

  _startRound(number) {
    this.number = number;
    this.state = 'running';
    this.timer = 0;
    this.zombieSystem.setRoundParameters(this._computeRoundConfig(number));
  }

  _resetToWaiting() {
    this.state = 'waiting';
    this.number = 0;
    this.timer = 0;
    this.zombieSystem.setRoundParameters({ totalZombies: 0, healthMultiplier: 1, speedMultiplier: 1 });
  }

  /**
   * Avança a máquina de estados. `onChange()` é chamado sempre que o
   * estado muda de verdade, para o GameServer poder emitir
   * 'round:state' imediatamente (fora do broadcast periódico normal).
   */
  tick(dt, playerCount, onChange) {
    if (playerCount === 0 && this.state !== 'waiting') {
      this._resetToWaiting();
      onChange();
      return;
    }

    switch (this.state) {
      case 'waiting':
        if (playerCount >= 1) {
          this.state = 'countdown';
          this.timer = config.ROUND_START_COUNTDOWN_SECONDS;
          onChange();
        }
        break;

      case 'countdown':
        this.timer -= dt;
        if (this.timer <= 0) {
          this._startRound(1);
          onChange();
        }
        break;

      case 'running':
        if (this.zombieSystem.isRoundComplete()) {
          this.state = 'intermission';
          this.timer = config.ROUND_INTERMISSION_SECONDS;
          onChange();
        }
        break;

      case 'intermission':
        this.timer -= dt;
        if (this.timer <= 0) {
          this._startRound(this.number + 1);
          onChange();
        }
        break;
    }
  }

  getState() {
    // Durante o countdown ainda não criamos o round 1 de fato, e
    // durante a intermissão o round anterior já terminou — em ambos
    // os casos queremos mostrar no HUD o round que está PRESTES a
    // começar, não o último concluído.
    let displayNumber = this.number;
    if (this.state === 'countdown') displayNumber = 1;
    else if (this.state === 'intermission') displayNumber = this.number + 1;

    return {
      number: displayNumber,
      state: this.state,
      countdownSeconds: this.timer > 0 ? Math.ceil(this.timer) : 0,
      zombiesTotal: this.zombieSystem.maxZombiesThisRound,
      zombiesAlive: this.zombieSystem.aliveCount,
    };
  }
}

module.exports = RoundSystem;
