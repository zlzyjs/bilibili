function setupPersonalSpace() {
  const profile = el('author-profile');
  const content = el('space-content');
  const status = el('personal-space-status');
  const tabs = el('space-tabs');
  const tabIndicator = node('span', 'search-tab-indicator');
  tabIndicator.setAttribute('aria-hidden', 'true');
  tabIndicator.hidden = true;
  const tabLinks = new Map();
  const peopleActions = new Map();
  let peopleCards;
  let accountRevision = 0;
  let revision = 0;
  let space;

  function isPlainLinkClick(event) {
    return !event.defaultPrevented && event.button === 0
      && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
  }

  function navigate(href) {
    const target = new URL(href, location.href);
    if (target.href !== location.href) {
      history.pushState(null, '', target.href);
      const coverBottom = profile.querySelector('.space-cover').getBoundingClientRect().bottom;
      if (coverBottom < 0) window.scrollBy(0, coverBottom);
    }
    return render();
  }

  function alignIndicator() {
    const active = tabs.querySelector('a.active');
    if (active && !profile.hidden) {
      tabIndicator.style.transform = 'translateX(' + active.offsetLeft + 'px)';
      tabIndicator.style.width = active.offsetWidth + 'px';
      tabIndicator.hidden = false;
    } else tabIndicator.hidden = true;
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

  function privateLabel() {
    const label = node('span', 'personal-private');
    label.append(icon('space-private'), '仅自己可见');
    return label;
  }

  function videoCard(video) {
    const result = card(video);
    result.querySelector('.card-byline').textContent = video.publishedAt?.slice(0, 10) || '';
    return result;
  }

  function favoriteCover(coverId) {
    const stack = node('div', 'personal-favorite-stack');
    const cover = node('div', 'personal-favorite-cover');
    const fallback = icon('tv');
    cover.append(fallback);
    if (coverId) {
      const image = node('img');
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () => image.remove(), { once: true });
      image.src = '/api/videos/' + encodeURIComponent(coverId) + '/cover';
      cover.append(image);
    }
    stack.append(cover);
    return stack;
  }

  function favoriteDate(value) {
    if (!value) return '';
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    const prefix = year === new Date().getFullYear() ? '' : year + '年';
    return prefix + month + '月' + day + '日';
  }

  function featuredPicker(videos, current, currentNote, save) {
    return interactionPanel('设置代表作', (body, feedback, close) => {
      const dialog = body.closest('dialog');
      dialog.classList.add('personal-featured-dialog');
      const closeButton = dialog.querySelector('.interaction-close');
      closeButton.textContent = '×';
      closeButton.setAttribute('aria-label', '关闭');
      const picker = node('div', 'personal-featured-picker');
      const searchForm = node('form', 'personal-featured-field');
      searchForm.setAttribute('role', 'search');
      const search = node('input');
      search.type = 'search';
      search.placeholder = '搜索我投稿的视频';
      search.maxLength = 80;
      search.setAttribute('aria-label', search.placeholder);
      const searchButton = node('button', 'personal-featured-search');
      searchButton.type = 'submit';
      searchButton.setAttribute('aria-label', '搜索');
      searchButton.append(icon('search'));
      searchForm.append(search, searchButton);

      const header = node('div', 'personal-featured-list-heading');
      let sort = 'latest';
      const sorting = node('details', 'personal-featured-sort');
      const sortToggle = node('summary');
      const sortLabel = node('span', '', '最新发布');
      sortToggle.setAttribute('aria-label', '投稿排序，当前为最新发布');
      sortToggle.append(sortLabel, icon('right'));
      const sortOptions = node('div', 'personal-featured-sort-options');
      for (const [value, label] of [['latest', '最新发布'], ['popular', '最多播放']]) {
        sortOptions.append(button(label, () => {
          sorting.open = false;
          sortToggle.focus();
          if (sort === value) return;
          sort = value;
          sortLabel.textContent = label;
          sortToggle.setAttribute('aria-label', '投稿排序，当前为' + label);
          display();
        }, 'personal-featured-sort-option'));
      }
      sorting.append(sortToggle, sortOptions);
      header.append(node('span', '', '投稿视频'), sorting);
      const results = node('div', 'personal-featured-results');
      results.setAttribute('aria-label', '投稿视频列表');
      const noteField = node('div', 'personal-featured-field');
      const note = node('input');
      note.placeholder = '请输入代表作备注或选为代表作的理由（非必填）';
      note.setAttribute('aria-label', '代表作备注（选填）');
      note.value = currentNote || '';
      const count = node('output', 'personal-featured-note-count');
      const updateNote = () => {
        const characters = Array.from(note.value);
        if (characters.length > 40) note.value = characters.slice(0, 40).join('');
        count.textContent = Math.min(characters.length, 40) + ' / 40';
      };
      note.oninput = event => { if (!event.isComposing) updateNote(); };
      note.oncompositionend = updateNote;
      updateNote();
      noteField.append(note, count);

      let selected = current, lookup = 0, timer;
      function commit(id) {
        try {
          save(id, id ? note.value.trim() : '');
          close();
        } catch {
          feedback.textContent = '无法保存代表作，请检查浏览器存储设置';
        }
      }
      const actions = node('div', 'personal-featured-actions');
      const confirm = button('确定', () => commit(selected), 'personal-primary');
      confirm.disabled = !selected;
      actions.append(button('取消', close), confirm);
      if (current) actions.append(button('取消代表作', () => commit(''), 'personal-featured-remove'));
      picker.append(searchForm, header, results, noteField, feedback, actions);
      body.append(picker);

      function choice(video) {
        const item = node('label', 'personal-featured-choice');
        const radio = node('input');
        radio.type = 'radio';
        radio.name = 'personal-featured-video';
        radio.checked = selected === video.id;
        radio.onchange = () => {
          if (!radio.checked) return;
          selected = video.id;
          confirm.disabled = false;
          feedback.textContent = '';
        };
        const cover = node('img');
        cover.alt = '';
        cover.loading = 'lazy';
        cover.src = '/api/videos/' + encodeURIComponent(video.id) + '/cover';
        const text = node('span', 'personal-featured-choice-copy');
        const metrics = node('span', 'personal-featured-choice-stats');
        const plays = node('span');
        plays.setAttribute('aria-label', shortCount(video.plays) + '次播放');
        plays.append(icon('play'), shortCount(video.plays));
        metrics.append(plays);
        const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(video.publishedAt || '');
        if (date) {
          const [, year, month, day] = date;
          const label = (Number(year) === new Date().getFullYear() ? '' : year + '年') + Number(month) + '月' + Number(day) + '日';
          const published = node('time');
          published.dateTime = date[0];
          published.append(icon('clock'), label);
          metrics.append(published);
        }
        text.append(node('strong', '', video.title), metrics);
        item.append(radio, cover, text);
        return item;
      }

      async function display(page = 0) {
        clearTimeout(timer);
        const version = ++lookup;
        const keyword = search.value.trim();
        results.setAttribute('aria-busy', 'true');
        results.replaceChildren(node('p', 'personal-featured-state', '正在加载…'));
        try {
          const choices = await videos({ q: keyword, sort, size: 20, page });
          if (version !== lookup || !dialog.open) return;
          results.replaceChildren();
          if (choices.items.length) {
            const list = node('div', 'personal-featured-video-list');
            list.append(...choices.items.map(choice));
            results.append(list);
          } else {
            const empty = node('div', 'personal-featured-state');
            const picture = node('img');
            picture.alt = '';
            picture.src = '/assets/space-empty.svg';
            empty.append(picture, node('p', '', keyword ? '没有找到匹配的投稿' : '这里还什么都没有呢～'));
            results.append(empty);
          }
          const pages = node('div', 'personal-featured-pages');
          if (page > 0) pages.append(button('上一页', () => display(page - 1)));
          if (choices.hasMore) pages.append(button('下一页', () => display(page + 1)));
          if (pages.childElementCount) results.append(pages);
          results.scrollTop = 0;
        } catch {
          if (version !== lookup || !dialog.open) return;
          const error = node('div', 'personal-featured-state');
          error.append(node('p', '', '投稿加载失败'), button('重试', () => display(page)));
          results.replaceChildren(error);
        } finally {
          if (version === lookup) results.removeAttribute('aria-busy');
        }
      }
      search.oninput = event => {
        if (event.isComposing) return;
        clearTimeout(timer);
        lookup++;
        timer = setTimeout(display, 160);
      };
      search.oncompositionend = () => display();
      searchForm.onsubmit = event => { event.preventDefault(); display(); };
      dialog.addEventListener('pointerdown', event => { if (!sorting.contains(event.target)) sorting.open = false; });
      dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape' && sorting.open) {
          event.preventDefault();
          sorting.open = false;
          sortToggle.focus();
        }
      });
      dialog.addEventListener('close', () => clearTimeout(timer), { once: true });
      return display();
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
      for (const kind of ['following', 'followers']) {
        const stat = el('author-' + kind).parentElement;
        stat.removeAttribute('aria-haspopup');
        stat.onclick = () => navigate('/me?tab=' + kind);
      }
      tabLinks.clear();
      for (const [key, label, symbol] of [
        ['home', '主页', 'space-house'], ['uploads', '投稿 ' + author.videos, 'space-upload'],
        ['lists', '合集和系列', 'space-layers'], ['favorites', '收藏', 'space-favorite'],
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
    peopleCards?.hide();
    peopleActions.clear();
    const currentSpace = space;
    const previousSubscriptions = content.querySelector('.personal-favorite-subscriptions');
    if (previousSubscriptions?.closest('details').open) {
      currentSpace.subscriptionScrollTop = previousSubscriptions.scrollTop;
    }
    const { account, author, uid, preferencesKey } = currentSpace;
    const preferences = currentSpace.preferences;
    const params = new URLSearchParams(location.search);
    const keyword = (params.get('keyword') || '').trim();
    const page = Math.min(10000, Math.max(0, Number.parseInt(params.get('page'), 10) || 0));
    const selectedTab = params.get('tab') || (keyword ? 'uploads' : 'home');
    const relationView = ['following', 'followers'].includes(selectedTab);
    const mode = selectedTab === 'collection' || tabLinks.has(selectedTab) || relationView ? selectedTab : 'home';
    const collectionView = mode === 'lists' || mode === 'collection';
    const activeTab = collectionView ? 'lists' : tabLinks.has(mode) ? mode : '';
    profile.classList.toggle('space-lists', collectionView);
    profile.classList.toggle('space-favorites', mode === 'favorites');
    profile.classList.toggle('space-relations', relationView);
    for (const kind of ['following', 'followers']) {
      const stat = el('author-' + kind).parentElement;
      if (kind === mode) stat.setAttribute('aria-current', 'page');
      else stat.removeAttribute('aria-current');
    }
    const sort = ['popular', 'favorites'].includes(params.get('sort')) ? params.get('sort') : 'latest';
    const url = (changes = {}) => {
      const query = new URLSearchParams(changes).toString();
      return '/me' + (query ? '?' + query : '');
    };
    const signature = el('author-signature');
    const side = profile.querySelector('.space-sidebar');

    function savePreferences(changes) {
      const next = { ...preferences, ...changes };
      localStorage.setItem(preferencesKey, JSON.stringify(next));
      Object.assign(preferences, next);
    }

    function showSignature(restoreFocus = false) {
      const display = button(author.signature || '编辑个性签名', editSignature, 'personal-signature');
      display.title = author.signature || '编辑个性签名';
      signature.replaceChildren(display);
      if (restoreFocus) display.focus();
    }

    function editSignature() {
      const previous = author.signature || '';
      const field = node('input', 'personal-signature-input');
      field.type = 'text';
      field.value = previous;
      field.placeholder = '编辑个性签名';
      field.setAttribute('aria-label', '编辑个性签名');
      let saving = false, finished = false;

      function finish(restoreFocus) {
        finished = true;
        if (space === currentSpace && field.isConnected) showSignature(restoreFocus);
      }

      function limit() {
        const characters = Array.from(field.value);
        if (characters.length > 60) field.value = characters.slice(0, 60).join('');
        field.removeAttribute('aria-invalid');
      }

      async function save(restoreFocus) {
        if (finished || saving || space !== currentSpace) return;
        const value = field.value.trim();
        if (value === previous) {
          finish(restoreFocus);
          return;
        }
        saving = field.readOnly = true;
        try {
          const saved = await authApi('signature', { value });
          author.signature = saved.value;
          finish(restoreFocus && document.activeElement === field);
        } catch (error) {
          if (space !== currentSpace || !field.isConnected) return;
          field.setAttribute('aria-invalid', 'true');
          accountNotice(error.message || '个性签名保存失败');
        } finally {
          saving = field.readOnly = false;
        }
      }

      field.addEventListener('input', event => { if (!event.isComposing) limit(); });
      field.addEventListener('compositionend', limit);
      field.addEventListener('blur', () => save(false));
      field.addEventListener('keydown', event => {
        if (event.isComposing || saving) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          save(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(true);
        }
      });
      signature.replaceChildren(field);
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    }

    function showSidebar() {
      const about = node('section', 'personal-about');
      const heading = node('div', 'profile-card-heading');
      const edit = link('/account/profile', '编辑', 'profile-card-edit');
      edit.setAttribute('aria-label', '编辑个人资料');
      edit.append(icon('right'));
      heading.append(node('h2', '', '个人资料'), edit);
      about.append(heading);
      for (const [label, symbol, value] of [['UID', 'uid', account.uid], ['生日', 'cake', author.birthday]]) {
        if (!value) continue;
        const row = node('p', 'profile-row');
        row.setAttribute('aria-label', label + ' ' + value);
        row.append(icon(symbol), value);
        about.append(row);
      }
      const creator = node('section', 'personal-creator');
      const creatorActions = node('div', 'personal-creator-actions');
      const upload = link('/studio/upload', '视频投稿', 'personal-creator-action');
      upload.prepend(icon('upload'));
      const manage = link('/studio/videos', '投稿管理', 'personal-creator-action');
      manage.prepend(icon('manage'));
      creatorActions.append(upload, manage);
      const title = node('h2', '', '创作中心');
      title.prepend(icon('creator-bulb'));
      title.append(icon('right'));
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
    form.elements.keyword.value = mode === 'favorites' ? '' : keyword;
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
    const loadVideos = (order, videoPage) => videos({
      sort: order, q: mode === 'uploads' ? keyword : '', page: videoPage, size: mode === 'home' ? 5 : 20,
    });
    const folderId = params.get('folder');
    const subscriptionId = params.get('subscription');
    const favoritesUrl = (selection = {}) => url({ tab: 'favorites', ...selection });
    const peopleQuery = mode === 'following' ? (params.get('q') || '').trim().slice(0, 80) : '';
    try {
      if (!currentSpace.summary || mode === 'favorites' || mode === 'home') {
        const summaryRequest = interaction('/me/space').catch(error => {
          if (currentSpace.summary === summaryRequest) currentSpace.summary = null;
          throw error;
        });
        currentSpace.summary = summaryRequest;
      }
      const [summary, collectionContent, result, subscriptions, featured, people, recentVideos] = await Promise.all([
        currentSpace.summary,
        collectionView ? api('/authors/' + uid + '/collections').then(collections => spaceCollectionContent({
          view: mode, params, page, url, collections, navigate,
          videos: options => videos({ size: 20, ...options }),
        })) : null,
        ['home', 'uploads'].includes(mode) ? loadVideos(sort, mode === 'uploads' ? page : 0) : null,
        mode === 'favorites' ? interaction('/me/subscriptions') : null,
        mode === 'home' && /^\d+$/.test(preferences.featured || '')
          ? api('/videos/' + preferences.featured).then(detail => detail.video).catch(() => null) : null,
        relationView ? interaction('/me/relations/' + mode + '?' + new URLSearchParams({ q: peopleQuery, page })) : null,
        mode === 'home' ? interaction('/me/recent-videos').catch(() => null) : null,
      ]);
      if (request !== revision) return;
      tabLinks.get('favorites').lastElementChild.textContent = '收藏 ' + summary.folders.length;
      if (!counts.querySelector('.personal-stat')) {
        for (const [label, count] of [['获赞数', summary.stats.likes], ['播放数', summary.stats.plays]]) {
          const item = node('span', 'personal-stat', label);
          item.append(node('strong', '', shortCount(count)));
          counts.append(item);
        }
      }
      alignIndicator();
      content.replaceChildren();

      function showFeatured() {
        const panel = node('section', 'personal-featured space-section');
        if (featured?.authorId === account.uid) {
          const section = block('代表作', [button('更换代表作', chooseFeatured)]);
          section.append(grid([featured], videoCard, ''));
          if (preferences.featuredNote) section.append(node('p', 'personal-featured-note', preferences.featuredNote));
          panel.append(section);
        } else {
          const prompt = node('div', 'personal-featured-prompt');
          const image = node('img');
          image.src = '/assets/space-featured.png';
          image.alt = '';
          const copy = node('div');
          const description = node('p');
          description.append('代表作是新访客看到的第一个视频，', node('br'), '选择你的得意之作，吸引新访客立即关注你吧！');
          copy.append(description, button('＋ 代表作视频', chooseFeatured, 'personal-primary'));
          prompt.append(image, copy);
          panel.append(prompt);
        }
        content.append(panel);
      }

      function chooseFeatured() {
        const current = featured?.authorId === account.uid ? featured.id : '';
        return featuredPicker(videos, current, current ? preferences.featuredNote : '', (id, note) => {
          if (space !== currentSpace || request !== revision) return;
          savePreferences({ featured: id, featuredNote: note });
          render();
        });
      }

      function showVideos() {
        const filters = node('nav', 'space-sort');
        filters.setAttribute('aria-label', '视频排序');
        const query = mode === 'uploads' ? { tab: 'uploads', ...(keyword ? { keyword } : {}) } : {};
        let currentSort = sort;
        let currentPage = mode === 'uploads' ? page : 0;
        let sortRequest = 0;
        const options = new Map();
        for (const [key, label] of [['latest', '最新发布'], ['popular', '最多播放'], ['favorites', '最多收藏']]) {
          const option = link(url({ ...query, sort: key }), label);
          option.addEventListener('click', event => {
            if (!isPlainLinkClick(event)) return;
            event.preventDefault();
            updateSort(key);
          });
          options.set(key, option);
          filters.append(option);
        }
        const tools = node('div', 'space-video-actions');
        const more = mode === 'home' ? link(url({ tab: 'uploads', sort }), '查看更多 ›', 'secondary') : null;
        if (more) tools.append(more);
        const title = mode === 'uploads' ? (keyword ? '搜索结果' : '我的视频') : '视频 · ' + author.videos;
        const list = block(title, [filters, tools]);
        const feedback = node('p', 'space-empty');
        feedback.setAttribute('role', 'status');
        feedback.hidden = true;
        let cards;
        const pager = node('nav', 'pagination');
        pager.setAttribute('aria-label', '视频分页');
        list.append(feedback);
        content.append(list);
        if (mode === 'uploads') content.append(pager);
        drawVideos(result);

        function drawVideos(videoPage) {
          const nextCards = grid(videoPage.items, videoCard, keyword ? '没有找到相关视频' : '暂无公开视频');
          if (cards) cards.replaceWith(nextCards);
          else list.append(nextCards);
          cards = nextCards;
          for (const [key, option] of options) {
            option.classList.toggle('active', key === currentSort);
            if (key === currentSort) option.setAttribute('aria-current', 'true');
            else option.removeAttribute('aria-current');
          }
          if (more) more.href = url({ tab: 'uploads', sort: currentSort });
          if (mode !== 'uploads') return;
          pager.replaceChildren();
          pager.hidden = !(currentPage || videoPage.hasMore);
          if (pager.hidden) return;
          if (currentPage) pager.append(link(url({ ...query, sort: currentSort, page: currentPage - 1 }), '上一页', 'secondary'));
          pager.append(node('span', '', '第 ' + (currentPage + 1) + ' 页'));
          if (videoPage.hasMore) pager.append(link(url({ ...query, sort: currentSort, page: currentPage + 1 }), '下一页', 'secondary'));
        }

        async function updateSort(order) {
          const pending = ++sortRequest;
          feedback.hidden = true;
          if (order === currentSort && !currentPage) {
            list.removeAttribute('aria-busy');
            return;
          }
          list.setAttribute('aria-busy', 'true');
          try {
            const updated = await loadVideos(order, 0);
            if (request !== revision || pending !== sortRequest) return;
            currentSort = order;
            currentPage = 0;
            history.replaceState(history.state, '', url({ ...query, sort: order }));
            drawVideos(updated);
          } catch {
            if (request !== revision || pending !== sortRequest) return;
            feedback.textContent = '排序更新失败，请重试';
            feedback.hidden = false;
          } finally {
            if (pending === sortRequest) list.removeAttribute('aria-busy');
          }
        }
      }

      function showFolderPreview() {
        const section = block('收藏夹', [
          node('span', 'personal-favorite-total', '·  ' + summary.folders.length),
          privateLabel(),
          link(favoritesUrl(), '查看更多 ›', 'secondary'),
        ]);
        section.classList.add('personal-favorite-preview');
        section.append(grid(summary.folders.slice(0, 5), folder => {
          const entry = link(favoritesUrl({ folder: folder.id }), null, 'personal-favorite-tile');
          const stack = favoriteCover(folder.coverVideoId);
          const overlay = node('span', 'personal-favorite-count', folder.count + '个视频');
          if (folder.privateFolder) overlay.prepend(icon('space-lock'));
          stack.firstElementChild.append(overlay);
          entry.append(stack, node('h3', '', folder.name),
            node('p', '', folder.privateFolder ? '私有' : '公开'));
          return entry;
        }, '暂无收藏夹'));
        content.append(section);
      }

      function showRecentVideos(title, entries, emptyMessage) {
        const section = block(title, [privateLabel()]);
        section.classList.add('personal-recent-videos');
        section.append(grid(entries || [], video => card({ ...video, publishedAt: null }),
          entries ? emptyMessage : '暂时无法加载视频'));
        content.append(section);
      }

      async function showFavorites() {
        const folders = summary.folders;
        const selectedSubscription = subscriptions.find(item => item.id === subscriptionId);
        const selectedFolder = selectedSubscription ? null : folders.find(item => item.id === folderId) || folders[0];
        const selected = selectedSubscription || selectedFolder || subscriptions[0];
        const isSubscription = Boolean(selected && !selectedFolder);
        const layout = node('div', 'personal-favorite-layout');
        const navigation = node('nav', 'personal-favorite-nav');
        navigation.setAttribute('aria-label', '收藏列表');
        const detail = node('section', 'personal-favorite-detail');
        layout.append(navigation, detail);
        content.append(layout);

        function folderEditor() {
          interactionPanel('新建收藏夹', (body, feedback, close) => {
            const dialog = body.closest('dialog');
            dialog.classList.add('personal-folder-dialog');
            const closeButton = dialog.querySelector('.interaction-close');
            closeButton.textContent = '×';
            closeButton.setAttribute('aria-label', '关闭');
            const form = node('form', 'personal-folder-form');
            const name = node('input');
            name.required = true;
            name.placeholder = '快来给你的收藏夹命名吧';
            const description = node('textarea');
            description.placeholder = '可以简单描述下你的收藏夹';
            description.rows = 4;
            const visibility = node('label', 'personal-folder-visibility');
            const publiclyVisible = node('input', 'personal-folder-switch');
            publiclyVisible.type = 'checkbox';
            publiclyVisible.checked = true;
            publiclyVisible.setAttribute('role', 'switch');
            visibility.append(node('span', '', '公开'), publiclyVisible);
            const cancel = button('取消', close, 'secondary');
            const create = node('button', 'personal-primary', '创建');
            create.type = 'submit';
            create.disabled = true;
            let saving = false;

            function textField(title, field, max) {
              const label = node('label', 'personal-folder-field');
              const heading = node('span', '', title);
              if (field.required) {
                const required = node('span', 'personal-folder-required', ' *');
                required.setAttribute('aria-hidden', 'true');
                heading.append(required);
              }
              const control = node('span', 'personal-folder-control');
              const count = node('span', 'personal-folder-count', '0 / ' + max);
              count.setAttribute('aria-hidden', 'true');
              control.append(field, count);
              label.append(heading, control);
              function measure() {
                const characters = Array.from(field.value);
                if (characters.length > max) field.value = characters.slice(0, max).join('');
                count.textContent = Math.min(characters.length, max) + ' / ' + max;
                create.disabled = saving || !name.value.trim();
              }
              field.addEventListener('input', event => { if (!event.isComposing) measure(); });
              field.addEventListener('compositionend', measure);
              return label;
            }

            const actions = node('div', 'personal-folder-actions');
            actions.append(cancel, create);
            form.append(textField('名称', name, 20), visibility, textField('简介', description, 200), feedback, actions);
            body.append(form);
            dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
            form.addEventListener('submit', async event => {
              event.preventDefault();
              if (saving || !name.value.trim()) return;
              saving = closeButton.disabled = cancel.disabled = create.disabled = true;
              feedback.textContent = '';
              try {
                const created = await interaction('/me/folders', 'POST', {
                  name: name.value.trim(), publiclyVisible: publiclyVisible.checked, description: description.value.trim(),
                });
                close();
                if (space === currentSpace) await navigate(favoritesUrl({ folder: created.id }));
              } catch (error) {
                feedback.textContent = error.message;
              } finally {
                saving = closeButton.disabled = cancel.disabled = false;
                create.disabled = !name.value.trim();
              }
            });
            name.focus();
          });
        }

        const collapsedGroups = currentSpace.collapsedFavoriteGroups ||= new Set();
        for (const { title, items, key, symbol } of [
          { title: '我创建的收藏夹', items: folders, key: 'folder', symbol: 'space-folder' },
          { title: '我订阅的合集', items: subscriptions, key: 'subscription', symbol: 'space-layers' },
        ]) {
          const group = node('details', 'personal-favorite-group');
          const subscriptionsList = key === 'subscription' ? node('div', 'personal-favorite-subscriptions') : null;
          const entries = subscriptionsList || group;
          let activeEntry;
          if (items.includes(selected)) collapsedGroups.delete(key);
          group.open = !collapsedGroups.has(key);
          group.addEventListener('toggle', () => {
            if (!group.isConnected) return;
            if (group.open) {
              collapsedGroups.delete(key);
              restoreSubscriptions();
            } else collapsedGroups.add(key);
          });
          group.append(node('summary', '', title));
          if (subscriptionsList) {
            subscriptionsList.setAttribute('role', 'region');
            subscriptionsList.setAttribute('aria-label', title);
            if (items.length) subscriptionsList.tabIndex = 0;
            subscriptionsList.addEventListener('scroll', () => {
              if (group.isConnected && group.open) currentSpace.subscriptionScrollTop = subscriptionsList.scrollTop;
            });
            group.append(subscriptionsList);
          }
          if (key === 'folder') {
            const add = button('', folderEditor, 'personal-favorite-entry personal-favorite-add');
            add.append(icon('space-folder-add'), node('span', '', '新建收藏夹'));
            group.append(add);
          }
          for (const item of items) {
            const entry = link(favoritesUrl({ [key]: item.id }), null, 'personal-favorite-entry');
            if (item === selected) {
              entry.setAttribute('aria-current', 'page');
              activeEntry = entry;
            }
            const label = node('span', '', item.name);
            label.title = item.name;
            entry.append(icon(item.privateFolder ? 'space-folder-lock' : symbol), label,
              node('small', '', String(item.count)));
            entries.append(entry);
          }
          if (subscriptionsList && !items.length) entries.append(node('p', 'space-empty', '暂无订阅的合集'));
          navigation.append(group);
          restoreSubscriptions();

          function restoreSubscriptions() {
            if (!subscriptionsList || !group.open) return;
            subscriptionsList.scrollTop = currentSpace.subscriptionScrollTop || 0;
            if (!activeEntry) return;
            const viewport = subscriptionsList.getBoundingClientRect();
            const row = activeEntry.getBoundingClientRect();
            subscriptionsList.scrollTop += Math.min(0, row.top - viewport.top)
              || Math.max(0, row.bottom - viewport.bottom);
          }
        }

        if (!selected) {
          detail.append(node('p', 'space-empty', '暂无收藏夹或订阅的合集'));
          return;
        }
        const header = node('div', 'personal-favorite-header');
        const info = node('div', 'personal-favorite-info');
        const meta = node('div', 'personal-favorite-meta');
        if (isSubscription) meta.append(
          link('/space/' + encodeURIComponent(selected.authorId), '合集 · UP主 ' + selected.author + ' ›', 'personal-favorite-owner'));
        meta.append(node('p', '', (selected.privateFolder ? '私密' : '公开') + '　视频数 ' + selected.count
          + (isSubscription ? '　播放量 ' + shortCount(selected.plays) : '')));
        if (!isSubscription && selected.description) {
          meta.append(node('p', 'personal-favorite-description', selected.description));
        }
        const actions = node('div', 'personal-favorite-actions');
        info.append(node('h2', '', selected.name), meta, actions);
        header.append(favoriteCover(selected.coverVideoId), info);
        const results = node('div', 'personal-favorite-results');
        results.setAttribute('aria-live', 'polite');
        const pager = node('nav', 'pagination');
        pager.setAttribute('aria-label', '收藏视频分页');
        const loading = node('p', 'space-empty', '正在加载视频…');
        results.append(loading);
        detail.append(header, results, pager);
        const pageSize = 30;
        const playlist = isSubscription ? 'collection' : 'folder-' + selected.id;
        const playUrl = id => '/video/' + encodeURIComponent(id) + '?playlist=' + playlist;
        if (selected.coverVideoId) {
          const playAll = link(playUrl(selected.coverVideoId), null, 'personal-primary');
          playAll.append(icon('space-play-all'), '播放全部');
          actions.append(playAll);
        }

        function showResults(items, hasMore, nextPage) {
          results.replaceChildren(grid(items, video => {
            if (isSubscription) {
              const entry = videoCard(video);
              entry.querySelector('.card-byline').textContent = favoriteDate(video.publishedAt);
              return entry;
            }
            const entry = card({
              ...video, publishedAt: null, coverUrl: '/api/videos/' + encodeURIComponent(video.id) + '/cover',
            });
            if (video.collectedAt) {
              entry.querySelector('.card-byline').append(' · 收藏于' + favoriteDate(video.collectedAt));
            }
            return entry;
          }, selected.count ? '没有找到相关视频' : '暂无视频'));
          pager.replaceChildren();
          if (nextPage || hasMore) {
            if (nextPage) pager.append(link(pageUrl(nextPage - 1), '上一页', 'secondary'));
            pager.append(node('span', '', '第 ' + (nextPage + 1) + ' 页'));
            if (hasMore) pager.append(link(pageUrl(nextPage + 1), '下一页', 'secondary'));
          }
        }

        const currentQuery = isSubscription ? '' : keyword;
        const currentSort = ['popular', 'latest'].includes(params.get('sort')) ? params.get('sort') : 'recent';
        const selection = isSubscription ? { subscription: selected.id } : { folder: selected.id, sort: currentSort };
        const pageUrl = nextPage => favoritesUrl({
          ...selection, ...(currentQuery ? { keyword: currentQuery } : {}), ...(nextPage ? { page: nextPage } : {}),
        });

        if (!isSubscription) {
          const toolbar = node('div', 'personal-favorite-toolbar');
          const filters = node('div', 'personal-favorite-filters');
          for (const [value, label] of [['recent', '最近收藏'], ['popular', '最多播放'], ['latest', '最近投稿']]) {
            const filter = link(favoritesUrl({ ...selection, sort: value, ...(currentQuery ? { keyword: currentQuery } : {}) }), label);
            if (value === currentSort) filter.setAttribute('aria-current', 'true');
            filters.append(filter);
          }
          const search = node('form', 'personal-favorite-search');
          search.setAttribute('role', 'search');
          const input = node('input');
          input.type = 'search';
          input.placeholder = '搜索当前收藏夹';
          input.setAttribute('aria-label', input.placeholder);
          input.value = currentQuery;
          input.maxLength = 80;
          const submit = node('button');
          submit.setAttribute('aria-label', '搜索');
          submit.append(icon('search'));
          search.append(input, submit);
          search.onsubmit = event => {
            event.preventDefault();
            const query = input.value.trim();
            navigate(favoritesUrl({ ...selection, ...(query ? { keyword: query } : {}) }));
          };
          toolbar.append(filters, search);
          header.after(toolbar);
        }

        try {
          if (isSubscription) {
            const videos = selected.coverVideoId
              ? (await api('/videos/' + encodeURIComponent(selected.coverVideoId) + '/collection')).items
              : [];
            if (request !== revision) return;
            showResults(videos.slice(page * pageSize, (page + 1) * pageSize),
              videos.length > (page + 1) * pageSize, page);
          } else {
            const saved = await interaction('/me/folders/' + selected.id + '/videos');
            if (request !== revision) return;
            const needle = currentQuery.toLowerCase();
            const matching = saved.filter(video => video.title.toLowerCase().includes(needle));
            if (currentSort === 'popular') matching.sort((a, b) => b.plays - a.plays);
            if (currentSort === 'latest') matching.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
            showResults(matching.slice(page * pageSize, (page + 1) * pageSize),
              matching.length > (page + 1) * pageSize, page);
          }
        } catch {
          results.replaceChildren(node('p', 'space-empty', '视频加载失败'), button('重新加载', render));
        }
      }

      function showPeople() {
        peopleCards ||= setupCommentMentionCards({
          preferAbove: true,
          onFollowChange: (id, state) => peopleActions.get(id)?.(state),
        });
        const layout = node('div', 'space-relations-layout');
        const nav = node('nav', 'space-relations-nav');
        nav.setAttribute('aria-label', '关注和粉丝');
        const countLabels = {};
        for (const [kind, heading, label, symbol] of [
          ['following', '我的关注', '全部关注', 'space-following'],
          ['followers', '我的粉丝', '我的粉丝', 'space-followers'],
        ]) {
          const group = node('div', 'space-relations-group');
          const entry = link(url({ tab: kind }), null, 'space-relations-nav-entry');
          if (mode === kind) entry.setAttribute('aria-current', 'page');
          countLabels[kind] = node('span', 'space-relations-count', String(author[kind]));
          entry.append(icon(symbol), node('span', '', label), countLabels[kind]);
          group.append(node('h2', '', heading), entry);
          nav.append(group);
        }
        const section = node('section', 'space-relations-panel');
        const isFollowing = mode === 'following';
        section.append(node('h2', '', isFollowing ? '全部关注' : '我的粉丝'));
        const listUrl = (index = 0, q = peopleQuery) => url({
          tab: mode, ...(q ? { q } : {}), ...(index ? { page: index } : {}),
        });
        if (isFollowing) {
          const search = node('form', 'space-relations-search');
          search.setAttribute('role', 'search');
          const input = node('input');
          input.type = 'search';
          input.value = peopleQuery;
          input.maxLength = 80;
          input.placeholder = '输入关键词';
          input.setAttribute('aria-label', '搜索已关注的用户');
          const submit = node('button');
          submit.type = 'submit';
          submit.setAttribute('aria-label', '搜索');
          submit.append(icon('search'));
          search.append(input, submit);
          search.addEventListener('submit', event => {
            event.preventDefault();
            navigate(listUrl(0, input.value.trim()));
          });
          section.append(search);
        }
        const list = node('div', 'space-relations-people');
        for (const person of people.items) {
          const entry = node('article', 'space-relations-person');
          const href = '/space/' + encodeURIComponent(person.id);
          const avatar = link(href, null, 'space-relations-avatar');
          avatar.setAttribute('aria-label', person.name + '的个人空间');
          const image = commentMentionAvatar(person.id);
          image.loading = 'lazy';
          avatar.append(image);
          peopleCards.bind(avatar, person.id);
          const details = node('div', 'space-relations-person-info');
          const signature = node('p', 'space-relations-signature', person.signature || '这个人没有填简介');
          if (person.signature) signature.title = person.signature;
          const follow = button('', null, 'space-relations-follow');

          function updateButton() {
            const label = person.following ? (person.followsYou ? '已互粉' : '已关注') : '回关';
            follow.textContent = label;
            if (person.following) follow.prepend(icon('space-follow-menu'));
            follow.setAttribute('aria-pressed', String(person.following));
            follow.title = person.following ? '取消关注' : '回关';
            follow.setAttribute('aria-label', label + '，' + (person.following ? '点击取消关注' : '点击关注') + person.name);
          }

          function applyRelation(state) {
            if (request !== revision || person.following === state.following) return;
            person.following = state.following;
            author.following = Math.max(0, author.following + (state.following ? 1 : -1));
            el('author-following').textContent = shortCount(author.following);
            countLabels.following.textContent = String(author.following);
            if (isFollowing && !state.following) render();
            else updateButton();
          }

          peopleActions.set(person.id, applyRelation);
          memberAction(follow, async () => {
            const state = await interaction('/authors/' + encodeURIComponent(person.id) + '/relation/follow',
              'PUT', { enabled: !person.following });
            peopleCards.hide();
            applyRelation(state);
          });
          updateButton();
          details.append(link(href, person.name, 'space-relations-person-name'), signature, follow);
          entry.append(avatar, details);
          list.append(entry);
        }
        section.append(people.items.length ? list : node('p', 'space-empty',
          peopleQuery ? '没有找到匹配的用户' : isFollowing ? '暂无关注' : '暂无粉丝'));
        const totalPages = Math.ceil(people.total / people.size);
        if (totalPages > 1) {
          const pager = node('nav', 'pagination space-relations-pagination');
          pager.setAttribute('aria-label', '用户列表分页');
          if (people.page) pager.append(link(listUrl(people.page - 1), '上一页', 'secondary'));
          for (let index = Math.max(0, people.page - 2); index < Math.min(totalPages, people.page + 3); index++) {
            const entry = link(listUrl(index), String(index + 1), 'secondary');
            if (index === people.page) entry.setAttribute('aria-current', 'page');
            pager.append(entry);
          }
          if (people.page + 1 < totalPages) pager.append(link(listUrl(people.page + 1), '下一页', 'secondary'));
          const jump = node('form', 'space-relations-jump');
          const input = node('input');
          input.type = 'number';
          input.min = 1;
          input.max = totalPages;
          input.required = true;
          input.setAttribute('aria-label', '跳转页码');
          const go = node('button', 'secondary', '跳转');
          go.type = 'submit';
          jump.append(node('span', '', '共 ' + totalPages + ' 页 / ' + people.total + ' 个'), input, go);
          jump.addEventListener('submit', event => {
            event.preventDefault();
            navigate(listUrl(input.valueAsNumber - 1));
          });
          pager.append(jump);
          section.append(pager);
        }
        if (page !== people.page) history.replaceState(history.state, '', listUrl(people.page));
        layout.append(nav, section);
        content.append(layout);
      }

      if (mode === 'home') {
        showFeatured();
        showVideos();
        showFolderPreview();
        showRecentVideos('最近投币的视频', recentVideos?.coined, '暂无投币的视频');
        showRecentVideos('最近点赞的视频', recentVideos?.liked, '暂无点赞的视频');
      } else if (mode === 'uploads') {
        showVideos();
      } else if (collectionView) {
        content.append(...collectionContent);
      } else if (mode === 'favorites') {
        await showFavorites();
      } else if (relationView) {
        showPeople();
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
    if (!entry || !isPlainLinkClick(event)) return;
    const target = new URL(entry.href);
    if (target.origin !== location.origin || target.pathname !== '/me') return;
    event.preventDefault();
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

