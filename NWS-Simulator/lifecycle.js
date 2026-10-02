'use strict';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// Independent density currents: km, minutes, m/s, K. Parameterized, not CFD.
function stepPools(w,dt){
 for(const p of w.coldPools){
  p.age+=dt;p.deficit*=Math.exp(-dt/150);
  p.speed=Math.sqrt(2*9.81*p.depth*p.deficit/300);
  p.radius+=p.speed*dt*.06;p.x+=p.u*dt*.06;p.y+=p.v*dt*.06;
 }
 w.coldPools=w.coldPools.filter(p=>p.deficit>.15&&p.age<360&&p.radius<230).slice(-80);
}
function outflowAt(w,x,y){
 let lift=0,cooling=0,u=0,v=0,fine=0,parent=null,best=0,hits=0;
 for(const p of w.coldPools){
  const dx=x-p.x,dy=y-p.y,r=Math.hypot(dx,dy),edge=Math.exp(-(((r-p.radius)/10)**2));
  if(r>p.radius+35)continue;
  const interior=clamp((p.radius-r)/12,0,1)*p.deficit;
  cooling=Math.max(cooling,interior);
  const push=p.speed*edge;lift+=push*.065;if(edge>.45)hits++;
  u+=dx/Math.max(r,1)*push;v+=dy/Math.max(r,1)*push;
  fine=Math.max(fine,push);if(push>best){best=push;parent=p.id;}
 }
 return {lift:Math.min(3,lift*(hits>1?1.3:1)),cooling,u,v,fine,parent};
}
function feedPool(w,s,dt){
 if(s.rain<.12||s.outflow<3)return;
 let p=w.coldPools.find(p=>p.source===s.id&&p.age<75);
 if(!p){p={id:w.nextPoolId++,source:s.id,x:s.x,y:s.y,radius:Math.max(8,s.radius*.7),age:0,deficit:.4,depth:600,speed:0,u:s.u*.12,v:s.v*.12};w.coldPools.push(p);w.record(`Cell ${s.id} produced outflow boundary ${p.id}; it can persist after the rain fades.`);}
 p.deficit=clamp(p.deficit+s.rain*(1+(s.stage==='Dissipating'?1:0))*dt*.025,0,8);
}
function groups(cells){
 const left=new Set(cells.filter(c=>c.rain>.18)),result=[];
 while(left.size){const seed=left.values().next().value,group=[seed];left.delete(seed);
  for(let i=0;i<group.length;i++)for(const c of left)if(Math.hypot(c.x-group[i].x,c.y-group[i].y)<75){group.push(c);left.delete(c);}
  const x=group.reduce((v,c)=>v+c.x,0)/group.length,y=group.reduce((v,c)=>v+c.y,0)/group.length;
  let xx=0,yy=0,xy=0;for(const c of group){xx+=(c.x-x)**2;yy+=(c.y-y)**2;xy+=(c.x-x)*(c.y-y);}
  const angle=.5*Math.atan2(2*xy,xx-yy),a=group.map(c=>(c.x-x)*Math.cos(angle)+(c.y-y)*Math.sin(angle)),b=group.map(c=>-(c.x-x)*Math.sin(angle)+(c.y-y)*Math.cos(angle));
  const length=Math.max(...a)-Math.min(...a)+30,width=Math.max(...b)-Math.min(...b)+30;
  result.push({cells:group,x,y,length,width,linear:group.length>=4&&length>120&&length/width>2.5});
 }return result;
}
function trackSystems(w,dt){
 const previous=w.systems,claimed=new Set();w.systems=groups(w.cells).map(g=>{
  const ids=new Set(g.cells.map(c=>c.id));let old=previous.filter(p=>!claimed.has(p.id)).sort((a,b)=>b.members.filter(id=>ids.has(id)).length-a.members.filter(id=>ids.has(id)).length)[0];
  if(old&&!old.members.some(id=>ids.has(id)))old=null;if(old)claimed.add(old.id);
  const duration=(old?.duration||0)+dt,organized=g.cells.length>=5&&g.length>=100;
  const matureTime=organized?(old?.matureTime||0)+dt:0;
  const rotation=g.cells.filter(c=>c.rotation>.5&&c.rotatingMinutes>=30).length;
  const mode=g.linear?'Squall line / QLCS':rotation?(g.cells.length>1?'Supercell / multicell complex':'Supercell'):g.cells.length>1?'Multicell cluster':rotation?'Supercell':g.cells[0].rotation>.5&&g.cells[0].rotatingMinutes>=30?'Supercell':'Single-cell / pulse convection';
  const path=(old?.path||0)+(old?Math.hypot(g.x-old.x,g.y-old.y):0),severe=g.cells.some(c=>c.outflow>=25.9);
  return {...g,cells:undefined,id:old?.id||w.nextSystemId++,members:g.cells.map(c=>c.id),duration,matureTime,path,severeMinutes:(old?.severeMinutes||0)+(severe?dt:0),mode:(matureTime>=120?'MCS · ':'')+mode};
 });
 for(const old of previous)if(!w.systems.some(s=>s.id===old.id)&&old.matureTime>=120&&!w.cells.some(c=>old.members.includes(c.id)&&c.rain>.18)){
  w.remnants.push({x:old.x,y:old.y,age:0,strength:clamp(old.matureTime/360,0,.8),u:8,v:3});
  w.record('Organized convection decayed; a weak mesoscale circulation remnant remains.');
 }
 for(const r of w.remnants){r.age+=dt;r.x+=r.u*dt*.06;r.y+=r.v*dt*.06;r.strength*=Math.exp(-dt/300);}
 w.remnants=w.remnants.filter(r=>r.age<720&&r.strength>.04).slice(-8);
}
module.exports={stepPools,outflowAt,feedPool,groups,trackSystems};
