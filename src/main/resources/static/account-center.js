function setupAccountCenter() {
  const root = el('account-center');
  el('ac-hero').hidden = false;
  const tabs = [
    ['/account', '首页', 'home-outline'],
    ['/account/profile', '我的信息', 'user'],
    ['/account/blocked', '黑名单管理', 'user-block'],
    ['/account/coins', '我的硬币', 'coin'],
    ['/account/experience', '经验记录', 'clock']
  ];
  const selected = tabs.find(([href]) => href !== '/account' && (path === href || path.startsWith(href + '/'))) || tabs[0];
  const avatarPage = path === '/account/profile/avatar';
  const coinHistory = path === '/account/coins/history';
  let version = 0;

  const navLink = (href, label, css) => {
    const entry = link(href, label, css);
    entry.target = '_self';
    return entry;
  };

  const action = (label, css = 'ac-button') => {
    const entry = node('button', css, label);
    entry.type = 'button';
    return entry;
  };

  async function request(endpoint, method = 'GET', data) {
    const options = { method, cache: 'no-store' };
    if (method !== 'GET') {
      options.headers = { 'X-CSRF-Token': (await authApi('csrf')).token };
      if (data instanceof FormData) options.body = data;
      else if (data !== undefined) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(data);
      }
    }
    const response = await fetch('/api/account-center' + endpoint, options);
    if (response.status === 204) return;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || '操作失败，请稍后重试');
    return payload;
  }

  function savedDialog() {
    let mask = el('ac-saved-dialog');
    if (!mask) {
      mask = node('div', 'ac-dialog');
      mask.id = 'ac-saved-dialog';
      mask.setAttribute('role', 'dialog');
      mask.setAttribute('aria-modal', 'true');
      mask.setAttribute('aria-label', '提示');
      const box = node('div', 'ac-dialog-box');
      const head = node('div', 'ac-dialog-head');
      const close = node('button', 'ac-dialog-close', '×');
      close.type = 'button';
      close.setAttribute('aria-label', '关闭');
      head.append(node('span', 'ac-dialog-title', '提示'), close);
      const body = node('div', 'ac-dialog-body');
      const ok = node('button', 'ac-dialog-ok', '确定');
      ok.type = 'button';
      body.append(node('div', 'ac-dialog-img'), node('p', 'ac-dialog-explain', '已经成功更新你的资料'), ok);
      box.append(head, body);
      mask.append(box);
      document.body.append(mask);
      const hide = () => {
        mask.classList.remove('is-open');
        document.body.style.overflow = '';
      };
      close.onclick = hide;
      ok.onclick = hide;
    }
    mask.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function photo(uid, description, css = 'ac-avatar') {
    const img = node('img', css);
    img.alt = description;
    img.src = '/api/authors/' + encodeURIComponent(uid) + '/avatar';
    img.onerror = () => {
      img.onerror = null;
      img.src = '/assets/guest-avatar.gif';
    };
    return img;
  }

  function format(value) {
    return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value);
  }

  async function homepage(section, user) {
    const data = await request('/overview');
    const info = node('div', 'index-info');
    const head = navLink('/me', '', 'home-head');
    head.append(photo(user.uid, '个人空间', 'home-head-img'), node('span', 'gotoSpace', '个人空间'));
    const right = node('div', 'home-right');
    const msg = node('div', 'home-top-msg');
    msg.append(node('span', 'home-top-msg-name', data.identity.name), node('span', 'home-userstatus', '正式会员'));
    const { level, experience, threshold, nextThreshold } = data.identity;
    const levelLine = node('div', 'home-top-level-all');
    const wrap = node('div', 'home-top-progress-wrap');
    wrap.append(node('span', 'home-top-level-head', level));
    const bar = node('div', 'home-top-level-up');
    const fill = node('div', 'home-top-level-upgo');
    fill.style.width = nextThreshold > threshold
      ? Math.min(100, Math.max(0, (experience - threshold) / (nextThreshold - threshold) * 100)) + '%' : '100%';
    bar.append(fill);
    wrap.append(bar);
    const number = node('span', 'home-top-level-number');
    number.append(node('i', 'now-num', String(experience)), node('i', 'num-icon', '/'),
      node('i', 'max-num', nextThreshold ? String(nextThreshold) : 'MAX'));
    levelLine.append(wrap, number, navLink('/account/profile', '修改资料', 'home-to-update'));
    const space = navLink('/me', '个人空间', 'home-to-space');
    const spaceArrow = icon('right');
    spaceArrow.classList.add('m-arrow');
    space.append(spaceArrow);
    levelLine.append(space);
    const wallet = node('div', 'home-top-bp');
    wallet.append(node('span', 'curren-b'), node('span', 'curren-b-num', format(data.bcoins)));
    wallet.append(navLink('/account/coins', '', 'coin-link'), node('span', 'curren-b-num', format(data.coins)));
    right.append(msg, levelLine, wallet);
    info.append(head, right);
    const daily = node('div', 'home-daily-task-wrap');
    const dailyIcon = node('span', 'home-daily-task-icon');
    daily.append(dailyIcon, node('span', 'home-daily-task-title', '每日奖励'),
      navLink('/account/experience', '查看经验记录', 'home-daily-task-more'));
    const exp = node('div', 'home-daily-exp');
    data.rewards.forEach((reward, index) => {
      const done = reward.earned >= reward.maximum;
      const item = node('div', 'home-daily-exp-item');
      const circle = node('div', done ? 'home-daily-exp-icon position-ok' : 'home-daily-exp-icon position-rest');
      if (!done) circle.append(node('i', 'home-daily-exp-i', reward.maximum), node('i', 'home-daily-exp-i-2', 'EXP'));
      item.append(circle, node('p', 're-exp-info', reward.title),
        done ? node('p', 're-exp-getexp', reward.maximum + '经验值到手')
          : node('p', 're-exp-none', '已获得 ' + reward.earned + ' / ' + reward.maximum));
      if (index < data.rewards.length - 1) item.append(node('div', 'h-line'));
      exp.append(item);
    });
    daily.append(exp);
    const medals = node('div', 'home-mp');
    const medalIcon = node('span', 'home-mp-icon');
    medals.append(medalIcon, node('span', 'h-reward-info', '成就勋章'), node('p', 'h-none-msg', '暂无成就勋章'));
    section.append(info, daily, medals);
  }

  function field(label, id, control, help) {
    const row = node('div', 'ac-field');
    const name = node('label', '', label);
    name.htmlFor = id;
    control.id = id;
    const main = node('div', 'ac-field-main');
    main.append(control);
    if (help) {
      const note = node('small', 'ac-field-note', help);
      note.id = id + '-help';
      control.setAttribute('aria-describedby', note.id);
      main.append(note);
    }
    row.append(name, main);
    return row;
  }

  async function profile(section, status, user, active) {
    let data = await request('/profile');
    const form = node('form', 'ac-fields');
    const avatar = navLink('/account/profile/avatar', '', 'ac-avatar-link');
    avatar.append(photo(user.uid, ''), node('span', '', '更换头像'));
    form.append(field('头像：', 'account-avatar-link', avatar));
    const name = node('input');
    name.required = true;
    name.maxLength = 32;
    name.value = data.name;
    form.append(field('昵称：', 'account-name', name, '注：修改一次昵称需要消耗6个硬币'));
    const uid = node('output', 'ac-static', user.uid);
    form.append(field('UID：', 'account-uid', uid));
    const signature = node('textarea');
    signature.maxLength = 60;
    signature.rows = 4;
    signature.placeholder = '设置您的签名';
    signature.value = data.signature || '';
    form.append(field('我的签名：', 'account-signature', signature));
    const gender = node('div', 'ac-gender');
    gender.dataset.value = data.gender;
    for (const [value, text] of [[0, '男'], [1, '女'], [2, '保密']]) {
      const option = action(text, 'ac-gender-option');
      option.classList.toggle('is-on', data.gender === value);
      option.onclick = () => {
        gender.dataset.value = value;
        for (const button of gender.children) button.classList.toggle('is-on', button === option);
      };
      gender.append(option);
    }
    form.append(field('性别：', 'account-gender', gender));
    const birthday = node('input');
    birthday.type = 'date';
    birthday.value = data.birthday || '';
    birthday.max = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
    form.append(field('出生日期：', 'account-birthday', birthday));
    const footer = node('div', 'ac-form-footer');
    const save = action('保存', 'ac-button ac-primary ac-save');
    save.type = 'submit';
    footer.append(save);
    form.append(footer);
    form.onsubmit = async event => {
      event.preventDefault();
      if (save.disabled) return;
      save.disabled = true;
      status.textContent = '';
      try {
        data = await request('/profile', 'PUT', {
          name: name.value, signature: signature.value, gender: Number(gender.dataset.value), birthday: birthday.value || null
        });
        if (!active()) return;
        name.value = data.name;
        signature.value = data.signature || '';
        if (user.name !== data.name) {
          user.name = data.name;
          el('card-name').textContent = data.name;
          el('nav-account-space').title = data.name + '的个人空间';
          loadAccountCard(user.uid);
        }
        savedDialog();
      } catch (error) { status.textContent = error.message; }
      finally { save.disabled = false; }
    };
    section.append(form);
  }

  function avatarEditor(section, status, user, active) {
    const editor = node('form', 'ac-avatar-editor');
    const picker = node('input');
    picker.type = 'file';
    picker.accept = 'image/jpeg,image/png';
    picker.id = 'account-avatar-file';
    const preview = photo(user.uid, '当前头像', 'ac-avatar ac-avatar-preview');
    const current = node('figcaption', 'ac-muted', '当前头像');
    const picture = node('figure');
    picture.append(preview, current);
    const controls = node('div', 'ac-avatar-controls');
    const label = node('label', '', '选择本地图片');
    label.htmlFor = picker.id;
    controls.append(label, picker, node('p', 'ac-muted', 'JPG 或 PNG，小于 2 MB，最短边至少 180 像素。头像会居中裁成正方形。'));
    const submit = action('更新头像', 'ac-button ac-primary');
    submit.type = 'submit';
    submit.disabled = true;
    controls.append(submit);
    editor.append(picture, controls);
    let previewUrl;
    let savedUrl = preview.src;
    function revoke() {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    picker.onchange = () => {
      revoke();
      const file = picker.files[0];
      preview.src = savedUrl;
      current.textContent = '当前头像';
      status.textContent = '';
      submit.disabled = true;
      if (!file) return;
      if (file.size >= 2 * 1024 * 1024) {
        status.textContent = '头像图片须小于 2 MB';
        return;
      }
      const url = URL.createObjectURL(file);
      previewUrl = url;
      const check = new Image();
      check.onload = () => {
        if (!active() || previewUrl !== url) return;
        if (Math.min(check.width, check.height) < 180) {
          status.textContent = '头像图片的最短边须至少 180 像素';
          revoke();
          return;
        }
        preview.src = url;
        current.textContent = '新头像预览';
        submit.disabled = false;
      };
      check.onerror = () => {
        if (!active() || previewUrl !== url) return;
        status.textContent = '无法读取所选图片';
        revoke();
      };
      check.src = url;
    };
    window.addEventListener('pagehide', revoke, { once: true });
    editor.onsubmit = async event => {
      event.preventDefault();
      if (submit.disabled || !picker.files.length) return;
      picker.disabled = submit.disabled = true;
      status.textContent = '正在上传头像…';
      const body = new FormData();
      body.append('image', picker.files[0]);
      try {
        const result = await request('/avatar', 'POST', body);
        if (!active()) return;
        picker.value = '';
        savedUrl = result.avatar;
        preview.src = result.avatar;
        el('nav-account-image').src = result.avatar;
        current.textContent = '当前头像';
        status.textContent = '头像已更新';
      } catch (error) { status.textContent = error.message; submit.disabled = false; }
      finally {
        if (submit.disabled) revoke();
        picker.disabled = false;
      }
    };
    section.append(editor);
    return revoke;
  }

  function ledgerTable(title) {
    const wrapper = node('div', 'ac-table-wrap');
    const table = node('table', 'ac-table');
    table.setAttribute('aria-label', title);
    const header = node('thead');
    const headings = node('tr');
    for (const label of ['时间', '变化', '原因']) {
      const th = node('th', '', label);
      th.scope = 'col';
      headings.append(th);
    }
    header.append(headings);
    const body = node('tbody');
    table.append(header, body);
    wrapper.append(table);
    const append = rows => {
      for (const entry of rows) {
        const row = node('tr');
        const time = node('time', '', entry.time.replace('T', ' '));
        time.dateTime = entry.time;
        const date = node('td');
        date.append(time);
        const amount = node('td', 'ac-gain', format(entry.change));
        row.append(date, amount, node('td', '', entry.reason));
        body.append(row);
      }
    };
    return { wrapper, append };
  }

  async function paged(section, status, load, append, emptyText) {
    let offset = 0;
    const more = action('加载更多', 'ac-button ac-more');
    more.hidden = true;
    async function next() {
      more.disabled = true;
      try {
        const page = await load(offset);
        if (!offset && !page.items.length) section.insertBefore(node('p', 'ac-empty', emptyText), more);
        append(page.items);
        offset += page.items.length;
        more.hidden = !page.hasMore;
        status.textContent = '';
      } catch (error) {
        status.textContent = error.message;
        more.hidden = false;
      } finally { more.disabled = false; }
    }
    more.onclick = next;
    section.append(more);
    await next();
  }

  async function blocked(section, status, active) {
    const rows = [];
    for (let offset = 0; ;) {
      const page = await request('/blocked?offset=' + offset);
      rows.push(...page.items);
      offset += page.items.length;
      if (!page.hasMore || !page.items.length) break;
    }
    const size = 10;
    const list = node('ul', 'ac-blocked');
    const empty = node('p', 'ac-empty', '黑名单为空');
    const pager = node('div', 'ac-pager');
    section.append(list, empty, pager);
    let page = 1;
    function render() {
      const pages = Math.max(1, Math.ceil(rows.length / size));
      page = Math.min(Math.max(1, page), pages);
      list.replaceChildren();
      empty.hidden = rows.length > 0;
      pager.hidden = rows.length === 0;
      const start = (page - 1) * size;
      for (const row of rows.slice(start, start + size)) {
        const item = node('li');
        const identity = node('div', 'ac-blocked-person');
        const name = row.name || '账号不可用';
        identity.append(photo(row.uid, ''), row.active ? navLink('/space/' + row.uid, name) : node('span', '', name),
          node('small', 'ac-muted', '添加时间: ' + row.time.replace('T', ' ')));
        const remove = action('移除');
        remove.onclick = async () => {
          remove.disabled = true;
          try {
            await request('/blocked/' + row.uid, 'DELETE');
            if (!active()) return;
            const index = rows.indexOf(row);
            if (index >= 0) rows.splice(index, 1);
            if ((page - 1) * size >= rows.length) page--;
            status.textContent = '已移出黑名单';
            render();
          } catch (error) { status.textContent = error.message; remove.disabled = false; }
        };
        item.append(identity, remove);
        list.append(item);
      }
      pager.replaceChildren();
      const pagesNav = node('div', 'ac-pager-pages');
      const prev = node('button', 'ac-pager-arrow', '‹');
      prev.type = 'button';
      prev.disabled = page === 1;
      prev.setAttribute('aria-label', '上一页');
      prev.onclick = () => { page--; render(); };
      pagesNav.append(prev);
      for (let n = 1; n <= pages; n++) {
        const entry = node('button', n === page ? 'ac-pager-num is-current' : 'ac-pager-num', n);
        entry.type = 'button';
        entry.onclick = () => { page = n; render(); };
        pagesNav.append(entry);
      }
      const next = node('button', 'ac-pager-arrow', '›');
      next.type = 'button';
      next.disabled = page === pages;
      next.setAttribute('aria-label', '下一页');
      next.onclick = () => { page++; render(); };
      pagesNav.append(next);
      const jump = node('form', 'ac-pager-jump');
      const input = node('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.value = page;
      input.setAttribute('aria-label', '页码');
      jump.append('前往', input, '页');
      jump.onsubmit = event => { event.preventDefault(); page = Number(input.value) || 1; render(); };
      pager.append(pagesNav, jump);
    }
    render();
  }

  async function coins(section, status) {
    const subnav = node('nav', 'ac-tabs');
    subnav.setAttribute('aria-label', '硬币栏目');
    for (const [href, text, active] of [['/account/coins', '首页', !coinHistory], ['/account/coins/history', '硬币记录', coinHistory]]) {
      const entry = navLink(href, text);
      if (active) entry.setAttribute('aria-current', 'page');
      subnav.append(entry);
    }
    section.append(subnav);
    const table = ledgerTable('硬币记录');
    if (coinHistory) {
      section.append(table.wrapper);
      await paged(section, status, async offset => (await request('/coins?offset=' + offset)).ledger, table.append, '暂无硬币记录');
      return;
    }
    const data = await request('/coins?recent=true');
    const balance = node('div', 'ac-balance');
    balance.append(node('span', '', '硬币余额：'), node('strong', '', format(data.balance)));
    const grid = node('div', 'ac-coins-grid');
    const main = node('div');
    const heading = node('div', 'ac-subheading');
    heading.append(node('h2', '', '硬币记录'), node('p', 'ac-muted', '您最近一周的变化情况'));
    main.append(heading);
    if (data.ledger.items.length) {
      table.append(data.ledger.items);
      main.append(table.wrapper);
    } else main.append(node('p', 'ac-empty', '最近 7 天没有硬币变动'));
    main.append(navLink('/account/coins/history', '查看更多记录 >', 'ac-button ac-more'));
    const help = node('aside', 'ac-coin-help');
    const uses = node('ul');
    for (const text of ['硬币是 bilibili 世界中非常重要的物品', '硬币用于对优秀的视频作品进行投币支持，这是对 UP 主的一种肯定',
      '硬币还可用于修改昵称、购买标识、参与活动等']) uses.append(node('li', '', text));
    const ways = node('ul');
    for (const text of ['会员等级 = Lv0 时，将无法获得硬币登录奖励', '会员等级 ≥ Lv1 且绑定手机时，每天登录后可领取登录硬币奖励',
      'UP 主可通过投稿视频来获得更多硬币（观众投币的百分之十将作为 UP 主的硬币收入奖励）']) ways.append(node('li', '', text));
    help.append(node('h3', '', '硬币有什么用？'), uses, node('h3', '', '如何获得硬币？'), ways);
    grid.append(main, help);
    section.append(balance, grid);
  }

  let releaseAvatar;
  async function render(user) {
    releaseAvatar?.();
    releaseAvatar = null;
    const revision = ++version;
    const active = () => revision === version;
    const sidebar = node('div', 'security-left');
    sidebar.setAttribute('aria-label', '个人中心导航');
    sidebar.append(node('span', 'security-title', '个人中心'));
    const nav = node('ul', 'security-ul');
    for (const [href, text, symbol] of tabs) {
      const item = node('li', 'security-list');
      const entry = navLink(href, '', 'security-list-link');
      const glyph = icon(symbol);
      glyph.classList.add('security-icon');
      entry.append(glyph, node('span', 'security-nav-name', text));
      if (href === selected[0]) {
        item.classList.add('on');
        entry.setAttribute('aria-current', 'page');
      }
      item.append(entry);
      nav.append(item);
    }
    const external = node('ul', 'security-ul');
    for (const [href, text] of [['/me', '个人空间'], ['/studio', '创作中心']]) {
      const item = node('li', 'security-list-jump');
      const entry = navLink(href, '', 'security-list-link-jump');
      const arrow = icon('right');
      arrow.classList.add('m-arrow');
      entry.append(text, arrow);
      item.append(entry);
      external.append(item);
    }
    sidebar.append(nav, external);
    const status = node('p', 'ac-status');
    status.setAttribute('role', 'status');
    const section = node('div', !avatarPage && selected[0] === '/account' ? 'security-right-home' : 'ac-section');
    const card = node('section', 'security-right');
    if (!avatarPage && selected[0] === '/account') section.append(status);
    else {
      const header = node('div', 'ac-heading');
      if (avatarPage) header.append(navLink('/account/profile', '我的信息', 'ac-parent'));
      header.append(node('h2', '', avatarPage ? '更换头像' : selected[1]));
      const note = {
        '/account/blocked': '粉丝量<1万，黑名单上限为1000；粉丝量≥1万，黑名单上限为10000',
        '/account/experience': '您最近一周的变化情况'
      }[selected[0]];
      if (note) header.append(node('small', 'ac-heading-note', note));
      header.append(status);
      card.append(header);
    }
    card.append(section);
    root.querySelector('.security_content').replaceChildren(sidebar, card);
    document.title = (avatarPage ? '更换头像' : selected[0] === '/account' ? '个人中心' : selected[1] + ' · 个人中心') + ' - dilidili';
    if (!user) {
      const enter = action('登录', 'ac-button ac-primary');
      enter.onclick = () => openLogin(enter);
      section.append(node('p', '', '登录后进入个人中心'), enter);
      return;
    }
    try {
      if (avatarPage) releaseAvatar = avatarEditor(section, status, user, active);
      else if (selected[0] === '/account/profile') await profile(section, status, user, active);
      else if (selected[0] === '/account/blocked') await blocked(section, status, active);
      else if (selected[0] === '/account/coins') await coins(section, status);
      else if (selected[0] === '/account/experience') {
        const table = ledgerTable('经验记录');
        section.append(table.wrapper);
        await paged(section, status, offset => request('/experience?offset=' + offset), table.append, '暂无经验记录');
      } else await homepage(section, user);
    } catch (error) {
      status.textContent = error.message;
    }
  }

  root.hidden = false;
  window.addEventListener('accountchange', event => render(event.detail));
  render(currentAccount);
}


if (path === '/account' || path.startsWith('/account/')) setupAccountCenter();
