const config = require('./config');

class RoundSystem {
  constructor(zombieSystem) {
    this.zombieSystem = zombieSystem;
    this.number = 0;
    this.state = 'waiting';
    this.timer = 0;
  }

  _computeRoundConfig(round) {
    let totalZombies = config.ROUND_BASE_ZOMBIES + (round - 1) * config.ROUND_ZOMBIES_PER_ROUND;
    totalZombies = Math.min(totalZombies, 120); // total do round; vivos simultâneos continuam limitados em 60
    return {
      totalZombies,
      healthMultiplier: 1 + Math.max(0, round - 1) * config.ROUND_HEALTH_MULTIPLIER_PER_ROUND,
      speedMultiplier: 1 + Math.max(0, round - 1) * config.ROUND_SPEED_MULTIPLIER_PER_ROUND,
      roundNumber: round,
    };
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
    this.zombieSystem.setRoundParameters({ totalZombies: 0, healthMultiplier: 1, speedMultiplier: 1, roundNumber: 0 });
  }

  tick(dt, playerCount, onChange) {
    if (playerCount === 0 && this.state !== 'waiting') {
      this._resetToWaiting(); onChange(); return;
    }
    if (this.state === 'waiting') {
      if (playerCount >= 1) { this.state = 'countdown'; this.timer = config.ROUND_START_COUNTDOWN_SECONDS; onChange(); }
    } else if (this.state === 'countdown') {
      this.timer -= dt;
      if (this.timer <= 0) { this._startRound(1); onChange(); }
    } else if (this.state === 'running') {
      if (this.zombieSystem.isRoundComplete()) { this.state = 'intermission'; this.timer = config.ROUND_INTERMISSION_SECONDS; onChange(); }
    } else if (this.state === 'intermission') {
      this.timer -= dt;
      if (this.timer <= 0) { this._startRound(this.number + 1); onChange(); }
    }
  }

  getState() {
    let displayNumber = this.number;
    if (this.state === 'countdown') displayNumber = 1;
    else if (this.state === 'intermission') displayNumber = this.number + 1;
    return {
      number: displayNumber,
      state: this.state,
      countdownSeconds: this.timer > 0 ? Math.ceil(this.timer) : 0,
      zombiesTotal: this.zombieSystem.maxZombiesThisRound,
      zombiesAlive: this.zombieSystem.aliveCount,
      zombiesRemaining: this.zombieSystem.aliveCount + this.zombieSystem.remainingToSpawn,
      bossRound: displayNumber > 0 && displayNumber % 5 === 0,
      shopOpen: this.state === 'intermission',
    };
  }
}

module.exports = RoundSystem;
