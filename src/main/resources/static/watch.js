async function loadWatchPage() {
  const player = el('player'), shell = el('player-shell');
  const id = path.split('/')[2];
  const playlist = new URLSearchParams(location.search).get('playlist');
  const folderPlaylist = /^folder-(\d+)$/.exec(playlist || '');
  const playbackUrl = video => '/video/' + encodeURIComponent(video.id)
    + (playlist === 'collection' || folderPlaylist ? '?playlist=' + encodeURIComponent(playlist) : '');
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  // Each visit gets its own trial budget; previous visits never lock this one.
  let watched = 0;
  let signedIn = typeof currentAccount !== 'undefined' && Boolean(currentAccount);
  let viewerId = signedIn ? currentAccount.uid : null;
  const ownsDanmaku = row => viewerId != null && String(row.userId) === String(viewerId);
  const fixedDanmakuSeconds = 5;
  const trialExpired = () => !signedIn && watched >= 30;
  let blocked = new Set(read('bili-blocked-users', []));
  let danmaku = [], enabled = true, lastTick = performance.now(), lastVideoTime = 0, nextVideo = null, noticeTimer;
  const shown = new Set(), withdrawn = new Set();
  let danmakuCountLabel;
  const seek = el('seek'), seekBar = el('seek-bar');
  const seekPreview = el('seek-preview'), seekPreviewTime = el('seek-preview-time');
  const seekPreviewFrame = el('seek-preview-frame');
  const rates = [2, 1.5, 1.25, 1, 0.75, 0.5];
  function syncRate() {
    if (!signedIn && player.playbackRate !== 1) player.playbackRate = 1;
    const rate = player.playbackRate || 1;
    el('speed-options').hidden = !signedIn;
    el('speed-login').hidden = signedIn;
    const label = Number.isInteger(rate) ? rate.toFixed(1) : String(rate);
    el('playback-rate').textContent = rate === 1 ? '倍速' : label + 'x';
    for (const option of rates) el('rate-' + option).setAttribute('aria-pressed', String(option === rate));
  }
  syncRate();
  for (const rate of rates) el('rate-' + rate).onclick = () => {
    if (signedIn) player.playbackRate = rate;
  };
  player.addEventListener('ratechange', syncRate);
  const updateHeatmap = setupWatchHeatmap(player, { read, save, rows: () => danmaku });
  let seekValue = Number(seek.value);
  let previewTarget = null, seekHovered = false;
  const overlay = el('danmaku-overlay');
  const tracks = setupDanmakuTracks(overlay);
  const clock = (value) => duration(Math.floor(Number.isFinite(value) ? value : 0));
  function updateSeek(value, time) {
    seekValue = value;
    seekBar.style.setProperty('--seek-progress', value + '%');
    seek.setAttribute('aria-valuetext', clock(time) + ' / ' + clock(player.duration));
  }
  function finishSeek() {
    delete seekBar.dataset.scrubbing;
    delete seekBar.dataset.direction;
    previewTarget = null;
    seekPreviewFrame.hidden = true;
    seekPreview.hidden = !seekHovered;
  }
  seek.addEventListener('pointerdown', event => {
    if (event.button === 0) seekBar.dataset.scrubbing = 'true';
  });
  seek.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || !Number.isFinite(player.duration) || player.duration <= 0) return;
    seekHovered = true;
    if (seekBar.dataset.scrubbing) return;
    const track = seek.getBoundingClientRect();
    if (!track.width) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - track.left) / track.width));
    seekBar.style.setProperty('--seek-hover', ratio * 100 + '%');
    seekPreviewTime.textContent = clock(ratio * player.duration);
    seekPreview.hidden = false;
  });
  seek.addEventListener('pointerleave', () => {
    seekHovered = false;
    if (!seekBar.dataset.scrubbing) seekPreview.hidden = true;
  });
  function updatePreviewFrame() {
    if (previewTarget === null || seekPreviewFrame.readyState < 1 || !Number.isFinite(seekPreviewFrame.duration)
        || seekPreviewFrame.seeking || seekPreviewFrame.error) return;
    const time = Math.min(previewTarget, Math.max(0, seekPreviewFrame.duration - 0.05));
    if (Math.abs(seekPreviewFrame.currentTime - time) > 0.04) {
      seekPreviewFrame.currentTime = time;
    } else if (seekPreviewFrame.readyState >= 2) {
      seekPreviewFrame.hidden = false;
    }
  }
  for (const event of ['loadedmetadata', 'loadeddata', 'seeked']) seekPreviewFrame.addEventListener(event, updatePreviewFrame);
  seekPreviewFrame.addEventListener('error', () => { seekPreviewFrame.hidden = true; });
  window.addEventListener('pointerup', finishSeek);
  window.addEventListener('pointercancel', finishSeek);
  seek.addEventListener('keyup', finishSeek);
  seek.addEventListener('blur', finishSeek);
  const notice = (message, compact = false) => {
    const status = el('control-notice');
    status.classList.toggle('control-notice-compact', compact);
    status.textContent = message;
    status.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { status.hidden = true; }, 2500);
  };
  let activeDanmaku = null, activeLine = null, actionTimer;
  function hideDanmakuActions() {
    el('danmaku-actions').hidden = true;
    if (activeLine) activeLine.style.animationPlayState = '';
    shell.classList.remove('inspecting-danmaku');
    activeDanmaku = null; activeLine = null;
  }
  function showDanmakuActions(d, line) {
    clearTimeout(actionTimer);
    if (activeLine && activeLine !== line) activeLine.style.animationPlayState = '';
    activeDanmaku = d; activeLine = line; line.style.animationPlayState = 'paused';
    const own = ownsDanmaku(d);
    el('dm-action-report').hidden = own;
    el('dm-action-withdraw').hidden = !own;
    shell.classList.add('inspecting-danmaku');
    const rect = line.getBoundingClientRect(), frame = shell.getBoundingClientRect();
    const toolbar = el('danmaku-actions'); toolbar.hidden = false;
    const likeButton = el('dm-action-like'), likeCount = el('dm-like-count');
    const renderLikes = count => {
      likeCount.textContent = count > 0 ? String(count) : '';
      likeCount.hidden = !(count > 0);
    };
    likeButton.setAttribute('aria-pressed', 'false');
    renderLikes(d.likes);
    if (typeof bindLike === 'function') {
      bindLike(likeButton, 'danmaku', d.id, count => {
        d.likes = count;
        renderLikes(count);
      });
    }
    const width = toolbar.offsetWidth || 150, height = toolbar.offsetHeight || 44;
    const left = Math.max(8, Math.min(rect.left - frame.left + rect.width / 2 - width / 2, frame.width - width - 8));
    const top = Math.max(8, Math.min(rect.bottom - frame.top + 10, frame.height - height - 8));
    toolbar.setAttribute('style', 'left:' + left + 'px;top:' + top + 'px');
  }
  function delayHideActions() { clearTimeout(actionTimer); actionTimer = setTimeout(hideDanmakuActions, 220); }
  function clearOnscreenDanmaku() {
    hideDanmakuActions();
    tracks.clear();
  }
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      hideDanmakuActions();
      tracks.resize();
    }).observe(overlay);
  }
  el('danmaku-actions').addEventListener('mouseenter', () => clearTimeout(actionTimer));
  el('danmaku-actions').addEventListener('mouseleave', delayHideActions);
  el('danmaku-actions').addEventListener('focusin', () => clearTimeout(actionTimer));
  el('danmaku-actions').addEventListener('focusout', delayHideActions);
  el('dm-action-like').onclick = () => { if (activeDanmaku) openLogin(el('dm-action-like')); };
  el('dm-action-report').onclick = () => {
    if (!activeDanmaku || ownsDanmaku(activeDanmaku)) return;
    if (!signedIn || typeof danmakuReportInteraction !== 'function') return openLogin(el('dm-action-report'));
    const target = activeDanmaku;
    hideDanmakuActions();
    danmakuReportInteraction(shell, target, () => watchSidebar.shieldDanmaku(target));
  };
  const withdrawButton = el('dm-action-withdraw');
  withdrawButton.onclick = async () => {
    if (withdrawButton.disabled || !activeDanmaku || !ownsDanmaku(activeDanmaku)) return;
    const target = activeDanmaku.id;
    withdrawButton.disabled = true;
    try {
      await interaction('/danmaku/' + encodeURIComponent(target), 'DELETE');
      withdrawn.add(target);
      danmaku = danmaku.filter(row => row.id !== target);
      shown.delete(target);
      if (activeDanmaku?.id === target) hideDanmakuActions();
      for (const line of Array.from(overlay.children)) {
        if (line.dataset.danmakuId === String(target)) tracks.remove(line);
      }
      if (danmakuCountLabel) danmakuCountLabel.textContent = shortCount(danmaku.length);
      updateHeatmap();
      renderDanmaku();
      notice('撤回成功', true);
    } catch (error) {
      notice(error.message);
    } finally {
      withdrawButton.disabled = false;
    }
  };
  el('dm-action-copy').onclick = async () => {
    if (!activeDanmaku) return;
    try { await navigator.clipboard.writeText(activeDanmaku.content); notice('弹幕已复制'); }
    catch { notice('复制失败，请检查浏览器剪贴板权限'); }
  };
  function showSenderTooltip(button, blocked) {
    const tip = el('sender-tooltip'), rect = button.getBoundingClientRect();
    tip.textContent = blocked ? '取消屏蔽该弹幕的发送者' : '屏蔽该弹幕的发送者';
    tip.hidden = false;
    tip.setAttribute('style', 'left:' + Math.max(145, Math.min(rect.left + rect.width / 2, document.documentElement.clientWidth - 145)) + 'px;top:' + (rect.top - 8) + 'px');
  }
  function gate(prompt = true) {
    hideDanmakuActions(); player.pause(); el('trial-ended').hidden = false; el('trial-tip').hidden = true;
    if (prompt && !el('login-dialog').open) openLogin(el('play-toggle'));
  }
  window.addEventListener('accountchange', (event) => {
    signedIn = Boolean(event.detail);
    viewerId = event.detail?.uid;
    hideDanmakuActions();
    for (const line of overlay.children) line.classList.toggle('own-danmaku', ownsDanmaku(line.dataset));
    renderDanmaku();
    syncRate();
    if (signedIn) {
      el('trial-tip').hidden = true;
      el('trial-ended').hidden = true;
    } else if (trialExpired()) {
      gate(false);
    } else {
      lastTick = performance.now();
      lastVideoTime = player.currentTime;
      el('trial-tip').hidden = false;
    }
  });
  async function play() {
    if (trialExpired()) return gate();
    if (!player.paused) return player.pause();
    try { await player.play(); } catch (error) { if (error.name !== 'AbortError') notice('请点击播放；若无法播放，请检查视频文件'); }
  }
  el('play-toggle').onclick = play; el('big-play').onclick = play; el('mini-play-toggle').onclick = play; player.onclick = play;
  const hideTrialTip = () => { el('trial-tip').hidden = true; };
  el('close-trial').onclick = hideTrialTip;
  el('trial-start').onclick = () => {
    hideTrialTip();
    if (player.paused || trialExpired()) return play();
  };
  player.addEventListener('play', () => { if (trialExpired()) return gate(); lastTick = performance.now(); shell.dataset.playing = 'true'; el('play-toggle').dataset.playing = 'true'; el('big-play').hidden = true; shell.classList.remove('paused-danmaku'); });
  player.addEventListener('pause', () => { shell.dataset.playing = 'false'; el('play-toggle').dataset.playing = 'false'; el('big-play').hidden = false; shell.classList.add('paused-danmaku'); });
  // Count elapsed playing time, never the timeline position or the seek distance.
  const countTrial = () => {
    const now = performance.now(), elapsed = (now - lastTick) / 1000; lastTick = now;
    if (!signedIn && !player.paused && !player.ended && !player.seeking && player.readyState >= 3 && player.currentTime !== lastVideoTime) {
      watched = Math.min(30, watched + Math.min(elapsed, Math.max(0, player.currentTime - lastVideoTime) / (player.playbackRate || 1)));
      if (watched >= 30) gate();
    }
    lastVideoTime = player.currentTime;
  };
  let timer = setInterval(countTrial, 100);
  window.addEventListener('pagehide', () => clearInterval(timer));
  // Back/forward navigation can restore the same document from the browser cache.
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    clearInterval(timer);
    player.pause();
    watched = 0; lastTick = performance.now(); lastVideoTime = 0;
    player.currentTime = 0;
    el('trial-ended').hidden = true;
    el('trial-tip').hidden = signedIn;
    timer = setInterval(countTrial, 100);
  });
  player.addEventListener('timeupdate', () => {
    el('play-time').textContent = clock(player.currentTime) + ' / ' + clock(player.duration);
    if (!seekBar.dataset.scrubbing && Number.isFinite(player.duration) && player.duration > 0) {
      seek.value = player.currentTime / player.duration * 100;
      updateSeek(Number(seek.value), player.currentTime);
    }
    showTimedDanmaku();
  });
  function showTimedDanmaku() {
    if (!enabled || player.seeking) return;
    const time = player.currentTime;
    if (activeDanmaku && modeOf(activeDanmaku) !== 'scroll' && time >= activeDanmaku.timestamp + fixedDanmakuSeconds) hideDanmakuActions();
    tracks.expireFixed(time);
    if (activeLine) return;
    let placed = 0;
    for (const d of danmaku) {
      if (placed >= watchPreferences.limit()) break;
      const mode = modeOf(d);
      const lifetime = mode === 'scroll' ? 0.6 : fixedDanmakuSeconds;
      if (d.timestamp > time || time >= d.timestamp + lifetime || shown.has(d.id)) continue;
      if (!watchSidebar.allowed(d) || !watchPreferences.allows(mode, d.color)) continue;
      if (displayDanmaku(d, mode)) { shown.add(d.id); placed++; }
    }
  }
  const modeOf = row => row.mode === 'top' || row.mode === 'bottom' ? row.mode : 'scroll';
  function displayDanmaku(d, mode) {
    const line = node('span', 'flying-danmaku' + (ownsDanmaku(d) ? ' own-danmaku' : ''), d.content);
    line.dataset.userId = d.userId;
    line.dataset.danmakuId = d.id;
    if (/^#[\da-f]{6}$/i.test(d.color)) line.style.color = d.color;
    watchPreferences.decorate(line, d.size);
    if (!tracks.add(line, mode, watchPreferences.travelSeconds(), mode === 'scroll' ? undefined : d.timestamp + fixedDanmakuSeconds)) return false;
    line.tabIndex = 0; line.setAttribute('aria-label', d.content + '，查看弹幕操作');
    line.addEventListener('mouseenter', () => showDanmakuActions(d, line)); line.addEventListener('focus', () => showDanmakuActions(d, line));
    line.addEventListener('mouseleave', delayHideActions); line.addEventListener('blur', delayHideActions);
    line.addEventListener('animationend', () => { if (activeLine === line) hideDanmakuActions(); });
    return true;
  }
  player.addEventListener('loadedmetadata', () => { el('play-time').textContent = clock(player.currentTime) + ' / ' + clock(player.duration); });
  player.addEventListener('seeking', () => { clearOnscreenDanmaku(); shown.clear(); lastTick = performance.now(); });
  player.addEventListener('seeked', () => { lastVideoTime = player.currentTime; lastTick = performance.now(); showTimedDanmaku(); });
  seek.oninput = () => {
    if (!Number.isFinite(player.duration) || player.duration <= 0) return;
    const value = Number(seek.value);
    if (value !== seekValue) seekBar.dataset.direction = value > seekValue ? 'right' : 'left';
    player.currentTime = player.duration * value / 100;
    if (seekBar.dataset.scrubbing) {
      seekBar.style.setProperty('--seek-hover', value + '%');
      seekPreview.hidden = false;
      previewTarget = player.currentTime;
      const source = player.currentSrc || player.src;
      if (source && !seekPreviewFrame.src) seekPreviewFrame.src = source;
      updatePreviewFrame();
    }
    if (!seekPreview.hidden) seekPreviewTime.textContent = clock(player.currentTime);
    updateSeek(value, player.currentTime);
  };
  el('volume').oninput = e => { player.volume = Number(e.target.value); player.muted = false; el('volume-value').textContent = Math.round(player.volume * 100); };
  player.addEventListener('volumechange', () => { el('mute-toggle').dataset.muted = String(player.muted || player.volume === 0); el('mute-toggle').setAttribute('aria-label', player.muted ? '取消静音' : '静音'); el('volume-value').textContent = player.muted ? '0' : Math.round(player.volume * 100); el('volume').value = player.muted ? 0 : player.volume; });
  el('mute-toggle').onclick = () => { player.muted = !player.muted; el('mute-toggle').dataset.muted = String(player.muted); };
  el('quality').onclick = () => notice('当前播放原始文件，暂无其他清晰度');
  el('more-settings-open').onclick = () => { el('playback-main').hidden = true; el('playback-more').hidden = false; };
  el('more-settings-back').onclick = () => { el('playback-main').hidden = false; el('playback-more').hidden = true; };
  const preferences = { autoStart:true, mirror:false, loop:false, fill:false, keyboard:true, muted:true, ...read('bili-playback-settings', {}) };
  function updatePreferences() { save('bili-playback-settings', preferences); }
  for (const [key, id] of [['autoStart','auto-start'],['mirror','mirror-toggle'],['loop','loop-toggle']]) {
    el(id).checked = preferences[key];
    el(id).onchange = e => {
      preferences[key] = e.target.checked; updatePreferences();
      player.loop = preferences.loop;
      player.setAttribute('style', 'transform:' + (preferences.mirror ? 'scaleX(-1)' : 'none') + ';object-fit:' + (preferences.fill ? 'cover' : 'contain'));
    };
  }
  player.loop = preferences.loop;
  player.muted = preferences.muted;
  player.setAttribute('style', 'transform:' + (preferences.mirror ? 'scaleX(-1)' : 'none') + ';object-fit:' + (preferences.fill ? 'cover' : 'contain'));
  const pip = el('pip-toggle'), wide = el('wide-toggle'), web = el('web-fullscreen'), full = el('fullscreen-toggle');
  let restoreFloatingPlayer;
  const setControl = (button, active, enter, exit) => {
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('data-tooltip', active ? exit : enter);
  };
  const syncPip = () => setControl(pip, document.pictureInPictureElement === player || shell.classList.contains('mini-player'), '开启画中画', '退出画中画');
  for (const event of ['enterpictureinpicture','leavepictureinpicture']) player.addEventListener(event, syncPip);
  pip.onclick = async () => {
    try {
      if (document.pictureInPictureElement === player) await document.exitPictureInPicture();
      else if (shell.classList.contains('mini-player') || !watchPreferences.nativePip()) shell.classList.toggle('mini-player');
      else if (document.pictureInPictureEnabled) await player.requestPictureInPicture();
      else notice('当前浏览器不支持原生画中画，可在更多播放设置中切换');
    } catch { notice('视频准备好后可开启画中画'); }
    syncPip();
  };
  wide.onclick = () => {
    const active = el('video-page').classList.toggle('wide-mode');
    setControl(wide, active, '宽屏模式', '退出宽屏');
  };
  const wakePlayerControls = setupPlayerControlsIdle(shell);
  const syncFullscreenLayout = () => {
    const native = document.fullscreenElement === shell;
    const webFullscreen = shell.classList.contains('web-full');
    const fullscreen = native || webFullscreen;
    shell.classList.toggle('fullscreen-layout', fullscreen);
    wakePlayerControls();
    if (fullscreen) el('fullscreen-danmaku-slot').append(el('danmaku-compose'));
    else el('danmaku-compose-home').after(el('danmaku-compose'));
    document.body.classList.toggle('watch-web-fullscreen', webFullscreen);
    setControl(web, webFullscreen, '网页全屏', '退出网页全屏');
    setControl(full, native, '进入全屏 (f)', '退出全屏 (f)');
  };
  document.addEventListener('fullscreenchange', syncFullscreenLayout);
  web.onclick = () => {
    restoreFloatingPlayer?.();
    shell.classList.remove('mini-player');
    syncPip();
    shell.classList.toggle('web-full');
    syncFullscreenLayout();
  };
  full.onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        restoreFloatingPlayer?.();
        await shell.requestFullscreen();
        shell.classList.remove('web-full', 'mini-player');
        syncPip();
        syncFullscreenLayout();
      }
    } catch { notice('当前浏览器无法开启全屏'); }
  };
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && shell.classList.contains('web-full')) {
      shell.classList.remove('web-full');
      syncFullscreenLayout();
    }
    if (!preferences.keyboard || el('login-dialog').open) return;
    const activeTag = document.activeElement.tagName;
    if (['INPUT','SELECT','TEXTAREA'].includes(activeTag)) return;
    if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      full.onclick();
    } else if (event.key.toLowerCase() === 'd' && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      toggleDanmaku();
    } else if (event.code === 'Space' && activeTag !== 'BUTTON') {
      event.preventDefault();
      play();
    }
  });
  const danmakuToggle = el('danmaku-toggle');
  function toggleDanmaku() {
    enabled = !enabled;
    danmakuToggle.setAttribute('aria-pressed', String(enabled));
    danmakuToggle.dataset.tooltip = enabled ? '关闭弹幕 (d)' : '开启弹幕 (d)';
    el('danmaku-settings').disabled = !enabled;
    el('danmaku-guest').disabled = !enabled;
    el('danmaku-entry').inert = !enabled;
    overlay.hidden = !enabled;
    if (!enabled) clearOnscreenDanmaku();
  }
  danmakuToggle.onclick = toggleDanmaku;
  const watchPreferences = setupWatchPreferences(player, { read, save, onDanmakuChange: clearOnscreenDanmaku });
  const watchSidebar = setupWatchSidebar({ read, save, notice, getUsers:()=>blocked,
    setUsers: users => { blocked = users; save('bili-blocked-users', [...blocked]); },
    onChange: () => { clearOnscreenDanmaku(); renderDanmaku(); }
  });
  function renderDanmaku() {
    el('danmaku-list').replaceChildren(...danmaku.map(d => {
      const isBlocked = watchSidebar.isBlocked(d.userId), row = node('div', 'danmaku-row' + (isBlocked ? ' blocked' : ''));
      const date = node('span', 'danmaku-date', isBlocked ? '已屏蔽' : d.sentAt?.replace('T', ' ').slice(5, 16));
      const content = node('span', '', d.content);
      content.title = d.content;
      row.append(node('span', '', clock(d.timestamp)), content, date);
      if (!ownsDanmaku(d)) {
        const button = node('button', '', isBlocked ? '取消屏蔽' : '屏蔽用户');
        button.setAttribute('aria-label', isBlocked ? '取消屏蔽该弹幕的发送者' : '屏蔽该弹幕的发送者');
        button.addEventListener('mouseenter', () => showSenderTooltip(button, isBlocked)); button.addEventListener('focus', () => showSenderTooltip(button, isBlocked));
        button.addEventListener('mouseleave', () => el('sender-tooltip').hidden = true); button.addEventListener('blur', () => el('sender-tooltip').hidden = true);
        button.onclick = () => { el('sender-tooltip').hidden = true; watchSidebar.setUserBlocked(d.userId, !isBlocked); };
        row.append(button);
      }
      return row;
    }));
    if (!danmaku.length) el('danmaku-list').append(node('p', 'status', '暂无弹幕'));
  }
  try {
    const { video, description, tags, mustWatch, bestSiteRank } = await api('/videos/' + encodeURIComponent(id));
    startViewerPresence(id);
    document.title = video.title + ' - dilidili'; el('video-title').textContent = video.title;
    const metaStat = (name, count) => {
      const stat = node('span', 'video-meta-stat');
      stat.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="/assets/watch-icons.svg?v=2#meta-' + name + '"></use></svg>';
      const label = node('span', '', shortCount(count));
      if (name === 'danmaku') danmakuCountLabel = label;
      stat.append(label);
      return stat;
    };
    const accolades = [];
    const accolade = (href, label, symbol, variant) => {
      const badge = link(href, null, 'video-accolade video-accolade-' + variant);
      badge.target = '_self';
      badge.append(icon(symbol), label);
      return badge;
    };
    if (mustWatch) accolades.push(accolade('/popular/must-watch', '入站必刷', 'popular-medal', 'must-watch'));
    if (bestSiteRank) accolades.push(accolade('/popular/rank', '全站排行榜最高第' + bestSiteRank + '名', 'popular-podium', 'rank'));
    el('video-meta').replaceChildren(...accolades, metaStat('play', video.plays), metaStat('danmaku', video.danmaku), node('time', '', video.publishedAt?.replace('T', ' ') || ''));
    el('video-description').textContent = description || '-';
    el('video-tags').replaceChildren(link('/channel/' + video.categoryId, video.category), ...tags.map(t => link('/search?tag=' + encodeURIComponent(t), t)));
    el('fullscreen-title').textContent = video.title; el('watch-author-name').textContent = video.author; el('watch-author-link').href = '/space/' + video.authorId;
    el('watch-avatar').src = '/api/authors/' + video.authorId + '/avatar'; el('watch-avatar').onerror = e => { e.target.removeAttribute('src'); e.target.alt = 'UP'; };
    api('/authors/' + video.authorId).then(a => { el('watch-signature').textContent = a.signature || '这个人很神秘，什么都没有写'; }).catch(() => el('watch-signature').textContent = '');
    el('player-author-avatar').src = '/api/authors/' + video.authorId + '/avatar';
    el('player-author-avatar').onerror = e => { e.target.hidden = true; };
    player.poster = video.coverUrl;
    player.onerror = () => { el('player-status').hidden = false; el('player-status').textContent = '视频文件暂时不可用，请确认本地媒体文件与数据库路径一致'; };
    if (video.streamUrl) player.src = video.streamUrl;
    else { el('player-status').hidden = false; el('player-status').textContent = '暂无视频文件'; }
    if (trialExpired()) gate(false);
    else if (video.streamUrl && (preferences.autoStart || playlist === 'collection' || folderPlaylist)) {
      player.muted = preferences.muted;
      player.play().catch(() => {});
    }
    api('/videos/' + id + '/engagement').then(stats => { for (const key of ['like','coin','favorite','share']) el(key + '-count').textContent = shortCount(stats[key]); }).catch(() => { document.querySelector('.video-actions').title = '互动数据暂时加载失败'; });
    api('/videos/' + id + '/danmaku').then(rows => {
      danmaku = [...new Map([...rows, ...danmaku].filter(row => !withdrawn.has(row.id)).map(row => [row.id, row])).values()];
      updateHeatmap();
      renderDanmaku();
      showTimedDanmaku();
    }).catch(() => el('danmaku-list').append(node('p', 'status', '弹幕加载失败，请刷新重试')));
    if (typeof setupVideoInteractions === 'function') {
      setupVideoInteractions(id, video.authorId, player, video.duration, row => {
        danmaku.push(row);
        updateHeatmap();
        renderDanmaku();
        const mode = modeOf(row);
        const time = player.currentTime;
        const end = row.timestamp + (mode === 'scroll' ? 1 : fixedDanmakuSeconds);
        if (enabled && !player.seeking && time >= row.timestamp && time < end
            && watchSidebar.allowed(row) && watchPreferences.allows(mode, row.color)
            && displayDanmaku(row, mode)) shown.add(row.id);
      }, video.author);
    }
  } catch (error) { el('video-title').textContent = error.message === '404' ? '视频不存在或已下架' : '视频加载失败'; el('player-status').hidden = false; el('player-status').textContent = '请返回首页选择其他视频'; }
  let collectionNext = null, collectionPrevious = null;
  try {
    const collection = await api('/videos/' + id + '/collection');
    if (collection?.title && collection.items.length) {
      const index = collection.items.findIndex(v => String(v.id) === id);
      el('collection-title').textContent = collection.title;
      el('collection-position').textContent = '(' + (index + 1) + '/' + collection.items.length + ')';
      el('collection-plays').textContent = shortCount(collection.plays) + '播放';
      const collectionList = el('collection-list'), expand = el('collection-expand');
      collectionList.replaceChildren(...collection.items.map(v => {
        const current = String(v.id) === id;
        const item = link('/video/' + encodeURIComponent(v.id), null, 'collection-item' + (current ? ' current' : ''));
        if (current) item.setAttribute('aria-current', 'true');
        item.title = v.title;
        const cover = node('div', 'card-cover');
        const image = node('img');
        image.alt = '';
        image.loading = 'lazy';
        cover.append(image);
        attachCover(image, v.coverUrl, v.category);
        const details = node('div', 'collection-item-details');
        const stats = node('div', 'collection-item-stats');
        for (const [symbol, label, count] of [['play', '播放', v.plays], ['list', '弹幕', v.danmaku]]) {
          const stat = node('span');
          const total = shortCount(count);
          stat.append(icon(symbol), total);
          stat.setAttribute('aria-label', label + ' ' + total);
          stats.append(stat);
        }
        details.append(node('span', 'collection-item-title', v.title), stats);
        item.append(cover, details, node('time', 'collection-item-duration', clock(v.duration)));
        return item;
      }));
      el('fullscreen-collection-list').replaceChildren(...collection.items.map(v => {
        const item = link('/video/' + encodeURIComponent(v.id), v.title, 'fullscreen-episode' + (String(v.id) === id ? ' current' : ''));
        return item;
      }));
      el('video-collection').hidden = false;
      const activeEpisode = collectionList.children[index];
      const danmakuPanel = el('danmaku-panel');
      let compactScrollTop = 0;
      expand.onclick = () => {
        const expanded = expand.getAttribute('aria-expanded') !== 'true';
        if (expanded) compactScrollTop = collectionList.scrollTop;
        expand.setAttribute('aria-expanded', String(expanded));
        expand.setAttribute('aria-label', expanded ? '收起合集列表' : '展开合集列表');
        danmakuPanel.inert = expanded;
        collectionList.dataset.expanded = String(expanded);
        collectionList.scrollTop = expanded ? activeEpisode?.offsetTop ?? 0 : compactScrollTop;
      };
      collectionNext = collection.items[index + 1] || null; collectionPrevious = collection.items[index - 1] || null;
    } else el('video-collection').hidden = true;
  } catch { el('video-collection').hidden = true; }
  setupWatchComments(id);
  restoreFloatingPlayer = setupWatchScroll(player, shell);
  try {
    const result = await api('/videos?size=40');
    const related = result.items.filter(v => String(v.id) !== id);
    nextVideo = related[0];
    setupRelatedExpansion(related);
  } catch { el('related-videos').textContent = '暂无推荐视频'; }
  const orderedPlayback = playlist === 'collection' || Boolean(folderPlaylist);
  let previous = collectionPrevious;
  let next = collectionNext || (orderedPlayback ? null : nextVideo);
  if (folderPlaylist) {
    const videos = await interaction('/me/folders/' + folderPlaylist[1] + '/videos').catch(() => []);
    const index = videos.findIndex(video => video.id === id);
    previous = index > 0 ? videos[index - 1] : null;
    next = index >= 0 ? videos[index + 1] : null;
  }
  el('fullscreen-prev').onclick = () => { if (previous) location.assign(playbackUrl(previous)); else notice('没有上一集'); };
  el('fullscreen-next').onclick = () => { if (next) location.assign(playbackUrl(next)); else notice('没有下一集'); };
  player.addEventListener('ended', () => {
    if (next && !trialExpired() && (orderedPlayback || el('autoplay-next').checked)) location.assign(playbackUrl(next));
  });
}

function setupWatchHeatmap(player, { read, save, rows }) {
  const toggle = el('heatmap-toggle'), pin = el('heatmap-pin'), display = el('heatmap-display');
  let pinned = read('bili-heatmap-pinned', false) === true;
  toggle.checked = pinned;
  function render() {
    display.hidden = !toggle.checked;
    el('player-shell').classList.toggle('heatmap-pinned', pinned);
    pin.setAttribute('aria-pressed', String(pinned));
    pin.setAttribute('data-tooltip', pinned ? '关闭高能进度条常驻' : '打开高能进度条常驻');
    if (!toggle.checked) return;
    const duration = player.duration;
    const bins = Array.from({ length:50 }, () => 0);
    if (Number.isFinite(duration) && duration > 0) {
      for (const { timestamp } of rows()) {
        if (Number.isFinite(timestamp) && timestamp >= 0 && timestamp <= duration) {
          bins[Math.min(bins.length - 1, Math.floor(timestamp / duration * bins.length))]++;
        }
      }
    }
    const peak = Math.max(1, ...bins);
    const points = bins.map((count, index) => [index * 100 / (bins.length - 1), 32 - Math.sqrt(count / peak) * 30]);
    const curve = points.slice(1).map(([x, y], index) => {
      const [previousX, previousY] = points[index];
      const middle = (previousX + x) / 2;
      return ' C' + middle + ',' + previousY + ' ' + middle + ',' + y + ' ' + x + ',' + y;
    }).join('');
    el('heatmap-path').setAttribute('d', 'M0,32 L' + points[0].join(',') + curve + ' L100,32 Z');
  }
  pin.onclick = () => { pinned = !pinned; save('bili-heatmap-pinned', pinned); render(); };
  toggle.onchange = () => {
    if (!toggle.checked && pinned) { pinned = false; save('bili-heatmap-pinned', false); }
    render();
  };
  player.addEventListener('durationchange', render);
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    const saved = read('bili-heatmap-pinned', false) === true;
    if (saved === pinned) return;
    pinned = saved;
    toggle.checked = saved;
    render();
  });
  render();
  return render;
}

function setupPlayerControlsIdle(shell) {
  let timer;
  const interacting = () => shell.querySelectorAll('.danmaku-report[open]').length > 0 || Array.from(shell.querySelectorAll('.hover-panel')).some(panel => {
    const style = getComputedStyle(panel);
    return style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0;
  });
  function wake() {
    clearTimeout(timer);
    shell.classList.remove('fullscreen-idle', 'controls-idle');
    if (shell.classList.contains('scroll-mini')) return;
    const fullscreen = shell.classList.contains('fullscreen-layout');
    timer = setTimeout(() => {
      if (interacting() || shell.querySelectorAll('.seek:active, .player-controls :focus-visible, .trial-tip :focus-visible').length) { wake(); return; }
      shell.classList.add(fullscreen ? 'fullscreen-idle' : 'controls-idle');
    }, 2000);
  }
  for (const event of ['pointerenter', 'pointermove', 'pointerdown', 'keydown', 'focusin', 'focusout']) shell.addEventListener(event, wake);
  window.addEventListener('pagehide', () => clearTimeout(timer), { once:true });
  return wake;
}

function setupDanmakuTracks(overlay) {
  const active = new Map();
  const gap = 6;

  function clear() {
    active.clear();
    overlay.replaceChildren();
  }

  function remove(line) {
    active.delete(line);
    line.remove();
  }

  function add(line, mode, travelSeconds, end) {
    const width = overlay.clientWidth, height = overlay.clientHeight;
    if (!width || !height) return false;
    const entrance = overlay.getBoundingClientRect().left + width;
    line.dataset.mode = mode;
    overlay.append(line);
    const lineWidth = line.offsetWidth, lineHeight = line.offsetHeight;
    const step = lineHeight + gap;
    const scrolling = mode === 'scroll';
    const occupied = [...active];
    for (let offset = 0; offset + lineHeight <= height; offset += step) {
      const top = mode === 'bottom' ? height - lineHeight - offset : offset;
      const overlaps = occupied.some(([other, track]) => {
        if (top >= track.bottom + gap || top + lineHeight + gap <= track.top) return false;
        // Scrolling lines share a speed, so a fully entered line cannot be caught from behind.
        return !scrolling || !track.scrolling || other.getBoundingClientRect().right + gap > entrance;
      });
      if (overlaps) continue;
      line.style.top = top + 'px';
      line.style.setProperty('--danmaku-travel', width + 'px');
      if (scrolling) line.style.animationDuration = travelSeconds * (1 + lineWidth / width) + 's';
      const availableHeight = height - lineHeight;
      const position = availableHeight > 0 ? top / availableHeight : Number(mode === 'bottom');
      active.set(line, { scrolling, top, bottom: top + lineHeight, position, end });
      line.addEventListener('animationend', () => remove(line));
      return true;
    }
    line.remove();
    return false;
  }

  function expireFixed(time) {
    for (const [line, track] of active) if (track.end !== undefined && time >= track.end) remove(line);
  }

  function resize() {
    const width = overlay.clientWidth, height = overlay.clientHeight;
    if (!width || !height) return;
    for (const [line, track] of active) {
      const lineHeight = line.offsetHeight;
      track.top = track.position * Math.max(0, height - lineHeight);
      track.bottom = track.top + lineHeight;
      line.style.top = track.top + 'px';
      if (track.scrolling) line.style.setProperty('--danmaku-travel', width + 'px');
    }
  }

  return { add, clear, expireFixed, remove, resize };
}
