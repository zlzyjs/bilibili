async function loadWatchPage() {
  const player = el('player'), shell = el('player-shell');
  let id = path.split('/')[2];
  let videoRevision = 0, switching = false, disposeInteractions, stopPresence;
  let playlist = new URLSearchParams(location.search).get('playlist');
  const legacyFolder = new URLSearchParams(location.search).get('fav');
  if (!playlist && /^\d+$/.test(legacyFolder || '')) playlist = 'folder-' + legacyFolder;
  let folderPlaylist = /^folder-(\d+)$/.exec(playlist || '');
  let activePlaylist = '';
  const playbackUrl = video => '/video/' + encodeURIComponent(video.id)
    + (activePlaylist ? '?playlist=' + encodeURIComponent(activePlaylist) : '');
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  // Each visit gets its own trial budget; previous visits never lock this one.
  let watched = 0;
  let signedIn = typeof currentAccount !== 'undefined' && Boolean(currentAccount);
  let viewerId = signedIn ? currentAccount.uid : null;
  let viewerName = signedIn ? currentAccount.name : '';
  let videoAuthor, collectionOwner;
  let reportedDanmaku = new Set(), reportFeedbackTimer;
  let justBlockedRow;
  const ownsDanmaku = row => viewerId != null && String(row.userId) === String(viewerId);
  const fixedDanmakuSeconds = 5;
  const trialExpired = () => !signedIn && watched >= 30;
  let blocked = new Set(read('bili-blocked-users', []));
  let danmaku = [], enabled = true, lastTick = performance.now(), lastVideoTime = 0, nextVideo = null, noticeTimer;
  let historyDate = '', historicalRows = null;
  const shown = new Set(), withdrawn = new Set(), pendingWithdrawals = new Set();
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
    reportDanmaku(shell, target);
  };
  const withdrawButton = el('dm-action-withdraw');
  withdrawButton.onclick = () => withdrawDanmaku(activeDanmaku, withdrawButton);
  async function withdrawDanmaku(row, button) {
    if (!row || !ownsDanmaku(row) || pendingWithdrawals.has(row.id) || withdrawn.has(row.id)) return;
    const target = row.id;
    pendingWithdrawals.add(target);
    button.disabled = true;
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
      pendingWithdrawals.delete(target);
      button.disabled = false;
    }
  }
  el('dm-action-copy').onclick = async () => {
    if (!activeDanmaku) return;
    try { await navigator.clipboard.writeText(activeDanmaku.content); notice('弹幕已复制'); }
    catch { notice('复制失败，请检查浏览器剪贴板权限'); }
  };
  function showDanmakuTip(tip, anchor, message) {
    const rect = anchor.getBoundingClientRect();
    tip.textContent = message;
    tip.hidden = false;
    const edge = tip.offsetWidth / 2 + 4;
    tip.setAttribute('style', 'left:' + Math.max(edge, Math.min(rect.left + rect.width / 2, document.documentElement.clientWidth - edge)) + 'px;top:' + (rect.top - 6) + 'px');
  }
  function bindDanmakuTip(button, label) {
    button.type = 'button';
    const tip = el('sender-tooltip');
    const show = () => {
      const message = label();
      button.setAttribute('aria-label', message);
      showDanmakuTip(tip, button, message);
    };
    const hide = () => { tip.hidden = true; };
    button.addEventListener('mouseenter', show);
    button.addEventListener('focus', show);
    button.addEventListener('mouseleave', hide);
    button.addEventListener('blur', hide);
  }
  function reportDanmaku(container, target, button) {
    const uid = viewerId, reportedVideo = id;
    const complete = (message, shield) => {
      if (viewerId !== uid || reportedVideo !== id) return;
      reportedDanmaku.add(String(target.id));
      if (button) {
        const feedback = el('danmaku-report-feedback');
        el('sender-tooltip').hidden = true;
        button.setAttribute('aria-label', '举报该弹幕的发送者');
        showDanmakuTip(feedback, button, message);
        clearTimeout(reportFeedbackTimer);
        reportFeedbackTimer = setTimeout(() => { feedback.hidden = true; }, 2000);
      } else {
        notice(message);
      }
      if (shield) watchSidebar.shieldDanmaku(target);
    };
    if (reportedDanmaku.has(String(target.id))) complete('已举报', false);
    else danmakuReportInteraction(container, target, complete, Boolean(button));
  }
  function syncSubscriptionButton() {
    el('video-subscribe').hidden = el('video-collection').dataset.queue === 'folder' || (viewerId != null
      && [videoAuthor, collectionOwner].some(owner => owner != null && String(owner) === String(viewerId)));
  }
  async function loadReportedDanmaku() {
    if (!signedIn || typeof interaction !== 'function') return;
    const reports = reportedDanmaku;
    try {
      const ids = await interaction('/videos/' + encodeURIComponent(id) + '/danmaku/reports');
      for (const reported of ids) reports.add(String(reported));
    } catch { /* The submission endpoint still checks for duplicates. */ }
  }
  function gate(prompt = true) {
    hideDanmakuActions(); player.pause(); el('trial-ended').hidden = false; el('trial-tip').hidden = true;
    if (prompt && !el('login-dialog').open) openLogin(el('play-toggle'));
  }
  window.addEventListener('accountchange', (event) => {
    if (viewerId !== (event.detail?.uid ?? null)) {
      reportedDanmaku = new Set();
      el('danmaku-report-feedback').hidden = true;
      for (const dialog of document.querySelectorAll?.('.danmaku-report[open]') || []) dialog.close();
    }
    signedIn = Boolean(event.detail);
    viewerId = event.detail?.uid ?? null;
    viewerName = event.detail?.name ?? '';
    if (!signedIn) {
      watchSidebar.leaveOwnView();
      resetDanmakuHistory();
    }
    loadReportedDanmaku();
    syncSubscriptionButton();
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
    for (const d of historicalRows ?? danmaku) {
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
    onChange: () => { clearOnscreenDanmaku(); renderDanmaku(); },
    isSignedIn: () => signedIn,
    onViewChange() {
      el('danmaku-list').scrollTop = 0;
      renderDanmaku();
    }
  });
  const resetDanmakuHistory = setupDanmakuHistory({
    isSignedIn: () => signedIn,
    rows: () => danmaku,
    onSelect(date) {
      historyDate = date;
      el('danmaku-list').scrollTop = 0;
      clearOnscreenDanmaku();
      shown.clear();
      renderDanmaku();
      showTimedDanmaku();
    }
  });
  function renderDanmaku() {
    historicalRows = historyDate ? danmaku
      .filter(row => row.sentAt && row.sentAt.slice(0, 10) <= historyDate)
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt)) : null;
    const ownView = watchSidebar.isOwnView();
    const rows = ownView ? danmaku.filter(ownsDanmaku) : (historicalRows ?? danmaku);
    el('danmaku-content-heading').textContent = historyDate && !ownView
      ? '弹幕内容（' + Number(historyDate.slice(5, 7)) + '月' + Number(historyDate.slice(8, 10)) + '日）'
      : '弹幕内容';
    el('danmaku-list').replaceChildren(...rows.map(d => {
      const isBlocked = !ownView && watchSidebar.isBlocked(d.userId);
      const row = node('div', 'danmaku-row' + (isBlocked ? ' blocked' : ''));
      if (isBlocked && d.id === justBlockedRow) {
        row.classList.add('just-blocked');
        row.addEventListener('mouseleave', () => {
          row.classList.remove('just-blocked');
          if (justBlockedRow === d.id) justBlockedRow = undefined;
        }, { once: true });
      }
      const date = node('span', 'danmaku-date', isBlocked ? '已屏蔽' : d.sentAt?.replace('T', ' ').slice(5, 16));
      const content = node('span', '', d.content);
      content.title = d.content;
      row.append(node('span', '', clock(d.timestamp)), content, date);
      if (ownView) {
        const button = node('button', '', '撤回');
        button.type = 'button';
        button.onclick = () => withdrawDanmaku(d, button);
        row.append(button);
      } else if (!ownsDanmaku(d)) {
        const button = node('button', 'danmaku-block-user', isBlocked ? '取消屏蔽' : '屏蔽用户');
        const blockLabel = isBlocked ? '取消屏蔽该弹幕的发送者' : '屏蔽该弹幕的发送者';
        button.setAttribute('aria-label', blockLabel);
        bindDanmakuTip(button, () => blockLabel);
        button.onclick = () => {
          el('sender-tooltip').hidden = true;
          justBlockedRow = isBlocked ? undefined : d.id;
          watchSidebar.setUserBlocked(d.userId, !isBlocked);
        };
        if (signedIn && typeof danmakuReportInteraction === 'function') {
          const report = node('button', 'danmaku-report-user', '举报');
          const reportLabel = () => reportedDanmaku.has(String(d.id)) ? '举报该弹幕的发送者' : '举报该弹幕';
          report.setAttribute('aria-label', reportLabel());
          bindDanmakuTip(report, reportLabel);
          report.onclick = () => {
            el('sender-tooltip').hidden = true;
            reportDanmaku(el('danmaku-panel'), d, report);
          };
          row.append(report);
        }
        row.append(button);
      }
      return row;
    }));
    if (!rows.length) el('danmaku-list').append(node('p', 'status', ownView ? '你还没有在此视频发送弹幕' : '暂无弹幕'));
  }
  async function loadVideo() {
    const revision = ++videoRevision, videoId = id;
    const current = () => revision === videoRevision;
    try {
    const { video, description, tags, mustWatch, bestSiteRank } = await api('/videos/' + encodeURIComponent(videoId));
    if (!current()) return false;
    videoAuthor = video.authorId;
    syncSubscriptionButton();
    loadReportedDanmaku();
    stopPresence = startViewerPresence(videoId);
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
    api('/authors/' + video.authorId).then(a => { if (!current()) return; el('watch-signature').textContent = a.signature || '这个人很神秘，什么都没有写'; }).catch(() => { if (current()) el('watch-signature').textContent = ''; });
    el('player-author-avatar').src = '/api/authors/' + video.authorId + '/avatar';
    el('player-author-avatar').onerror = e => { e.target.hidden = true; };
    player.poster = video.coverUrl;
    player.onerror = () => { el('player-status').hidden = false; el('player-status').textContent = '视频文件暂时不可用，请确认本地媒体文件与数据库路径一致'; };
    if (video.streamUrl) player.src = video.streamUrl;
    else { el('player-status').hidden = false; el('player-status').textContent = '暂无视频文件'; }
    if (trialExpired()) gate(false);
    else if (video.streamUrl && (switching || preferences.autoStart || playlist === 'collection' || folderPlaylist)) {
      player.muted = preferences.muted;
      player.play().catch(() => {});
    }
    api('/videos/' + id + '/engagement').then(stats => { if (!current()) return; for (const key of ['like','coin','favorite','share']) el(key + '-count').textContent = shortCount(stats[key]); }).catch(() => { if (!current()) return; document.querySelector('.video-actions').title = '互动数据暂时加载失败'; });
    api('/videos/' + id + '/danmaku').then(rows => { if (!current()) return;
      danmaku = [...new Map([...rows, ...danmaku].filter(row => !withdrawn.has(row.id)).map(row => [row.id, row])).values()];
      updateHeatmap();
      renderDanmaku();
      showTimedDanmaku();
    }).catch(() => { if (current()) el('danmaku-list').append(node('p', 'status', '弹幕加载失败，请刷新重试')); });
    if (typeof setupVideoInteractions === 'function') {
      disposeInteractions = setupVideoInteractions(id, video.authorId, player, video.duration, row => {
        if (!current()) return;
        danmaku.push(row);
        updateHeatmap();
        renderDanmaku();
        const mode = modeOf(row);
        const time = player.currentTime;
        const end = row.timestamp + (mode === 'scroll' ? 1 : fixedDanmakuSeconds);
        if ((!historicalRows || historicalRows.includes(row)) && enabled && !player.seeking && time >= row.timestamp && time < end
            && watchSidebar.allowed(row) && watchPreferences.allows(mode, row.color)
            && displayDanmaku(row, mode)) shown.add(row.id);
      }, video.author);
    }
    return true;
  } catch (error) { if (!current()) return false; el('video-title').textContent = error.message === '404' ? '视频不存在或已下架' : '视频加载失败'; el('player-status').hidden = false; el('player-status').textContent = '请返回首页选择其他视频'; }
  }
  await loadVideo();
  let collection = await api('/videos/' + id + '/collection').catch(() => null);
  const queuePanel = el('video-collection'), queueList = el('collection-list');
  const queueMeta = el('collection-meta');
  const expand = el('collection-expand'), danmakuPanel = el('danmaku-panel');
  let queue = [], queueIndex = -1, queueRequest = 0;
  let reverseFolder = read('bili-folder-reverse', false) === true;
  let shuffleFolder = read('bili-folder-shuffle', false) === true;
  function renderFolderControls() {
    const order = el('folder-playback-sequence');
    const cycle = el('folder-playback-loop');
    order.dataset.tooltip = reverseFolder ? '倒序播放' : '顺序播放';
    cycle.dataset.tooltip = shuffleFolder ? '随机播放' : '列表循环';
    order.setAttribute('aria-label', order.dataset.tooltip);
    cycle.setAttribute('aria-label', cycle.dataset.tooltip);
    order.setAttribute('aria-pressed', String(reverseFolder));
    cycle.setAttribute('aria-pressed', String(shuffleFolder));
    el('folder-playback-order-icon').setAttribute('d', reverseFolder
      ? 'M10 6h11M10 12h11M10 18h11M5 18V6m-3 3 3-3 3 3'
      : 'M10 6h11M10 12h11M10 18h11M5 6v12m-3-3 3 3 3-3');
    el('folder-playback-cycle-icon').setAttribute('d', shuffleFolder
      ? 'M3 6h3c6 0 6 12 12 12h3m-3-3 3 3-3 3M3 18h3c6 0 6-12 12-12h3m-3-3 3 3-3 3'
      : 'M3 11a5 5 0 0 1 5-5h12m-3-3 3 3-3 3m4 4a5 5 0 0 1-5 5H4m3-3-3 3 3 3');
  }
  el('folder-playback-sequence').onclick = () => {
    reverseFolder = !reverseFolder;
    save('bili-folder-reverse', reverseFolder);
    renderFolderControls();
    if (!trialExpired() && queuePanel.dataset.queue === 'folder') {
      playQueueVideo(reverseFolder ? queue.at(-1) : queue[0]);
    }
  };
  el('folder-playback-loop').onclick = () => {
    shuffleFolder = !shuffleFolder;
    save('bili-folder-shuffle', shuffleFolder);
    renderFolderControls();
    if (shuffleFolder && !trialExpired() && queuePanel.dataset.queue === 'folder') playAdjacentVideo(1);
  };

  function setFolderExpanded(expanded) {
    expand.setAttribute('aria-expanded', String(expanded));
    expand.setAttribute('aria-label', expanded ? '收起收藏夹' : '展开收藏夹');
    queueMeta.hidden = !expanded;
    queueList.hidden = !expanded;
  }

  function renderQueue(folder, items) {
    queue = items;
    queueIndex = queue.findIndex(v => String(v.id) === id);
    const available = queueIndex >= 0;
    const isFolder = Boolean(folder);
    activePlaylist = isFolder ? playlist : available && playlist === 'collection' ? playlist : '';
    queuePanel.dataset.queue = isFolder ? 'folder' : 'collection';
    queuePanel.hidden = !available;
    el('related-heading').hidden = available;
    collectionOwner = isFolder ? null : collection?.ownerId;
    syncSubscriptionButton();
    el('folder-playback-modes').hidden = !isFolder;
    el('folder-more').hidden = !isFolder;
    expand.setAttribute('aria-expanded', 'false');
    expand.setAttribute('aria-controls', isFolder ? 'collection-meta collection-list' : 'collection-list');
    queueMeta.hidden = false;
    queueList.hidden = false;
    queueList.dataset.expanded = 'false';
    danmakuPanel.inert = false;
    if (!available) {
      queueList.replaceChildren();
      el('fullscreen-collection-list').replaceChildren();
      return;
    }
    const label = isFolder ? '收藏夹' : '合集列表';
    expand.setAttribute('aria-label', '展开' + label);
    el('collection-title').textContent = isFolder ? folder.name : collection.title;
    const position = (queueIndex + 1) + '/' + queue.length;
    el('collection-position').textContent = isFolder ? position : '(' + position + ')';
    el('collection-plays').textContent = isFolder ? (viewerName ? '创建者：' + viewerName : '') : shortCount(collection.plays) + '播放';
    if (isFolder) {
      el('folder-more').href = '/me?tab=favorites&folder=' + encodeURIComponent(folderPlaylist[1]);
      renderFolderControls();
      setFolderExpanded(true);
    }
    queueList.replaceChildren(...queue.map(v => {
      const current = String(v.id) === id;
      const item = link(playbackUrl(v), null, 'collection-item' + (current ? ' current' : ''));
      if (current) item.setAttribute('aria-current', 'true');
      item.title = v.title;
      const cover = node('div', 'card-cover');
      const image = node('img');
      image.alt = '';
      image.loading = 'lazy';
      cover.append(image);
      attachCover(image, v.coverUrl || '/api/videos/' + encodeURIComponent(v.id) + '/cover', v.category);
      const details = node('div', 'collection-item-details');
      const stats = node('div', 'collection-item-stats');
      if (isFolder) {
        stats.append(node('span', '', shortCount(v.plays) + '播放'));
      } else {
        for (const [symbol, label, count] of [['play', '播放', v.plays], ['list', '弹幕', v.danmaku]]) {
          const stat = node('span');
          const total = shortCount(count);
          stat.append(icon(symbol), total);
          stat.setAttribute('aria-label', label + ' ' + total);
          stats.append(stat);
        }
      }
      details.append(node('span', 'collection-item-title', v.title), stats);
      item.append(cover, details, node('time', 'collection-item-duration', clock(v.duration)));
      return item;
    }));
    el('fullscreen-collection-list').replaceChildren(...queue.map(v =>
      link(playbackUrl(v), v.title, 'fullscreen-episode' + (String(v.id) === id ? ' current' : ''))
    ));
    const activeEpisode = queueList.children[queueIndex];
    queueList.scrollTop = isFolder ? activeEpisode?.offsetTop ?? 0 : 0;
    if (isFolder) {
      expand.onclick = () => setFolderExpanded(expand.getAttribute('aria-expanded') !== 'true');
      return;
    }
    let compactScrollTop = 0;
    expand.onclick = () => {
      const expanded = expand.getAttribute('aria-expanded') !== 'true';
      if (expanded) compactScrollTop = queueList.scrollTop;
      expand.setAttribute('aria-expanded', String(expanded));
      expand.setAttribute('aria-label', (expanded ? '收起' : '展开') + label);
      danmakuPanel.inert = expanded;
      queueList.dataset.expanded = String(expanded);
      queueList.scrollTop = expanded ? activeEpisode?.offsetTop ?? 0 : compactScrollTop;
    };
  }

  let collectionItems = collection?.title ? (collection.items ?? []) : [];
  async function refreshQueue() {
    const request = ++queueRequest;
    const requestedId = id;
    renderQueue(null, collectionItems);
    if (!folderPlaylist || !signedIn) return;
    try {
      const [space, videos] = await Promise.all([
        interaction('/me/space'), interaction('/me/folders/' + folderPlaylist[1] + '/videos')
      ]);
      if (request !== queueRequest || requestedId !== id) return;
      const folder = space.folders.find(item => String(item.id) === folderPlaylist[1]);
      if (folder && videos.some(video => String(video.id) === id)) renderQueue(folder, videos);
    } catch { /* Keep the video's regular sidebar if the folder is unavailable. */ }
  }
  window.addEventListener('accountchange', refreshQueue);
  await refreshQueue();
  setupWatchComments(id);
  restoreFloatingPlayer = setupWatchScroll(player, shell);
  async function loadRelated() {
    const revision = videoRevision;
    try {
    const result = await api('/videos?size=40');
    if (revision !== videoRevision) return;
    const related = result.items.filter(v => String(v.id) !== id);
    nextVideo = related[0];
    setupRelatedExpansion(related);
  } catch { if (revision === videoRevision) el('related-videos').textContent = '暂无推荐视频'; }
  }
  await loadRelated();
  function adjacentVideo(step) {
    if (queueIndex < 0) return step > 0 ? nextVideo : null;
    if (queuePanel.dataset.queue !== 'folder') return queue[queueIndex + step];
    if (shuffleFolder && queue.length > 1) {
      const index = Math.floor(Math.random() * (queue.length - 1));
      return queue[index < queueIndex ? index : index + 1];
    }
    const offset = reverseFolder ? -step : step;
    return queue[(queueIndex + offset + queue.length) % queue.length];
  }
  function playAdjacentVideo(step) {
    return playQueueVideo(adjacentVideo(step));
  }
  function playQueueVideo(target) {
    if (!target) return false;
    if (String(target.id) === id) {
      player.currentTime = 0;
      player.play().catch(() => {});
    } else switchVideo(target.id, playbackUrl(target));
    return true;
  }
  async function switchVideo(nextId, href, push = true) {
    if (String(nextId) === id) return;
    switching = true;
    player.pause();
    disposeInteractions?.(); disposeInteractions = null;
    stopPresence?.(); stopPresence = null;
    id = String(nextId);
    if (push) history.pushState(null, '', href);
    const query = new URLSearchParams(location.search);
    playlist = query.get('playlist') || (query.get('fav') ? 'folder-' + query.get('fav') : '');
    folderPlaylist = /^folder-(\d+)$/.exec(playlist || '');
    activePlaylist = playlist === 'collection' || folderPlaylist ? playlist : '';
    const revision = videoRevision + 1;
    ++queueRequest;
    clearOnscreenDanmaku(); hideDanmakuActions();
    danmaku = []; withdrawn.clear(); shown.clear(); pendingWithdrawals.clear();
    reportedDanmaku = new Set(); historyDate = ''; historicalRows = null;
    resetDanmakuHistory();
    lastVideoTime = 0; nextVideo = null;
    player.removeAttribute('src'); player.load();
    el('player-status').hidden = true;
    el('player-author-avatar').hidden = false;
    el('danmaku-report-feedback').hidden = true;
    for (const dialog of document.querySelectorAll?.('.danmaku-report[open]') || []) dialog.close();
    renderDanmaku(); updateHeatmap();
    for (const key of ['like','coin','favorite','share']) el(key + '-count').textContent = '—';
    // Invalidate old comment requests immediately, before fetching the new video.
    setupWatchComments(id);
    const loaded = await loadVideo();
    if (revision !== videoRevision) return;
    const nextCollection = loaded ? await api('/videos/' + encodeURIComponent(id) + '/collection').catch(() => null) : null;
    if (revision !== videoRevision) return;
    collection = nextCollection;
    collectionItems = collection?.title ? (collection.items ?? []) : [];
    await refreshQueue();
    await loadRelated();
    if (revision === videoRevision) switching = false;
  }
  function queueClick(event) {
    const anchor = event.target.closest?.('a');
    if (!anchor || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const url = new URL(anchor.href, location.href);
    const match = /^\/video\/([^/]+)$/.exec(url.pathname);
    if (!match || url.origin !== location.origin) return;
    event.preventDefault();
    playQueueVideo({id: decodeURIComponent(match[1])});
  }
  queueList.addEventListener('click', queueClick);
  el('fullscreen-collection-list').addEventListener('click', queueClick);
  window.addEventListener('popstate', () => {
    const match = /^\/video\/([^/]+)$/.exec(location.pathname);
    if (match) switchVideo(decodeURIComponent(match[1]), location.href, false);
  });
  el('fullscreen-prev').onclick = () => { if (!playAdjacentVideo(-1)) notice('没有上一集'); };
  el('fullscreen-next').onclick = () => { if (!playAdjacentVideo(1)) notice('没有下一集'); };
  player.addEventListener('ended', () => {
    if (!switching && !trialExpired() && (queueIndex >= 0 || el('autoplay-next').checked)) playAdjacentVideo(1);
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
