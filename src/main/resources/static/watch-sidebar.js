function setupWatchSidebar({read, save, notice, getUsers, setUsers, onChange, isSignedIn, onViewChange}) {
  const settings = { enabled:true, disabledUsers:[], ...read('bili-shield-settings', {}) };
  let rules = read('bili-shield-rules', null) || (read('bili-danmaku-settings', {}).keywords || []).map(text => ({kind:'text',text,enabled:true}));
  const views = { list:'弹幕列表', block:'屏蔽设定', mine:'我的弹幕' };
  let tab = 'text', view = 'list';
  function persist() { save('bili-shield-settings', settings); save('bili-shield-rules', rules); onChange(); }
  function isBlocked(userId) { return settings.enabled && getUsers().has(userId) && !settings.disabledUsers.includes(userId); }
  function allowed(d) {
    if (!settings.enabled) return true;
    if (isBlocked(d.userId)) return false;
    return !rules.some(rule => {
      if (!rule.enabled) return false;
      if (rule.kind === 'text') return d.content.includes(rule.text);
      try { return new RegExp(rule.text.slice(1,-1), 'u').test(d.content); } catch { return false; }
    });
  }
  function render() {
    el('shield-enabled').checked = settings.enabled; el('shield-body').hidden = !settings.enabled;
    for (const value of ['text','regex','user']) { el('shield-tab-' + value).setAttribute('aria-selected',String(tab===value)); }
    const entries = tab === 'user' ? [...getUsers()].map(text => ({text, enabled:!settings.disabledUsers.includes(text)})) : rules.filter(r => r.kind === tab);
    el('shield-count').textContent = '内容（' + (entries.length || '-') + '）';
    el('shield-rows').replaceChildren(...entries.map(entry => {
      const row = node('div','shield-row');
      const state = node('button','shield-state',entry.enabled ? '启用' : '停用');
      state.setAttribute('aria-label',(entry.enabled?'停用':'启用')+'屏蔽规则 '+entry.text);
      state.onclick = () => {
        if (tab === 'user') { settings.disabledUsers = settings.disabledUsers.filter(id => id !== entry.text); if (entry.enabled) settings.disabledUsers.push(entry.text); }
        else entry.enabled = !entry.enabled;
        persist(); render();
      };
      const remove = node('button','shield-delete','删除'); remove.setAttribute('aria-label','删除屏蔽规则 '+entry.text);
      remove.onclick = () => { if (tab === 'user') { const users = new Set(getUsers()); users.delete(entry.text); setUsers(users); settings.disabledUsers = settings.disabledUsers.filter(id=>id!==entry.text); } else rules = rules.filter(rule=>rule!==entry); persist(); render(); };
      row.append(node('span','',entry.text),state,remove);return row;
    }));
  }
  function closeMenu() {
    el('danmaku-sidebar-menu-items').hidden = true;
    el('danmaku-sidebar-menu').setAttribute('aria-expanded', 'false');
  }
  function show(nextView, expand = true) {
    closeMenu();
    if (nextView === 'mine' && !isSignedIn()) return openLogin(el('danmaku-sidebar-menu'));
    const ownViewChanged = (view === 'mine') !== (nextView === 'mine');
    view = nextView;
    el('danmaku-sidebar-title').textContent = views[view];
    el('sidebar-list-view').hidden = view === 'block';
    el('sidebar-block-view').hidden = view !== 'block';
    el('danmaku-history').hidden = view === 'mine';
    if (expand) el('danmaku-panel').open = true;
    if (view === 'block') render();
    if (ownViewChanged) onViewChange();
  }
  el('danmaku-sidebar-menu').onclick = e => { e.preventDefault(); e.stopPropagation(); el('danmaku-sidebar-menu-items').hidden = !el('danmaku-sidebar-menu-items').hidden; el('danmaku-sidebar-menu').setAttribute('aria-expanded',String(!el('danmaku-sidebar-menu-items').hidden)); };
  for (const value of Object.keys(views)) el('sidebar-view-' + value).onclick = e => { e.preventDefault(); e.stopPropagation(); show(value); };
  for (const value of ['text','regex','user']) el('shield-tab-' + value).onclick = () => { tab = value; render(); };
  el('shield-enabled').onchange = e => { settings.enabled = e.target.checked; persist(); render(); };
  el('shield-add').onclick = () => {
    const text = el('shield-input').value.trim(); if (!text) return;
    if (tab === 'user') { const users = new Set(getUsers()); users.add(text); setUsers(users); }
    else { const kind = text.startsWith('/') && text.endsWith('/') ? 'regex' : tab === 'regex' ? 'regex' : 'text';
      if (kind === 'regex') { try { if (!text.startsWith('/') || !text.endsWith('/')) throw new Error(); new RegExp(text.slice(1,-1),'u'); } catch { return notice('请输入有效正则，例如 /关键词/'); } }
      if (!rules.some(r=>r.kind===kind&&r.text===text)) rules.push({kind,text,enabled:true}); tab = kind;
    }
    el('shield-input').value = ''; persist(); render();
  };
  el('shield-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); el('shield-add').onclick(); } });
  el('dm-keywords-open').onclick = () => { show('block'); el('danmaku-control').dataset.open = 'false'; };
  document.addEventListener('click', e => { if (!el('danmaku-sidebar-menu-items').contains(e.target) && e.target !== el('danmaku-sidebar-menu')) closeMenu(); });
  render();
  function setUserBlocked(id, block) {
    const users = new Set(getUsers()); if (block) { users.add(id); settings.enabled = true; } else users.delete(id);
    settings.disabledUsers = settings.disabledUsers.filter(value=>value!==id); setUsers(users); persist(); render();
  }
  function shieldDanmaku(danmaku) {
    const escaped = danmaku.content.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const text = '/^' + escaped + '$/';
    const existing = rules.find(rule => rule.kind === 'regex' && rule.text === text);
    if (existing) existing.enabled = true;
    else rules.push({kind:'regex', text, enabled:true});
    setUserBlocked(danmaku.userId, true);
  }
  return {
    allowed, isBlocked, setUserBlocked, shieldDanmaku,
    isOwnView: () => view === 'mine',
    leaveOwnView() { if (view === 'mine') show('list', false); }
  };
}

function setupDanmakuHistory({isSignedIn, rows, onSelect}) {
  const trigger = el('danmaku-history-toggle');
  const calendar = el('danmaku-history-calendar');
  const grid = el('danmaku-history-days');
  const previous = el('danmaku-history-previous');
  const next = el('danmaku-history-next');
  const reset = el('danmaku-history-reset');
  let month, selected = '', days = new Set();

  function monthKey(date) { return date.toISOString().slice(0, 7); }
  function today() {
    return new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date());
  }
  function close() {
    calendar.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }
  function select(date) {
    selected = date;
    close();
    onSelect(date);
    trigger.focus?.();
  }
  function render() {
    const key = monthKey(month);
    const available = [...days].sort();
    previous.disabled = !available.length || key <= available[0].slice(0, 7);
    next.disabled = key >= today().slice(0, 7);
    reset.hidden = !selected;
    el('danmaku-history-month').textContent = month.getUTCFullYear() + '年 ' + (month.getUTCMonth() + 1) + '月';
    const cells = [];
    for (let i = 0; i < month.getUTCDay(); i++) cells.push(node('span', '', ''));
    const last = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
    for (let day = 1; day <= last; day++) {
      const date = key + '-' + String(day).padStart(2, '0');
      const button = node('button', '', String(day));
      button.type = 'button';
      button.disabled = !days.has(date);
      button.setAttribute('aria-label', date);
      button.setAttribute('aria-pressed', String(date === selected));
      button.onclick = () => select(date);
      cells.push(button);
    }
    grid.replaceChildren(...cells);
  }
  function moveMonth(delta) {
    month.setUTCMonth(month.getUTCMonth() + delta);
    render();
  }
  previous.onclick = () => moveMonth(-1);
  next.onclick = () => moveMonth(1);
  reset.onclick = () => select('');
  trigger.onclick = () => {
    if (!isSignedIn()) return openLogin(trigger);
    if (!calendar.hidden) return close();
    const limit = today();
    days = new Set(rows().map(row => row.sentAt?.slice(0, 10)).filter(date => date && date <= limit));
    const initial = selected || [...days].sort().at(-1) || limit;
    month = new Date(initial.slice(0, 7) + '-01T00:00:00Z');
    render();
    calendar.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  };
  document.addEventListener('click', e => {
    if (e.target !== trigger && !calendar.contains(e.target)) close();
  });
  el('sidebar-view-block').addEventListener('click', close);
  el('sidebar-view-mine').addEventListener('click', close);
  el('dm-keywords-open').addEventListener('click', close);
  el('danmaku-panel').addEventListener('toggle', () => {
    if (!el('danmaku-panel').open) close();
  });
  calendar.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
    trigger.focus?.();
  });
  close();
  return () => {
    close();
    if (selected) {
      selected = '';
      onSelect('');
    }
  };
}
