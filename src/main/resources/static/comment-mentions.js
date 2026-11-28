function appendCommentText(target, value, tags, makeTag) {
  let offset = 0;
  for (const tag of tags) {
    if (tag.start < offset || tag.end <= tag.start || tag.end > value.length) continue;
    target.append(value.slice(offset, tag.start), makeTag(value.slice(tag.start, tag.end), tag));
    offset = tag.end;
  }
  target.append(value.slice(offset));
}

function commentMentionAvatar(uid) {
  const img = node('img');
  img.alt = '';
  img.src = '/api/authors/' + encodeURIComponent(uid) + '/avatar';
  img.onerror = () => { img.onerror = null; img.src = '/assets/guest-avatar.gif'; };
  return img;
}

function setupCommentTools(form, input, updateSend, signal) {
  const listen = (target, name, fn, options = {}) => target.addEventListener(name, fn, { ...options, signal });
  const highlight = form.querySelector('.comment-mention-highlight');
  const emojiPicker = form.querySelector('.comment-emoji-picker'), emojiToggle = form.querySelector('.comment-emoji-toggle');
  const picker = form.querySelector('.comment-mention-picker'), mentionToggle = form.querySelector('.comment-mention-toggle');
  let tags = [], value = input.value, active, version = 0, timer;
  emojiPicker.replaceChildren();
  signal?.addEventListener('abort', close, { once: true });

  function setOpen(button, panel, open) {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  }

  function closeMention() {
    clearTimeout(timer);
    version++;
    active = undefined;
    setOpen(mentionToggle, picker, false);
  }

  function close() {
    closeMention();
    setOpen(emojiToggle, emojiPicker, false);
  }

  function syncScroll() {
    highlight.scrollTop = input.scrollTop;
    highlight.scrollLeft = input.scrollLeft;
  }

  function render() {
    input.classList.toggle('has-mentions', tags.length > 0);
    highlight.replaceChildren();
    if (tags.length) {
      appendCommentText(highlight, value, tags, text => node('span', 'comment-mention-text', text));
      if (value.endsWith('\n')) highlight.append('\u200b');
      syncScroll();
    }
    updateSend();
  }

  function moveTags(start, end, addedLength) {
    const shift = addedLength - (end - start);
    tags = tags.filter(tag => tag.end <= start || tag.start >= end).map(tag =>
      tag.start < end ? tag : { ...tag, start: tag.start + shift, end: tag.end + shift });
  }

  function replace(start, end, text, uid) {
    if (value.length + text.length - (end - start) > input.maxLength) {
      accountNotice('评论最多可输入 ' + input.maxLength + ' 个字符');
      return false;
    }
    moveTags(start, end, text.length);
    input.setRangeText(text, start, end, 'end');
    value = input.value;
    if (uid) {
      tags.push({ uid, start, end: start + text.length - 1 });
      tags.sort((a, b) => a.start - b.start);
    }
    input.focus();
    render();
    return true;
  }

  function syncInput() {
    const next = input.value;
    if (value === next) return;
    let start = 0, end = value.length, newEnd = next.length;
    const caret = input.selectionStart;
    while (start < caret && start < end && value[start] === next[start]) start++;
    while (end > start && newEnd > start && value[end - 1] === next[newEnd - 1]) { end--; newEnd--; }
    moveTags(start, end, newEnd - start);
    value = next;
    render();
  }

  function currentQuery() {
    if (input.selectionStart !== input.selectionEnd) return;
    const end = input.selectionStart;
    const match = /[@＠]([^@＠\r\n]{0,80})$/u.exec(value.slice(0, end));
    if (match && !tags.some(tag => tag.start === match.index)) {
      return { start: match.index, end, keyword: match[1].trim() };
    }
  }

  function highlightKeyword(name, keyword) {
    const label = node('span');
    const match = keyword ? name.toLowerCase().indexOf(keyword.toLowerCase()) : -1;
    if (match < 0) label.textContent = name;
    else label.append(name.slice(0, match), node('span', 'comment-mention-text', name.slice(match, match + keyword.length)),
      name.slice(match + keyword.length));
    return label;
  }

  async function load(query, request, results, offset = 0) {
    try {
      const users = await interaction('/comment-mention-users?' + new URLSearchParams({ q: query.keyword, offset }));
      if (signal?.aborted || request !== version) return;
      if (!offset) results.replaceChildren();
      if (!users.length && !offset) results.append(node('p', 'comment-mention-empty', query.keyword ? '没有匹配的用户' : '暂无关注'));
      for (const user of users) {
        if (!results.querySelector('[data-group="' + user.followed + '"]')) {
          const heading = node('p', 'comment-mention-group', user.followed ? '我的关注' : '其他');
          heading.dataset.group = String(user.followed);
          results.append(heading);
        }
        const item = node('button', 'comment-mention-option');
        item.type = 'button';
        const label = node('span', 'comment-mention-option-label');
        label.append(highlightKeyword(user.name, query.keyword), node('small', '', shortCount(user.followers) + ' 粉丝'));
        item.append(commentMentionAvatar(user.uid), label);
        item.onmousedown = event => event.preventDefault();
        item.onclick = () => {
          if (active !== query) return;
          if (replace(query.start, query.end, '@' + user.name + ' ', user.uid)) closeMention();
        };
        results.append(item);
      }
      if (users.length === 24) {
        const more = node('button', 'comment-mention-more', '加载更多');
        more.type = 'button';
        more.onclick = () => { more.remove(); load(query, request, results, offset + users.length); };
        results.append(more);
      }
    } catch (error) {
      if (signal?.aborted || request !== version) return;
      const retry = node('button', 'comment-mention-more', '加载失败，重试');
      retry.type = 'button';
      retry.onclick = () => { retry.remove(); load(query, request, results, offset); };
      if (!offset) results.replaceChildren();
      results.append(retry);
    }
  }

  function showQuery() {
    const query = currentQuery();
    if (!query) { closeMention(); return; }
    if (active?.start === query.start && active.end === query.end && active.keyword === query.keyword) return;
    active = query;
    clearTimeout(timer);
    const request = ++version;
    setOpen(emojiToggle, emojiPicker, false);
    setOpen(mentionToggle, picker, true);
    const results = node('div', 'comment-mention-results');
    results.append(node('p', 'comment-mention-empty', '正在加载…'));
    picker.replaceChildren(node('p', 'comment-mention-heading', '选择或输入你想@的人'), results);
    timer = setTimeout(() => load(query, request, results), query.keyword ? 140 : 0);
  }

  listen(input, 'input', event => { syncInput(); if (!event.isComposing) showQuery(); });
  listen(input, 'compositionend', showQuery);
  listen(input, 'scroll', syncScroll);
  listen(input, 'click', () => { if (active) showQuery(); });
  listen(input, 'keyup', event => { if (active && event.key.startsWith('Arrow')) showQuery(); });
  mentionToggle.onclick = () => {
    if (active) { closeMention(); input.focus(); return; }
    if (currentQuery() || replace(input.selectionStart, input.selectionEnd, '@')) showQuery();
  };
  emojiToggle.onclick = () => {
    const open = emojiPicker.hidden;
    closeMention();
    setOpen(emojiToggle, emojiPicker, open);
  };
  for (const face of MESSAGE_EMOJI) {
    const option = node('button', '', face);
    option.type = 'button';
    option.onclick = () => {
      if (replace(input.selectionStart, input.selectionEnd, face)) setOpen(emojiToggle, emojiPicker, false);
    };
    emojiPicker.append(option);
  }
  listen(document, 'pointerdown', event => { if (!form.contains(event.target)) close(); });
  listen(form, 'keydown', event => {
    if (event.key === 'Escape' && (active || !emojiPicker.hidden)) { close(); input.focus(); }
  });
  return {
    close,
    reset() { close(); tags = []; value = input.value; render(); },
    tagsForTrimmedText() {
      const start = value.length - value.trimStart().length;
      const end = value.trimEnd().length;
      return tags.filter(tag => tag.start >= start && tag.end <= end)
        .map(tag => ({ ...tag, start: tag.start - start, end: tag.end - start }));
    }
  };
}

function setupCommentMentionCards({ onFollowChange, preferAbove = false, signal } = {}) {
  const listen = (target, name, fn, options = {}) => target.addEventListener(name, fn, { ...options, signal });
  const card = node('aside', 'comment-mention-card');
  card.setAttribute('aria-label', '用户资料');
  card.hidden = true;
  document.body.append(card);
  signal?.addEventListener('abort', () => { hide(); card.remove(); }, { once: true });
  let current, hideTimer;
  const profiles = new Map();

  function hide() {
    clearTimeout(hideTimer);
    card.hidden = true;
    current = undefined;
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!card.matches(':hover') && !card.contains(document.activeElement)
          && current && !current.matches(':hover') && document.activeElement !== current) hide();
    }, 180);
  }

  function place(anchor) {
    const rect = anchor.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    card.style.left = Math.max(8, Math.min(rect.left, width - card.offsetWidth - 8)) + 'px';
    const height = card.offsetHeight;
    const below = rect.bottom + 6;
    const above = rect.top - height - 6;
    const fitsBelow = below + height <= window.innerHeight - 8;
    const useAbove = (preferAbove && above >= 8) || !fitsBelow;
    card.style.top = Math.max(8, useAbove ? above : below) + 'px';
  }

  async function show(anchor, uid) {
    clearTimeout(hideTimer);
    if (current === anchor) return;
    current = anchor;
    card.replaceChildren(node('p', 'comment-mention-empty', '正在加载用户资料…'));
    card.hidden = false;
    place(anchor);
    const encoded = encodeURIComponent(uid);
    try {
      if (!profiles.has(uid)) profiles.set(uid, interaction('/comment-mention-users/' + encoded).catch(error => {
        profiles.delete(uid);
        throw error;
      }));
      const resource = '/authors/' + encoded + '/relation';
      const [profile, relation] = await Promise.all([profiles.get(uid),
        currentAccount ? interaction(resource).catch(() => null) : null]);
      if (current !== anchor || !anchor.isConnected) return;
      const { author, likes } = profile;
      const banner = node('img', 'comment-mention-banner');
      banner.alt = '';
      banner.src = '/assets/space-cover.png';
      const details = node('div', 'comment-mention-profile');
      const avatar = link(anchor.href, '', 'comment-mention-profile-avatar');
      avatar.append(commentMentionAvatar(uid));
      const info = node('div', 'comment-mention-profile-info');
      const heading = node('div', 'comment-mention-profile-heading');
      heading.append(link(anchor.href, author.name), node('span', 'comment-level', author.level));
      const stats = node('div', 'comment-mention-stats');
      for (const [count, label] of [[author.following, '关注'], [relation?.followers ?? author.followers, '粉丝'], [likes, '获赞']]) {
        const item = node('span');
        item.append(node('strong', '', shortCount(count)), ' ' + label);
        stats.append(item);
      }
      info.append(heading, stats);
      if (author.signature) info.append(node('p', 'comment-mention-signature', author.signature));
      if (currentAccount?.uid !== uid) {
        const actions = node('div', 'comment-mention-profile-actions');
        const follow = node('button', 'comment-mention-follow');
        follow.type = 'button';
        let followed = relation?.following ?? false;
        const updateFollow = () => {
          follow.textContent = followed ? '已关注' : '+ 关注';
          follow.setAttribute('aria-pressed', String(followed));
        };
        memberAction(follow, async () => {
          const state = await interaction(resource);
          const result = await interaction(resource + '/follow', 'PUT', { enabled: !state.following });
          followed = result.following;
          stats.children[1].querySelector('strong').textContent = shortCount(result.followers);
          updateFollow();
          onFollowChange?.(uid, result);
        });
        updateFollow();
        const message = node('button', '', '发消息');
        message.type = 'button';
        memberAction(message, () => location.assign('/messages?' + new URLSearchParams({ uid })));
        actions.append(follow, message);
        info.append(actions);
      }
      details.append(avatar, info);
      card.replaceChildren(banner, details);
      place(anchor);
    } catch {
      if (current === anchor) card.replaceChildren(node('p', 'comment-mention-empty', '用户资料暂不可用'));
    }
  }

  listen(card, 'pointerenter', () => clearTimeout(hideTimer));
  listen(card, 'pointerleave', scheduleHide);
  listen(card, 'focusout', scheduleHide);
  listen(document, 'keydown', event => { if (event.key === 'Escape') hide(); });
  listen(window, 'scroll', hide, { passive: true });
  listen(window, 'resize', hide);
  listen(window, 'accountchange', hide);
  function bind(anchor, uid) {
    listen(anchor, 'pointerenter', () => show(anchor, uid));
    listen(anchor, 'pointerleave', scheduleHide);
    listen(anchor, 'focus', () => show(anchor, uid));
    listen(anchor, 'blur', scheduleHide);
  }

  function render(target, text = '', tags = []) {
    appendCommentText(target, text || '', tags, (label, tag) => {
      const anchor = link('/space/' + encodeURIComponent(tag.uid), label, 'comment-mention-text');
      bind(anchor, tag.uid);
      return anchor;
    });
  }
  return { bind, render, hide };
}
