function setupAccountCenter() {
  const root = el('account-center');
  const tabs = [
    ['/account', '个人中心', 'home-outline'],
    ['/account/profile', '我的信息', 'uid'],
    ['/account/blocked', '黑名单管理', 'flag'],
    ['/account/coins', '我的硬币', 'star'],
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
    const profile = node('section', 'ac-summary');
    const avatarLink = navLink('/account/profile/avatar');
    avatarLink.append(photo(user.uid, '更换头像'));
    const info = node('div', 'ac-summary-info');
    info.append(node('h2', '', data.identity.name), node('span', 'ac-muted', 'UID ' + user.uid));
    const { level, experience, threshold, nextThreshold } = data.identity;
    const progressLine = node('div', 'ac-level');
    progressLine.append(node('strong', '', level), node('span', '', nextThreshold
      ? format(experience) + ' / ' + format(nextThreshold) + ' EXP' : format(experience) + ' EXP · 当前最高等级'));
    if (nextThreshold > threshold) {
      const progress = node('progress');
      progress.max = nextThreshold - threshold;
      progress.value = Math.max(0, experience - threshold);
      progress.setAttribute('aria-label', '等级经验进度');
      info.append(progressLine, progress);
    } else info.append(progressLine);
    const actions = node('div', 'ac-summary-actions');
    actions.append(navLink('/account/profile', '修改资料', 'ac-button'), navLink('/me', '个人空间', 'ac-button'));
    profile.append(avatarLink, info, actions);
    const coins = navLink('/account/coins', '硬币余额 ' + format(data.coins), 'ac-summary-coins');
    profile.append(coins);
    const rewards = node('section', 'ac-rewards');
    const heading = node('div', 'ac-section-heading');
    heading.append(node('h2', '', '每日奖励'), navLink('/account/experience', '查看经验记录'));
    const grid = node('div', 'ac-reward-grid');
    for (const reward of data.rewards) {
      const card = node('article', 'ac-reward');
      const total = node('strong', '', '+' + reward.maximum + ' EXP');
      const label = reward.earned >= reward.maximum ? '今日已完成' : reward.earned ? '进行中' : '待完成';
      card.append(node('h3', '', reward.title), total, node('span', 'ac-muted', label + ' · ' + reward.earned + ' / ' + reward.maximum));
      grid.append(card);
    }
    rewards.append(heading, grid);
    section.append(profile, rewards);
  }

  function field(label, id, control, help) {
    const row = node('div', 'ac-field');
    const name = node('label', '', label);
    name.htmlFor = id;
    control.id = id;
    row.append(name, control);
    if (help) {
      const note = node('small', 'ac-muted', help);
      note.id = id + '-help';
      control.setAttribute('aria-describedby', note.id);
      row.append(note);
    }
    return row;
  }

  async function profile(section, status, user, active) {
    let data = await request('/profile');
    const form = node('form', 'ac-fields');
    const avatar = navLink('/account/profile/avatar', '', 'ac-avatar-link');
    avatar.append(photo(user.uid, ''), node('span', '', '更换头像'));
    form.append(field('头像', 'account-avatar-link', avatar));
    const name = node('input');
    name.required = true;
    name.maxLength = 32;
    name.value = data.name;
    form.append(field('昵称', 'account-name', name, '每次修改昵称消耗 6 个硬币'));
    const uid = node('output', '', user.uid);
    form.append(field('UID', 'account-uid', uid));
    const signature = node('input');
    signature.maxLength = 120;
    signature.value = data.signature || '';
    form.append(field('个性签名', 'account-signature', signature, '最多 60 个字'));
    const gender = node('select');
    for (const [value, label] of [[0, '男'], [1, '女'], [2, '保密']]) {
      const option = node('option', '', label);
      option.value = value;
      gender.append(option);
    }
    gender.value = data.gender;
    form.append(field('性别', 'account-gender', gender));
    const birthday = node('input');
    birthday.type = 'date';
    birthday.value = data.birthday || '';
    birthday.max = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
    form.append(field('出生日期', 'account-birthday', birthday));
    const footer = node('div', 'ac-form-footer');
    const save = action('保存资料', 'ac-button ac-primary');
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
          name: name.value, signature: signature.value, gender: Number(gender.value), birthday: birthday.value || null
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
        status.textContent = '资料已保存';
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
        const amount = node('td', entry.change > 0 ? 'ac-gain' : '', (entry.change > 0 ? '+' : '') + format(entry.change));
        row.append(date, amount, node('td', '', entry.reason));
        body.append(row);
      }
    };
    return { wrapper, append };
  }

  async function paged(section, status, load, append, emptyText) {
    let offset = 0;
    const more = action('加载更多');
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
    const list = node('ul', 'ac-blocked');
    section.append(list);
    let pageItems = 0;
    let removed = 0;
    await paged(section, status, offset => request('/blocked?offset=' + (offset - removed)), rows => {
      pageItems += rows.length;
      for (const row of rows) {
        const item = node('li');
        const identity = node('div', 'ac-blocked-person');
        const name = row.name || '账号不可用';
        identity.append(photo(row.uid, ''), row.active ? navLink('/space/' + row.uid, name) : node('span', '', name),
          node('small', 'ac-muted', 'UID ' + row.uid));
        const remove = action('移出黑名单');
        remove.onclick = async () => {
          remove.disabled = true;
          try {
            await request('/blocked/' + row.uid, 'DELETE');
            if (!active()) return;
            ++removed;
            item.remove();
            status.textContent = '已移出黑名单';
            if (pageItems === removed && list.nextElementSibling.hidden) {
              list.after(node('p', 'ac-empty', '黑名单为空'));
            }
          } catch (error) { status.textContent = error.message; remove.disabled = false; }
        };
        item.append(identity, remove);
        list.append(item);
      }
    }, '黑名单为空');
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
    balance.append(node('span', 'ac-muted', '硬币余额'), node('strong', '', format(data.balance)));
    const heading = node('div', 'ac-section-heading');
    heading.append(node('h2', '', '近期硬币记录'), node('p', 'ac-muted', '最近 7 天'));
    section.append(balance, heading);
    if (data.ledger.items.length) {
      table.append(data.ledger.items);
      section.append(table.wrapper);
    } else section.append(node('p', 'ac-empty', '最近 7 天没有硬币变动'));
    section.append(navLink('/account/coins/history', '查看更多记录', 'ac-button ac-more-coins'));
  }

  let releaseAvatar;
  async function render(user) {
    releaseAvatar?.();
    releaseAvatar = null;
    const revision = ++version;
    const active = () => revision === version;
    const sidebar = node('nav', 'ac-sidebar');
    sidebar.setAttribute('aria-label', '个人中心导航');
    for (const [href, text, symbol] of tabs) {
      const entry = navLink(href, text);
      entry.prepend(icon(symbol));
      if (href === selected[0]) entry.setAttribute('aria-current', 'page');
      sidebar.append(entry);
    }
    sidebar.append(navLink('/me', '个人空间', 'ac-external'), navLink('/studio', '创作中心', 'ac-external'));
    const header = node('div', 'ac-heading');
    if (avatarPage) header.append(navLink('/account/profile', '我的信息', 'ac-parent'));
    header.append(node('h2', '', avatarPage ? '更换头像' : selected[1]));
    const status = node('p', 'ac-status');
    status.setAttribute('role', 'status');
    header.append(status);
    const section = node('div', 'ac-section');
    const card = node('section', 'ac-card');
    card.append(header, section);
    root.querySelector('.ac-layout').replaceChildren(sidebar, card);
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
