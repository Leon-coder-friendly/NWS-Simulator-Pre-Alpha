'use strict';
const {outflowAt}=require('./lifecycle');
const sq=x=>x*x,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const gauss=(x,y,a,b)=>Math.abs(x)>a*3||Math.abs(y)>b*3?0:Math.exp(-sq(x/a)-sq(y/b));
function hash(x,y,seed=0){let h=Math.imul(x|0,374761393)^Math.imul(y|0,668265263)^Math.imul(seed|0,1274126177);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967295;}
function noise(x,y,seed=0){const i=Math.floor(x),j=Math.floor(y);let a=x-i,b=y-j;a=a*a*(3-2*a);b=b*b*(3-2*b);return hash(i,j,seed)*(1-a)*(1-b)+hash(i+1,j,seed)*a*(1-b)+hash(i,j+1,seed)*(1-a)*b+hash(i+1,j+1,seed)*a*b;}
function hydrometeors(w,x,y,z=0){
  const n=w.node(x,y);if(!n)return null;
  const e=w.interpolatedEnvironment(x,y),d=n.diagnostic;
  let rain=0,hailZ=0,ice=0,top=0,du=0,dv=0,rotation=0,turbulence=.5,motionU=0,motionV=0,weight=0;
  // Saturated synoptic ascent can produce stratiform precipitation without CAPE.
  const saturation=clamp((e.dewpoint-e.temp+12)/10,0,1)*clamp((w.config.humidity-.5)/.4,0,1);
  const lift=e.forcing+e.trough*.55;
  const stratus=clamp((lift-.08)*saturation*9,0,9);
  if(stratus>.1){top=5+lift*3;rain+=stratus*clamp((top-z)/1.5,0,1);}
  const low=w.low,rLow=Math.hypot(x-low.x,y-low.y),theta=Math.atan2(y-low.y,x-low.x);
  if(w.config.contrast>5){
    const head=clamp((1010-low.pressure)/15,0,2)*w.config.humidity*5*Math.exp(-sq((rLow-140)/90))*(.4+.6*Math.max(0,Math.sin(theta)));
    const dry=1-.85*gauss(x-low.x-55,y-low.y+40,95,70);
    rain+=head*dry*clamp((7-z)/2,0,1);if(head>.15)top=Math.max(top,7);
  }
  for(const s of w.cells){
    let xx=x-s.x,yy=y-s.y;if(Math.abs(xx)>130||Math.abs(yy)>130||s.rain<.025)continue;
    // Storm-relative axes rotate with the actual modeled propagation vector.
    const angle=Math.atan2(s.v,s.u),cs=Math.cos(angle),sn=Math.sin(angle);
    const a=xx*cs+yy*sn,b=-xx*sn+yy*cs;
    const r=s.radius,rot=s.rotation;
    const coherent=.6+noise(a/12,b/12,s.id)*.8;
    const notch=1-.88*rot*gauss(a-6,b+9,10,8);
    const body=gauss(a-8,b-8,r*1.1,r*.8)*notch;
    const core=gauss(a-2,b-5,r*.42,r*.4);
    const anvil=gauss(a-20,b-16,r*1.9,r*1.1);
    let water=s.rain*(45*body+9*anvil)*coherent;
    // A tapered rear-flank precipitation ribbon wraps around the mesocyclone.
    // The open end and varying radius prevent a symmetric bullseye/ring.
    const hx=a+10,hy=b+8,rr=Math.hypot(hx,hy),az=Math.atan2(hy,hx);
    const wrapped=(az+Math.PI*2)%(Math.PI*2);
    const arcWindow=clamp((wrapped-.45)/.5,0,1)*clamp((5.95-wrapped)/.55,0,1);
    const targetR=8+wrapped*1.25+noise(a/8,b/8,s.id)*2;
    const ribbon=Math.exp(-sq((rr-targetR)/(2.4+rot)))*arcWindow;
    water+=s.rain*rot*35*ribbon;
    const falloff=clamp((s.top-z)/2.5,0,1);
    water*=falloff;
    const h=s.hail*core*falloff;
    rain+=water;hailZ+=h*2.5e6;
    if(water>.15||h>.03)top=Math.max(top,s.top);
    const speed=rot*s.strength*25*(rr/7)*Math.exp(1-rr/7)*Math.exp(-Math.max(0,z-6)/3);
    const ur=-hy/Math.max(rr,1)*speed,vr=hx/Math.max(rr,1)*speed;
    du+=ur*cs-vr*sn;dv+=ur*sn+vr*cs;rotation=Math.max(rotation,Math.abs(speed)/7);
    const dist=Math.hypot(xx,yy),out=s.outflow*Math.exp(-sq((dist-r*.9)/(r*.8)))*Math.exp(-z/1.8);
    du+=xx/Math.max(dist,1)*out;dv+=yy/Math.max(dist,1)*out;
    const rearInflow=s.outflow*.35*gauss(a+18,b,30,15)*Math.exp(-sq((z-1.5)/2));
    du+=rearInflow*cs;dv+=rearInflow*sn;
    turbulence=Math.max(turbulence,1+rot*5*gauss(hx,hy,12,12)+out*.1);
    motionU+=s.u*water;motionV+=s.v*water;weight+=water;
  }
  for(const p of w.puffs){
    if(Math.abs(x-p.x)>p.rx*2.5||Math.abs(y-p.y)>p.ry*2.5)continue;
    const amount=p.mass*2.8*gauss(x-p.x,y-p.y,p.rx,p.ry)*clamp((p.top-z)/2,0,1);
    rain+=amount;if(amount>.2)top=Math.max(top,p.top);
  }
  const t=w.tropical;
  if(t.organization>.04){
    const xx=x-t.x,yy=y-t.y,r=Math.hypot(xx,yy),a=Math.atan2(yy,xx),rm=clamp(70-t.wind*.75,22,65);
    const envelope=Math.exp(-sq(r/210)),eyeStrength=clamp((t.wind*1.94384-60)/35,0,1)*t.organization;
    // Subsidence in an organized eye suppresses all hydrometeors, including
    // advected remnants and parameterized cells, not just the cyclone template.
    const eye=Math.exp(-8*eyeStrength*Math.exp(-Math.pow(r/(rm*.68),4)));
    rain*=eye;hailZ*=eye;
    const bands=Math.pow(.5+.5*Math.cos(a*3+r*.047+w.minutes*.0009+noise(xx/30,yy/30,12)),5);
    const ring=Math.exp(-sq((r-rm)/(9+4*noise(xx/8,yy/8,3))));
    const precip=t.organization*eye*(4+32*bands+ring*45*eyeStrength)*envelope*(.55+.8*noise(xx/9,yy/9,6))*clamp((15-z)/3,0,1);
    rain+=precip;if(precip>.15)top=Math.max(top,14);
    const speed=t.wind*Math.min(r/rm,Math.pow(rm/Math.max(1,r),.65));
    du+=(-yy-.1*xx)/Math.max(1,r)*speed;dv+=(xx-.1*yy)/Math.max(1,r)*speed;
    turbulence=Math.max(turbulence,1+ring*3*eyeStrength);
  }
  const out=outflowAt(w,x,y),lowBeam=Math.exp(-z/0.65);
  du+=out.u*lowBeam;dv+=out.v*lowBeam;
  for(const r of w.remnants){const dx=x-r.x,dy=y-r.y,dist=Math.hypot(dx,dy),speed=r.strength*9*(dist/40)*Math.exp(1-dist/40)*Math.exp(-(((z-2)/2)**2));du-=dy/Math.max(1,dist)*speed;dv+=dx/Math.max(1,dist)*speed;}
  const boundaryZ=out.fine>2?Math.pow(10,(5+Math.min(12,out.fine*.5))/10)*lowBeam:0;
  if(boundaryZ>1)top=Math.max(top,1.5);
  const fine=(noise(x/2,y/2,w.config.seed)-.5)*2+(noise(x/7,y/7,w.config.seed+1)-.5)*2;
  rain=Math.max(0,rain*Math.exp(fine*.32));
  const level=d.levels[Math.min(60,Math.max(0,Math.round(z*4)))];
  const freezing=d.freezing/1000;
  let phase=0;
  if(level.t< -2){phase=3;ice=rain;rain=0;hailZ*=.5;}
  else if(Math.abs(z-freezing)<.35&&z>.4&&rain>.1){phase=4;}
  if(rain>0&&e.temp<0&&z<.5)phase=5;
  const liquidZ=200*Math.pow(rain,1.6),snowZ=75*Math.pow(ice,1.7);
  const brightBand=phase===4?2.8:1;
  const precipitationZ=(liquidZ+snowZ)*brightBand+hailZ;
  const Z=precipitationZ+boundaryZ;
  if(boundaryZ>precipitationZ&&boundaryZ>1)phase=6;
  const reflectivity=Z>1?10*Math.log10(Z):-20;
  const hailFraction=clamp(hailZ/Math.max(1,Z),0,1);
  if(phase===0)phase=hailFraction>.35?2:rain>20?1:0;
  const zdr=phase===3?.25:phase===4?1.8:clamp(.3+rain*.045-hailFraction*3,-.5,4.8);
  const cc=phase===6?.78:clamp(.995-hailFraction*.10-(phase===4?.10:0)-Math.max(0,fine)*.004,.7,.999);
  const kdp=phase===3?0:clamp(rain*.045*(1-hailFraction*.4),0,9);
  // Small unresolved eddies share the spatial field and scale with turbulence;
  // they do not create independent random velocity colors outside precipitation.
  du+=(noise(x/3,y/3,77)-.5)*turbulence;
  dv+=(noise(x/3,y/3,91)-.5)*turbulence;
  return {reflectivity,rain,ice,hailFraction,top,du,dv,phase,zdr,cc,kdp,turbulence,rotation,motion:weight>0?[motionU/weight,motionV/weight]:d.mean};
}
module.exports={hydrometeors,noise,hash};
