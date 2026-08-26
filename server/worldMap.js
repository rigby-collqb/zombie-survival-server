const fs = require('fs');
const path = require('path');

const MAP_IDS = Object.freeze(['city','hospital','forest','military','industrial']);
const cache = new Map();

function loadMapData(mapId='city') {
  const id = MAP_IDS.includes(mapId) ? mapId : 'city';
  if (cache.has(id)) return cache.get(id);
  try {
    const raw = fs.readFileSync(path.join(__dirname,'data','maps',`${id}.json`),'utf8');
    const parsed = JSON.parse(raw);
    const data = {
      id,
      name: parsed.name || id,
      description: parsed.description || '',
      theme: parsed.theme || 'city',
      width: Number(parsed.width) || 4000,
      height: Number(parsed.height) || 4000,
      spawn: parsed.spawn || {x:2000,y:2000,radius:150},
      obstacles: Array.isArray(parsed.obstacles) ? parsed.obstacles.filter(o=>o&&Number.isFinite(Number(o.x))&&Number.isFinite(Number(o.y))) : [],
    };
    cache.set(id,data);
    return data;
  } catch (err) {
    if (id !== 'city') return loadMapData('city');
    console.error('[worldMap] Falha ao carregar mapa:', err.message);
    const fallback={id:'city',name:'Cidade Abandonada',description:'',theme:'city',width:4000,height:4000,spawn:{x:2000,y:2000,radius:150},obstacles:[]};
    cache.set('city',fallback);return fallback;
  }
}

class WorldMap {
  constructor(mapId='city') {
    const data=loadMapData(mapId);
    this.id=data.id;this.name=data.name;this.description=data.description;this.theme=data.theme;
    this.width=data.width;this.height=data.height;this.spawn={...data.spawn};
    this.obstacles=data.obstacles;this.dynamicObstacles=[];
  }
  getObstacles(){return this.dynamicObstacles.length?[...this.obstacles,...this.dynamicObstacles]:this.obstacles;}
  setDynamicObstacles(items){this.dynamicObstacles=Array.isArray(items)?items.filter(Boolean):[];}
  getSpawn(){return {...this.spawn};}
  rectsIntersect(a,b){return a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;}
  circleHitsAnyObstacle(cx,cy,radius){for(const o of this.getObstacles()){const rx=o.x-radius,ry=o.y-radius,rw=o.width+radius*2,rh=o.height+radius*2;if(cx>=rx&&cx<=rx+rw&&cy>=ry&&cy<=ry+rh)return true;}return false;}
  resolveCircleMovement(x,y,nextX,nextY,radius){
    const d=radius*2,rectAt=(px,py)=>({x:px-radius,y:py-radius,width:d,height:d}),all=this.getObstacles();
    const hits=rect=>{for(const o of all)if(this.rectsIntersect(rect,o))return true;return false;};
    let rx=x;if(!hits(rectAt(nextX,y)))rx=nextX;let ry=y;if(!hits(rectAt(rx,nextY)))ry=nextY;return{x:rx,y:ry};
  }
  raycastDistanceToObstacle(ox,oy,dx,dy,maxDistance){const step=7,all=this.getObstacles();for(let t=0;t<=maxDistance;t+=step){const px=ox+dx*t,py=oy+dy*t;for(const o of all)if(px>=o.x&&px<=o.x+o.width&&py>=o.y&&py<=o.y+o.height)return t;}return null;}
  pointDistanceToRay(px,py,ox,oy,dx,dy,maxDistance){const vx=px-ox,vy=py-oy;let t=vx*dx+vy*dy;t=Math.max(0,Math.min(maxDistance,t));const cx=ox+dx*t,cy=oy+dy*t;return{distanceAlongRay:t,distanceFromRay:Math.hypot(px-cx,py-cy)};}
}

function create(mapId){return new WorldMap(mapId);}
function catalog(){return MAP_IDS.map(id=>{const d=loadMapData(id);return{id:d.id,name:d.name,description:d.description,theme:d.theme,spawn:d.spawn,obstacles:d.obstacles.length};});}

module.exports={create,catalog,MAP_IDS,WorldMap};
