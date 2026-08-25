class InteractionManager {
  constructor(){this.items=new Map();}
  clear(){this.items.clear();}
  applySnapshot(items){this.items.clear();for(const i of Array.isArray(items)?items:[])this.add(i);}
  add(item){if(!item?.id)return;this.items.set(String(item.id),{...item,state:{...(item.state||{})}});}
  update(item){if(!item?.id)return;const cur=this.items.get(String(item.id));this.items.set(String(item.id),{...(cur||{}),...item,state:{...(cur?.state||{}),...(item.state||{})}});}

  _isBlocking(i){if(i.type==='door'||i.type==='gate')return i.state?.open!==true;if(i.type==='barricade')return i.state?.repaired===true;return false;}
  getBlockingObstacles(){const out=[];for(const i of this.items.values())if(this._isBlocking(i))out.push({type:'interaction',subtype:i.type,interactionId:i.id,x:Number(i.x),y:Number(i.y),width:Number(i.width),height:Number(i.height),solid:true});return out;}

  nearest(x,y,maxDistance=100){let best=null,bestD=maxDistance;for(const i of this.items.values()){if(i.type==='crate'&&i.state?.opened)continue;if(i.type==='generator'&&i.state?.on)continue;const cx=Number(i.x)+Number(i.width)/2,cy=Number(i.y)+Number(i.height)/2,d=Math.hypot(cx-x,cy-y);if(d<=bestD){bestD=d;best=i;}}return best?{item:best,distance:bestD}:null;}

  promptFor(i){
    if(!i)return'';
    if(i.type==='door')return i.state?.open?'FECHAR PORTA':'ABRIR PORTA';
    if(i.type==='gate')return i.state?.unlocked?(i.state?.open?'FECHAR PORTÃO':'ABRIR PORTÃO'):`LIBERAR ÁREA · $${i.cost||0}`;
    if(i.type==='barricade')return i.state?.repaired?'DESMONTAR BARRICADA':`REPARAR BARRICADA · $${i.cost||0}`;
    if(i.type==='generator')return i.state?.on?'GERADOR ATIVO':'LIGAR GERADOR';
    if(i.type==='crate')return i.state?.opened?'CAIXA VAZIA':'QUEBRAR / VASCULHAR CAIXA';
    return i.label||'INTERAGIR';
  }

  isGeneratorOn(){return [...this.items.values()].some(i=>i.type==='generator'&&i.state?.on);}

  render(ctx,camera){
    for(const i of this.items.values()){
      if(!camera.isRectVisible({x:i.x-50,y:i.y-50,width:i.width+100,height:i.height+100}))continue;
      const s=camera.worldToScreen(i.x,i.y),cx=s.x+i.width/2,cy=s.y+i.height/2;
      ctx.save();
      if(i.type==='door'){
        ctx.fillStyle=i.state?.open?'rgba(115,190,120,.35)':'#6b4c32';
        if(i.state?.open){ctx.translate(cx,cy);ctx.rotate(-Math.PI/2);ctx.fillRect(-i.width/2,-i.height/2,i.width,i.height);}else ctx.fillRect(s.x,s.y,i.width,i.height);
      }else if(i.type==='gate'){
        ctx.strokeStyle=i.state?.unlocked?'#78c97d':'#bb8b3b';ctx.lineWidth=5;ctx.setLineDash([12,8]);ctx.beginPath();ctx.moveTo(s.x,s.y+i.height/2);ctx.lineTo(s.x+i.width,s.y+i.height/2);ctx.stroke();ctx.setLineDash([]);
        if(!i.state?.unlocked){ctx.fillStyle='#d9ac53';ctx.font='900 14px Arial';ctx.textAlign='center';ctx.fillText('🔒',cx,cy-8);}
      }else if(i.type==='barricade'){
        if(i.state?.repaired){ctx.strokeStyle='#8b6741';ctx.lineWidth=7;for(let k=0;k<3;k++){ctx.beginPath();ctx.moveTo(s.x, s.y+4+k*7);ctx.lineTo(s.x+i.width,s.y+i.height-4-k*7);ctx.stroke();}}
        else{ctx.strokeStyle='rgba(120,90,62,.45)';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(s.x,cy);ctx.lineTo(s.x+i.width*.35,cy+5);ctx.stroke();}
      }else if(i.type==='generator'){
        const on=i.state?.on;ctx.fillStyle=on?'#506e43':'#4a4943';ctx.fillRect(s.x,s.y,i.width,i.height);ctx.strokeStyle=on?'#8dff78':'#777';ctx.strokeRect(s.x,s.y,i.width,i.height);ctx.fillStyle=on?'#8dff78':'#be4848';ctx.beginPath();ctx.arc(s.x+i.width-8,s.y+8,4,0,Math.PI*2);ctx.fill();if(on){ctx.globalCompositeOperation='lighter';const g=ctx.createRadialGradient(cx,cy,0,cx,cy,100);g.addColorStop(0,'rgba(124,255,112,.12)');g.addColorStop(1,'rgba(124,255,112,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,cy,100,0,Math.PI*2);ctx.fill();}
      }else if(i.type==='crate'){
        if(i.state?.opened)ctx.globalAlpha=.45;ctx.fillStyle=i.id.includes('military')?'#44513f':i.id.includes('hospital')?'#ddd8cc':'#705537';ctx.fillRect(s.x,s.y,i.width,i.height);ctx.strokeStyle='#28251f';ctx.strokeRect(s.x,s.y,i.width,i.height);ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(s.x+i.width,s.y+i.height);ctx.moveTo(s.x+i.width,s.y);ctx.lineTo(s.x,s.y+i.height);ctx.stroke();
      }
      ctx.restore();
    }
  }
}
