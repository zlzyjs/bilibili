const content = document.getElementById('studio-content');
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
const number = new Intl.NumberFormat('zh-CN');
const money = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = value => value ? value.replace('T', ' ').slice(0, 19) : '—';
let account;
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

function setContent(...children) {
  if (children[0]?.classList.contains('studio-dashboard')) content.replaceChildren(...children);
  else content.replaceChildren(node('h1', '', routes[location.pathname]?.[0] || '创作中心'), ...children);
}

async function api(path, options) {
  const response = await fetch(path.startsWith('/api/') ? path : '/api/studio' + path, { cache: 'no-store', ...options });
  if (response.ok) return response.json();
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
    if (error.status === 401) guest();
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

async function overview() {
  const [data, recent] = await Promise.all([
    api('/overview'),
    api('/videos').catch(() => null),
  ]);
  const welcome = group('studio-welcome', node('h1', '', '创作工作台'),
    node('p', '', '管理稿件，查看创作表现'),
    link('/studio/upload', '发布视频 ↗', 'studio-btn'));
  const destinations = [
    ['/studio/videos?state=draft', '继续编辑草稿'],
    ['/studio/videos?state=pending', '查看审核进度'],
    ['/studio/analytics', '分析视频表现'],
    ['/studio/fans', '查看粉丝动态'],
    ['/studio/charge', '查看充电记录'],
  ];
  const shortcuts = node('ul', 'studio-shortcuts');
  for (const [href, label] of destinations) {
    const item = node('li');
    item.append(link(href, label));
    shortcuts.append(item);
  }
  const quick = panel(node('h2', '', '常用入口'), shortcuts);
  const cards = group('studio-cards', ...Object.keys(data.metrics).sort((a, b) =>
    Object.keys(metrics).indexOf(a) - Object.keys(metrics).indexOf(b))
    .map(key => tile(metrics[key], number.format(data.metrics[key]))));
  const video = panel(subheading('视频数据', link('/studio/analytics', '查看趋势 ›', 'studio-btn')),
    node('p', 'studio-muted studio-metrics-note', '已发布稿件的累计数据'), cards);
  video.classList.add('studio-metrics');
  const audience = panel(subheading('粉丝概览', link('/studio/fans', '查看 ›', 'studio-btn')),
    tile('粉丝总数', number.format(data.followers)), tile('今日新增粉丝', '+' + number.format(data.newFans)));
  const revenue = panel(subheading('收益概览', link('/studio/income', '查看 ›', 'studio-btn')),
    tile('累计收到充电', money.format(data.received)));
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
  return [group('studio-dashboard', group('studio-dashboard-top', welcome, quick),
    group('studio-overview', video, group('studio-aside', audience, revenue)), recentPanel)];
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
  const prev = action('上一页', () => change(page - 1));
  const next = action('下一页', () => change(page + 1));
  prev.disabled = !page;
  next.disabled = page + 1 >= pages;
  return group('studio-pager', prev, node('span', '', (page + 1) + ' / ' + pages), next);
}

const videoParams = new URLSearchParams(location.search);
const initialState = videoParams.get('state');
const videoQuery = { state: Object.hasOwn(states, initialState) ? initialState : 'all',
  q: (videoParams.get('q') || '').slice(0, 80), sort: 'latest', page: 0 };
async function videos() {
  const { state, q, sort, page } = videoQuery;
  const data = await api('/videos?' + new URLSearchParams({ state, q, sort, page }));
  function change(values) {
    Object.assign(videoQuery, { page: 0 }, values);
    refresh(videos);
  }
  const input = node('input', 'studio-input');
  input.type = 'search';
  input.placeholder = '搜索稿件标题';
  input.setAttribute('aria-label', '搜索稿件标题');
  input.maxLength = 80;
  input.value = q;
  const search = node('form', 'studio-tools');
  const submit = node('button', 'studio-btn', '搜索');
  search.append(input, submit);
  search.onsubmit = (event) => { event.preventDefault(); change({ q: input.value.trim() }); };
  const order = select('稿件排序', [['latest', '投稿时间从新到旧'], ['oldest', '投稿时间从旧到新'],
    ['plays', '播放量从高到低']], sort);
  order.onchange = () => change({ sort: order.value });
  const total = Object.values(data.counts).reduce((sum, count) => sum + count, 0);
  const filters = group('studio-tools', ...Object.entries(states).map(([key, label]) => {
    const button = action(label + ' ' + (key === 'all' ? total : data.counts[key] || 0), () => change({ state: key }));
    button.setAttribute('aria-pressed', String(state === key));
    return button;
  }));
  const list = node('ul', 'studio-list');
  for (const video of data.items) {
    const row = node('li', 'studio-video');
    const heading = node('h3');
    heading.append(video.playable ? link('/video/' + encodeURIComponent(video.id), video.title) : video.title);
    const labels = [iso(video.uploadTime), states[video.state] || video.state];
    if (video.visibility === 'private') labels.push('仅自己可见');
    const counters = Object.entries(video.metrics).map(([key, value]) => metrics[key] + ' ' + number.format(value));
    const details = group('studio-video-info', heading, node('p', 'studio-muted', labels.join(' · ')),
      node('p', 'studio-muted', counters.join('　')));
    const tools = group('studio-tools');
    if (account.level === 'Lv2' && video.state !== 'pending') tools.append(action('编辑', () => editVideo(video)));
    if (video.playable || video.visibility === 'private') {
      tools.append(link('/studio/analytics?video=' + encodeURIComponent(video.id), '数据', 'studio-btn'));
    }
    row.append(studioCover(video), details, tools);
    list.append(row);
  }
  return [panel(subheading('视频管理', group('studio-tools', search, link('/studio/upload', '投稿', 'studio-btn studio-primary'))), group('studio-row', filters, order),
    list.childElementCount ? list : node('p', 'studio-empty', '没有符合条件的稿件'), pager(data.total, page, page => change({ page })))];
}

function editVideo(video) {
  const dialog = node('dialog', 'studio-modal');
  const form = node('form');
  const title = node('input', 'studio-input');
  title.value = video.title;
  title.maxLength = 80;
  title.required = true;
  const description = node('textarea', 'studio-input');
  description.value = video.description || '';
  description.maxLength = 5000;
  const field = (label, input) => {
    const element = node('label', '', label);
    element.append(input);
    return element;
  };
  const submit = node('button', 'studio-btn studio-primary', '提交审核');
  const status = node('p', 'studio-muted');
  status.setAttribute('role', 'status');
  form.append(node('h2', '', '编辑稿件'), field('标题', title), field('简介', description), status,
    group('studio-tools', submit, action('取消', () => dialog.close())));
  dialog.append(form);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
  form.onsubmit = async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = '正在提交审核…';
    try {
      const { token } = await api('/api/auth/csrf');
      await api('/videos/' + encodeURIComponent(video.id), { method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-CSRF-Token': token,
      }, body: JSON.stringify({ title: title.value, description: description.value }) });
      dialog.close();
      refresh(videos);
    } catch (error) {
      status.textContent = error.message;
      submit.disabled = false;
    }
  };
}

let fanPage = 0;
async function fans() {
  const data = await api('/fans?page=' + fanPage);
  const list = node('ul', 'studio-list');
  for (const fan of data.items) {
    const avatar = node('img');
    avatar.alt = '';
    avatar.loading = 'lazy';
    avatar.onerror = () => { avatar.onerror = null; avatar.src = '/assets/guest-avatar.gif'; };
    avatar.src = '/api/authors/' + encodeURIComponent(fan.id) + '/avatar';
    const row = node('li', 'fan');
    row.append(avatar, node('span', '', fan.name), node('time', 'studio-muted', iso(fan.since).slice(0, 10)));
    list.append(row);
  }
  return [panel(subheading('粉丝列表', node('span', 'studio-muted', '我的粉丝数 ' + number.format(data.total))),
    data.items.length ? list : node('p', 'studio-empty', '暂无粉丝'), pager(data.total, fanPage, page => {
      fanPage = page;
      refresh(fans);
    }))];
}

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
  const pointer = svg('circle', { r: 4, fill: 'var(--chart)' });
  chart.append(guide, pointer);
  const focus = node('p', 'chart-focus studio-muted');
  const range = node('input');
  range.type = 'range';
  range.min = 0;
  range.max = data.length - 1;
  range.setAttribute('aria-label', '查看指定日期的数据');
  function inspect(index) {
    const point = data[index];
    guide.setAttribute('x1', x(index));
    guide.setAttribute('x2', x(index));
    pointer.setAttribute('cx', x(index));
    pointer.setAttribute('cy', y(point.value));
    range.value = index;
    focus.textContent = point.date + '　' + (fanData ? '总播放 ' + format(point.value) +
      '　当前粉丝播放 ' + format(fanData[index].value) : format(point.value));
    range.setAttribute('aria-valuetext', focus.textContent);
  }
  chart.onpointermove = event => {
    const bounds = chart.getBoundingClientRect();
    const relativeX = (event.clientX - bounds.left) * 840 / bounds.width;
    inspect(Math.max(0, Math.min(data.length - 1, Math.round((relativeX - left) / (right - left) * (data.length - 1)))));
  };
  range.oninput = () => inspect(Number(range.value));
  host.append(chart, focus, range);
  inspect(data.length - 1);
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
const analyticsVideo = new URLSearchParams(location.search).get('video') || '';

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
    group('studio-tools', filter, download)), group('studio-cards', ...cards.values()), graph);
}

const incomeOptions = {
  endpoint: '/income', title: '收益数据', keys: ['total', 'custom', 'monthly'],
  ranges: [[30, '近30天'], [365, '近1年']], variant: 'income',
};

async function analytics() {
  const keys = analyticsVideo
    ? ['plays', 'likes', 'favorites', 'coins', 'comments', 'danmaku', 'shares']
    : ['plays', 'visitors', 'followers', 'likes', 'favorites', 'coins', 'comments', 'danmaku', 'shares'];
  const options = {
    endpoint: '/analytics', title: analyticsVideo ? '单稿件数据' : '核心数据概览', keys,
    ranges: [[7, '近7天'], [30, '近30天'], [90, '近90天']], variant: 'analytics', video: analyticsVideo,
  };
  const primary = await trendPanel(analyticsChoice, options);
  primary.append(node('p', 'studio-muted', '播放趋势按有计数时间的会话统计，新增粉丝按当前关注记录统计。'));
  if (analyticsVideo) return [primary, link('/studio/videos', '返回稿件管理', 'studio-btn')];
  return [primary, await trendPanel(incomeChoice, incomeOptions)];
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

async function init() {
  const route = routes[location.pathname];
  if (!route) {
    setContent(panel(node('p', '', '页面不存在'), link('/studio', '返回创作首页', 'studio-btn')));
    content.removeAttribute('aria-busy');
    return;
  }
  try {
    account = await api('/api/auth/me');
  } catch (error) {
    if (error.status === 401) guest();
    else setContent(panel(node('p', '', '账号加载失败'), action('重新加载', init)));
    content.removeAttribute('aria-busy');
    return;
  }
  const profile = document.getElementById('studio-account');
  const avatar = profile.querySelector('img');
  avatar.onerror = () => { avatar.onerror = null; avatar.src = '/assets/guest-avatar.gif'; };
  avatar.src = '/api/authors/' + encodeURIComponent(account.uid) + '/avatar';
  profile.querySelector('span').textContent = account.name;
  profile.hidden = false;
  document.querySelector('.studio-nav a[href="' + location.pathname + '"]').setAttribute('aria-current', 'page');
  document.title = route[0] + ' · dilidili 创作中心';
  refresh(route[1]);
}

init();
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });

