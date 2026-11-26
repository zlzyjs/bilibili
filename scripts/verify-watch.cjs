const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  style = { setProperty(key,value) { this[key] = value; } };
  constructor() { this.hidden = false; this.value = 0; this.children = []; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.classes=new Set(); this.classList = { add:v=>this.classes.add(v), remove:v=>this.classes.delete(v), contains:v=>this.classes.has(v), toggle:(v,force)=>{const next=force===undefined?!this.classes.has(v):force;next?this.classes.add(v):this.classes.delete(v);return next;} }; }
  after() {}
  contains() { return false; }
  append(...items) { this.children.push(...items); for (const item of items) if (item instanceof Element) item.parent = this; }
  replaceChildren(...items) { this.children = items; }
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
  const p = el('player'); Object.assign(p,{ currentTime:0, duration:100, readyState:4, paused:true, ended:false, seeking:false, pause(){this.paused=true;this.emit('pause');}, async play(){this.paused=false;this.emit('play');} });
  el('login-dialog').open = false;
  let now = 0, tick, prompts = 0, copied = '', postDanmaku, resizeDanmaku;
  const documentEvents={}, windowEvents={}, interactionCalls=[], navigations=[];
  const context = { setupWatchComments(){},setupWatchScroll(){},setupRelatedExpansion(){},startViewerPresence(){}, el, path:'/video/10001', duration:n=>`${Math.floor(n/60)}`.padStart(2,'0')+':'+`${n%60}`.padStart(2,'0'), shortCount:String,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}, performance:{now:()=>now},
    setInterval:fn=>(tick=fn,1),clearInterval(){},setTimeout(){return 1;},clearTimeout(){},
    ResizeObserver:class { constructor(callback) { resizeDanmaku = callback; } observe() {} },
    window:{addEventListener(event,fn){(windowEvents[event] ||= []).push(fn);}}, navigator:{clipboard:{writeText:async text=>{copied=text;}}}, document:{ documentElement:{clientWidth:1200}, body:new Element(), title:'', activeElement:{tagName:'BODY'}, addEventListener(event,fn){(documentEvents[event] ||= []).push(fn);},querySelector:()=>new Element() },
    openLogin:()=>{prompts++;el('login-dialog').open=true;},URLSearchParams,
    location:{search:playlist.search,assign(href){navigations.push(href);}},
    interaction:async (...args)=>{ interactionCalls.push(args); return playlist.videos; },
    setupVideoInteractions:(_id,_author,_player,_duration,callback)=>{ postDanmaku=callback; },
    node:(tag,cls,text)=>Object.assign(new Element(),{className:cls,textContent:text}),
    link:(href,label,className)=>Object.assign(new Element(),{href,className,textContent:label}),
    icon:name=>Object.assign(new Element(),{name}),card:()=>new Element(),attachCover:(img,url)=>{img.src=url;},
    api:async url=> url.endsWith('/collection')?collection:url.endsWith('/engagement')?{like:3,coin:4,favorite:5,share:6}:url.endsWith('/danmaku')?[
      {id:'1',userId:'7',content:'A',timestamp:2,sentAt:'2026-11-12T12:00:00'}, {id:'2',userId:'7',content:'B',timestamp:3,sentAt:'2026-11-12T12:01:00'}, {id:'3',userId:'8',content:'C',timestamp:4,sentAt:'2026-11-12T12:02:00'}
    ]:url.startsWith('/authors/')?{followers:10}:url.startsWith('/videos?')?{items:[]}: {video:{id:'10001',title:'Test',authorId:'1',streamUrl:'/test.mp4',plays:1,danmaku:3},tags:[],...accolades}
  };
  vm.createContext(context);vm.runInContext(fs.readFileSync('src/main/resources/static/watch-sidebar.js','utf8'),context);vm.runInContext(fs.readFileSync('src/main/resources/static/watch-preferences.js','utf8'),context);vm.runInContext(fs.readFileSync('src/main/resources/static/watch.js','utf8'),context);await context.loadWatchPage();
  return {el,p,storage,postDanmaku,resizeDanmaku,interactionCalls,navigations,keydown:event=>(documentEvents.keydown||[]).forEach(fn=>fn(event)),pageEvent:(name,event={})=>(windowEvents[name]||[]).forEach(fn=>fn(event)),copied:()=>copied,fullscreen:flag=>{context.document.fullscreenElement=flag?el('player-shell'):null;(documentEvents.fullscreenchange||[]).forEach(fn=>fn());}, advance(ms,move=true){now+=ms;if(move&&!p.paused)p.currentTime+=ms/1000;tick();},prompts:()=>prompts};
}
(async()=>{
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
  assert.deepEqual(styled.interactionCalls, [['/danmaku/20', 'DELETE']]);
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
  assert.equal(styled.interactionCalls.length, 1);
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
  const folderPlaylist = await setup(new Map(), undefined, {}, {
    search: '?playlist=folder-42', videos: [{id:'10001'}, {id:'10003'}],
  });
  folderPlaylist.p.emit('ended');
  assert.deepEqual(folderPlaylist.navigations, ['/video/10003?playlist=folder-42']);
  assert.ok(folderPlaylist.interactionCalls.some(([path]) => path === '/me/folders/42/videos'));
  const lastFolderVideo = await setup(new Map(), undefined, {}, {
    search: '?playlist=folder-42', videos: [{id:'10001'}],
  });
  lastFolderVideo.p.emit('ended');
  assert.deepEqual(lastFolderVideo.navigations, []);
  console.log('PASS: favorite-folder playback advances within the folder and stops at the end');
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
