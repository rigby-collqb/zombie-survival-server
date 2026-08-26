const fs = require('fs');
const path = require('path');
const vm = require('vm');

const Collision = {
  rectsIntersect(a,b){return a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;}
};

const mapPath = path.join(__dirname, '..', 'js', 'map.js');
const code = fs.readFileSync(mapPath, 'utf8') + '\nthis.GameMap = GameMap; this.GAME_MAP_CATALOG = GAME_MAP_CATALOG;';
const context = { console, Math, Collision, performance:{now:()=>0}, window:{} };
vm.createContext(context);
vm.runInContext(code, context, { filename: mapPath });

const WORLD_WIDTH=4000, WORLD_HEIGHT=4000, MAP_SEED=20260823;
const outDir=path.join(__dirname,'..','database','maps');
fs.mkdirSync(outDir,{recursive:true});
const round2=n=>Math.round(Number(n)*100)/100;

for(const [id,meta] of Object.entries(context.GAME_MAP_CATALOG)){
  const map=new context.GameMap(WORLD_WIDTH,WORLD_HEIGHT,MAP_SEED,id);
  const obstacles=map.obstacles.filter(o=>o.solid!==false).map(o=>({
    type:o.type, subtype:o.subtype||undefined,
    x:round2(o.x), y:round2(o.y), width:round2(o.width), height:round2(o.height)
  }));
  const out={id,name:meta.name,description:meta.description,theme:meta.theme,seed:MAP_SEED+meta.seedOffset,width:WORLD_WIDTH,height:WORLD_HEIGHT,spawn:map.spawn,obstacles};
  const target=path.join(outDir,`${id}.json`);
  fs.writeFileSync(target,JSON.stringify(out));
  console.log(`${id}: ${obstacles.length} obstacles -> ${target}`);
}
