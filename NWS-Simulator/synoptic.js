'use strict';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),sq=x=>x*x;
function jetY(w,x){const t=w.minutes;return 380+(200+w.config.forcing*1100)*Math.sin((x-t*.45)/700)+130*Math.sin(x/1600+t/2100);}
function jet(w,x,y){const slope=(jetY(w,x+10)-jetY(w,x-10))/20,axis=jetY(w,x),speed=(28+w.config.shear*.7)*(1+.22*Math.sin(x/850-w.minutes/700))*Math.exp(-sq((y-axis)/300));return {u:speed/Math.sqrt(1+slope*slope),v:speed*slope/Math.sqrt(1+slope*slope),speed,axis};}
function step(w,dt){
 for(const s of w.pressureSystems){
  s.age+=dt;const upper=jet(w,s.x,s.y),support=Math.exp(-sq((s.y-jetY(w,s.x))/550))*w.config.forcing;
  s.x+=(7+upper.u*.25)*dt*.06;s.y+=upper.v*.14*dt*.06;
  const mature=Math.max(0,1-s.age/3600),target=s.kind==='L'?1014-36*support*mature*(w.config.contrast/15):1016+15*mature;
  s.pressure+=(target-s.pressure)*(1-Math.exp(-dt/600));
  s.history=s.history||[];s.history.push({minute:w.minutes,pressure:s.pressure});s.history=s.history.filter(h=>h.minute>=w.minutes-1445);s.drop24=s.history.length&&w.minutes-s.history[0].minute>=1440?s.history[0].pressure-s.pressure:null;
 }
 w.pressureSystems=w.pressureSystems.filter(s=>s.age<4320&&s.x<w.halfX+400);
 const cycle=Math.floor(w.minutes/720);
 if(cycle>w.synopticCycle&&w.config.forcing>.1&&w.config.contrast>3){w.synopticCycle=cycle;const x=-2200+(cycle%3)*550,y=jetY(w,x)-160;w.pressureSystems.push({id:w.nextPressureId++,kind:'L',x,y,pressure:1012,age:0});w.pressureSystems.push({id:w.nextPressureId++,kind:'H',x:x-650,y:y+300,pressure:1021,age:0});w.record('Evolving upper wave supports a new surface low and following high (hPa).');}
}
function contribution(w,x,y){let pressure=0,u=0,v=0,lift=0;
 for(const s of w.pressureSystems){const dx=x-s.x,dy=y-s.y,r=Math.hypot(dx,dy),shape=Math.exp(-sq(dx/350)-sq(dy/300));pressure+=(s.pressure-1018)*shape;const speed=Math.min(38,Math.abs(1018-s.pressure)*.8)*Math.min(r/130,130/Math.max(1,r)),sign=s.kind==='L'?1:-1;u+=(-sign*dy-.12*sign*dx)/Math.max(1,r)*speed;v+=(sign*dx-.12*sign*dy)/Math.max(1,r)*speed;if(s.kind==='L')lift+=w.config.forcing*.55*Math.exp(-sq((dx-35-dy*.28)/60)-sq(dy/400));}
 return {pressure,u,v,lift};
}
module.exports={jetY,jet,step,contribution};
