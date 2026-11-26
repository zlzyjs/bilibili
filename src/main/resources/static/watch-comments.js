async function setupWatchComments(videoId) {
  const list = el('comment-list'), moreComments = el('comments-more');
  const endpoint = '/videos/' + encodeURIComponent(videoId) + '/comments';
  const signedIn = () => typeof currentAccount !== 'undefined' && Boolean(currentAccount);
  let requestVersion = 0, sort = 'hot', page = 1;
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
    return a;
  }
  function renderEntry(entry, reply = false, reload = () => load(sort)) {
    const kind = reply ? 'reply' : 'comment';
    const article = node('article', reply ? 'comment-reply' : 'comment-entry');
    const body = node('div', 'comment-body'), byline = node('div', 'comment-byline');
    byline.append(link('/space/' + encodeURIComponent(entry.userId), entry.author));
    if (entry.level) byline.append(node('span', 'comment-level', entry.level));
    const content = node('p', 'comment-content', entry.content), actions = node('div', 'comment-actions');
    actions.append(node('time', '', (entry.sentAt || '').replace('T', ' ').slice(0, 16)));
    const like = action('', '', () => {});
    const count = node('span', '', shortCount(entry.likes));
    like.setAttribute('aria-label', '点赞');
    like.append(svg('like-outline'), count);
    if (typeof bindLike === 'function') bindLike(like, kind, entry.id, value => { count.textContent = shortCount(value); });
    const replyButton = action('回复', '', () => textInteraction('回复评论', '回复内容', 1000, async value => {
      await interaction('/replies/' + kind + '/' + entry.id, 'POST', { value });
      await reload();
    }));
    const report = action('举报', 'comment-options', () => reportInteraction(kind, entry.id));
    actions.append(like, replyButton, report);
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
      const expand = async () => {
        const rows = await interaction('/comments/' + entry.id + '/replies');
        previews.replaceChildren(...rows.map(row => renderEntry(row, true, expand)));
      };
      const visibleReplies = (entry.replies || []).slice(0, 2);
      visibleReplies.forEach(row => previews.append(renderEntry(row, true, expand)));
      if (entry.replyCount > visibleReplies.length) {
        previews.append(action('共 ' + entry.replyCount + ' 条回复，点击查看', 'comment-view-replies', expand));
      }
      body.append(previews);
    }
    return article;
  }

  async function load(nextSort, nextPage = 1) {
    const version = ++requestVersion;
    const member = signedIn();
    sort = nextSort;
    el('comments-hot').setAttribute('aria-pressed', String(sort === 'hot'));
    el('comments-latest').setAttribute('aria-pressed', String(sort === 'latest'));
    if (nextPage === 1) {
      list.setAttribute('data-preview', 'false');
      list.textContent = '正在加载评论…';
    }
    moreComments.hidden = true;
    try {
      const data = await api(endpoint + '?sort=' + sort + '&page=' + nextPage);
      if (version !== requestVersion) return;
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
      if (version !== requestVersion) return;
      if (nextPage === 1) list.textContent = '评论加载失败，请刷新重试';
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
  function updateSend() {
    const hasContent = Boolean(input.value?.trim());
    form.setAttribute('data-has-content', String(hasContent));
    send.disabled = posting;
  }
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
  input.oninput = updateSend;
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
    clearTimeout(emptyNoticeTimer);
    if (!value) {
      emptyNotice.textContent = '你还没有评论！';
      emptyNoticeTimer = setTimeout(() => { emptyNotice.textContent = ''; }, 1800);
      return;
    }
    emptyNotice.textContent = '';
    posting = true;
    updateSend();
    try {
      if (image) {
        const payload = new FormData();
        payload.append('image', image);
        payload.append('value', value);
        await interaction(endpoint + '/image', 'POST', payload);
      } else {
        await interaction(endpoint, 'POST', { value });
      }
      if (composerUid !== uid) return;
      if (input.value.trim() === value) input.value = '';
      if (selectedImage === image) showImage(null);
      await load('latest');
    } catch (error) { accountNotice(error.message); }
    finally { posting = false; updateSend(); }
  };
  function updateComposer() {
    const uid = signedIn() ? currentAccount.uid : null;
    if (uid !== composerUid) {
      if (composerUid != null) {
        input.value = '';
        showImage(null);
      }
      composerUid = uid;
      avatarImage.onerror = () => { avatarImage.onerror = null; avatarImage.src = '/assets/guest-avatar.gif'; };
      avatarImage.src = uid ? '/api/authors/' + encodeURIComponent(uid) + '/avatar' : '/api/avatar/default';
    }
    guest.hidden = Boolean(uid);
    form.hidden = !uid;
    updateSend();
  }
  window.addEventListener('accountchange', () => { updateComposer(); load(signedIn() ? sort : 'hot'); });
  updateComposer();
  await load('hot');
}



function setupRelatedExpansion(videos) {
  const first=videos.slice(0,20),extra=videos.slice(20);
  el('related-videos').replaceChildren(...first.map(card));el('related-extra').replaceChildren(...extra.map(card));
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
  function measure(){main.style.setProperty('--watch-main-height',main.offsetHeight+'px');}
  const resize=new ResizeObserver(measure);resize.observe(main);measure();
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
  document.addEventListener('fullscreenchange',()=>{if(document.fullscreenElement)restore();});
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
