const {app,BrowserWindow}=require('electron');
const fs=require('fs');
const path=require('path');
const assert=require('node:assert/strict');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  const errors=[];
  const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=3&&!message.includes('ERR_INTERNET'))errors.push(message);});
  try {
    await win.loadFile(process.env.NWS_TEST_PACKAGED ? path.join(__dirname,'release/win-unpacked/resources/app.asar/index.html') : 'index.html');
    await win.webContents.insertCSS('* { transition: none !important; animation: none !important; }');
    const result=await win.webContents.executeJavaScript(`(async()=>{
      const click=id=>document.getElementById(id).click();
      click('play-button');
      if(document.querySelectorAll('.jet-stream').length)throw Error('Jet active at startup');
      if(contiguous.features.length!==49)throw Error('Expected 48 states plus DC');
      click('radar-button');
      await new Promise(r=>setTimeout(r,450));
      const samples=[];
      for(const kind of Object.keys(weather.scenarios)) {
        const select=document.querySelector('#scenario-select');select.value=kind;select.dispatchEvent(new Event('change'));
        let peak=0,count=0;
        radarRaster.forEach(s=>{if(s&&s.reflectivity!==null){count++;peak=Math.max(peak,s.reflectivity);}});
        if(count<50)throw Error(kind+' empty scan');
        for(const p of Object.keys(weather.products)) {
          document.querySelector('[data-product="'+p+'"]').click();
          if(!document.querySelector('.radar-layer image'))throw Error(kind+' '+p+' missing image');
        }
        samples.push({kind,count,peak});
      }
      click('boundary-button');
      if(!document.querySelector('.boundary-layer path'))throw Error('Missing boundaries');
      click('jet-button');if(!document.querySelector('.jet-stream'))throw Error('Jet does not enable');
      click('jet-toggle');if(document.querySelector('.jet-stream'))throw Error('Jet does not disable');
      click('radar-button');
      document.querySelector('#scenario-select').value='supercell';document.querySelector('#scenario-select').dispatchEvent(new Event('change'));
      document.querySelector('[data-product="reflectivity"]').click();
      click('simulation-step');if(simulationMinutes!==5)throw Error('Step failed');
      click('simulation-reset');if(simulationMinutes!==0)throw Error('Reset failed');
      click('boundary-button');
      await new Promise(r=>setTimeout(r,450));
      return samples;
    })()`);
    fs.mkdirSync('qa',{recursive:true});
    await win.webContents.capturePage();
    await new Promise(r=>setTimeout(r,500));
    await new Promise(r=>setTimeout(r,250));
    fs.writeFileSync('qa/supercell.png',(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`document.querySelector('[data-product="velocity"]').click()`);
    await new Promise(r=>setTimeout(r,250));
    fs.writeFileSync('qa/velocity.png',(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`document.querySelector('#scenario-select').value='hurricane';document.querySelector('#scenario-select').dispatchEvent(new Event('change'));document.querySelector('[data-product="reflectivity"]').click();new Promise(r=>setTimeout(r,450))`);
    await new Promise(r=>setTimeout(r,250));
    fs.writeFileSync('qa/hurricane.png',(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript("document.querySelector('#scenario-select').value='noreaster';document.querySelector('#scenario-select').dispatchEvent(new Event('change'));document.querySelector('#boundary-button').click()");
    await new Promise(r=>setTimeout(r,250));
    await win.webContents.capturePage();
    await new Promise(r=>setTimeout(r,250));
    fs.writeFileSync('qa/noreaster.png',(await win.webContents.capturePage()).toPNG());
    win.setSize(1000,680);
    await new Promise(r=>setTimeout(r,300));
    const layout=await win.webContents.executeJavaScript(`(()=>{
      focusRadar();
      document.querySelector('#crosshair-button').click();
      const s=weather.scenarios[stormScenario],ll=weather.geographic(-60,70,weather.centerAt(s,simulationMinutes));
      const xy=currentTransform.apply(projection(ll));
      document.querySelector('#weather-map').dispatchEvent(new MouseEvent('mousemove',{clientX:xy[0],clientY:xy[1]}));
      const cursorLL=projection.invert(currentTransform.invert(xy.map(Math.trunc))); const expected=weather.sample(...cursorLL,stormScenario,simulationMinutes,selectedRadar,radarElevation);
      const readout=document.querySelector('#measure-readout span').textContent;
      const panel=document.querySelector('#radar-panel').getBoundingClientRect();
      return {bottom:panel.bottom,height:innerHeight,readout,expected:expected.reflectivity.toFixed(1)};
    })()`);
    assert.ok(layout.bottom<=layout.height);
    assert.ok(layout.readout.includes(layout.expected+' dBZ'),JSON.stringify(layout));
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({scenarios:result,errors},null,2));
    app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});





