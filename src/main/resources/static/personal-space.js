function setupPersonalSpace() {
  const profile = el('author-profile');
  const content = el('space-content');
  const status = el('personal-space-status');
  const tabs = el('space-tabs');
  const tabIndicator = node('span', 'search-tab-indicator');
  tabIndicator.setAttribute('aria-hidden', 'true');
  tabIndicator.hidden = true;
  const tabLinks = new Map();
  let accountRevision = 0;
  let revision = 0;
  let space;

  function navigate(href) {
    const target = new URL(href, location.href);
    if (target.href !== location.href) history.pushState(null, '', target.href);
    return render();
  }

  function alignIndicator() {
    const active = tabs.querySelector('a.active');
    if (active && !profile.hidden) {
      tabIndicator.style.transform = 'translateX(' + active.offsetLeft + 'px)';
      tabIndicator.style.width = active.offsetWidth + 'px';
      tabIndicator.hidden = false;
    }
  }

  function showStatus(message, action, label) {
    profile.hidden = true;
    document.body.classList.remove('author-page');
    status.hidden = false;
    status.replaceChildren(node('h1', '', message));
    if (action) status.append(button(label, action, 'personal-primary'));
  }

  function button(label, action, className = 'secondary') {
    const result = node('button', className, label);
    result.type = 'button';
    result.onclick = action;
    return result;
  }

  function block(label, actions = []) {
    const result = node('section', 'space-section');
    const header = node('div', 'space-heading');
    header.append(node('h2', '', label), ...actions);
    result.append(header);
    return result;
  }

  function grid(entries, render, message) {
    if (!entries.length) return node('p', 'space-empty', message);
    const result = node('div', 'space-grid');
    result.append(...entries.map(render));
    return result;
  }

  function videoCard(video) {
    const result = card(video);
    result.querySelector('.card-byline').textContent = video.publishedAt?.slice(0, 10) || '';
    return result;
  }

  function tile(href, title, coverId, subtitle) {
    const result = link(href, null, 'collection-tile');
    const cover = node('div', 'card-cover');
    if (coverId) {
      const img = node('img');
      img.alt = '';
      img.loading = 'lazy';
      cover.append(img);
      attachCover(img, '/api/videos/' + encodeURIComponent(coverId) + '/cover', '暂无封面');
    } else cover.dataset.fallback = '暂无封面';
    if (subtitle) cover.append(node('span', 'collection-count', subtitle));
    result.append(cover, node('h3', '', title));
    return result;
  }

  function editSignatureDialog(value, save) {
    const title = '编辑个性签名';
    return interactionPanel(title, (body, feedback, close) => {
      const form = node('form', 'personal-editor');
      const field = node('input');
      const submit = node('button', 'personal-primary', '保存');
      field.setAttribute('aria-label', title);
      field.maxLength = 60;
      field.value = value || '';
      form.append(field, submit);
      form.onsubmit = async (event) => {
        event.preventDefault();
        submit.disabled = true;
        try {
          await save(field.value.trim());
          close();
        } catch (error) {
          feedback.textContent = error.message;
        } finally {
          submit.disabled = false;
        }
      };
      body.append(form);
    });
  }

  async function load(account) {
    if (account && space?.account.uid === account.uid) return render();
    const request = ++accountRevision;
    ++revision;
    space = null;
    content.replaceChildren();
    content.removeAttribute('aria-busy');
    if (!account) {
      document.title = '我的空间 - dilidili';
      showStatus('登录后查看我的空间', () => openLogin(status.querySelector('button')), '登录');
      return;
    }
    showStatus('正在加载我的空间…');
    const uid = encodeURIComponent(account.uid);
    try {
      const author = await api('/authors/' + uid);
      if (request !== accountRevision) return;

      const preferencesKey = 'personal-space:' + account.uid;
      let preferences = {};
      try { preferences = JSON.parse(localStorage.getItem(preferencesKey)) || {}; } catch {}
      space = { account, author, uid, preferencesKey, preferences };

      document.body.classList.add('author-page');
      document.title = author.name + '的个人空间 - dilidili';
      el('author-name').textContent = author.name;
      el('author-level').textContent = author.level;
      const avatar = node('img');
      avatar.alt = author.name + '的头像';
      avatar.onerror = () => { avatar.onerror = null; avatar.src = '/assets/guest-avatar.gif'; };
      avatar.src = '/api/authors/' + uid + '/avatar';
      el('author-avatar').replaceChildren(avatar);
      document.querySelector('.space-actions').hidden = true;
      profile.setAttribute('aria-label', '我的空间');
      el('author-following').textContent = shortCount(author.following);
      el('author-followers').textContent = shortCount(author.followers);
      profile.querySelectorAll('.personal-stat').forEach(entry => entry.remove());
      setupPeopleList(el('author-following').parentElement, account.uid, 'following', '关注列表');
      setupPeopleList(el('author-followers').parentElement, account.uid, 'followers', '粉丝列表');
      tabLinks.clear();
      for (const [key, label, symbol] of [
        ['home', '主页', 'home-outline'], ['uploads', '投稿 ' + author.videos, 'tv'],
        ['lists', '合集和系列', 'archive-box'], ['favorites', '收藏', 'star'],
        ['settings', '设置', 'settings-outline'],
      ]) {
        const entry = link('/me', null);
        entry.prepend(icon(symbol));
        entry.append(node('span', '', label));
        entry.dataset.tab = key;
        tabLinks.set(key, entry);
      }
      tabIndicator.hidden = true;
      tabs.replaceChildren(...tabLinks.values(), tabIndicator);
      status.hidden = true;
      profile.hidden = false;
      return render();
    } catch {
      if (request === accountRevision) showStatus('我的空间加载失败，请重试', () => load(account), '重新加载');
    }
  }

  async function render() {
    if (!space) return;
    const request = ++revision;
    const currentSpace = space;
    const { account, author, uid, preferencesKey } = currentSpace;
    const preferences = currentSpace.preferences;
    const params = new URLSearchParams(location.search);
    const keyword = (params.get('keyword') || '').trim();
    const page = Math.min(10000, Math.max(0, Number.parseInt(params.get('page'), 10) || 0));
    const selectedTab = params.get('tab') || (keyword ? 'uploads' : 'home');
    const mode = selectedTab === 'collection' || tabLinks.has(selectedTab) ? selectedTab : 'home';
    const collectionView = mode === 'lists' || mode === 'collection';
    const activeTab = collectionView ? 'lists' : mode;
    profile.classList.toggle('space-lists', collectionView);
    const sort = ['popular', 'favorites'].includes(params.get('sort')) ? params.get('sort') : 'latest';
    const url = (changes = {}) => {
      const query = new URLSearchParams(changes).toString();
      return '/me' + (query ? '?' + query : '');
    };
    const publicSpace = '/space/' + uid;
    const signature = el('author-signature');
    const side = profile.querySelector('.space-sidebar');

    function savePreference(key, value) {
      const next = { ...preferences, [key]: value };
      localStorage.setItem(preferencesKey, JSON.stringify(next));
      Object.assign(preferences, next);
    }

    function showSignature() {
      signature.replaceChildren(button(author.signature || '编辑个性签名', editSignature, 'personal-signature'));
    }

    function editSignature() {
      editSignatureDialog(author.signature, async (value) => {
        const saved = await authApi('signature', { value });
        author.signature = saved.value;
        if (space === currentSpace) showSignature();
      });
    }

    function showSidebar() {
      const about = node('section', 'personal-about');
      about.append(node('h2', '', '个人资料'), node('p', '', 'UID ' + account.uid));
      if (author.birthday) about.append(node('p', '', '生日 ' + author.birthday));
      const creator = node('section', 'personal-creator');
      const creatorActions = node('div', 'personal-creator-actions');
      const upload = link('/studio/upload', '视频投稿', 'personal-creator-action');
      upload.prepend(icon('upload'));
      const manage = link('/studio/videos', '投稿管理', 'personal-creator-action');
      manage.prepend(icon('manage'));
      creatorActions.append(upload, manage);
      const title = node('h2', '', '创作中心');
      title.prepend(icon('creator-bulb'));
      const creatorLink = link('/studio', null, 'personal-creator-link');
      creatorLink.append(title);
      creator.append(creatorLink, creatorActions);
      side.replaceChildren(creator, about);
    }

    if (!currentSpace.initialized) {
      showSignature();
      showSidebar();
      currentSpace.initialized = true;
    }
    for (const [key, entry] of tabLinks) {
      entry.href = url(key === 'home' ? {} : { tab: key });
      entry.classList.toggle('active', key === activeTab);
      if (key === activeTab) entry.setAttribute('aria-current', 'page');
      else entry.removeAttribute('aria-current');
    }
    alignIndicator();

    const form = el('space-search');
    form.elements.keyword.value = keyword;
    form.onsubmit = (event) => {
      event.preventDefault();
      navigate(url({ tab: 'uploads', keyword: form.elements.keyword.value.trim() }));
    };
    const counts = profile.querySelector('.space-counts');
    content.setAttribute('aria-busy', 'true');
    content.replaceChildren(node('p', 'space-empty', '正在加载…'));

    const videos = (options = {}) => api('/videos?' + new URLSearchParams({
      authorId: account.uid, sort, size: 10, ...options,
    }));
    const folderId = params.get('folder') || '';
    try {
      const [summary, collectionContent, result, folderVideos, featured] = await Promise.all([
        currentSpace.summary ||= interaction('/me/space').catch(error => {
          currentSpace.summary = null;
          throw error;
        }),
        collectionView ? api('/authors/' + uid + '/collections').then(collections => spaceCollectionContent({
          view: mode, params, page, url, collections, navigate,
          videos: options => videos({ size: 20, ...options }),
        })) : null,
        ['home', 'uploads'].includes(mode) ? videos({
          q: mode === 'uploads' ? keyword : '', page: mode === 'uploads' ? page : 0,
          size: mode === 'home' ? 5 : 20,
        }) : null,
        mode === 'favorites' && /^\d+$/.test(folderId) ? interaction('/me/folders/' + folderId) : null,
        mode === 'home' && /^\d+$/.test(preferences.featured || '')
          ? api('/videos/' + preferences.featured).then(detail => detail.video).catch(() => null) : null,
      ]);
      if (request !== revision) return;
      if (summary && !counts.querySelector('.personal-stat')) {
        tabLinks.get('favorites').lastElementChild.textContent = '收藏 ' + summary.folders.length;
        for (const [label, count] of [['获赞数', summary.stats.likes], ['播放数', summary.stats.plays]]) {
          const item = node('span', 'personal-stat', label);
          item.append(node('strong', '', shortCount(count)));
          counts.append(item);
        }
        alignIndicator();
      }
      content.replaceChildren();

      function showFeatured() {
        const panel = node('section', 'personal-featured space-section');
        if (featured?.authorId === account.uid) {
          const section = block('代表作', [button('更换代表作', chooseFeatured)]);
          section.append(grid([featured], videoCard, ''));
          panel.append(section);
        } else {
          const prompt = node('div', 'personal-featured-prompt');
          const image = node('img');
          image.src = '/assets/space-empty.svg';
          image.alt = '';
          const copy = node('div');
          copy.append(node('p', '', '选择一条公开视频作为主页代表作。'),
            button('＋ 选择代表作', chooseFeatured, 'personal-primary'));
          prompt.append(image, copy);
          panel.append(prompt);
        }
        content.append(panel);
      }

      function chooseFeatured() {
        return interactionPanel('选择代表作视频', async (body, _feedback, close) => {
          let currentPage = 0;
          async function display() {
            const choices = await videos({ sort: 'latest', size: 20, page: currentPage });
            const list = node('div', 'personal-choices');
            for (const video of choices.items) {
              list.append(button(video.title, () => select(video.id)));
            }
            if (!choices.items.length) list.append(node('p', '', '暂无可以设为代表作的公开视频'));
            function select(id) {
              try {
                savePreference('featured', id);
                close();
                render();
              } catch {
                accountNotice('无法保存代表作，请检查浏览器存储设置');
              }
            }
            async function move(offset) {
              currentPage += offset;
              try { await display(); }
              catch {
                currentPage -= offset;
                accountNotice('视频加载失败，请重试');
              }
            }
            const controls = node('div', 'personal-choices-controls');
            if (currentPage) controls.append(button('上一页', () => move(-1)));
            if (choices.hasMore) controls.append(button('下一页', () => move(1)));
            if (preferences.featured) controls.append(button('取消代表作', () => select('')));
            body.replaceChildren(list, controls);
          }
          await display();
        });
      }

      function showVideos() {
        const filters = node('nav', 'space-sort');
        filters.setAttribute('aria-label', '视频排序');
        const query = mode === 'uploads' ? { tab: 'uploads', ...(keyword ? { keyword } : {}) } : {};
        for (const [key, label] of [['latest', '最新发布'], ['popular', '最多播放'], ['favorites', '最多收藏']]) {
          const option = link(url({ ...query, sort: key }), label, key === sort ? 'active' : '');
          if (key === sort) option.setAttribute('aria-current', 'true');
          filters.append(option);
        }
        const tools = node('div', 'space-video-actions');
        if (mode === 'home') tools.append(link(url({ tab: 'uploads', sort }), '查看更多 ›', 'secondary'));
        const title = mode === 'uploads' ? (keyword ? '搜索结果' : '我的视频') : '视频 · ' + author.videos;
        const list = block(title, [filters, tools]);
        list.append(grid(result.items, videoCard, keyword ? '没有找到相关视频' : '暂无公开视频'));
        content.append(list);
        if (mode === 'uploads' && (page || result.hasMore)) {
          const pager = node('nav', 'pagination');
          pager.setAttribute('aria-label', '视频分页');
          if (page) pager.append(link(url({ ...query, sort, page: page - 1 }), '上一页', 'secondary'));
          pager.append(node('span', '', '第 ' + (page + 1) + ' 页'));
          if (result.hasMore) pager.append(link(url({ ...query, sort, page: page + 1 }), '下一页', 'secondary'));
          content.append(pager);
        }
      }

      function showFolders() {
        const folders = summary.folders;
        const selected = folders.find(folder => folder.id === folderId);
        const section = block(selected ? selected.name : '收藏夹 · ' + folders.length, [
          node('span', 'personal-private', '仅自己可见'),
          ...(mode === 'home' ? [link(url({ tab: 'favorites' }), '查看更多 ›', 'secondary')] :
            selected ? [link(url({ tab: 'favorites' }), '返回收藏夹', 'secondary')] : []),
        ]);
        section.append(selected
          ? grid(folderVideos || [], video => tile('/video/' + video.id, video.title, video.id), '收藏夹暂无可播放视频')
          : grid(mode === 'home' ? folders.slice(0, 5) : folders,
            folder => tile(url({ tab: 'favorites', folder: folder.id }), folder.name, folder.coverVideoId, folder.count + ' 个视频'),
            '暂无收藏夹'));
        content.append(section);
      }

      if (mode === 'home') {
        showFeatured();
        showVideos();
        showFolders();
      } else if (mode === 'uploads') {
        showVideos();
      } else if (collectionView) {
        content.append(...collectionContent);
      } else if (mode === 'favorites') {
        showFolders();
      } else if (mode === 'settings') {
        const section = block('空间设置');
        section.append(node('div', 'personal-settings'));
        section.lastChild.append(button('编辑个性签名', editSignature),
          link(publicSpace, '查看公开空间 ›', 'secondary'));
        content.append(section);
      }
    } catch {
      if (request !== revision) return;
      const error = node('div', 'personal-space-status');
      error.append(node('p', '', '内容加载失败，请重试'), button('重新加载', render));
      content.replaceChildren(error);
    } finally {
      if (request === revision) content.removeAttribute('aria-busy');
    }
  }

  profile.addEventListener('click', (event) => {
    const entry = event.target.closest('a[href]');
    if (!entry || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = new URL(entry.href);
    if (target.origin !== location.origin || target.pathname !== '/me') return;
    event.preventDefault();
    const nav = tabs.parentElement;
    if (nav.getBoundingClientRect().bottom < 0) nav.scrollIntoView();
    navigate(target.href);
  });
  window.addEventListener('popstate', render);
  window.addEventListener('resize', alignIndicator);
  window.addEventListener('accountchange', event => load(event.detail));
  window.addEventListener('accountloaderror', () => {
    if (!space) showStatus('账号加载失败，请重试', refreshAccount, '重新加载');
  });
  showStatus('正在加载我的空间…');
}

