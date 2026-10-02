'use strict';
const {local,geographic,clamp}=require('./atmosphere');
const {hydrometeors}=require('./hydrometeors');
const reflectColors=['#5b528c','#6668b1','#2b8bbb','#00ada3','#00952d','#00cf27','#a5d41b','#f3ef00','#ffc500','#ff8b00','#f52a00','#d90000','#a10029','#e456d7','#faf0ff'];
const velocityColors=['#a381e4','#36d9e8','#79f4c3','#00ed24','#00a51a','#007812','#094a16','#72867b','#827272','#651414','#a71919','#e42c26','#ff7770','#ffb795','#ffe6b4'];
const products={
 reflectivity:{name:'Base reflectivity',unit:'dBZ',min:-5,max:70,colors:reflectColors,note:'Hydrometeor scattering proxy at the selected beam height; 1° / 1 km polar sampling.'},
 composite:{name:'Composite reflectivity',unit:'dBZ',min:-5,max:70,colors:reflectColors,note:'Maximum of sampled vertical levels, including the melting layer; may exceed the lowest tilt.'},
 velocity:{name:'Radial velocity',unit:'kt',min:-100,max:100,colors:velocityColors,note:'Green toward, red away. Wind is projected onto the radar beam; folding is optional.'},
 stormRelative:{name:'Storm-relative velocity',unit:'kt',min:-80,max:80,colors:velocityColors,note:'Precipitation-weighted modeled storm motion removed. Multiple storms can have different motions.'},
 zdr:{name:'Differential reflectivity',unit:'dB',min:-1,max:5,colors:['#515280','#679acf','#40b29d','#8bc63e','#f0ed44','#e79b33','#dc5747','#ba4996'],note:'Large drops increase ZDR; hail mix lowers it; melting-layer enhancement follows the sounding.'},
 cc:{name:'Correlation coefficient',unit:'ρhv',min:.7,max:1,colors:['#646484','#377ead','#36c5c5','#68d838','#ebeb42','#eb9746','#d34953','#e190d2'],note:'Uniform rain/snow near 1; mixed hail and melting hydrometeors lower CC. A low CC alone is not debris.'},
 kdp:{name:'Specific differential phase',unit:'°/km',min:0,max:8,colors:['#496481','#21ab9c','#7fce46','#eeee38','#e29b3f','#ed405a','#c036a3'],note:'Phase-gradient proxy from liquid water. Strong KDP with high Z supports heavy rainfall; hail complicates interpretation.'},
 spectrumWidth:{name:'Spectrum width',unit:'kt',min:0,max:20,colors:['#557482','#4bada7','#6bd457','#eee749','#e59332','#e34058','#c553cf'],note:'Velocity-spread proxy from turbulence and shear. It is not a direct tornado-intensity measurement.'},
 rainRate:{name:'Rain rate',unit:'mm/h',min:0,max:120,colors:['#385f9e','#208cd1','#13b889','#3ed531','#e7de2c','#ff921e','#e22238','#d86cce'],note:'Current modeled liquid precipitation rate. Frozen precipitation is masked; no reflectivity-only hail-to-rain conversion.'},
 accumulation:{name:'Storm accumulation',unit:'mm',min:0,max:150,colors:['#426087','#2ba5b1','#52c468','#c0de34','#f4bb3a','#e85d3d','#b93db2'],note:'Time-integrated surface liquid precipitation on the 70 km atmosphere grid; not rate multiplied by clock time.'},
 echoTop:{name:'18 dBZ echo top',unit:'km',min:0,max:18,colors:['#4774aa','#35beba','#8ade4e','#f4e243','#f49845','#de5467','#bc65d3'],note:'Highest sampled height meeting 18 dBZ. Finite vertical spacing limits precision.'},
 vil:{name:'VIL',unit:'kg/m²',min:0,max:70,colors:['#4c65a3','#399eba','#59c752','#d6e844','#f4a52f','#e24138','#dc5de4'],note:'Vertically integrated liquid proxy: 3.44×10⁻⁶ ∫ Z^(4/7) dz, with Z capped at 56 dBZ. Hail still introduces uncertainty.'},
 hydro:{name:'Hydrometeor type',unit:'class',min:0,max:6,colors:['#39c34e','#ebe438','#e955c9','#8ed6ff','#b3a2e1','#e6a3ad','#888d9d'],labels:['Rain','Heavy rain','Hail mix','Snow','Melting','Freezing rain','Boundary scatter'],note:'Illustrative phase from the modeled temperature column and hail content; not the operational NEXRAD HCA.'}
};
function geometry(radar){return radar.type==='TDWR'?{range:90,spacing:.15,rays:360}:{range:230,spacing:1,rays:360};}
function foldVelocity(v,nyquist){return((v+nyquist)%(2*nyquist)+2*nyquist)%(2*nyquist)-nyquist;}
function sample(w,lon,lat,radar,elevation=.5,options={}){
 const [rx,ry]=local(lon,lat,radar),range=Math.hypot(rx,ry);
 if(range>geometry(radar).range||range<1)return null;
 const [x,y]=local(lon,lat,w.origin),n=w.node(x,y);if(!n)return null;
 const angle=elevation*Math.PI/180,height=Math.sqrt(range*range+8494*8494+2*range*8494*Math.sin(angle))-8494;
 const h=hydrometeors(w,x,y,height);if(!h)return null;
 const visible=h.reflectivity>=-5&&height<=h.top;
 const levels=n.diagnostic.levels,index=Math.min(59,Math.floor(height*4)),a=clamp(height*4-index,0,1);
 const u=levels[index].u*(1-a)+levels[index+1].u*a+h.du,v=levels[index].v*(1-a)+levels[index+1].v*a+h.dv;
 const radial=(uu,vv)=>(uu*rx+vv*ry)/range*Math.cos(angle)*1.94384;
 const baseVelocity=radial(u,v),stormVelocity=radial(u-h.motion[0],v-h.motion[1]);
 let composite=-20,echoTop=null,vil=0;
 // Column products can be cached separately by the scan builder when only a base
 // moment is selected. They use actual height-dependent synthetic hydrometeors.
 if(options.column){
   for(let z=0;z<=16;z+=1){const q=hydrometeors(w,x,y,z);if(!q)continue;composite=Math.max(composite,q.reflectivity);if(q.reflectivity>=18&&z<=q.top)echoTop=z;if(z<q.top&&q.reflectivity>0&&q.phase!==6)vil+=3.44e-6*Math.pow(10,Math.min(56,q.reflectivity)/10*4/7)*1000;}
 }
 const result={reflectivity:visible?h.reflectivity:null,velocity:visible?(options.fold?foldVelocity(baseVelocity,options.nyquist||60):baseVelocity):null,
 stormRelative:visible?(options.fold?foldVelocity(stormVelocity,options.nyquist||60):stormVelocity):null,
 zdr:visible&&radar.type!=='TDWR'?h.zdr:null,cc:visible&&radar.type!=='TDWR'?h.cc:null,kdp:visible&&radar.type!=='TDWR'?h.kdp:null,spectrumWidth:visible?h.turbulence*1.94384:null,
 rainRate:visible&&h.phase<3?h.rain:null,hydro:visible&&radar.type!=='TDWR'?h.phase:null,
 accumulation:n.rain>.01?n.rain:null,composite:composite>=-5?composite:null,echoTop,vil:vil>.1?vil:null,range,height};
 return result;
}
function color(value,product){if(value===null||!Number.isFinite(value))return null;const p=products[product],i=p.labels?Math.round(value):Math.floor(clamp((value-p.min)/(p.max-p.min),0,.999999)*p.colors.length);return p.colors[i];}
function createScan(w,radar,elevation,product,options={}){
 const {range,spacing,rays}=geometry(radar),gates=Math.ceil(range/spacing);
 const column=['composite','echoTop','vil'].includes(product);
 const keys=column?['composite','echoTop','vil']:Object.keys(products).filter(k=>!['composite','echoTop','vil'].includes(k));
 const moments={};for(const key of keys){moments[key]=new Float32Array(rays*gates);moments[key].fill(NaN);}
 // Column products use 2 km gates to keep the browser responsive; base products 1 km.
 const stride=column?2:1;
 for(let a=0;a<rays;a++){
   const angle=(a+.5)*2*Math.PI/rays,dx=Math.sin(angle),dy=Math.cos(angle);
   for(let r=Math.ceil(1/spacing);r<gates;r+=stride){
     const ll=geographic(dx*(r+.5)*spacing,dy*(r+.5)*spacing,radar);
     const s=sample(w,...ll,radar,elevation,{...options,column});
     if(s)for(const key of keys){const value=s[key];if(value!==null&&value!==undefined)for(let k=0;k<stride&&r+k<gates;k++)moments[key][a*gates+r+k]=value;}
   }
 }
 return {rays,gates,range,spacing,values:moments[product],moments,radar,elevation,product};
}
function scanValue(scan,lon,lat){const [x,y]=local(lon,lat,scan.radar),r=Math.floor(Math.hypot(x,y)/scan.spacing);if(r>=scan.gates||r<Math.ceil(1/scan.spacing))return null;const a=Math.floor(((Math.atan2(x,y)*180/Math.PI+360)%360)/360*scan.rays);const v=scan.values[a*scan.gates+r];return Number.isFinite(v)?v:null;}
module.exports={products,sample,color,createScan,scanValue,foldVelocity,geometry};
