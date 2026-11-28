let commentsAccountHook = null;
let commentsLifecycle;

async function setupWatchComments(videoId) {
  commentsLifecycle?.abort();
  const lifecycle = commentsLifecycle = new AbortController();
  const current = () => !lifecycle.signal.aborted;
  const listen = (target, name, fn) => target.addEventListener(name, fn, { signal: lifecycle.signal });
  const listenDocument = (name, fn) => document.addEventListener(name, fn, { signal: lifecycle.signal });
  const list = el('comment-list'), moreComments = el('comments-more');
  const endpoint = '/videos/' + encodeURIComponent(videoId) + '/comments';
  const mentionCards = setupCommentMentionCards({ signal: lifecycle.signal });
  const signedIn = () => typeof currentAccount !== 'undefined' && Boolean(currentAccount);
  let requestVersion = 0, sort = 'hot', page = 1, openMenu;
  function action(text, className, callback) {
    const button = node('button', className, text);
    button.type = 'button';
    if (typeof memberAction === 'function') memberAction(button, callback);
    else button.onclick = () => openLogin(button);
    return button;
  }
  function svg(name) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS(element.namespaceURI, 'use');
    use.setAttribute('href', '/assets/watch-icons.svg#' + name);
    element.setAttribute('aria-hidden', 'true');
    element.append(use);
    return element;
  }
  function avatar(entry) {
    const a = link('/space/' + encodeURIComponent(entry.userId), null, 'comment-avatar');
    const img = node('img');
    img.alt = entry.author;
    img.loading = 'lazy';
    img.src = '/api/authors/' + encodeURIComponent(entry.userId) + '/avatar';
    img.onerror = () => { img.hidden = true; a.textContent = entry.author.slice(0, 1); };
    a.append(img);
    mentionCards.bind(a, entry.userId);
    return a;
  }

  function closeMenu(restoreFocus = false) {
    if (!openMenu) return;
    const { popup, toggle } = openMenu;
    popup.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    openMenu = undefined;
    if (restoreFocus) toggle.focus();
  }

  listenDocument('pointerdown', event => {
    if (openMenu && !openMenu.root.contains(event.target)) closeMenu();
  });
  listen(list, 'keydown', event => {
    if (!current()) return;
    if (openMenu && event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
    }
  });

  function commentMenu(entry, kind, own) {
    const root = node('div', 'comment-menu');
    const toggle = node('button', 'comment-menu-toggle');
    const popup = node('div', 'comment-menu-popup');
    popup.hidden = true;
    toggle.type = 'button';
    toggle.setAttribute('aria-label', kind === 'reply' ? '回复选项' : '评论选项');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.append(svg('more'));
    toggle.onclick = () => {
      if (!signedIn()) return openLogin(toggle);
      const activate = openMenu?.root !== root;
      closeMenu();
      if (!activate) return;
      mentionCards.hide();
      popup.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      openMenu = { root, popup, toggle };
    };
    const option = (label, callback) => action(label, 'comment-menu-item', () => {
      closeMenu(true);
      return callback();
    });
    if (own) {
      popup.append(option('删除', async () => {
        if (!window.confirm(kind === 'reply' ? '确定删除这条回复？' : '确定删除这条评论？')) return;
        await interaction('/' + (kind === 'reply' ? 'replies' : 'comments') + '/' + encodeURIComponent(entry.id), 'DELETE');
        await load(sort);
      }));
    } else {
      popup.append(option('加入黑名单', () => confirmCommentBlock(entry)),
        option('举报', () => reportComment(entry, kind)));
    }
    root.append(toggle, popup);
    return root;
  }

  function moderationDialog(body, className) {
    const dialog = body.closest('dialog');
    dialog.classList.add(className);
    const closeButton = dialog.querySelector('.interaction-close');
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', '关闭');
    return { dialog, closeButton };
  }

  function moderationActions(close) {
    const actions = node('div', 'comment-moderation-actions');
    const cancel = node('button', 'comment-moderation-cancel', '取消');
    cancel.type = 'button';
    cancel.onclick = close;
    const confirm = node('button', 'comment-moderation-confirm', '确定');
    confirm.type = 'submit';
    actions.append(cancel, confirm);
    return { actions, cancel, confirm };
  }

  function hideModeratedComments(matches) {
    mentionCards.hide();
    for (const article of list.querySelectorAll('[data-comment-author]')) {
      if (matches(article.dataset)) article.remove();
    }
    return load(sort, 1, true);
  }

  function confirmCommentBlock(entry) {
    const viewer = currentAccount.uid;
    interactionPanel('拉黑用户', (body, status, close) => {
      const { dialog, closeButton } = moderationDialog(body, 'comment-block-dialog');
      const { actions, cancel, confirm } = moderationActions(close);
      const form = node('form');
      form.append(node('p', 'comment-block-explanation',
        '加入黑名单后，将解除你对该用户的关注和合集订阅，并隐藏该用户的评论和回复。'), actions);
      body.append(form);
      dialog.addEventListener('cancel', event => { if (confirm.disabled) event.preventDefault(); });
      form.onsubmit = async event => {
        event.preventDefault();
        if (confirm.disabled) return;
        if (currentAccount?.uid !== viewer) { close(); return; }
        confirm.disabled = cancel.disabled = closeButton.disabled = true;
        status.textContent = '';
        try {
          await interaction('/authors/' + encodeURIComponent(entry.userId) + '/relation/block', 'PUT', { enabled: true });
          close();
          if (currentAccount?.uid === viewer) {
            accountNotice('拉黑成功', 'comment-block');
            await hideModeratedComments(data => data.commentAuthor === entry.userId);
          }
        } catch (error) {
          status.textContent = error.message;
        } finally {
          confirm.disabled = cancel.disabled = closeButton.disabled = false;
        }
      };
    });
  }

  function reportComment(entry, kind) {
    const viewer = currentAccount.uid;
    interactionPanel('举报', async (body, status, close) => {
      const { dialog, closeButton } = moderationDialog(body, 'comment-report-dialog');
      const resource = '/reports/' + kind;
      const reasons = await interaction(resource + '/reasons');
      if (!dialog.open) return;
      if (!reasons.length) { status.textContent = '当前没有可选的举报原因'; return; }
      const form = node('form', 'comment-report-form');
      const choices = node('fieldset', 'comment-report-choices');
      choices.setAttribute('aria-label', '举报原因');
      const details = node('label', 'comment-report-details');
      const description = node('textarea');
      description.maxLength = 200;
      description.placeholder = '请描述具体违规内容，帮助审核人员判断';
      details.append(node('span', '', '详细描述（选填）'), description);
      const footer = node('div', 'comment-report-footer');
      const blockLabel = node('label', 'comment-report-block');
      const block = node('input', 'report-check');
      block.type = 'checkbox';
      block.checked = true;
      blockLabel.append(block, node('span', '', '拉黑 @' + entry.author));
      const { actions, cancel, confirm } = moderationActions(close);
      footer.append(blockLabel, actions);
      confirm.disabled = true;
      let selected, submitting = false;
      for (const reason of reasons) {
        const row = node('div', 'comment-report-row');
        const label = node('label', 'comment-report-reason');
        const radio = node('input', 'report-radio');
        radio.type = 'radio';
        radio.name = 'comment-report-reason';
        radio.value = reason.id;
        radio.onchange = () => {
          if (!radio.checked) return;
          selected = reason.id;
          confirm.disabled = false;
          status.textContent = '';
          row.append(details);
          details.scrollIntoView({ block: 'nearest' });
        };
        const name = reason.name === '引战不友善言论' ? '引战、不友善言论' : reason.name;
        label.append(node('span', '', name), radio);
        row.append(label);
        choices.append(row);
      }
      dialog.addEventListener('cancel', event => { if (submitting) event.preventDefault(); });
      form.append(choices, status, footer);
      body.append(form);
      form.onsubmit = async event => {
        event.preventDefault();
        if (!selected || submitting) return;
        if (currentAccount?.uid !== viewer) { close(); return; }
        submitting = choices.disabled = block.disabled = cancel.disabled = confirm.disabled = closeButton.disabled = true;
        const blockAuthor = block.checked;
        status.textContent = '';
        try {
          await interaction(resource + '/' + encodeURIComponent(entry.id), 'POST', {
            reason: selected, description: description.value.trim(), blockAuthor
          });
          close();
          if (currentAccount?.uid === viewer) {
            const message = blockAuthor ? '已拉黑并为你隐藏该评论，举报已受理' : '已为您隐藏该评论，举报已受理';
            accountNotice(message, 'comment-block');
            await hideModeratedComments(data => blockAuthor
              ? data.commentAuthor === entry.userId
              : data.commentKey === kind + ':' + entry.id);
          }
        } catch (error) {
          status.textContent = error.message;
        } finally {
          submitting = choices.disabled = block.disabled = cancel.disabled = confirm.disabled = closeButton.disabled = false;
        }
      };
    });
  }

  function renderEntry(entry, reply = false, refreshThread, expanded = false) {
    const kind = reply ? 'reply' : 'comment';
    const article = node('article', reply ? 'comment-reply' : 'comment-entry');
    article.dataset.commentAuthor = entry.userId;
    article.dataset.commentKey = kind + ':' + entry.id;
    const body = node('div', 'comment-body'), byline = node('div', 'comment-byline');
    byline.append(link('/space/' + encodeURIComponent(entry.userId), entry.author));
    if (entry.level) byline.append(node('span', 'comment-level', entry.level));
    const content = node('p', 'comment-content'), actions = node('div', 'comment-actions');
    if (reply && entry.replyToUserId && entry.replyToName) {
      const recipient = link('/space/' + encodeURIComponent(entry.replyToUserId), '@' + entry.replyToName, 'comment-mention-text');
      mentionCards.bind(recipient, entry.replyToUserId);
      content.append('回复 ', recipient, '：');
    }
    mentionCards.render(content, entry.content, entry.tags);
    actions.append(node('time', '', (entry.sentAt || '').replace('T', ' ').slice(0, 16)));
    const like = action('', '', () => {});
    const count = node('span', '', shortCount(entry.likes));
    like.setAttribute('aria-label', '点赞');
    like.append(svg('like-outline'), count);
    if (typeof bindLike === 'function') bindLike(like, kind, entry.id, value => { count.textContent = shortCount(value); });
    const replyButton = action('回复', '', () => openInlineReply(entry, kind, body, refreshThread));
    const own = signedIn() && currentAccount.uid === entry.userId;
    actions.append(like, replyButton, commentMenu(entry, kind, own));
    content.hidden = !entry.content;
    body.append(byline, content);
    if (!reply && entry.hasImage) {
      const attachment = node('img', 'comment-attachment');
      attachment.src = '/api/interactions/comments/' + encodeURIComponent(entry.id) + '/image';
      attachment.alt = '评论图片';
      attachment.loading = 'lazy';
      body.append(attachment);
    }
    body.append(actions);
    article.append(avatar(entry), body);
    if (!reply) {
      const previews = node('div', 'comment-replies');
      const expand = async (recent = false) => {
        const version = requestVersion;
        const rows = await interaction('/comments/' + entry.id + '/replies' + (recent ? '?recent=true' : ''));
        if (version !== requestVersion || !previews.isConnected) return;
        if (previews.contains(replyComposer)) closeInlineReply();
        previews.replaceChildren(...rows.map(row => renderEntry(row, true, refreshThread)));
      };
      refreshThread = () => expand(true);
      const visibleReplies = expanded ? (entry.replies || []) : (entry.replies || []).slice(0, 2);
      visibleReplies.forEach(row => previews.append(renderEntry(row, true, refreshThread)));
      if (entry.replyCount > visibleReplies.length) {
        previews.append(action('共 ' + entry.replyCount + ' 条回复，点击查看', 'comment-view-replies', () => expand()));
      }
      body.append(previews);
    }
    return article;
  }

  async function load(nextSort, nextPage = 1, keepRows = false) {
    if (!current()) return;
    closeMenu();
    if (nextPage === 1) closeInlineReply();
    const version = ++requestVersion;
    const member = signedIn();
    sort = nextSort;
    el('comments-hot').setAttribute('aria-pressed', String(sort === 'hot'));
    el('comments-latest').setAttribute('aria-pressed', String(sort === 'latest'));
    if (nextPage === 1 && !keepRows) {
      list.setAttribute('data-preview', 'false');
      list.textContent = '正在加载评论…';
    }
    moreComments.hidden = true;
    try {
      const data = await api(endpoint + '?sort=' + sort + '&page=' + nextPage);
      if (!current() || version !== requestVersion) return;
      page = nextPage;
      el('comment-total').textContent = shortCount(data.total);
      const rows = (member ? data.items : data.items.slice(0, 2)).map(entry => renderEntry(entry));
      if (nextPage === 1) list.replaceChildren(...rows);
      else list.append(...rows);
      list.setAttribute('data-preview', String(!member && rows.length > 0));
      if (nextPage === 1 && !rows.length) list.append(node('p', 'comments-empty', '还没有评论'));
      moreComments.textContent = member ? '加载更多评论' : '登录后查看 ' + data.total + ' 条评论';
      moreComments.hidden = member ? page * 20 >= data.total : data.total === 0;
    } catch {
      if (!current() || version !== requestVersion) return;
      if (nextPage === 1 && !keepRows) list.textContent = '评论加载失败，请刷新重试';
      else { moreComments.hidden = false; accountNotice('评论加载失败，请重试'); }
    }
  }

  el('comments-hot').onclick = () => load('hot');
  el('comments-latest').onclick = () => signedIn() ? load('latest') : openLogin(el('comments-latest'));
  moreComments.onclick = () => signedIn() ? load(sort, page + 1) : openLogin(moreComments);
  const guest = el('comment-guest'), form = el('comment-entry-form');
  const input = el('comment-text'), send = el('comment-send'), avatarImage = el('comment-current-avatar');
  const fileInput = el('comment-image-file'), preview = el('comment-image-preview'), previewImage = el('comment-preview-image');
  const emptyNotice = el('comment-empty-notice');
  let selectedImage = null, previewUrl, posting = false, composerUid, emptyNoticeTimer;
  input.value = '';
  input.readOnly = false;
  preview.hidden = true;
  fileInput.value = '';
  emptyNotice.textContent = '';
  lifecycle.signal.addEventListener('abort', () => {
    clearTimeout(emptyNoticeTimer);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    closeMenu();
    closeInlineReply();
  }, { once: true });

  function showEmptyNotice(message) {
    clearTimeout(emptyNoticeTimer);
    emptyNotice.textContent = message;
    emptyNoticeTimer = setTimeout(() => { emptyNotice.textContent = ''; }, 1800);
  }

  const replyComposer = node('div', 'comment-compose reply-compose');
  const replyAvatar = node('img', 'guest-avatar');
  replyAvatar.alt = '';
  replyAvatar.onerror = () => { replyAvatar.onerror = null; replyAvatar.src = '/assets/guest-avatar.gif'; };
  const replyForm = form.cloneNode(true);
  replyForm.hidden = false;
  replyForm.id = 'reply-entry-form';
  replyForm.classList.add('reply-entry-form');
  for (const imageControl of replyForm.querySelectorAll('#comment-image-preview, #comment-image-select, #comment-image-file')) {
    imageControl.remove();
  }
  for (const element of replyForm.querySelectorAll('[id]')) element.id = element.id.replace(/^comment-/, 'reply-');
  for (const button of replyForm.querySelectorAll('[aria-controls]')) {
    button.setAttribute('aria-controls', button.getAttribute('aria-controls').replace(/^comment-/, 'reply-'));
  }
  const replyInput = replyForm.querySelector('textarea');
  const replySend = replyForm.querySelector('.comment-send');
  replyComposer.append(replyAvatar, replyForm);
  let replyTarget, replyPosting = false;
  const updateReplySend = () => {
    replyForm.setAttribute('data-has-content', String(Boolean(replyInput.value.trim())));
    replySend.disabled = replyPosting;
  };
  const replyTools = setupCommentTools(replyForm, replyInput, updateReplySend, lifecycle.signal);

  function closeInlineReply() {
    if (!replyTarget) return;
    replyTarget = undefined;
    replyComposer.remove();
    replyInput.value = '';
    replyTools.reset();
  }

  function openInlineReply(entry, kind, body, refreshThread) {
    if (replyPosting) return;
    const uid = currentAccount.uid;
    if (replyTarget?.id !== entry.id || replyTarget.kind !== kind || replyTarget.uid !== uid) {
      closeInlineReply();
      replyTarget = { id: entry.id, kind, uid, refreshThread };
      const prompt = '回复 @' + entry.author + '：';
      replyInput.placeholder = prompt;
      replyInput.setAttribute('aria-label', prompt);
      replyAvatar.src = '/api/authors/' + encodeURIComponent(uid) + '/avatar';
      body.append(replyComposer);
    }
    replyInput.focus();
  }

  replyForm.onsubmit = async event => {
    event.preventDefault();
    const target = replyTarget;
    if (!target || replyPosting || currentAccount?.uid !== target.uid) return;
    const value = replyInput.value.trim();
    if (!value) { showEmptyNotice('你还没有填写回复！'); return; }
    clearTimeout(emptyNoticeTimer);
    emptyNotice.textContent = '';
    const tags = replyTools.tagsForTrimmedText();
    replyTools.close();
    replyPosting = replyInput.readOnly = true;
    updateReplySend();
    try {
      await interaction('/replies/' + target.kind + '/' + encodeURIComponent(target.id), 'POST', { value, tags });
      if (!current() || replyTarget !== target || currentAccount?.uid !== target.uid) return;
      closeInlineReply();
      try { await target.refreshThread(); }
      catch { accountNotice('回复已发布，列表加载失败'); }
    } catch (error) {
      if (replyTarget === target) accountNotice(error.message);
    } finally {
      replyPosting = replyInput.readOnly = false;
      updateReplySend();
    }
  };

  function updateSend() {
    const hasContent = Boolean(input.value?.trim());
    form.setAttribute('data-has-content', String(hasContent));
    send.disabled = posting;
  }
  const commentTools = setupCommentTools(form, input, updateSend, lifecycle.signal);
  function showImage(file) {
    if (previewUrl) {
      previewImage.removeAttribute('src');
      URL.revokeObjectURL(previewUrl);
      previewUrl = undefined;
    }
    selectedImage = file;
    preview.hidden = !file;
    if (file) {
      previewUrl = URL.createObjectURL(file);
      previewImage.src = previewUrl;
    }
    updateSend();
  }
  guest.onclick = () => openLogin(guest);
  el('comment-image-select').onclick = () => fileInput.click();
  el('comment-image-remove').onclick = () => { showImage(null); input.focus(); };
  fileInput.onchange = () => {
    const [file] = fileInput.files;
    fileInput.value = '';
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) return accountNotice('图片大小不能超过 4 MB');
    showImage(file);
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (!signedIn()) return openLogin(guest);
    const value = input.value.trim(), image = selectedImage, uid = composerUid;
    if (posting) return;
    if (!value) {
      showEmptyNotice('你还没有评论！');
      return;
    }
    clearTimeout(emptyNoticeTimer);
    emptyNotice.textContent = '';
    const tags = commentTools.tagsForTrimmedText();
    commentTools.close();
    posting = true;
    updateSend();
    try {
      if (image) {
        const payload = new FormData();
        payload.append('image', image);
        payload.append('value', value);
        payload.append('tags', JSON.stringify(tags));
        await interaction(endpoint + '/image', 'POST', payload);
      } else {
        await interaction(endpoint, 'POST', { value, tags });
      }
      if (!current() || composerUid !== uid) return;
      if (input.value.trim() === value) {
        input.value = '';
        commentTools.reset();
      }
      if (selectedImage === image) showImage(null);
      await load('latest');
    } catch (error) { if (current()) accountNotice(error.message); }
    finally { posting = false; if (current()) updateSend(); }
  };
  function updateComposer() {
    const uid = signedIn() ? currentAccount.uid : null;
    if (uid !== composerUid) {
      if (composerUid != null) {
        input.value = '';
        showImage(null);
      }
      composerUid = uid;
      commentTools.reset();
      avatarImage.onerror = () => { avatarImage.onerror = null; avatarImage.src = '/assets/guest-avatar.gif'; };
      avatarImage.src = uid ? '/api/authors/' + encodeURIComponent(uid) + '/avatar' : '/api/avatar/default';
    }
    guest.hidden = Boolean(uid);
    form.hidden = !uid;
    updateSend();
  }
  if (commentsAccountHook) window.removeEventListener('accountchange', commentsAccountHook);
  commentsAccountHook = () => { updateComposer(); load(signedIn() ? sort : 'hot'); };
  window.addEventListener('accountchange', commentsAccountHook);
  updateComposer();
  await load('hot');
  if (!current()) return;
  const query = new URLSearchParams(location.search);
  const targetKind = query.has('reply') ? 'reply' : 'comment';
  const targetId = query.get(targetKind);
  if (targetId && /^[0-9]{1,20}$/.test(targetId)) {
    const version = requestVersion;
    try {
      const data = await api(endpoint + '/locate?' + new URLSearchParams({ kind: targetKind, target: targetId }));
      if (!current()) return;
      if (version !== requestVersion || !list.isConnected) return;
      const key = targetKind + ':' + targetId;
      const existing = list.querySelector('[data-comment-key="comment:' + data.items[0]?.id + '"]');
      const entry = data.items[0] && renderEntry(data.items[0], false, undefined, true);
      if (entry) {
        if (existing) existing.replaceWith(entry);
        else list.prepend(entry);
        list.querySelector('.comments-empty')?.remove();
      }
      const target = entry && [...entry.querySelectorAll('[data-comment-key]'), entry]
        .find(element => element.dataset.commentKey === key);
      if (target) {
        target.classList.add('comment-located');
        setTimeout(() => target.classList.remove('comment-located'), 3000);
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'center', behavior: 'instant' });
      } else {
        accountNotice('原评论已删除或暂时不可见');
        list.scrollIntoView({ block: 'start' });
      }
    } catch {
      accountNotice(signedIn() ? '原评论定位失败，请刷新重试' : '登录后可定位原评论');
      list.scrollIntoView({ block: 'start' });
    }
  }
}



function setupRelatedExpansion(videos) {
  const first=videos.slice(0,20),extra=videos.slice(20);
  function relatedCard(video) {
    const entry = card(video);
    const stats = node('div', 'related-stats');
    for (const [symbol, label, count] of [['play', '播放', video.plays], ['list', '弹幕', video.danmaku]]) {
      const total = shortCount(count);
      const stat = node('span');
      stat.append(icon(symbol), total);
      stat.setAttribute('aria-label', label + ' ' + total);
      stats.append(stat);
    }
    entry.append(stats);
    return entry;
  }
  el('related-videos').replaceChildren(...first.map(relatedCard));el('related-extra').replaceChildren(...extra.map(relatedCard));
  el('related-extra').hidden=true;el('related-collapse').hidden=true;
  el('related-expand').hidden=extra.length===0;
  el('related-expand').onclick=()=>{el('related-extra').hidden=false;el('related-expand').hidden=true;el('related-collapse').hidden=false;};
  el('related-collapse').onclick=()=>{
    const anchor=el('related-videos').getBoundingClientRect().bottom;
    el('related-extra').hidden=true;el('related-expand').hidden=false;el('related-collapse').hidden=true;
    if(anchor<80)el('related-expand').scrollIntoView({block:'end',behavior:'smooth'});
  };
}

function setupWatchScroll(player,shell) {
  const home=el('player-shell-home'),main=document.querySelector('.watch-main');home.append(shell);
  let floating=false, dismissed=false, revealed=false, pastPlayer=false, manualPosition=null, drag=null;
  const miniToggle=el('watch-mini-toggle');miniToggle.hidden=true;
  function syncMiniButton(){miniToggle.hidden=!revealed||!pastPlayer;miniToggle.setAttribute('aria-pressed',String(!dismissed));miniToggle.setAttribute('aria-label',!dismissed?'关闭小窗':'开启小窗');}
  const author = document.querySelector('.watch-author');
  function measure() {
    const layout = el('video-page');
    main.style.setProperty('--watch-main-height', main.offsetHeight + 'px');
    if (layout.classList.contains('wide-mode')) return;
    const playerTop = home.getBoundingClientRect().top - main.getBoundingClientRect().top;
    const authorHeight = author.getBoundingClientRect().height;
    author.style.setProperty('--watch-author-gap', (playerTop - authorHeight) + 'px');
  }
  const resize = new ResizeObserver(measure);
  resize.observe(main);
  resize.observe(author);
  measure();
  function restore(){
    if(!floating)return;floating=false;shell.classList.remove('scroll-mini');home.append(shell);home.style.height='';shell.style.removeProperty('left');shell.style.removeProperty('top');shell.style.removeProperty('right');shell.style.removeProperty('bottom');syncMiniButton();
  }
  function float(){
    if(floating||dismissed||document.fullscreenElement||shell.classList.contains('web-full')||el('video-page').classList.contains('wide-mode')||window.innerWidth<801)return;
    home.style.height=home.getBoundingClientRect().height+'px';document.body.append(shell);shell.classList.add('scroll-mini');floating=true;revealed=true;syncMiniButton();
    if(manualPosition){shell.style.left=manualPosition.x+'px';shell.style.top=manualPosition.y+'px';shell.style.right='auto';shell.style.bottom='auto';}
  }
  const observer=new IntersectionObserver(entries=>{
    const entry=entries[0];
    pastPlayer=!entry.isIntersecting&&entry.boundingClientRect.top<0;
    if(pastPlayer)float();else restore();
    syncMiniButton();
  },{rootMargin:'-76px 0px 0px 0px',threshold:0});observer.observe(home);
  listenDocument('fullscreenchange',()=>{if(document.fullscreenElement)restore();});
  el('wide-toggle').addEventListener('click',restore);
  miniToggle.onclick=()=>{dismissed=!dismissed;if(dismissed)restore();else if(pastPlayer)float();syncMiniButton();};
  el('mini-close').onclick=()=>{dismissed=true;restore();syncMiniButton();};
  const handle=el('mini-drag-handle');
  handle.addEventListener('pointerdown',event=>{
    if(!floating||event.button!==0)return;
    const rect=shell.getBoundingClientRect();drag={x:event.clientX-rect.left,y:event.clientY-rect.top};handle.setPointerCapture(event.pointerId);event.preventDefault();
  });
  handle.addEventListener('pointermove',event=>{
    if(!drag)return;
    const x=Math.max(0,Math.min(window.innerWidth-shell.offsetWidth,event.clientX-drag.x));
    const y=Math.max(0,Math.min(window.innerHeight-shell.offsetHeight,event.clientY-drag.y));
    manualPosition={x,y};shell.style.left=x+'px';shell.style.top=y+'px';shell.style.right='auto';shell.style.bottom='auto';
  });
  function end(){drag=null;}handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
  window.addEventListener('resize',()=>{measure();if(window.innerWidth<801)restore();else if(floating&&manualPosition){manualPosition.x=Math.min(manualPosition.x,window.innerWidth-shell.offsetWidth);manualPosition.y=Math.max(0,Math.min(manualPosition.y,window.innerHeight-shell.offsetHeight));shell.style.left=manualPosition.x+'px';shell.style.top=manualPosition.y+'px';}});
  window.addEventListener('pagehide',()=>{observer.disconnect();resize.disconnect();},{once:true});
  return restore;
}
