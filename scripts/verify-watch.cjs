const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  style = { setProperty(key,value) { this[key] = value; } };
  constructor() { this.hidden = false; this.value = 0; this.children = []; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.classes=new Set(); this.classList = { add:v=>this.classes.add(v), remove:v=>this.classes.delete(v), contains:v=>this.classes.has(v), toggle:(v,force)=>{const next=force===undefined?!this.classes.has(v):force;next?this.classes.add(v):this.classes.delete(v);return next;} }; }
  show() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
  after() {}
  contains() { return false; }
  append(...items) { this.children.push(...items); for (const item of items) if (item instanceof Element) item.parent = this; }
  replaceChildren(...items) { this.children = items; }
  removeAttribute(key) { delete this.attributes[key]; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  clientWidth = 500;
  clientHeight = 281;
  offsetWidth = 100;
  offsetHeight = 24;
  addEventListener(event, fn) { (this.listeners[event] ||= []).push(fn); }
  emit(event, details) { (this.listeners[event] || []).forEach(fn => fn(details)); }
  setAttribute(k,v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k] ?? null; }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return {left:100,top:100,width:500,height:281,bottom:125}; }
}
async function setup(storage = new Map(), collection = {title:null,items:[]}, accolades = {}, playlist = {}) {
  const elements = new Map(); const el = id => { if (!elements.has(id)) elements.set(id,new Element()); return elements.get(id); };
  const p = el('player'); Object.assign(p,{ currentTime:0, duration:100, load(){this.currentTime=0;}, readyState:4, paused:true, ended:false, seeking:false, pause(){this.paused=true;this.emit('pause');}, async play(){this.paused=false;this.emit('play');} });
  el('login-dialog').open = false;
  let now = 0, tick, prompts = 0, copied = '', postDanmaku, resizeDanmaku;
  const presence = [], disposed = [], comments = [], fullReloads = [];
  const location = { search: playlist.search || '', pathname:'/video/10001', origin:'http://localhost', href:'http://localhost/video/10001' + (playlist.search || ''), assign(href){fullReloads.push(href);} };
  const pushState = (_,__,href) => { const url = new URL(href, location.origin); Object.assign(location, {search:url.search, pathname:url.pathname, href:url.href}); navigations.push(href); };
  const documentEvents={}, windowEvents={}, interactionCalls=[], navigations=[];
  const context = { setupWatchComments(id){comments.push(id);},setupWatchScroll(){},setupRelatedExpansion(){},startViewerPresence(id){presence.push(id);return () => disposed.push(id);}, el, path:'/video/10001', duration:n=>`${Math.floor(n/60)}`.padStart(2,'0')+':'+`${n%60}`.padStart(2,'0'), shortCount:String,
    AbortController, currentAccount:playlist.account,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}, performance:{now:()=>now},
    setInterval:fn=>(tick=fn,1),clearInterval(){},setTimeout(){return 1;},clearTimeout(){},
    ResizeObserver:class { constructor(callback) { resizeDanmaku = callback; } observe() {} },
    window:{addEventListener(event,fn){(windowEvents[event] ||= []).push(fn);}}, navigator:{clipboard:{writeText:async text=>{copied=text;}}}, document:{ documentElement:{clientWidth:1200}, body:new Element(), title:'', activeElement:{tagName:'BODY'}, addEventListener(event,fn){(documentEvents[event] ||= []).push(fn);},querySelector:()=>new Element() },
    openLogin:()=>{prompts++;el('login-dialog').open=true;},URLSearchParams,
    location, history:{pushState}, URL,
    interaction:async (...args)=>{ interactionCalls.push(args); return args[0] === '/me/space' ? playlist.space : playlist.videos; },
    apiRequest:async (_,endpoint,request)=>{
      interactionCalls.push([endpoint,request.method,request.body]);
      if (endpoint.endsWith('/danmaku/reports')) return ['3'];
      if (endpoint.endsWith('/reasons')) return [{id:'10015',name:'色情低俗'}, {id:'10016',name:'引战不友善言论'}];
    },
    setupVideoInteractions:(_id,_author,_player,_duration,callback)=>{ postDanmaku=callback; },
    node:(tag,cls,text)=>Object.assign(new Element(),{className:cls,textContent:text}),
    link:(href,label,className)=>Object.assign(new Element(),{href,className,textContent:label}),
    icon:name=>Object.assign(new Element(),{name}),card:()=>new Element(),attachCover:(img,url)=>{img.src=url;},
    api:async url=> playlist.videoRequest && /^\/videos\/[^/]+$/.test(url) ? playlist.videoRequest(url) : url.endsWith('/collection')?collection:url.endsWith('/engagement')?{like:3,coin:4,favorite:5,share:6}:url.endsWith('/danmaku')?(playlist.danmakuRows ?? [
      {id:'1',userId:'7',content:'A',timestamp:2,sentAt:'2026-11-12T12:00:00'}, {id:'2',userId:'7',content:'B',timestamp:3,sentAt:'2026-11-12T12:01:00'}, {id:'3',userId:'8',content:'C',timestamp:4,sentAt:'2026-11-12T12:02:00'}
    ]):url.startsWith('/authors/')?{followers:10}:url.startsWith('/videos?')?{items:playlist.related ?? []}: {video:{id:location.pathname.split('/')[2],title:'Video ' + location.pathname.split('/')[2],authorId:'1',streamUrl:'/test.mp4',plays:1,danmaku:3},tags:[],...accolades}
  };
  vm.createContext(context);vm.runInContext(fs.readFileSync('src/main/resources/static/watch-sidebar.js','utf8'),context);vm.runInContext(fs.readFileSync('src/main/resources/static/watch-preferences.js','utf8'),context);vm.runInContext(fs.readFileSync('src/main/resources/static/watch.js','utf8'),context);await context.loadWatchPage();
  if (playlist.report) {
    const interactions = fs.readFileSync('src/main/resources/static/interactions.js', 'utf8');
    context.document.querySelector = () => el('danmaku-panel').children.find(child => child.open);
    vm.runInContext(interactions.slice(0, interactions.indexOf('\nsetupNav();')), context);
  }
  return {el,p,location,presence,disposed,comments,fullReloads,storage,postDanmaku,resizeDanmaku,interactionCalls,navigations,keydown:event=>(documentEvents.keydown||[]).forEach(fn=>fn(event)),pageEvent:(name,event={})=>(windowEvents[name]||[]).forEach(fn=>fn(event)),copied:()=>copied,fullscreen:flag=>{context.document.fullscreenElement=flag?el('player-shell'):null;(documentEvents.fullscreenchange||[]).forEach(fn=>fn());}, advance(ms,move=true){now+=ms;if(move&&!p.paused)p.currentTime+=ms/1000;tick();},prompts:()=>prompts};
}
(async()=>{
  const mine = await setup();
  const menuClick = {preventDefault(){}, stopPropagation(){}};
  const mineOption = mine.el('sidebar-view-mine');
  const mineList = mine.el('danmaku-list');
  mineOption.onclick(menuClick);
  assert.equal(mine.prompts(), 1);
  assert.equal(mineList.children.length, 3);
  mine.pageEvent('accountchange', {detail:{uid:7}});
  mineOption.onclick(menuClick);
  assert.equal(mine.el('danmaku-sidebar-title').textContent, '我的弹幕');
  assert.deepEqual(mineList.children.map(row => row.children.slice(1).map(cell => cell.textContent)), [
    ['A', '11-12 12:00', '撤回'], ['B', '11-12 12:01', '撤回']
  ]);
  const mineWithdraw = mineList.children[0].children[3];
  await Promise.all([mineWithdraw.onclick(), mineWithdraw.onclick()]);
  assert.deepEqual(mine.interactionCalls.filter(([, method]) => method === 'DELETE'), [['/danmaku/1', 'DELETE']]);
  assert.deepEqual(mineList.children.map(row => row.children[1].textContent), ['B']);
  mine.pageEvent('accountchange', {detail:{uid:8}});
  assert.deepEqual(mineList.children.map(row => row.children[1].textContent), ['C']);
  mine.pageEvent('accountchange', {detail:null});
  assert.equal(mine.el('danmaku-sidebar-title').textContent, '弹幕列表');
  assert.deepEqual(mineList.children.map(row => row.children[1].textContent), ['B', 'C']);
  console.log('PASS: my danmaku login gate, ownership, withdrawal and account changes');

  const history = await setup(new Map(), undefined, {}, {danmakuRows: [
    {id:'1',userId:'7',content:'Old',timestamp:2,sentAt:'2024-02-29T12:00:00'},
    {id:'2',userId:'7',content:'Selected day',timestamp:3,sentAt:'2024-03-05T23:59:59'},
    {id:'3',userId:'8',content:'New',timestamp:4,sentAt:'2024-03-07T12:02:00'}
  ]});
  const historyToggle = history.el('danmaku-history-toggle');
  const historyCalendar = history.el('danmaku-history-calendar');
  const historyDay = day => history.el('danmaku-history-days').children.find(button => button.textContent === String(day));
  const historyContents = () => history.el('danmaku-list').children.map(row => row.children[1].textContent);
  historyToggle.onclick();
  assert.equal(history.prompts(), 1);
  assert.equal(historyCalendar.hidden, true);
  history.pageEvent('accountchange', {detail:{uid:'42'}});
  historyToggle.onclick();
  assert.equal(historyCalendar.hidden, false);
  assert.equal(historyDay(6).disabled, true);
  history.el('danmaku-history-previous').onclick();
  assert.equal(historyDay(29).disabled, false);
  history.el('danmaku-history-next').onclick();
  historyDay(5).onclick();
  assert.deepEqual(historyContents(), ['Selected day', 'Old']);
  assert.equal(historyCalendar.hidden, true);
  assert.equal(history.el('danmaku-content-heading').textContent, '弹幕内容（3月5日）');
  historyToggle.onclick();
  history.el('danmaku-history-reset').onclick();
  assert.deepEqual(historyContents(), ['Old', 'Selected day', 'New']);
  historyToggle.onclick();
  historyDay(5).onclick();
  history.pageEvent('accountchange', {detail:null});
  assert.deepEqual(historyContents(), ['Old', 'Selected day', 'New']);
  console.log('PASS: history login gate, month navigation, inclusive cutoff and reset');
  const createTracks = vm.runInNewContext(fs.readFileSync('src/main/resources/static/watch.js', 'utf8') + '\nsetupDanmakuTracks;');
  const overlay = Object.assign(new Element(), {clientHeight:84});
  const tracks = createTracks(overlay);
  const first = new Element(), second = new Element(), third = new Element();
  let firstRight = 650;
  first.getBoundingClientRect = () => ({right:firstRight});
  second.getBoundingClientRect = () => ({right:650});
  assert.equal(tracks.add(first, 'scroll', 8), true);
  assert.equal(tracks.add(second, 'scroll', 8), true);
  assert.equal(first.style.top, '0px');
  assert.equal(second.style.top, '30px');
  firstRight = 580;
  third.offsetWidth = 300;
  assert.equal(tracks.add(third, 'scroll', 8), true);
  assert.equal(third.style.top, '0px');
  assert.equal(first.style.animationDuration, '9.6s');
  assert.equal(third.style.animationDuration, '12.8s');
  for (const mode of ['top','bottom']) {
    tracks.clear();
    const fixed = [new Element(), new Element(), new Element(), new Element()];
    assert.deepEqual(fixed.map(line => tracks.add(line, mode, 8)), [true,true,true,false]);
    assert.deepEqual(fixed.slice(0,3).map(line => line.style.top), mode === 'top' ? ['0px','30px','60px'] : ['60px','30px','0px']);
    fixed[0].emit('animationend');
    assert.equal(tracks.add(fixed[3], mode, 8), true);
    assert.equal(fixed[3].style.top, fixed[0].style.top);
  }
  console.log('PASS: rolling clearance, equal rolling speed, fixed lanes and release on animation end');

  const styled = await setup();
  styled.pageEvent('accountchange', { detail: { uid: '7' } });
  const own = {id:'20', userId:'7', content:'Own', timestamp:25, mode:'bottom', size:'small', color:'#FF0000'};
  styled.p.currentTime = own.timestamp;
  styled.postDanmaku(own);
  const overlayLines = styled.el('danmaku-overlay').children;
  const ownLine = overlayLines.find(line => line.textContent === own.content);
  assert.match(ownLine.className, /own-danmaku/);
  assert.equal(ownLine.dataset.mode, 'bottom');
  assert.equal(ownLine.style.color, '#FF0000');
  assert.equal(ownLine.style.fontSize, '17.6px');
  styled.postDanmaku({id:'21', userId:'8', content:'Scrolling', timestamp:25, mode:'scroll'});
  const styledOverlay = styled.el('danmaku-overlay');
  const rollingLine = styledOverlay.children.find(line => line.textContent === 'Scrolling');
  const originalDuration = rollingLine.style.animationDuration;
  for (const switchFullscreen of [styled.fullscreen, () => styled.el('web-fullscreen').onclick()]) {
    switchFullscreen(true);
    Object.assign(styledOverlay, {clientWidth:1000, clientHeight:500});
    styled.resizeDanmaku();
    assert.ok(styledOverlay.children.includes(ownLine));
    assert.ok(styledOverlay.children.includes(rollingLine));
    assert.equal(ownLine.style.top, '476px');
    assert.equal(rollingLine.style['--danmaku-travel'], '1000px');
    assert.equal(rollingLine.style.animationDuration, originalDuration);
    switchFullscreen(false);
    Object.assign(styledOverlay, {clientWidth:500, clientHeight:281});
    styled.resizeDanmaku();
    assert.ok(styledOverlay.children.includes(ownLine));
    assert.ok(styledOverlay.children.includes(rollingLine));
    assert.equal(ownLine.style.top, '257px');
    assert.equal(rollingLine.style['--danmaku-travel'], '500px');
  }
  styled.p.currentTime = 29.9; styled.p.emit('timeupdate');
  assert.ok(styled.el('danmaku-overlay').children.includes(ownLine));
  styled.p.currentTime = 30; styled.p.emit('timeupdate');
  assert.equal(styled.el('danmaku-overlay').children.includes(ownLine), false);
  styled.p.emit('seeking'); styled.p.currentTime = 28; styled.p.emit('seeked');
  const replayed = styled.el('danmaku-overlay').children.find(line => line.textContent === own.content);
  replayed.emit('mouseenter');
  assert.equal(styled.el('dm-action-report').hidden, true);
  const ownRow = styled.el('danmaku-list').children.find(row => row.children[1].textContent === own.content);
  assert.equal(ownRow.children.length, 3, 'own danmaku shows the timestamp, content and date');
  const withdraw = styled.el('dm-action-withdraw');
  assert.equal(withdraw.hidden, false);
  await withdraw.onclick();
  assert.deepEqual(styled.interactionCalls.filter(([, method]) => method === 'DELETE'), [['/danmaku/20', 'DELETE']]);
  assert.equal(styled.el('danmaku-actions').hidden, true);
  assert.equal(styled.el('control-notice').textContent, '撤回成功');
  assert.ok(styled.el('control-notice').classList.contains('control-notice-compact'));
  assert.ok(!styledOverlay.children.some(line => line.textContent === own.content));
  assert.ok(!styled.el('danmaku-list').children.some(row => row.children[1].textContent === own.content));
  styled.p.emit('seeking'); styled.p.currentTime = 25; styled.p.emit('seeked');
  assert.ok(!styledOverlay.children.some(line => line.textContent === own.content));
  const otherLine = styledOverlay.children.find(line => line.textContent === 'Scrolling');
  otherLine.emit('mouseenter');
  assert.equal(withdraw.hidden, true);
  await withdraw.onclick();
  assert.equal(styled.interactionCalls.filter(([, method]) => method === 'DELETE').length, 1);
  console.log('PASS: styled own fixed danmaku, own-only withdrawal and removal from list and timeline');
  const t=await setup();
  const seek = t.el('seek'), seekBar = t.el('seek-bar');
  const previewFrame = Object.assign(t.el('seek-preview-frame'), {currentTime:0, duration:100, readyState:0, hidden:true});
  seek.emit('pointermove', {pointerType:'mouse',clientX:350});
  assert.equal(t.el('seek-preview-time').textContent, '00:50');
  assert.equal(seekBar.style['--seek-hover'], '50%');
  assert.equal(t.p.currentTime, 0, 'hovering only previews a time');
  assert.equal(previewFrame.src, undefined, 'hovering does not fetch video frames');
  seek.emit('pointerleave');
  assert.equal(t.el('seek-preview').hidden, true);
  seek.emit('pointerdown', {button:0});
  assert.equal(seekBar.dataset.scrubbing, 'true');
  seek.value = 95; seek.oninput();
  assert.equal(t.p.currentTime, 95);
  assert.equal(seekBar.dataset.direction, 'right');
  assert.equal(seekBar.style['--seek-progress'], '95%');
  assert.equal(previewFrame.src, '/test.mp4');
  assert.equal(previewFrame.hidden, true);
  previewFrame.readyState = 1; previewFrame.emit('loadedmetadata');
  assert.equal(previewFrame.currentTime, 95);
  previewFrame.seeking = true;
  t.p.currentTime = 94; t.p.emit('timeupdate');
  assert.equal(seek.value, 95, 'media updates do not override the slider during a drag');
  seek.value = 12; seek.oninput();
  assert.equal(t.p.currentTime, 12);
  assert.equal(seekBar.dataset.direction, 'left');
  assert.equal(previewFrame.currentTime, 95, 'only one preview seek runs at a time');
  previewFrame.seeking = false; previewFrame.readyState = 2; previewFrame.emit('seeked');
  assert.equal(previewFrame.currentTime, 12);
  previewFrame.emit('seeked');
  assert.equal(previewFrame.hidden, false);
  t.pageEvent('pointerup');
  assert.equal(previewFrame.hidden, true);
  assert.equal(seekBar.dataset.scrubbing, undefined);
  assert.equal(seekBar.dataset.direction, undefined);
  t.p.currentTime = 0; t.p.emit('timeupdate');
  assert.equal(seekBar.style['--seek-progress'], '0%');
  assert.equal(t.el('video-meta').children.length,3);
  const decorated = await setup(new Map(), undefined, {mustWatch:true,bestSiteRank:6});
  const [mustWatchBadge, rankBadge] = decorated.el('video-meta').children;
  assert.equal(mustWatchBadge.href, '/popular/must-watch');
  assert.equal(mustWatchBadge.children[1], '入站必刷');
  assert.equal(rankBadge.href, '/popular/rank');
  assert.equal(rankBadge.children[1], '全站排行榜最高第6名');
  assert.equal(rankBadge.target, '_self');
  t.p.pause();t.advance(5000);assert.equal(t.storage.has('bili-trial-v1:10001'),false,'pause does not count');
  await t.el('trial-start').onclick();
  assert.equal(t.p.paused,false,'starting a trial resumes paused playback');
  assert.equal(t.el('trial-tip').hidden,true,'starting a trial hides the tip');
  t.p.seeking=true;t.p.currentTime=80;t.advance(100);t.p.seeking=false;assert.equal(t.storage.has('bili-trial-v1:10001'),false,'seek does not count');
  for(let i=0;i<100;i++)t.advance(100);assert.equal(t.p.paused,false,'ten seconds does not exhaust the trial');
  t.p.readyState=2;t.advance(2000,false);t.p.readyState=4;
  assert.equal(t.p.paused,false,'buffering does not exhaust the trial');
  for(let i=0;i<201;i++)t.advance(100);
  assert.equal(t.p.paused,true);assert.equal(t.prompts(),1);assert.equal(t.el('trial-ended').hidden,false);
  t.el('login-dialog').open=false;await t.el('play-toggle').onclick();assert.equal(t.p.paused,true);assert.equal(t.prompts(),2);
  assert.equal(t.storage.has('bili-trial-v1:10001'),false,'trial time is not persisted');
  const oldStorage = new Map(t.storage);oldStorage.set('bili-trial-v1:10001','30');
  const restored=await setup(oldStorage);assert.equal(restored.p.paused,false,'new visit ignores previously locked trial');
  await restored.el('trial-start').onclick();
  assert.equal(restored.p.paused,false,'starting a trial during playback keeps playing');
  assert.equal(restored.el('trial-tip').hidden,true,'starting a trial during playback hides the tip');
  for(let i=0;i<301;i++)restored.advance(100);assert.equal(restored.p.paused,true,'new visit still locks after 30 seconds');
  restored.pageEvent('pagehide');restored.pageEvent('pageshow',{persisted:true});
  assert.equal(restored.el('trial-ended').hidden,true,'back navigation clears the lock');
  assert.equal(restored.p.currentTime,0);
  await restored.el('play-toggle').onclick();assert.equal(restored.p.paused,false,'back navigation restores trial playback');
  for(let i=0;i<301;i++)restored.advance(100);assert.equal(restored.p.paused,true,'back navigation starts a fresh 30 second budget');
  let rows=t.el('danmaku-list').children;rows[0].children[3].onclick();rows=t.el('danmaku-list').children;
  assert.ok(rows[0].className.includes('blocked'));assert.ok(rows[1].className.includes('blocked'));assert.ok(!rows[2].className.includes('blocked'));
  rows[1].children[3].onclick();assert.ok(!t.el('danmaku-list').children[0].className.includes('blocked'));
  assert.equal(t.el('coin-count').textContent,'4');
  t.p.playbackRate=2;t.p.emit('ratechange');assert.equal(t.p.playbackRate,1,'speed locked without login');
  assert.equal(t.el('speed-options').hidden,true);
  t.el('rate-1.25').onclick();assert.equal(t.p.playbackRate,1);
  t.pageEvent('accountchange',{detail:{uid:'10001'}});
  assert.equal(t.el('speed-options').hidden,false);
  t.el('rate-1.25').onclick();t.p.emit('ratechange');
  assert.equal(t.p.playbackRate,1.25);
  assert.equal(t.el('rate-1.25').attributes['aria-pressed'],'true');
  assert.equal(t.el('playback-rate').textContent,'1.25x');
  t.el('rate-2').onclick();t.p.emit('ratechange');
  assert.equal(t.el('playback-rate').textContent,'2.0x');
  t.pageEvent('accountchange',{detail:null});assert.equal(t.p.playbackRate,1);
  t.el('auto-start').onchange({target:{checked:false}});const noAutoplay=await setup(t.storage);assert.equal(noAutoplay.el('auto-start').checked,false);
  t.el('mirror-toggle').onchange({target:{checked:true}});assert.ok(t.p.attributes.style.includes('scaleX(-1)'));
  t.el('loop-toggle').onchange({target:{checked:true}});assert.equal(t.p.loop,true);
  const collectionPage = await setup(new Map(), {title:'Test collection',plays:30,items:[{id:'10001',title:'First',duration:60,plays:20,danmaku:3,coverUrl:'/first.jpg'},{id:'10002',title:'Second',duration:90,plays:10,danmaku:2,coverUrl:'/second.jpg'}]});
  assert.equal(collectionPage.el('video-collection').hidden,false);assert.equal(collectionPage.el('collection-position').textContent,'(1/2)');
  assert.equal(collectionPage.el('related-heading').hidden, true);
  const collectionList = collectionPage.el('collection-list');
  const [activeEpisode, otherEpisode] = collectionList.children;
  assert.equal(collectionList.children.length, 2);
  assert.equal(activeEpisode.getAttribute('aria-current'), 'true');
  assert.equal(activeEpisode.children[0].children[0].src, '/first.jpg');
  assert.equal(otherEpisode.href, '/video/10002');
  assert.equal(otherEpisode.children[2].textContent, '01:30');
  const collectionExpand = collectionPage.el('collection-expand');
  collectionList.scrollTop = 32;
  activeEpisode.offsetTop = 72;
  collectionExpand.onclick();
  assert.equal(collectionExpand.getAttribute('aria-expanded'), 'true');
  assert.equal(collectionList.dataset.expanded, 'true');
  assert.equal(collectionPage.el('danmaku-panel').inert, true);
  assert.equal(collectionList.scrollTop, 72);
  assert.equal(collectionExpand.getAttribute('aria-label'), '收起合集列表');
  collectionExpand.onclick();
  assert.equal(collectionExpand.getAttribute('aria-expanded'), 'false');
  assert.equal(collectionList.dataset.expanded, 'false');
  assert.equal(collectionPage.el('danmaku-panel').inert, false);
  assert.equal(collectionList.scrollTop, 32);
  assert.equal(collectionExpand.getAttribute('aria-label'), '展开合集列表');
  assert.equal(collectionList.children.length, 2);
  assert.equal(t.el('video-collection').hidden, true);
  assert.equal(t.el('related-heading').hidden, false);
  const reports = await setup(new Map(), {
    title:'Test collection', ownerId:'9', plays:30, items:[{id:'10001',title:'First',duration:60}]
  }, {}, {report:true});
  for (const uid of ['1', '9', '6']) {
    reports.pageEvent('accountchange', {detail:{uid}});
    assert.equal(reports.el('video-subscribe').hidden, uid !== '6');
  }
  const list = reports.el('danmaku-list');
  const report = list.children[0].children[3];
  report.emit('mouseenter');
  assert.equal(reports.el('sender-tooltip').textContent, '举报该弹幕');
  report.onclick();
  await new Promise(setImmediate);
  const dialog = reports.el('danmaku-panel').children.find(child => child.open);
  const form = dialog.children.find(child => child.className === 'danmaku-report-form');
  const [choices, options, , footer] = form.children;
  assert.equal(choices.children.length, 2);
  assert.equal(choices.children[0].children[0].children[0].textContent, '色情低俗');
  assert.equal(footer.children[1].disabled, true);
  const radio = choices.children[0].children[0].children[1];
  radio.checked = true;
  radio.onchange();
  assert.equal(choices.children[0].children[1].className, 'danmaku-report-details');
  assert.equal(footer.children[1].disabled, false);
  assert.equal(options.children[0].children[0].checked, true);
  options.children[0].children[0].checked = false;
  choices.children[0].children[1].children[1].value = '补充描述';
  await form.onsubmit({preventDefault(){}});
  const submissions = () => reports.interactionCalls.filter(([, method]) => method === 'POST');
  assert.equal(submissions()[0][0], '/reports/danmaku/1');
  assert.equal(submissions()[0][2].reason, '10015');
  assert.equal(submissions()[0][2].description, '补充描述');
  assert.equal(reports.el('danmaku-report-feedback').textContent, '举报已受理');
  assert.equal(list.children.length, 3);
  report.emit('mouseenter');
  assert.equal(reports.el('sender-tooltip').textContent, '举报该弹幕的发送者');
  report.onclick();
  list.children[2].children[3].onclick();
  assert.equal(reports.el('danmaku-report-feedback').textContent, '已举报');
  assert.equal(submissions().length, 1);
  list.children[0].children[4].onclick();
  assert.equal(list.children[0].children[2].textContent, '已屏蔽');
  assert.equal(list.children[1].children[2].textContent, '已屏蔽');
  reports.pageEvent('accountchange', {detail:null});
  assert.equal(reports.el('video-subscribe').hidden, false);
  assert.equal(list.children[0].children.length, 4);
  console.log('PASS: collection ownership, database report reasons, report confirmation and duplicate feedback, blocked rows');
  t.el('dm-area').oninput({target:{value:50}});assert.ok(t.el('danmaku-overlay').attributes.style.includes('height:42.5%'));
  t.el('dm-opacity').oninput({target:{value:40}});assert.ok(t.el('danmaku-overlay').attributes.style.includes('opacity:0.4'));
  t.el('ratio-4').onclick();assert.equal(t.p.dataset.ratio,'4');
  t.el('mode-pause').onclick();assert.equal(t.el('autoplay-next').checked,false);
  const hover = await setup();hover.p.currentTime=2;hover.p.emit('timeupdate');
  const line = hover.el('danmaku-overlay').children[0];assert.ok(line);line.emit('mouseenter');
  assert.ok(Math.abs(parseFloat(line.style.animationDuration) - 7.68) < 0.0001);
  assert.equal(hover.el('danmaku-actions').hidden,false);assert.equal(line.style.animationPlayState,'paused');
  hover.el('dm-action-like').onclick();assert.equal(hover.prompts(),1);hover.el('login-dialog').open=false;
  hover.el('dm-action-report').onclick();assert.equal(hover.prompts(),2);
  await hover.el('dm-action-copy').onclick();assert.equal(hover.copied(),'A');
  const legacy = await setup(new Map([['bili-danmaku-settings', JSON.stringify({ font:'songti', bold:true, outline:'shadow' })]]));
  assert.equal(legacy.el('danmaku-overlay').dataset.font, 'songti');
  assert.equal(legacy.el('danmaku-overlay').dataset.bold, 'true');
  assert.equal(legacy.el('danmaku-overlay').dataset.outline, 'shadow');

  hover.el('login-dialog').open = false;
  const toggle = hover.el('danmaku-toggle');
  toggle.onclick();
  assert.equal(toggle.attributes['aria-pressed'], 'false');
  assert.equal(toggle.dataset.tooltip, '开启弹幕 (d)');
  assert.equal(hover.el('danmaku-overlay').hidden, true);
  assert.equal(hover.el('danmaku-settings').disabled, true);
  assert.equal(hover.el('danmaku-guest').disabled, true);
  assert.equal(hover.el('danmaku-entry').inert, true);
  hover.keydown({ key:'d', repeat:true });
  assert.equal(toggle.attributes['aria-pressed'], 'false');
  hover.keydown({ key:'d', preventDefault() {} });
  assert.equal(toggle.attributes['aria-pressed'], 'true');
  assert.equal(toggle.dataset.tooltip, '关闭弹幕 (d)');
  assert.equal(hover.el('danmaku-overlay').hidden, false);
  assert.equal(hover.el('danmaku-settings').disabled, false);
  assert.equal(hover.el('danmaku-guest').disabled, false);
  assert.equal(hover.el('danmaku-entry').inert, false);
  const sender=hover.el('danmaku-list').children[0].children[3];sender.emit('mouseenter');assert.equal(hover.el('sender-tooltip').textContent,'屏蔽该弹幕的发送者');sender.onclick();
  const unblock=hover.el('danmaku-list').children[0].children[3];unblock.emit('mouseenter');assert.equal(hover.el('sender-tooltip').textContent,'取消屏蔽该弹幕的发送者');
  const event={preventDefault(){},stopPropagation(){}};
  hover.el('sidebar-view-block').onclick(event);assert.equal(hover.el('danmaku-sidebar-title').textContent,'屏蔽设定');
  hover.el('shield-input').value='test';hover.el('shield-add').onclick();assert.equal(hover.el('shield-rows').children.length,1);
  hover.el('shield-tab-regex').onclick();hover.el('shield-input').value='/First/';hover.el('shield-add').onclick();assert.equal(hover.el('shield-rows').children.length,1);
  hover.el('shield-enabled').onchange({target:{checked:false}});assert.equal(hover.el('shield-body').hidden,true);
  hover.el('shield-enabled').onchange({target:{checked:true}});assert.equal(hover.el('shield-body').hidden,false);
  hover.el('dm-keywords-open').onclick();assert.equal(hover.el('sidebar-block-view').hidden,false);assert.equal(hover.el('danmaku-sidebar-title').textContent,'屏蔽设定');
  hover.el('sidebar-view-list').onclick(event);assert.equal(hover.el('sidebar-list-view').hidden,false);
  assert.equal(hover.el('sidebar-block-view').hidden,true);
  assert.ok(hover.el('danmaku-overlay').attributes.style.includes('top:1%'));
  hover.fullscreen(true);assert.equal(hover.el('player-shell').classList.contains('fullscreen-layout'),true);
  assert.ok(hover.el('fullscreen-danmaku-slot').children.includes(hover.el('danmaku-compose')));
  hover.fullscreen(false);assert.equal(hover.el('player-shell').classList.contains('fullscreen-layout'),false);
  hover.el('web-fullscreen').onclick();assert.equal(hover.el('player-shell').classList.contains('fullscreen-layout'),true);
  assert.equal(hover.el('web-fullscreen').attributes['aria-pressed'],'true');
  assert.equal(hover.el('fullscreen-toggle').attributes['aria-pressed'],'false');
  hover.el('web-fullscreen').onclick();assert.equal(hover.el('player-shell').classList.contains('fullscreen-layout'),false);
  hover.el('wide-toggle').onclick();assert.ok(hover.el('video-page').classList.contains('wide-mode'));
  hover.el('wide-toggle').onclick();assert.ok(!hover.el('video-page').classList.contains('wide-mode'));
  assert.equal(hover.el('heatmap-display').hidden,true);
  hover.el('heatmap-toggle').checked=true;hover.el('heatmap-toggle').onchange();
  assert.equal(hover.el('heatmap-display').hidden,false);
  assert.match(hover.el('heatmap-path').attributes.d, /,2\b/, 'real danmaku counts form a peak');
  hover.el('heatmap-pin').onclick();
  const pinned=await setup(hover.storage);
  assert.equal(pinned.el('heatmap-display').hidden,false,'pinned graph survives a new visit');
  pinned.el('heatmap-pin').onclick();
  assert.equal(pinned.el('heatmap-display').hidden,false,'unpinning keeps the graph on this visit');
  const unpinned=await setup(pinned.storage);
  assert.equal(unpinned.el('heatmap-display').hidden,true,'unpinned graph starts disabled next visit');
  hover.p.pause();await hover.el('mini-play-toggle').onclick();assert.equal(hover.p.paused,false);assert.equal(hover.el('player-shell').dataset.playing,'true');await hover.el('mini-play-toggle').onclick();assert.equal(hover.p.paused,true);assert.equal(hover.el('player-shell').dataset.playing,'false');
  const member = await setup();
  await member.p.play();
  for (let i = 0; i < 30; i++) member.advance(1000);
  assert.equal(member.p.paused, true);
  assert.equal(member.prompts(), 1);
  assert.equal(member.el('trial-ended').hidden, false);
  const folderOptions = {
    search: '?playlist=folder-42', account: {uid:'9',name:'Folder owner'},
    space: {folders:[{id:'41',name:'Other folder'},{id:'42',name:'Selected folder'}]},
    videos: [{id:'10001',title:'First',duration:60,plays:3}, {id:'10003',title:'Second',duration:65,plays:10}]
  };
  const standalone = await setup(new Map(), undefined, {}, {related:[{id:'10005'}]});
  const autoplay = standalone.el('autoplay-next');
  autoplay.onchange({target:{checked:false}});
  standalone.p.emit('ended');
  assert.deepEqual(standalone.navigations, []);
  autoplay.onchange({target:{checked:true}});
  standalone.p.emit('ended');
  await new Promise(setImmediate);
  assert.deepEqual(standalone.navigations, ['/video/10005']);
  assert.equal(standalone.el('video-title').textContent, 'Video 10005');
  const folderPlaylist = await setup(new Map(), {
    title:'Regular collection', items:[{id:'10001'},{id:'10002'}]
  }, {}, folderOptions);
  assert.equal(folderPlaylist.el('collection-title').textContent, 'Selected folder');
  assert.equal(folderPlaylist.el('collection-position').textContent, '1/2');
  assert.equal(folderPlaylist.el('collection-plays').textContent, '创建者：Folder owner');
  assert.equal(folderPlaylist.el('folder-more').href, '/me?tab=favorites&folder=42');
  assert.equal(folderPlaylist.el('folder-playback-modes').hidden, false);
  assert.equal(folderPlaylist.el('video-subscribe').hidden, true);
  assert.equal(folderPlaylist.el('related-heading').hidden, true);
  const folderExpand = folderPlaylist.el('collection-expand');
  assert.equal(folderExpand.getAttribute('aria-expanded'), 'true');
  folderExpand.onclick();
  assert.equal(folderExpand.getAttribute('aria-expanded'), 'false');
  assert.equal(folderPlaylist.el('collection-meta').hidden, true);
  assert.equal(folderPlaylist.el('collection-list').hidden, true);
  assert.equal(folderPlaylist.el('danmaku-panel').inert, false);
  folderExpand.onclick();
  assert.equal(folderPlaylist.el('collection-list').hidden, false);
  assert.deepEqual(folderPlaylist.el('collection-list').children.map(row => row.href), [
    '/video/10001?playlist=folder-42', '/video/10003?playlist=folder-42'
  ]);
  folderPlaylist.p.emit('ended');
  await new Promise(setImmediate);
  assert.deepEqual(folderPlaylist.navigations, ['/video/10003?playlist=folder-42']);
  assert.ok(folderPlaylist.interactionCalls.some(([path]) => path === '/me/folders/42/videos'));
  const lastFolderVideo = await setup(new Map(), undefined, {}, {
    ...folderOptions, videos: [folderOptions.videos[1], folderOptions.videos[0]],
  });
  lastFolderVideo.p.emit('ended');
  await new Promise(setImmediate);
  assert.deepEqual(lastFolderVideo.navigations, ['/video/10003?playlist=folder-42']);
  const reverse = await setup(new Map(), undefined, {}, {
    ...folderOptions, videos: [{id:'10004'}, ...folderOptions.videos],
  });
  const orderControl = reverse.el('folder-playback-sequence');
  orderControl.onclick();
  await new Promise(setImmediate);
  assert.equal(orderControl.dataset.tooltip, '倒序播放');
  assert.deepEqual(reverse.navigations, ['/video/10003?playlist=folder-42']);
  reverse.p.emit('ended');
  await new Promise(setImmediate);
  assert.equal(reverse.navigations.at(-1), '/video/10001?playlist=folder-42');
  orderControl.onclick();
  await new Promise(setImmediate);
  assert.equal(orderControl.dataset.tooltip, '顺序播放');
  assert.equal(reverse.navigations.length, 3);
  assert.equal(reverse.navigations.at(-1), '/video/10004?playlist=folder-42');
  reverse.p.emit('ended');
  await new Promise(setImmediate);
  assert.equal(reverse.navigations.at(-1), '/video/10001?playlist=folder-42');
  const cycleControl = lastFolderVideo.el('folder-playback-loop');
  cycleControl.onclick();
  await new Promise(setImmediate);
  assert.equal(cycleControl.dataset.tooltip, '随机播放');
  assert.equal(lastFolderVideo.navigations.length, 2);
  assert.equal(lastFolderVideo.navigations.at(-1), '/video/10001?playlist=folder-42');
  cycleControl.onclick();
  await new Promise(setImmediate);
  assert.equal(cycleControl.dataset.tooltip, '列表循环');
  assert.equal(lastFolderVideo.navigations.length, 2);
  lastFolderVideo.p.currentTime = 20;
  lastFolderVideo.p.pause();
  lastFolderVideo.el('folder-playback-sequence').onclick();
  assert.equal(lastFolderVideo.p.currentTime, 0);
  assert.equal(lastFolderVideo.p.paused, false);
  assert.equal(lastFolderVideo.navigations.length, 2);
  // Switch back without a document navigation or an extra history entry.
  assert.deepEqual(folderPlaylist.presence, ['10001', '10003']);
  assert.deepEqual(folderPlaylist.disposed, ['10001']);
  assert.equal(folderPlaylist.el('collection-position').textContent, '2/2');
  folderPlaylist.location.pathname = '/video/10001';
  folderPlaylist.pageEvent('popstate');
  await new Promise(setImmediate);
  assert.equal(folderPlaylist.el('video-title').textContent, 'Video 10001');
  assert.equal(folderPlaylist.navigations.length, 1);
  assert.equal(folderPlaylist.el('collection-position').textContent, '1/2');
  assert.deepEqual(folderPlaylist.disposed, ['10001', '10003']);
  assert.deepEqual(folderPlaylist.fullReloads, [], 'switching and history never reload the document');
  let finishSlowVideo;
  const detail = id => ({video:{id,title:'Video ' + id,authorId:'1',streamUrl:'/' + id + '.mp4'},tags:[]});
  const rapid = await setup(new Map(), undefined, {}, {
    ...folderOptions,
    videos:[...folderOptions.videos, {id:'10004'}],
    videoRequest(url) {
      const id = url.split('/').pop();
      return id === '10003' ? new Promise(resolve => { finishSlowVideo = resolve; }) : detail(id);
    }
  });
  rapid.el('fullscreen-next').onclick();
  let prevented = false;
  const click = {
    button:0, target:{closest:() => ({href:'http://localhost/video/10004?playlist=folder-42'})},
    preventDefault(){prevented = true;}
  };
  rapid.el('collection-list').emit('click', {...click, ctrlKey:true});
  assert.equal(prevented, false, 'Ctrl-click keeps native new-tab behavior');
  rapid.el('collection-list').emit('click', click);
  await new Promise(setImmediate);
  finishSlowVideo(detail('10003'));
  await new Promise(setImmediate);
  assert.equal(prevented, true);
  assert.equal(rapid.el('video-title').textContent, 'Video 10004', 'slow previous video cannot overwrite latest selection');
  assert.equal(rapid.el('collection-position').textContent, '3/3');
  assert.deepEqual(rapid.presence, ['10001', '10004']);
  assert.deepEqual(rapid.fullReloads, []);
  folderPlaylist.pageEvent('accountchange', {detail:null});
  assert.equal(folderPlaylist.el('collection-title').textContent, 'Regular collection');
  assert.equal(folderPlaylist.el('folder-playback-modes').hidden, true);
  console.log('PASS: sidebar queue precedence, folder links, collapse, reverse order, loop, immediate shuffle and sign-out fallback');
  member.pageEvent('accountchange', { detail: { uid: '10001' } });
  assert.equal(member.el('trial-ended').hidden, true);
  await member.el('play-toggle').onclick();
  member.advance(1000);
  assert.equal(member.p.paused, false);
  member.pageEvent('accountchange', { detail: null });
  assert.equal(member.p.paused, true);
  assert.equal(member.el('trial-ended').hidden, false);
  console.log('PASS: signing in resumes playback after trial and signing out restores the guest limit');
  console.log('PASS: mini player uses shared play/pause state');
  console.log('PASS: native/web fullscreen state and preserved composer');
  console.log('PASS: sidebar modes, keyword routing, text/regex rules, filter switch, near-top danmaku');
  console.log('PASS: floating danmaku toolbar, guest like/report gate, clipboard copy, saved typography, danmaku toggle and keyboard shortcut, sender tooltips');
  console.log('PASS: conditional collection, active episode, danmaku area/opacity, aspect ratio, pause-after-play');
  console.log('PASS: member playback speed, guest restriction, wide layout, heat curve and pin persistence, autoplay, mirror, loop');
console.log('PASS: cumulative trial, pause, buffering, seeking, cutoff, replay gate, fresh visit and back-navigation reset, sender blocking/unblocking, engagement binding');
})().catch(e=>{console.error(e);process.exitCode=1;});
