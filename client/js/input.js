class InputManager {
  constructor() {
    this.keys=Object.create(null);this.actions=Object.create(null);
    this.physicalTouchDevice=!!(window.matchMedia?.('(pointer: coarse)').matches||('ontouchstart'in window)||navigator.maxTouchPoints>0);this.hudMode='auto';this.isTouchDevice=this.physicalTouchDevice;
    this.joystickActive=false;this.joystickVector={x:0,y:0};this.mouseX=innerWidth/2;this.mouseY=innerHeight/2;this._mouseDown=false;
    this.aimTouchActive=false;this.aimTouchVector={x:0,y:1};this._aimTargetVector={x:0,y:1};this.aimSensitivity=1;
    this._escCallback=null;this.interactHeld=false;this.scoreboardHeld=false;
    this._bindKeyboard();this._bindJoystick();this._bindMouseAim();this._bindShootZone();this._bindMobileActions();
    if(this.isTouchDevice)document.body.classList.add('touch-mode');
  }
  onEscape(cb){this._escCallback=cb;}
  setAimSensitivity(v){this.aimSensitivity=Math.max(.5,Math.min(1.8,Number(v)||1));}
  setHudMode(mode='auto'){this.hudMode=['auto','pc','mobile'].includes(mode)?mode:'auto';this.isTouchDevice=this.hudMode==='mobile'?true:this.hudMode==='pc'?false:this.physicalTouchDevice;if(this.isTouchDevice)document.body.classList.add('touch-mode');else document.body.classList.remove('touch-mode');}
  usesMobileControls(){return this.isTouchDevice===true;}
  update(dt){if(!this.aimTouchActive)return;const k=4+this.aimSensitivity*13,t=1-Math.exp(-k*Math.max(0,dt));let x=this.aimTouchVector.x+(this._aimTargetVector.x-this.aimTouchVector.x)*t,y=this.aimTouchVector.y+(this._aimTargetVector.y-this.aimTouchVector.y)*t,l=Math.hypot(x,y)||1;this.aimTouchVector={x:x/l,y:y/l};}
  consumeAction(name){if(!this.actions[name])return false;this.actions[name]=false;return true;}
  _pushAction(name){this.actions[name]=true;}
  isScoreboardHeld(){return this.scoreboardHeld===true;}

  _bindKeyboard(){
    window.addEventListener('keydown',e=>{this.keys[e.code]=true;
      if(e.code==='Escape'&&this._escCallback)this._escCallback();
      if(e.code==='KeyE')this.interactHeld=true;if(e.code==='Tab'){e.preventDefault();this.scoreboardHeld=true;}
      if(!e.repeat){if(e.code==='KeyR')this._pushAction('reload');if(e.code==='Digit1')this._pushAction('slot1');if(e.code==='Digit2')this._pushAction('slot2');if(e.code==='KeyE')this._pushAction('interact');if(e.code==='KeyF')this._pushAction('pickup');if(e.code==='KeyB')this._pushAction('shop');if(e.code==='BracketLeft')this._pushAction('spectatePrev');if(e.code==='BracketRight')this._pushAction('spectateNext');}
    });
    window.addEventListener('keyup',e=>{this.keys[e.code]=false;if(e.code==='KeyE')this.interactHeld=false;if(e.code==='Tab'){e.preventDefault();this.scoreboardHeld=false;}});
    window.addEventListener('blur',()=>{this.keys=Object.create(null);this._mouseDown=false;this.interactHeld=false;this.scoreboardHeld=false;});
  }

  _bindJoystick(){const zone=document.getElementById('joystick-zone'),base=document.getElementById('joystick-base'),stick=document.getElementById('joystick-stick');if(!zone||!base||!stick)return;const max=40;let pointerId=null,rect=null;
    const update=(x,y)=>{if(!rect)return;const cx=rect.left+rect.width/2,cy=rect.top+rect.height/2,dx=x-cx,dy=y-cy,raw=Math.hypot(dx,dy),dist=Math.min(raw,max),a=Math.atan2(dy,dx),sx=Math.cos(a)*dist,sy=Math.sin(a)*dist;stick.style.transform=`translate(${sx}px, ${sy}px)`;this.joystickVector={x:raw<6?0:sx/max,y:raw<6?0:sy/max};};
    const reset=()=>{pointerId=null;rect=null;this.joystickActive=false;this.joystickVector={x:0,y:0};stick.style.transform='translate(0, 0)';};
    zone.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&this.hudMode!=='mobile')return;e.preventDefault();if(pointerId!==null)return;pointerId=e.pointerId;rect=base.getBoundingClientRect();this.joystickActive=true;zone.setPointerCapture?.(e.pointerId);update(e.clientX,e.clientY);});zone.addEventListener('pointermove',e=>{if(e.pointerId!==pointerId)return;e.preventDefault();update(e.clientX,e.clientY);});const finish=e=>{if(e.pointerId!==pointerId)return;e.preventDefault();reset();};zone.addEventListener('pointerup',finish);zone.addEventListener('pointercancel',finish);zone.addEventListener('lostpointercapture',()=>{if(pointerId!==null)reset();});
  }

  _bindMouseAim(){const canvas=document.getElementById('game-canvas');if(!canvas)return;canvas.addEventListener('mousemove',e=>{this.mouseX=e.clientX;this.mouseY=e.clientY;});canvas.addEventListener('mousedown',e=>{if(e.button!==0)return;this.mouseX=e.clientX;this.mouseY=e.clientY;this._mouseDown=true;});window.addEventListener('mouseup',e=>{if(e.button===0)this._mouseDown=false;});canvas.addEventListener('contextmenu',e=>e.preventDefault());}
  getMousePosition(){return{x:this.mouseX,y:this.mouseY};}isMouseDown(){return this._mouseDown;}

  _bindShootZone(){const zone=document.getElementById('shoot-zone'),base=document.getElementById('shoot-base'),stick=document.getElementById('shoot-stick');if(!zone||!base||!stick)return;const max=40;let pointerId=null,rect=null;
    const update=(x,y)=>{if(!rect)return;const cx=rect.left+rect.width/2,cy=rect.top+rect.height/2,dx=x-cx,dy=y-cy,raw=Math.hypot(dx,dy),dist=Math.min(raw,max),a=Math.atan2(dy,dx),sx=Math.cos(a)*dist,sy=Math.sin(a)*dist;stick.style.transform=`translate(${sx}px, ${sy}px)`;const deadzone=Math.max(2,7-this.aimSensitivity*2.5);if(raw>=deadzone){const l=Math.hypot(sx,sy)||1;this._aimTargetVector={x:sx/l,y:sy/l};}};
    const reset=()=>{pointerId=null;rect=null;this.aimTouchActive=false;stick.style.transform='translate(0, 0)';};
    zone.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&this.hudMode!=='mobile')return;e.preventDefault();if(pointerId!==null)return;pointerId=e.pointerId;rect=base.getBoundingClientRect();this.aimTouchActive=true;zone.setPointerCapture?.(e.pointerId);update(e.clientX,e.clientY);});zone.addEventListener('pointermove',e=>{if(e.pointerId!==pointerId)return;e.preventDefault();update(e.clientX,e.clientY);});const finish=e=>{if(e.pointerId!==pointerId)return;e.preventDefault();reset();};zone.addEventListener('pointerup',finish);zone.addEventListener('pointercancel',finish);zone.addEventListener('lostpointercapture',()=>{if(pointerId!==null)reset();});
  }
  isShootTouchActive(){return this.aimTouchActive;}getShootTouchVector(){return this.aimTouchVector;}

  _bindMobileActions(){const map={'btn-mobile-reload':'reload','btn-mobile-switch':'switchNext','btn-mobile-pickup':'pickup','btn-mobile-interact':'interact','btn-mobile-shop':'shop','btn-mobile-score':'scoreboardToggle'};for(const[id,action]of Object.entries(map)){const el=document.getElementById(id);if(!el)continue;el.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&!this.isTouchDevice)return;e.preventDefault();e.stopPropagation();if(id==='btn-mobile-interact')this.interactHeld=true;this._pushAction(action);});if(id==='btn-mobile-interact'){const release=e=>{e?.preventDefault?.();this.interactHeld=false;};el.addEventListener('pointerup',release);el.addEventListener('pointercancel',release);el.addEventListener('lostpointercapture',release);}}}
  isInteractHeld(){return this.interactHeld===true;}
  getMoveVector(){let x=0,y=0;if(this.keys.KeyW||this.keys.ArrowUp)y--;if(this.keys.KeyS||this.keys.ArrowDown)y++;if(this.keys.KeyA||this.keys.ArrowLeft)x--;if(this.keys.KeyD||this.keys.ArrowRight)x++;if(x||y){const l=Math.hypot(x,y);return{x:x/l,y:y/l};}if(this.joystickActive){const{x:jx,y:jy}=this.joystickVector,l=Math.hypot(jx,jy);return l>1?{x:jx/l,y:jy/l}:{x:jx,y:jy};}return{x:0,y:0};}
}
