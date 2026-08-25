function createSeededRandom(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class GameMap {
  constructor(width, height, seed = 1337) {
    this.width = width;
    this.height = height;
    this.seed = seed;
    this.obstacles = [];
    this.dynamicObstacles = [];
    this.roads = [];
    this.forestPatches = [];
    this.decorations = [];
    this.props = [];
    this.zones = [];
    this.generate();
  }

  generate() {
    const rnd = createSeededRandom(this.seed);
    this._generateZones();
    this._generateRoads(rnd);
    this._generateForestZones(rnd);
    this._generateTrees(rnd);
    this._generateRocks(rnd);
    this._generateHouses(rnd);
    this._generateFences(rnd);
    this._generateLandmarks();
    this._generateGrassDetails(rnd);
    this._generateProps(rnd);
    this.obstacles.sort((a, b) => a.y - b.y);
  }

  _generateZones() {
    this.zones = [
      { id:'outpost', name:'POSTO DOS SOBREVIVENTES', x:1650, y:1650, width:700, height:700, tint:'rgba(80,105,72,.12)' },
      { id:'hospital', name:'HOSPITAL ABANDONADO', x:220, y:220, width:900, height:760, tint:'rgba(75,100,105,.12)' },
      { id:'gas', name:'POSTO DE COMBUSTÍVEL', x:2940, y:1440, width:820, height:820, tint:'rgba(130,100,45,.10)' },
      { id:'military', name:'BASE MILITAR', x:2820, y:2780, width:1040, height:1040, tint:'rgba(75,90,65,.14)' },
      { id:'camp', name:'ACAMPAMENTO NA FLORESTA', x:220, y:2780, width:1050, height:920, tint:'rgba(55,95,55,.13)' },
    ];
  }

  _generateRoads(rnd) {
    const roadWidth = 90;
    this.roads.push({ x1:0, y1:this.height/2, x2:this.width, y2:this.height/2, width:roadWidth });
    this.roads.push({ x1:this.width/2, y1:0, x2:this.width/2, y2:this.height, width:roadWidth });
    for (let i=0;i<3;i++) {
      const y = 400 + rnd() * (this.height - 800);
      this.roads.push({ x1:0, y1:y, x2:this.width*0.4, y2:y, width:50 });
    }
  }

  _isOnRoad(x,y,margin=20){
    for(const road of this.roads){
      if(road.x1===road.x2){if(Math.abs(x-road.x1)<road.width/2+margin)return true;}
      else if(Math.abs(y-road.y1)<road.width/2+margin)return true;
    }
    return false;
  }

  _isReservedZone(x,y,margin=30){
    return this.zones.some(z=>x>=z.x-margin&&x<=z.x+z.width+margin&&y>=z.y-margin&&y<=z.y+z.height+margin);
  }

  _generateForestZones(rnd){
    for(let i=0;i<7;i++)this.forestPatches.push({x:rnd()*this.width,y:rnd()*this.height,radius:260+rnd()*250});
  }
  _inForestZone(x,y){return this.forestPatches.some(z=>{const dx=x-z.x,dy=y-z.y;return dx*dx+dy*dy<z.radius*z.radius;});}

  _generateTrees(rnd){
    const target=430;let placed=0,attempts=0;
    while(placed<target&&attempts<target*8){attempts++;const x=rnd()*this.width,y=rnd()*this.height;if(this._isOnRoad(x,y,60)||this._isReservedZone(x,y,25))continue;const inForest=this._inForestZone(x,y);if(!inForest&&rnd()>.12)continue;const canopyRadius=22+rnd()*16,trunkSize=10;this.obstacles.push({type:'tree',x:x-trunkSize/2,y:y-trunkSize/2,width:trunkSize,height:trunkSize,solid:true,canopyRadius,renderX:x,renderY:y,seedColor:rnd()});placed++;}
  }

  _generateRocks(rnd){
    for(let i=0;i<95;i++){const x=rnd()*this.width,y=rnd()*this.height;if(this._isOnRoad(x,y,40)||this._isReservedZone(x,y,20))continue;const size=18+rnd()*20;this.obstacles.push({type:'rock',x:x-size/2,y:y-size/2,width:size,height:size,solid:true,seedColor:rnd()});}
  }

  _generateHouses(rnd){
    const target=18;let placed=0,attempts=0;
    while(placed<target&&attempts<target*24){attempts++;const w=140+rnd()*80,h=100+rnd()*60,x=100+rnd()*(this.width-200-w),y=100+rnd()*(this.height-200-h);if(this._isOnRoad(x,y,80)||this._isOnRoad(x+w,y+h,80)||this._isReservedZone(x+w/2,y+h/2,90))continue;const overlaps=this.obstacles.some(o=>o.type==='house'&&Collision.rectsIntersect({x:x-40,y:y-40,width:w+80,height:h+80},o));if(overlaps)continue;this.obstacles.push({type:'house',x,y,width:w,height:h,solid:true,doorSide:Math.floor(rnd()*4),roofSeed:rnd()});placed++;}
  }

  _generateFences(rnd){
    for(let i=0;i<11;i++){const startX=rnd()*this.width,startY=rnd()*this.height;if(this._isOnRoad(startX,startY,60)||this._isReservedZone(startX,startY,50))continue;const horizontal=rnd()>.5,segments=5+Math.floor(rnd()*6),gap=26;for(let s=0;s<segments;s++){const x=horizontal?startX+s*gap:startX,y=horizontal?startY:startY+s*gap;this.obstacles.push({type:'fence',x:x-4,y:y-4,width:8,height:8,solid:true,horizontal});}}
  }

  _addLandmarkObstacle(subtype,x,y,width,height,extra={}){this.obstacles.push({type:'landmark',subtype,x,y,width,height,solid:true,...extra});}

  _generateLandmarks(){
    // Hospital
    this._addLandmarkObstacle('hospital',430,420,390,235);
    this._addLandmarkObstacle('hospital_annex',520,675,205,88);
    // Posto de combustível
    this._addLandmarkObstacle('gas_building',3220,1690,310,190);
    for(let i=0;i<3;i++)this._addLandmarkObstacle('pump',3065+i*72,1940,24,46);
    // Safehouse central: paredes com abertura leste e abertura norte para barricada.
    this._addLandmarkObstacle('safe_wall',1810,1800,140,18);
    this._addLandmarkObstacle('safe_wall',2050,1800,140,18);
    this._addLandmarkObstacle('safe_wall',1810,2190,380,18);
    this._addLandmarkObstacle('safe_wall',1810,1800,18,408);
    this._addLandmarkObstacle('safe_wall',2172,1800,18,150);
    this._addLandmarkObstacle('safe_wall',2172,2060,18,148);
    // Base militar: perímetro com abertura no topo para portão comprável.
    this._addLandmarkObstacle('mil_wall',2920,2920,210,20);
    this._addLandmarkObstacle('mil_wall',3270,2920,500,20);
    this._addLandmarkObstacle('mil_wall',2920,3620,850,20);
    this._addLandmarkObstacle('mil_wall',2920,2920,20,720);
    this._addLandmarkObstacle('mil_wall',3750,2920,20,720);
    this._addLandmarkObstacle('bunker',3310,3270,250,145);
    // Acampamento: caixas/torres sólidas simples.
    this._addLandmarkObstacle('camp_tower',520,3070,52,52);
    this._addLandmarkObstacle('camp_tower',980,3470,52,52);
  }

  _generateGrassDetails(rnd){for(let i=0;i<620;i++)this.decorations.push({x:rnd()*this.width,y:rnd()*this.height,size:2.5+rnd()*4.5,seedColor:rnd()});}

  _generateProps(rnd){
    this.props.push(
      {type:'helipad',x:650,y:825,r:72,label:'H'},
      {type:'ambulance',x:860,y:570,angle:.08},
      {type:'ambulance',x:850,y:650,angle:-.05},
      {type:'gas_canopy',x:3030,y:1875,width:300,height:145},
      {type:'sign',x:3380,y:1510,text:'GAS'},
      {type:'mil_pad',x:3140,y:3220,r:86},
      {type:'tent',x:600,y:3270},{type:'tent',x:730,y:3390},{type:'tent',x:870,y:3210},
      {type:'campfire',x:760,y:3300},
      {type:'safe_mark',x:2000,y:2000,r:120}
    );
    for(let i=0;i<34;i++)this.props.push({type:'debris',x:160+rnd()*(this.width-320),y:160+rnd()*(this.height-320),angle:rnd()*Math.PI,size:4+rnd()*8});
    for(let i=0;i<12;i++){const road=this.roads[Math.floor(rnd()*this.roads.length)];const vertical=road.x1===road.x2;const x=vertical?road.x1+(rnd()-.5)*28:rnd()*this.width;const y=vertical?rnd()*this.height:road.y1+(rnd()-.5)*28;this.props.push({type:'car',x,y,angle:vertical?Math.PI/2:0,seed:rnd()});}
  }

  setDynamicObstacles(obstacles){this.dynamicObstacles=Array.isArray(obstacles)?obstacles.filter(Boolean):[];}
  getAllObstacles(){return [...this.obstacles,...this.dynamicObstacles];}
  getObstaclesNear(x,y,radius){return this.getAllObstacles().filter(o=>{const cx=o.x+o.width/2,cy=o.y+o.height/2,dx=cx-x,dy=cy-y;return dx*dx+dy*dy<radius*radius;});}
  getZoneAt(x,y){for(const z of this.zones)if(x>=z.x&&x<=z.x+z.width&&y>=z.y&&y<=z.y+z.height)return z;return {id:'wilds',name:'ZONA SELVAGEM'};}

  render(ctx,camera){this._renderGround(ctx,camera);this._renderZones(ctx,camera);this._renderForestTint(ctx,camera);this._renderRoads(ctx,camera);this._renderGroundMarks(ctx,camera);this._renderGrassDetails(ctx,camera);this._renderProps(ctx,camera);this._renderObstacles(ctx,camera);}
  _renderGround(ctx,camera){ctx.fillStyle='#35452d';ctx.fillRect(0,0,camera.viewWidth,camera.viewHeight);}
  _renderZones(ctx,camera){for(const z of this.zones){if(!camera.isRectVisible(z))continue;const s=camera.worldToScreen(z.x,z.y);ctx.save();ctx.fillStyle=z.tint;ctx.fillRect(s.x,s.y,z.width,z.height);ctx.strokeStyle='rgba(255,255,255,.035)';ctx.lineWidth=2;ctx.strokeRect(s.x,s.y,z.width,z.height);ctx.restore();}}
  _renderForestTint(ctx,camera){ctx.fillStyle='rgba(18,32,18,.34)';for(const z of this.forestPatches){if(!camera.isCircleVisible(z.x,z.y,z.radius))continue;const s=camera.worldToScreen(z.x,z.y);ctx.beginPath();ctx.arc(s.x,s.y,z.radius,0,Math.PI*2);ctx.fill();}}
  _renderRoads(ctx,camera){for(const road of this.roads){const rect=this._roadBounds(road);if(!camera.isRectVisible(rect))continue;const p1=camera.worldToScreen(road.x1,road.y1),p2=camera.worldToScreen(road.x2,road.y2);ctx.strokeStyle='#45423d';ctx.lineWidth=road.width;ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke();ctx.strokeStyle='rgba(225,205,116,.38)';ctx.lineWidth=3;ctx.setLineDash([18,16]);ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke();ctx.setLineDash([]);}}
  _roadBounds(r){const minX=Math.min(r.x1,r.x2)-r.width,minY=Math.min(r.y1,r.y2)-r.width,maxX=Math.max(r.x1,r.x2)+r.width,maxY=Math.max(r.y1,r.y2)+r.width;return{x:minX,y:minY,width:maxX-minX,height:maxY-minY};}
  _renderGroundMarks(ctx,camera){for(const z of this.zones){const c=camera.worldToScreen(z.x+z.width/2,z.y+z.height/2);if(c.x<-300||c.y<-150||c.x>camera.viewWidth+300||c.y>camera.viewHeight+150)continue;ctx.save();ctx.globalAlpha=.16;ctx.fillStyle='#e7e2dc';ctx.font='900 36px Segoe UI';ctx.textAlign='center';ctx.fillText(z.name,c.x,c.y);ctx.restore();}}
  _renderGrassDetails(ctx,camera){for(const t of this.decorations){if(!camera.isPointVisible(t.x,t.y,10))continue;const s=camera.worldToScreen(t.x,t.y);ctx.fillStyle=t.seedColor>.5?'#4b6638':'#2d4225';ctx.fillRect(s.x,s.y,t.size,t.size);}}

  _renderProps(ctx,camera){
    for(const p of this.props){if(!camera.isPointVisible(p.x,p.y,130))continue;const s=camera.worldToScreen(p.x,p.y);ctx.save();ctx.translate(s.x,s.y);ctx.rotate(p.angle||0);
      if(p.type==='helipad'||p.type==='mil_pad'){ctx.strokeStyle=p.type==='mil_pad'?'rgba(170,190,145,.45)':'rgba(215,215,215,.38)';ctx.lineWidth=5;ctx.beginPath();ctx.arc(0,0,p.r,0,Math.PI*2);ctx.stroke();ctx.font='900 52px Segoe UI';ctx.fillStyle='rgba(230,230,230,.28)';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('H',0,2);}
      else if(p.type==='ambulance'){ctx.fillStyle='#d8d8d4';ctx.fillRect(-36,-15,72,30);ctx.fillStyle='#a63232';ctx.fillRect(-8,-15,16,30);ctx.fillRect(-36,-4,72,8);ctx.fillStyle='#171717';ctx.fillRect(-28,12,14,6);ctx.fillRect(15,12,14,6);}
      else if(p.type==='gas_canopy'){ctx.fillStyle='rgba(72,60,45,.65)';ctx.fillRect(-p.width/2,-p.height/2,p.width,p.height);ctx.strokeStyle='rgba(235,184,77,.45)';ctx.lineWidth=4;ctx.strokeRect(-p.width/2,-p.height/2,p.width,p.height);}
      else if(p.type==='sign'){ctx.fillStyle='#30261d';ctx.fillRect(-4,0,8,45);ctx.fillStyle='#7f2e28';ctx.fillRect(-34,-24,68,28);ctx.fillStyle='#f0d28b';ctx.font='900 16px Arial';ctx.textAlign='center';ctx.fillText(p.text,0,-5);}
      else if(p.type==='tent'){ctx.fillStyle='#53614a';ctx.beginPath();ctx.moveTo(-34,22);ctx.lineTo(0,-26);ctx.lineTo(34,22);ctx.closePath();ctx.fill();ctx.strokeStyle='#2c3527';ctx.stroke();}
      else if(p.type==='campfire'){ctx.fillStyle='#4a3423';ctx.fillRect(-18,-3,36,6);ctx.rotate(Math.PI/2);ctx.fillRect(-18,-3,36,6);ctx.rotate(-Math.PI/2);ctx.fillStyle='rgba(255,143,49,.72)';ctx.beginPath();ctx.arc(0,-7,10,0,Math.PI*2);ctx.fill();}
      else if(p.type==='safe_mark'){ctx.strokeStyle='rgba(114,198,124,.28)';ctx.lineWidth=5;ctx.beginPath();ctx.arc(0,0,p.r,0,Math.PI*2);ctx.stroke();}
      else if(p.type==='debris'){ctx.fillStyle='rgba(38,34,30,.55)';ctx.fillRect(-p.size/2,-2,p.size,4);}
      else if(p.type==='car'){ctx.fillStyle=p.seed>.5?'#5b5e5c':'#5e4037';ctx.fillRect(-31,-15,62,30);ctx.fillStyle='rgba(25,29,30,.8)';ctx.fillRect(-15,-12,28,24);ctx.fillStyle='#141414';ctx.fillRect(-25,12,12,5);ctx.fillRect(14,12,12,5);}
      ctx.restore();
    }
  }

  _renderObstacles(ctx,camera){for(const o of this.obstacles){const b={x:o.x-45,y:o.y-45,width:o.width+90,height:o.height+90};if(!camera.isRectVisible(b))continue;switch(o.type){case'tree':this._renderTree(ctx,camera,o);break;case'rock':this._renderRock(ctx,camera,o);break;case'house':this._renderHouse(ctx,camera,o);break;case'fence':this._renderFence(ctx,camera,o);break;case'landmark':this._renderLandmark(ctx,camera,o);break;}}}
  _renderTree(ctx,camera,o){const s=camera.worldToScreen(o.renderX??o.x+o.width/2,o.renderY??o.y+o.height/2),r=o.canopyRadius||28;ctx.fillStyle='rgba(0,0,0,.25)';ctx.beginPath();ctx.ellipse(s.x,s.y+6,r*.7,r*.3,0,0,Math.PI*2);ctx.fill();const t=camera.worldToScreen(o.x,o.y);ctx.fillStyle='#4a3423';ctx.fillRect(t.x,t.y,o.width,o.height);ctx.fillStyle=o.seedColor>.5?'#2d5a2c':'#274c27';ctx.beginPath();ctx.arc(s.x,s.y-r*.5,r,0,Math.PI*2);ctx.fill();}
  _renderRock(ctx,camera,o){const s=camera.worldToScreen(o.x,o.y);ctx.fillStyle='rgba(0,0,0,.25)';ctx.beginPath();ctx.ellipse(s.x+o.width/2,s.y+o.height*.8,o.width*.5,o.height*.2,0,0,Math.PI*2);ctx.fill();ctx.fillStyle=o.seedColor>.5?'#666762':'#53514c';ctx.beginPath();ctx.ellipse(s.x+o.width/2,s.y+o.height/2,o.width/2,o.height/2,0,0,Math.PI*2);ctx.fill();}
  _renderHouse(ctx,camera,o){const s=camera.worldToScreen(o.x,o.y);ctx.fillStyle='rgba(0,0,0,.3)';ctx.fillRect(s.x+6,s.y+6,o.width,o.height);ctx.fillStyle=o.roofSeed>.5?'#57483b':'#493f37';ctx.fillRect(s.x,s.y,o.width,o.height);ctx.fillStyle='#2b1f18';ctx.fillRect(s.x-4,s.y-14,o.width+8,18);ctx.fillStyle='rgba(126,154,144,.32)';ctx.fillRect(s.x+12,s.y+16,18,18);ctx.fillRect(s.x+o.width-30,s.y+16,18,18);}
  _renderFence(ctx,camera,o){const s=camera.worldToScreen(o.x,o.y);ctx.fillStyle='#75583b';ctx.fillRect(s.x,s.y,o.width,o.height);}
  _renderLandmark(ctx,camera,o){const s=camera.worldToScreen(o.x,o.y);const st=o.subtype;
    if(st==='hospital'||st==='hospital_annex'){ctx.fillStyle='rgba(0,0,0,.3)';ctx.fillRect(s.x+7,s.y+7,o.width,o.height);ctx.fillStyle=st==='hospital'?'#5e6562':'#545b58';ctx.fillRect(s.x,s.y,o.width,o.height);ctx.fillStyle='#d8d5cf';ctx.fillRect(s.x+o.width/2-9,s.y+20,18,52);ctx.fillRect(s.x+o.width/2-26,s.y+37,52,18);ctx.fillStyle='#2e3231';ctx.fillRect(s.x-4,s.y-12,o.width+8,15);}
    else if(st==='gas_building'){ctx.fillStyle='#58483b';ctx.fillRect(s.x,s.y,o.width,o.height);ctx.fillStyle='#8c352d';ctx.fillRect(s.x,s.y,o.width,18);}
    else if(st==='pump'){ctx.fillStyle='#7d2d28';ctx.fillRect(s.x,s.y,o.width,o.height);ctx.fillStyle='#d7c6a7';ctx.fillRect(s.x+5,s.y+6,o.width-10,12);}
    else if(st==='safe_wall'){ctx.fillStyle='#5a5a51';ctx.fillRect(s.x,s.y,o.width,o.height);ctx.fillStyle='rgba(255,255,255,.08)';ctx.fillRect(s.x,s.y,o.width,3);}
    else if(st==='mil_wall'){ctx.fillStyle='#4a5145';ctx.fillRect(s.x,s.y,o.width,o.height);ctx.strokeStyle='#777e6f';ctx.strokeRect(s.x,s.y,o.width,o.height);}
    else if(st==='bunker'){ctx.fillStyle='#434a40';ctx.fillRect(s.x,s.y,o.width,o.height);ctx.fillStyle='#2a2e28';ctx.fillRect(s.x+18,s.y+18,o.width-36,o.height-36);}
    else if(st==='camp_tower'){ctx.fillStyle='#6b573d';ctx.fillRect(s.x,s.y,o.width,o.height);ctx.strokeStyle='#2b241b';ctx.strokeRect(s.x,s.y,o.width,o.height);}
  }
}
