'use strict';
const synoptic=require('./synoptic');
function run(w){
 const f=Object.create(Object.getPrototypeOf(w));Object.assign(f,w);
 f.config={...w.config};f.low=JSON.parse(JSON.stringify(w.low));f.pressureSystems=JSON.parse(JSON.stringify(w.pressureSystems));f.tropical={...w.tropical};f.coldPools=[];f.remnants=[];f.landCache=new Map(w.landCache);f.record=()=>{};
 f.grid=w.grid.map(n=>({x:n.x,y:n.y,temp:n.temp,dew:n.dew}));
 return {issued:w.minutes,cycle:Math.floor((w.minutes+w.config.startHour*60)/360),state:f,products:new Map()};
}
function forecast(run,day){
 if(!Number.isInteger(day)||day<1||day>30)throw Error('Forecast lead must be 1–30 days');
 if(run.products.has(day))return run.products.get(day);
 const source=run.state,f=Object.create(Object.getPrototypeOf(source));Object.assign(f,source);f.config={...source.config};f.low=JSON.parse(JSON.stringify(source.low));f.pressureSystems=JSON.parse(JSON.stringify(source.pressureSystems));f.landCache=new Map(source.landCache);
 for(let m=0;m<day*1440;m+=60){f.minutes+=60;f.evolveClimate(60);synoptic.step(f,60);const wind=synoptic.jet(f,f.low.x,f.low.y);f.low.x+=(5+wind.u*.3)*3.6;f.low.y+=wind.v*.3*3.6;f.low.pressure+=(1018-f.low.pressure)*.025;}
 const persistence=Math.exp(-day/4),spread=1.2+Math.sqrt(day)*1.6;
 const temperature=[],pressure=[],rain=[];
 for(const n of source.grid){const base=f.background(n.x,n.y),temp=n.temp*persistence+base.temp*(1-persistence),dew=Math.min(temp,n.dew*persistence+base.dew*(1-persistence));const e=f.environment(n.x,n.y,{temp,dew,cold:0,spent:0});temperature.push(temp);pressure.push(e.pressure);rain.push(Math.min(1,e.forcing*f.config.humidity*1.6));}
 const result={day,valid:run.issued+day*1440,temperature,pressure,rain,spread,confidence:day<=3?'Higher relative confidence':day<=7?'Moderate relative confidence':day<=16?'Low confidence':'Very low confidence · broad tendency only',extended:day>16};run.products.set(day,result);return result;
}
module.exports={run,forecast};
