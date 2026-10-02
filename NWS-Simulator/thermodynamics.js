'use strict';
// SI units internally: m, s, K (temperatures passed in Celsius), hPa, kg/kg.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const saturation=t=>6.112*Math.exp(17.67*t/(t+243.5));
const mixingRatio=(t,p)=>.622*saturation(t)/Math.max(1,p-saturation(t));
const dewpoint=e=>243.5*Math.log(Math.max(.01,e)/6.112)/(17.67-Math.log(Math.max(.01,e)/6.112));
const virtual=(t,q)=>(t+273.15)*(1+.61*q);
function moistLapse(t,p) {
  const k=t+273.15,r=mixingRatio(t,p),lv=2.5e6;
  return 9.80665*(1+lv*r/(287.05*k))/(1004+lv*lv*r*.622/(287.05*k*k));
}
function profile(e) {
  const levels=[];let p=e.pressure||1008;
  for(let z=0;z<=15000;z+=250){
    const km=z/1000;
    // Surface heating decays through the mixed layer; free-tropospheric temperature
    // is separately controlled, so warming can actually increase buoyancy.
    const t=Math.max(-66,e.aloftTemp-e.lapse*km)+e.surfaceAnomaly*Math.exp(-km/1.1)+e.cap*Math.exp(-(((km-1.65)/.52)**2));
    const q0=mixingRatio(e.dewpoint,e.pressure||1008);
    const q=Math.min(mixingRatio(t,p)*.99,q0*Math.exp(-km/(1.9+2.8*e.humidity)));
    if(z>0)p*=Math.exp(-9.80665*250/(287.05*virtual((levels.at(-1).t+t)/2,q)));
    const td=Math.min(t,dewpoint(q*p/(.622+q)));
    const f=clamp(km/6,0,1),turn=Math.sin(Math.min(1,km/3)*Math.PI/2);
    const u=e.surfaceU+e.shear*f+(e.boundaryU||0)*Math.exp(-km/.65);
    const v=e.surfaceV+e.turn*turn-e.turn*.7*f+(e.boundaryV||0)*Math.exp(-km/.65);
    levels.push({z,p,t,td,q,u,v});
  }
  return levels;
}
function parcel(levels,start=0,initial=null) {
  const first=levels[start],t0=initial?.t??first.t,td0=initial?.td??first.td;
  const tk=t0+273.15,tdk=td0+273.15;
  const tlcl=1/(1/(tdk-56)+Math.log(tk/tdk)/800)+56;
  const lcl=Math.max(first.z,first.z+(tk-tlcl)/.0098);
  const q0=mixingRatio(td0,first.p);
  let t=t0,cape=0,cin=0,lfc=null,el=null,positive=false,lowCape=0;
  const trace=[];
  for(let i=start;i<levels.length;i++){
    const l=levels[i];
    if(i>start){
      // Integrate in 50 m substeps through saturation transition.
      const prev=levels[i-1];
      for(let zz=prev.z;zz<l.z;zz+=50){const pp=prev.p+(l.p-prev.p)*(zz-prev.z)/250;t-=50*(zz<lcl?.0098:moistLapse(t,pp));}
    }
    const q=l.z<lcl?q0:Math.min(q0,mixingRatio(t,l.p));
    const b=9.80665*(virtual(t,q)-virtual(l.t,l.q))/virtual(l.t,l.q);
    trace.push({z:l.z,p:l.p,t,b});
    if(i===start)continue;
    const dz=l.z-levels[i-1].z,bbar=(b+trace.at(-2).b)/2;
    if(l.z>=lcl&&bbar>0){if(lfc===null)lfc=l.z;cape+=bbar*dz;if(l.z<=3000)lowCape+=bbar*dz;positive=true;el=l.z;}
    else if(lfc===null)cin+=Math.min(0,bbar)*dz;
  }
  // A shallow positive-buoyancy pocket below an inversion must not erase the
  // inhibition above it. Select the LFC of the largest positive-energy layer,
  // then include all intervening negative buoyancy in the surface-to-LFC CIN.
  const segments=[];let segment=null;
  for(let i=1;i<trace.length;i++){
    const a=trace[i-1],b=trace[i],energy=(a.b+b.b)*.5*(b.z-a.z);
    if(b.z>=lcl&&energy>0){
      if(!segment){segment={start:i,energy:0};segments.push(segment);}segment.energy+=energy;
    }else segment=null;
  }
  if(segments.length){
    const primary=segments.reduce((a,b)=>a.energy>b.energy?a:b);
    lfc=trace[primary.start].z;cape=0;cin=0;lowCape=0;el=null;
    for(let i=1;i<trace.length;i++){
      const a=trace[i-1],b=trace[i],energy=(a.b+b.b)*.5*(b.z-a.z);
      if(i<primary.start)cin+=Math.max(0,-energy);
      else if(energy>0){cape+=energy;el=b.z;if(b.z<=3000)lowCape+=energy;}
    }
  }else{cape=0;lfc=null;el=null;}
  return {cape,cin:Math.abs(cin),lcl,lfc,el,lowCape,trace};
}
function windDiagnostics(levels) {
  const at=z=>levels[Math.round(z/250)];
  const low=at(0),high=at(6000),du=high.u-low.u,dv=high.v-low.v,shear=Math.hypot(du,dv);
  const mean=levels.slice(0,25).reduce((a,l)=>[a[0]+l.u/25,a[1]+l.v/25],[0,0]);
  // Bunkers-inspired right mover: 7.5 m/s right of the 0–6 km shear vector.
  const motion=[mean[0]+7.5*dv/Math.max(1,shear),mean[1]-7.5*du/Math.max(1,shear)];
  let srh=0;
  for(let i=1;i<=12;i++){
    const a=levels[i-1],b=levels[i];
    srh+=(b.u-motion[0])*(a.v-motion[1])-(a.u-motion[0])*(b.v-motion[1]);
  }
  return {shear,lowShear:Math.hypot(at(1000).u-low.u,at(1000).v-low.v),srh,motion,mean};
}
function diagnose(e,full=false) {
  const levels=profile(e),sb=parcel(levels),wind=windDiagnostics(levels);
  const freezing=levels.find(l=>l.t<=0)?.z??15000;
  // DCAPE proxy rather than falsely claiming a full saturated downdraft integration.
  const dcape=clamp((1-e.humidity)*Math.max(0,e.lapse-4)*450+Math.max(0,levels[0].t-levels[0].td)*30,0,2400);
  const result={...sb,...wind,freezing,dcape,levels};
  if(full){
    const mixed=levels.slice(0,5);const theta=mixed.reduce((a,l)=>a+(l.t+273.15)*(1000/l.p)**.286,0)/5;
    const q=mixed.reduce((a,l)=>a+l.q,0)/5;
    result.ml=parcel(levels,0,{t:theta*(levels[0].p/1000)**.286-273.15,td:dewpoint(q*levels[0].p/(.622+q))});
    let mu=sb;for(let i=1;i<=12;i+=2){const candidate=parcel(levels,i);if(candidate.cape>mu.cape)mu=candidate;}result.mu=mu;
  }
  return result;
}
module.exports={clamp,saturation,mixingRatio,dewpoint,moistLapse,profile,parcel,windDiagnostics,diagnose};

