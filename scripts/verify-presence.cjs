const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('src/main/resources/static/viewer-presence.js','utf8');
(async()=>{
  const requests=[],beacons=[],events={},label={removeAttribute(){}};let tick,fail=false;
  const remove = (name,fn) => { if (events[name] === fn) delete events[name]; };
  const document={hidden:false,getElementById:()=>label,addEventListener:(name,fn)=>events[name]=fn,removeEventListener:remove};
  const context={document,window:{addEventListener:(name,fn)=>events[name]=fn,removeEventListener:remove},crypto:{randomUUID:()=> '00000000-0000-0000-0000-000000000001'},
    fetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return {ok:!fail,json:async()=>({count:3})};},
    navigator:{sendBeacon:(url,body)=>(beacons.push({url,body}),true)},Blob,setInterval:fn=>(tick=fn,1),clearInterval(){}};
  vm.createContext(context);vm.runInContext(source,context);const stop = context.startViewerPresence('10001');
  await new Promise(setImmediate);assert.equal(label.textContent,'3人正在看');assert.equal(requests[0].url,'/api/videos/10001/viewers');
  await tick();assert.equal(requests[0].body.sessionId,requests[1].body.sessionId);
  document.hidden=true;events.visibilitychange();await tick();assert.equal(requests.length,2);assert.equal(JSON.parse(await beacons[0].body.text()).active,false);
  document.hidden=false;events.visibilitychange();await new Promise(setImmediate);assert.equal(requests.length,3);
  fail=true;await tick();assert.equal(label.textContent,'—人正在看');
  events.pagehide();await tick();assert.equal(requests.length,4);assert.ok(beacons.length>=2);
  fail=false;events.pageshow({persisted:true});await new Promise(setImmediate);assert.equal(label.textContent,'3人正在看');
  stop();
  const countAfterStop = requests.length;
  await tick();
  assert.equal(requests.length, countAfterStop);
  assert.equal(Object.keys(events).length, 0, 'switching removes the old presence listeners');
  const stopNext = context.startViewerPresence('10002');
  await new Promise(setImmediate);
  assert.equal(requests.at(-1).url, '/api/videos/10002/viewers');
  stopNext();
  console.log('PASS: viewer heartbeat, same-tab session, hidden/leave cleanup, recovery, honest failure display, bfcache resume');
})().catch(e=>{console.error(e);process.exitCode=1;});
