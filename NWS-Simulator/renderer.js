'use strict';
const {ipcRenderer}=require('electron');
const d3=require('d3'),topojson=require('topojson-client'),us=require('us-atlas/states-10m.json');
const weather=require('./weather'),physics=require('./atmosphere'),{cities,radarSites}=require('./locations');
const excluded=new Set(['02','15','60','66','69','72','78']);
const contiguous={type:'FeatureCollection',features:topojson.feature(us,us.objects.states).features.filter(s=>!excluded.has(String(s.id).padStart(2,'0')))};
const allStates=topojson.feature(us,us.objects.states),allLand=topojson.merge(us,us.objects.states.geometries);
const nation=topojson.merge(us,us.objects.states.geometries.filter(s=>!excluded.has(String(s.id).padStart(2,'0'))));
const $=id=>document.getElementById(id);
const riskColors=['transparent','#bfe7bd','#5f9d5c','#ffe16a','#ff9d58','#e85c58','#d650ca'];
const riskNames=['NONE','TSTM','MRGL','SLGT','ENH','MDT','HIGH'];
function newWeather(area={}){const now=new Date(),yearStart=new Date(now.getFullYear(),0,0);return new physics.Atmosphere({autonomous:true,seed:Math.floor(Math.random()*1000000),epochMs:Date.now()-14400000,startHour:(now.getHours()+20)%24,startDay:Math.floor((now-yearStart)/86400000),...area},isLand);}
let world=newWeather(),svg,group,projection,path,zoom,currentTransform=d3.zoomIdentity;
let radarProduct='reflectivity',selectedRadar=radarSites.find(s=>s.id==='KTLX'),radarEnabled=false,radarElevation=.5,radarScan=null;
let jetEnabled=false,boundariesVisible=false,crosshairEnabled=false,simulationPlaying=false,busy=false;
let activeDay=null,outlookMetric='category',outlookCache={},environmentProduct='none',selectedPoint=null,scanCache=new Map();
const weatherAreas=new Map([['CONUS',world]]);let activeArea='CONUS';
let radarGeometry=null;let radarHistory=new Map(),looping=false,loopIndex=0,nextScanAt=Date.now()+240000,weatherReady=false;let forecastVisible=false,forecastRun=null;
function isLand(lon,lat){
  if(d3.geoContains(nation,[lon,lat]))return true;
  // The CONUS basemap has no foreign shorelines. Restrict ocean heat exchange
  // to conservative Gulf/Atlantic water polygons instead of treating Mexico as ocean.
  const gulf=lon>-96.5&&lon<-82&&lat>23&&lat<30.6;
  const atlantic=lon>-75&&lon<-58&&lat>25&&lat<46;
  return !(gulf||atlantic);
}
function drawMenuMap(){const width=innerWidth,height=innerHeight,p=d3.geoAlbersUsa().fitExtent([[width*.1,height*.18],[width*.9,height*.82]],contiguous);d3.select('#menu-map').attr('viewBox',`0 0 ${width} ${height}`).selectAll('path').data(contiguous.features).join('path').attr('d',d3.geoPath(p)).attr('fill','#426f7b').attr('stroke','#c2e1e0').attr('stroke-width',.6);}
function closePanels(except=null){['spc','jet','radar','environment','forecast'].forEach(name=>{$(`${name}-panel`).classList.toggle('hidden',`${name}-panel`!==except);$(`${name}-button`).classList.toggle('active',`${name}-panel`===except);});}
function initializeMap(){
 const old=currentTransform;svg=d3.select('#weather-map');svg.attr('viewBox',`0 0 ${innerWidth} ${innerHeight}`).selectAll('*').remove();
 projection=activeArea==='CONUS'?d3.geoAlbers().fitExtent([[70,96],[innerWidth-45,innerHeight-70]],contiguous):d3.geoMercator().rotate([-world.origin.lon,0]).center([0,world.origin.lat]).scale(950).translate([innerWidth*.62,innerHeight*.54]);path=d3.geoPath(projection);
 const defs=svg.append('defs');defs.append('clipPath').attr('id','conus-land-clip').append('path').datum(allLand).attr('d',path);
 group=svg.append('g').attr('class','map-layer');
 group.append('g').attr('class','state-layer').selectAll('path').data(allStates.features).join('path').attr('class','state').attr('d',path);
 group.append('g').attr('class','environment-layer');group.append('g').attr('class','forecast-layer');group.append('g').attr('class','outlook-layer').attr('clip-path','url(#conus-land-clip)');group.append('g').attr('class','radar-layer');
 group.append('g').attr('class','state-boundary-layer').selectAll('path').data(allStates.features).join('path').attr('class','state-boundary').attr('d',path);
 group.append('g').attr('class','boundary-layer');group.append('g').attr('class','jet-layer');group.append('g').attr('class','city-layer');group.append('g').attr('class','domain-layer');
 zoom=d3.zoom().scaleExtent([.75,16]).on('zoom',()=>{currentTransform=d3.event.transform;group.attr('transform',currentTransform);rescaleAnnotations();$('coordinates').textContent=`${world.origin.name.toUpperCase()} · ${currentTransform.k.toFixed(1)}×`;});
 svg.call(zoom).on('dblclick.zoom',null);svg.call(zoom.transform,old);
 drawDomain();drawCities();drawEnvironment();paintOutlook();drawRadar();drawBoundaries();drawJetStream();drawForecast();
}
function drawDomain(){if(group)group.select('.domain-layer').selectAll('*').remove();}
function drawCities(){const l=group.select('.city-layer');l.selectAll('*').remove();cities.forEach(c=>{const [x,y]=physics.local(c.lon,c.lat,world.origin);const p=projection([c.lon,c.lat]);l.append('text').attr('x',p[0]).attr('y',p[1]).attr('data-size',9).text(c.name);});rescaleAnnotations();}
function rescaleAnnotations(){if(!group)return;const k=currentTransform.k;group.selectAll('[data-size]').attr('font-size',function(){return Number(this.dataset.size)/k;});group.selectAll('.radar-marker').attr('r',2.8/k);group.selectAll('.front-symbol').attr('transform',function(){return `${this.dataset.position} scale(${1/k},${Number(this.dataset.flip)/k})`;});group.select('.city-layer').attr('opacity',k>2.5?.75:0);}
function gridPath(){return d3.geoPath(d3.geoTransform({point(x,y){const p=projection(physics.geographic((x-.5-world.cx)*world.dx,(y-.5-world.cy)*world.dx,world.origin));this.stream.point(p[0],p[1]);}}));}
function contours(layer,values,thresholds,color,opacity=.6){const p=gridPath();d3.contours().size([world.n,world.ny]).thresholds(thresholds)(values).forEach(shape=>{layer.append('path').attr('d',p(shape)).attr('fill',color(shape.value)).attr('fill-opacity',opacity).attr('stroke',color(shape.value)).attr('stroke-width',.7).attr('vector-effect','non-scaling-stroke');});}
function smoothGrid(values){
 let result=Array.from(values);
 for(let pass=0;pass<2;pass++){
  const next=new Float32Array(result.length);
  for(let y=0;y<world.ny;y++)for(let x=0;x<world.n;x++){
   let sum=0,weight=0;
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const xx=x+dx,yy=y+dy;if(xx<0||xx>=world.n||yy<0||yy>=world.ny)continue;
    const k=(dx===0?2:1)*(dy===0?2:1);sum+=result[yy*world.n+xx]*k;weight+=k;
   }next[y*world.n+x]=sum/weight;
  }result=next;
 }return result;
}
function drawEnvironment(){
 if(!group)return;const l=group.select('.environment-layer');l.selectAll('*').remove();
 const definitions={cape:{key:n=>n.diagnostic.cape,steps:[250,500,1000,2000,3000,4000],unit:'J/kg'},cin:{key:n=>n.diagnostic.cin,steps:[25,50,100,200,400],unit:'J/kg inhibition'},temperature:{key:n=>n.temp,steps:[-10,0,10,20,25,30,35],unit:'°C'},dewpoint:{key:n=>n.dew,steps:[0,5,10,15,18,21,24],unit:'°C'},shear:{key:n=>n.diagnostic.shear*1.94384,steps:[10,20,30,40,50,60],unit:'kt · 0–6 km'}};
 const def=definitions[environmentProduct];if(!def){$('environment-legend').textContent='Environment overlay off';return;}
 const palette=['#30639f','#299b97','#68bb49','#e4d74a','#ec9143','#dc4a53','#c562c6'];
 contours(l,world.grid.map(def.key),def.steps,v=>palette[def.steps.indexOf(v)],.45);
 $('environment-legend').textContent=`${environmentProduct.toUpperCase()} · ${def.steps.join(' / ')} ${def.unit}`;
}
function paintOutlook(){
 if(!group)return;const l=group.select('.outlook-layer');l.selectAll('*').remove();$('game-screen').classList.toggle('spc-map-mode',!!activeDay);
 group.select('.radar-layer').attr('opacity',activeDay?.16:1);group.select('.environment-layer').attr('opacity',activeDay?.2:1);
 if(!activeDay){$('outlook-copy').textContent='Choose a forecast day. Areas are derived from the evolving environment; no storm type is assigned.';return;}
 const key=`${world.minutes}:${activeDay}`;const data=outlookCache[key]||(outlookCache[key]=world.outlook(activeDay));
 const values=smoothGrid(outlookMetric==='category'?data.categories:data.hazards.map(h=>h[outlookMetric]));
 const thresholds=outlookMetric==='category'?[.6,1.6,2.6,3.6,4.6,5.6]:[.1,.25,.45,.65,.85];
 contours(l,values,thresholds,v=>outlookMetric==='category'?riskColors[Math.ceil(v)]:riskColors[thresholds.indexOf(v)+2],.76);
 const shapes=d3.contours().size([world.n,world.ny]).thresholds(thresholds)(values),p=gridPath();
 const populated=shapes.filter(s=>s.coordinates.length);
 const labeled=populated.slice(-1);labeled.forEach(shape=>{const center=p.centroid(shape);if(!Number.isFinite(center[0]))return;l.append('text').attr('x',center[0]).attr('y',center[1]).attr('data-size',11).attr('class','outlook-label').text(outlookMetric==='category'?riskNames[Math.ceil(shape.value)]:['LOW','GUARDED','ELEVATED','HIGH','VERY HIGH'][thresholds.indexOf(shape.value)]);});
 const categorical=smoothGrid(data.categories),peak=Math.max(...categorical),max=[.6,1.6,2.6,3.6,4.6,5.6].filter(t=>peak>=t).length,best=data.hazards.reduce((a,h)=>{for(const k of ['tornado','hail','wind','supercell','organization'])a[k]=Math.max(a[k]||0,h[k]);return a;},{});
 const score=v=>v>.65?'high':v>.35?'elevated':v>.1?'limited':'low';
 $('outlook-copy').textContent=`Day ${activeDay}: ${riskNames[max]} ingredient envelope. Tornado ${score(best.tornado)}; hail ${score(best.hail)}; wind ${score(best.wind)}. Initiation still depends on lift overcoming the cap.`;
 $('outlook-details').textContent=`Supercell support: ${score(best.supercell)} · Organized line/MCS support: ${score(best.organization)}. These are uncalibrated favorability scores, not SPC probabilities. Day ${activeDay} assumes the current synoptic forcing persists through that 24-hour window.`;
 rescaleAnnotations();
}
function drawForecast(){
 if(!group)return;const layer=group.select('.forecast-layer');layer.selectAll('*').remove();if(!forecastVisible)return;
 const model=require('./forecast'),cycle=Math.floor((world.minutes+world.config.startHour*60)/360);if(!forecastRun||forecastRun.cycle!==cycle)forecastRun=model.run(world);
 const day=Number($('forecast-day').value)||1,data=model.forecast(forecastRun,day),field=$('forecast-field').value;
 const steps=field==='temperature'?[-30,-10,0,10,20,30,40]:field==='pressure'?[960,980,995,1005,1015,1025,1035]:[.05,.15,.3,.5,.7,.9];const colors=['#6d6299','#558bcc','#56babd','#70bc75','#e4d16c','#e19260','#b85368'];
 layer.attr('clip-path','url(#conus-land-clip)');contours(layer,smoothGrid(data[field]),steps,v=>colors[steps.indexOf(v)],.65);
 $('forecast-summary').textContent=(data.extended?'EXPERIMENTAL EXTENDED OUTLOOK':'GFS-STYLE SIMULATED GUIDANCE')+' · Run '+formatTime(forecastRun.issued)+' · Valid '+formatTime(data.valid)+' · Day '+day+'. '+data.confidence+'.';
 $('forecast-spread').textContent='Temperature uncertainty proxy ±'+data.spread.toFixed(1)+' °C. This is not a calibrated confidence interval. Map levels: '+steps.join(' / ')+(field==='pressure'?' hPa':field==='temperature'?' °C':' favorability index')+'. Forecasts do not guarantee individual storms.';
}
function radarLegend(){const tdwr=selectedRadar.type==='TDWR';if(tdwr&&['zdr','cc','kdp','hydro'].includes(radarProduct))radarProduct='reflectivity';document.querySelectorAll('.radar-product').forEach(b=>{b.disabled=tdwr&&['zdr','cc','kdp','hydro'].includes(b.dataset.product);});$('radar-hardware').textContent=tdwr?'TDWR airport scan · 90 km · 150 m range gates / 1° azimuth. Single polarization; long-range reflectivity mode is not included.':'NEXRAD · 230 km · 1 km / 1° display sampling. Synthetic observations.';const p=weather.products[radarProduct];$('radar-unit').textContent=p.unit;$('radar-scale').textContent=p.labels?p.labels.join(' · '):`${p.min}     ${(p.min+p.max)/2}     ${p.max}`;document.querySelector('.radar-key i').style.background=`linear-gradient(to right,${p.colors.join(',')})`;$('product-description').textContent=p.note;document.querySelectorAll('.radar-product').forEach(b=>b.classList.toggle('selected',b.dataset.product===radarProduct));$('radar-toggle').textContent=radarEnabled?'HIDE RADAR':'SHOW RADAR';}
function getScan(){const fold=$('velocity-fold').checked,column=['composite','echoTop','vil'].includes(radarProduct),key=`${world.minutes}:${selectedRadar.id}:${radarElevation}:${column}:${fold}`;if(!scanCache.has(key)){scanCache.set(key,weather.createScan(world,selectedRadar,radarElevation,radarProduct,{fold,nyquist:60}));if(scanCache.size>8)scanCache.delete(scanCache.keys().next().value);}const scan=scanCache.get(key);return {...scan,product:radarProduct,values:scan.moments[radarProduct]};}
function drawRadar(){
 if(!group)return;const l=group.select('.radar-layer');l.selectAll('*').remove();radarLegend();if(!radarEnabled)return;
 const liveScan=getScan(),historyKey=selectedRadar.id+':'+radarProduct+':'+radarElevation+':'+$('velocity-fold').checked;
 let history=radarHistory.get(historyKey);if(!history){history=[];radarHistory.set(historyKey,history);}if(!history.length||history.at(-1).minute!==world.minutes){history.push({minute:world.minutes,scan:{...liveScan,values:new Float32Array(liveScan.values),moments:null}});if(history.length>12)history.shift();}
 const frame=looping?history[loopIndex%history.length]:history.at(-1);radarScan=frame.scan;$('simulation-clock').textContent=(looping?'HISTORY · ':'LATEST · ')+formatTime(frame.minute);const circle=d3.geoCircle().center([selectedRadar.lon,selectedRadar.lat]).radius(weather.geometry(selectedRadar).range/111.195)(),bounds=path.bounds(circle),width=bounds[1][0]-bounds[0][0],height=bounds[1][1]-bounds[0][1],size=620;
 const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(size,size);
 const palette=Object.fromEntries(weather.products[radarProduct].colors.map(c=>[c,[parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)]]));
 const geometryKey=`${selectedRadar.id}:${projection.scale()}:${projection.translate()}`;
 if(radarGeometry?.key!==geometryKey){
  const indices=new Int32Array(size*size);indices.fill(-1);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const ll=projection.invert([bounds[0][0]+(x+.5)/size*width,bounds[0][1]+(y+.5)/size*height]);if(!ll)continue;
   const [rx,ry]=physics.local(...ll,selectedRadar),r=Math.floor(Math.hypot(rx,ry)/radarScan.spacing),a=Math.floor(((Math.atan2(rx,ry)*180/Math.PI+360)%360)/360*radarScan.rays);
   if(r>=Math.ceil(1/radarScan.spacing)&&r<radarScan.gates)indices[y*size+x]=a*radarScan.gates+r;
  }radarGeometry={key:geometryKey,indices};
 }
 for(let index=0;index<size*size;index++){
  const gate=radarGeometry.indices[index];if(gate<0)continue;const c=weather.color(radarScan.values[gate],radarProduct);if(!c)continue;
  const i=index*4;pixels.data[i]=palette[c][0];pixels.data[i+1]=palette[c][1];pixels.data[i+2]=palette[c][2];pixels.data[i+3]=240;
 }
 ctx.putImageData(pixels,0,0);l.append('image').attr('href',canvas.toDataURL()).attr('x',bounds[0][0]).attr('y',bounds[0][1]).attr('width',width).attr('height',height).style('image-rendering','pixelated');
 (selectedRadar.type==='TDWR'?[15,30,60,90]:[50,100,150,230]).forEach(km=>l.append('path').datum(d3.geoCircle().center([selectedRadar.lon,selectedRadar.lat]).radius(km/111.195)()).attr('d',path).attr('fill','none').attr('stroke','#c8e4e6').attr('stroke-opacity',.18).attr('stroke-width',.6).attr('vector-effect','non-scaling-stroke'));
 const p=projection([selectedRadar.lon,selectedRadar.lat]);l.append('circle').attr('class','radar-marker').attr('cx',p[0]).attr('cy',p[1]).attr('fill','#eee');l.append('text').attr('x',p[0]+1).attr('y',p[1]-1).attr('data-size',10).attr('fill','#fff').text(selectedRadar.id);rescaleAnnotations();
}
function drawBoundaries(){
 if(!group)return;const l=group.select('.boundary-layer');l.selectAll('*').remove();if(!boundariesVisible)return;
 const point=(x,y)=>projection(physics.geographic(x,y,world.origin));
 const pressure=world.grid.map(n=>world.pressureAt(n.x,n.y));const gp=gridPath();
 d3.contours().size([world.n,world.ny]).thresholds(d3.range(948,1033,4))(pressure).forEach(shape=>{l.append('path').attr('d',gp(shape)).attr('fill','none').attr('stroke','#d4d7b8').attr('stroke-opacity',.5).attr('stroke-width',.75);const ring=shape.coordinates[0]?.[0];if(ring&&ring.length>15){const pos=point((ring[10][0]-.5-world.cx)*world.dx,(ring[10][1]-.5-world.cy)*world.dx);l.append('text').attr('x',pos[0]).attr('y',pos[1]).attr('data-size',9).attr('fill','#ddd').text(shape.value);}});
 function front(name,color,coords,type){
  const pts=coords.map(p=>point(...p)),line=l.append('path').attr('d',d3.line().curve(d3.curveCatmullRom)(pts)).attr('fill','none').attr('stroke',color).attr('stroke-width',1.6);
  if(type==='trough'||type==='dryline')line.attr('stroke-dasharray',type==='trough'?'7 5':'3 3');
  else {const node=line.node(),len=node.getTotalLength();for(let r=7,i=0;r<len;r+=12,i++){const p=node.getPointAtLength(r),q=node.getPointAtLength(r+1),angle=Math.atan2(q.y-p.y,q.x-p.x)*180/Math.PI;const warm=type==='warm'||(type==='occluded'&&i%2);l.append('path').attr('class','front-symbol').attr('data-position',`translate(${p.x},${p.y}) rotate(${angle})`).attr('data-flip',1).attr('d',warm?'M -4 0 A 4 4 0 0 1 4 0 Z':'M -4 0 L 0 -6 L 4 0 Z').attr('fill',color);}}
  const p=pts[1];l.append('text').attr('x',p[0]+3).attr('y',p[1]-3).attr('data-size',10).attr('fill',color).text(name);
 }
 for(const pool of world.coldPools){const pts=d3.range(0,361,6).map(a=>point(pool.x+pool.radius*Math.cos(a*Math.PI/180),pool.y+pool.radius*Math.sin(a*Math.PI/180)));l.append('path').attr('d',d3.line()(pts)).attr('fill','none').attr('stroke','#65ddd0').attr('stroke-opacity',Math.min(.8,pool.deficit/3)).attr('stroke-dasharray','4 3');if(pool.deficit>1){const p=pts[0];l.append('text').attr('x',p[0]).attr('y',p[1]).attr('data-size',8).attr('fill','#65ddd0').text('OUTFLOW '+pool.id);}}
 const low=world.low,c=world.config;
 if(c.forcing>.05&&low.pressure<1016){
  const pts=[-450,-200,0,low.y].map(y=>[world.frontX(y),y]);
  if(c.contrast>4){front('COLD FRONT','#65aaff',pts,'cold');front('WARM FRONT','#ef6c77',[[world.frontX(low.y),low.y],[low.x+200,low.y+15],[low.x+440,low.y-10]],'warm');}
  else if(c.region!=='gulf')front('MOISTURE BOUNDARY','#dbb367',pts,'dryline');
  front('UPPER TROUGH','#d8b188',[[low.x-170,low.y+200],[low.x-140,low.y],[low.x-180,low.y-260]],'trough');
  if(low.pressure<992&&c.contrast>6)front('OCCLUSION','#b48ae8',[[low.x,low.y],[low.x-30,low.y+60],[low.x+60,low.y+70],[world.frontX(low.y),low.y]],'occluded');
 }
 for(const system of world.pressureSystems)if(system.kind==='L'&&system.pressure<1014&&world.config.contrast>4){front('COLD FRONT','#65aaff',[[system.x-90,system.y-360],[system.x-40,system.y-150],[system.x,system.y]],'cold');front('WARM FRONT','#ef6c77',[[system.x,system.y],[system.x+130,system.y+25],[system.x+320,system.y]],'warm');}
 for(const r of world.remnants){const p=point(r.x,r.y);l.append('text').attr('x',p[0]).attr('y',p[1]).attr('data-size',10).attr('fill','#d7abed').text('MCV REMNANT');}
 const centers=[...world.pressureSystems.map(s=>[s.kind,s.x,s.y,s.pressure,s.kind==='L'?'#ff7979':'#80bdff']),['L',low.x,low.y,low.pressure,'#ff7979'],['H',-400+world.minutes*.7,250,world.pressureAt(-400+world.minutes*.7,250),'#80bdff']];
 if(world.tropical.organization>.2)centers.push(['L',world.tropical.x,world.tropical.y,world.tropical.pressure,'#f2a3dd']);
 centers.filter(([name,x,y,p])=>name==='L'||p>1019).forEach(([name,x,y,p,color])=>{const pt=point(x,y);l.append('text').attr('x',pt[0]).attr('y',pt[1]).attr('data-size',22).attr('fill',color).text(name);l.append('text').attr('x',pt[0]).attr('y',pt[1]+4).attr('data-size',10).attr('fill',color).text(`${p.toFixed(0)} hPa`);});
 l.selectAll('path').attr('vector-effect','non-scaling-stroke');rescaleAnnotations();
}
function drawJetStream(){
 if(!group)return;const l=group.select('.jet-layer');l.selectAll('*').remove();if(!jetEnabled)return;
 const model=require('./synoptic');for(let j=-1;j<=1;j++){
  const pts=d3.range(-2900,2901,55).map(x=>projection(physics.geographic(x,model.jetY(world,x)+j*55,world.origin)));
  l.append('path').attr('class','jet-stream').attr('d',d3.line().curve(d3.curveCatmullRom)(pts)).attr('fill','none').attr('stroke',j?'#6fcaff':'#db78ed').attr('stroke-width',j?1:3).attr('vector-effect','non-scaling-stroke');
 }
 $('jet-regime-name').textContent='EVOLVING UPPER-LEVEL WAVES';$('jet-regime-copy').textContent='The jet meanders as simulated time advances. Its evolving flow supports developing surface lows and following highs, labeled in hPa. Upper flow is parameterized; hiding the overlay does not stop atmospheric evolution.';
}
function focusRadar(){if(!svg)return;const p=projection([selectedRadar.lon,selectedRadar.lat]),k=selectedRadar.type==='TDWR'?12:5.1;svg.interrupt().call(zoom.transform,d3.zoomIdentity.translate(innerWidth*.64-k*p[0],innerHeight*.51-k*p[1]).scale(k));}
function focusDomain(){if(svg)svg.interrupt().call(zoom.transform,d3.zoomIdentity);}
function formatTime(minutes){if(world.config.epochMs)return new Date(world.config.epochMs+minutes*60000).toISOString().slice(0,16).replace('T',' ')+'Z';const total=world.config.startHour*60+minutes,day=Math.floor(total/1440),hour=Math.floor(total%1440/60),min=Math.floor(total%60);return `D${day+1} ${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')} solar`;}
function updateStatus(){
 const summary=world.summary(),site=world.point(selectedRadar.lon,selectedRadar.lat,false),d=site?.d;
 $('simulation-clock').textContent=formatTime(world.minutes);$('clock-label').textContent=formatTime(world.minutes);
 $('map-status').textContent=`${world.cells.length} UPDRAFTS · ${summary.mode.toUpperCase()}`;
 $('scenario-description').textContent=`${summary.mode}. ${world.totalInitiated} initiated since initialization. ${summary.rotating} rotating mature cells; ${summary.decaying} decaying. ${summary.outflows} persistent outflows; ${summary.outflowBirths} cells triggered by boundaries. ${summary.wind}.`;
 $('environment-summary').innerHTML=`<b>${summary.mode}</b><br>${d?`At radar: CAPE ${d.cape.toFixed(0)} J/kg · CIN ${d.cin.toFixed(0)} J/kg · shear ${(d.shear*1.94384).toFixed(0)} kt`:'Radar lies outside the active atmosphere domain.'}<br>${summary.derecho}`;
 $('environment-observations').textContent=`Autonomous weather · solar heating ${world.config.heating.toFixed(0)} W/m² peak · background shear ${(world.config.shear*1.94384).toFixed(0)} kt · ${world.pressureSystems.length+2} synoptic centers · ${summary.outflows} outflow boundaries · ${summary.remnants} circulation remnants. Click the map for the local CAPE, CIN, SRH and sounding.`;
 const tropical=world.tropicalSupport();$('tropical-guidance').textContent=`TROPICAL DEVELOPMENT · ${tropical.support>.5?'Favorable':tropical.support>.2?'Marginal':'Unfavorable'} ingredients. SST ${world.config.sst} °C; deep-layer shear ${(world.config.shear*1.94384).toFixed(0)} kt; midlevel moisture factor ${world.config.humidity.toFixed(2)}. ${summary.tropical}. Sustained wind ${world.tropicalWindKnots().toFixed(0)} kt${world.tropical.organization<.25?' in an unorganized disturbance':''}. This is separate from the SPC-style outlook.`;
 $('pressure-guidance').textContent=`Surface low ${world.low.pressure.toFixed(1)} hPa. ${world.low.drop24===null?'A full 24 hours of pressure history is needed to assess bombogenesis.':`24 h fall ${world.low.drop24.toFixed(1)} hPa; local bombogenesis threshold ${physics.bombThreshold(world.origin.lat).toFixed(1)} hPa.`}`;
 $('event-log').innerHTML=world.events.slice(0,8).map(e=>`<li><time>${formatTime(e.minute)}</time> ${e.text}</li>`).join('');

}
function refreshWorld(){scanCache.clear();outlookCache={};updateStatus();if(group){drawEnvironment();drawRadar();drawBoundaries();drawJetStream();if(activeDay)paintOutlook();if(forecastVisible)drawForecast();if(selectedPoint)showThermodynamics(...selectedPoint,false);}}
async function advanceSimulation(minutes){
 if(busy)return;busy=true;document.querySelectorAll('.advance-button').forEach(b=>b.disabled=true);
 try{for(let done=0;done<minutes;done+=30){for(const atmosphere of weatherAreas.values())atmosphere.advance(Math.min(30,minutes-done));$('clock-label').textContent=formatTime(world.minutes);if(minutes>30)await new Promise(r=>setTimeout(r,0));}refreshWorld();}
 finally{busy=false;document.querySelectorAll('.advance-button').forEach(b=>b.disabled=false);}
}
function initializeAtmosphere(){if(busy)return;world=newWeather();weatherAreas.clear();weatherAreas.set('CONUS',world);activeArea='CONUS';radarHistory.clear();looping=false;forecastRun=null;selectedPoint=null;$('thermo-panel').classList.add('hidden');refreshWorld();if(group){drawCities();focusDomain();}return prepareWeather();}
function showThermodynamics(lon,lat,open=true){
 const result=world.point(lon,lat);if(!result){if(open){$('city-name').textContent='Outside active domain';$('city-subtitle').textContent='Initialize another region to simulate this location.';$('thermo-grid').innerHTML='';$('thermo-panel').classList.remove('hidden');}return;}
 selectedPoint=[lon,lat];const nearest=cities.reduce((a,c)=>Math.hypot(c.lon-lon,c.lat-lat)<Math.hypot(a.lon-lon,a.lat-lat)?c:a,cities[0]);const {e,d,hazards:h}=result;
 $('city-name').textContent=`Near ${nearest.name}`;$('city-subtitle').textContent=`${lat.toFixed(2)}°, ${lon.toFixed(2)}° · ${formatTime(world.minutes)} · model column`;
 const fmt=(v,suffix)=>v===null?'—':`${v.toFixed(0)} ${suffix}`;
 const items=[['SBCAPE',fmt(d.cape,'J/kg')],['MLCAPE',fmt(d.ml.cape,'J/kg')],['MUCAPE',fmt(d.mu.cape,'J/kg')],['SBCIN',fmt(-d.cin,'J/kg')],['LCL',fmt(d.lcl,'m')],['LFC',fmt(d.lfc,'m')],['EL',fmt(d.el,'m')],['0–3 km SRH',fmt(d.srh,'m²/s²')],['0–6 km SHEAR',fmt(d.shear*1.94384,'kt')],['DCAPE PROXY',fmt(d.dcape,'J/kg')],['TEMPERATURE',`${e.temp.toFixed(1)} °C`],['DEWPOINT',`${e.dewpoint.toFixed(1)} °C`],['SURFACE PRESSURE',`${e.pressure.toFixed(1)} hPa`],['LIFT SCORE',e.forcing.toFixed(2)],['TORNADO SUPPORT',h.tornado>.5?'Elevated':h.tornado>.15?'Some':'Low']];
 $('thermo-grid').innerHTML=items.map(([k,v])=>`<div class="thermo-value"><span>${k}</span><b>${v}</b></div>`).join('');if(open)$('thermo-panel').classList.remove('hidden');drawSounding(d);
}
function drawSounding(d){
 const s=d3.select('#skewt'),h=d3.select('#hodograph');s.selectAll('*').remove();h.selectAll('*').remove();
 const y=p=>180-Math.log(1000/p)/Math.log(10)*163,x=(t,p)=>75+t*1.5+(180-y(p))*.45;
 [1000,850,700,500,300,200,100].forEach(p=>{s.append('line').attr('x1',0).attr('x2',160).attr('y1',y(p)).attr('y2',y(p)).attr('stroke','#31515f').attr('stroke-width',.5);s.append('text').attr('x',2).attr('y',y(p)-2).attr('fill','#b9cbd5').attr('font-size',6).text(p);});
 for(let t=-80;t<=40;t+=20)s.append('line').attr('x1',x(t,1000)).attr('y1',180).attr('x2',x(t,100)).attr('y2',17).attr('stroke','#31515f').attr('stroke-width',.4);
 for(const [key,color]of [['t','#ff785b'],['td','#60e894']])s.append('path').attr('d',d3.line().x(l=>x(l[key],l.p)).y(l=>y(l.p))(d.levels)).attr('stroke',color).attr('fill','none').attr('stroke-width',1.8);
 s.append('path').attr('d',d3.line().x(l=>x(l.t,l.p)).y(l=>y(l.p))(d.trace)).attr('stroke','#eee').attr('stroke-dasharray','3 2').attr('fill','none').attr('stroke-width',1);
 s.append('text').attr('x',7).attr('y',9).attr('fill','#a8c8cf').attr('font-size',6).text('T / Td / PARCEL · °C, hPa');
 const windLevels=d.levels.slice(0,25),max=Math.max(30,...windLevels.map(l=>Math.hypot(l.u,l.v)),Math.hypot(...d.motion)),scale=66/max,hx=u=>80+u*scale,hy=v=>92-v*scale;
 for(let speed=10;speed<=max;speed+=10){h.append('circle').attr('cx',80).attr('cy',92).attr('r',speed*scale).attr('fill','none').attr('stroke','#31515f').attr('stroke-width',.6);h.append('text').attr('x',hx(speed)).attr('y',92).attr('fill','#a8c8cf').attr('font-size',5).text(speed);}
 for(const [lo,hi,color] of [[0,4,'#f67b70'],[4,12,'#70d99e'],[12,24,'#78b6fa']])h.append('path').attr('d',d3.line().x(l=>hx(l.u)).y(l=>hy(l.v))(windLevels.slice(lo,hi+1))).attr('fill','none').attr('stroke',color).attr('stroke-width',2);
 h.append('circle').attr('cx',hx(d.motion[0])).attr('cy',hy(d.motion[1])).attr('r',3).attr('fill','#fff');h.append('text').attr('x',5).attr('y',10).attr('fill','#a8c8cf').attr('font-size',6).text('WIND m/s · 0–1 / 1–3 / 3–6 km');

}
async function selectWeatherArea(site){
 const key=site.lat>52?'Alaska':site.lon>0?'Guam':site.lon<-130?'Hawaii':site.lat<24?'Puerto Rico':'CONUS';
 if(key===activeArea)return;
 activeArea=key;if(!weatherAreas.has(key)){const origins={Alaska:[-153,63],Hawaii:[-157,21],Guam:[144.8,13.5],'Puerto Rico':[-66,18.2]},o=origins[key];world=newWeather({originLon:o[0],originLat:o[1],originName:key});weatherAreas.set(key,world);await prepareWeather();}else world=weatherAreas.get(key);
 scanCache.clear();outlookCache={};forecastRun=null;selectedPoint=null;radarGeometry=null;currentTransform=d3.zoomIdentity;initializeMap();drawCities();refreshWorld();
}
function buildControls(){
 $('forecast-day').innerHTML=Array.from({length:30},(_,i)=>`<option value="${i+1}">Day ${i+1}${i>=16?' · extended':''}</option>`).join('');
 document.querySelector('.radar-products').innerHTML=Object.entries(weather.products).map(([id,p])=>`<button class="radar-product" data-product="${id}">${p.name.toUpperCase()}<span>${p.unit}</span></button>`).join('');
 document.querySelectorAll('.radar-product').forEach(b=>b.addEventListener('click',()=>{radarProduct=b.dataset.product;radarEnabled=true;drawRadar();}));
 $('radar-site-name').textContent=`${selectedRadar.id} · ${selectedRadar.name}`;$('radar-sites').innerHTML='<input id="radar-search" type="search" placeholder="Search ID or city" aria-label="Search radar stations" />'+radarSites.map(s=>`<button data-radar="${s.id}">${s.id}<br><small>${s.name} · ${s.type}</small></button>`).join('');
 $('radar-search').addEventListener('input',e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('[data-radar]').forEach(b=>b.hidden=!b.textContent.toLowerCase().includes(q));});
 document.querySelectorAll('[data-radar]').forEach(b=>b.addEventListener('click',async()=>{if(busy)return;selectedRadar=radarSites.find(s=>s.id===b.dataset.radar);await selectWeatherArea(selectedRadar);$('radar-site-name').textContent=`${selectedRadar.id} · ${selectedRadar.name}`;$('radar-sites').classList.add('hidden');drawRadar();focusRadar();updateStatus();}));
}
async function prepareWeather(){weatherReady=false;busy=true;$('play-button').disabled=true;$('play-button').textContent='INITIALIZING WEATHER…';
 try{for(let i=0;i<8;i++){world.advance(30);await new Promise(r=>setTimeout(r,0));}}finally{busy=false;weatherReady=true;nextScanAt=Date.now()+240000;$('play-button').disabled=false;$('play-button').textContent='PLAY';refreshWorld();}
}
function radarTick(){if(!weatherReady||busy)return;const left=Math.max(0,nextScanAt-Date.now());$('next-scan').textContent='Next scan '+Math.floor(left/60000)+':'+String(Math.floor(left/1000)%60).padStart(2,'0');if(left===0){nextScanAt+=240000;advanceSimulation(4);}}

buildControls();drawMenuMap();updateStatus();
$('play-button').addEventListener('click',()=>{$('menu-screen').classList.remove('active');$('game-screen').classList.add('active');if(!svg)initializeMap();focusDomain();});
$('menu-button').addEventListener('click',()=>{simulationPlaying=false;updateStatus();$('game-screen').classList.remove('active');$('menu-screen').classList.add('active');});
$('exit-button').addEventListener('click',()=>ipcRenderer.send('quit-game'));
['spc','radar','jet','environment','forecast'].forEach(name=>$(`${name}-button`).addEventListener('click',()=>{const opening=$(`${name}-panel`).classList.contains('hidden');closePanels(opening?`${name}-panel`:null);if(opening&&name==='radar'){radarEnabled=true;drawRadar();focusRadar();}if(opening&&name==='forecast'){activeDay=null;environmentProduct='none';paintOutlook();drawEnvironment();$('thermo-panel').classList.add('hidden');forecastVisible=true;drawForecast();focusDomain();}if(opening&&(name==='spc'||name==='radar')){forecastVisible=false;drawForecast();}if(opening&&name==='jet'){jetEnabled=true;drawJetStream();$('jet-toggle').textContent='HIDE JET STREAM';}}));
$('close-spc').addEventListener('click',()=>closePanels());document.querySelectorAll('.close-panel').forEach(b=>b.addEventListener('click',()=>closePanels()));
$('jet-toggle').addEventListener('click',()=>{jetEnabled=!jetEnabled;$('jet-toggle').textContent=jetEnabled?'HIDE JET STREAM':'SHOW JET STREAM';drawJetStream();});
$('zoom-in').addEventListener('click',()=>svg?.call(zoom.scaleBy,1.35));$('zoom-out').addEventListener('click',()=>svg?.call(zoom.scaleBy,.74));$('reset-view').addEventListener('click',()=>svg?.call(zoom.transform,d3.zoomIdentity));
$('focus-radar').addEventListener('click',focusRadar);$('radar-toggle').addEventListener('click',()=>{radarEnabled=!radarEnabled;drawRadar();});$('radar-site-button').addEventListener('click',()=>$('radar-sites').classList.toggle('hidden'));
$('radar-elevation').addEventListener('change',e=>{radarElevation=Number(e.target.value);drawRadar();});$('velocity-fold').addEventListener('change',drawRadar);
$('boundary-button').addEventListener('click',()=>{boundariesVisible=!boundariesVisible;$('boundary-button').textContent=boundariesVisible?'HIDE FRONTS & PRESSURE':'SHOW FRONTS & PRESSURE';drawBoundaries();});
$('crosshair-button').addEventListener('click',()=>{crosshairEnabled=!crosshairEnabled;$('game-screen').classList.toggle('crosshair-enabled',crosshairEnabled);$('measure-readout').classList.toggle('hidden',!crosshairEnabled);});
$('weather-map').addEventListener('mousemove',event=>{if(!crosshairEnabled||!projection)return;const box=event.currentTarget.getBoundingClientRect(),ll=projection.invert(currentTransform.invert([event.clientX-box.left,event.clientY-box.top]));const p=weather.products[radarProduct],value=radarEnabled&&radarScan?weather.scanValue(radarScan,...ll):null;const range=Math.hypot(...physics.local(...ll,selectedRadar));const height=Math.sqrt(range*range+8494*8494+2*range*8494*Math.sin(radarElevation*Math.PI/180))-8494;$('measure-readout').lastElementChild.textContent=(value===null?'NO ECHO / NO DATA':p.labels?p.labels[Math.round(value)]:`${value.toFixed(radarProduct==='cc'?3:1)} ${p.unit}`)+` · ${range.toFixed(0)} km · beam ${height.toFixed(1)} km`;} );
$('weather-map').addEventListener('click',event=>{if(event.defaultPrevented||!projection)return;const box=event.currentTarget.getBoundingClientRect(),ll=projection.invert(currentTransform.invert([event.clientX-box.left,event.clientY-box.top]));if(ll)showThermodynamics(...ll);});
$('close-thermo').addEventListener('click',()=>{selectedPoint=null;$('thermo-panel').classList.add('hidden');});
$('profile-values').addEventListener('click',()=>{$('thermo-page').classList.add('active');$('sounding-page').classList.remove('active');});$('profile-sounding').addEventListener('click',()=>{$('thermo-page').classList.remove('active');$('sounding-page').classList.add('active');});
$('radar-loop').addEventListener('click',()=>{looping=!looping;loopIndex=0;drawRadar();});$('radar-live').addEventListener('click',()=>{looping=false;drawRadar();});$('initialize-atmosphere').addEventListener('click',initializeAtmosphere);
$('forecast-day').addEventListener('change',()=>{forecastVisible=true;drawForecast();});$('forecast-field').addEventListener('change',()=>{forecastVisible=true;drawForecast();});$('forecast-hide').addEventListener('click',()=>{forecastVisible=false;drawForecast();});
$('environment-product').addEventListener('change',e=>{forecastVisible=false;drawForecast();activeDay=null;paintOutlook();environmentProduct=e.target.value;drawEnvironment();});
$('outlook-metric').addEventListener('change',e=>{outlookMetric=e.target.value;paintOutlook();});document.querySelectorAll('.day-tab').forEach(b=>b.addEventListener('click',()=>{const day=Number(b.dataset.day);activeDay=activeDay===day?null:day;document.querySelectorAll('.day-tab').forEach(t=>t.classList.toggle('selected',Number(t.dataset.day)===activeDay));paintOutlook();}));
setInterval(()=>{radarTick();if(looping&&radarEnabled&&!busy){loopIndex++;drawRadar();}},1000);
const initializationPromise=prepareWeather();
window.addEventListener('resize',()=>{drawMenuMap();if(svg)initializeMap();});




