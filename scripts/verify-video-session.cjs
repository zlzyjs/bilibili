const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

class Element extends EventTarget {
  constructor() { super(); this.value = ''; this.attributes = {}; this.elements = {namedItem: () => ({value:'1'})}; }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key]; }
}

(async () => {
  const elements = new Map(), calls = [], timers = new Set();
  const el = id => {
    if (id === 'video-page') return null;
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const player = new Element();
  Object.assign(player, {currentTime:0, paused:true, readyState:4});
  let deferState, resolveState;
  const context = {
    AbortController, el, window:new EventTarget(), currentAccount:{uid:'9'}, shortCount:String,
    interaction:async (url, method, body) => {
      calls.push({url, method, body});
      if (url.endsWith('/state')) {
        if (deferState) return new Promise(resolve => { resolveState = resolve; });
        return {coinsGiven:0, position:0};
      }
    },
    authApi:async () => ({token:'csrf'}),
    memberAction:(button, callback) => { button.onclick = callback; },
    pressInteraction:(button, enabled) => button.setAttribute('aria-pressed', String(enabled)),
    bindLike(){}, likeBindings:new WeakMap(), setupDanmakuStyle:() => ({value:'#ffffff'}),
    accountNotice(){}, performance:{now:() => 0},
    setInterval(fn){timers.add(fn);return fn;}, clearInterval(fn){timers.delete(fn);}
  };
  const source = fs.readFileSync('src/main/resources/static/interactions.js', 'utf8');
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function setupVideoInteractions('), source.indexOf('\nfunction videoRow(')), context);
  const settle = () => new Promise(setImmediate);
  const disposeA = context.setupVideoInteractions('A', '1', player, 100, () => {});
  await settle();
  player.paused = false;
  player.dispatchEvent(new Event('play'));
  await settle();
  el('danmaku-text').value = 'queued for A';
  el('danmaku-entry').onsubmit({preventDefault(){}});
  assert.equal(timers.size, 1);
  player.currentTime = 20;
  disposeA();
  assert.equal(timers.size, 0, 'leaving cancels the old video send countdown');
  await settle();
  assert.ok(calls.some(call => call.url === '/videos/A/progress' && call.body.value === 20));
  const oldProgressCount = calls.filter(call => call.url === '/videos/A/progress').length;
  player.currentTime = 0;
  const disposeB = context.setupVideoInteractions('B', '1', player, 100, () => {});
  await settle();
  player.currentTime = 35;
  player.dispatchEvent(new Event('play'));
  player.dispatchEvent(new Event('timeupdate'));
  await settle();
  assert.equal(calls.filter(call => call.url === '/videos/A/progress').length, oldProgressCount, 'B playback cannot save A progress');
  assert.ok(calls.some(call => call.url === '/videos/B/progress' && call.body.value === 35));
  disposeB();
  deferState = true;
  const disposeC = context.setupVideoInteractions('C', '1', player, 100, () => {});
  await settle();
  disposeC();
  const favorite = el('video-favorite');
  favorite.setAttribute('aria-pressed', 'new-video-state');
  resolveState({favorited:true, coinsGiven:2, position:90});
  await settle();
  assert.equal(favorite.getAttribute('aria-pressed'), 'new-video-state', 'late state cannot overwrite a new session');
  assert.equal(player.currentTime, 35, 'late resume cannot seek the new video');
  console.log('PASS: video session progress isolation, final progress save, countdown cleanup and stale state protection');
})().catch(error => { console.error(error); process.exitCode = 1; });
