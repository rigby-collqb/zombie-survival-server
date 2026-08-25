const fs = require('fs');
const path = require('path');
const vm = require('vm');

const Collision = {
  rectsIntersect(a,b){return a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;}
};

const mapPath = path.join(__dirname, '..', 'js', 'map.js');
const code = fs.readFileSync(mapPath, 'utf8') + '\nthis.GameMap = GameMap;';
const context = { console, Math, Collision };
vm.createContext(context);
vm.runInContext(code, context, { filename: mapPath });

const WORLD_WIDTH=4000, WORLD_HEIGHT=4000, MAP_SEED=20260823;
const map = new context.GameMap(WORLD_WIDTH, WORLD_HEIGHT, MAP_SEED);
const round2 = n => Math.round(Number(n) * 100) / 100;
const obstacles = map.obstacles.filter(o=>o.solid!==false).map(o=>({
  type:o.type,
  subtype:o.subtype || undefined,
  x:round2(o.x), y:round2(o.y), width:round2(o.width), height:round2(o.height)
}));
const out = { seed:MAP_SEED,width:WORLD_WIDTH,height:WORLD_HEIGHT,obstacles };
const dbPath = path.join(__dirname, '..', 'database', 'world_obstacles.json');
fs.writeFileSync(dbPath, JSON.stringify(out));
console.log('Exported', obstacles.length, 'obstacles to', dbPath);
console.log('By type:', obstacles.reduce((a,o)=>{const k=o.subtype?`${o.type}:${o.subtype}`:o.type;a[k]=(a[k]||0)+1;return a;},{}));
