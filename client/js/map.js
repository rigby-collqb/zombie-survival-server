function createSeededRandom(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GAME_MAP_CATALOG = Object.freeze({
  city: {
    id:'city', name:'Cidade Abandonada', theme:'city', seedOffset:0,
    description:'Centro urbano destruído, becos, hospital, mercado e posto dos sobreviventes.',
    spawn:{x:2000,y:2000,radius:145}, trees:330, rocks:72, houses:24, fences:14, grass:650,
    zones:[
      ['outpost','POSTO DOS SOBREVIVENTES',1650,1650,700,700,'rgba(80,105,72,.13)'],
      ['hospital','HOSPITAL ABANDONADO',220,220,900,760,'rgba(75,100,105,.13)'],
      ['police','DELEGACIA',1180,220,700,700,'rgba(68,88,112,.12)'],
      ['market','MERCADO ABANDONADO',2160,240,700,720,'rgba(116,92,58,.12)'],
      ['gas','POSTO DE COMBUSTÍVEL',2940,1440,820,820,'rgba(130,100,45,.11)'],
      ['military','BASE MILITAR',2820,2780,1040,1040,'rgba(75,90,65,.14)'],
      ['camp','ACAMPAMENTO',220,2780,1050,920,'rgba(55,95,55,.13)'],
      ['scrapyard','FERRO-VELHO',1420,2920,1040,820,'rgba(96,78,62,.12)'],
    ],
  },
  hospital: {
    id:'hospital', name:'Distrito Hospitalar', theme:'fog', seedOffset:1717,
    description:'Complexo médico tomado pela névoa, ambulâncias, alas fechadas e estacionamento.',
    spawn:{x:2000,y:3300,radius:135}, trees:190, rocks:52, houses:16, fences:12, grass:470,
    zones:[
      ['hospital_core','HOSPITAL SANTA HELENA',1150,820,1700,1250,'rgba(160,180,178,.10)'],
      ['morgue','MORGUE',350,650,650,720,'rgba(95,112,116,.12)'],
      ['parking','ESTACIONAMENTO',2920,650,760,1000,'rgba(92,92,92,.10)'],
      ['clinic','CLÍNICA DE EMERGÊNCIA',430,2350,920,720,'rgba(103,132,130,.10)'],
      ['pharmacy','FARMÁCIA',2750,2350,830,700,'rgba(103,135,106,.10)'],
      ['evac','PONTO DE EVACUAÇÃO',1450,3100,1100,650,'rgba(100,125,92,.12)'],
    ],
  },
  forest: {
    id:'forest', name:'Floresta Sombria', theme:'forest', seedOffset:4242,
    description:'Mata densa, cabanas, trilhas estreitas e um acampamento abandonado.',
    spawn:{x:2000,y:2050,radius:125}, trees:760, rocks:135, houses:10, fences:7, grass:900,
    zones:[
      ['ranger','POSTO FLORESTAL',1650,1650,700,700,'rgba(64,92,58,.16)'],
      ['cabins','CABANAS DO NORTE',350,420,1000,920,'rgba(73,88,58,.13)'],
      ['lake','LAGO SECO',2700,380,950,900,'rgba(70,85,78,.10)'],
      ['camp','ACAMPAMENTO PERDIDO',400,2760,1050,850,'rgba(76,96,62,.14)'],
      ['sawmill','SERRARIA',2600,2750,1050,850,'rgba(105,83,58,.12)'],
    ],
  },
  military: {
    id:'military', name:'Zona Militar Ômega', theme:'night', seedOffset:9090,
    description:'Base militar noturna, bunkers, hangares, torres e corredores cercados.',
    spawn:{x:620,y:3350,radius:120}, trees:170, rocks:75, houses:8, fences:18, grass:420,
    zones:[
      ['checkpoint','CHECKPOINT ÔMEGA',250,3000,900,700,'rgba(85,100,76,.14)'],
      ['base','BASE MILITAR ÔMEGA',1050,520,2550,2550,'rgba(65,83,67,.16)'],
      ['hangar','HANGARES',2300,900,1100,900,'rgba(74,84,78,.13)'],
      ['bunkers','SETOR DE BUNKERS',1200,1950,900,850,'rgba(70,80,68,.14)'],
      ['runway','PISTA DE EVACUAÇÃO',2250,2200,1150,650,'rgba(90,92,89,.10)'],
    ],
  },
  industrial: {
    id:'industrial', name:'Complexo Industrial', theme:'storm', seedOffset:13331,
    description:'Fábricas, depósitos, contêineres e pátios industriais sob uma tempestade.',
    spawn:{x:650,y:650,radius:130}, trees:95, rocks:85, houses:8, fences:16, grass:360,
    zones:[
      ['entry','PORTARIA INDUSTRIAL',250,250,850,800,'rgba(96,88,72,.12)'],
      ['factory','FÁBRICA 07',1250,350,1100,1050,'rgba(92,78,70,.13)'],
      ['containers','PÁTIO DE CONTÊINERES',2550,350,1150,1200,'rgba(105,76,60,.12)'],
      ['warehouse','ARMAZÉNS',350,2200,1250,1350,'rgba(92,82,72,.13)'],
      ['rail','TERMINAL FERROVIÁRIO',1750,2250,850,1200,'rgba(76,76,72,.11)'],
      ['reactor','SETOR DE ENERGIA',2750,2350,900,1150,'rgba(100,91,55,.12)'],
    ],
  },
});

class GameMap {
  constructor(width, height, seed = 1337, mapId = 'city') {
    this.width = width; this.height = height; this.seed = seed;
    this.mapId = GAME_MAP_CATALOG[mapId] ? mapId : 'city';
    this.config = GAME_MAP_CATALOG[this.mapId];
    this.theme = this.config.theme;
    this.spawn = {...this.config.spawn};
    this.obstacles=[]; this.dynamicObstacles=[]; this.roads=[]; this.forestPatches=[]; this.decorations=[]; this.props=[]; this.zones=[];
    this.generate();
  }

  generate(){
    const rnd=createSeededRandom(this.seed + this.config.seedOffset);
    this._generateZones(); this._generateRoads(rnd); this._generateForestZones(rnd);
    this._generateTrees(rnd); this._generateRocks(rnd); this._generateHouses(rnd); this._generateFences(rnd);
    this._generateLandmarks(); this._generateGrassDetails(rnd); this._generateProps(rnd);
    this.obstacles.sort((a,b)=>a.y-b.y);
  }

  _generateZones(){this.zones=this.config.zones.map(z=>({id:z[0],name:z[1],x:z[2],y:z[3],width:z[4],height:z[5],tint:z[6]}));}
  _road(x1,y1,x2,y2,width=72,kind='road'){this.roads.push({x1,y1,x2,y2,width,kind});}
  _generateRoads(rnd){
    if(this.mapId==='city'){
      this._road(0,2000,4000,2000,96);this._road(2000,0,2000,4000,96);this._road(950,1080,3050,1080,64);this._road(1260,2760,2850,2760,64);
      this._road(0,620,1450,620,54);this._road(2650,1540,4000,1540,54);this._road(0,3430,1400,3430,54);
    }else if(this.mapId==='hospital'){
      this._road(0,2050,4000,2050,90);this._road(2000,0,2000,4000,88);this._road(0,1500,4000,1500,58);this._road(1050,0,1050,4000,58);this._road(2900,0,2900,4000,58);this._road(0,3150,4000,3150,62);
    }else if(this.mapId==='forest'){
      this._road(0,2050,4000,2050,52,'trail');this._road(2000,0,2000,4000,48,'trail');this._road(0,3200,1550,3200,42,'trail');this._road(2550,850,4000,850,42,'trail');
    }else if(this.mapId==='military'){
      this._road(0,3350,1350,3350,70);this._road(1030,0,1030,4000,66);this._road(1030,1750,3700,1750,72);this._road(2200,450,2200,3100,58);this._road(1050,2920,3700,2920,56);
    }else{
      this._road(0,1800,4000,1800,78);this._road(1180,0,1180,4000,68);this._road(2580,0,2580,4000,68);this._road(0,900,4000,900,52);this._road(0,3000,4000,3000,58);
    }
  }

  _isOnRoad(x,y,margin=20){for(const r of this.roads){if(r.x1===r.x2){const min=Math.min(r.y1,r.y2)-margin,max=Math.max(r.y1,r.y2)+margin;if(y>=min&&y<=max&&Math.abs(x-r.x1)<r.width/2+margin)return true;}else{const min=Math.min(r.x1,r.x2)-margin,max=Math.max(r.x1,r.x2)+margin;if(x>=min&&x<=max&&Math.abs(y-r.y1)<r.width/2+margin)return true;}}return false;}
  _isReservedZone(x,y,margin=30){return this.zones.some(z=>x>=z.x-margin&&x<=z.x+z.width+margin&&y>=z.y-margin&&y<=z.y+z.height+margin);}
  _generateForestZones(rnd){
    const count=this.mapId==='forest'?13:this.mapId==='city'?7:this.mapId==='hospital'?5:this.mapId==='military'?5:3;
    for(let i=0;i<count;i++)this.forestPatches.push({x:rnd()*this.width,y:rnd()*this.height,radius:(this.mapId==='forest'?340:230)+rnd()*(this.mapId==='forest'?360:260)});
  }
  _inForestZone(x,y){return this.forestPatches.some(z=>{const dx=x-z.x,dy=y-z.y;return dx*dx+dy*dy<z.radius*z.radius;});}
  _generateTrees(rnd){
    const target=this.config.trees;let placed=0,attempts=0;
    while(placed<target&&attempts<target*24){attempts++;const x=45+rnd()*(this.width-90),y=45+rnd()*(this.height-90);if(this._isOnRoad(x,y,this.mapId==='forest'?34:58)||this._isReservedZone(x,y,this.mapId==='forest'?12:24))continue;const inForest=this._inForestZone(x,y);const chance=this.mapId==='forest'?.9:this.mapId==='industrial'?.04:.16;if(!inForest&&rnd()>chance)continue;const canopyRadius=(this.mapId==='forest'?25:22)+rnd()*18,trunkSize=20+Math.floor(rnd()*7);this.obstacles.push({type:'tree',x:x-trunkSize/2,y:y-trunkSize/2,width:trunkSize,height:trunkSize,solid:true,canopyRadius,renderX:x,renderY:y,seedColor:rnd()});placed++;}
  }
  _generateRocks(rnd){for(let i=0;i<this.config.rocks;i++){const x=40+rnd()*(this.width-80),y=40+rnd()*(this.height-80);if(this._isOnRoad(x,y,30)||this._isReservedZone(x,y,15))continue;const size=20+rnd()*26;this.obstacles.push({type:'rock',x:x-size/2,y:y-size/2,width:size,height:size,solid:true,seedColor:rnd()});}}
  _generateHouses(rnd){
    const target=this.config.houses;let placed=0,attempts=0;
    while(placed<target&&attempts<target*36){attempts++;const w=135+rnd()*95,h=95+rnd()*78,x=90+rnd()*(this.width-180-w),y=90+rnd()*(this.height-180-h);if(this._isOnRoad(x+w/2,y+h/2,80)||this._isReservedZone(x+w/2,y+h/2,70))continue;const area={x:x-34,y:y-34,width:w+68,height:h+68};if(this.obstacles.some(o=>(o.type==='house'||o.type==='landmark')&&Collision.rectsIntersect(area,o)))continue;this.obstacles.push({type:'house',x,y,width:w,height:h,solid:true,roofSeed:rnd(),style:this.mapId});placed++;}
  }
  _generateFences(rnd){for(let i=0;i<this.config.fences;i++){const sx=80+rnd()*(this.width-160),sy=80+rnd()*(this.height-160);if(this._isOnRoad(sx,sy,45)||this._isReservedZone(sx,sy,35))continue;const horizontal=rnd()>.5,segments=5+Math.floor(rnd()*8),gap=24;for(let s=0;s<segments;s++){const x=horizontal?sx+s*gap:sx,y=horizontal?sy:sy+s*gap;this.obstacles.push({type:'fence',x:x-5,y:y-5,width:10,height:10,solid:true,horizontal});}}}
  _addLandmarkObstacle(subtype,x,y,width,height,extra={}){this.obstacles.push({type:'landmark',subtype,x,y,width,height,solid:true,...extra});}
  _wall(subtype,x,y,w,h){this._addLandmarkObstacle(subtype,x,y,w,h,{wall:true});}

  _generateLandmarks(){
    const L=(s,x,y,w,h,e={})=>this._addLandmarkObstacle(s,x,y,w,h,e);
    if(this.mapId==='city'){
      L('hospital',430,420,390,235,{label:'HOSPITAL'});L('hospital_annex',520,675,205,88);
      L('police_station',1285,430,355,215,{label:'POLÍCIA'});L('police_garage',1390,675,210,85);
      L('market_building',2290,430,390,250,{label:'MERCADO'});L('market_storage',2395,705,185,85);
      L('gas_building',3220,1690,310,190,{label:'POSTO'});for(let i=0;i<3;i++)L('pump',3065+i*72,1940,24,46);
      this._wall('safe_wall',1810,1800,140,18);this._wall('safe_wall',2050,1800,140,18);this._wall('safe_wall',1810,2190,380,18);this._wall('safe_wall',1810,1800,18,408);this._wall('safe_wall',2172,1800,18,150);this._wall('safe_wall',2172,2060,18,148);
      this._wall('mil_wall',2920,2920,210,20);this._wall('mil_wall',3270,2920,500,20);this._wall('mil_wall',2920,3620,850,20);this._wall('mil_wall',2920,2920,20,720);this._wall('mil_wall',3750,2920,20,720);L('bunker',3310,3270,250,145,{label:'BUNKER'});
      L('scrap_shed',1570,3140,310,165,{label:'GALPÃO'});L('container',1940,3105,150,62);L('container',2130,3370,150,62);L('container',1840,3530,150,62);L('camp_tower',520,3070,52,52);L('camp_tower',980,3470,52,52);
    } else if(this.mapId==='hospital'){
      L('hospital',1280,930,640,430,{label:'HOSPITAL'});L('hospital',2060,930,640,430,{label:'ALA B'});L('hospital_annex',1560,1410,860,260,{label:'EMERGÊNCIA'});
      L('morgue',470,830,380,260,{label:'MORGUE'});L('clinic',570,2520,560,300,{label:'CLÍNICA'});L('pharmacy',2940,2520,430,250,{label:'FARMÁCIA'});
      L('parking_garage',3070,850,420,520,{label:'PARKING'});L('utility',1700,3230,600,180,{label:'EVAC'});
      this._wall('hospital_wall',1120,760,1740,18);this._wall('hospital_wall',1120,760,18,1000);this._wall('hospital_wall',2842,760,18,1000);this._wall('hospital_wall',1120,1742,680,18);this._wall('hospital_wall',2160,1742,700,18);
    } else if(this.mapId==='forest'){
      L('ranger_station',1810,1810,380,220,{label:'RANGER'});L('cabin',560,620,210,145,{label:'CABANA'});L('cabin',900,780,190,130);L('cabin',470,1050,220,150);L('cabin',820,3020,210,145);L('cabin',1100,3240,190,130);
      L('sawmill',2860,3000,520,270,{label:'SERRARIA'});L('lumber',2720,3370,280,72);L('lumber',3060,3400,300,72);L('ranger_tower',2050,1540,54,54);
      this._wall('wood_wall',1710,1710,240,14);this._wall('wood_wall',2050,1710,240,14);this._wall('wood_wall',1710,2290,580,14);this._wall('wood_wall',1710,1710,14,594);this._wall('wood_wall',2276,1710,14,594);
    } else if(this.mapId==='military'){
      this._wall('mil_wall',1100,520,2500,24);this._wall('mil_wall',1100,520,24,2550);this._wall('mil_wall',3576,520,24,2550);this._wall('mil_wall',1100,3046,900,24);this._wall('mil_wall',2300,3046,1300,24);
      L('barracks',1280,760,520,260,{label:'BARRACAS'});L('command',1320,1260,420,280,{label:'COMANDO'});L('hangar',2390,790,780,420,{label:'HANGAR'});L('hangar',2420,1300,720,360,{label:'HANGAR 2'});
      L('bunker',1320,2070,320,180,{label:'BUNKER A'});L('bunker',1710,2390,340,180,{label:'BUNKER B'});L('armory',2660,2050,420,250,{label:'ARSENAL'});L('tower',1128,548,64,64);L('tower',3508,548,64,64);L('tower',3508,2978,64,64);
    } else {
      L('factory',1350,520,760,500,{label:'FÁBRICA 07'});L('factory_annex',1450,1080,560,230,{label:'CALDEIRAS'});L('warehouse',500,2450,780,520,{label:'ARMAZÉM A'});L('warehouse',520,3070,760,360,{label:'ARMAZÉM B'});
      L('powerplant',2950,2550,520,540,{label:'ENERGIA'});L('warehouse',1800,2500,520,320,{label:'TERMINAL'});
      for(let r=0;r<4;r++)for(let c=0;c<4;c++)L('container',2750+c*175,520+r*150,145,64,{containerColor:(r+c)%3});
      L('tank',3150,3260,130,130);L('tank',3370,3260,130,130);L('tank',2930,3260,130,130);
      this._wall('industrial_wall',2500,300,1200,18);this._wall('industrial_wall',2500,300,18,1300);this._wall('industrial_wall',3682,300,18,1300);
    }
  }

  _generateGrassDetails(rnd){for(let i=0;i<this.config.grass;i++)this.decorations.push({x:rnd()*this.width,y:rnd()*this.height,size:2+rnd()*5,seedColor:rnd()});}
  _generateProps(rnd){
    const P=(type,x,y,e={})=>this.props.push({type,x,y,...e});
    if(this.mapId==='city'){
      P('helipad',650,825,{r:72});P('ambulance',860,570,{angle:.08});P('ambulance',850,650,{angle:-.05});P('gas_canopy',3030,1875,{width:300,height:145});P('sign',3380,1510,{text:'GAS'});P('mil_pad',3140,3220,{r:86});P('tent',600,3270);P('tent',730,3390);P('campfire',760,3300);P('safe_mark',2000,2000,{r:120});P('police_car',1710,500,{angle:.08});P('market_sign',2470,330,{text:'MERCADO'});
    }else if(this.mapId==='hospital'){
      for(let i=0;i<6;i++)P('ambulance',1170+i*115,1840,{angle:0});for(let i=0;i<10;i++)P('car',3020+(i%3)*120,1450+Math.floor(i/3)*72,{angle:0,seed:rnd()});P('helipad',2380,3480,{r:82});P('sign',1990,700,{text:'HOSPITAL'});
    }else if(this.mapId==='forest'){
      P('campfire',2000,2070);P('tent',1900,2150);P('tent',2100,2150);P('sign',1830,1650,{text:'RANGER'});for(let i=0;i<18;i++)P('lumber',2650+rnd()*900,2900+rnd()*650,{angle:rnd()*Math.PI});
    }else if(this.mapId==='military'){
      P('mil_pad',3100,2570,{r:110});P('mil_pad',3200,1900,{r:80});for(let i=0;i<5;i++)P('mil_truck',1800+i*180,1870,{angle:0});P('sign',760,3280,{text:'OMEGA'});
    }else{
      P('sign',680,420,{text:'INDÚSTRIA'});for(let i=0;i<10;i++)P('forklift',1450+rnd()*1900,1550+rnd()*1400,{angle:rnd()*Math.PI});for(let i=0;i<8;i++)P('scrap_pile',1600+rnd()*900,3150+rnd()*500,{r:28+rnd()*28});
    }
    for(let i=0;i<42;i++)P('debris',150+rnd()*(this.width-300),150+rnd()*(this.height-300),{angle:rnd()*Math.PI,size:4+rnd()*9});
    const drivable=this.roads.filter(r=>r.kind!=='trail');for(let i=0;i<(this.mapId==='forest'?4:14)&&drivable.length;i++){const r=drivable[Math.floor(rnd()*drivable.length)],vertical=r.x1===r.x2;P('car',vertical?r.x1+(rnd()-.5)*24:r.x1+rnd()*(r.x2-r.x1),vertical?r.y1+rnd()*(r.y2-r.y1):r.y1+(rnd()-.5)*24,{angle:vertical?Math.PI/2:0,seed:rnd()});}
  }

  setDynamicObstacles(obstacles){this.dynamicObstacles=Array.isArray(obstacles)?obstacles.filter(Boolean):[];}
  getAllObstacles(){return [...this.obstacles,...this.dynamicObstacles];}
  getObstaclesNear(x,y,radius){const r2=radius*radius;return this.getAllObstacles().filter(o=>{if(o.solid===false)return false;const nx=Math.max(o.x,Math.min(x,o.x+o.width)),ny=Math.max(o.y,Math.min(y,o.y+o.height)),dx=nx-x,dy=ny-y;return dx*dx+dy*dy<=r2;});}
  getZoneAt(x,y){for(const z of this.zones)if(x>=z.x&&x<=z.x+z.width&&y>=z.y&&y<=z.y+z.height)return z;return{id:'wilds',name:this.mapId==='forest'?'MATA SELVAGEM':'ZONA SELVAGEM'};}
  setTheme(theme){this.theme=theme||this.config.theme;}

  render(ctx,camera){this._renderGround(ctx,camera);this._renderZones(ctx,camera);this._renderForestTint(ctx,camera);this._renderRoads(ctx,camera);this._renderGroundMarks(ctx,camera);this._renderGrassDetails(ctx,camera);this._renderProps(ctx,camera);this._renderObstacles(ctx,camera);this._renderThemeOverlay(ctx,camera);}
  _renderGround(ctx,camera){const colors={city:'#35452d',fog:'#39423a',forest:'#263824',night:'#17201d',storm:'#333834'};ctx.fillStyle=colors[this.theme]||colors.city;ctx.fillRect(0,0,camera.viewWidth,camera.viewHeight);}
  _renderZones(ctx,camera){for(const z of this.zones){if(!camera.isRectVisible(z))continue;const s=camera.worldToScreen(z.x,z.y);ctx.save();ctx.fillStyle=z.tint;ctx.fillRect(s.x,s.y,z.width,z.height);ctx.strokeStyle='rgba(255,255,255,.06)';ctx.setLineDash([10,12]);ctx.strokeRect(s.x,s.y,z.width,z.height);ctx.restore();}}
  _renderForestTint(ctx,camera){for(const p of this.forestPatches){if(!camera.isPointVisible(p.x,p.y,p.radius))continue;const s=camera.worldToScreen(p.x,p.y),g=ctx.createRadialGradient(s.x,s.y,0,s.x,s.y,p.radius);g.addColorStop(0,this.mapId==='forest'?'rgba(18,55,25,.24)':'rgba(33,65,32,.13)');g.addColorStop(1,'rgba(25,55,28,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(s.x,s.y,p.radius,0,Math.PI*2);ctx.fill();}}
  _renderRoads(ctx,camera){for(const r of this.roads){if(!camera.isRectVisible(this._roadBounds(r)))continue;const a=camera.worldToScreen(r.x1,r.y1),b=camera.worldToScreen(r.x2,r.y2);ctx.save();ctx.lineCap='butt';ctx.lineWidth=r.width;ctx.strokeStyle=r.kind==='trail'?'#504934':this.mapId==='industrial'?'#4b4a46':'#3b3b38';ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.lineWidth=2;ctx.strokeStyle=r.kind==='trail'?'rgba(210,190,130,.18)':'rgba(215,205,175,.20)';ctx.setLineDash(r.kind==='trail'?[5,16]:[20,20]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.restore();}}
  _roadBounds(r){const minX=Math.min(r.x1,r.x2)-r.width,minY=Math.min(r.y1,r.y2)-r.width,maxX=Math.max(r.x1,r.x2)+r.width,maxY=Math.max(r.y1,r.y2)+r.width;return{x:minX,y:minY,width:maxX-minX,height:maxY-minY};}
  _renderGroundMarks(ctx,camera){for(const z of this.zones){const c=camera.worldToScreen(z.x+z.width/2,z.y+z.height/2);if(c.x<-320||c.y<-170||c.x>camera.viewWidth+320||c.y>camera.viewHeight+170)continue;ctx.save();ctx.globalAlpha=.13;ctx.fillStyle='#efe7dc';ctx.font='900 34px Segoe UI';ctx.textAlign='center';ctx.fillText(z.name,c.x,c.y);ctx.restore();}}
  _renderGrassDetails(ctx,camera){for(const t of this.decorations){if(!camera.isPointVisible(t.x,t.y,10))continue;const s=camera.worldToScreen(t.x,t.y);ctx.fillStyle=this.theme==='storm'?(t.seedColor>.5?'#54564b':'#40453c'):(t.seedColor>.5?'#4b6638':'#2d4225');ctx.fillRect(s.x,s.y,t.size,t.size);}}
  _renderProps(ctx,camera){for(const p of this.props){if(!camera.isPointVisible(p.x,p.y,140))continue;const s=camera.worldToScreen(p.x,p.y);ctx.save();ctx.translate(s.x,s.y);ctx.rotate(p.angle||0);
    if(p.type==='helipad'||p.type==='mil_pad'){ctx.strokeStyle='rgba(210,218,205,.38)';ctx.lineWidth=5;ctx.beginPath();ctx.arc(0,0,p.r,0,Math.PI*2);ctx.stroke();ctx.fillStyle='rgba(235,235,225,.24)';ctx.font='900 52px Segoe UI';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('H',0,2);}
    else if(p.type==='ambulance'){ctx.fillStyle='#d8d8d4';ctx.fillRect(-36,-15,72,30);ctx.fillStyle='#a63232';ctx.fillRect(-8,-15,16,30);ctx.fillRect(-36,-4,72,8);ctx.fillStyle='#171717';ctx.fillRect(-28,12,14,6);ctx.fillRect(15,12,14,6);}
    else if(p.type==='gas_canopy'){ctx.fillStyle='rgba(72,60,45,.65)';ctx.fillRect(-p.width/2,-p.height/2,p.width,p.height);ctx.strokeStyle='rgba(235,184,77,.45)';ctx.lineWidth=4;ctx.strokeRect(-p.width/2,-p.height/2,p.width,p.height);}
    else if(p.type==='sign'){ctx.fillStyle='#30261d';ctx.fillRect(-4,0,8,45);ctx.fillStyle='#7f2e28';ctx.fillRect(-48,-24,96,28);ctx.fillStyle='#f0d28b';ctx.font='900 13px Arial';ctx.textAlign='center';ctx.fillText(p.text||'',0,-5);}
    else if(p.type==='tent'){ctx.fillStyle='#53614a';ctx.beginPath();ctx.moveTo(-34,22);ctx.lineTo(0,-26);ctx.lineTo(34,22);ctx.closePath();ctx.fill();ctx.strokeStyle='#2c3527';ctx.stroke();}
    else if(p.type==='campfire'){ctx.fillStyle='#4a3423';ctx.fillRect(-18,-3,36,6);ctx.rotate(Math.PI/2);ctx.fillRect(-18,-3,36,6);ctx.rotate(-Math.PI/2);ctx.fillStyle='rgba(255,143,49,.72)';ctx.beginPath();ctx.arc(0,-7,10,0,Math.PI*2);ctx.fill();}
    else if(p.type==='safe_mark'){ctx.strokeStyle='rgba(114,198,124,.28)';ctx.lineWidth=5;ctx.beginPath();ctx.arc(0,0,p.r,0,Math.PI*2);ctx.stroke();}
    else if(p.type==='police_car'){ctx.fillStyle='#c7c9c9';ctx.fillRect(-32,-15,64,30);ctx.fillStyle='#28394a';ctx.fillRect(-16,-12,30,24);ctx.fillStyle='#315d8f';ctx.fillRect(-7,-18,7,5);ctx.fillStyle='#b73737';ctx.fillRect(1,-18,7,5);}
    else if(p.type==='mil_truck'){ctx.fillStyle='#4b5945';ctx.fillRect(-38,-17,76,34);ctx.fillStyle='#242a23';ctx.fillRect(-8,-14,25,28);}
    else if(p.type==='forklift'){ctx.fillStyle='#b6922f';ctx.fillRect(-18,-14,36,28);ctx.strokeStyle='#322b20';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(18,-12);ctx.lineTo(32,-12);ctx.moveTo(18,9);ctx.lineTo(34,9);ctx.stroke();}
    else if(p.type==='lumber'){ctx.fillStyle='#765b3c';ctx.fillRect(-36,-5,72,10);ctx.strokeStyle='#3f2e20';ctx.strokeRect(-36,-5,72,10);}
    else if(p.type==='scrap_pile'){ctx.fillStyle='rgba(69,61,54,.8)';for(let k=0;k<7;k++){ctx.save();ctx.rotate(k*.7);ctx.fillRect(-p.r*.65,-3,p.r*1.3,6);ctx.restore();}}
    else if(p.type==='debris'){ctx.fillStyle='rgba(38,34,30,.55)';ctx.fillRect(-p.size/2,-2,p.size,4);}
    else if(p.type==='car'){ctx.fillStyle=p.seed>.5?'#5b5e5c':'#5e4037';ctx.fillRect(-31,-15,62,30);ctx.fillStyle='rgba(25,29,30,.8)';ctx.fillRect(-15,-12,28,24);ctx.fillStyle='#141414';ctx.fillRect(-25,12,12,5);ctx.fillRect(14,12,12,5);}
    ctx.restore();}}
  _renderObstacles(ctx,camera){for(const o of this.obstacles){const b={x:o.x-48,y:o.y-48,width:o.width+96,height:o.height+96};if(!camera.isRectVisible(b))continue;if(o.type==='tree')this._renderTree(ctx,camera,o);else if(o.type==='rock')this._renderRock(ctx,camera,o);else if(o.type==='house')this._renderHouse(ctx,camera,o);else if(o.type==='fence')this._renderFence(ctx,camera,o);else if(o.type==='landmark')this._renderLandmark(ctx,camera,o);}}
  _renderTree(ctx,camera,o){const s=camera.worldToScreen(o.renderX??o.x+o.width/2,o.renderY??o.y+o.height/2),r=o.canopyRadius||28,t=camera.worldToScreen(o.x,o.y);ctx.fillStyle='rgba(0,0,0,.26)';ctx.beginPath();ctx.ellipse(s.x,s.y+7,r*.75,r*.30,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#49321f';ctx.fillRect(t.x,t.y,o.width,o.height);ctx.fillStyle=o.seedColor>.5?(this.mapId==='forest'?'#1f4d25':'#2d5a2c'):(this.mapId==='forest'?'#183d20':'#274c27');ctx.beginPath();ctx.arc(s.x,s.y-r*.48,r,0,Math.PI*2);ctx.fill();}
  _renderRock(ctx,camera,o){const s=camera.worldToScreen(o.x,o.y);ctx.fillStyle='rgba(0,0,0,.25)';ctx.beginPath();ctx.ellipse(s.x+o.width/2,s.y+o.height*.8,o.width*.5,o.height*.2,0,0,Math.PI*2);ctx.fill();ctx.fillStyle=o.seedColor>.5?'#666762':'#53514c';ctx.beginPath();ctx.ellipse(s.x+o.width/2,s.y+o.height/2,o.width/2,o.height/2,0,0,Math.PI*2);ctx.fill();}
  _renderHouse(ctx,camera,o){const s=camera.worldToScreen(o.x,o.y);ctx.fillStyle='rgba(0,0,0,.30)';ctx.fillRect(s.x+7,s.y+7,o.width,o.height);const palettes={city:['#57483b','#493f37'],hospital:['#5a5f5d','#4e5553'],forest:['#56452f','#463926'],military:['#515a4c','#41493e'],industrial:['#5b5148','#49443e']},p=palettes[this.mapId]||palettes.city;ctx.fillStyle=o.roofSeed>.5?p[0]:p[1];ctx.fillRect(s.x,s.y,o.width,o.height);ctx.fillStyle='rgba(24,23,21,.9)';ctx.fillRect(s.x-4,s.y-13,o.width+8,16);ctx.fillStyle='rgba(126,154,144,.28)';ctx.fillRect(s.x+14,s.y+18,20,18);ctx.fillRect(s.x+o.width-34,s.y+18,20,18);}
  _renderFence(ctx,camera,o){const s=camera.worldToScreen(o.x,o.y);ctx.fillStyle=this.mapId==='military'?'#62685e':'#75583b';ctx.fillRect(s.x,s.y,o.width,o.height);}
  _renderLandmark(ctx,camera,o){const s=camera.worldToScreen(o.x,o.y),st=o.subtype||'';
    if(o.wall||st.includes('wall')){ctx.fillStyle=st.includes('mil')?'#485044':st.includes('hospital')?'#646b68':st.includes('industrial')?'#56514b':'#5a5a51';ctx.fillRect(s.x,s.y,o.width,o.height);ctx.fillStyle='rgba(255,255,255,.08)';ctx.fillRect(s.x,s.y,o.width,Math.min(3,o.height));return;}
    if(st==='pump'){ctx.fillStyle='#7d2d28';ctx.fillRect(s.x,s.y,o.width,o.height);ctx.fillStyle='#d7c6a7';ctx.fillRect(s.x+5,s.y+6,o.width-10,12);return;}
    if(st==='container'){const colors=['#6a4b36','#4b5962','#596647'];ctx.fillStyle=colors[o.containerColor||0]||colors[0];ctx.fillRect(s.x,s.y,o.width,o.height);ctx.strokeStyle='#292622';ctx.strokeRect(s.x,s.y,o.width,o.height);for(let k=1;k<5;k++){ctx.beginPath();ctx.moveTo(s.x+k*o.width/5,s.y);ctx.lineTo(s.x+k*o.width/5,s.y+o.height);ctx.stroke();}return;}
    if(st==='tank'){ctx.fillStyle='#676a64';ctx.beginPath();ctx.ellipse(s.x+o.width/2,s.y+o.height/2,o.width/2,o.height/2,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#333';ctx.stroke();return;}
    const hospital=/hospital|morgue|clinic|pharmacy/.test(st),mil=/bunker|barracks|command|hangar|armory|tower/.test(st),forest=/ranger|cabin|sawmill|lumber/.test(st),industrial=/factory|warehouse|powerplant|utility|parking/.test(st),police=/police/.test(st),market=/market/.test(st);
    ctx.fillStyle=hospital?'#596360':mil?'#4a5447':forest?'#5d4b36':industrial?'#57534d':police?'#4c5962':market?'#665443':'#554b42';ctx.fillRect(s.x,s.y,o.width,o.height);ctx.fillStyle='rgba(0,0,0,.35)';ctx.fillRect(s.x,s.y,o.width,16);ctx.strokeStyle='rgba(255,255,255,.10)';ctx.strokeRect(s.x,s.y,o.width,o.height);
    if(o.label){ctx.fillStyle='rgba(235,232,220,.75)';ctx.font=`900 ${Math.max(11,Math.min(24,o.width/12))}px Arial`;ctx.textAlign='center';ctx.fillText(o.label,s.x+o.width/2,s.y+Math.min(48,o.height/3));}
    if(hospital&&st==='hospital'){ctx.fillStyle='#d8d5cf';ctx.fillRect(s.x+o.width/2-8,s.y+70,16,46);ctx.fillRect(s.x+o.width/2-23,s.y+85,46,16);}
  }
  _renderThemeOverlay(ctx,camera){
    if(this.theme==='night'){ctx.save();ctx.fillStyle='rgba(3,7,12,.44)';ctx.fillRect(0,0,camera.viewWidth,camera.viewHeight);const g=ctx.createRadialGradient(camera.viewWidth/2,camera.viewHeight/2,70,camera.viewWidth/2,camera.viewHeight/2,Math.max(camera.viewWidth,camera.viewHeight)*.70);g.addColorStop(0,'rgba(36,58,65,0)');g.addColorStop(1,'rgba(0,0,0,.58)');ctx.fillStyle=g;ctx.fillRect(0,0,camera.viewWidth,camera.viewHeight);ctx.restore();}
    else if(this.theme==='fog'){ctx.save();ctx.fillStyle='rgba(215,224,218,.08)';ctx.fillRect(0,0,camera.viewWidth,camera.viewHeight);const t=performance.now()*.010;for(let i=0;i<7;i++){const x=((t+i*245)%(camera.viewWidth+440))-220,y=(i*131)%Math.max(1,camera.viewHeight);const g=ctx.createRadialGradient(x,y,0,x,y,205);g.addColorStop(0,'rgba(230,235,228,.085)');g.addColorStop(1,'rgba(230,235,228,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,205,0,Math.PI*2);ctx.fill();}ctx.restore();}
    else if(this.theme==='forest'){ctx.save();const g=ctx.createRadialGradient(camera.viewWidth/2,camera.viewHeight/2,80,camera.viewWidth/2,camera.viewHeight/2,Math.max(camera.viewWidth,camera.viewHeight)*.72);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,'rgba(4,15,7,.42)');ctx.fillStyle=g;ctx.fillRect(0,0,camera.viewWidth,camera.viewHeight);ctx.restore();}
    else if(this.theme==='storm'){ctx.save();ctx.fillStyle='rgba(18,24,26,.20)';ctx.fillRect(0,0,camera.viewWidth,camera.viewHeight);const t=performance.now();if((Math.floor(t/5500)%9)===0&&t%5500<90){ctx.fillStyle='rgba(215,230,235,.16)';ctx.fillRect(0,0,camera.viewWidth,camera.viewHeight);}ctx.restore();}
  }
}

window.GAME_MAP_CATALOG=GAME_MAP_CATALOG;
