const loginPopup = el('login-popover');
const loginDialog = el('login-dialog');
const loginForm = el('login-form');
const registerForm = el('register-form');
const registerResult = el('register-result');
const passwordToggles = loginDialog.querySelectorAll('.password-toggle');
const accountNav = document.getElementById('nav-account');
let popupTimer;
let loginTrigger;
let currentAccount = null;
let accountNoticeTimer;
let cardTimer;
let registrationSubmitted = false;

function openAccountCard() {
  clearTimeout(cardTimer);
  accountNav.classList.add('card-open');
}

function closeAccountCard() {
  clearTimeout(cardTimer);
  cardTimer = setTimeout(() => accountNav.classList.remove('card-open'), 200);
}

accountNav.addEventListener('mouseenter', openAccountCard);
accountNav.addEventListener('mouseleave', closeAccountCard);
accountNav.addEventListener('focusin', openAccountCard);
accountNav.addEventListener('focusout', event => {
  if (!accountNav.contains(event.relatedTarget)) closeAccountCard();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') accountNav.classList.remove('card-open');
});

function accountNotice(message, placement, anchor) {
  const notice = el('account-notice');
  clearTimeout(accountNoticeTimer);
  notice.classList.toggle('coin-success-notice', placement === 'coin-success');
  notice.classList.toggle('coin-limit-notice', placement === 'coin-limit');
  notice.classList.toggle('comment-block-notice', placement === 'comment-block');
  notice.style.removeProperty('--notice-left');
  notice.style.removeProperty('--notice-top');
  notice.textContent = message;
  notice.hidden = false;
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    const inset = notice.offsetWidth / 2 + 8;
    const center = Math.max(inset, Math.min(rect.left + rect.width / 2, document.documentElement.clientWidth - inset));
    notice.style.setProperty('--notice-left', `${center + window.scrollX}px`);
    const top = rect.top + window.scrollY - notice.offsetHeight - 12;
    notice.style.setProperty('--notice-top', `${Math.max(8, top)}px`);
  }
  accountNoticeTimer = setTimeout(() => notice.hidden = true, 3200);
}

function renderCardLevel(value) {
  const level = Math.max(0, Math.min(2, parseInt(String(value).replace(/\D/g, ''), 10) || 0));
  const badge = el('card-level');
  badge.src = '/assets/lv' + level + '.svg';
  badge.alt = 'LV' + level;
  const next = el('card-level-to');
  next.hidden = level === 2;
  if (level < 2) {
    next.src = '/assets/lv' + (level + 1) + '.svg';
    next.alt = 'LV' + (level + 1);
  }
  return level;
}

function renderAccount(account) {
  currentAccount = account;
  el('nav-login').hidden = Boolean(account);
  el('nav-account').hidden = !account;
  if (account) {
    el('card-name').textContent = account.name;
    renderCardLevel(account.level);
    el('nav-account-space').title = account.name + '的个人空间';
    const avatar = el('nav-account-image');
    avatar.onerror = () => { avatar.onerror = null; avatar.src = '/assets/guest-avatar.gif'; };
    avatar.src = '/api/authors/' + encodeURIComponent(account.uid) + '/avatar';
    loadAccountCard(account.uid);
  }
  window.dispatchEvent(new CustomEvent('accountchange', { detail: account }));
}

async function loadAccountCard(uid) {
  try {
    const summary = await authApi('me/summary');
    if (!summary || String(summary.uid) !== String(uid)) return;
    el('card-name').textContent = summary.name;
    const level = renderCardLevel(summary.level);
    el('card-coins').textContent = Math.round(Number(summary.coins) || 0);
    el('card-bcoins').textContent = Math.round(Number(summary.bcoins) || 0);
    el('card-following').textContent = summary.following;
    el('card-followers').textContent = summary.followers;
    el('card-videos').textContent = summary.videos;
    const avatar = el('card-avatar');
    avatar.onerror = () => { avatar.onerror = null; avatar.src = '/assets/guest-avatar.gif'; };
    avatar.src = '/api/authors/' + encodeURIComponent(uid) + '/avatar';
    const exp = Number(summary.experience) || 0;
    const next = summary.nextExp == null ? null : Number(summary.nextExp);
    const bar = el('card-level-bar');
    if (next == null) {
      bar.style.width = '100%';
      el('card-level-next').textContent = '已达最高等级';
    } else if (next <= 0) {
      bar.style.width = '100%';
      el('card-level-next').textContent = '完成转正答题即可升级';
    } else {
      bar.style.width = Math.min(100, Math.round(exp / next * 100)) + '%';
      el('card-level-next').textContent = `当前成长${exp}，距离升级Lv${level + 1}还需${Math.max(0, next - exp)}`;
    }
  } catch {
    if (String(currentAccount?.uid) !== String(uid)) return;
    for (const id of ['card-coins', 'card-bcoins', 'card-following', 'card-followers', 'card-videos']) {
      el(id).textContent = '—';
    }
    el('card-level-next').textContent = '数据加载失败';
  }
}

async function authApi(action, data) {
  const options = { cache: 'no-store' };
  if (data !== undefined) {
    const { token } = await authApi('csrf');
    Object.assign(options, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify(data),
    });
  }
  const response = await fetch('/api/auth/' + action, options);
  if (response.status === 204) return;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.message || '账号服务暂不可用，请稍后重试');
    error.status = response.status;
    throw error;
  }
  return result;
}

async function refreshAccount() {
  try { renderAccount(await authApi('me')); }
  catch (error) {
    if (error.status === 401) renderAccount(null);
    else if (personalSpace) window.dispatchEvent(new Event('accountloaderror'));
  }
}

function hideLoginPopup() {
  clearTimeout(popupTimer);
  loginPopup.hidden = true;
}

function showLoginPopup(button) {
  if (loginDialog.open || currentAccount) return;
  clearTimeout(popupTimer);
  loginTrigger = button;
  const full = button.dataset.login === '登录';
  el('login-popover-title').textContent = full ? '登录后你可以：' : {
    消息: '登录即可查看消息', 收藏: '登录即可查看我的收藏', 历史: '登录即可查看历史记录',
  }[button.dataset.login] || '';
  el('login-benefits').hidden = !full;
  el('popover-register').hidden = !full;
  loginPopup.classList.toggle('compact', !full);
  loginPopup.hidden = false;
  const rect = button.getBoundingClientRect();
  const left = Math.max(12, Math.min(rect.left + rect.width / 2 - loginPopup.offsetWidth / 2,
    document.documentElement.clientWidth - loginPopup.offsetWidth - 12));
  loginPopup.style.left = left + window.scrollX + 'px';
  loginPopup.style.top = rect.bottom + window.scrollY + 20 + 'px';
}

function openLogin(button = loginTrigger) {
  if (currentAccount) {
    accountNotice('你已登录，此功能暂未开放');
    return;
  }
  loginTrigger = button;
  hideLoginPopup();
  showAuthView('login');
}

function showAuthView(view) {
  resetPasswordVisibility();
  resetRegistrationValidation();
  loginForm.hidden = view !== 'login';
  registerForm.hidden = view !== 'register';
  registerResult.hidden = view !== 'result';
  el('login-title').textContent = { login: 'UID 登录', register: '注册账号', result: '注册成功' }[view];
  for (const id of ['login-message', 'copy-message']) el(id).textContent = '';
  if (!loginDialog.open) loginDialog.showModal();
  const first = view === 'login' ? loginForm.elements.uid
    : view === 'register' ? registerForm.elements.namedItem('name') : el('registered-uid');
  first.focus();
}

function delayHidePopup() {
  clearTimeout(popupTimer);
  popupTimer = setTimeout(hideLoginPopup, 160);
}

document.querySelectorAll('[data-login]').forEach((button) => {
  if (!button.hasAttribute('data-interaction')) button.addEventListener('click', () => openLogin(button));
  if (button.dataset.login === '创作中心' || button.closest('.space-actions') || button.hasAttribute('data-login-only')) return;
  button.addEventListener('mouseenter', () => showLoginPopup(button));
  button.addEventListener('mouseleave', delayHidePopup);
  button.addEventListener('focus', () => showLoginPopup(button));
  button.addEventListener('blur', (event) => {
    if (!loginPopup.contains(event.relatedTarget)) delayHidePopup();
  });
});
loginPopup.addEventListener('mouseenter', () => clearTimeout(popupTimer));
loginPopup.addEventListener('mouseleave', delayHidePopup);
loginPopup.addEventListener('focusin', () => clearTimeout(popupTimer));
loginPopup.addEventListener('focusout', (event) => {
  if (!loginPopup.contains(event.relatedTarget)) delayHidePopup();
});
el('popover-login').onclick = () => openLogin();
el('close-login').onclick = () => loginDialog.close();
el('back-to-login').onclick = () => showAuthView('login');
document.querySelectorAll('[data-register]').forEach((entry) => entry.addEventListener('click', (event) => {
  event.preventDefault();
  loginTrigger = entry.closest('#login-popover') ? el('nav-login') : loginTrigger;
  hideLoginPopup();
  showAuthView('register');
}));
loginDialog.addEventListener('click', (event) => {
  if (event.target !== loginDialog) return;
  const rect = loginDialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) loginDialog.close();
});
loginDialog.addEventListener('close', () => {
  loginForm.reset();
  registerForm.reset();
  resetPasswordVisibility();
  resetRegistrationValidation();
  setMascots(false);
  (currentAccount ? el('nav-account-space') : loginTrigger)?.focus({ preventScroll: true });
  hideLoginPopup();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideLoginPopup();
});
window.addEventListener('resize', hideLoginPopup);

function setMascots(coverEyes) {
  const state = coverEyes ? 'close' : 'open';
  document.querySelector('.mascot-left').src = '/assets/login-22-' + state + '.png';
  document.querySelector('.mascot-right').src = '/assets/login-33-' + state + '.png';
}
function setPasswordVisibility(toggle, visible) {
  el(toggle.getAttribute('aria-controls')).type = visible ? 'text' : 'password';
  toggle.setAttribute('aria-pressed', String(visible));
}

function resetPasswordVisibility() {
  passwordToggles.forEach((toggle) => setPasswordVisibility(toggle, false));
}

passwordToggles.forEach((toggle) => {
  toggle.addEventListener('click', () => {
    setPasswordVisibility(toggle, toggle.getAttribute('aria-pressed') === 'false');
  });
  const field = toggle.closest('.password-field');
  field.addEventListener('focusin', () => setMascots(true));
  field.addEventListener('focusout', (event) => {
    if (!field.contains(event.relatedTarget)) setMascots(false);
  });
});

function resetRegistrationValidation() {
  registrationSubmitted = false;
  registerForm.querySelectorAll('[aria-invalid]').forEach((input) => input.removeAttribute('aria-invalid'));
  el('register-message').textContent = '';
}

function validateRegistration() {
  const name = registerForm.elements.namedItem('name');
  const password = el('register-password');
  const confirmation = el('register-confirmation');
  const messages = [];
  for (const input of [name, password, confirmation]) input.removeAttribute('aria-invalid');

  function addError(input, message) {
    input.setAttribute('aria-invalid', 'true');
    messages.push(message);
  }

  if (registrationSubmitted && name.validity.valueMissing) addError(name, '请输入昵称');
  if (registrationSubmitted || password.value) {
    if ([...password.value].length < 8) addError(password, '密码至少需要 8 个字符');
    else if (new TextEncoder().encode(password.value).length > 72) {
      addError(password, '密码不能超过 72 个 UTF-8 字节');
    }
  }
  if (registrationSubmitted && !confirmation.value) addError(confirmation, '请再次输入密码');
  else if (confirmation.value && password.value !== confirmation.value) {
    addError(confirmation, '两次输入的密码不一致');
  }

  const message = el('register-message');
  const text = messages.join('。');
  if (message.textContent !== text) message.textContent = text;
  return messages.length === 0;
}

registerForm.addEventListener('focusout', (event) => {
  if (!registrationSubmitted && event.target.matches('.password-field input')
      && !event.target.parentElement.contains(event.relatedTarget)) {
    validateRegistration();
  }
});
registerForm.addEventListener('input', () => {
  if (registrationSubmitted) validateRegistration();
});

async function submitAuth(event, action, messageId) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  if (submit.disabled) return;
  if (action === 'register') {
    registrationSubmitted = true;
    if (!validateRegistration()) return;
  }
  const data = Object.fromEntries(new FormData(form));
  delete data.confirmation;
  submit.disabled = true;
  el(messageId).textContent = '';
  try {
    const account = await authApi(action, data);
    renderAccount(account);
    form.reset();
    if (action === 'register') {
      el('registered-uid').value = account.uid;
      el('registered-space').href = el('nav-account-space').href;
      showAuthView('result');
    } else {
      loginDialog.close();
      if (studioLogin) location.replace(studioLogin);
    }
  } catch (error) {
    el(messageId).textContent = error.status ? error.message : '连接失败，请稍后重试';
  } finally {
    submit.disabled = false;
  }
}

loginForm.addEventListener('submit', (event) => submitAuth(event, 'login', 'login-message'));
registerForm.addEventListener('submit', (event) => submitAuth(event, 'register', 'register-message'));
el('copy-uid').onclick = async () => {
  const uid = el('registered-uid');
  try {
    await navigator.clipboard.writeText(uid.value);
    el('copy-message').textContent = 'UID 已复制';
  } catch {
    uid.select();
    el('copy-message').textContent = '已选中 UID，请手动复制';
  }
};
async function doLogout(button) {
  button.disabled = true;
  try {
    await authApi('logout', {});
    renderAccount(null);
    el('nav-login').focus();
    accountNotice('已退出登录');
  } catch {
    accountNotice('退出失败，请重试');
  } finally {
    button.disabled = false;
  }
}
el('card-logout').onclick = (event) => doLogout(event.currentTarget);

window.addEventListener('pageshow', (event) => { if (event.persisted) refreshAccount(); });
const registrationPage = ['/service/注册', '/service/' + encodeURIComponent('注册')].includes(path);
const studioLogin = path === '/' && new Map([['1', '/studio'], ['upload', '/studio/upload']])
  .get(new URLSearchParams(location.search).get('studio-login'));
refreshAccount().then(() => {
  if (studioLogin) {
    if (currentAccount) location.replace(studioLogin);
    else openLogin(el('nav-login'));
  } else if (registrationPage && !currentAccount) {
    showAuthView('register');
  }
});
