'use strict';
// Idealized, deterministic teaching model. Distances are km; winds are knots.
// All moments share a precipitation/wind field, not independent random textures.
const RAD = Math.PI / 180;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const gaussian = (x, y, a, b) => Math.exp(-((x / a) ** 2 + (y / b) ** 2));
const scenarios = {
  supercell: { name:'Classic supercell', lon:-97.7, lat:35.8, site:'KTLX', motion:[32,14], pressure:1000, note:'Forward-flank hail core, southwest hook and cyclonic mesocyclone. A hook alone does not establish a tornado.' },
  qlcs: { name:'QLCS / squall line', lon:-93.6, lat:41.5, site:'KDMX', motion:[38,8], pressure:998, note:'Bowed convective leading edge, rear inflow and weaker trailing stratiform precipitation.' },
  mcs: { name:'Mesoscale convective system', lon:-93.8, lat:41.7, site:'KDMX', motion:[25,8], pressure:1004, note:'Organized convective band with a broad trailing stratiform shield. QLCS is one form of MCS.' },
  rain: { name:'Stratiform rain', lon:-84.7, lat:33.6, site:'KFFC', motion:[18,10], pressure:1008, note:'Broad, relatively uniform precipitation with embedded heavier bands. Radar detects hydrometeors, not cloud outlines.' },
  cells: { name:'Cumulonimbus / multicells', lon:-97.6, lat:35.7, site:'KTLX', motion:[20,8], pressure:1006, note:'Several precipitating cumulonimbus cells with strong cores and weaker surrounding rain; no imposed mesocyclone.' },
  tropical: { name:'Tropical storm', lon:-93.4, lat:29.3, site:'KLCH', motion:[-5,10], pressure:992, wind:50, note:'50 kt maximum sustained surface wind. Asymmetric rainbands and a broad circulation; no required clear eye.' },
  hurricane: { name:'Hurricane · Category 2', lon:-93.4, lat:29.3, site:'KLCH', motion:[-5,10], pressure:965, wind:90, note:'90 kt maximum sustained surface wind. Eye, eyewall and spiral rainbands. Category uses sustained wind, not pressure.' },
  noreaster: { name:'Nor’easter', lon:-70.8, lat:40.7, site:'KBOX', motion:[15,22], pressure:982, drop:12, note:'Coastal extratropical low with northeasterly winds northwest of its center, comma-head snow and a dry slot.' },
  bomb: { name:'Explosively deepening cyclone', lon:-70.8, lat:40.7, site:'KBOX', motion:[15,22], pressure:970, drop:30, note:'30 hPa pressure fall in the preceding 24 hours exceeds the latitude-adjusted bombogenesis threshold. This is a development rate, not a separate storm type.' }
};
const reflectColors = ['#304ca3','#248de1','#27be91','#28bf39','#119423','#dddd28','#ffb329','#fa6920','#e32b28','#ae173c','#e749dc','#eee5ff'];
const products = {
  reflectivity:{name:'Base reflectivity',unit:'dBZ',min:5,max:70,colors:reflectColors,note:'Sampled at the selected elevation; distant shallow precipitation may lie below the beam.'},
  composite:{name:'Composite reflectivity',unit:'dBZ',min:5,max:70,colors:reflectColors,note:'Idealized column maximum; not a measured multi-tilt volume.'},
  velocity:{name:'Radial velocity',unit:'kt',min:-100,max:100,colors:['#36ffb5','#00b753','#006337','#b5b8bc','#852424','#ef3939','#ffb4c0'],note:'Green toward, red away from the radar. Dealiased idealized winds; perpendicular motion is invisible.'},
  stormRelative:{name:'Storm-relative velocity',unit:'kt',min:-80,max:80,colors:['#36ffb5','#00b753','#006337','#b5b8bc','#852424','#ef3939','#ffb4c0'],note:'Scenario translation is subtracted before projecting the wind onto the radar beam.'},
  zdr:{name:'Differential reflectivity',unit:'dB',min:-1,max:5,colors:['#7566b2','#7093cc','#3dcc9a','#f5e03b','#ef7841','#de448a'],note:'Idealized drop-shape proxy: large raindrops positive, tumbling hail near zero.'},
  cc:{name:'Correlation coefficient',unit:'ρhv',min:.8,max:1,colors:['#48549c','#44b6be','#74c964','#ead446','#ef8434','#cf3b76'],note:'Uniform rain/snow near 1; mixed-phase and hail lower. No automatic tornado-debris claim.'},
  kdp:{name:'Specific differential phase',unit:'°/km',min:0,max:6,colors:['#46618e','#25a48e','#72ce46','#f7db40','#ef773d','#cc3581'],note:'Liquid-water proxy; hail and frozen precipitation are not interpreted as heavy rain.'},
  rainRate:{name:'Rain rate estimate',unit:'mm/h',min:0,max:120,colors:['#395786','#29a3b0','#37c960','#e7dc3b','#f38730','#d63678'],note:'Z = 200 R^1.6 approximation, capped in hail. Snow is masked; not accumulated rainfall.'},
  echoTop:{name:'18 dBZ echo top',unit:'km',min:0,max:18,colors:['#3d639e','#2fcbb9','#98d849','#f3c948','#ed6949','#d648ae'],note:'Height of the idealized 18 dBZ contour above radar level; not a retrieved radar volume.'},
  hydro:{name:'Hydrometeor type',unit:'class',min:0,max:4,colors:['#41c75e','#e8c33a','#eb55af','#83d7ff','#aaa0e6'],labels:['Rain','Heavy rain','Hail mix','Snow','Wet snow'],note:'Illustrative phase classification from the scenario field, not an operational HCA.'}
};
function local(lon, lat, origin) { return [(lon-origin.lon)*111.195*Math.cos(origin.lat*RAD),(lat-origin.lat)*111.195]; }
function geographic(x,y,origin) { return [origin.lon+x/(111.195*Math.cos(origin.lat*RAD)),origin.lat+y/111.195]; }
function centerAt(s, minutes) { const [u,v]=s.motion; const [lon,lat]=geographic(u*1.852*minutes/60,v*1.852*minutes/60,s); return {lon,lat}; }
function bombThreshold(lat) { return 24*Math.sin(Math.abs(lat)*RAD)/Math.sin(60*RAD); }
function hurricaneCategory(wind) { return wind<34?'Depression':wind<64?'Tropical storm':wind<83?'Category 1':wind<96?'Category 2':wind<113?'Category 3':wind<137?'Category 4':'Category 5'; }
function field(x,y,kind,minutes=0) {
  const s=scenarios[kind];
  let z=0,u=s.motion[0],v=s.motion[1],hail=0,phase=0,rotation=0;
  const texture=1.2*Math.sin(x*.13+y*.06)+.8*Math.sin(y*.24-x*.035);
  const pulse=1+.04*Math.sin(minutes/16);
  if(kind==='supercell') {
    const core=gaussian(x-9,y-13,17,21);
    const shield=gaussian(x-25,y-22,49,31);
    // Open hook wraps clockwise in image space around an echo-poor inflow notch.
    const hx=x+9,hy=y+10,r=Math.hypot(hx,hy),a=Math.atan2(hy,hx);
    const arc=(a>.65 || a<-.30)?Math.exp(-(((r-16)/4.5)**2)):0;
    z=Math.max(66*core,39*shield,51*arc);
    hail=core;
    const speed=43*(r/9)*Math.exp(1-r/9);
    u+=-hy/Math.max(r,1)*speed; v+=hx/Math.max(r,1)*speed; rotation=speed;
  } else if(kind==='qlcs'||kind==='mcs') {
    const bow=26*Math.exp(-((y/90)**2)),front=x-bow-7*Math.sin(y/39);
    const envelope=Math.exp(-((y/(kind==='mcs'?145:125))**4));
    const cores=(50+10*Math.cos(y/13)**2)*Math.exp(-((front/12)**2))*envelope;
    const shield=36*gaussian(front+62,y,73,160);
    z=Math.max(cores,shield); hail=clamp((cores-52)/20,0,.7);
    u+=24*gaussian(front+20,y,37,100); v+=6*Math.sin(y/24)*Math.exp(-((front/22)**2));
  } else if(kind==='cells') {
    [[-55,-32,20],[-8,24,16],[42,-5,24],[68,62,15]].forEach(([cx,cy,r])=>{
      const g=gaussian(x-cx,y-cy,r,r*1.25); z=Math.max(z,61*g,28*gaussian(x-cx-10,y-cy-9,r*1.8,r*1.6));hail=Math.max(hail,g*.7);
    });
  } else if(kind==='rain') {
    z=34*gaussian(x,y,155,100)+7*gaussian(x+y*.7-20,y,23,110);
  } else if(kind==='hurricane'||kind==='tropical') {
    const r=Math.hypot(x,y),a=Math.atan2(y,x),rm=kind==='hurricane'?28:60;
    const bands=(.5+.5*Math.cos(a*3+r*.055))**7;
    const envelope=Math.exp(-((r/210)**2));
    const eye=kind==='hurricane'?1-Math.exp(-((r/19)**4)):1;
    z=eye*Math.max(55*Math.exp(-(((r-rm)/12)**2)), (24+24*bands)*envelope);
    if(kind==='tropical') z=(24+22*bands)*envelope*(.85+.15*Math.sin(a));
    const speed=s.wind*Math.min(r/rm,(rm/Math.max(r,1))**.65);
    // Counterclockwise NH circulation with modest inward surface flow.
    u=-y/Math.max(r,1)*speed-x/Math.max(r,1)*speed*.12;
    v=x/Math.max(r,1)*speed-y/Math.max(r,1)*speed*.12;
  } else {
    const r=Math.hypot(x,y),a=Math.atan2(y,x);
    const head=39*Math.exp(-(((r-95)/55)**2))*( .55+.45*Math.sin(a));
    const tail=43*gaussian(x-70-y*.4,y+80,30,170);
    const dry=1-.92*gaussian(x-30,y+25,60,45);
    z=Math.max(head,tail)*dry;
    phase=x<15?(x<-25?3:4):0;
    const speed=(kind==='bomb'?65:45)*Math.min(r/75,75/Math.max(r,1));
    u=-y/Math.max(r,1)*speed-x/Math.max(r,1)*speed*.15;
    v=x/Math.max(r,1)*speed-y/Math.max(r,1)*speed*.15;
  }
  z=clamp(z*pulse+(z>5?texture:0),0,70);
  const top=kind==='rain'?5.5:kind==='noreaster'||kind==='bomb'?7:kind==='hurricane'||kind==='tropical'?15:16;
  const echoTop=clamp(top*Math.sqrt(z/65),0,top);
  const hydro=phase|| (hail>.7?2:z>42?1:0);
  const rainRate=phase?0:Math.min(hydro===2?55:150,(10**(z/10)/200)**(1/1.6));
  return {z,u,v,hail,hydro,echoTop,rotation,rainRate,
    zdr:phase===3?.3:phase===4?.8:clamp(.35+rainRate*.035-hail*2,-.5,4.5),
    cc:clamp(.995-hail*.065-(phase===4?.09:0),.82,.999),kdp:phase?0:clamp(rainRate*.045,0,6)};
}
function sample(lon,lat,kind,minutes,radar,elevation=.5) {
  const [rx,ry]=local(lon,lat,radar),range=Math.hypot(rx,ry);
  if(range>230||range<1)return null;
  const s=scenarios[kind], [x,y]=local(lon,lat,centerAt(s,minutes));
  const f=field(x,y,kind,minutes);
  const height=Math.sqrt(range*range+(8494)**2+2*range*8494*Math.sin(elevation*RAD))-8494;
  const base=f.z-Math.max(0,height-f.echoTop*.5)*7;
  const visible=base>=5&&height<=f.echoTop;
  const radial=(u,v)=>(u*rx+v*ry)/range*Math.cos(elevation*RAD);
  return {reflectivity:visible?base:null,composite:f.z>=5?f.z:null,
    velocity:visible?radial(f.u,f.v):null,stormRelative:visible?radial(f.u-s.motion[0],f.v-s.motion[1]):null,
    zdr:visible?f.zdr:null,cc:visible?f.cc:null,kdp:visible?f.kdp:null,
    rainRate:visible&&f.hydro<3?f.rainRate:null,echoTop:f.z>=18?f.echoTop:null,hydro:visible?f.hydro:null,range,height};
}
function color(value,product) {
  const p=products[product];
  if(value===null||!Number.isFinite(value))return null;
  const index=p.labels?Math.round(value):Math.floor(clamp((value-p.min)/(p.max-p.min),0,.99999)*p.colors.length);
  return p.colors[index];
}
module.exports={scenarios,products,local,geographic,centerAt,bombThreshold,hurricaneCategory,field,sample,color};

