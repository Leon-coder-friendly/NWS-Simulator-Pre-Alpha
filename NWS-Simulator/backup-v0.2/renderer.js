const { ipcRenderer } = require('electron');
const d3 = require('d3');
const topojson = require('topojson-client');
const us = require('us-atlas/states-10m.json');
const weather = require('./weather');
let stormScenario = 'supercell', simulationMinutes = 0, simulationPlaying = false;
let radarEnabled = false, jetEnabled = false, radarElevation = .5;
let radarRaster = null;

const states = topojson.feature(us, us.objects.states);
const excluded = new Set(['02', '15', '60', '66', '69', '72', '78']);
const contiguous = { type: 'FeatureCollection', features: states.features.filter(d => !excluded.has(String(d.id).padStart(2, '0'))) };
// Merge only CONUS geometries so Alaska, Hawaii, and territories never appear in the workspace.
const nation = topojson.merge(us, us.objects.states.geometries.filter(d => !excluded.has(String(d.id).padStart(2, '0'))));
// SPC categorical palette: light green for general thunderstorms and dark green for Marginal.
const colors = { TSTM:'#bfe7bd', MRGL:'#5f9d5c', SLGT:'#ffe16a', ENH:'#ff9d58', MDT:'#e85c58', HIGH:'#d650ca' };
const riskRank = { TSTM:0, MRGL:1, SLGT:2, ENH:3, MDT:4, HIGH:5 };

// Hand-authored weather regimes provide the broad synoptic structure.  Small coordinate
// perturbations below give every issue a new, irregular SPC-style boundary without reusing an image.
const outlookTemplates = [
  {
    summary:'A dryline and strengthening low-level jet favor organized severe storms over the central Plains.',
    layers:[
      {risk:'TSTM', points:[[-106,29],[-100,27],[-94,31],[-91,37],[-94,42],[-100,46],[-105,43],[-104,37]]},
      {risk:'MRGL', points:[[-102,29],[-96,30],[-92,35],[-93,40],[-98,43],[-102,40],[-101,35]]},
      {risk:'SLGT', points:[[-100,31],[-96,32],[-94,35],[-95,39],[-98,40],[-100,37]]},
      {risk:'ENH',  points:[[-98.5,33],[-96,34],[-95.3,36.7],[-97.2,38],[-99,36.4]]},
      {risk:'MDT',  points:[[-97.8,34.1],[-96.2,34.8],[-96.1,36.4],[-97.5,37.2],[-98.6,36.1]]},
      {risk:'HIGH', points:[[-97.4,35.0],[-96.5,35.4],[-96.6,36.2],[-97.5,36.3],[-97.9,35.7]]}
    ]
  },
  {
    summary:'A fast-moving trough supports a northeastward severe-weather corridor from the Gulf states to the Ohio Valley.',
    layers:[
      {risk:'TSTM', points:[[-93,28],[-87,28],[-82,32],[-77,38],[-75,44],[-80,46],[-85,42],[-89,36]]},
      {risk:'MRGL', points:[[-91,29],[-85,30],[-81,34],[-78,39],[-79,43],[-83,43],[-87,38],[-90,34]]},
      {risk:'SLGT', points:[[-88,31],[-84,32],[-81,35],[-80,39],[-82,41],[-85,39],[-87,35]]},
      {risk:'ENH',  points:[[-86.5,33],[-83.5,34],[-82,36.5],[-83,38.2],[-86,37.5],[-87.5,35.2]]},
      {risk:'MDT',  points:[[-85.6,34.3],[-83.8,34.8],[-83.2,36.6],[-84.5,37.4],[-86.2,36.4]]}
    ]
  },
  {
    summary:'Scattered severe thunderstorms may develop near a frontal zone from the High Plains into the Upper Midwest.',
    layers:[
      {risk:'TSTM', points:[[-112,38],[-105,37],[-99,40],[-91,43],[-86,47],[-91,49],[-100,47],[-108,44]]},
      {risk:'MRGL', points:[[-106,39],[-100,40],[-95,42],[-91,45],[-93,47],[-99,46],[-105,43]]},
      {risk:'SLGT', points:[[-101,41],[-97,42],[-94,44],[-94,46],[-97,46],[-100,44]]},
      {risk:'ENH',  points:[[-98.5,42.3],[-96,42.6],[-95,44.4],[-96.5,45.3],[-99,44.4]]}
    ]
  },
  {
    summary:'A humid warm sector and approaching upper disturbance favor severe storms across the Southeast and Mid-Atlantic.',
    layers:[
      {risk:'TSTM', points:[[-96,28],[-88,27],[-80,29],[-75,34],[-76,40],[-81,42],[-87,39],[-92,34]]},
      {risk:'MRGL', points:[[-92,29],[-86,29],[-80,32],[-78,36],[-80,39],[-85,38],[-89,35]]},
      {risk:'SLGT', points:[[-89,30],[-84,31],[-81,33],[-81,36],[-84,37],[-88,35]]},
      {risk:'ENH',  points:[[-87,31],[-84,32],[-83,34.2],[-84.5,35.5],[-87.2,34.5]]}
    ]
  },
  {
    summary:'A monsoonal plume and surface heating could support isolated severe storms over the interior West and southern Rockies.',
    layers:[
      {risk:'TSTM', points:[[-120,34],[-114,32],[-106,33],[-103,38],[-106,43],[-112,44],[-117,40]]},
      {risk:'MRGL', points:[[-113,34],[-108,34],[-105,37],[-106,41],[-110,42],[-113,39]]},
      {risk:'SLGT', points:[[-110,35],[-107,36],[-106.5,38.8],[-108.5,40],[-110.5,38]]}
    ]
  }
];

function createRng(seed) {
  return () => {
    seed += 0x6D2B79F5;
    let value = seed;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function polygonFeature(points, random, intensity) {
  let ring = points.map(([lon, lat], index) => {
    const wobble = intensity * (index % 2 ? .72 : 1);
    return [lon + (random() - .5) * wobble, lat + (random() - .5) * wobble];
  });
  ring.push(ring[0]);
  let feature = { type:'Feature', geometry:{ type:'Polygon', coordinates:[ring] } };
  // d3 treats a ring with the opposite spherical winding as the *entire world outside*
  // of the intended area. Normalize every random ring to the smaller, local polygon.
  if (d3.geoArea(feature) > 2 * Math.PI) {
    ring = ring.slice(0, -1).reverse();
    ring.push(ring[0]);
    feature = { type:'Feature', geometry:{ type:'Polygon', coordinates:[ring] } };
  }
  return feature;
}

function highestRisk(day, random) {
  // A visible categorical outlook always has a broad TSTM area, Marginal zone, and Slight core.
  // ENH/MDT/HIGH remain progressively less common, especially in the longer-range products.
  const rolls = day === 1 ? [2, 2, 2, 3, 3, 4, 5] : day === 2 ? [2, 2, 2, 2, 3, 3, 4] : [2, 2, 2, 2, 2, 3];
  return rolls[Math.floor(random() * rolls.length)];
}

function generateScenario(day, random, preferredTemplate) {
  const template = outlookTemplates[preferredTemplate ?? Math.floor(random() * outlookTemplates.length)];
  const cap = highestRisk(day, random);
  const layers = template.layers
    .filter(layer => riskRank[layer.risk] <= cap)
    .map(layer => ({ risk:layer.risk, feature:polygonFeature(layer.points, random, layer.risk === 'TSTM' ? 1.15 : .62) }));
  return { layers, summary:template.summary };
}

function createOutlooks() {
  const random = createRng((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
  return { 1:generateScenario(1, random), 2:generateScenario(2, random), 3:generateScenario(3, random) };
}

let activeDay = null, svg, group, projection, path, zoom, homeTransform;
let outlooks = createOutlooks();
let issueDate = new Date().toDateString();
let currentTransform = d3.zoomIdentity;
let activeTool = null, radarProduct = 'reflectivity', selectedRadar = null, boundariesVisible = false, crosshairEnabled = false;
let jetPatternIndex = 0, jetRegime = null, selectedCity = null, jetDrift = 0;

// Capitals plus a major metro in every connected state keep point analysis useful without needing a web service.
const cities = [
  ['Montgomery','AL',32.37,-86.30],['Birmingham','AL',33.52,-86.81],['Phoenix','AZ',33.45,-112.07],['Tucson','AZ',32.22,-110.97],['Little Rock','AR',34.75,-92.29],['Fayetteville','AR',36.06,-94.16],['Sacramento','CA',38.58,-121.49],['Los Angeles','CA',34.05,-118.24],['Denver','CO',39.74,-104.99],['Colorado Springs','CO',38.83,-104.82],['Hartford','CT',41.76,-72.67],['Bridgeport','CT',41.18,-73.19],['Dover','DE',39.16,-75.52],['Wilmington','DE',39.74,-75.55],['Tallahassee','FL',30.44,-84.28],['Miami','FL',25.76,-80.19],['Atlanta','GA',33.75,-84.39],['Savannah','GA',32.08,-81.09],['Boise','ID',43.62,-116.20],['Idaho Falls','ID',43.49,-112.04],['Springfield','IL',39.80,-89.65],['Chicago','IL',41.88,-87.63],['Indianapolis','IN',39.77,-86.16],['Fort Wayne','IN',41.08,-85.14],['Des Moines','IA',41.59,-93.62],['Cedar Rapids','IA',41.98,-91.67],['Topeka','KS',39.05,-95.68],['Wichita','KS',37.69,-97.34],['Frankfort','KY',38.20,-84.87],['Louisville','KY',38.25,-85.76],['Baton Rouge','LA',30.45,-91.19],['New Orleans','LA',29.95,-90.07],['Augusta','ME',44.31,-69.78],['Portland','ME',43.66,-70.26],['Annapolis','MD',38.98,-76.49],['Baltimore','MD',39.29,-76.61],['Boston','MA',42.36,-71.06],['Worcester','MA',42.26,-71.80],['Lansing','MI',42.73,-84.56],['Detroit','MI',42.33,-83.05],['St. Paul','MN',44.95,-93.09],['Minneapolis','MN',44.98,-93.27],['Jackson','MS',32.30,-90.18],['Tupelo','MS',34.26,-88.70],['Jefferson City','MO',38.58,-92.17],['Kansas City','MO',39.10,-94.58],['Helena','MT',46.59,-112.04],['Billings','MT',45.78,-108.50],['Lincoln','NE',40.81,-96.70],['Omaha','NE',41.26,-95.94],['Carson City','NV',39.16,-119.77],['Las Vegas','NV',36.17,-115.14],['Concord','NH',43.21,-71.54],['Manchester','NH',42.99,-71.46],['Trenton','NJ',40.22,-74.76],['Newark','NJ',40.74,-74.17],['Santa Fe','NM',35.69,-105.94],['Albuquerque','NM',35.08,-106.65],['Albany','NY',42.65,-73.76],['New York City','NY',40.71,-74.01],['Raleigh','NC',35.78,-78.64],['Charlotte','NC',35.23,-80.84],['Bismarck','ND',46.81,-100.78],['Fargo','ND',46.88,-96.79],['Columbus','OH',39.96,-82.99],['Cleveland','OH',41.50,-81.69],['Oklahoma City','OK',35.47,-97.52],['Tulsa','OK',36.15,-95.99],['Salem','OR',44.94,-123.04],['Portland','OR',45.52,-122.68],['Harrisburg','PA',40.27,-76.89],['Philadelphia','PA',39.95,-75.17],['Providence','RI',41.82,-71.41],['Charleston','SC',32.78,-79.93],['Columbia','SC',34.00,-81.03],['Pierre','SD',44.37,-100.35],['Sioux Falls','SD',43.55,-96.73],['Nashville','TN',36.16,-86.78],['Memphis','TN',35.15,-90.05],['Austin','TX',30.27,-97.74],['Dallas','TX',32.78,-96.80],['Salt Lake City','UT',40.76,-111.89],['St. George','UT',37.10,-113.58],['Montpelier','VT',44.26,-72.58],['Burlington','VT',44.48,-73.21],['Richmond','VA',37.54,-77.44],['Virginia Beach','VA',36.85,-75.98],['Olympia','WA',47.04,-122.90],['Seattle','WA',47.61,-122.33],['Charleston','WV',38.35,-81.63],['Huntington','WV',38.42,-82.45],['Madison','WI',43.07,-89.40],['Milwaukee','WI',43.04,-87.91],['Cheyenne','WY',41.14,-104.82],['Casper','WY',42.87,-106.31]
].map(([name,state,lat,lon]) => ({name,state,lat,lon}));
const radarSites = [
  {id:'KTLX',name:'Oklahoma City, OK',lat:35.33,lon:-97.28},{id:'KDMX',name:'Des Moines, IA',lat:41.73,lon:-93.72},{id:'KDVN',name:'Davenport, IA',lat:41.61,lon:-90.58},{id:'KLOT',name:'Chicago, IL',lat:41.60,lon:-88.08},{id:'KILN',name:'Wilmington, OH',lat:39.42,lon:-83.82},{id:'KPAH',name:'Paducah, KY',lat:37.07,lon:-88.77},{id:'KFFC',name:'Atlanta, GA',lat:33.36,lon:-84.57},{id:'KLCH',name:'Lake Charles, LA',lat:30.13,lon:-93.22},{id:'KHGX',name:'Houston, TX',lat:29.47,lon:-95.08},{id:'KOUN',name:'Norman, OK',lat:35.24,lon:-97.47},{id:'KDEN',name:'Denver, CO',lat:39.86,lon:-104.67},{id:'KBOX',name:'Boston, MA',lat:41.96,lon:-71.14}
];
const jetPatterns = [
  {name:'CENTRAL TROUGH',copy:'A pronounced central-U.S. trough supports stronger deep-layer shear over the Plains.',template:0,points:[[-126,46],[-117,48],[-109,46],[-101,39],[-94,34],[-87,38],[-79,43],[-69,45]]},
  {name:'EASTERN TROUGH',copy:'A digging eastern trough favors upper-level divergence and stronger shear east of the Mississippi.',template:1,points:[[-126,47],[-116,49],[-106,47],[-96,45],[-88,41],[-82,34],[-76,38],[-68,44]]},
  {name:'RIDGE / NORTHERN JET',copy:'A northern-stream jet promotes a more progressive severe-weather corridor over the Upper Midwest.',template:2,points:[[-126,44],[-118,45],[-110,43],[-102,44],[-94,47],[-86,46],[-78,43],[-69,45]]}
];

function drawMenuMap() {
  const menu = d3.select('#menu-map');
  const width = window.innerWidth, height = window.innerHeight;
  const p = d3.geoAlbersUsa().fitExtent([[width*.1,height*.18],[width*.9,height*.82]], contiguous);
  const menuPath = d3.geoPath(p);
  menu.attr('viewBox', `0 0 ${width} ${height}`).selectAll('*').remove();
  menu.append('g').selectAll('path').data(contiguous.features).join('path').attr('d',menuPath).attr('fill','#426f7b').attr('stroke','#c2e1e0').attr('stroke-width','.6').attr('opacity','.7');
}

function closeAnalysisPanels(except) {
  ['spc-panel','jet-panel','radar-panel'].forEach(id => {
    if (id !== except) document.querySelector(`#${id}`).classList.add('hidden');
  });
  document.querySelectorAll('#spc-button,#jet-button,#radar-button').forEach(button => {
    const panelId = `${button.id.replace('-button','')}-panel`;
    button.classList.toggle('active', panelId === except);
  });
}

function drawJetStream(animate = false) {
  if (!group || !jetRegime) return;
  const layer = group.select('.jet-layer');
  layer.selectAll('*').remove();
  if (!jetEnabled) return;
  const line = d3.line().curve(d3.curveCatmullRom.alpha(.5));
  for (let index = 0; index < 5; index++) {
    const offset = (index - 2) * .72;
    const wind = 80 + index * 15 + jetPatternIndex * 8;
    const localPath = jetRegime.points.map(([lon,lat], pointIndex) => projection([lon, lat + offset + Math.sin(pointIndex * 1.4 + index + jetDrift) * .26]));
    const stream = layer.append('path').attr('class', index === 2 ? 'jet-stream jet-core' : 'jet-stream').attr('d', line(localPath)).attr('stroke', index === 2 ? '#e86dff' : '#70d7ff').attr('stroke-width', index === 2 ? 3.5 : 1.6).attr('stroke-opacity', .92).attr('stroke-dasharray', index === 2 ? '12 6' : '7 8');
    if (animate) stream.attr('opacity',0).transition().duration(550).attr('opacity',1);
    stream.on('contextmenu', () => {
      d3.event.preventDefault();
      const strength = wind >= 135 ? 'VERY STRONG' : wind >= 110 ? 'STRONG' : wind >= 85 ? 'MODERATE' : 'WEAK';
      const [x,y] = d3.mouse(document.querySelector('#weather-map'));
      const tooltip = document.querySelector('#shear-tooltip');
      tooltip.style.left = `${x + 14}px`; tooltip.style.top = `${y + 12}px`;
      tooltip.textContent = `250 hPa WIND  ${wind} KT  •  ${strength}`;
      tooltip.classList.remove('hidden');
      setTimeout(() => tooltip.classList.add('hidden'), 2600);
    });
  }
}

function selectJetPattern(index) {
  jetPatternIndex = index;
  jetRegime = jetPatterns[index];
  jetEnabled = true;
  document.querySelector('#jet-toggle').textContent = 'HIDE JET STREAM';
  document.querySelector('#jet-regime-name').textContent = jetRegime.name;
  document.querySelector('#jet-regime-copy').textContent = jetRegime.copy;
  document.querySelectorAll('.jet-choice').forEach(button => button.classList.toggle('selected', Number(button.dataset.jet) === index));
  // Changing the upper-air regime creates a new, geographically coherent simulated outlook set.
  const random = createRng((Date.now() ^ (index + 17) * 714025) >>> 0);
  outlooks = {1:generateScenario(1, random, jetRegime.template),2:generateScenario(2, random, jetRegime.template),3:generateScenario(3, random, jetRegime.template)};
  drawJetStream(true);
  if (activeDay) paintOutlook();
}

function distanceSquared(city, lon, lat) { return (city.lon - lon) ** 2 + (city.lat - lat) ** 2; }
function pointForecast(city) {
  const support = jetPatternIndex * 85 + Math.round(Math.abs(city.lat - 37) * 6);
  const temp = Math.round(65 + (38 - city.lat) * 1.15 + jetPatternIndex * 2);
  const dew = Math.round(temp - 7 - (Math.abs(city.lon + 92) % 7));
  return [
    ['SBCAPE',`${850 + support} J/kg`],['MUCAPE',`${1200 + support} J/kg`],['MLCAPE',`${700 + support} J/kg`],['3CAPE',`${50 + jetPatternIndex * 35} J/kg`],['CIN',`${-20 - jetPatternIndex * 8} J/kg`],['LCL',`${750 + support / 3 | 0} m`],['LFC',`${1180 + support / 2 | 0} m`],['SRH',`${110 + support / 2 | 0} m²/s²`],['BULK SHEAR',`${32 + jetPatternIndex * 18} kt`],['LAPSE RATE',`${6.1 + jetPatternIndex * .4} °C/km`],['DEW POINT',`${dew} °F`],['TEMPERATURE',`${temp} °F`]
  ];
}

function drawSounding(city) {
  const skew = d3.select('#skewt'); const hodo = d3.select('#hodograph'); skew.selectAll('*').remove(); hodo.selectAll('*').remove();
  skew.append('rect').attr('width',160).attr('height',190).attr('fill','#081624');
  for(let y=20;y<190;y+=27) skew.append('line').attr('x1',0).attr('y1',y).attr('x2',160).attr('y2',y).attr('stroke','#31515f').attr('stroke-width',.5);
  for(let x=-30;x<190;x+=28) skew.append('line').attr('x1',x).attr('y1',190).attr('x2',x+75).attr('y2',0).attr('stroke','#31515f').attr('stroke-width',.5);
  const lapse = jetPatternIndex * 3;
  skew.append('path').attr('d',`M ${30+lapse} 178 L ${49+lapse} 142 L ${69+lapse} 104 L ${89+lapse} 64 L ${113+lapse} 22`).attr('fill','none').attr('stroke','#ef725c').attr('stroke-width',2);
  skew.append('path').attr('d',`M 25 178 L 34 142 L 47 104 L 61 64 L 78 22`).attr('fill','none').attr('stroke','#6ee4f7').attr('stroke-width',2);
  skew.append('text').attr('x',8).attr('y',14).attr('fill','#8fb5bf').attr('font-size',7).text('SIMULATED SKEW-T');
  hodo.append('rect').attr('width',170).attr('height',190).attr('fill','#081624');
  [28,55,82].forEach(r=>hodo.append('circle').attr('cx',85).attr('cy',98).attr('r',r).attr('fill','none').attr('stroke','#31515f').attr('stroke-width',.5));
  hodo.append('line').attr('x1',5).attr('y1',98).attr('x2',165).attr('y2',98).attr('stroke','#31515f').attr('stroke-width',.5);hodo.append('line').attr('x1',85).attr('y1',8).attr('x2',85).attr('y2',188).attr('stroke','#31515f').attr('stroke-width',.5);
  const curve = `M 86 101 Q ${105+jetPatternIndex*7} 88, ${117+jetPatternIndex*8} 68 T ${142+jetPatternIndex*5} 29`;
  hodo.append('path').attr('d',curve).attr('fill','none').attr('stroke','#e66dff').attr('stroke-width',3); hodo.append('circle').attr('cx',86).attr('cy',101).attr('r',3).attr('fill','#fff'); hodo.append('text').attr('x',8).attr('y',14).attr('fill','#8fb5bf').attr('font-size',7).text('SIMULATED HODOGRAPH');
}

function showThermodynamics(lon, lat) {
  if (!projection || !lon || !lat) return;
  selectedCity = cities.reduce((best, city) => distanceSquared(city,lon,lat) < distanceSquared(best,lon,lat) ? city : best, cities[0]);
  document.querySelector('#city-name').textContent = `${selectedCity.name}, ${selectedCity.state}`;
  document.querySelector('#city-subtitle').textContent = `IDEALIZED POINT PROFILE • Illustrative environment; not a retrieved sounding`;
  document.querySelector('#thermo-grid').innerHTML = pointForecast(selectedCity).map(([name,value]) => `<div class="thermo-value"><span>${name}</span><b>${value}</b></div>`).join('');
  document.querySelector('#thermo-panel').classList.remove('hidden');
  document.querySelector('#thermo-page').classList.add('active'); document.querySelector('#sounding-page').classList.remove('active');
  drawSounding(selectedCity);
}

function radarLegend() {
  const p=weather.products[radarProduct];
  document.querySelector('#radar-unit').textContent=p.unit;
  document.querySelector('#radar-scale').textContent=p.labels?p.labels.join(' · '):`${p.min}    ${(p.min+p.max)/2}    ${p.max}`;
  document.querySelector('.radar-key i').style.background=`linear-gradient(to right,${p.colors.join(',')})`;
  document.querySelector('#product-description').textContent=p.note;
  document.querySelectorAll('.radar-product').forEach(b=>b.classList.toggle('selected',b.dataset.product===radarProduct));
}
function drawRadar() {
  if (!group) return;
  const layer=group.select('.radar-layer'); layer.selectAll('*').remove();
  radarLegend();
  document.querySelector('#radar-toggle').textContent=radarEnabled?'HIDE RADAR':'SHOW RADAR';
  if (!selectedRadar || !radarEnabled) return;
  const center=projection([selectedRadar.lon,selectedRadar.lat]);
  const circle=d3.geoCircle().center([selectedRadar.lon,selectedRadar.lat]).radius(230/111.195)();
  const bounds=path.bounds(circle), width=bounds[1][0]-bounds[0][0],height=bounds[1][1]-bounds[0][1];
  const size=500;
  if(!radarRaster) {
    const samples=new Array(size*size);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
      const ll=projection.invert([bounds[0][0]+(x+.5)/size*width,bounds[0][1]+(y+.5)/size*height]);
      samples[y*size+x]=ll?weather.sample(ll[0],ll[1],stormScenario,simulationMinutes,selectedRadar,radarElevation):null;
    }
    radarRaster=samples;
  }
  const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
  const context=canvas.getContext('2d'), pixels=context.createImageData(size,size);
  const palette=Object.fromEntries(weather.products[radarProduct].colors.map(c=>[c,[parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)]]));
  radarRaster.forEach((sample,i)=>{
    const c=sample&&weather.color(sample[radarProduct],radarProduct);if(!c)return;
    const offset=i*4; pixels.data.set([...palette[c],225],offset);
  });
  context.putImageData(pixels,0,0);
  layer.append('image').attr('href',canvas.toDataURL()).attr('x',bounds[0][0]).attr('y',bounds[0][1]).attr('width',width).attr('height',height).style('image-rendering','auto');
  [50,100,150,230].forEach(km=>{
    layer.append('path').datum(d3.geoCircle().center([selectedRadar.lon,selectedRadar.lat]).radius(km/111.195)()).attr('d',path).attr('fill','none').attr('stroke','#b2dbdf').attr('stroke-opacity',.35).attr('stroke-width',.5).attr('vector-effect','non-scaling-stroke');
  });
  layer.append('circle').attr('class','radar-marker').attr('cx',center[0]).attr('cy',center[1]).attr('r',3/currentTransform.k).attr('fill','#fff');
  layer.append('text').attr('class','radar-label').attr('x',center[0]+2).attr('y',center[1]-2).attr('fill','#fff').attr('font-size',10/currentTransform.k).text(selectedRadar.id);
}
function drawBoundaries() {
  if(!group)return;
  const layer=group.select('.boundary-layer');layer.selectAll('*').remove();if(!boundariesVisible)return;
  const s=weather.scenarios[stormScenario], center=weather.centerAt(s,simulationMinutes);
  const tropical=stormScenario==='tropical'||stormScenario==='hurricane';
  const winter=stormScenario==='noreaster'||stormScenario==='bomb';
  const low=tropical||winter?center:Object.fromEntries(['lon','lat'].map((k,i)=>[k,weather.geographic(-150,200,center)[i]]));
  const point=(x,y)=>projection(weather.geographic(x,y,low));
  const line=d3.line().curve(d3.curveCatmullRom.alpha(.5));
  [80,160,260,380].forEach((r,i)=>{
    const pts=d3.range(0,Math.PI*2+.04,.04).map(a=>point(Math.cos(a)*r,Math.sin(a)*r*.8));
    layer.append('path').attr('d',line(pts)).attr('fill','none').attr('stroke','#cbd9c5').attr('stroke-opacity',.5).attr('stroke-width',.8);
    const label=pts[8];layer.append('text').attr('x',label[0]).attr('y',label[1]).attr('fill','#cbd9c5').attr('font-size',7).text(`${s.pressure+4*(i+1)}`);
  });
  function front(name,color,coords,kind) {
    const pts=coords.map(([x,y])=>point(x,y));
    const curve=layer.append('path').attr('d',line(pts)).attr('fill','none').attr('stroke',color).attr('stroke-width',1.7);
    if(kind==='trough'||kind==='dryline')curve.attr('stroke-dasharray',kind==='trough'?'7 5':'3 3');
    else {
      const node=curve.node(),length=node.getTotalLength();
      for(let d=8,i=0;d<length;d+=13,i++) {
        const p=node.getPointAtLength(d),q=node.getPointAtLength(Math.min(d+1,length));
        const angle=Math.atan2(q.y-p.y,q.x-p.x)*180/Math.PI;
        const warm=kind==='warm'||(kind==='occluded'&&i%2)||(kind==='stationary'&&i%2);
        const flip=kind==='stationary'&&warm?-1:1;
        layer.append('path').attr('class','front-symbol').attr('data-position',`translate(${p.x},${p.y}) rotate(${angle})`).attr('data-flip',flip).attr('d',warm?'M -4 0 A 4 4 0 0 1 4 0 Z':'M -4 0 L 0 -6 L 4 0 Z').attr('fill',kind==='stationary'?(warm?'#f16c78':'#62afff'):color);
      }
    }
    const p=pts[Math.floor(pts.length/2)];layer.append('text').attr('x',p[0]+5).attr('y',p[1]-8).attr('fill',color).attr('font-size',7).text(name);
  }
  if(!tropical) {
    front('COLD FRONT','#62afff',[[30,-15],[10,-100],[-40,-210],[-95,-340]],'cold');
    front('WARM FRONT','#f16c78',[[30,-15],[120,0],[220,20],[340,5]],'warm');
    front('TROUGH','#d5ae7e',[[-160,170],[-230,40],[-210,-140]],'trough');
    if(winter)front('OCCLUDED','#cd88ef',[[0,0],[-45,50],[0,80],[55,40],[30,-15]],'occluded');
    else {
      front('DRYLINE','#d6ab58',[[-60,-190],[-95,-300],[-85,-440]],'dryline');
      front('STATIONARY','#ba99c1',[[340,5],[420,20],[510,0]],'stationary');
    }
  }
  [['L',0,0,'#ff8787',s.pressure],...(!tropical?[['H',-600,100,'#79b9ff',1028]]:[])].forEach(([name,x,y,color,p])=>{
    const pt=point(x,y);layer.append('text').attr('x',pt[0]).attr('y',pt[1]).attr('fill',color).attr('font-size',20).attr('font-weight',800).text(name);
    layer.append('text').attr('x',pt[0]).attr('y',pt[1]+11).attr('fill',color).attr('font-size',8).text(`${p} hPa`);
  });
  layer.selectAll('text').each(function(){this.dataset.size=Math.max(10,Number(this.getAttribute('font-size')));});
  layer.selectAll('path').attr('vector-effect','non-scaling-stroke');
  rescaleMapAnnotations();
}
function rescaleMapAnnotations() {
  const k=currentTransform.k;
  group.selectAll('.boundary-layer text').attr('font-size',function(){return Number(this.dataset.size)/k;});
  group.selectAll('.front-symbol').attr('transform',function(){return `${this.dataset.position} scale(${1/k},${Number(this.dataset.flip)/k})`;});
}
function updateScenarioInfo() {
  const s=weather.scenarios[stormScenario];
  document.querySelector('#scenario-description').textContent=s.note+(s.drop?` Latitude threshold: ${weather.bombThreshold(s.lat).toFixed(1)} hPa / 24 h.`:'');
  document.querySelector('#simulation-clock').textContent=`T + ${simulationMinutes} min`;
  document.querySelector('#map-status').textContent=`SIMULATED · ${s.name.toUpperCase()}`;
}
function focusRadar() {
  if(!svg||!selectedRadar)return;
  const p=projection([selectedRadar.lon,selectedRadar.lat]);
  const k=4.2;
  svg.interrupt().call(zoom.transform,d3.zoomIdentity.translate(window.innerWidth*.62-k*p[0],window.innerHeight*.53-k*p[1]).scale(k));
}

function initializeMap() {
  svg = d3.select('#weather-map');
  const width = window.innerWidth, height = window.innerHeight;
  svg.attr('viewBox', `0 0 ${width} ${height}`).selectAll('*').remove();
  projection = d3.geoAlbers().fitExtent([[70, 96], [width - 45, height - 70]], contiguous);
  path = d3.geoPath(projection);
  group = svg.append('g').attr('class','map-layer');
  group.append('g').attr('class','state-layer').selectAll('path').data(contiguous.features).join('path').attr('class','state').attr('data-id',d => String(d.id).padStart(2,'0')).attr('d',path).append('title').text('U.S. State');
  group.append('path').datum(nation).attr('class','nation-outline').attr('d',path);
  // This union is used as a literal geographic mask. Colored outlook areas can never render
  // over Canada, Mexico, the oceans, or outside the 48 connected states.
  const defs = svg.append('defs');
  defs.append('clipPath').attr('id','conus-land-clip').append('path').datum(nation).attr('d',path);
  group.append('g').attr('class','outlook-layer').attr('clip-path','url(#conus-land-clip)');
  // State boundaries are redrawn above the colored fills, matching an SPC categorical chart.
  group.append('g').attr('class','state-boundary-layer').selectAll('path').data(contiguous.features).join('path').attr('class','state-boundary').attr('d',path);
  group.append('g').attr('class','radar-layer');
  group.append('g').attr('class','boundary-layer');
  group.append('g').attr('class','jet-layer');
  homeTransform = d3.zoomIdentity;
  // d3 v5 exposes the current input event as d3.event (rather than as a callback argument).
  // Using that API keeps both wheel zoom and left-button drag responsive.
  zoom = d3.zoom().scaleExtent([.75, 8]).on('zoom', () => {
    const transform = d3.event.transform;
    currentTransform = transform;
    group.attr('transform', transform);
    group.selectAll('.radar-label').attr('font-size',10/transform.k);
    group.selectAll('.radar-marker').attr('r',3/transform.k);
    rescaleMapAnnotations();
    document.querySelector('#coordinates').textContent = `48 CONUS • ${transform.k.toFixed(1)}× SCALE`;
  });
  svg.call(zoom).on('dblclick.zoom', null);
  paintOutlook();
  if (!jetRegime) jetRegime = jetPatterns[0];
  radarRaster = null; currentTransform = d3.zoomIdentity;
  drawJetStream(); drawRadar(); drawBoundaries();
}

function paintOutlook() {
  if (!group) return;
  const outlook = activeDay ? outlooks[activeDay] : null;
  document.querySelector('#game-screen').classList.toggle('spc-map-mode', Boolean(outlook));
  group.select('.state-layer').selectAll('.state').attr('fill', '#284e60');
  const layer = group.select('.outlook-layer');
  layer.selectAll('*').remove();
  if (outlook) {
    outlook.layers.forEach((region, index) => {
      const centroid = path.centroid(region.feature);
      layer.append('path')
        .datum(region.feature)
        .attr('class', `outlook outlook-${region.risk.toLowerCase()}`)
        .attr('d', path)
        .attr('fill', colors[region.risk])
        .attr('fill-opacity', region.risk === 'TSTM' ? .62 : .78);
      // Only label the core/highest areas. This keeps the clean SPC-map feel at every zoom level.
      if (region.risk !== 'TSTM' && (index === outlook.layers.length - 1 || riskRank[region.risk] >= 2)) {
        layer.append('text').attr('class','outlook-label').attr('x',centroid[0]).attr('y',centroid[1] + 3).attr('fill',colors[region.risk]).text(region.risk);
      }
    });
  }
  document.querySelector('#outlook-copy').textContent = outlook ? outlook.summary : 'Select a forecast day to display its categorical outlook.';
}

function refreshOutlooksIfNeeded() {
  const today = new Date().toDateString();
  if (today === issueDate) return;
  // When a simulated forecast day rolls over, Day 2 becomes Day 1, Day 3 becomes Day 2,
  // and a newly generated scenario fills the extended outlook slot.
  const random = createRng((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
  outlooks = { 1:outlooks[2], 2:outlooks[3], 3:generateScenario(3, random) };
  issueDate = today;
  paintOutlook();
  document.querySelector('#map-status').textContent = 'OUTLOOKS UPDATED';
}

function resetOutlook() {
  activeDay = null;
  document.querySelectorAll('.day-tab').forEach(tab => tab.classList.remove('selected'));
  document.querySelector('#spc-panel').classList.add('hidden');
  document.querySelector('#spc-button').classList.remove('active');
  paintOutlook();
}
function enterGame() {
  document.querySelector('#menu-screen').classList.remove('active');
  document.querySelector('#game-screen').classList.add('active');
  if (!svg) initializeMap();
  resetOutlook();
  svg.transition().duration(180).call(zoom.transform, homeTransform);
}
function enterMenu() { document.querySelector('#game-screen').classList.remove('active'); document.querySelector('#menu-screen').classList.add('active'); }
document.querySelector('#play-button').addEventListener('click', enterGame);
document.querySelector('#exit-button').addEventListener('click', () => ipcRenderer.send('quit-game'));
document.querySelector('#menu-button').addEventListener('click', enterMenu);
document.querySelector('#spc-button').addEventListener('click', () => { const opening=document.querySelector('#spc-panel').classList.contains('hidden'); document.querySelector('#spc-panel').classList.toggle('hidden',!opening); closeAnalysisPanels(opening?'spc-panel':null); });
document.querySelector('#close-spc').addEventListener('click', () => closeAnalysisPanels(null));
document.querySelector('#jet-button').addEventListener('click', () => { const opening=document.querySelector('#jet-panel').classList.contains('hidden'); if(opening){jetEnabled=true;document.querySelector('#jet-toggle').textContent='HIDE JET STREAM';drawJetStream();} document.querySelector('#jet-panel').classList.toggle('hidden',!opening); closeAnalysisPanels(opening?'jet-panel':null); });
document.querySelector('#radar-button').addEventListener('click', () => { const opening=document.querySelector('#radar-panel').classList.contains('hidden'); if(opening){radarEnabled=true;drawRadar();focusRadar();} document.querySelector('#radar-panel').classList.toggle('hidden',!opening); closeAnalysisPanels(opening?'radar-panel':null); });
document.querySelectorAll('.close-panel').forEach(button=>button.addEventListener('click',()=>closeAnalysisPanels(null)));
document.querySelector('#zoom-in').addEventListener('click', () => svg.transition().duration(220).call(zoom.scaleBy, 1.35));
document.querySelector('#zoom-out').addEventListener('click', () => svg.transition().duration(220).call(zoom.scaleBy, .74));
document.querySelector('#reset-view').addEventListener('click', () => svg.transition().duration(360).call(zoom.transform, homeTransform));
document.querySelectorAll('.jet-choice').forEach(button=>button.addEventListener('click',()=>selectJetPattern(Number(button.dataset.jet))));
document.querySelectorAll('.radar-product').forEach(button=>button.addEventListener('click',()=>{radarProduct=button.dataset.product;radarEnabled=true;drawRadar();}));
document.querySelector('#radar-site-button').addEventListener('click',()=>document.querySelector('#radar-sites').classList.toggle('hidden'));
document.querySelector('#boundary-button').addEventListener('click',()=>{boundariesVisible=!boundariesVisible;document.querySelector('#boundary-button').textContent=boundariesVisible?'HIDE FRONTS & PRESSURE':'SHOW FRONTS & PRESSURE';drawBoundaries();});
document.querySelector('#crosshair-button').addEventListener('click',()=>{crosshairEnabled=!crosshairEnabled;document.querySelector('#game-screen').classList.toggle('crosshair-enabled',crosshairEnabled);document.querySelector('#crosshair-button').style.color=crosshairEnabled?'#63def5':'';document.querySelector('#measure-readout').classList.toggle('hidden',!crosshairEnabled);});
document.querySelector('#close-thermo').addEventListener('click',()=>document.querySelector('#thermo-panel').classList.add('hidden'));

let touchStartX=0;
document.querySelector('#thermo-panel').addEventListener('touchstart',event=>{touchStartX=event.changedTouches[0].screenX;},{passive:true});
document.querySelector('#thermo-panel').addEventListener('touchend',event=>{const delta=event.changedTouches[0].screenX-touchStartX;if(Math.abs(delta)<45)return;document.querySelector('#thermo-page').classList.toggle('active',delta>0);document.querySelector('#sounding-page').classList.toggle('active',delta<0);},{passive:true});
document.querySelectorAll('.day-tab').forEach(tab => tab.addEventListener('click', () => {
  refreshOutlooksIfNeeded();
  const requestedDay = Number(tab.dataset.day);
  activeDay = activeDay === requestedDay ? null : requestedDay;
  document.querySelectorAll('.day-tab').forEach(x => x.classList.toggle('selected', Number(x.dataset.day) === activeDay));
  paintOutlook();
}));
setInterval(refreshOutlooksIfNeeded, 60000);
setInterval(() => { jetDrift += .18; drawJetStream(); }, 4500);
window.addEventListener('resize', () => { drawMenuMap(); if (svg) initializeMap(); });
drawMenuMap();

selectedRadar = radarSites[0];
document.querySelector('#radar-site-name').textContent = `${selectedRadar.id} • ${selectedRadar.name}`;
document.querySelector('#radar-sites').innerHTML = radarSites.map(site=>`<button data-radar="${site.id}">${site.id}<br><small>${site.name}</small></button>`).join('');
document.querySelectorAll('[data-radar]').forEach(button=>button.addEventListener('click',()=>{selectedRadar=radarSites.find(site=>site.id===button.dataset.radar);document.querySelector('#radar-site-name').textContent=`${selectedRadar.id} • ${selectedRadar.name}`;document.querySelector('#radar-sites').classList.add('hidden');radarRaster=null;drawRadar();focusRadar();}));

// A regular click resolves to the nearest city, while d3.zoom handles drag gestures separately.
document.querySelector('#weather-map').addEventListener('click',event=>{
  if (!svg || event.target.classList.contains('jet-stream')) return;
  const box=event.currentTarget.getBoundingClientRect(); const local=currentTransform.invert([event.clientX-box.left,event.clientY-box.top]); const coordinates=projection.invert(local);
  if (coordinates) showThermodynamics(coordinates[0],coordinates[1]);
});

document.querySelector('#weather-map').addEventListener('mousemove',event=>{
  if(!crosshairEnabled||!projection)return;
  const box=event.currentTarget.getBoundingClientRect();
  const xy=currentTransform.invert([event.clientX-box.left,event.clientY-box.top]);
  const ll=projection.invert(xy),p=weather.products[radarProduct];
  const value=ll&&radarEnabled?weather.sample(ll[0],ll[1],stormScenario,simulationMinutes,selectedRadar,radarElevation):null;
  const display=value&&value[radarProduct]!==null?(p.labels?p.labels[value[radarProduct]]:`${value[radarProduct].toFixed(radarProduct==='cc'?3:1)} ${p.unit}`):'NO ECHO / NO DATA';
  document.querySelector('#measure-readout span').textContent=display+(value?` · ${value.range.toFixed(0)} km · beam ${value.height.toFixed(1)} km above radar`:'');
});
document.querySelector('#jet-toggle').addEventListener('click',()=>{
  jetEnabled=!jetEnabled;document.querySelector('#jet-toggle').textContent=jetEnabled?'HIDE JET STREAM':'SHOW JET STREAM';drawJetStream();
});
document.querySelector('#scenario-select').addEventListener('change',event=>{
  stormScenario=event.target.value;simulationMinutes=0;radarRaster=null;
  selectedRadar=radarSites.find(s=>s.id===weather.scenarios[stormScenario].site);
  document.querySelector('#radar-site-name').textContent=`${selectedRadar.id} • ${selectedRadar.name}`;
  radarEnabled=true;updateScenarioInfo();drawRadar();drawBoundaries();focusRadar();
});
document.querySelector('#radar-elevation').addEventListener('change',event=>{radarElevation=Number(event.target.value);radarRaster=null;drawRadar();});
document.querySelector('#focus-radar').addEventListener('click',focusRadar);
document.querySelector('#radar-toggle').addEventListener('click',()=>{
  radarEnabled=!radarEnabled;document.querySelector('#radar-toggle').textContent=radarEnabled?'HIDE RADAR':'SHOW RADAR';drawRadar();
});
function stepSimulation() {
  simulationMinutes=Math.min(180,simulationMinutes+5);
  if(simulationMinutes===180){simulationPlaying=false;document.querySelector('#simulation-play').textContent='PLAY';}
  radarRaster=null;updateScenarioInfo();drawRadar();drawBoundaries();
}
document.querySelector('#simulation-play').addEventListener('click',()=>{
  if(simulationMinutes===180){simulationMinutes=0;radarRaster=null;updateScenarioInfo();drawRadar();drawBoundaries();}
  simulationPlaying=!simulationPlaying;document.querySelector('#simulation-play').textContent=simulationPlaying?'PAUSE':'PLAY';
});
document.querySelector('#simulation-step').addEventListener('click',stepSimulation);
document.querySelector('#simulation-reset').addEventListener('click',()=>{simulationMinutes=0;simulationPlaying=false;document.querySelector('#simulation-play').textContent='PLAY';radarRaster=null;updateScenarioInfo();drawRadar();drawBoundaries();});
setInterval(()=>{if(simulationPlaying&&document.querySelector('#game-screen').classList.contains('active'))stepSimulation();},1800);
jetRegime=jetPatterns[0];
document.querySelector('#jet-regime-name').textContent=jetRegime.name;
document.querySelector('#jet-regime-copy').textContent=jetRegime.copy;
updateScenarioInfo();
