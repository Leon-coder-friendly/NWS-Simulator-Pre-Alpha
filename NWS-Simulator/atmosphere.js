'use strict';
const thermo=require('./thermodynamics');
const lifecycle=require('./lifecycle');
const synoptic=require('./synoptic');
const {clamp}=thermo;
const RAD=Math.PI/180, sq=x=>x*x, g=(x,y,a,b)=>Math.exp(-sq(x/a)-sq(y/b));
const local=(lon,lat,o)=>[(lon-o.lon)*111.195*Math.cos(o.lat*RAD),(lat-o.lat)*111.195];
const geographic=(x,y,o)=>[o.lon+x/(111.195*Math.cos(o.lat*RAD)),o.lat+y/111.195];
const regions={
  plains:{name:'Central Plains',lon:-97.5,lat:35.6,site:'KTLX'},
  midwest:{name:'Upper Midwest',lon:-93.7,lat:41.7,site:'KDMX'},
  gulf:{name:'Northern Gulf',lon:-93.5,lat:28.7,site:'KLCH'},
  atlantic:{name:'Western Atlantic',lon:-71.5,lat:40.5,site:'KBOX'}
};
const defaults={region:'plains',seed:417,startHour:9,temperature:23,dewpoint:20,lapse:7.2,cap:3,heating:650,humidity:.68,shear:24,turn:12,forcing:.65,contrast:10,sst:29,oceanDepth:65};
function rng(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function bombThreshold(lat){return 24*Math.sin(Math.abs(lat)*RAD)/Math.sin(60*RAD);}
function hurricaneCategory(w){return w<34?'Tropical disturbance / depression':w<64?'Tropical storm':w<83?'Category 1 hurricane':w<96?'Category 2 hurricane':w<113?'Category 3 hurricane':w<137?'Category 4 hurricane':'Category 5 hurricane';}
class Atmosphere {
  constructor(config={},landMask=null){
    this.config={...defaults,...config};this.initialConfig={...this.config};this.region=regions[this.config.region];this.origin={lon:config.originLon??-98,lat:config.originLat??38,name:config.originName||'Contiguous United States',site:this.region?.site};if(!this.region)throw Error('Unknown region');
    this.isLand=landMask||((lon,lat)=>this.config.region==='gulf'?lat>29.7:this.config.region==='atlantic'?lon<-72:true);
    this.random=rng(this.config.seed);this.minutes=0;this.n=85;this.ny=53;this.dx=70;this.cx=42;this.cy=26;this.halfX=2940;this.halfY=1820;this.half=2940;this.cells=[];this.puffs=[];this.events=[];this.nextId=1;this.totalInitiated=0;this.landCache=new Map();
    this.low={x:this.config.region==='atlantic'?0:-100,y:this.config.region==='atlantic'?0:230,pressure:1010,history:[{minute:0,pressure:1010}],drop24:null};
    this.tropical={x:0,y:0,wind:10,organization:0,age:0,pressure:1012};
    const anchor=config.originLon!==undefined?[0,0]:local(this.region.lon,this.region.lat,this.origin);this.low.x+=anchor[0];this.low.y+=anchor[1];const tropicalAnchor=this.config.autonomous&&config.originLon===undefined?local(-91.5,27.5,this.origin):anchor;this.tropical.x=tropicalAnchor[0];this.tropical.y=tropicalAnchor[1];
    this.pressureSystems=[];this.nextPressureId=1;this.synopticCycle=0;
    this.grid=[];this.history=[];this.coldPools=[];this.nextPoolId=1;this.systems=[];this.nextSystemId=1;this.remnants=[];this.outflowBirths=0;
    for(let j=0;j<this.ny;j++)for(let i=0;i<this.n;i++){
      const x=(i-this.cx)*this.dx,y=(j-this.cy)*this.dx;
      const base=this.background(x,y);
      this.grid.push({x,y,temp:base.temp,dew:base.dew,cold:0,spent:0,charge:0,cooldown:0,rain:0,jitter:this.random(),environment:null,diagnostic:null});
    }
    this.diagnoseGrid();this.record('Atmosphere initialized. No storms have been inserted.');
  }
  record(text){this.events.unshift({minute:this.minutes,text});this.events=this.events.slice(0,60);}
  frontX(y){return this.low.x+35+(y-this.low.y)*.28;}
  background(x,y){
    const c=this.config,front=this.frontX(y),cold=1/(1+Math.exp((x-front)/35));
    const north=1/(1+Math.exp(-(y-this.low.y)/55));
    const [lon,lat]=geographic(x,y,this.origin),maskKey=`${Math.round(x)}:${Math.round(y)}`;
    if(!this.landCache.has(maskKey))this.landCache.set(maskKey,!this.isLand(lon,lat));
    const ocean=this.landCache.get(maskKey);
    const tropicalRegion=c.region==='gulf';
    const regional=g(x,y,650,650);
    const fronts=this.pressureSystems?.filter(s=>s.kind==='L')||[];
    let thermal=0,drying=0;for(const s of fronts){const influence=g(x-s.x,y-s.y,600,550),side=1/(1+Math.exp((x-s.x-(y-s.y)*.28)/50));thermal+=c.contrast*.35*influence*(.35-side);drying+=4*influence*side;}
    const temp=c.temperature-c.contrast*(.65*cold+.45*north)-y*.002+thermal;
    const dew=Math.min(temp-1,c.dewpoint-drying-(tropicalRegion?2:9)*cold-5*north+Math.sin(y*.009)*.7);
    return {temp,dew,ocean,regional};
  }
  environment(x,y,node=null){
    const c=this.config,base=this.background(x,y),n=node||this.node(x,y);
    const boundary=Math.exp(-sq((x-this.frontX(y))/38))*Math.exp(-sq((y+50)/390));
    const warm=Math.exp(-sq((y-this.low.y)/55))*g(x-this.low.x-180,0,320,1);
    const trough=g(x-this.low.x+120,y-this.low.y,220,310)*c.forcing;
    const t=this.tropical;
    const vortexLift=t.organization*clamp(t.wind/25,0,1.5)*g(x-t.x,y-t.y,130,130)*.9;
    const outflow=lifecycle.outflowAt(this,x,y);
    const remnantLift=this.remnants.reduce((a,r)=>a+r.strength*g(x-r.x,y-r.y,65,65)*.3,0);
    const synopticExtra=synoptic.contribution(this,x,y);
    const convergence=synopticExtra.lift+outflow.lift+remnantLift+c.forcing*(boundary*.9+warm*.45+trough*.22)+vortexLift;
    const temp=n?.temp??base.temp,dew=Math.min(temp,n?.dew??base.dew);
    const anomaly=temp-base.temp;
    const synopticWind=this.synopticWind(x,y);
    return {x,y,temp,dewpoint:dew,pressure:this.pressureAt(x,y),humidity:c.humidity,
      aloftTemp:base.temp+3,surfaceAnomaly:anomaly-3,cap:c.cap*(1-.25*trough),lapse:c.lapse,
      shear:c.shear*(.7+.3*clamp(synoptic.jet(this,x,y).speed/45,0,1.5)),turn:c.turn,surfaceU:3+c.forcing*2+synopticWind[0]+synopticExtra.u,surfaceV:5+c.forcing*6+synopticWind[1]+synopticExtra.v,
      outflowLift:outflow.lift,outflowParent:outflow.parent,forcing:convergence,trough,ocean:base.ocean,cold:n?.cold||0,spent:n?.spent||0};
  }
  node(x,y){const i=Math.round(x/this.dx+this.cx),j=Math.round(y/this.dx+this.cy);return i>=0&&i<this.n&&j>=0&&j<this.ny?this.grid[j*this.n+i]:null;}
  interpolateState(x,y){
    const fx=clamp(x/this.dx+this.cx,0,this.n-1),fy=clamp(y/this.dx+this.cy,0,this.ny-1),i=Math.min(this.n-2,Math.floor(fx)),j=Math.min(this.ny-2,Math.floor(fy)),a=fx-i,b=fy-j,nodes=[this.grid[j*this.n+i],this.grid[j*this.n+i+1],this.grid[(j+1)*this.n+i],this.grid[(j+1)*this.n+i+1]],weights=[(1-a)*(1-b),a*(1-b),(1-a)*b,a*b],result={};
    for(const key of ['temp','dew','cold','spent'])result[key]=nodes.reduce((v,n,k)=>v+(n[key]||0)*weights[k],0);return result;
  }
  interpolatedEnvironment(x,y){
    const fx=clamp(x/this.dx+this.cx,0,this.n-1),fy=clamp(y/this.dx+this.cy,0,this.ny-1),i=Math.min(this.n-2,Math.floor(fx)),j=Math.min(this.ny-2,Math.floor(fy)),a=fx-i,b=fy-j;
    const nodes=[this.grid[j*this.n+i],this.grid[j*this.n+i+1],this.grid[(j+1)*this.n+i],this.grid[(j+1)*this.n+i+1]],weights=[(1-a)*(1-b),a*(1-b),(1-a)*b,a*b],e={};
    for(const key of ['temp','dewpoint','forcing','trough','pressure'])e[key]=nodes.reduce((v,n,k)=>v+n.environment[key]*weights[k],0);
    return e;
  }
  diagnoseGrid(){
    for(const n of this.grid){n.environment=this.environment(n.x,n.y,n);n.diagnostic=thermo.diagnose(n.environment);}
  }
  point(lon,lat,full=true){
    const [x,y]=local(lon,lat,this.origin);if(Math.abs(x)>this.halfX||Math.abs(y)>this.halfY)return null;
    const state=this.interpolateState(x,y),out=lifecycle.outflowAt(this,x,y),cool=Math.max(0,out.cooling-state.cold);state.temp-=cool;state.dew=Math.min(state.temp,state.dew);
    const e=this.environment(x,y,state);e.boundaryU=out.u;e.boundaryV=out.v;
    const d=thermo.diagnose(e,full);return {e,d,hazards:this.hazards(e,d)};
  }
  pressureAt(x,y){
    const low=this.low,pressure=1018-(1018-low.pressure)*g(x-low.x,y-low.y,280,240)+8*Math.exp(-this.minutes/2880)*g(x+400-this.minutes*.7,y-250,210,260);
    const t=this.tropical;
    return pressure+synoptic.contribution(this,x,y).pressure-(1012-t.pressure)*g(x-t.x,y-t.y,140,140);
  }
  synopticWind(x,y){
    if(this.config.contrast<=5)return [0,0];
    const dx=x-this.low.x,dy=y-this.low.y,r=Math.hypot(dx,dy),speed=clamp((1018-this.low.pressure)*.85,0,45)*Math.min(r/100,100/Math.max(r,1));
    const hx=x+400-this.minutes*.7,hy=y-250,hr=Math.hypot(hx,hy),hs=5*Math.exp(-this.minutes/2880)*Math.min(hr/150,150/Math.max(hr,1));
    return [(-dy-.15*dx)/Math.max(r,1)*speed+(hy+.1*hx)/Math.max(hr,1)*hs,(dx-.15*dy)/Math.max(r,1)*speed+(-hx+.1*hy)/Math.max(hr,1)*hs];
  }
  hazards(e,d){
    const initiation=clamp((d.cape-150)/1700,0,1)*Math.exp(-d.cin/100)*clamp(e.forcing*2+clamp(this.config.heating/650,0,1)*.25,0,1);
    const supercell=clamp((d.shear-10)/18,0,1)*clamp(d.cape/1800,0,1)*initiation;
    const tornado=supercell*clamp(Math.max(0,d.srh)/250,0,1)*clamp((2200-d.lcl)/1700,0,1)*clamp(d.lowShear/12,0,1);
    const hail=initiation*clamp(d.cape/2600,0,1)*clamp(d.shear/20,0,1)*clamp((e.lapse-5.5)/2,0,1);
    const wind=initiation*clamp((d.dcape+Math.max(0,d.cape)*.18)/1300,0,1)*(.45+.55*clamp(d.shear/23,0,1));
    const severe=Math.max(tornado*1.3,hail,wind);
    // Ingredient scores are deliberately not calibrated event probabilities.
    const category=initiation<.07?0:severe<.12?1:severe<.25?2:severe<.45?3:severe<.68?4:severe<.86?5:6;
    return {initiation,supercell,tornado,hail,wind,downburst:initiation*clamp(d.dcape/1400,0,1),organization:initiation*clamp(d.shear/24,0,1)*clamp(e.forcing*2,0,1),category};
  }
  evolveClimate(dt){
    if(!this.config.autonomous)return;
    const c=this.config,t=this.minutes,phase=(c.seed%997)/997*Math.PI*2,day=(c.startDay||264)+t/1440,season=Math.sin((day-80)*Math.PI*2/365.25);
    const targets={temperature:18+10*season+Math.max(-22,(38-this.origin.lat)*.6)+3*Math.sin(t/5000+phase),dewpoint:13+8*season+Math.max(-22,(38-this.origin.lat)*.6)+2*Math.sin(t/3600+phase),heating:450+220*season,lapse:6.6+.6*Math.sin(t/2400+phase),cap:2+1.5*Math.sin(t/1700+phase),shear:22+12*Math.sin(t/2700+phase),turn:10+7*Math.sin(t/1900+phase),forcing:.5+.35*Math.sin(t/1600+phase),contrast:12+6*Math.sin(t/3000+phase),humidity:.66+.14*Math.sin(t/2700+phase),sst:26+3*season};
    for(const [key,value]of Object.entries(targets))c[key]+=(value-c[key])*(1-Math.exp(-dt/360));
  }
  advance(minutes=5){if(!Number.isFinite(minutes)||minutes<0)throw Error('Invalid time step');while(minutes>0){const dt=Math.min(5,minutes);this.step(dt);minutes-=dt;}return this;}
  step(dt){
    const c=this.config,seconds=dt*60;this.minutes+=dt;this.evolveClimate(dt);synoptic.step(this,dt);
    const hour=(c.startHour+this.minutes/60)%24,solar=Math.max(0,Math.sin((hour-6)/12*Math.PI));
    const steering=synoptic.jet(this,this.low.x,this.low.y);
    this.low.x+=(5+steering.u*.3)*dt*.06;this.low.y+=steering.v*.3*dt*.06;
    const waveSupport=.55+.45*Math.exp(-sq((this.low.y-synoptic.jetY(this,this.low.x))/650));
    const deepening=c.forcing*c.contrast*(c.shear/25)*.0015*dt*waveSupport*Math.max(0,1-this.minutes/2880);
    this.low.pressure=clamp(this.low.pressure-deepening+(1010-this.low.pressure)*dt/7000,950,1030);
    this.low.history.push({minute:this.minutes,pressure:this.low.pressure});
    this.low.history=this.low.history.filter(p=>p.minute>=this.minutes-1445);
    const past=this.low.history.find(p=>p.minute>=this.minutes-1440);
    this.low.drop24=this.minutes>=1440?past.pressure-this.low.pressure:null;
    if(this.minutes>3600){this.low.pressure+=(1018-this.low.pressure)*dt/500;}
    if(this.low.drop24!==null&&this.low.drop24>=bombThreshold(this.origin.lat)&&!this.bombLogged){this.bombLogged=true;this.record('Extratropical pressure fall crossed the latitude-adjusted 24-hour bombogenesis threshold.');}
    // Semi-Lagrangian transport of surface anomalies. Open boundaries relax to the
    // synoptic background; solar heating is a mixed-layer heat budget.
    const previous=this.grid.map(n=>({temp:n.temp,dew:n.dew,cold:n.cold,spent:n.spent}));
    const interpolate=(x,y,key)=>{
      const fx=clamp(x/this.dx+this.cx,0,this.n-1),fy=clamp(y/this.dx+this.cy,0,this.ny-1),i=Math.min(this.n-2,Math.floor(fx)),j=Math.min(this.ny-2,Math.floor(fy)),a=fx-i,b=fy-j;
      return previous[j*this.n+i][key]*(1-a)*(1-b)+previous[j*this.n+i+1][key]*a*(1-b)+previous[(j+1)*this.n+i][key]*(1-a)*b+previous[(j+1)*this.n+i+1][key]*a*b;
    };
    for(const n of this.grid){
      const base=this.background(n.x,n.y),e=n.environment;
      const sx=n.x-e.surfaceU*seconds/1000,sy=n.y-e.surfaceV*seconds/1000;
      const net=c.heating*solar*(1-.45*c.humidity)-70;
      n.temp=interpolate(sx,sy,'temp')+(base.temp-interpolate(sx,sy,'temp'))*dt/500+(base.ocean?0:net*seconds/(1.2*1004*850));
      if(base.ocean)n.temp+=(Math.min(c.sst-1,c.temperature+2)-n.temp)*dt/360;
      n.dew=interpolate(sx,sy,'dew')+(base.dew-n.dew)*dt/240;
      n.cold=interpolate(sx,sy,'cold')*Math.exp(-dt/110);n.spent=interpolate(sx,sy,'spent')*Math.exp(-dt/180);
      n.cooldown=Math.max(0,n.cooldown-dt);
    }
    lifecycle.stepPools(this,dt);
    for(const n of this.grid){const out=lifecycle.outflowAt(this,n.x,n.y),cool=Math.max(0,out.cooling-n.cold);n.temp-=cool;n.cold+=cool;n.dew=Math.min(n.temp,n.dew);}
    this.diagnoseGrid();
    for(const cell of this.cells){
      const n=this.node(cell.x,cell.y);cell.age+=dt;
      if(!n){cell.strength*=Math.exp(-dt/12);continue;}
      const d=n.diagnostic,e=n.environment;
      const supply=clamp(d.cape/2200,0,1.7)*Math.exp(-d.cin/150)*clamp((e.dewpoint+2)/23,0,1)*(1-clamp(n.spent,0,.95));
      // Weak shear lets precipitation choke the updraft; organized inflow can
      // sustain it, but no named mode is immortal or exempt from fuel loss.
      const separation=clamp(d.shear/22,0,1),choke=cell.rain*(1-separation)*cell.age/40;
      const undercut=clamp(cell.outflow/(d.lowShear+8)-1,0,3)*.2;
      cell.exhaustion=(cell.exhaustion||0)+dt*(choke*.025+undercut*.008);
      const target=supply*Math.exp(-cell.exhaustion);
      const previousStrength=cell.strength;
      cell.strength+=(target-cell.strength)*(1-Math.exp(-dt/(target>cell.strength?18:25)));
      cell.stage=cell.age<15?'Developing':target<cell.strength*.75?'Dissipating':'Mature';
      const neighbors=this.cells.filter(other=>other!==cell&&Math.hypot(other.x-cell.x,other.y-cell.y)<65).length;
      const rotationTarget=clamp((d.shear-12)/16,0,1)*clamp(Math.max(0,d.srh)/180,0,1)*clamp((cell.age-15)/35,0,1)/(1+neighbors*.12);
      cell.rotation+=(rotationTarget-cell.rotation)*dt/30;
      cell.rotatingMinutes=cell.rotation>.5?(cell.rotatingMinutes||0)+dt:0;
      const mean=d.mean,right=d.motion;cell.u=mean[0]*(1-cell.rotation)+right[0]*cell.rotation;cell.v=mean[1]*(1-cell.rotation)+right[1]*cell.rotation;
      // Cold-pool propagation accelerates the strongest part of a connected line,
      // allowing bowing to emerge from unequal outflows instead of a bow preset.
      const propagation=cell.outflow*.3*clamp(neighbors/3,0,1),meanSpeed=Math.max(1,Math.hypot(...mean));
      cell.u+=propagation*mean[0]/meanSpeed;cell.v+=propagation*mean[1]/meanSpeed;
      cell.x+=cell.u*seconds/1000;cell.y+=cell.v*seconds/1000;
      cell.cape=d.cape;cell.top=clamp((d.el||6000)/1000,3,15);cell.freezing=d.freezing/1000;cell.dcape=d.dcape;
      cell.hail=clamp((Math.sqrt(2*d.cape)*.55-20)/30,0,1)*clamp(d.shear/22,0,1)*cell.strength;
      const rainTarget=clamp((cell.age-10)/25,0,1)*cell.strength;
      cell.rain+=(rainTarget-cell.rain)*(1-Math.exp(-dt/(rainTarget<cell.rain?22:10)));
      cell.collapse=Math.max(0,previousStrength-cell.strength)/dt;
      cell.outflow+=(clamp(Math.sqrt(2*d.dcape)*(.65*cell.rain+cell.collapse*20),0,42)-cell.outflow)*dt/30;
      cell.radius=10+Math.min(cell.age,100)*.07+cell.outflow*.2;
      lifecycle.feedPool(this,cell,dt);
      cell.path+=Math.hypot(cell.u,cell.v)*seconds/1000;
      if(cell.rain>.1){
        this.puffs.push({x:cell.x-9,y:cell.y+8,age:0,mass:cell.rain*.6,top:cell.top*.7,u:mean[0]*.7,v:mean[1]*.7,rx:18+cell.radius,ry:16+cell.radius});
        for(const near of this.grid){
          const dist=Math.hypot(near.x-cell.x,near.y-cell.y);if(dist>cell.radius*3)continue;
          const weight=Math.exp(-sq(dist/(cell.radius*1.4)));
          const cooling=cell.rain*weight*dt*.035;
          near.temp-=cooling;near.cold=clamp(near.cold+cooling,0,12);near.dew=Math.min(near.temp,near.dew-cooling*.15);
          near.spent=clamp(near.spent+cell.rain*weight*dt*.008,0,.95);
          // Gust-front lifting at the edge, separate from cold outflow interior.
          // Persistent density-current edges supply lift through environment().
        }
      }
    }
    this.cells=this.cells.filter(cell=>(cell.strength>.035||cell.rain>.04)&&cell.age<1440&&Math.abs(cell.x)<this.halfX+100&&Math.abs(cell.y)<this.halfY+100);
    for(const p of this.puffs){p.age+=dt;p.x+=p.u*seconds/1000;p.y+=p.v*seconds/1000;p.mass*=Math.exp(-dt/80);p.rx+=dt*.18;p.ry+=dt*.1;}
    this.puffs=this.puffs.filter(p=>p.mass>.07&&p.age<160).slice(-180);
    const candidates=[];
    for(const n of this.grid){
      const d=n.diagnostic,e=n.environment;
      const thermalLift=(c.heating/650)*solar*dt*.9*(.6+n.jitter*.8);
      n.charge=n.charge*Math.exp(-dt/35)+e.forcing*dt*2.8+thermalLift;
      if(d.cape>350&&e.dewpoint>5&&n.cold<3&&n.cooldown===0&&n.charge>d.cin+18&&this.cells.length<55){
        const readiness=(n.charge-d.cin)*(.7+n.jitter*.6)*clamp(d.cape/2000,0,2);
        candidates.push({n,readiness});
      }
      // Integrate a local surface rainfall estimate, never current rate times elapsed time.
      const surface=require('./hydrometeors').hydrometeors(this,n.x,n.y,0);
      n.rain+=(surface?.rain||0)*dt/60;
    }
    candidates.sort((a,b)=>b.readiness-a.readiness);
    let births=0;
    for(const {n} of candidates){
      if(births>=4||this.cells.length>=55)break;
      if(this.cells.some(s=>Math.hypot(n.x-s.x,n.y-s.y)<38))continue;
      if(this.random()>.45)continue;
      const d=n.diagnostic;
      const cell={id:this.nextId++,x:n.x+(n.jitter-.5)*15,y:n.y+(this.random()-.5)*15,age:0,strength:.08,rotation:0,rain:0,outflow:0,radius:10,u:d.mean[0],v:d.mean[1],cape:d.cape,top:(d.el||9000)/1000,freezing:d.freezing/1000,hail:0,dcape:d.dcape,path:0,stage:'Developing',exhaustion:0,rotatingMinutes:0,parentBoundary:n.environment.outflowLift>.1?n.environment.outflowParent:null};
      if(cell.parentBoundary!==null){this.outflowBirths++;this.record(`Outflow boundary ${cell.parentBoundary} initiated cell ${cell.id} in unstable inflow.`);}
      this.cells.push(cell);n.cooldown=100;n.charge=0;births++;this.totalInitiated++;
      if(this.totalInitiated<=3||this.totalInitiated%10===0)this.record(`Updraft ${cell.id} initiated: CAPE ${Math.round(d.cape)} J/kg; CIN ${Math.round(d.cin)} J/kg overcome by accumulated lift.`);
    }
    lifecycle.trackSystems(this,dt);
    this.stepTropical(dt);
    // Grid diagnostics also reflect the just-produced outflow for readouts/outlooks.
    for(const n of this.grid)if(n.cold>.1){n.environment=this.environment(n.x,n.y,n);n.diagnostic=thermo.diagnose(n.environment);}
    if(this.minutes%30===0){this.history.push({minute:this.minutes,cells:this.cells.length,pressure:this.low.pressure,tropicalWind:this.tropical.wind});this.history=this.history.slice(-150);}
  }
  tropicalSupport(){
    const c=this.config,t=this.tropical,[lon,lat]=geographic(t.x,t.y,this.origin),ocean=!this.isLand(lon,lat);
    const inBasin=c.autonomous||c.region==='gulf'||c.region==='atlantic';
    const d=this.node(t.x,t.y)?.diagnostic;
    // As the circulation organizes, boundary-layer convergence supplies lifting
    // work against inhibition. CAPE still has to exist; a warm SST alone fails.
    const effectiveCin=d?Math.max(0,d.cin-t.organization*100-t.wind*1.5):Infinity;
    const convection=d?clamp(d.cape/700,0,1)*Math.exp(-effectiveCin/150):0;
    const support=(inBasin&&ocean&&Math.abs(lat)>5)?clamp((c.sst-26)/3,0,1)*clamp((c.humidity-.45)/.35,0,1)*clamp(1-c.shear/20,0,1)*clamp(c.oceanDepth/60,0,1)*clamp(1-c.contrast/15,0,1)*convection:0;
    return {support,ocean,lon,lat};
  }
  stepTropical(dt){
    const t=this.tropical,c=this.config,{support,ocean}=this.tropicalSupport();
    const oldClass=t.organization>.25?hurricaneCategory(this.tropicalWindKnots()):'Unorganized disturbance';
    t.age+=dt;t.organization=clamp(t.organization+(support*(1-t.organization)/800-(1-support)*t.organization/600)*dt,0,1);
    const potential=clamp((c.sst-25)*16,0,80); // empirical intensity ceiling, m/s
    const tendency=t.organization*support*(potential-t.wind)/1400-(1-support)*Math.max(0,t.wind-5)/500;
    t.wind=clamp(t.wind+tendency*dt,3,85);if(!ocean)t.wind=Math.max(3,t.wind*Math.exp(-dt/600));
    t.pressure=1015-.013*t.wind*t.wind;
    t.x+=dt*(c.region==='gulf'?-.012:.025);t.y+=dt*.012;
    const newClass=t.organization>.25?hurricaneCategory(this.tropicalWindKnots()):'Unorganized disturbance';
    if(oldClass!==newClass)this.record(`${newClass}: modeled sustained wind ${Math.round(this.tropicalWindKnots())} kt.`);
  }
  tropicalWindKnots(){
    const t=this.tropical,rm=clamp(70-t.wind*.75,22,65);let peak=0;
    // Sample the mean surface circulation plus background flow around the RMW.
    // Convective gust perturbations are excluded from sustained-wind categories.
    for(let i=0;i<32;i++){
      const a=i*Math.PI/16,cs=Math.cos(a),sn=Math.sin(a),n=this.node(t.x+rm*cs,t.y+rm*sn);
      const u=(n?.environment.surfaceU||0)+(-sn-.1*cs)*t.wind;
      const v=(n?.environment.surfaceV||0)+(cs-.1*sn)*t.wind;
      peak=Math.max(peak,Math.hypot(u,v));
    }return peak*1.94384;
  }
  summary(){
    const mature=this.cells.filter(s=>s.rain>.25),rotating=mature.filter(s=>s.rotation>.5);
    let connections=0;for(let i=0;i<mature.length;i++)for(let j=i+1;j<mature.length;j++)if(Math.hypot(mature[i].x-mature[j].x,mature[i].y-mature[j].y)<85)connections++;
    const organization=mature.length>=5&&connections>=4;
    const span=mature.length?Math.max(...mature.map(s=>s.y))-Math.min(...mature.map(s=>s.y)):0;
    const severeWind=mature.some(s=>s.outflow>=25.9);
    return {cells:this.cells.length,mature:mature.length,rotating:rotating.length,organization,
      mode:this.systems.length?this.systems.slice().sort((a,b)=>b.members.length-a.members.length)[0].mode:organization?(span>150?'Organizing convective line / MCS':'Growing convective cluster'):rotating.length?'Rotating convection':mature.length?'Cellular convection':this.cells.length?'Developing updrafts':'No deep convection',
      outflows:this.coldPools.length,outflowBirths:this.outflowBirths,developing:this.cells.filter(c=>c.stage==='Developing').length,decaying:this.cells.filter(c=>c.stage==='Dissipating').length,remnants:this.remnants.length,
      wind:severeWind?'Damaging outflow possible':'No strong outflow diagnosed',
      derecho:organization&&severeWind?'Organized damaging-wind potential; derecho unconfirmed':'Derecho not diagnosed',
      coastal:(()=>{const [lon,lat]=geographic(this.low.x,this.low.y,this.origin);return lon>-78&&lon<-60&&lat>32&&lat<48&&this.low.pressure<1005?'Coastal low / nor’easter pattern':'';})(),
      tropical:this.tropical.organization>.25?hurricaneCategory(this.tropicalWindKnots()):'No organized tropical cyclone'};
  }
  outlook(day=1){
    const categories=new Float32Array(this.grid.length),hazards=[];
    for(let i=0;i<this.grid.length;i++){
      const n=this.grid[i];let best={category:0,initiation:0,supercell:0,tornado:0,hail:0,wind:0,downburst:0,organization:0};
      for(let offset=0;offset<24;offset+=6){
        const lead=(day-1)*24+offset;
        const view=Object.create(this),steering=synoptic.jet(this,this.low.x,this.low.y);view.low={...this.low,x:this.low.x+(5+steering.u*.3)*lead*3.6,y:this.low.y+steering.v*.3*lead*3.6};view.config={...this.config};view.minutes=this.minutes+lead*60;view.evolveClimate(lead*60);view.coldPools=lead<3?this.coldPools:[];view.remnants=lead<12?this.remnants:[];
        const base=view.background(n.x,n.y);
        let temp=n.temp,dew=n.dew;
        for(let h=0;h<lead;h+=.5){
          const hour=(this.config.startHour+this.minutes/60+h)%24,solar=Math.max(0,Math.sin((hour-6)*Math.PI/12));
          temp+=(base.temp-temp)*30/500+(base.ocean?0:(this.config.heating*solar*(1-.45*this.config.humidity)-70)*1800/(1.2*1004*850));
          dew+=(base.dew-dew)*30/240;
        }
        const e=view.environment(n.x,n.y,{temp,dew,cold:0,spent:0}),d=thermo.diagnose(e),score=this.hazards(e,d);
        for(const key of Object.keys(best))best[key]=Math.max(best[key],score[key]);
      }
      if(day===3)best.category=Math.min(5,best.category);
      categories[i]=best.category;hazards.push(best);
    }
    return {categories,hazards};
  }
}
module.exports={Atmosphere,regions,defaults,local,geographic,bombThreshold,hurricaneCategory,g,clamp};
