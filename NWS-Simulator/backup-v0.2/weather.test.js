const {test}=require('node:test');
const assert=require('node:assert/strict');
const w=require('./weather');
test('all scenarios produce finite, bounded shared radar moments',()=>{
  for(const kind of Object.keys(w.scenarios))for(let x=-220;x<=220;x+=11)for(let y=-220;y<=220;y+=11){
    const f=w.field(x,y,kind,30);
    for(const [key,value] of Object.entries(f))assert.ok(Number.isFinite(value),`${kind} ${key}`);
    assert.ok(f.z>=0&&f.z<=70);assert.ok(f.cc>=0&&f.cc<=1);assert.ok(f.rainRate>=0);
    assert.ok(f.hydro>=0&&f.hydro<=4);
  }
});
test('radial wind reverses sign across radar; storm-relative subtraction removes uniform translation',()=>{
  const s=w.scenarios.rain;
  const east=w.geographic(30,0,s),west=w.geographic(-30,0,s);
  const e=w.sample(...east,'rain',0,s),a=w.sample(...west,'rain',0,s);
  assert.ok(e.velocity>0);assert.ok(a.velocity<0);
  assert.equal(e.stormRelative,0);assert.equal(a.stormRelative,0);
});
test('range, cone of silence and elevation masks are applied',()=>{
  const s=w.scenarios.rain;
  assert.equal(w.sample(s.lon,s.lat,'rain',0,s),null);
  assert.equal(w.sample(...w.geographic(231,0,s),'rain',0,s),null);
  const ll=w.geographic(100,0,s),low=w.sample(...ll,'rain',0,s,.5),high=w.sample(...ll,'rain',0,s,4);
  assert.ok(low.reflectivity!==null);assert.equal(high.reflectivity,null);assert.ok(high.composite>5);
  assert.ok(high.height>low.height);
});
test('supercell has echo-poor hook interior, strong core and cyclonic wind',()=>{
  const eye=w.field(-9,-10,'supercell'),arc=w.field(-25,-10,'supercell'),core=w.field(9,13,'supercell');
  assert.ok(arc.z>eye.z+20);assert.ok(core.z>60);
  assert.ok(w.field(0,-10,'supercell').v>w.scenarios.supercell.motion[1]);
  assert.ok(w.field(-18,-10,'supercell').v<w.scenarios.supercell.motion[1]);
  assert.equal(core.hydro,2);assert.ok(core.cc<.96);
});
test('hurricane eye, eyewall and northern-hemisphere circulation are coherent',()=>{
  assert.ok(w.field(0,0,'hurricane').z<5);
  assert.ok(w.field(28,0,'hurricane').z>50);
  assert.ok(w.field(28,0,'hurricane').v>0);
  assert.ok(w.field(-28,0,'hurricane').v<0);
  assert.ok(w.field(0,0,'tropical').z>10);
});
test('winter precipitation is masked in liquid rain estimate; nor’easter coastal wind is from NE',()=>{
  const f=w.field(-80,80,'noreaster');
  assert.equal(f.hydro,3);assert.equal(f.rainRate,0);assert.ok(f.u<0&&f.v<0);
});
test('physical intensity thresholds and scenario movement use correct units',()=>{
  assert.ok(Math.abs(w.bombThreshold(60)-24)<1e-10);assert.ok(w.bombThreshold(40)>17&&w.bombThreshold(40)<18);
  for(const [wind,category] of [[33,'Depression'],[34,'Tropical storm'],[64,'Category 1'],[83,'Category 2'],[96,'Category 3'],[113,'Category 4'],[137,'Category 5']])assert.equal(w.hurricaneCategory(wind),category);
  const s=w.scenarios.supercell,c=w.centerAt(s,60),[x,y]=w.local(c.lon,c.lat,s);
  assert.ok(Math.abs(x-32*1.852)<1e-6);assert.ok(Math.abs(y-14*1.852)<1e-6);
});
test('palette treats missing data as transparent and all classification labels map to colors',()=>{
  for(const p of Object.keys(w.products)){assert.equal(w.color(null,p),null);assert.equal(w.color(NaN,p),null);assert.ok(w.color(w.products[p].max,p));}
});

