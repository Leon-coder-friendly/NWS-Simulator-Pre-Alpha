const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const errors=[],win=new BrowserWindow({show:false,width:1440,height:950,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});
 win.webContents.on('console-message',(_event,level,message)=>{if(level>=3&&!message.includes('ERR_INTERNET'))errors.push(message);});
 try{
  await win.loadFile(process.env.NWS_TEST_PACKAGED?path.join(__dirname,'release/win-unpacked/resources/app.asar/index.html'):'index.html');
  await win.webContents.insertCSS('*{transition:none!important;animation:none!important}');
  const js=code=>win.webContents.executeJavaScript(code);
  const snapshot=async name=>{await win.webContents.capturePage();await new Promise(r=>setTimeout(r,200));fs.mkdirSync('qa',{recursive:true});fs.writeFileSync(`qa/${name}.png`,(await win.webContents.capturePage()).toPNG());};
  await js('initializationPromise');
  await js("document.getElementById('play-button').click()");
  assert.equal(await js('currentTransform.k'),1);assert.equal(await js("document.querySelectorAll('.domain-layer path').length"),0);
  assert.equal(await js("document.querySelectorAll('[data-setting],#apply-environment,#simulation-speed,#timeline-hour,#simulation-step').length"),0);
  await snapshot('national-startup');
  assert.equal(await js('jetEnabled'),false);
  await js("world=new physics.Atmosphere({seed:417},isLand);weatherAreas.clear();weatherAreas.set('CONUS',world);radarHistory.clear();document.getElementById('radar-button').click()");
  await js('advanceSimulation(240)');
  console.log(await js('JSON.stringify(world.summary())'));assert.ok(await js('world.totalInitiated>0'));
  await snapshot('evolving-reflectivity');
  for(const product of ['velocity','zdr','cc','kdp','spectrumWidth','hydro','rainRate','accumulation','echoTop','vil','composite','stormRelative']){
   const count=await js(`radarProduct='${product}';drawRadar();radarScan.values.filter(Number.isFinite).length`);
   console.log(product,count);assert.ok(count>0,product+' empty');if(product==='velocity')await snapshot('evolving-velocity');
  }
  await js(`document.getElementById('spc-button').click();document.querySelector('[data-day="1"]').click();focusDomain()`);await snapshot('environment-outlook');
  await js(`document.getElementById('environment-button').click();environmentProduct='cape';drawEnvironment()`);await snapshot('environment-controls');
  await js(`document.getElementById('jet-button').click()`);assert.equal(await js('jetEnabled'),true);
  await js(`document.getElementById('jet-toggle').click()`);assert.equal(await js('jetEnabled'),false);
  await js(`showThermodynamics(world.origin.lon,world.origin.lat);document.getElementById('profile-sounding').click()`);await snapshot('coupled-sounding');
  win.setSize(1000,680);await new Promise(r=>setTimeout(r,200));
  const bottom=await js(`document.getElementById('environment-button').click();document.getElementById('environment-panel').getBoundingClientRect().bottom<=innerHeight`);assert.ok(bottom);
  await js("document.getElementById('forecast-button').click();document.getElementById('forecast-day').value='30';drawForecast()");assert.ok(await js("document.getElementById('forecast-summary').textContent.includes('EXTENDED')"));await snapshot('extended-forecast');
  const minute=await js('world.minutes');await js("document.getElementById('forecast-day').value='2';drawForecast();document.getElementById('radar-loop').click()");assert.equal(await js('world.minutes'),minute);
  assert.ok(await js("radarSites.some(s=>s.id==='KCAE')&&radarSites.some(s=>s.id==='KAMX')&&radarSites.some(s=>s.id==='TCLT')"));
  await js("selectedRadar=radarSites.find(s=>s.id==='TCLT');radarProduct='cc';drawRadar();focusRadar()");assert.equal(await js('radarProduct'),'reflectivity');assert.equal(await js('radarScan.range'),90);assert.equal(await js('radarScan.spacing'),.15);
  await snapshot('terminal-radar');
  await js("radarEnabled=false;nextScanAt=Date.now()+240000;radarTick()");assert.equal(await js('world.minutes'),minute);
  await js("nextScanAt=Date.now()-1;radarTick()");assert.equal(await js('world.minutes'),minute+4);
  await js("selectedRadar=radarSites.find(s=>s.id==='PGUA');selectWeatherArea(selectedRadar)");await js("forecastVisible=false;drawForecast();radarEnabled=true;closePanels('radar-panel');drawRadar();focusRadar()");assert.ok(await js('world.point(selectedRadar.lon,selectedRadar.lat) !== null'));await snapshot('guam-radar');
  assert.deepEqual(errors,[]);console.log('Desktop checks passed.');app.exit(0);
 }catch(e){console.error(e);app.exit(1);}
});
