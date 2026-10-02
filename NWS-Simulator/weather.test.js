'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Atmosphere,local,geographic,bombThreshold,hurricaneCategory}=require('./atmosphere');
const thermo=require('./thermodynamics'),radar=require('./weather'),{hydrometeors}=require('./hydrometeors');
const ideal={aloftTemp:24,surfaceAnomaly:3,lapse:7,cap:2,dewpoint:20,pressure:1008,humidity:.7,surfaceU:3,surfaceV:7,shear:24,turn:12};
let evolved;
function activeWorld(){if(!evolved){evolved=new Atmosphere();evolved.advance(360);}return evolved;}

test('parcel integration responds to moisture, heating, capping, and stable lapse rates',()=>{
 const warm=thermo.diagnose(ideal,true),cool=thermo.diagnose({...ideal,surfaceAnomaly:-3}),dry=thermo.diagnose({...ideal,dewpoint:0}),cap=thermo.diagnose({...ideal,cap:10}),stable=thermo.diagnose({...ideal,lapse:4,dewpoint:5});
 assert.ok(warm.cape>cool.cape);assert.ok(warm.cape>dry.cape);assert.ok(cap.cin>warm.cin);assert.ok(stable.cape<100);
 assert.ok(warm.lcl>0&&warm.lfc>=warm.lcl&&warm.el>warm.lfc);
 for(const l of warm.levels){assert.ok(l.td<=l.t+.01);assert.ok(Number.isFinite(l.p)&&l.p>0);}
 for(let i=1;i<warm.levels.length;i++)assert.ok(warm.levels[i].p<warm.levels[i-1].p);
 assert.ok(warm.ml.cape>=0&&warm.mu.cape>=warm.cape);
});

test('a shallow buoyant pocket cannot hide inhibition below the main free-convection layer',()=>{
 const d=thermo.diagnose({...ideal,cap:10,surfaceAnomaly:6});
 assert.ok(d.trace.some(l=>l.z<1000&&l.b>0));
 assert.ok(d.lfc>=2000);assert.ok(d.cin>150);
});

test('world starts without inserted storms; moist heating and lift initiate storms with feedback',()=>{
 const initial=new Atmosphere();assert.equal(initial.cells.length,0);assert.equal(initial.totalInitiated,0);
 const w=activeWorld();assert.ok(w.totalInitiated>0);assert.ok(w.cells.some(c=>c.rain>.3));
 assert.ok(w.grid.some(n=>n.cold>.1));assert.ok(w.grid.some(n=>n.spent>.01));assert.ok(w.grid.some(n=>n.rain>0));
 assert.ok(w.cells.some(c=>c.path>10));assert.ok(w.cells.some(c=>c.rotation>.35));
});

test('high CAPE without sufficient lift, dry inflow, and a strong cap do not automatically spawn storms',()=>{
 for(const config of [{heating:0,cap:10},{dewpoint:0},{cap:2,forcing:0,heating:0}]){
  const w=new Atmosphere(config);w.advance(360);assert.equal(w.totalInitiated,0,JSON.stringify(config));
  if(config.forcing===0)assert.ok(w.grid.some(n=>n.diagnostic.cape>1000),'high CAPE may remain unrealized');
 }
});

test('uncapped moist air can initiate from daytime heating without a synoptic boundary',()=>{
 const w=new Atmosphere({forcing:0,contrast:0,cap:0,temperature:27,dewpoint:24,lapse:7,heating:850});
 w.advance(180);assert.ok(w.totalInitiated>0);
});

test('removing shear removes organized rotation, rather than merely repainting radar',()=>{
 const w=new Atmosphere({shear:0,turn:0});w.advance(300);assert.ok(w.totalInitiated>0);
 assert.ok(w.cells.every(c=>c.rotation===0));
 assert.equal(w.node(0,0).diagnostic.shear,0);
});

test('seed and timestep partitioning give reproducible initiation and evolution',()=>{
 const a=new Atmosphere({seed:123}),b=new Atmosphere({seed:123});a.advance(180);for(let i=0;i<36;i++)b.advance(5);
 assert.equal(a.totalInitiated,b.totalInitiated);assert.deepEqual(a.cells,b.cells);
 assert.equal(a.node(0,0).temp,b.node(0,0).temp);
});

test('outlooks and point diagnostics respond to the same atmosphere and forecast calls do not mutate it',()=>{
 const w=new Atmosphere(),before=JSON.stringify({time:w.minutes,cells:w.cells,low:w.low,grid:w.grid.map(n=>n.temp)});
 const forecast=w.outlook(1);assert.equal(forecast.categories.length,w.n*w.ny);
 assert.equal(before,JSON.stringify({time:w.minutes,cells:w.cells,low:w.low,grid:w.grid.map(n=>n.temp)}));
 const point=w.point(w.origin.lon,w.origin.lat);assert.ok(Math.abs(point.d.cape-w.node(0,0).diagnostic.cape)<1e-8);
 const dry=new Atmosphere({dewpoint:-5,lapse:4,forcing:0});assert.equal(Math.max(...dry.outlook(1).categories),0);
 assert.equal(w.point(0,0),null);assert.ok(Math.max(...w.outlook(3).categories)<=5);
});

test('radar base moments, height masks, column moments and phase classes stay finite',()=>{
 const w=activeWorld(),site={lon:-97.28,lat:35.33};let echoes=0;
 for(let x=-180;x<=180;x+=30)for(let y=-180;y<=180;y+=30){
  const ll=geographic(x,y,site),s=radar.sample(w,...ll,site,.5,{column:true});if(!s)continue;
  for(const key of Object.keys(radar.products))assert.ok(s[key]===null||Number.isFinite(s[key]),key);
  if(s.reflectivity!==null){echoes++;assert.ok(s.composite!==null);assert.ok(s.cc>0&&s.cc<=1);assert.ok(s.hydro>=0&&s.hydro<=6);}
 }
 assert.ok(echoes>0);assert.equal(radar.sample(w,site.lon,site.lat,site),null);
 assert.equal(radar.sample(w,...geographic(231,0,site),site),null);
 const ll=geographic(-90,20,site),a=radar.sample(w,...ll,site,.5),b=radar.sample(w,...ll,site,4);assert.ok(b.height>a.height);
});

test('Doppler signs are radar-relative and velocity folding has a symmetric Nyquist interval',()=>{
 const w=new Atmosphere({forcing:0,contrast:0,cap:0,shear:0,turn:0,temperature:25,dewpoint:23,humidity:.9});
 w.cells.push({id:1,x:0,y:0,radius:35,age:50,rain:1,hail:0,rotation:0,strength:1,top:12,freezing:4,u:15,v:0,outflow:0});
 const point=geographic(0,0,w.origin),west=geographic(-25,0,w.origin),east=geographic(25,0,w.origin);
 const outbound=radar.sample(w,...point,{lon:west[0],lat:west[1]}),inbound=radar.sample(w,...point,{lon:east[0],lat:east[1]});
 assert.ok(outbound.velocity>0);assert.ok(inbound.velocity<0);assert.ok(Math.abs(outbound.velocity+inbound.velocity)<.01);
 assert.equal(radar.foldVelocity(70,60),-50);assert.equal(radar.foldVelocity(-70,60),50);
 for(let v=-300;v<300;v++)assert.ok(radar.foldVelocity(v,60)>=-60&&radar.foldVelocity(v,60)<60);
});

test('hail mixtures change dual-pol fields; snow is not silently counted as liquid rain',()=>{
 const w=new Atmosphere({forcing:0,contrast:0});
 const c={id:3,x:0,y:0,radius:20,age:60,rain:1,hail:0,rotation:.8,strength:1,top:14,freezing:4,u:15,v:0,outflow:15};w.cells.push(c);
 const rain=hydrometeors(w,2,5,0);c.hail=1;const hail=hydrometeors(w,2,5,0);
 assert.ok(hail.reflectivity>rain.reflectivity);assert.ok(hail.cc<rain.cc);assert.ok(hail.zdr<rain.zdr);
 const snow=hydrometeors(w,2,5,10);assert.equal(snow.phase,3);assert.equal(snow.rain,0);assert.ok(snow.ice>0);
});

test('tropical development requires ocean heat, moisture, instability, weak shear and ocean residence',()=>{
 const c={region:'gulf',temperature:29,dewpoint:27,sst:31,humidity:.95,lapse:7,cap:0,shear:2,contrast:0};
 const w=new Atmosphere(c,()=>false);assert.ok(w.tropicalSupport().support>.6);
 // Isolate the intensity tendency under a maintained environment, rather than
 // inserting a hurricane or accelerating its physical clock.
 for(let i=0;i<576;i++)w.stepTropical(5);
 assert.ok(w.tropical.wind*1.94384>=64,'two days of highly favorable forcing supports hurricane intensity');
 const t=w.tropical,rm=Math.max(22,Math.min(65,70-t.wind*.75));
 w.puffs.push({x:t.x,y:t.y,rx:60,ry:60,mass:10,top:12});
 assert.ok(hydrometeors(w,t.x,t.y,0).rain<hydrometeors(w,t.x+rm,t.y,0).rain*.1,'organized eye clears advected precipitation');
 const windy=new Atmosphere({...c,shear:40},()=>false),cold=new Atmosphere({...c,sst:22},()=>false),land=new Atmosphere(c,()=>true),stable=new Atmosphere({...c,lapse:4,dewpoint:5},()=>false);
 for(const blocked of [windy,cold,land,stable])assert.equal(blocked.tropicalSupport().support,0);
 const before=w.tropical.wind;w.isLand=()=>true;w.stepTropical(60);assert.ok(w.tropical.wind<before);
});

test('pressure development and categories use physical time and correct thresholds',()=>{
 assert.ok(Math.abs(bombThreshold(60)-24)<1e-10);assert.ok(bombThreshold(40)>17&&bombThreshold(40)<18);
 const w=new Atmosphere();w.advance(60);assert.equal(w.low.drop24,null);assert.ok(w.low.pressure<1010);
 for(const [wind,category]of [[34,'Tropical storm'],[64,'Category 1 hurricane'],[83,'Category 2 hurricane'],[96,'Category 3 hurricane'],[113,'Category 4 hurricane'],[137,'Category 5 hurricane']])assert.equal(hurricaneCategory(wind),category);
 const ll=geographic(45,-12,w.origin),xy=local(...ll,w.origin);assert.ok(Math.abs(xy[0]-45)<1e-8&&Math.abs(xy[1]+12)<1e-8);
});

test('scan cache contains coherent moments and cursor retrieves the displayed polar gate',()=>{
 const w=activeWorld(),site={lon:-97.28,lat:35.33},scan=radar.createScan(w,site,.5,'reflectivity');
 assert.equal(scan.values,scan.moments.reflectivity);assert.ok(scan.moments.velocity);
 const angle=225.5*Math.PI/180,ll=geographic(Math.sin(angle)*80.5,Math.cos(angle)*80.5,site),index=225*230+80;
 const value=scan.values[index];assert.equal(radar.scanValue(scan,...ll),Number.isFinite(value)?value:null);
 for(const p of Object.keys(radar.products)){assert.equal(radar.color(null,p),null);assert.equal(radar.color(NaN,p),null);}
});


test('cold pools expand after their parent dies, lift warm edges, and eventually fade',()=>{
 const life=require('./lifecycle'),w=new Atmosphere({forcing:0,heating:0});
 w.coldPools.push({id:1,source:999,x:0,y:0,radius:20,age:0,deficit:4,depth:600,speed:12,u:0,v:0});
 const before=w.coldPools[0].radius;life.stepPools(w,30);assert.equal(w.cells.length,0);assert.ok(w.coldPools[0].radius>before);
 const p=w.coldPools[0],edge=life.outflowAt(w,p.radius,0),center=life.outflowAt(w,0,0);
 assert.ok(edge.lift>center.lift);assert.ok(center.cooling>edge.cooling);
 const h=hydrometeors(w,p.radius,0,.1);assert.ok(h.reflectivity>0);assert.equal(h.rain,0);assert.equal(h.phase,6);
 assert.ok(hydrometeors(w,p.radius,0,3).reflectivity<h.reflectivity);
 life.stepPools(w,400);assert.equal(w.coldPools.length,0);
});
test('evolving convection initiates a new generation on persistent outflow',()=>{
 const w=activeWorld();assert.ok(w.outflowBirths>0);assert.ok(w.cells.some(c=>c.parentBoundary!==null));assert.ok(w.coldPools.length>0);assert.ok(w.cells.some(c=>c.stage==='Dissipating'));
});
test('connected organization is orientation independent and separate storms are not one MCS',()=>{
 const {groups}=require('./lifecycle');const cells=Array.from({length:6},(_,i)=>({id:i,x:i*45,y:0,rain:1}));
 assert.ok(groups(cells)[0].linear);assert.ok(groups(cells.map(c=>({...c,x:0,y:c.x})))[0].linear);
 assert.equal(groups(cells.map(c=>({...c,x:c.x*4}))).length,6);
});


test('national atmosphere covers both coasts and evolving upper waves renew pressure systems',()=>{
 const w=new Atmosphere(),syn=require('./synoptic');
 for(const [lon,lat] of [[-124,42],[-122,48],[-69,45],[-80,25]])assert.ok(w.point(lon,lat));
 const before=syn.jetY(w,0);w.minutes=720;syn.step(w,5);assert.notEqual(syn.jetY(w,0),before);assert.ok(w.pressureSystems.some(s=>s.kind==='L'));assert.ok(w.pressureSystems.some(s=>s.kind==='H'));
 const id=w.pressureSystems[0].id;w.pressureSystems[0].age=4320;syn.step(w,5);assert.ok(!w.pressureSystems.some(s=>s.id===id));
});


test('autonomous atmosphere evolves its ingredients without player forcing',()=>{
 const w=new Atmosphere({autonomous:true,seed:417}),before=w.config.shear;w.minutes=720;w.evolveClimate(120);assert.notEqual(w.config.shear,before);assert.ok(w.config.dewpoint<w.config.temperature);
});


test('TDWR inventory, fine range gates, Doppler range and single-polarization availability',()=>{
 const sites=require('./radar-sites.json');assert.equal(new Set(sites.map(s=>s.id)).size,sites.length);for(const id of ['KCAE','KAMX','TCLT'])assert.ok(sites.some(s=>s.id===id));assert.equal(sites.filter(s=>s.type==='TDWR').length,45);
 const site=sites.find(s=>s.id==='TCLT'),w=new Atmosphere();assert.equal(radar.geometry(site).spacing,.15);assert.equal(radar.sample(w,...geographic(91,0,site),site),null);
 const q=radar.sample(w,...geographic(20,0,site),site);assert.equal(q.zdr,null);assert.equal(q.cc,null);assert.equal(q.kdp,null);assert.equal(q.hydro,null);
});
test('forecast runs never advance observations and longer leads have greater uncertainty',()=>{
 const model=require('./forecast'),w=new Atmosphere({autonomous:true}),before=JSON.stringify({minutes:w.minutes,low:w.low,config:w.config,grid:w.grid.map(n=>n.temp)}),run=model.run(w),near=model.forecast(run,2),far=model.forecast(run,30);
 assert.ok(far.spread>near.spread);assert.ok(far.extended);assert.ok(!near.extended);assert.equal(far.valid,43200);assert.equal(far.pressure.length,w.grid.length);
 assert.equal(JSON.stringify({minutes:w.minutes,low:w.low,config:w.config,grid:w.grid.map(n=>n.temp)}),before);
});
test('loss of buoyant inflow fades rain while storm remnants remain',()=>{
 const w=new Atmosphere({temperature:10,dewpoint:-5,lapse:4,forcing:0,heating:0});w.cells.push({id:100,x:0,y:0,age:40,strength:1,rain:1,rotation:0,outflow:15,radius:20,u:4,v:5,path:0,top:10,hail:0});
 w.advance(60);assert.ok(w.cells.every(c=>c.strength<.2));assert.ok(w.puffs.length>0);assert.ok(w.coldPools.length>0);assert.equal(w.totalInitiated,0);
});


test('town profiles interpolate continuous local state and respond to gust-front winds',()=>{
 const w=new Atmosphere(),a=w.point(...geographic(1,0,w.origin)),b=w.point(...geographic(20,0,w.origin));assert.notEqual(a.e.temp,b.e.temp);assert.notDeepEqual(a.d.levels,b.d.levels);
 const before=w.point(...geographic(50,0,w.origin));w.coldPools.push({id:1,source:99,x:0,y:0,radius:50,age:30,deficit:3,depth:600,speed:16,u:0,v:0});
 const after=w.point(...geographic(50,0,w.origin));assert.ok(after.d.levels[0].u>before.d.levels[0].u+10);assert.ok(Math.abs(after.d.levels[24].u-before.d.levels[24].u)<.1);
});
