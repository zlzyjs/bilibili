const content = document.getElementById('studio-content');

function setupStudioInbox() {
  const wrap = document.querySelector('.studio-inbox-wrap');
  const trigger = wrap.querySelector('.studio-inbox');
  const menu = document.getElementById('studio-inbox-menu');
  let hideTimer;
  const show = () => {
    clearTimeout(hideTimer);
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  };
  const hide = () => {
    clearTimeout(hideTimer);
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  };
  wrap.addEventListener('mouseenter', show);
  wrap.addEventListener('mouseleave', () => { hideTimer = setTimeout(hide, 150); });
  trigger.addEventListener('click', event => {
    if (!menu.hidden) hide();
    else {
      show();
      if (event.detail === 0) menu.querySelector('a').focus();
    }
  });
  trigger.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    show();
    const links = menu.querySelectorAll('a');
    links[event.key === 'ArrowUp' ? links.length - 1 : 0].focus();
  });
  wrap.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      hide();
      trigger.focus();
    }
  });
  wrap.addEventListener('focusout', event => {
    if (!wrap.contains(event.relatedTarget)) hide();
  });
  menu.addEventListener('click', event => { if (event.target.closest('a')) hide(); });
  document.addEventListener('click', event => { if (!wrap.contains(event.target)) hide(); });
  window.addEventListener('pagehide', hide);
}

setupStudioInbox();

const routes = {
  '/studio/upload': ['视频投稿', uploadVideo],
  '/studio': ['首页', overview], '/studio/videos': ['稿件管理', videos],
  '/studio/analytics': ['数据概览', analytics], '/studio/fans': ['粉丝管理', fans],
  '/studio/income': ['收益中心', income], '/studio/charge': ['充电计划', charges],
};
const metrics = {
  plays: '播放量', comments: '评论', danmaku: '弹幕', likes: '点赞', shares: '分享',
  favorites: '收藏', coins: '投币', followers: '新增粉丝', visitors: '空间访客',
  total: '总收入', custom: '自定义充电', monthly: '包月充电',
};
const states = { all: '全部稿件', draft: '草稿', pending: '进行中', published: '已发布', rejected: '未通过' };
const overviewMetrics = {
  plays: 'play', comments: 'comment', danmaku: 'danmaku', likes: 'like',
  shares: 'share', favorites: 'favorite', coins: 'coin',
};
const number = new Intl.NumberFormat('zh-CN');
const money = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = value => value ? value.replace('T', ' ').slice(0, 19) : '—';
let account;
let accountRequest;
let request = 0;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function action(text, handler, primary = false) {
  const element = node('button', 'studio-btn' + (primary ? ' studio-primary' : ''), text);
  element.type = 'button';
  element.onclick = handler;
  return element;
}

function link(href, text, className) {
  const element = node('a', className, text);
  element.href = href;
  return element;
}

function select(label, pairs, value) {
  const element = node('select', 'studio-input');
  element.setAttribute('aria-label', label);
  for (const [key, text] of pairs) {
    const option = node('option', '', text);
    option.value = key;
    element.append(option);
  }
  element.value = value;
  return element;
}

function group(className, ...children) {
  const element = node('div', className);
  element.append(...children);
  return element;
}

function panel(...children) {
  const element = node('section', 'studio-panel');
  element.append(...children);
  return element;
}

function subheading(text, ...tools) {
  return group('studio-row', node('h2', '', text), ...tools);
}

function leaveStudioView() {
  for (const child of content.children) child.dispatchEvent(new Event('studio:leave'));
}

function setContent(...children) {
  leaveStudioView();
  if (children[0]?.classList.contains('studio-dashboard')) content.replaceChildren(...children);
  else content.replaceChildren(node('h1', '', routes[location.pathname]?.[0] || '创作中心'), ...children);
}

async function api(path, options) {
  const response = await fetch(path.startsWith('/api/') ? path : '/api/studio' + path, { cache: 'no-store', ...options });
  if (response.ok) return response.status === 204 ? null : response.json();
  const error = new Error(response.status === 403 ? '当前账号没有操作权限' :
    response.status === 409 ? '稿件暂时无法提交，请检查是否已有审核申请或缺少视频资料' : '请求失败，请重试');
  error.status = response.status;
  throw error;
}

function guest() {
  setContent(panel(node('h2', '', '登录后进入创作中心'),
    node('p', 'studio-muted', '查看你的稿件、数据和粉丝。'),
    link('/?studio-login=' + (location.pathname === '/studio/upload' ? 'upload' : '1'), '登录', 'studio-btn studio-primary')));
}

async function refresh(load) {
  const token = ++request;
  content.setAttribute('aria-busy', 'true');
  try {
    const elements = await load();
    if (token === request) setContent(...elements);
  } catch (error) {
    if (token !== request) return;
    if (error.status === 401) {
      account = undefined;
      document.getElementById('studio-account').hidden = true;
      guest();
    }
    else setContent(panel(node('p', '', error.message), action('重新加载', () => refresh(load))));
  } finally {
    if (token === request) content.removeAttribute('aria-busy');
  }
}

function tile(label, value, handler) {
  const element = handler ? node('button', 'studio-tile') : node('div', 'studio-tile');
  if (handler) {
    element.type = 'button';
    element.onclick = handler;
  }
  element.append(node('span', '', label), node('strong', '', value));
  return element;
}

function overviewIcon(symbol, className) {
  const icon = svg('svg', { viewBox: '0 0 24 24', class: className, 'aria-hidden': 'true' });
  icon.append(svg('use', { href: '/assets/studio-icons.svg#' + symbol }));
  return icon;
}

async function overview() {
  const [data, recent] = await Promise.all([
    api('/overview'),
    api('/videos').catch(() => null),
  ]);
  const cards = group('studio-cards', ...Object.entries(overviewMetrics).map(([key, symbol]) => {
    const card = key === 'plays'
      ? link('/studio/analytics?' + new URLSearchParams({ metric: key }), null, 'studio-tile')
      : node('div', 'studio-tile');
    const icon = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    icon.append(svg('use', { href: '/assets/studio-icons.svg#' + symbol }));
    card.append(group('studio-metric-label', group('studio-metric-icon', icon), node('span', '', metrics[key])),
      node('strong', '', number.format(data.metrics[key])));
    if (key === 'plays') card.querySelector('.studio-metric-label').append(overviewIcon('chevron', 'studio-chevron'));
    return card;
  }));
  const heading = group('studio-overview-heading', node('h2', '', '视频数据'),
    node('p', 'studio-muted', '播放量统计截至：' + data.statisticsDate + '（每日12点更新）'));
  const video = panel(group('studio-row', heading), cards);
  video.classList.add('studio-metrics');
  const audience = panel();
  audience.classList.add('studio-fan-overview');
  const arrow = link('/studio/fans', null, 'studio-fan-arrow');
  arrow.setAttribute('aria-label', '查看粉丝管理');
  arrow.append(overviewIcon('chevron', 'studio-fan-arrow-icon'));
  audience.append(group('studio-row', node('h2', '', '粉丝概览'), arrow),
    tile('粉丝总数', number.format(data.followers)),
    tile('今日粉丝数变化', (data.newFans >= 0 ? '+' : '') + number.format(data.newFans)));
  const descriptions = ['当前账号的粉丝总数',
    '12:00之前：相比昨日00:00的新增粉丝数；12:00之后：相比今日00:00新增的粉丝数'];
  for (const [index, item] of [...audience.querySelectorAll('.studio-tile')].entries()) {
    const help = node('button', 'studio-help');
    help.type = 'button';
    help.setAttribute('aria-label', descriptions[index]);
    const tooltip = node('span', 'studio-tooltip', descriptions[index]);
    tooltip.id = 'studio-fans-help-' + index;
    tooltip.setAttribute('role', 'tooltip');
    help.setAttribute('aria-describedby', tooltip.id);
    help.append(overviewIcon('help', 'studio-help-icon'), tooltip);
    item.firstChild.append(help);
  }
  const revenue = panel();
  revenue.classList.add('studio-revenue-overview');
  const revenueLink = link('/studio/income', null, 'studio-revenue-label');
  revenueLink.append(node('span', '', '充电收入'), overviewIcon('chevron', 'studio-chevron'));
  revenue.append(node('h2', '', '收益概览'),
    revenueLink,
    node('strong', 'studio-number', money.format(data.received)));
  const side = group('studio-overview-side', audience, revenue);
  const recentPanel = panel(subheading('近期稿件', link('/studio/videos', '全部稿件 ›', 'studio-btn')));
  if (recent?.items.length) {
    const list = node('ul', 'studio-recent-list');
    for (const draft of recent.items.slice(0, 4)) {
      const item = node('li');
      const destination = draft.playable ? '/video/' + encodeURIComponent(draft.id) :
        '/studio/videos?' + new URLSearchParams({ state: draft.state, q: draft.title });
      const entry = link(destination);
      entry.append(studioCover(draft), node('strong', '', draft.title),
        node('span', 'studio-muted', states[draft.state] || draft.state));
      item.append(entry);
      list.append(item);
    }
    recentPanel.append(list);
  } else {
    recentPanel.append(node('p', 'studio-empty', recent ? '暂无稿件' : '暂时无法加载近期稿件'));
  }
  return [group('studio-dashboard', group('studio-overview', video, side), recentPanel)];
}

function studioCover(video) {
  const cover = group('studio-video-image');
  const image = node('img');
  image.alt = '';
  image.loading = 'lazy';
  image.onerror = () => image.hidden = true;
  image.src = '/api/studio/videos/' + encodeURIComponent(video.id) + '/cover';
  const duration = [Math.floor(video.duration / 60), video.duration % 60].map(value => String(value).padStart(2, '0')).join(':');
  cover.append(image, node('span', '', duration));
  return cover;
}

function pager(total, page, change) {
  const pages = Math.max(1, Math.ceil(total / 12));
  if (pages === 1) return node('p', 'studio-muted', '共 ' + number.format(total) + ' 条');
  const prev = action('', () => change(page - 1));
  const next = action('', () => change(page + 1));
  prev.setAttribute('aria-label', '上一页');
  next.setAttribute('aria-label', '下一页');
  prev.append(overviewIcon('chevron', 'studio-page-arrow studio-page-arrow-prev'));
  next.append(overviewIcon('chevron', 'studio-page-arrow'));
  prev.disabled = !page;
  next.disabled = page + 1 >= pages;
  return group('studio-pager', prev, node('span', '', (page + 1) + ' / ' + pages), next);
}

let videoQuery;
async function videos() {
  const { state, q, sort, page } = videoQuery;
  const data = await api('/videos?' + new URLSearchParams({ state, q, sort, page }));
  function change(values) {
    Object.assign(videoQuery, { page: 0 }, values);
    refresh(videos);
  }
  const input = node('input', 'studio-input');
  input.type = 'search';
  input.placeholder = '搜索稿件';
  input.setAttribute('aria-label', '搜索稿件标题');
  input.maxLength = 80;
  input.value = q;
  const search = node('form', 'studio-tools');
  const submit = node('button', 'studio-btn', '搜索');
  search.append(input, submit);
  search.onsubmit = (event) => { event.preventDefault(); change({ q: input.value.trim() }); };
  const total = ['pending', 'published', 'rejected'].reduce((sum, key) => sum + (data.counts[key] || 0), 0);
  const filters = group('manuscript-filters');
  const primaryFilters = group('manuscript-primary-filters');
  const secondaryFilters = group('manuscript-secondary-filters');
  for (const [key, label] of Object.entries(states)) {
    const button = action(label + (key === 'draft' ? '' : ' ' + (key === 'all' ? total : data.counts[key] || 0)), () => change({ state: key }));
    button.setAttribute('aria-pressed', String(state === key));
    (['all', 'draft'].includes(key) ? primaryFilters : secondaryFilters).append(button);
  }
  filters.append(primaryFilters, secondaryFilters);
  const list = node('ul', 'studio-list');
  for (const video of data.items) {
    const row = node('li', 'studio-video');
    const heading = node('h3');
    heading.append(video.playable ? link('/video/' + encodeURIComponent(video.id), video.title) : video.title);
    const date = video.uploadTime ? iso(video.uploadTime).replace(/^(\d{4})-(\d{2})-(\d{2}) /, '$1年$2月$3日 ') : '—';
    const metadata = group('manuscript-metadata', node('time', '', date));
    if (['pending', 'rejected', 'draft'].includes(video.state)) metadata.append(node('span', 'manuscript-state', states[video.state]));
    const counters = group('manuscript-counters', ...Object.entries(overviewMetrics).map(([key, symbol]) => {
      const counter = group('manuscript-counter', overviewIcon(symbol, 'manuscript-icon'), node('span', '', number.format(video.metrics[key] || 0)));
      counter.title = metrics[key];
      counter.setAttribute('aria-label', metrics[key] + ' ' + (video.metrics[key] || 0));
      return counter;
    }));
    const details = group('studio-video-info', heading, metadata, counters);
    const tools = group('studio-tools');
    if (account.level === 'Lv2' && video.state !== 'pending') tools.append(action('编辑', () => editVideo(video)));
    const cover = studioCover(video);
    if (video.visibility === 'private') cover.append(node('small', 'manuscript-private', '仅自己可见'));
    row.append(cover, details, tools);
    list.append(row);
  }
  const pages = Math.max(1, Math.ceil(data.total / 12));
  const pagination = group('manuscript-pagination');
  for (let index = 0; index < pages; index++) {
    const button = action(String(index + 1), () => change({ page: index }));
    if (index === page) button.setAttribute('aria-current', 'page');
    pagination.append(button);
  }
  const jump = node('input', 'studio-input');
  jump.type = 'number'; jump.min = 1; jump.max = pages;
  jump.setAttribute('aria-label', '跳转页码');
  jump.onkeydown = event => {
    if (event.key === 'Enter' && jump.value && jump.checkValidity()) change({ page: Number(jump.value) - 1 });
  };
  pagination.append(node('span', '', '共' + pages + '页 / ' + data.total + '个，跳转至'), jump, node('span', '', '页'));
  const tabs = group('manuscript-tabs', node('span', 'is-active', '视频管理'), search);
  const result = panel(tabs, filters, list.childElementCount ? list : node('p', 'studio-empty', '没有符合条件的稿件'), pagination);
  result.classList.add('studio-manuscripts');
  return [result];
}

function editVideo(video) {
  navigateStudio('/studio/upload?edit=' + encodeURIComponent(video.id));
}

let fanPage = 0;
let fanFilter = 'all';

async function fanMutation(path, method, body) {
  const { token } = await api('/api/auth/csrf');
  return api(path, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

function confirmRemoveFan(fan) {
  const dialog = node('dialog', 'studio-modal studio-remove-fan');
  dialog.setAttribute('aria-labelledby', 'studio-remove-fan-title');
  dialog.setAttribute('aria-describedby', 'studio-remove-fan-description');
  const title = node('h2', '', '确认移除粉丝');
  title.id = 'studio-remove-fan-title';
  const close = action('', () => dialog.close());
  close.className = 'studio-remove-fan-close';
  close.setAttribute('aria-label', '关闭');
  const message = node('p', 'studio-remove-fan-message', '确认移除粉丝 ');
  message.id = 'studio-remove-fan-description';
  message.append(node('strong', '', fan.name));
  const block = node('input');
  block.type = 'checkbox';
  const blockLabel = node('label', 'studio-remove-fan-block');
  blockLabel.append(block, node('span', '', '同时将此用户加入到黑名单'));
  const error = node('p', 'studio-remove-fan-error');
  error.setAttribute('role', 'status');
  const remove = action('确定', async () => {
    remove.disabled = true;
    block.disabled = true;
    error.textContent = '';
    try {
      await fanMutation('/fans/' + encodeURIComponent(fan.id) + '?block=' + block.checked, 'DELETE');
      dialog.close();
      await refresh(fans);
    } catch (failure) {
      error.textContent = failure.message;
      remove.disabled = false;
      block.disabled = false;
    }
  }, true);
  dialog.append(group('studio-remove-fan-header', title, close),
    group('studio-remove-fan-body', message, blockLabel, error,
      group('studio-remove-fan-actions', remove, action('取消', () => dialog.close()))));
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

async function fans() {
  const data = await api('/fans?' + new URLSearchParams({ page: fanPage, filter: fanFilter }));
  if (!data.items.length && fanPage > 0) {
    fanPage = Math.max(0, Math.ceil(data.total / 12) - 1);
    return fans();
  }
  const section = panel();
  section.classList.add('studio-fans');
  const heading = node('div', 'studio-fans-tab', '粉丝列表');
  const status = node('p', 'studio-fans-status');
  status.setAttribute('role', 'status');
  const filter = node('details', 'studio-fans-filter');
  const filterTitle = node('summary', '', fanFilter === 'all' ? '全部粉丝' : '互相关注');
  const options = group('studio-fans-popup');
  for (const [key, label] of [['all', '全部粉丝'], ['mutual', '互相关注']]) {
    const option = action(label, () => {
      filter.open = false;
      fanFilter = key;
      fanPage = 0;
      refresh(fans);
    });
    option.setAttribute('aria-pressed', String(fanFilter === key));
    options.append(option);
  }
  filter.append(filterTitle, options);
  const list = node('ul', 'studio-list');
  for (const fan of data.items) {
    const avatar = node('img');
    avatar.alt = '';
    avatar.loading = 'lazy';
    avatar.onerror = () => { avatar.onerror = null; avatar.src = '/assets/guest-avatar.gif'; };
    avatar.src = '/api/authors/' + encodeURIComponent(fan.id) + '/avatar';
    const row = node('li', 'fan');
    const profile = link('/space/' + encodeURIComponent(fan.id), null, 'studio-fan-profile');
    profile.append(avatar, node('span', '', fan.name));
    const follow = action(fan.following ? '已关注' : '关注', async () => {
      follow.disabled = true;
      status.textContent = '';
      try {
        const relation = await fanMutation('/api/interactions/authors/' + encodeURIComponent(fan.id) + '/relation/follow',
          'PUT', { enabled: !fan.following });
        fan.following = relation.following;
        follow.textContent = fan.following ? '已关注' : '关注';
        follow.setAttribute('aria-pressed', String(fan.following));
        if (fanFilter === 'mutual' && !fan.following) await refresh(fans);
      } catch (error) { status.textContent = error.message; }
      finally { follow.disabled = false; }
    });
    follow.classList.add('studio-fan-follow');
    follow.setAttribute('aria-pressed', String(fan.following));
    const menu = node('details', 'studio-fan-menu');
    const trigger = node('summary', '', '•••');
    trigger.setAttribute('aria-label', fan.name + '的更多操作');
    const remove = action('移除粉丝', () => {
      menu.open = false;
      confirmRemoveFan(fan);
    });
    menu.append(trigger, group('studio-fans-popup',
      link('/messages?' + new URLSearchParams({ tab: 'chat', uid: fan.id }), '私信'), remove));
    row.append(profile, group('studio-fan-actions', follow, menu));
    list.append(row);
  }
  section.append(heading, subheading('我的粉丝数 ' + number.format(data.followers), filter), status,
    data.items.length ? list : node('p', 'studio-empty', fanFilter === 'mutual' ? '暂无互相关注的粉丝' : '暂无粉丝'),
    pager(data.total, fanPage, page => {
      fanPage = page;
      refresh(fans);
    }));
  return [section];
}

document.addEventListener('click', event => {
  for (const menu of document.querySelectorAll('.studio-fans details[open]')) {
    if (!menu.contains(event.target)) menu.open = false;
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') for (const menu of document.querySelectorAll('.studio-fans details[open]')) menu.open = false;
});

function day(value, offset) {
  const date = new Date(value + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function trendValues(data, days, metric) {
  const current = new Map();
  let previous = 0;
  for (const point of data.points) {
    if (metric !== 'total' && point.metric !== metric) continue;
    if (point.date < data.start) previous += point.value;
    else current.set(point.date, (current.get(point.date) || 0) + point.value);
  }
  const series = Array.from({ length: days }, (_, index) => {
    const date = day(data.start, index);
    return { date, value: current.get(date) || 0 };
  });
  return { series, sum: series.reduce((total, point) => total + point.value, 0), previous };
}

function svg(tag, attrs, text) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  if (text != null) element.textContent = text;
  return element;
}

function drawChart(host, heading, data, format, fanData) {
  host.replaceChildren(node('h3', '', heading));
  if (!data) {
    host.append(node('p', 'studio-empty', '项目尚未记录空间访客，暂无趋势数据。'));
    return;
  }
  if (fanData) host.append(node('p', 'studio-chart-legend', '总播放量 · 当前粉丝播放量'));
  const chart = svg('svg', { viewBox: '0 0 840 270', role: 'img', 'aria-label': heading });
  const left = 70, right = 800, top = 16, bottom = 230;
  const max = Math.max(4, Math.ceil(Math.max(...data.map(point => point.value)) / 4) * 4);
  const x = index => left + (right - left) * index / (data.length - 1);
  const y = value => bottom - (bottom - top) * value / max;
  for (let step = 0; step <= 4; step++) {
    const value = max * step / 4;
    chart.append(svg('line', { x1: left, x2: right, y1: y(value), y2: y(value) }),
      svg('text', { x: left - 7, y: y(value) + 4, 'text-anchor': 'end' }, number.format(value)));
  }
  for (let step = 0; step < 4; step++) {
    const index = Math.round((data.length - 1) * step / 3);
    chart.append(svg('text', { x: x(index), y: bottom + 25, 'text-anchor': 'middle' }, data[index].date.slice(5)));
  }
  const series = (points, className) => svg('path', { class: className,
    d: points.map((point, index) => (index ? 'L' : 'M') + x(index) + ' ' + y(point.value)).join(' ') });
  if (fanData) chart.append(series(fanData, 'series fan-series animate'));
  chart.append(series(data, 'series animate'));
  const guide = svg('line', { y1: top, y2: bottom });
  const pointer = svg('circle', { r: 5, fill: '#fff', stroke: 'var(--accent-bright)', 'stroke-width': 2.5 });
  chart.append(guide, pointer);
  const plot = group('studio-chart-plot', chart);
  const tooltip = node('div', 'studio-chart-tooltip');
  tooltip.setAttribute('role', 'tooltip');
  const date = node('strong');
  const values = node('div', 'studio-chart-tooltip-values');
  tooltip.append(date, values);
  plot.append(tooltip);
  const hide = () => {
    tooltip.hidden = true;
    guide.style.display = 'none';
    pointer.style.display = 'none';
  };
  let activeIndex = data.length - 1;
  function inspect(index) {
    activeIndex = index;
    const point = data[index];
    tooltip.hidden = false;
    guide.style.display = '';
    pointer.style.display = '';
    guide.setAttribute('x1', x(index));
    guide.setAttribute('x2', x(index));
    pointer.setAttribute('cx', x(index));
    pointer.setAttribute('cy', y(point.value));
    date.textContent = point.date.replaceAll('-', '/');
    const row = (label, value, fan = false) => {
      const item = node('div', 'studio-chart-tooltip-row' + (fan ? ' is-fan' : ''));
      item.append(node('span', 'studio-chart-tooltip-dot'), node('span', '', label + '：'), node('b', '', format(value)));
      return item;
    };
    values.replaceChildren(row(fanData ? '总播放量' : heading.replace(/^近\d+(天|年)/, ''), point.value));
    if (fanData) values.append(row('当前粉丝播放量', fanData[index].value, true));
    const matrix = chart.getScreenCTM();
    if (!matrix) return;
    const anchor = new DOMPoint(x(index), y(point.value)).matrixTransform(matrix);
    const bounds = plot.getBoundingClientRect();
    let tooltipX = anchor.x - bounds.left + 16;
    if (tooltipX + tooltip.offsetWidth > bounds.width - 8) tooltipX = anchor.x - bounds.left - tooltip.offsetWidth - 16;
    tooltip.style.left = Math.max(8, tooltipX) + 'px';
    tooltip.style.top = Math.max(8, Math.min(anchor.y - bounds.top + 12, bounds.height - tooltip.offsetHeight - 8)) + 'px';
  }
  chart.onpointermove = event => {
    const matrix = chart.getScreenCTM();
    if (!matrix) return;
    const position = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const relativeX = position.x;
    if (relativeX < left || relativeX > right || position.y < top || position.y > bottom + 8) { hide(); return; }
    inspect(Math.max(0, Math.min(data.length - 1, Math.round((relativeX - left) / (right - left) * (data.length - 1)))));
  };
  chart.onpointerleave = hide;
  chart.setAttribute('tabindex', '0');
  chart.onfocus = () => inspect(activeIndex);
  chart.onblur = hide;
  chart.onkeydown = event => {
    if (event.key === 'Escape') { hide(); return; }
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    inspect(Math.max(0, Math.min(data.length - 1, activeIndex + (event.key === 'ArrowRight' ? 1 : -1))));
  };
  host.append(plot);
  hide();
}

function exportTrend(label, data) {
  const blob = new Blob(['\ufeff日期,' + label + '\n' + data.map(point => point.date + ',' + point.value).join('\n')],
    { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = link(url, '');
  anchor.download = label + '.csv';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const analyticsChoice = { days: 7, metric: 'plays' };
const incomeChoice = { days: 30, metric: 'total' };

async function trendPanel(settings, { endpoint, title, keys, ranges, variant, video = '' }) {
  const days = settings.days;
  const query = new URLSearchParams({ days, ...(video ? { video } : {}) });
  const data = await api(endpoint + '?' + query);
  const format = variant === 'income' ? money.format : number.format;
  const filter = select('时间范围', ranges, days);
  filter.onchange = () => {
    settings.days = Number(filter.value);
    refresh(variant === 'income' && location.pathname === '/studio/income' ? income : analytics);
  };
  const rangeLabel = ranges.find(([length]) => length === days)[1];
  const graph = group('studio-chart');
  const map = new Map(keys.map(key => [key, key === 'visitors' ? null : trendValues(data, days, key)]));
  const cards = new Map();
  const download = action('导出当前指标', () => exportTrend(metrics[settings.metric], map.get(settings.metric).series));
  function update(metric) {
    settings.metric = metric;
    for (const [key, element] of cards) element.setAttribute('aria-pressed', String(metric === key));
    const selected = map.get(metric);
    download.disabled = !selected;
    const fanData = metric === 'plays' ? trendValues(data, days, 'fanPlays').series : null;
    drawChart(graph, rangeLabel + metrics[metric], selected?.series, format, fanData);
  }
  for (const [key, values] of map) {
    const card = tile(metrics[key], values ? format(values.sum) : '—', () => update(key));
    if (values) {
      const delta = values.sum - values.previous;
      card.append(node('small', '', '较上期 ' + (delta >= 0 ? '+' : '') + format(delta)));
    } else card.append(node('small', '', '暂无采集'));
    cards.set(key, card);
  }
  update(settings.metric);
  return panel(subheading(title, node('span', 'studio-muted', '截至 ' + data.end),
    group('studio-tools', filter, download)), group(variant === 'analytics' ? 'studio-cards studio-analytics-cards' : 'studio-cards', ...cards.values()), graph);
}

const incomeOptions = {
  endpoint: '/income', title: '收益数据', keys: ['total', 'custom', 'monthly'],
  ranges: [[30, '近30天'], [365, '近1年']], variant: 'income',
};

async function analytics() {
  const analyticsVideo = new URLSearchParams(location.search).get('video') || '';
  const keys = analyticsVideo
    ? ['plays', 'likes', 'favorites', 'coins', 'comments', 'danmaku', 'shares']
    : ['plays', 'followers', 'likes', 'favorites', 'coins', 'comments', 'danmaku', 'shares'];
  const options = {
    endpoint: '/analytics', title: analyticsVideo ? '单稿件数据' : '核心数据概览', keys,
    ranges: [[7, '近7天'], [30, '近30天'], [90, '近90天']], variant: 'analytics', video: analyticsVideo,
  };
  const primary = await trendPanel(analyticsChoice, options);
  primary.append(node('p', 'studio-muted', '播放趋势按有计数时间的会话统计，新增粉丝按当前关注记录统计。'));
  if (analyticsVideo) return [primary, link('/studio/videos', '返回稿件管理', 'studio-btn')];
  return [primary];
}

async function income() {
  const [summary, graph] = await Promise.all([api('/overview'), trendPanel(incomeChoice, incomeOptions)]);
  return [panel(subheading('收益概况', link('/studio/charge', '查看充电计划 ›', 'studio-btn')),
    tile('累计收到充电', money.format(summary.received)),
    node('p', 'studio-muted', '统计来自站内充电记录。结算余额和提现状态暂无数据。')), graph];
}

let chargePage = 0;
async function charges() {
  const [summary, data] = await Promise.all([api('/overview'), api('/charges?page=' + chargePage)]);
  const table = node('table', 'studio-table');
  const head = node('thead');
  const headings = node('tr');
  for (const label of ['充电时间', '用户名', '充电金额', '充电类型', '留言']) {
    const cell = node('th', '', label);
    cell.scope = 'col';
    headings.append(cell);
  }
  head.append(headings);
  const body = node('tbody');
  for (const charge of data.items) {
    const row = node('tr');
    for (const value of [iso(charge.date), charge.name, money.format(charge.amount),
      charge.type === 1 ? '自定义充电' : '包月充电', charge.message || '—']) row.append(node('td', '', value));
    body.append(row);
  }
  table.append(head, body);
  return [panel(subheading('充电概况', link('/studio/income', '查看收益中心 ›', 'studio-btn')),
    tile('累计收到充电', money.format(summary.received))),
  panel(subheading('充电记录'), data.items.length ? group('studio-table-wrap', table) : node('p', 'studio-empty', '暂无充电记录'),
    pager(data.total, chargePage, page => { chargePage = page; refresh(charges); }))];
}

async function renderStudioRoute() {
  const token = ++request;
  const route = routes[location.pathname];
  for (const link of document.querySelectorAll('.studio-nav a')) {
    if (link.pathname === location.pathname) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.querySelector('dialog.studio-modal')?.close();
  if (!route) {
    setContent(panel(node('p', '', '页面不存在'), link('/studio', '返回创作首页', 'studio-btn')));
    content.removeAttribute('aria-busy');
    return;
  }
  const params = new URLSearchParams(location.search);
  if (route[1] === videos) {
    const state = params.get('state');
    videoQuery = { state: Object.hasOwn(states, state) ? state : 'all',
      q: (params.get('q') || '').slice(0, 80), sort: 'latest', page: 0 };
  }
  if (route[1] === analytics) {
    const metric = params.get('metric');
    analyticsChoice.metric = Object.hasOwn(overviewMetrics, metric) ? metric : 'plays';
  }
  document.title = route[0] + ' · dilidili 创作中心';
  content.setAttribute('aria-busy', 'true');
  leaveStudioView();
  content.replaceChildren();
  if (!account) {
    try {
      accountRequest ??= api('/api/auth/me').finally(() => { accountRequest = undefined; });
      const member = await accountRequest;
      if (token !== request) return;
      account = member;
    } catch (error) {
      if (token !== request) return;
      if (error.status === 401) guest();
      else setContent(panel(node('p', '', '账号加载失败'), action('重新加载', renderStudioRoute)));
      content.removeAttribute('aria-busy');
      return;
    }
  }
  const profile = document.getElementById('studio-account');
  const avatar = profile.querySelector('img');
  avatar.onerror = () => { avatar.onerror = null; avatar.src = '/assets/guest-avatar.gif'; };
  avatar.src = '/api/authors/' + encodeURIComponent(account.uid) + '/avatar';
  profile.querySelector('span').textContent = account.name;
  profile.hidden = false;
  return refresh(route[1]);
}

function navigateStudio(href) {
  const destination = new URL(href, location.href);
  if (destination.href !== location.href) history.pushState(null, '', destination);
  window.scrollTo(0, 0);
  return renderStudioRoute();
}

document.addEventListener('click', event => {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const anchor = event.target.closest('a[href]');
  if (!anchor || anchor.target || anchor.hasAttribute('download')) return;
  const destination = new URL(anchor.href, location.href);
  if (destination.origin !== location.origin || !Object.hasOwn(routes, destination.pathname)) return;
  event.preventDefault();
  navigateStudio(destination);
});
window.addEventListener('popstate', renderStudioRoute);
window.addEventListener('pagehide', leaveStudioView);
window.addEventListener('pageshow', event => { if (event.persisted) renderStudioRoute(); });
renderStudioRoute();

