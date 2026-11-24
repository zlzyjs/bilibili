async function interaction(path, method = 'GET', body, keepalive = false, csrfToken) {
  const options = { method, cache: 'no-store', keepalive };
  if (body !== undefined) {
    const token = csrfToken || (await authApi('csrf')).token;
    options.headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': token };
    options.body = JSON.stringify(body);
  }
  const response = await fetch('/api/interactions' + path, options);
  if (response.status === 204) return;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || '互动操作失败，请稍后重试');
  return result;
}

function memberAction(button, action) {
  button.onclick = async () => {
    if (!currentAccount) return openLogin(button);
    button.disabled = true;
    try { await action(); }
    catch (error) { accountNotice(error.message); }
    finally { button.disabled = false; }
  };
}

function interactionPanel(title, build, fullscreenParent = document.body) {
  const dialog = node('dialog', 'interaction-dialog');
  const heading = node('h2', '', title);
  heading.id = 'interaction-dialog-title';
  dialog.setAttribute('aria-labelledby', heading.id);
  const close = node('button', 'interaction-close', '关闭');
  close.type = 'button';
  close.onclick = () => dialog.close();
  const body = node('div', 'interaction-body');
  const status = node('p', 'interaction-status');
  status.setAttribute('role', 'status');
  dialog.append(heading, close, body, status);
  fullscreenParent.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
  Promise.resolve().then(() => build(body, status, () => dialog.close())).catch(error => {
    status.textContent = error.message;
  });
}

function interactionForm(body, status, fields, label, submit) {
  const form = node('form', 'interaction-form');
  const send = node('button', 'login-primary', label);
  send.type = 'submit';
  fields.forEach(({ label, input }) => {
    const field = node('label');
    field.append(node('span', '', label), input);
    form.append(field);
  });
  form.append(send);
  form.onsubmit = async (event) => {
    event.preventDefault();
    send.disabled = true;
    status.textContent = '';
    try { await submit(); }
    catch (error) { status.textContent = error.message; }
    finally { send.disabled = false; }
  };
  body.append(form);
}

function textInteraction(title, label, max, submit, multiline = true) {
  interactionPanel(title, (body, status, close) => {
    const input = node(multiline ? 'textarea' : 'input');
    input.required = true;
    input.maxLength = max;
    if (multiline) input.rows = 4;
    else { input.inputMode = 'numeric'; input.pattern = '[1-9][0-9]{0,19}'; }
    interactionForm(body, status, [{ label, input }], '发送', async () => {
      await submit(input.value.trim());
      close();
      accountNotice('发送成功');
    });
  }, document.fullscreenElement || document.body);
}

function reportInteraction(kind, id) {
  interactionPanel('举报', async (body, status, close) => {
    const reasons = await interaction('/reports/' + kind + '/reasons');
    if (!reasons.length) { status.textContent = '当前没有可选的举报原因'; return; }
    const reason = node('select');
    reason.required = true;
    const placeholder = node('option', '', '请选择');
    placeholder.value = '';
    reason.append(placeholder);
    reasons.forEach(entry => { const option = node('option', '', entry.name); option.value = entry.id; reason.append(option); });
    const description = node('textarea');
    description.rows = 3;
    description.maxLength = 200;
    interactionForm(body, status, [{ label: '举报原因', input: reason }, { label: '补充说明（选填）', input: description }], '提交举报', async () => {
      await interaction('/reports/' + kind + '/' + id, 'POST', { reason: reason.value, description: description.value });
      close();
      accountNotice('举报已提交');
    });
  }, document.fullscreenElement || document.body);
}

function pressInteraction(button, enabled) {
  button.setAttribute('aria-pressed', String(enabled));
}

function bindLike(button, kind, id, render, load = true) {
  const resource = '/likes/' + kind + '/' + id;
  const apply = (result) => {
    pressInteraction(button, result.enabled);
    render(result.count);
  };
  memberAction(button, async () => {
    const existing = await interaction(resource);
    apply(await interaction(resource, 'PUT', { enabled: !existing.enabled }));
  });
  if (load && currentAccount) {
    const uid = currentAccount.uid;
    interaction(resource).then(result => { if (currentAccount?.uid === uid && !button.disabled) apply(result); }).catch(() => {});
  }
}

function setupAuthorInteractions(id, root, renderFollowers) {
  const follow = [...root.querySelectorAll('[data-interaction=follow]')];
  const block = root.querySelector('[data-interaction=block]');
  const message = root.querySelector('[data-interaction=message]');
  const report = root.querySelector('[data-interaction=account-report]');
  const resource = '/authors/' + id + '/relation';
  const apply = (result) => {
    if (renderFollowers) renderFollowers(result.followers);
    for (const button of follow) {
      pressInteraction(button, result.following);
      button.querySelector('[data-follow-label]').textContent = result.following ? '已关注' : '关注';
    }
    if (block) {
      pressInteraction(block, result.blocked);
      block.textContent = result.blocked ? '移出黑名单' : '加入黑名单';
    }
  };
  const refresh = async () => {
    const uid = currentAccount?.uid;
    [...follow, block, message, report].filter(Boolean).forEach(button => { button.hidden = uid === id; });
    const result = await interaction(resource);
    if (currentAccount?.uid === uid) apply(result);
  };
  follow.forEach(button => memberAction(button, async () => {
    const state = await interaction(resource);
    apply(await interaction(resource + '/follow', 'PUT', { enabled: !state.following }));
  }));
  if (block) memberAction(block, async () => {
    const state = await interaction(resource);
    apply(await interaction(resource + '/block', 'PUT', { enabled: !state.blocked }));
  });
  if (message) memberAction(message, () => {
    location.assign('/messages?' + new URLSearchParams({ uid: id }));
  });
  if (report) memberAction(report, () => reportInteraction('account', id));
  const refreshQuietly = () => refresh().catch(() => {});
  window.addEventListener('accountchange', refreshQuietly);
  refreshQuietly();
}

function setupPeopleList(button, id, kind, title) {
  memberAction(button, () => interactionPanel(title, async body => {
    const people = await interaction('/authors/' + id + '/relations/' + kind);
    appendInteractionList(body, people, person => {
      const row = node('li');
      row.append(link('/space/' + person.id, person.name));
      return row;
    });
  }));
}

function setupVideoInteractions(id, author, player, duration, onDanmaku) {
  const root = el('video-page');
  const resource = '/videos/' + id;
  const like = el('video-like'), favorite = el('video-favorite'), subscribe = el('video-subscribe');
  if (root) setupAuthorInteractions(author, root, followers => { el('watch-followers').textContent = shortCount(followers); });
  bindLike(like, 'video', id, count => { el('like-count').textContent = shortCount(count); }, false);
  memberAction(favorite, () => interactionPanel('收藏视频', async (body, status) => {
    const folders = await interaction(resource + '/folders');
    if (!folders.length) { status.textContent = '当前账号没有可用的收藏夹'; return; }
    folders.forEach(folder => {
      const row = node('label', 'interaction-option');
      const checkbox = node('input');
      checkbox.type = 'checkbox';
      checkbox.checked = folder.selected;
      checkbox.onchange = async () => {
        checkbox.disabled = true;
        status.textContent = '';
        try {
          const result = await interaction(resource + '/folders/' + folder.id, 'PUT', { enabled: checkbox.checked });
          pressInteraction(favorite, result.enabled);
          el('favorite-count').textContent = shortCount(result.count);
        } catch (error) {
          checkbox.checked = !checkbox.checked;
          status.textContent = error.message;
        } finally { checkbox.disabled = false; }
      };
      row.append(checkbox, node('span', '', folder.name));
      body.append(row);
    });
  }));
  memberAction(el('video-coin'), () => interactionPanel('为视频投币', (body, status, close) => {
    const amount = node('select');
    [1, 2].forEach(value => { const option = node('option', '', value + ' 枚'); option.value = value; amount.append(option); });
    interactionForm(body, status, [{ label: '投币数量', input: amount }], '确认投币', async () => {
      const result = await interaction(resource + '/coins', 'POST', { value: Number(amount.value) });
      el('coin-count').textContent = shortCount(result.count);
      close();
      accountNotice('投币成功');
    });
  }));
  memberAction(el('video-share'), () => textInteraction('转发视频', '接收方 UID', 20, async value => {
    const result = await interaction(resource + '/forward', 'POST', { value });
    el('share-count').textContent = shortCount(result.count);
  }, false));
  memberAction(el('video-report'), () => reportInteraction('video', id));
  const renderSubscription = (on) => {
    pressInteraction(subscribe, on);
    subscribe.textContent = on ? '已订阅合集' : '订阅合集';
  };
  memberAction(subscribe, async () => {
    const state = await interaction(resource + '/state');
    const result = await interaction(resource + '/subscription', 'PUT', { enabled: !state.subscribed });
    renderSubscription(result.enabled);
  });
  el('danmaku-guest').onclick = () => openLogin(el('danmaku-guest'));
  const composer = el('danmaku-entry'), danmaku = el('danmaku-text'), send = el('danmaku-send');
  composer.onsubmit = async (event) => {
    event.preventDefault();
    if (!currentAccount) return openLogin(send);
    if (send.disabled || !danmaku.value.trim()) return;
    send.disabled = true;
    try {
      const row = await interaction(resource + '/danmaku', 'POST',
        { value: danmaku.value, position: Math.max(0, Math.min(duration, Math.floor(player.currentTime))) });
      danmaku.value = '';
      onDanmaku(row);
    } catch (error) { accountNotice(error.message); }
    finally { send.disabled = false; }
  };

  let viewer, progressToken, lastSaved, saving = false, progressReady = false, played = false;
  const currentPosition = () => Math.max(0, Math.min(duration, Math.floor(player.currentTime)));
  async function saveProgress(final = false) {
    if (!viewer || !progressReady || saving || !played || (final && !progressToken)) return;
    const value = currentPosition();
    if (value === lastSaved) return;
    saving = true;
    const uid = viewer;
    try {
      await interaction(resource + '/progress', 'PUT', { value }, final, progressToken);
      if (viewer === uid) lastSaved = value;
    } catch {} finally { saving = false; }
  }
  const record = () => { played = true; saveProgress(); };
  player.addEventListener('play', record);
  player.addEventListener('timeupdate', () => {
    if (lastSaved === undefined || Math.abs(currentPosition() - lastSaved) >= 10) saveProgress();
  });
  player.addEventListener('pause', () => saveProgress());
  window.addEventListener('pagehide', () => saveProgress(true));

  async function refresh() {
    const uid = currentAccount?.uid;
    el('danmaku-guest').hidden = Boolean(uid);
    composer.hidden = !uid;
    if (viewer !== uid) {
      viewer = uid;
      progressToken = undefined;
      lastSaved = undefined;
      progressReady = false;
      played = !player.paused;
    }
    const [state, csrf] = await Promise.all([interaction(resource + '/state'), uid ? authApi('csrf') : undefined]);
    if (currentAccount?.uid !== uid) return;
    if (!like.disabled) pressInteraction(like, state.liked);
    pressInteraction(favorite, state.favorited);
    renderSubscription(state.subscribed);
    if (!uid || progressReady) return;
    progressToken = csrf.token;
    progressReady = true;
    if (state.position > 0 && state.position < duration && player.currentTime < 1) {
      const resume = () => { if (viewer === uid && player.currentTime < 1) player.currentTime = state.position; };
      if (player.readyState >= 1) resume();
      else player.addEventListener('loadedmetadata', resume, { once: true });
      lastSaved = state.position;
    }
    saveProgress();
  }
  const refreshQuietly = () => refresh().catch(() => {});
  window.addEventListener('accountchange', refreshQuietly);
  refreshQuietly();
}

function formatViewTime(iso) {
  if (!iso) return '';
  const [date, time = ''] = String(iso).split('T');
  return date.slice(5) + (time ? ' ' + time.slice(0, 5) : '');
}

function videoRow(v, note) {
  const row = node('li', 'dd-video');
  const videoUrl = '/video/' + encodeURIComponent(v.id);
  const cover = link(videoUrl, null, 'dd-video-cover');
  const img = node('img');
  img.alt = '';
  img.loading = 'lazy';
  const dur = duration(v.duration);
  const coverLabel = v.position > 0 ? duration(v.position) + '/' + dur : dur;
  if (v.position > 0 && v.duration > 0) {
    const bar = node('i', 'dd-video-progress');
    bar.style.width = Math.min(100, Math.round(v.position / v.duration * 100)) + '%';
    cover.append(bar);
  }
  cover.append(img, node('span', 'dd-video-dur', coverLabel));
  attachCover(img, '/api/videos/' + encodeURIComponent(v.id) + '/cover', '暂无封面');
  const info = node('div', 'dd-video-info');
  info.append(link(videoUrl, v.title, 'dd-video-title'));
  const meta = node('div', 'dd-video-meta');
  if (note) meta.append(node('span', 'dd-video-time', note));
  if (v.author) {
    const up = link('/space/' + encodeURIComponent(v.authorId || ''), null, 'dd-video-up');
    up.append(node('span', 'up', 'UP'), node('span', '', v.author));
    meta.append(up);
  }
  info.append(meta);
  row.append(cover, info);
  return row;
}

function messageRow(row) {
  const item = node('li');
  item.append(link('/space/' + row.senderId, row.sender), node('small', '', formatViewTime(row.sentAt)));
  if (row.videoId) item.append(link('/video/' + row.videoId, '查看转发的视频'));
  else item.append(node('p', '', row.content || '转发的视频已不可用'));
  return item;
}

const interactionViews = {
  messages: {
    title: '我的消息',
    build: async body => {
      appendInteractionList(body, await interaction('/messages'), messageRow);
      body.append(node('h3', '', '系统通知'));
      appendInteractionList(body, await interaction('/notifications'), row => {
        const item = node('li');
        item.append(node('small', '', formatViewTime(row.sentAt)), node('p', '', row.content));
        return item;
      });
    }
  },
  history: {
    title: '观看历史',
    build: async body => {
      appendInteractionList(body, await interaction('/history'),
        v => videoRow(v, formatViewTime(v.viewedAt)), 'dd-video-list');
      body.append(node('h3', '', '搜索历史'));
      appendInteractionList(body, await interaction('/search-history'), keyword => {
        const item = node('li');
        item.append(link('/search?' + new URLSearchParams({ keyword }), keyword));
        return item;
      });
    }
  }
};

function openInteractionPanel(kind) {
  hideLoginPopup();
  interactionPanel(interactionViews[kind].title, interactionViews[kind].build);
}

function setupInteractionNavigation() {
  const messages = document.querySelector('[data-interaction=messages]');
  const history = document.querySelector('[data-interaction=history]');
  const favorites = document.querySelector('[data-interaction=favorites]');
  if (messages) memberAction(messages, () => location.assign('/messages'));
  if (history) memberAction(history, () => openInteractionPanel('history'));
  if (favorites) favorites.onclick = () => currentAccount ? location.assign('/me?tab=favorites') : openLogin(favorites);
}

function appendInteractionList(body, rows, render, className = 'interaction-list') {
  if (!rows.length) {
    body.append(node('p', '', '暂无记录'));
    return;
  }
  const list = node('ul', className);
  list.append(...rows.map(render));
  body.append(list);
}

function recordSearchHistory() {
  if (location.pathname !== '/search') return;
  const keyword = (new URLSearchParams(location.search).get('keyword') || '').trim();
  if (!keyword || [...keyword].length > 100) return;
  let recordedUid;
  const record = () => {
    const uid = currentAccount?.uid;
    if (!uid || uid === recordedUid) return;
    recordedUid = uid;
    interaction('/search-history', 'POST', { value: keyword }).catch(() => {
      if (recordedUid === uid) recordedUid = undefined;
    });
  };
  window.addEventListener('accountchange', record);
  record();
}

function panelFooter(label, action) {
  const foot = node('div', 'dd-foot');
  const button = node('button', 'dd-foot-link', label);
  button.type = 'button';
  button.onclick = action;
  foot.append(button);
  return foot;
}

function navDropdown(button, className, build) {
  const wrap = node('div', 'nav-item-wrap');
  const panel = node('div', 'nav-dropdown ' + className);
  button.before(wrap);
  wrap.append(button, panel);
  let hideTimer, loaded = false, request = 0;
  const hide = () => { clearTimeout(hideTimer); hideTimer = setTimeout(() => wrap.classList.remove('open'), 160); };
  const show = async () => {
    if (!currentAccount) return;
    clearTimeout(hideTimer);
    document.querySelectorAll('.nav-item-wrap.open').forEach(other => { if (other !== wrap) other.classList.remove('open'); });
    wrap.classList.add('open');
    if (loaded) return;
    loaded = true;
    panel.replaceChildren(node('p', 'nav-dropdown-empty', '加载中…'));
    const ticket = ++request;
    try {
      const content = await build();
      if (ticket === request) panel.replaceChildren(...content);
    } catch {
      if (ticket !== request) return;
      loaded = false;
      panel.replaceChildren(node('p', 'nav-dropdown-empty', '加载失败，请重试'));
    }
  };
  button.addEventListener('mouseenter', show);
  button.addEventListener('mouseleave', hide);
  panel.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  panel.addEventListener('mouseleave', hide);
  window.addEventListener('accountchange', () => {
    request++;
    loaded = false;
    wrap.classList.remove('open');
    panel.replaceChildren();
  });
}

function setupMessageDropdown(button) {
  navDropdown(button, 'dd-message', () => {
    const menu = node('div', 'dd-menu');
    [
      ['/messages?tab=replies', '回复我的'],
      ['/messages?tab=mentions', '@我的'],
      ['/messages?tab=likes', '收到的赞'],
      ['/messages?tab=system', '系统消息'],
      ['/messages?tab=chat', '我的消息']
    ].forEach(([href, label]) => menu.append(link(href, label, 'dd-menu-item')));
    return [menu];
  });
}

function setupFavoriteDropdown(button) {
  navDropdown(button, 'dd-fav', async () => {
    const [space, favorites] = await Promise.all([interaction('/me/space'), interaction('/favorites')]);
    const folders = space.folders || [];
    const side = node('aside', 'dd-fav-folders');
    const list = node('ul', 'dd-video-list');
    let active = folders[0]?.id;
    const renderVideos = () => {
      const rows = active ? favorites.filter(v => v.folderId === active) : favorites;
      if (rows.length) list.replaceChildren(...rows.slice(0, 8).map(v => videoRow(v)));
      else list.replaceChildren(node('li', 'nav-dropdown-empty', '暂无收藏'));
    };
    const buttons = folders.map(folder => {
      const item = node('button', 'dd-fav-folder' + (folder.id === active ? ' active' : ''));
      item.type = 'button';
      item.append(node('span', '', folder.name), node('span', 'dd-fav-count', String(folder.count)));
      item.addEventListener('mouseenter', () => {
        active = folder.id;
        buttons.forEach(other => other.classList.toggle('active', other === item));
        renderVideos();
      });
      side.append(item);
      return item;
    });
    renderVideos();
    const main = node('div', 'dd-fav-main');
    main.append(list, panelFooter('查看全部收藏', () => location.assign('/me?tab=favorites')));
    return folders.length ? [side, main] : [main];
  });
}

function setupHistoryDropdown(button) {
  navDropdown(button, 'dd-history', async () => {
    const rows = await interaction('/history');
    const list = node('ul', 'dd-video-list');
    if (rows.length) list.append(...rows.slice(0, 8).map(v => videoRow(v, formatViewTime(v.viewedAt))));
    else list.append(node('li', 'nav-dropdown-empty', '暂无内容'));
    return [list, panelFooter('查看全部历史', () => openInteractionPanel('history'))];
  });
}

function setupNavDropdowns() {
  const messages = document.querySelector('[data-interaction=messages]');
  const favorites = document.querySelector('[data-interaction=favorites]');
  const history = document.querySelector('[data-interaction=history]');
  if (messages) setupMessageDropdown(messages);
  if (favorites) setupFavoriteDropdown(favorites);
  if (history) setupHistoryDropdown(history);
}

setupInteractionNavigation();
setupNavDropdowns();
recordSearchHistory();
