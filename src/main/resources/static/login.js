const loginPopup = el('login-popover');
const loginDialog = el('login-dialog');
const loginForm = el('login-form');
const registerForm = el('register-form');
const registerResult = el('register-result');
const passwordToggles = loginDialog.querySelectorAll('.password-toggle');
let popupTimer;
let loginTrigger;
let currentAccount = null;
let accountNoticeTimer;
let registrationSubmitted = false;

function accountNotice(message) {
  const notice = el('account-notice');
  clearTimeout(accountNoticeTimer);
  notice.textContent = message;
  notice.hidden = false;
  accountNoticeTimer = setTimeout(() => notice.hidden = true, 3200);
}

function renderAccount(account) {
  currentAccount = account;
  el('nav-login').hidden = Boolean(account);
  el('nav-account').hidden = !account;
  el('nav-account-menu').open = false;
  if (account) {
    el('nav-account-name').textContent = account.name;
    el('nav-account-uid').textContent = 'UID ' + account.uid + ' · ' + account.level;
    el('nav-account-space').title = account.name + '的个人空间';
    const avatar = el('nav-account-image');
    avatar.onerror = () => { avatar.onerror = null; avatar.src = '/assets/guest-avatar.gif'; };
    avatar.src = '/api/authors/' + encodeURIComponent(account.uid) + '/avatar';
  }
  window.dispatchEvent(new CustomEvent('accountchange', { detail: account }));
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
  loginPopup.style.top = rect.bottom + window.scrollY + 14 + 'px';
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
  (currentAccount ? el('nav-account-name') : loginTrigger)?.focus({ preventScroll: true });
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
el('nav-logout').onclick = async (event) => {
  const button = event.currentTarget;
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
};

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
