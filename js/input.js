class InputManager {
  constructor() {
    this.keys = Object.create(null);
    this.actions = Object.create(null);

    // Alguns celulares/browsers não expõem ontouchstart de forma confiável.
    // pointer: coarse + maxTouchPoints deixa os controles mobile visíveis de forma robusta.
    this.isTouchDevice = !!(
      window.matchMedia?.('(pointer: coarse)').matches ||
      ('ontouchstart' in window) ||
      navigator.maxTouchPoints > 0
    );

    this.joystickActive = false;
    this.joystickVector = { x: 0, y: 0 };
    this.mouseX = innerWidth / 2;
    this.mouseY = innerHeight / 2;
    this._mouseDown = false;
    this.aimTouchActive = false;
    this.aimTouchVector = { x: 0, y: 1 };
    this._escCallback = null;

    this._bindKeyboard();
    this._bindJoystick();
    this._bindMouseAim();
    this._bindShootZone();
    this._bindMobileActions();

    if (this.isTouchDevice) document.body.classList.add('touch-mode');
  }

  onEscape(cb) { this._escCallback = cb; }

  consumeAction(name) {
    if (!this.actions[name]) return false;
    this.actions[name] = false;
    return true;
  }

  _pushAction(name) { this.actions[name] = true; }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Escape' && this._escCallback) this._escCallback();
      if (!e.repeat) {
        if (e.code === 'KeyR') this._pushAction('reload');
        if (e.code === 'Digit1') this._pushAction('slot1');
        if (e.code === 'Digit2') this._pushAction('slot2');
        if (e.code === 'KeyE') this._pushAction('interact');
        if (e.code === 'KeyF') this._pushAction('pickup');
        if (e.code === 'KeyB') this._pushAction('shop');
      }
    });

    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => {
      this.keys = Object.create(null);
      this._mouseDown = false;
    });
  }

  _bindJoystick() {
    const zone = document.getElementById('joystick-zone');
    const base = document.getElementById('joystick-base');
    const stick = document.getElementById('joystick-stick');
    if (!zone || !base || !stick) return;

    const max = 40;
    let pointerId = null;
    let rect = null;

    const update = (x, y) => {
      if (!rect) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = x - cx;
      const dy = y - cy;
      const rawDistance = Math.hypot(dx, dy);
      const distance = Math.min(rawDistance, max);
      const angle = Math.atan2(dy, dx);
      const sx = Math.cos(angle) * distance;
      const sy = Math.sin(angle) * distance;
      stick.style.transform = `translate(${sx}px, ${sy}px)`;
      this.joystickVector = {
        x: rawDistance < 6 ? 0 : sx / max,
        y: rawDistance < 6 ? 0 : sy / max,
      };
    };

    const reset = () => {
      pointerId = null;
      rect = null;
      this.joystickActive = false;
      this.joystickVector = { x: 0, y: 0 };
      stick.style.transform = 'translate(0, 0)';
    };

    zone.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      e.preventDefault();
      if (pointerId !== null) return;
      pointerId = e.pointerId;
      rect = base.getBoundingClientRect();
      this.joystickActive = true;
      zone.setPointerCapture?.(e.pointerId);
      update(e.clientX, e.clientY);
    });

    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointerId) return;
      e.preventDefault();
      update(e.clientX, e.clientY);
    });

    const finish = (e) => {
      if (e.pointerId !== pointerId) return;
      e.preventDefault();
      reset();
    };
    zone.addEventListener('pointerup', finish);
    zone.addEventListener('pointercancel', finish);
    zone.addEventListener('lostpointercapture', () => {
      if (pointerId !== null) reset();
    });
  }

  _bindMouseAim() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;

    canvas.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this._mouseDown = true;
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this._mouseDown = false;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  getMousePosition() { return { x: this.mouseX, y: this.mouseY }; }
  isMouseDown() { return this._mouseDown; }

  _bindShootZone() {
    const zone = document.getElementById('shoot-zone');
    const base = document.getElementById('shoot-base');
    const stick = document.getElementById('shoot-stick');
    if (!zone || !base || !stick) return;

    const max = 40;
    let pointerId = null;
    let rect = null;

    const update = (x, y) => {
      if (!rect) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = x - cx;
      const dy = y - cy;
      const rawDistance = Math.hypot(dx, dy);
      const distance = Math.min(rawDistance, max);
      const angle = Math.atan2(dy, dx);
      const sx = Math.cos(angle) * distance;
      const sy = Math.sin(angle) * distance;
      stick.style.transform = `translate(${sx}px, ${sy}px)`;

      // Arrastar o analógico direito define a mira. Mesmo tocando no centro,
      // o jogador ainda atira na última direção válida.
      if (rawDistance >= 4) {
        const len = Math.hypot(sx, sy) || 1;
        this.aimTouchVector = { x: sx / len, y: sy / len };
      }
    };

    const reset = () => {
      pointerId = null;
      rect = null;
      this.aimTouchActive = false;
      stick.style.transform = 'translate(0, 0)';
    };

    zone.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      e.preventDefault();
      if (pointerId !== null) return;
      pointerId = e.pointerId;
      rect = base.getBoundingClientRect();
      this.aimTouchActive = true;
      zone.setPointerCapture?.(e.pointerId);
      update(e.clientX, e.clientY);
    });

    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointerId) return;
      e.preventDefault();
      update(e.clientX, e.clientY);
    });

    const finish = (e) => {
      if (e.pointerId !== pointerId) return;
      e.preventDefault();
      reset();
    };
    zone.addEventListener('pointerup', finish);
    zone.addEventListener('pointercancel', finish);
    zone.addEventListener('lostpointercapture', () => {
      if (pointerId !== null) reset();
    });
  }

  isShootTouchActive() { return this.aimTouchActive; }
  getShootTouchVector() { return this.aimTouchVector; }

  _bindMobileActions() {
    const map = {
      'btn-mobile-reload': 'reload',
      'btn-mobile-switch': 'switchNext',
      'btn-mobile-pickup': 'pickup',
      'btn-mobile-interact': 'interact',
      'btn-mobile-shop': 'shop',
    };

    for (const [id, action] of Object.entries(map)) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && !this.isTouchDevice) return;
        e.preventDefault();
        e.stopPropagation();
        this._pushAction(action);
      });
    }
  }

  getMoveVector() {
    let x = 0;
    let y = 0;
    if (this.keys.KeyW || this.keys.ArrowUp) y--;
    if (this.keys.KeyS || this.keys.ArrowDown) y++;
    if (this.keys.KeyA || this.keys.ArrowLeft) x--;
    if (this.keys.KeyD || this.keys.ArrowRight) x++;

    if (x || y) {
      const len = Math.hypot(x, y);
      return { x: x / len, y: y / len };
    }

    if (this.joystickActive) {
      const { x: jx, y: jy } = this.joystickVector;
      const len = Math.hypot(jx, jy);
      return len > 1 ? { x: jx / len, y: jy / len } : { x: jx, y: jy };
    }

    return { x: 0, y: 0 };
  }
}
