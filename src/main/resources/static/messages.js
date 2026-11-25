(() => {
  const root = el('message-center');
  const navButton = document.querySelector('[data-interaction=messages]');
  const tabs = { chat: '我的消息', replies: '回复我的', mentions: '@ 我的', likes: '收到的赞',
    system: '系统通知', settings: '消息设置' };
  const tab = Object.hasOwn(tabs, params.get('tab')) ? params.get('tab') : 'chat';
  const peer = params.get('uid');
  const folder = params.get('folder') === 'strangers';
  const url = (key, extra = {}) => '/messages?' + new URLSearchParams({ tab: key, ...extra });
  const button = (label, action, css = 'mc-button') => {
    const element = node('button', css, label);
    element.type = 'button';
    element.onclick = action;
    return element;
  };

  function readChatPrefs(uid) {
    try { return JSON.parse(localStorage.getItem('mc:chat:' + uid)) || {}; } catch { return {}; }
  }
  function writeChatPrefs(uid, prefs) {
    localStorage.setItem('mc:chat:' + uid, JSON.stringify(prefs));
  }

  function mcDialog(title, build) {
    const dialog = node('dialog', 'mc-dialog');
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

  function mcConfirm(title, text, action) {
    mcDialog(title, (content, actions, status, close) => {
      content.append(node('p', 'mc-dialog-text', text));
      const cancel = button('取消', close, 'mc-dialog-cancel');
      const ok = button('确定', async () => {
        ok.disabled = cancel.disabled = true;
        try { await action(); close(); }
        catch (error) { status.textContent = error.message; ok.disabled = cancel.disabled = false; }
      }, 'mc-dialog-ok');
      actions.append(cancel, ok);
    });
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

  function badge(host, count) {
    host.querySelector('.mc-badge')?.remove();
    if (count > 0) host.append(node('span', 'mc-badge', count > 99 ? '99+' : count));
  }

  async function refreshBadges() {
    const uid = currentAccount?.uid;
    if (!uid) {
      badge(navButton, 0);
      return;
    }
    try {
      const counts = await inbox('/unread');
      if (currentAccount?.uid !== uid) return;
      badge(navButton, Object.values(counts).reduce((total, value) => total + value, 0));
      document.querySelectorAll('[data-message-tab]').forEach(item => badge(item, counts[item.dataset.messageTab]));
    } catch {}
  }

  function avatar(uid) {
    const image = node('img', 'mc-avatar');
    image.alt = '';
    image.src = '/api/authors/' + encodeURIComponent(uid) + '/avatar';
    image.onerror = () => { image.onerror = null; image.src = '/assets/guest-avatar.gif'; };
    return image;
  }

  function empty(text) {
    const state = node('div', 'mc-empty');
    state.append(icon('mail'), node('p', '', text));
    return state;
  }

  async function chat(section, status, stillCurrent) {
    const frame = node('div', 'mc-chat');
    const list = node('div', 'mc-threads');
    const entries = node('div', 'mc-thread-list');
    const main = node('section', 'mc-conversation');
    if (peer) frame.classList.add('mc-thread-open');
    const bar = node('div', 'mc-threads-title');
    bar.append(folder ? link(url('chat'), '返回最近会话') : node('span', '', '最近会话'));
    list.append(bar, entries);
    frame.append(list, main);
    section.append(frame);
    const preferences = await inbox('/preferences');
    const threads = [];
    let moreThreads = true;
    let offset = 0;
    let currentName;
    let loadingThreads = false;
    const threadPath = '/threads/' + encodeURIComponent(peer);
    const threadLink = (uid, name) => link(url('chat', { ...(folder ? { folder: 'strangers' } : {}), uid }), name);

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
      if (prefs.mute) {
        const quiet = node('span', 'mc-quiet');
        quiet.append(icon('bell-off'));
        item.append(quiet);
      } else if (preferences.reminders) badge(item, row.unread);
      return item;
    }

    function renderThreads() {
      const unknown = threads.filter(row => !row.following);
      entries.replaceChildren();
      const displayed = threads.filter(row => folder ? !row.following : !preferences.foldStrangers || row.following);
      if (peer && currentName && !displayed.some(row => row.uid === peer)) {
        displayed.unshift({ uid: peer, name: currentName });
      }
      const pinnedRows = displayed.filter(row => readChatPrefs(row.uid).pin);
      const restRows = displayed.filter(row => !readChatPrefs(row.uid).pin);
      entries.append(...pinnedRows.map(threadItem));
      if (preferences.foldStrangers && !folder && unknown.length) {
        const group = link(url('chat', { folder: 'strangers' }), '', 'mc-strangers');
        group.append(icon('mail'), node('span', '', '未关注的人'));
        if (preferences.reminders) badge(group, unknown.reduce((total, row) => total + row.unread, 0));
        entries.append(group);
      }
      entries.append(...restRows.map(threadItem));
      if (!displayed.length) entries.append(empty(folder ? '暂无未关注人的会话' : '暂无最近会话'));
      if (moreThreads) entries.append(button('加载更多会话', async event => {
        event.currentTarget.disabled = true;
        try { await loadThreads(); }
        catch (error) { status.textContent = error.message; renderThreads(); }
      }, 'mc-load'));
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
      main.append(empty('选择一个会话，或从作者页发起私信'));
      const timer = setInterval(() => {
        if (!stillCurrent()) return clearInterval(timer);
        if (!document.hidden && offset <= 50) loadThreads(true).catch(() => {});
      }, 8000);
      return;
    }

    const heading = node('div', 'mc-chat-title');
    const back = link(url('chat', folder ? { folder: 'strangers' } : {}), '会话列表', 'mc-chat-back');
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
    const muteItem = node('button', 'mc-menu-item');
    const blockItem = node('button', 'mc-menu-item');
    const reportItem = node('button', 'mc-menu-item', '举报该用户');
    const pushItem = node('button', 'mc-menu-item');
    function refreshMenuLabels() {
      pinItem.textContent = prefs.pin ? '取消置顶' : '置顶聊天';
      muteItem.textContent = prefs.mute ? '关闭免打扰' : '开启免打扰';
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
    muteItem.onclick = () => toggle('mute', !prefs.mute);
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
    dropdown.append(pinItem, muteItem, blockItem, reportItem, pushItem);
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
    const picture = button('图片', () => file.click(), 'mc-tool');
    const faces = node('div', 'mc-emoji');
    faces.hidden = true;
    const emoji = button('表情', () => {
      faces.hidden = !faces.hidden;
      emoji.setAttribute('aria-expanded', String(!faces.hidden));
    }, 'mc-tool');
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
    let issue = '';
    let canSend = true;
    let busy = false;
    let newest;
    let oldest;
    let hasMore;
    let polling = false;

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
        body.append(image);
      } else if (row.type === 2) {
        if (row.videoId) body.append(videoCard(row));
        else body.textContent = '转发的视频已不可用';
      } else body.textContent = row.text;
      const detail = node('div', 'mc-message-detail');
      detail.append(node('time', '', formatTime(row.sentAt)), body);
      entry.append(avatar(row.sender), detail);
      return entry;
    }

    async function loadOlder(event) {
      event.currentTarget.disabled = true;
      try {
        const previousHeight = history.scrollHeight;
        const olderPage = await inbox(threadPath + '?before=' + oldest);
        if (!stillCurrent()) return;
        const ordered = [...olderPage.messages].reverse();
        bubbles.prepend(...ordered.map(bubble));
        oldest = ordered[0]?.id || oldest;
        hasMore = olderPage.hasMore;
        older.hidden = !hasMore;
        history.scrollTop += history.scrollHeight - previousHeight;
      } catch (error) { status.textContent = error.message; }
      finally { older.disabled = false; }
    }

    async function loadLatest(force = false) {
      const result = await inbox(threadPath);
      if (!stillCurrent()) return;
      currentName = result.name;
      nameLink.textContent = result.name;
      issue = result.issue;
      canSend = result.canSend;
      updateComposer();
      const latestId = result.messages[0]?.id;
      if (force || latestId !== newest || (result.messages.length === 0 && bubbles.children.length > 0)) {
        const ordered = [...result.messages].reverse();
        const index = ordered.findIndex(row => row.id === newest);
        if (index < 0 || force) {
          bubbles.replaceChildren(...ordered.map(bubble));
          oldest = ordered[0]?.id;
          hasMore = result.hasMore;
        } else {
          bubbles.append(...ordered.slice(index + 1).map(bubble));
        }
        older.hidden = !hasMore;
        newest = latestId;
        updateNote();
        history.scrollTop = history.scrollHeight;
        if (newest) await inbox(threadPath + '/read', 'PUT', { through: newest });
        await loadThreads(true);
      } else updateNote();
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
    const list = node('div', tab === 'system' ? 'mc-system-list' : 'mc-event-list');
    const next = button('加载更多', loadNext, 'mc-load');
    let offset = 0;
    section.append(list, next);

    function eventRow(event) {
      const item = node('article', tab === 'system' ? 'mc-system' : 'mc-event');
      const heading = node('div', 'mc-event-heading');
      if (tab === 'system') {
        heading.append(node('strong', '', '系统通知'), node('time', '', formatTime(event.sentAt)));
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
      actions.append(node('time', '', formatTime(event.sentAt)));
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
        actions.append(reply, like, button('删除该通知', async action => {
          const control = action.currentTarget;
          control.disabled = true;
          try {
            await inbox('/events/' + tab + '/state', 'PUT', { ids: [event.id], dismissed: true });
            item.remove();
            offset = Math.max(0, offset - 1);
            if (!list.children.length && next.hidden) list.append(empty('暂无' + tabs[tab]));
            refreshBadges();
          } catch (error) { status.textContent = error.message; control.disabled = false; }
        }, 'mc-text-button'));
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
        if (!offset) list.append(empty('暂无' + tabs[tab]));
        next.hidden = events.length < 40;
        const unread = events.filter(row => row.unread).map(row => row.id);
        if (unread.length) await inbox('/events/' + tab + '/state', 'PUT', { ids: unread, dismissed: false });
        refreshBadges();
      } catch (error) { status.textContent = error.message; }
      finally { next.disabled = false; }
    }
    await loadNext();
  }

  async function settings(section, status, stillCurrent) {
    let preferences = await inbox('/preferences');
    if (!stillCurrent()) return;
    const form = node('form', 'mc-settings');
    form.onsubmit = event => event.preventDefault();
    section.append(form);
    let saving = false;
    async function update(key, value) {
      if (saving) return;
      saving = true;
      form.querySelectorAll('button, input').forEach(control => { control.disabled = true; });
      try {
        preferences = await inbox('/preferences', 'PUT', { ...preferences, [key]: value });
        status.textContent = '设置已保存';
        refreshBadges();
      } catch (error) { status.textContent = error.message; }
      finally { saving = false; render(); }
    }

    const toggles = [[true, '开启'], [false, '关闭']];
    const audiences = [['all', '所有人'], ['following', '关注的人'], ['none', '不接收任何消息提醒']];
    function preference(key, title, description, choices = toggles) {
      const row = node('fieldset', 'mc-setting');
      row.append(node('legend', '', title));
      if (description) row.append(node('p', '', description));
      const options = node('div', 'mc-options');
      for (const [value, label] of choices) {
        const input = node('input');
        input.type = 'radio';
        input.name = key;
        input.checked = preferences[key] === value;
        input.onchange = () => update(key, value);
        const choice = node('label');
        choice.append(input, node('span', '', label));
        options.append(choice);
      }
      row.append(options);
      return row;
    }

    function keywords() {
      const row = node('fieldset', 'mc-setting');
      row.append(node('legend', '', '消息屏蔽词'), node('p', '', '包含屏蔽词的新消息将被自动拦截'));
      const words = node('div', 'mc-keywords');
      for (const word of preferences.keywords) {
        const tag = button(word + ' ×', () => update('keywords', preferences.keywords.filter(existing => existing !== word)), 'mc-keyword');
        tag.setAttribute('aria-label', '删除屏蔽词 ' + word);
        words.append(tag);
      }
      const editor = node('div', 'mc-options');
      const input = node('input', 'mc-keyword-input');
      input.setAttribute('aria-label', '屏蔽词');
      input.placeholder = '输入屏蔽词';
      input.maxLength = 60;
      const add = () => {
        const word = input.value.trim();
        if (word) update('keywords', [...new Set([...preferences.keywords, word])]);
      };
      input.onkeydown = event => {
        if (event.key === 'Enter' && !event.isComposing) {
          event.preventDefault();
          add();
        }
      };
      editor.append(input, button('添加屏蔽词', add));
      row.append(words, editor);
      return row;
    }

    function group(...rows) {
      const card = node('section', 'mc-setting-group');
      card.append(...rows);
      return card;
    }
    function render() {
      form.replaceChildren(
        group(preference('reminders', '消息提醒', '控制消息入口和各分类的未读提醒')),
        group(preference('smartFilter', '私信智能拦截', '自动拦截未关注账号发来的疑似骚扰或营销内容'), keywords()),
        group(preference('replyPolicy', '回复我的消息提醒', '选择哪些人的回复会触发提醒', audiences),
          preference('mentionPolicy', '@ 我的消息提醒', '选择哪些人的提及会触发提醒', audiences),
          preference('likeAlert', '收到的赞消息提醒')),
        group(preference('foldStrangers', '收起未关注人消息', '将未关注账号的会话放入单独列表'))
      );
    }
    render();
  }

  let loginVersion = 0;
  async function renderCenter() {
    if (path !== '/messages') return;
    const version = ++loginVersion;
    const stillCurrent = () => version === loginVersion;
    const aside = node('nav', 'mc-sidebar');
    aside.setAttribute('aria-label', '消息类型');
    const brand = node('div', 'mc-brand');
    brand.append(icon('plane'), node('span', '', '消息中心'));
    aside.append(brand);
    for (const [key, label] of Object.entries(tabs)) {
      const item = link(url(key), label);
      item.dataset.messageTab = key;
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
      const signedOut = empty('登录后查看你的消息');
      signedOut.append(button('登录', event => openLogin(event.currentTarget), 'mc-primary'));
      section.append(signedOut);
      return;
    }
    try {
      if (tab === 'chat') await chat(section, status, stillCurrent);
      else if (tab === 'settings') await settings(section, status, stillCurrent);
      else await notifications(section, status, stillCurrent);
    } catch (error) { status.textContent = error.message; }
    refreshBadges();
  }

  window.addEventListener('accountchange', () => renderCenter());
  window.refreshMessageBadges = refreshBadges;
  if (path === '/messages') renderCenter();
  setInterval(() => { if (!document.hidden) refreshBadges(); }, 25000);
})();

