function setupWatchPreferences(player, { read, save, onDanmakuChange }) {
  const dmDefaults = { scroll:true, fixed:true, color:true, scale:false, subtitleSafe:false, smart:true, area:100, opacity:80, size:100, speed:3, density:'normal', keywords:[], syncRate:false, font:'heiti', bold:false, outline:'heavy' };
  const dm = { ...dmDefaults, ...read('bili-danmaku-settings', {}) };
  const playback = { next:true, ratio:'auto', hideBars:false, lights:false, nativePip:true, ...read('bili-more-playback', {}) };
  function applyDm() {
    for (const key of ['scroll','fixed','color']) el('dm-filter-' + key).setAttribute('aria-pressed', String(dm[key]));
    for (const [key,id] of [['scale','dm-scale'],['subtitleSafe','dm-subtitle-safe'],['smart','dm-smart']]) el(id).checked = dm[key];
    for (const key of ['area','opacity','size','speed']) { el('dm-' + key).value = dm[key]; el('dm-' + key + '-value').textContent = key === 'speed' ? ['很慢','较慢','适中','较快','很快'][dm.speed - 1] : dm[key] + '%'; }
    for (const value of ['normal','more','overlap']) el('dm-density-' + value).setAttribute('aria-pressed', String(dm.density === value));
    el('dm-sync-rate').checked = dm.syncRate; el('dm-font').value = dm.font; el('dm-bold').checked = dm.bold;
    for (const value of ['heavy','stroke','shadow']) el('dm-outline-' + value).setAttribute('aria-pressed', String(dm.outline === value));
    el('danmaku-overlay').dataset.font = dm.font; el('danmaku-overlay').dataset.bold = String(dm.bold); el('danmaku-overlay').dataset.outline = dm.outline;
    el('dm-keywords').value = dm.keywords.join('\n');
    const bottom = dm.subtitleSafe ? 26 : dm.smart ? 18 : 8;
    el('danmaku-overlay').setAttribute('style', 'bottom:' + bottom + '%;height:' + Math.min(dm.area * .85, 99 - bottom) + '%;top:1%;opacity:' + dm.opacity/100);
    onDanmakuChange();
    save('bili-danmaku-settings', dm);
  }
  for (const key of ['scroll','fixed','color']) el('dm-filter-' + key).onclick = () => { dm[key] = !dm[key]; applyDm(); };
  for (const [key,id] of [['scale','dm-scale'],['subtitleSafe','dm-subtitle-safe'],['smart','dm-smart']]) el(id).onchange = e => { dm[key] = e.target.checked; applyDm(); };
  for (const key of ['area','opacity','size','speed']) el('dm-' + key).oninput = e => { dm[key] = Number(e.target.value); applyDm(); };
  for (const value of ['normal','more','overlap']) el('dm-density-' + value).onclick = () => { dm.density = value; applyDm(); };
  function advanced() { el('dm-settings-main').hidden = true; el('dm-settings-advanced').hidden = false; }
  el('dm-advanced-open').onclick = advanced;
  el('dm-keywords-open').onclick = () => { el('dm-settings-main').hidden = true; el('dm-settings-advanced').hidden = true; el('dm-settings-keywords').hidden = false; };
  el('dm-keywords-back').onclick = () => { el('dm-settings-main').hidden = false; el('dm-settings-keywords').hidden = true; };
  el('dm-sync-rate').onchange = e => { dm.syncRate = e.target.checked; applyDm(); };
  el('dm-font').onchange = e => { dm.font = e.target.value; applyDm(); };
  el('dm-bold').onchange = e => { dm.bold = e.target.checked; applyDm(); };
  for (const outline of ['heavy','stroke','shadow']) el('dm-outline-' + outline).onclick = () => { dm.outline = outline; applyDm(); };
  el('dm-advanced-back').onclick = () => { el('dm-settings-main').hidden = false; el('dm-settings-advanced').hidden = true; };
  el('dm-keywords-save').onclick = () => { dm.keywords = el('dm-keywords').value.split('\n').map(s => s.trim()).filter(Boolean); applyDm(); el('dm-keywords-back').onclick(); };
  el('dm-reset').onclick = () => { Object.assign(dm, dmDefaults, { keywords:[] }); applyDm(); };
  applyDm();
  function applyPlayback() {
    el('mode-next').setAttribute('aria-pressed', String(playback.next)); el('mode-pause').setAttribute('aria-pressed', String(!playback.next)); el('autoplay-next').checked = playback.next;
    for (const ratio of ['auto','4','16']) el('ratio-' + ratio).setAttribute('aria-pressed', String(playback.ratio === ratio));
    for (const [key,id] of [['hideBars','hide-bars'],['lights','lights-off'],['nativePip','native-pip']]) el(id).checked = playback[key];
    player.dataset.ratio = playback.ratio; player.dataset.hideBars = String(playback.hideBars);
    document.body.classList.toggle('watch-lights-off', playback.lights);
    save('bili-more-playback', playback);
  }
  for (const mode of ['next','pause']) el('mode-' + mode).onclick = () => { playback.next = mode === 'next'; applyPlayback(); };
  el('autoplay-next').onchange = e => { playback.next = e.target.checked; applyPlayback(); };
  for (const ratio of ['auto','4','16']) el('ratio-' + ratio).onclick = () => { playback.ratio = ratio; applyPlayback(); };
  for (const [key,id] of [['hideBars','hide-bars'],['lights','lights-off'],['nativePip','native-pip']]) el(id).onchange = e => { playback[key] = e.target.checked; applyPlayback(); };
  applyPlayback();
  return {
    allows: (mode, color) => (mode === 'scroll' ? dm.scroll : dm.fixed)
      && (dm.color || !color || color.toUpperCase() === '#FFFFFF'),
    decorate: (line, size) => {
      const fontSize = dm.size * (size === 'small' ? .8 : 1);
      line.style.fontSize = (dm.scale ? fontSize * .022 : fontSize * .22) + (dm.scale ? 'cqw' : 'px');
    },
    travelSeconds: () => (14 - dm.speed * 2) * 0.8 / (dm.syncRate ? player.playbackRate || 1 : 1),
    limit: () => dm.density === 'normal' ? 3 : dm.density === 'more' ? 6 : 12,
    nativePip: () => playback.nativePip,
  };
}
