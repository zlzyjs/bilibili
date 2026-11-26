(() => {
  const root = el('message-center');
  const tabs = { chat: '我的消息', replies: '回复我的', mentions: '@ 我的', likes: '收到的赞',
    system: '系统通知' };
  let tab = Object.hasOwn(tabs, params.get('tab')) ? params.get('tab') : 'chat';
  let peer = params.get('uid');
  function syncRoute() {
    const route = new URLSearchParams(location.search);
    tab = Object.hasOwn(tabs, route.get('tab')) ? route.get('tab') : 'chat';
    peer = route.get('uid');
  }
  const url = (key, extra = {}) => '/messages?' + new URLSearchParams({ tab: key, ...extra });
  const button = (label, action, css = 'mc-button') => {
    const element = node('button', css, label);
    element.type = 'button';
    element.onclick = action;
    return element;
  };
  let openMenu;
  function closeMessageMenu() {
    if (openMenu) openMenu.hidden = true;
    openMenu = undefined;
  }
  addEventListener('click', closeMessageMenu);

  function readChatPrefs(uid) {
    try { return JSON.parse(localStorage.getItem('mc:chat:' + uid)) || {}; } catch { return {}; }
  }
  function writeChatPrefs(uid, prefs) {
    localStorage.setItem('mc:chat:' + uid, JSON.stringify(prefs));
  }

  function mcDialog(title, build, variant = '') {
    const dialog = node('dialog', 'mc-dialog' + (variant ? ' ' + variant : ''));
    const heading = node('h2', '', title);
    const close = button('×', () => dialog.close(), 'mc-dialog-close');
    close.setAttribute('aria-label', '关闭');
    const head = node('div', 'mc-dialog-head');
    head.append(heading, close);
    const content = node('div', 'mc-dialog-content');
    const status = node('p', 'mc-dialog-status');
    status.setAttribute('role', 'status');
    const actions = node('div', 'mc-dialog-actions');
    dialog.append(head, content, status, actions);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
    Promise.resolve().then(() => build(content, actions, status, () => dialog.close()))
      .catch(error => { status.textContent = error.message; });
  }

  function mcConfirm(title, text, action, okText = '确定') {
    mcDialog(title, (content, actions, status, close) => {
      content.append(node('p', 'mc-dialog-text', text));
      const cancel = button('取消', close, 'mc-dialog-cancel');
      const ok = button(okText, async () => {
        ok.disabled = cancel.disabled = true;
        try { await action(); close(); }
        catch (error) { status.textContent = error.message; ok.disabled = cancel.disabled = false; }
      }, 'mc-dialog-ok');
      actions.append(cancel, ok);
    }, 'mc-dialog-confirm');
  }

  function zoomImage(src) {
    let mask = el('mc-lightbox');
    if (!mask) {
      mask = node('div', 'mc-lightbox');
      mask.id = 'mc-lightbox';
      mask.setAttribute('role', 'dialog');
      mask.setAttribute('aria-label', '查看图片');
      const image = node('img');
      image.alt = '私信图片';
      const close = button('×', () => hide(), 'mc-lightbox-close');
      close.setAttribute('aria-label', '关闭');
      mask.append(image, close);
      document.body.append(mask);
    }
    const hide = () => mask.classList.remove('is-open');
    if (!mask.dataset.ready) {
      mask.dataset.ready = '1';
      mask.onclick = event => { if (event.target !== mask.querySelector('img')) hide(); };
      document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
    }
    mask.querySelector('img').src = src;
    mask.classList.add('is-open');
  }

  function reportAccount(peer, name) {
    mcDialog('举报该用户', async (content, actions, status, close) => {
      const reasons = await interaction('/reports/account/reasons');
      const intro = node('p', 'mc-dialog-text');
      intro.append('请选择您举报 ', node('strong', '', name || '该用户'), ' 的理由，该对话近期内的消息将作为证据一并提交。');
      const list = node('div', 'mc-report-reasons');
      let chosen = '';
      for (const reason of reasons) {
        const input = node('input');
        input.type = 'radio';
        input.name = 'mc-report-reason';
        input.value = reason.id;
        input.onchange = () => { chosen = reason.id; };
        const label = node('label');
        label.append(input, node('span', '', reason.name));
        list.append(label);
      }
      const detail = node('div', 'mc-report-detail');
      const description = node('textarea');
      description.maxLength = 60;
      const counter = node('span', 'mc-report-count', '0/60');
      description.oninput = () => { counter.textContent = description.value.length + '/60'; };
      detail.append(description, counter);
      content.append(intro, list,
        node('p', 'mc-report-hint', '为帮助审核人员更快处理，请补充问题类型和出现位置等详细信息'), detail);
      const cancel = button('取消', close, 'mc-dialog-cancel');
      const ok = button('确认', async () => {
        if (!chosen) { status.textContent = '请选择举报理由'; return; }
        ok.disabled = cancel.disabled = true;
        try {
          await interaction('/reports/account/' + encodeURIComponent(peer), 'POST', { reason: chosen, description: description.value.trim() });
          close();
          accountNotice('举报已提交');
        } catch (error) { status.textContent = error.message; ok.disabled = cancel.disabled = false; }
      }, 'mc-dialog-ok');
      actions.append(cancel, ok);
    });
  }

  async function inbox(resource, method = 'GET', data) {
    return apiRequest('/api/message-center', resource, { method, body: data, fallback: '消息操作失败，请重试' });
  }

  function avatar(uid) {
    const image = node('img', 'mc-avatar');
    image.alt = '';
    image.src = '/api/authors/' + encodeURIComponent(uid) + '/avatar';
    image.onerror = () => { image.onerror = null; image.src = '/assets/guest-avatar.gif'; };
    return image;
  }

  function empty(text, picture) {
    const state = node('div', 'mc-empty');
    if (picture) {
      const art = node('img', picture === 'chat' ? 'mc-empty-art' : 'mc-notice-empty-art');
      art.alt = '';
      art.src = picture === 'chat' ? '/assets/mc-placeholder.png' : '/assets/mc-notice-empty.png';
      state.append(art);
    } else state.append(icon('mail'));
    state.append(node('p', '', text));
    return state;
  }

  async function chat(section, status, stillCurrent) {
    const frame = node('div', 'mc-chat');
    const list = node('div', 'mc-threads');
    const entries = node('div', 'mc-thread-list');
    const main = node('section', 'mc-conversation');
    if (peer) frame.classList.add('mc-thread-open');
    const bar = node('div', 'mc-threads-title');
    bar.append(node('span', '', '最近会话'));
    list.append(bar, entries);
    frame.append(list, main);
    section.append(frame);
    const threads = [];
    let moreThreads = true;
    let offset = 0;
    let currentName;
    let loadingThreads = false;
    const threadPath = '/threads/' + encodeURIComponent(peer);
    const threadLink = (uid, name) => link(url('chat', { uid }), name);

    function threadItem(row) {
      const prefs = readChatPrefs(row.uid);
      const item = threadLink(row.uid);
      item.className = 'mc-thread';
      if (prefs.pin) item.classList.add('is-pinned');
      if (row.uid === peer) item.setAttribute('aria-current', 'page');
      const words = node('div', 'mc-thread-copy');
      words.append(node('strong', '', row.name || '账号已注销'));
      const preview = [row.preview || '', '[图片]', '[视频]'][row.type] || '';
      if (preview) words.append(node('small', '', preview));
      item.append(avatar(row.uid), words);
      return item;
    }

    function renderThreads() {
      const scrollTop = entries.scrollTop;
      entries.replaceChildren();
      const displayed = [...threads];
      if (peer && currentName && !displayed.some(row => row.uid === peer)) {
        displayed.unshift({ uid: peer, name: currentName });
      }
      const pinnedRows = displayed.filter(row => readChatPrefs(row.uid).pin);
      const restRows = displayed.filter(row => !readChatPrefs(row.uid).pin);
      entries.append(...pinnedRows.map(threadItem));
      entries.append(...restRows.map(threadItem));
      if (!displayed.length) entries.append(empty('暂无最近会话'));
      if (moreThreads) entries.append(button('加载更多会话', async event => {
        event.currentTarget.disabled = true;
        try { await loadThreads(); }
        catch (error) { status.textContent = error.message; renderThreads(); }
      }, 'mc-load'));
      entries.scrollTop = scrollTop;
    }

    async function loadThreads(reset = false) {
      if (loadingThreads) return;
      loadingThreads = true;
      try {
        const nextOffset = reset ? 0 : offset;
        const rows = await inbox('/threads?offset=' + nextOffset);
        if (!stillCurrent()) return;
        if (reset) threads.length = 0;
        threads.push(...rows.filter(row => !threads.some(existing => existing.uid === row.uid)));
        offset = nextOffset + rows.length;
        moreThreads = rows.length === 50;
        renderThreads();
      } finally {
        loadingThreads = false;
      }
    }

    await loadThreads();
    if (!peer) {
      main.append(empty('快找小伙伴聊天吧 ( ゜- ゜)つロ', 'chat'));
      const timer = setInterval(() => {
        if (!stillCurrent()) return clearInterval(timer);
        if (!document.hidden && offset <= 50) loadThreads(true).catch(() => {});
      }, 8000);
      return;
    }

    const heading = node('div', 'mc-chat-title');
    const back = link(url('chat'), '会话列表', 'mc-chat-back');
    const nameLink = link('/space/' + encodeURIComponent(peer), '');
    heading.append(back, nameLink);

    const menuWrap = node('div', 'mc-chat-menu');
    const menuBtn = node('button', 'mc-menu-btn');
    menuBtn.type = 'button';
    menuBtn.setAttribute('aria-label', '更多设置');
    menuBtn.append(icon('dots'));
    const dropdown = node('div', 'mc-menu-dropdown');
    dropdown.hidden = true;
    let prefs = readChatPrefs(peer);
    let blocked = false;
    const pinItem = node('button', 'mc-menu-item');
    const blockItem = node('button', 'mc-menu-item');
    const reportItem = node('button', 'mc-menu-item', '举报该用户');
    const pushItem = node('button', 'mc-menu-item');
    function refreshMenuLabels() {
      pinItem.textContent = prefs.pin ? '取消置顶' : '置顶聊天';
      blockItem.textContent = blocked ? '移出黑名单' : '加入黑名单';
      pushItem.textContent = prefs.noPush ? '接收推送' : '不接收推送';
    }
    const toggle = (key, value) => {
      prefs = { ...prefs, [key]: value };
      writeChatPrefs(peer, prefs);
      refreshMenuLabels();
      renderThreads();
    };
    pinItem.onclick = () => toggle('pin', !prefs.pin);
    pushItem.onclick = () => {
      if (prefs.noPush) toggle('noPush', false);
      else mcConfirm('确认关闭内容推送吗？', '关闭后，你将不再收到该账号的内容推送，但通知类消息不受影响', () => toggle('noPush', true));
    };
    const setBlock = async enabled => {
      const result = await interaction('/authors/' + encodeURIComponent(peer) + '/relation/block', 'PUT', { enabled });
      blocked = result.blocked;
      refreshMenuLabels();
      if (blocked) {
        localStorage.removeItem('mc:chat:' + peer);
        location.assign(url('chat'));
      }
    };
    blockItem.onclick = () => {
      if (blocked) setBlock(false).catch(error => { status.textContent = error.message; });
      else mcConfirm('加入黑名单', '加入黑名单后，将自动解除关注关系和对该用户的合集订阅关系，禁止该用户与我互动或查看我的空间', () => setBlock(true));
    };
    reportItem.onclick = () => reportAccount(peer, currentName);
    dropdown.append(pinItem, blockItem, reportItem, pushItem);
    dropdown.addEventListener('click', () => { dropdown.hidden = true; });
    menuBtn.onclick = event => { event.stopPropagation(); dropdown.hidden = !dropdown.hidden; };
    const closeMenu = event => {
      if (!menuWrap.isConnected) { document.removeEventListener('click', closeMenu); return; }
      if (!menuWrap.contains(event.target)) dropdown.hidden = true;
    };
    document.addEventListener('click', closeMenu);
    addEventListener('pagehide', () => document.removeEventListener('click', closeMenu), { once: true });
    menuWrap.append(menuBtn, dropdown);
    heading.append(menuWrap);
    refreshMenuLabels();
    interaction('/authors/' + encodeURIComponent(peer) + '/relation')
      .then(result => { blocked = result.blocked; refreshMenuLabels(); })
      .catch(() => {});
    const history = node('div', 'mc-history');
    history.addEventListener('scroll', closeMessageMenu, { passive: true });
    const older = button('加载更早消息', loadOlder, 'mc-load');
    const bubbles = node('div', 'mc-bubbles');
    const note = node('p', 'mc-chat-note');
    note.hidden = true;
    history.append(older, bubbles, note);
    const form = node('form', 'mc-composer');
    const toolbar = node('div', 'mc-compose-tools');
    const text = node('textarea');
    text.placeholder = '请输入消息内容';
    text.setAttribute('aria-label', '私信内容');
    const file = node('input');
    file.type = 'file';
    file.accept = 'image/png,image/jpeg,image/gif';
    file.hidden = true;
    const picture = button('', () => file.click(), 'mc-tool mc-icon-tool');
    picture.setAttribute('aria-label', '发送图片');
    picture.append(icon('image'));
    const faces = node('div', 'mc-emoji');
    faces.hidden = true;
    const emoji = button('', () => {
      faces.hidden = !faces.hidden;
      emoji.setAttribute('aria-expanded', String(!faces.hidden));
    }, 'mc-tool mc-icon-tool');
    emoji.setAttribute('aria-label', '表情');
    emoji.append(icon('emoji'));
    emoji.setAttribute('aria-expanded', 'false');
    for (const face of ['😀', '😂', '🥰', '😮', '😢', '👍', '🎉', '❤️']) {
      faces.append(button(face, () => {
        text.setRangeText(face, text.selectionStart, text.selectionEnd, 'end');
        faces.hidden = true;
        emoji.setAttribute('aria-expanded', 'false');
        updateComposer();
        text.focus();
      }, 'mc-tool'));
    }
    toolbar.append(picture, emoji, file, faces);
    const count = node('output', 'mc-count');
    const send = node('button', 'mc-primary', '发送');
    send.type = 'submit';
    const actions = node('div', 'mc-compose-actions');
    actions.append(count, send);
    form.append(toolbar, text, actions);
    main.append(heading, history, form);
    const toast = node('p', 'mc-toast');
    toast.hidden = true;
    main.append(toast);
    let toastTimer;
    function notice(message) {
      clearTimeout(toastTimer);
      toast.textContent = message;
      toast.hidden = false;
      toastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
    }
    let issue = '';
    let canSend = true;
    let busy = false;
    let latestIds;
    let loadedPages = 1;
    let historyVersion = 0;
    let loadingOlder = false;
    let updatingMessage = false;
    let oldest;
    let hasMore;
    let polling = false;
    const recalls = [];

    function chatTime(iso) {
      if (!iso) return '';
      const [date, time = ''] = String(iso).split('T');
      const clock = time.slice(0, 5);
      const [year, month, day] = date.split('-').map(Number);
      const today = new Date();
      const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(year, month - 1, day)) / 86400000);
      if (days === 0) return '今天 ' + clock;
      if (days === 1) return '昨天 ' + clock;
      return date + ' ' + clock;
    }

    function recallRow(sentAt) {
      const entry = node('div', 'mc-recall');
      entry.dataset.sentAt = sentAt;
      entry.append(node('time', '', chatTime(sentAt)), node('span', '', '你撤回了一条消息'));
      return entry;
    }

    function updateNote() {
      note.textContent = canSend ? '' : issue || (bubbles.querySelector('.mc-mine') ? '对方主动回复或关注你前，最多发送 1 条消息' : '');
      note.hidden = !note.textContent;
    }

    function updateComposer() {
      const length = [...text.value].length;
      count.textContent = length + '/500';
      text.disabled = picture.disabled = emoji.disabled = Boolean(!canSend || busy);
      send.disabled = Boolean(!canSend || busy || length > 500 || !text.value.trim());
    }

    function videoCard(row) {
      const id = encodeURIComponent(row.videoId);
      const card = link('/video/' + id, '', 'mc-video');
      const cover = node('img', 'mc-video-cover');
      cover.alt = '';
      cover.loading = 'lazy';
      const play = node('span', 'mc-video-play');
      play.append(icon('video-play'));
      const author = node('div', 'mc-video-author');
      if (row.authorId) author.append(avatar(row.authorId));
      author.append(node('span', '', row.author || '未知UP主'));
      card.append(cover, play, author);
      attachCover(cover, '/api/videos/' + id + '/cover', '暂无封面');
      return card;
    }

    function bubble(row) {
      const mine = row.sender === currentAccount?.uid;
      const entry = node('div', mine ? 'mc-message mc-mine' : 'mc-message');
      const body = node('div', 'mc-message-body');
      if (row.type === 1) {
        const image = node('img', 'mc-image');
        image.src = '/api/message-center/images/' + row.id;
        image.alt = '私信图片';
        image.onerror = () => image.replaceWith(node('span', '', '图片无法加载'));
        image.onclick = () => zoomImage(image.src);
        body.append(image);
      } else if (row.type === 2) {
        if (row.videoId) body.append(videoCard(row));
        else body.textContent = '转发的视频已不可用';
      } else body.textContent = row.text;
      const menu = node('div', 'mc-msg-menu');
      menu.hidden = true;
      if (!mine) menu.append(button('举报', () => reportInteraction('message', row.id, () => loadLatest(true).catch(() => {})), 'mc-msg-action'));
      menu.append(button('删除', () => mcConfirm('提示', '消息删除后不再显示在聊天记录里，确认删除吗？', () => changeMessage(row.id, false), '确认'), 'mc-msg-action'));
      if (mine) menu.append(button('撤回', () => changeMessage(row.id, true), 'mc-msg-action'));
      body.append(menu);
      body.oncontextmenu = event => {
        event.preventDefault();
        closeMessageMenu();
        menu.hidden = false;
        openMenu = menu;
        const box = body.getBoundingClientRect();
        const below = box.bottom + menu.offsetHeight + 4 <= innerHeight;
        menu.style.top = Math.max(4, below ? box.bottom + 4 : box.top - menu.offsetHeight - 4) + 'px';
        menu.style.left = mine ? Math.min(box.left, innerWidth - menu.offsetWidth - 8) + 'px' : 'auto';
        menu.style.right = mine ? 'auto' : Math.min(innerWidth - box.right, innerWidth - menu.offsetWidth - 8) + 'px';
      };
      const detail = node('div', 'mc-message-detail');
      entry.dataset.messageId = row.id;
      entry.dataset.sentAt = row.sentAt;
      detail.append(body);
      entry.append(node('time', '', chatTime(row.sentAt)), avatar(row.sender), detail);
      return entry;
    }

    async function loadOlder(event) {
      if (loadingOlder) return;
      loadingOlder = true;
      const version = ++historyVersion;
      event.currentTarget.disabled = true;
      try {
        const previousHeight = history.scrollHeight;
        const olderPage = await inbox(threadPath + '?before=' + oldest);
        if (!stillCurrent() || version !== historyVersion) return;
        const ordered = [...olderPage.messages].reverse();
        bubbles.prepend(...ordered.map(bubble));
        loadedPages++;
        latestIds = Array.from(bubbles.children, entry => entry.dataset.messageId).filter(Boolean).reverse().join(',');
        oldest = ordered[0]?.id || oldest;
        hasMore = olderPage.hasMore;
        older.hidden = !hasMore;
        history.scrollTop += history.scrollHeight - previousHeight;
      } catch (error) { status.textContent = error.message; }
      finally { loadingOlder = false; older.disabled = false; }
    }

    async function loadLatest(force = false) {
      if (loadingOlder && !force) return;
      const version = ++historyVersion;
      const result = await inbox(threadPath);
      const messages = [...result.messages];
      let more = result.hasMore;
      for (let page = 1; page < loadedPages && more && messages.length; page++) {
        if (!stillCurrent() || version !== historyVersion) return;
        const olderPage = await inbox(threadPath + '?before=' + messages.at(-1).id);
        messages.push(...olderPage.messages);
        more = olderPage.hasMore;
      }
      if (!stillCurrent() || version !== historyVersion) return;
      currentName = result.name;
      nameLink.textContent = result.name;
      issue = result.issue;
      canSend = result.canSend;
      updateComposer();
      const ids = messages.map(row => row.id).join(',');
      if (force || ids !== latestIds) {
        const currentTop = history.scrollTop;
        const showLatest = latestIds === undefined || ids.split(',')[0] !== latestIds.split(',')[0];
        const ordered = messages.reverse();
        const nodes = ordered.map(bubble);
        for (const recall of recalls) {
          const at = nodes.findIndex(entry => Date.parse(entry.dataset.sentAt) > Date.parse(recall.sentAt));
          const row = recallRow(recall.sentAt);
          if (at < 0) nodes.push(row); else nodes.splice(at, 0, row);
        }
        bubbles.replaceChildren(...nodes);
        oldest = ordered[0]?.id;
        hasMore = more;
        older.hidden = !hasMore;
        latestIds = ids;
        history.scrollTop = currentTop;
        if (showLatest) {
          history.scrollTop = history.scrollHeight;
          for (const image of bubbles.querySelectorAll('img')) {
            if (!image.complete) image.addEventListener('load', () => { history.scrollTop = history.scrollHeight; }, { once: true });
          }
        }
        await loadThreads(true);
      }
      updateNote();
    }

    async function changeMessage(id, recall) {
      if (updatingMessage || !stillCurrent()) return;
      updatingMessage = true;
      status.textContent = '';
      try {
        await inbox('/messages/' + encodeURIComponent(id) + (recall ? '/recall' : ''), 'DELETE');
        if (recall) {
          const entry = bubbles.querySelector('[data-message-id="' + id + '"]');
          recalls.push({ sentAt: entry?.dataset.sentAt || new Date().toISOString() });
          notice('撤回成功');
        }
        await loadLatest(true);
      } catch (error) {
        if (recall) notice(error.message);
        else status.textContent = error.message;
      } finally { updatingMessage = false; }
    }

    async function sendMessage(action, sent) {
      if (busy || !canSend || !stillCurrent()) return;
      busy = true;
      status.textContent = '';
      updateComposer();
      try {
        await action();
        if (!stillCurrent()) return;
        sent();
        await loadLatest(true);
      } catch (error) {
        status.textContent = error.message;
        await loadLatest().catch(() => {});
      } finally {
        busy = false;
        updateComposer();
      }
    }

    text.oninput = updateComposer;
    form.onsubmit = event => {
      event.preventDefault();
      if (send.disabled) return;
      sendMessage(() => interaction('/authors/' + encodeURIComponent(peer) + '/messages', 'POST', { value: text.value }),
        () => { text.value = ''; });
    };
    text.onkeydown = event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        form.requestSubmit();
      }
    };
    file.onchange = () => {
      const image = file.files[0];
      if (!image) return;
      file.value = '';
      if (image.size > 4 * 1024 * 1024) {
        status.textContent = '图片大小不能超过 4 MB';
        return;
      }
      const data = new FormData();
      data.append('image', image);
      sendMessage(async () => {
        const token = (await authApi('csrf')).token;
        const response = await fetch('/api/interactions/authors/' + encodeURIComponent(peer) + '/messages/image', {
          method: 'POST', headers: { 'X-CSRF-Token': token }, body: data
        });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.message || '发送图片失败');
        }
      }, () => {});
    };

    updateComposer();
    await loadLatest(true);
    const timer = setInterval(async () => {
      if (!stillCurrent()) return clearInterval(timer);
      if (document.hidden || busy || polling) return;
      polling = true;
      try { await loadLatest(); } catch {} finally { polling = false; }
    }, 8000);
  }

  async function notifications(section, status, stillCurrent) {
    section.classList.add('mc-notification-content');
    const list = node('div', tab === 'system' ? 'mc-system-list' : 'mc-event-list');
    const next = button('加载更多', loadNext, 'mc-load');
    let offset = 0;
    section.append(list, next);

    function eventRow(event) {
      const item = node('article', tab === 'system' ? 'mc-system' : 'mc-event');
      const heading = node('div', 'mc-event-heading');
      if (tab === 'system') {
        heading.append(node('strong', '', '系统通知'), node('time', '', chatTime(event.sentAt)));
        item.append(heading, node('p', 'mc-event-body', event.body));
        return item;
      }
      const profile = link('/space/' + event.actor, event.name || '账号已注销');
      const actor = link('/space/' + event.actor);
      actor.setAttribute('aria-label', event.name || '账号已注销');
      actor.append(avatar(event.actor));
      const body = node('div', 'mc-event-main');
      const kind = { video: '视频', danmaku: '弹幕', comment: '评论', reply: '回复' };
      const desc = tab === 'likes' ? '赞了我的' + kind[event.kind] :
        tab === 'mentions' ? '在' + kind[event.kind] + '中提到了我' : '回复了我的评论';
      heading.append(profile, node('span', '', desc));
      body.append(heading);
      if (event.body) body.append(node('p', 'mc-event-body', event.body));
      const actions = node('div', 'mc-event-actions');
      actions.append(node('time', '', chatTime(event.sentAt)));
      body.append(actions);
      if (tab !== 'likes') {
        const reply = button('回复', () => { form.hidden = !form.hidden; if (!form.hidden) input.focus(); }, 'mc-text-button');
        const form = node('form', 'mc-inline-reply');
        form.hidden = true;
        const input = node('textarea');
        input.required = true;
        input.maxLength = 1000;
        input.setAttribute('aria-label', '回复内容');
        const submit = node('button', 'mc-primary', '发送回复');
        form.append(input, submit);
        form.onsubmit = async action => {
          action.preventDefault();
          if (submit.disabled) return;
          submit.disabled = true;
          try {
            await interaction('/replies/' + event.kind + '/' + event.target, 'POST', { value: input.value });
            input.value = '';
            form.hidden = true;
            status.textContent = '回复已发送';
          } catch (error) { status.textContent = error.message; }
          finally { submit.disabled = false; }
        };
        const like = button(event.liked ? '已点赞' : '点赞', async () => {
          like.disabled = true;
          try {
            const result = await interaction('/likes/' + event.kind + '/' + event.target, 'PUT', { enabled: !event.liked });
            event.liked = result.enabled;
            like.textContent = event.liked ? '已点赞' : '点赞';
            pressInteraction(like, event.liked);
          } catch (error) { status.textContent = error.message; }
          finally { like.disabled = false; }
        }, 'mc-text-button');
        pressInteraction(like, event.liked);
        actions.append(reply, like);
        body.append(form);
      }
      item.append(actor, body, link('/video/' + event.video, event.context || '查看原内容', 'mc-context'));
      return item;
    }

    async function loadNext() {
      next.disabled = true;
      try {
        const events = await inbox('/events/' + tab + '?offset=' + offset);
        if (!stillCurrent()) return;
        offset += events.length;
        list.append(...events.map(eventRow));
        if (!offset) list.append(empty('暂无' + tabs[tab], 'notice'));
        next.hidden = events.length < 40;
      } catch (error) { status.textContent = error.message; }
      finally { next.disabled = false; }
    }
    await loadNext();
  }

  let loginVersion = 0;
  async function renderCenter(smooth = false) {
    if (path !== '/messages') return;
    const version = ++loginVersion;
    const stillCurrent = () => version === loginVersion;
    const currentFrame = root.querySelector('.mc-chat');
    const threadScroll = currentFrame?.querySelector('.mc-thread-list')?.scrollTop || 0;
    const replaceFrame = nextFrame => {
      const nextThreads = nextFrame.querySelector('.mc-thread-list');
      currentFrame.replaceWith(nextFrame);
      if (nextThreads) nextThreads.scrollTop = threadScroll;
    };
    if (smooth && tab === 'chat' && currentAccount && currentFrame) {
      const status = root.querySelector('.mc-status');
      status.textContent = '';
      const section = node('div');
      currentFrame.setAttribute('aria-busy', 'true');
      try {
        await chat(section, status, stillCurrent);
        if (stillCurrent()) replaceFrame(section.querySelector('.mc-chat'));
      } catch (error) {
        if (stillCurrent()) {
          status.textContent = error.message;
          const nextFrame = section.querySelector('.mc-chat');
          if (nextFrame) {
            const conversation = nextFrame.querySelector('.mc-conversation');
            const failure = empty('消息加载失败，请重试');
            failure.append(button('重试', () => renderCenter(true), 'mc-primary mc-retry'));
            conversation.replaceChildren(failure);
            replaceFrame(nextFrame);
          }
        }
      } finally {
        if (stillCurrent()) root.querySelector('.mc-chat')?.removeAttribute('aria-busy');
      }
      return;
    }
    const aside = node('nav', 'mc-sidebar');
    aside.setAttribute('aria-label', '消息类型');
    const brand = node('div', 'mc-brand');
    brand.append(icon('plane'), node('span', '', '消息中心'));
    aside.append(brand);
    for (const [key, label] of Object.entries(tabs)) {
      const item = link(url(key), label);
      if (key === tab) item.setAttribute('aria-current', 'page');
      aside.append(item);
    }
    const panel = node('div', 'mc-panel');
    const header = node('div', 'mc-header');
    const status = node('p', 'mc-status');
    status.setAttribute('role', 'status');
    header.append(node('h1', '', tabs[tab]), status);
    const section = node('div', 'mc-content');
    panel.append(header, section);
    root.replaceChildren(aside, panel);
    if (!currentAccount) {
      const signedOut = empty('登录后查看你的消息', 'notice');
      signedOut.append(button('登录', event => openLogin(event.currentTarget), 'mc-primary'));
      section.append(signedOut);
      return;
    }
    try {
      if (tab === 'chat') await chat(section, status, stillCurrent);
      else await notifications(section, status, stillCurrent);
    } catch (error) { status.textContent = error.message; }
  }

  root.addEventListener('click', event => {
    const anchor = event.target.closest('a[href]');
    if (!anchor || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = new URL(anchor.href, location.href);
    if (target.origin !== location.origin || target.pathname !== '/messages' || tab !== 'chat') return;
    if (new URLSearchParams(target.search).get('tab') !== 'chat') return;
    event.preventDefault();
    if (target.href !== location.href) history.pushState(null, '', target.href);
    syncRoute();
    renderCenter(true);
  });
  window.addEventListener('popstate', () => {
    syncRoute();
    renderCenter(true);
  });
  window.addEventListener('accountchange', () => renderCenter());
  if (path === '/messages') renderCenter();
})();

