async function interaction(path, method = 'GET', body, keepalive = false, csrfToken) {
  return apiRequest('/api/interactions', path, { method, body, keepalive, csrfToken, fallback: '互动操作失败，请稍后重试' });
}

function memberAction(button, action) {
  button.onclick = async () => {
    if (!currentAccount) return openLogin(button);
    button.disabled = true;
    try { await action(); }
    catch (error) { accountNotice(error.message); }
    finally { button.disabled = false; }
  };
}

function interactionPanel(title, build, fullscreenParent = document.body) {
  const dialog = node('dialog', 'interaction-dialog');
  const heading = node('h2', '', title);
  heading.id = 'interaction-dialog-title';
  dialog.setAttribute('aria-labelledby', heading.id);
  const close = node('button', 'interaction-close', '关闭');
  close.type = 'button';
  close.onclick = () => dialog.close();
  const body = node('div', 'interaction-body');
  const status = node('p', 'interaction-status');
  status.setAttribute('role', 'status');
  dialog.append(heading, close, body, status);
  fullscreenParent.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
  Promise.resolve().then(() => build(body, status, () => dialog.close())).catch(error => {
    status.textContent = error.message;
  });
}

function interactionForm(body, status, fields, label, submit) {
  const form = node('form', 'interaction-form');
  const send = node('button', 'login-primary', label);
  send.type = 'submit';
  fields.forEach(({ label, input }) => {
    const field = node('label');
    field.append(node('span', '', label), input);
    form.append(field);
  });
  form.append(send);
  form.onsubmit = async (event) => {
    event.preventDefault();
    send.disabled = true;
    status.textContent = '';
    try { await submit(); }
    catch (error) { status.textContent = error.message; }
    finally { send.disabled = false; }
  };
  body.append(form);
}

function textInteraction(title, label, max, submit, multiline = true) {
  interactionPanel(title, (body, status, close) => {
    const input = node(multiline ? 'textarea' : 'input');
    input.required = true;
    input.maxLength = max;
    if (multiline) input.rows = 4;
    else { input.inputMode = 'numeric'; input.pattern = '[1-9][0-9]{0,19}'; }
    interactionForm(body, status, [{ label, input }], '发送', async () => {
      await submit(input.value.trim());
      close();
      accountNotice('发送成功');
    });
  }, document.fullscreenElement || document.body);
}

function reportInteraction(kind, id, done) {
  interactionPanel('举报', async (body, status, close) => {
    const reasons = await interaction('/reports/' + kind + '/reasons');
    if (!reasons.length) { status.textContent = '当前没有可选的举报原因'; return; }
    const reason = node('select');
    reason.required = true;
    const placeholder = node('option', '', '请选择');
    placeholder.value = '';
    reason.append(placeholder);
    reasons.forEach(entry => { const option = node('option', '', entry.name); option.value = entry.id; reason.append(option); });
    const description = node('textarea');
    description.rows = 3;
    description.maxLength = 200;
    interactionForm(body, status, [{ label: '举报原因', input: reason }, { label: '补充说明（选填）', input: description }], '提交举报', async () => {
      await interaction('/reports/' + kind + '/' + id, 'POST', { reason: reason.value, description: description.value });
      close();
      accountNotice('举报已提交');
      done?.();
    });
  }, document.fullscreenElement || document.body);
}

async function danmakuReportInteraction(playerShell, danmaku, shieldDanmaku) {
  if (playerShell.querySelector('.danmaku-report[open]')) return;

  const dialog = node('dialog', 'danmaku-report');
  const title = node('h2', 'danmaku-report-title', danmaku.content);
  title.id = 'danmaku-report-title';
  dialog.setAttribute('aria-labelledby', title.id);
  const close = node('button', 'danmaku-report-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', '关闭弹幕举报');
  close.onclick = () => dialog.close();
  const status = node('p', 'danmaku-report-status', '正在加载举报类型…');
  status.setAttribute('role', 'status');
  dialog.append(title, close, status);
  dialog.addEventListener('close', () => dialog.remove(), { once:true });
  dialog.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') dialog.close();
  });
  playerShell.append(dialog);
  dialog.show();

  try {
    const reasons = await interaction('/reports/danmaku/reasons');
    if (!dialog.open) return;
    if (!reasons.length) { status.textContent = '当前没有可选的举报原因'; return; }
    status.textContent = '';

    const form = node('form', 'danmaku-report-form');
    const choices = node('fieldset', 'danmaku-report-choices');
    choices.setAttribute('aria-label', '弹幕举报原因');
    const details = node('label', 'danmaku-report-details');
    const description = node('textarea');
    description.maxLength = 200;
    description.placeholder = '请填写违规内容出现的时间点和详细描述';
    details.append(node('span', '', '详细描述（选填）'), description);

    const options = node('div', 'danmaku-report-options');
    const shieldLabel = node('label', 'danmaku-report-check');
    const shield = node('input', 'report-check');
    shield.type = 'checkbox';
    shield.checked = true;
    shieldLabel.append(shield, '屏蔽相同弹幕与该用户发送的弹幕');
    const blockLabel = node('label', 'danmaku-report-check');
    const block = node('input', 'report-check');
    block.type = 'checkbox';
    blockLabel.append(block, '拉黑该用户');
    options.append(shieldLabel, blockLabel);

    const footer = node('div', 'danmaku-report-footer');
    const cancel = node('button', 'danmaku-report-cancel', '取消');
    cancel.type = 'button';
    cancel.onclick = close.onclick;
    const send = node('button', 'danmaku-report-send', '提交');
    send.type = 'submit';
    send.disabled = true;
    footer.append(cancel, send);

    let selected, submitting = false;
    for (const reason of reasons) {
      const row = node('div', 'danmaku-report-row');
      const label = node('label', 'danmaku-report-reason');
      const radio = node('input', 'report-radio');
      radio.type = 'radio';
      radio.name = 'danmaku-report-reason';
      radio.value = reason.id;
      radio.onchange = () => {
        if (!radio.checked || submitting) return;
        selected = reason.id;
        row.append(details);
        send.disabled = false;
        status.textContent = '';
        const bounds = choices.getBoundingClientRect();
        const top = row.getBoundingClientRect().top - bounds.top;
        const overflow = details.getBoundingClientRect().bottom - bounds.bottom;
        if (top < 0) choices.scrollTop += top;
        else if (overflow > 0) choices.scrollTop += Math.min(top, overflow);
      };
      label.append(node('span', '', reason.name), radio);
      row.append(label);
      choices.append(row);
    }
    form.append(choices, options, status, footer);
    dialog.append(form);
    form.onsubmit = async event => {
      event.preventDefault();
      if (submitting || !selected) return;
      submitting = true;
      send.disabled = choices.disabled = true;
      status.textContent = '';
      const shouldShield = shield.checked;
      try {
        await interaction('/reports/danmaku/' + encodeURIComponent(danmaku.id), 'POST', {
          reason: selected,
          description: description.value.trim(),
          blockAuthor: block.checked
        });
        if (shouldShield) shieldDanmaku();
        dialog.close();
        accountNotice('举报已提交');
      } catch (error) {
        status.textContent = error.message;
      } finally {
        submitting = false;
        send.disabled = choices.disabled = false;
      }
    };
  } catch (error) {
    status.textContent = error.message;
  }
}

function videoReportInteraction(id, authorId, authorName) {
  interactionPanel('举报', async (body, status, close) => {
    const dialog = body.closest('dialog');
    dialog.classList.add('video-report-dialog');
    const closeButton = dialog.querySelector('.interaction-close');
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', '关闭举报弹窗');
    status.textContent = '正在加载举报类型…';
    const reasons = await interaction('/reports/video/reasons');
    status.textContent = '';
    if (!reasons.length) {
      status.textContent = '当前没有可选的举报原因';
      return;
    }

    const form = node('form', 'video-report-form');
    const choices = node('div', 'video-report-choices');
    const details = node('div', 'video-report-details');
    const guidance = node('p', 'video-report-guidance');
    const descriptionLabel = node('label', 'video-report-description-label', '详细描述');
    descriptionLabel.htmlFor = 'video-report-description';
    const requiredMark = node('span', 'video-report-required', '*');
    requiredMark.setAttribute('aria-hidden', 'true');
    descriptionLabel.append(requiredMark);

    const limit = 200;
    const inputBox = node('div', 'video-report-input');
    const description = node('textarea');
    description.id = descriptionLabel.htmlFor;
    description.required = true;
    description.maxLength = limit;
    description.rows = 3;
    description.placeholder = '请填写违规内容的具体片段（X分X秒）和详细描述';
    const count = node('span', 'video-report-count', '0/' + limit);
    count.setAttribute('aria-hidden', 'true');
    inputBox.append(description, count);
    details.append(guidance, descriptionLabel, inputBox);

    const footer = node('div', 'video-report-footer');
    const blockLabel = node('label', 'video-report-block');
    const block = node('input', 'report-check');
    block.type = 'checkbox';
    blockLabel.hidden = true;
    blockLabel.append(block, '拉黑@' + authorName);
    const cancel = node('button', 'video-report-cancel', '取消');
    cancel.type = 'button';
    cancel.onclick = close;
    const send = node('button', 'video-report-send', '提交');
    send.type = 'submit';
    footer.append(blockLabel, cancel, send);

    let selected, submitting = false;
    function updateSend() {
      count.textContent = description.value.length + '/' + limit;
      send.disabled = submitting || !selected || !description.value.trim();
    }
    description.oninput = updateSend;
    const groups = [
      ['侵犯合法权益', reasons.filter(reason => reason.name.startsWith('侵犯'))],
      ['违反社区规则', reasons.filter(reason => !reason.name.startsWith('侵犯'))]
    ];
    for (const [title, entries] of groups) {
      if (!entries.length) continue;
      const group = node('fieldset', 'video-report-group');
      group.append(node('legend', '', title));
      for (let index = 0; index < entries.length; index += 3) {
        const row = node('div', 'video-report-row');
        for (const reason of entries.slice(index, index + 3)) {
          const option = node('label', 'video-report-option');
          const radio = node('input', 'report-radio');
          radio.type = 'radio';
          radio.name = 'video-report-reason';
          radio.value = reason.id;
          radio.onchange = () => {
            if (!radio.checked) return;
            selected = reason.id;
            guidance.textContent = reason.description;
            row.after(details);
            blockLabel.hidden = String(currentAccount?.uid) === String(authorId);
            status.textContent = '';
            updateSend();
            const view = choices.getBoundingClientRect();
            const rowTop = row.getBoundingClientRect().top - view.top;
            const overflow = details.getBoundingClientRect().bottom - view.bottom;
            if (rowTop < 0) choices.scrollTop += rowTop;
            else if (overflow > 0) choices.scrollTop += Math.min(rowTop, overflow);
          };
          const name = reason.name.match(/^(.+?)(（[^）]+）)$/);
          const label = node('span', '', name ? name[1] : reason.name);
          if (name) label.append(node('span', 'video-report-option-note', name[2]));
          option.append(radio, label);
          row.append(option);
        }
        group.append(row);
      }
      choices.append(group);
    }

    form.append(choices, footer);
    body.append(form);
    updateSend();
    form.onsubmit = async event => {
      event.preventDefault();
      if (send.disabled) return;
      submitting = true;
      updateSend();
      status.textContent = '';
      try {
        await interaction('/reports/video/' + encodeURIComponent(id), 'POST', {
          reason: selected,
          description: description.value.trim(),
          blockAuthor: !blockLabel.hidden && block.checked
        });
        close();
        accountNotice('举报已提交');
      } catch (error) {
        status.textContent = error.message;
      } finally {
        submitting = false;
        updateSend();
      }
    };
  });
}

function pressInteraction(button, enabled) {
  button.setAttribute('aria-pressed', String(enabled));
}

const likeBindings = new WeakMap();

function bindLike(button, kind, id, render, load = true, onToggle) {
  const resource = '/likes/' + kind + '/' + id;
  const binding = { savingStarted: false };
  likeBindings.set(button, binding);
  const apply = (result, uid) => {
    if (likeBindings.get(button) !== binding || currentAccount?.uid !== uid) return;
    pressInteraction(button, result.enabled);
    render(result.count);
    return true;
  };
  memberAction(button, async () => {
    binding.savingStarted = true;
    const uid = currentAccount.uid;
    const existing = await interaction(resource);
    if (currentAccount?.uid !== uid) return;
    const result = await interaction(resource, 'PUT', { enabled: !existing.enabled });
    if (apply(result, uid) && result.enabled !== existing.enabled) onToggle?.(result.enabled);
  });
  if (load && (currentAccount || kind === 'danmaku')) {
    const uid = currentAccount?.uid;
    interaction(resource).then(result => { if (!binding.savingStarted) apply(result, uid); }).catch(() => {});
  }
}

function showVideoLikeCelebration(button, enabled) {
  button.querySelector('.video-like-celebration')?.remove();
  if (!enabled) return;
  const celebration = node('span', 'video-like-celebration');
  celebration.setAttribute('aria-hidden', 'true');
  const artwork = node('img');
  artwork.alt = '';
  artwork.src = '/assets/video-like-celebration.png';
  celebration.hidden = true;
  celebration.append(artwork);
  celebration.addEventListener('animationend', () => celebration.remove(), { once: true });
  button.append(celebration);
  artwork.decode().then(() => { celebration.hidden = false; }).catch(() => celebration.remove());
}

function setupAuthorInteractions(id, root, renderFollowers) {
  const follow = [...root.querySelectorAll('[data-interaction=follow]')];
  const block = root.querySelector('[data-interaction=block]');
  const message = root.querySelector('[data-interaction=message]');
  const report = root.querySelector('[data-interaction=account-report]');
  const resource = '/authors/' + id + '/relation';
  const apply = (result) => {
    if (renderFollowers) renderFollowers(result.followers);
    for (const button of follow) {
      pressInteraction(button, result.following);
      button.querySelector('[data-follow-label]').textContent = result.following ? '已关注' : '关注';
    }
    if (block) {
      pressInteraction(block, result.blocked);
      block.textContent = result.blocked ? '移出黑名单' : '加入黑名单';
    }
  };
  const refresh = async () => {
    const uid = currentAccount?.uid;
    [...follow, block, message, report].filter(Boolean).forEach(button => { button.hidden = uid === id; });
    const result = await interaction(resource);
    if (currentAccount?.uid === uid) apply(result);
  };
  follow.forEach(button => memberAction(button, async () => {
    const state = await interaction(resource);
    apply(await interaction(resource + '/follow', 'PUT', { enabled: !state.following }));
  }));
  if (block) memberAction(block, async () => {
    const state = await interaction(resource);
    apply(await interaction(resource + '/block', 'PUT', { enabled: !state.blocked }));
  });
  if (message) memberAction(message, () => {
    location.assign('/messages?' + new URLSearchParams({ uid: id }));
  });
  if (report) memberAction(report, () => reportInteraction('account', id));
  const refreshQuietly = () => refresh().catch(() => {});
  window.addEventListener('accountchange', refreshQuietly);
  refreshQuietly();
}

function setupPeopleList(button, id, kind, title) {
  memberAction(button, () => interactionPanel(title, async body => {
    const people = await interaction('/authors/' + id + '/relations/' + kind);
    appendInteractionList(body, people, person => {
      const row = node('li');
      row.append(link('/space/' + person.id, person.name));
      return row;
    });
  }));
}

function videoCoinInteraction(id, uid, remaining, applyCoins, applyLike, showCoinLimit) {
  const resource = '/videos/' + encodeURIComponent(id);
  interactionPanel('为视频投币', (body, status, close) => {
    const dialog = body.closest('dialog');
    dialog.classList.add('video-coin-dialog');
    const closeButton = dialog.querySelector('.interaction-close');
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', '关闭投币弹窗');
    const amountText = node('strong', 'video-coin-amount', '1');
    dialog.querySelector('h2').replaceChildren('给 UP 主投上 ', amountText, ' 枚硬币');

    const form = node('form', 'video-coin-form');
    const choices = node('fieldset', 'video-coin-choices');
    choices.setAttribute('aria-label', '投币数量');
    let amount = 1, submitting = false;
    for (let value = 1; value <= remaining; value++) {
      const option = node('label', 'video-coin-choice');
      const radio = node('input');
      radio.type = 'radio';
      radio.name = 'video-coin-amount';
      radio.value = value;
      radio.checked = value === amount;
      radio.onchange = () => {
        if (!radio.checked) return;
        amount = value;
        amountText.textContent = String(value);
        status.textContent = '';
      };
      const artwork = node('span', 'video-coin-artwork');
      artwork.setAttribute('aria-hidden', 'true');
      const asset = value === 1 ? '/assets/coin-one' : '/assets/coin-two';
      for (const selected of [false, true]) {
        const image = node('img', selected ? 'video-coin-art-selected' : 'video-coin-art-default');
        image.alt = '';
        image.draggable = false;
        image.src = asset + (selected ? '-selected.png' : '.png');
        artwork.append(image);
      }
      option.append(radio, node('span', '', value + ' 硬币'), artwork);
      choices.append(option);
    }
    const likeLabel = node('label', 'video-coin-like');
    const alsoLike = node('input', 'report-check');
    alsoLike.type = 'checkbox';
    alsoLike.checked = true;
    likeLabel.append(alsoLike, '同时点赞内容');
    const submit = node('button', 'login-primary video-coin-submit', '确定');
    submit.type = 'submit';
    form.append(choices, likeLabel, submit);
    body.append(form);

    dialog.addEventListener('cancel', event => { if (submitting) event.preventDefault(); });
    form.onsubmit = async event => {
      event.preventDefault();
      if (submitting) return;
      if (currentAccount?.uid !== uid) { close(); return; }
      const shouldLike = alsoLike.checked;
      submitting = choices.disabled = alsoLike.disabled = closeButton.disabled = submit.disabled = true;
      status.textContent = '';
      let result;
      try {
        result = await interaction(resource + '/coins', 'POST', { value: amount });
      } catch (error) {
        const state = await interaction(resource + '/state').catch(() => null);
        if (currentAccount?.uid !== uid) { close(); return; }
        if (state) {
          const available = applyCoins(state.coinsGiven);
          if (available === 0) {
            close();
            showCoinLimit();
            return;
          }
          if (available < remaining) {
            close();
            videoCoinInteraction(id, uid, available, applyCoins, applyLike, showCoinLimit);
            return;
          }
        }
        status.textContent = error.message;
        submitting = choices.disabled = alsoLike.disabled = closeButton.disabled = submit.disabled = false;
        return;
      }
      el('coin-count').textContent = shortCount(result.count);
      if (currentAccount?.uid === uid) applyCoins(result.coinsGiven);
      let feedback = '投币成功，感谢您的支持';
      if (shouldLike && currentAccount?.uid === uid) {
        try {
          const like = await interaction('/likes/video/' + encodeURIComponent(id), 'PUT', { enabled: true });
          if (currentAccount?.uid === uid) applyLike(like);
        } catch {
          feedback = '投币成功，点赞未成功';
        }
      }
      close();
      accountNotice(feedback, 'coin-success');
    };
  });
}

function videoFavoriteInteraction(resource, uid, applyFavorite) {
  interactionPanel('添加到收藏夹', async (body, status, close) => {
    const dialog = body.closest('dialog');
    dialog.classList.add('video-favorite-dialog');
    const closeButton = dialog.querySelector('.interaction-close');
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', '关闭收藏窗口');
    const list = node('fieldset', 'favorite-folders');
    list.setAttribute('aria-label', '收藏夹列表');
    const newButton = node('button', 'favorite-new', '新建收藏夹');
    const editor = node('form', 'favorite-editor');
    editor.hidden = true;
    const hint = node('div', 'favorite-editor-hint', '点击弹窗内其他区域或ESC键，取消新建收藏夹');
    const hideHint = node('button', '', '×');
    hideHint.type = 'button';
    hideHint.setAttribute('aria-label', '关闭新建提示');
    hint.append(hideHint);
    const error = node('p', 'favorite-editor-error');
    error.id = 'favorite-name-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const input = node('input');
    input.placeholder = '最多可输入20个字';
    input.setAttribute('aria-label', '收藏夹名称');
    input.setAttribute('aria-describedby', error.id);
    const create = node('button', '', '新建');
    create.type = 'submit';
    const inputRow = node('div', 'favorite-editor-row');
    inputRow.append(input, create);
    editor.append(hint, error, inputRow);
    const footer = node('div', 'favorite-dialog-footer');
    const confirm = node('button', 'login-primary favorite-confirm', '确定');
    footer.append(confirm);
    body.append(list, newButton, editor, footer);

    const choices = new Map();
    let loading = true, saving = false, editing = false;
    const changes = () => Array.from(choices, ([id, { box, selected }]) => ({ id, enabled: box.checked, selected }))
      .filter(({ enabled, selected }) => enabled !== selected).map(({ id, enabled }) => ({ id, enabled }));
    const updateControls = () => {
      list.disabled = loading || saving || editing;
      newButton.disabled = loading || saving;
      confirm.disabled = list.disabled || changes().length === 0;
      closeButton.disabled = saving;
      input.disabled = create.disabled = saving;
    };
    const addFolder = (folder, prepend) => {
      const row = node('label', 'favorite-folder');
      const box = node('input', 'report-check');
      box.type = 'checkbox';
      box.checked = folder.selected;
      box.disabled = !folder.selected && folder.capacity != null && folder.count >= folder.capacity;
      const name = node('span', 'favorite-folder-name', folder.name);
      name.title = folder.name;
      if (folder.privateFolder) name.append(node('i', 'favorite-folder-privacy', ' [私密]'));
      const count = node('span', 'favorite-folder-count');
      const renderCount = () => {
        const total = folder.count + Number(box.checked) - Number(folder.selected);
        count.textContent = folder.capacity == null ? String(total) : total + '/' + folder.capacity;
      };
      box.onchange = () => {
        renderCount();
        updateControls();
      };
      renderCount();
      choices.set(folder.id, { box, selected: folder.selected });
      row.append(box, name, count);
      if (prepend) list.prepend(row);
      else list.append(row);
    };
    const clearError = () => {
      error.hidden = true;
      error.textContent = '';
      input.removeAttribute('aria-invalid');
    };
    const showError = message => {
      error.hidden = false;
      error.textContent = message;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    };
    const endEditing = () => {
      editing = false;
      editor.hidden = true;
      newButton.hidden = false;
      input.value = '';
      clearError();
      updateControls();
      newButton.focus();
    };
    newButton.onclick = () => {
      editing = true;
      newButton.hidden = true;
      editor.hidden = false;
      hint.hidden = false;
      status.textContent = '';
      updateControls();
      input.focus();
    };
    hideHint.onclick = () => { hint.hidden = true; input.focus(); };
    const limitName = () => {
      const characters = Array.from(input.value);
      if (characters.length > 20) input.value = characters.slice(0, 20).join('');
    };
    input.oninput = event => { if (!event.isComposing) limitName(); clearError(); };
    input.oncompositionend = limitName;
    dialog.addEventListener('click', event => {
      if (editing && !saving && !editor.contains(event.target) && !newButton.contains(event.target)) endEditing();
    }, { capture: true });
    dialog.addEventListener('cancel', event => {
      if (!saving && !editing) return;
      event.preventDefault();
      if (!saving) endEditing();
    });
    editor.onsubmit = async event => {
      event.preventDefault();
      if (!editing || saving) return;
      if (currentAccount?.uid !== uid) { close(); return; }
      const name = input.value.trim();
      if (!name) { showError('请填写收藏夹名称'); return; }
      saving = true;
      clearError();
      updateControls();
      try {
        const result = await interaction(resource, 'POST', { name });
        if (currentAccount?.uid !== uid) { close(); return; }
        addFolder(result.folder, true);
        list.scrollTop = 0;
        applyFavorite(result.state);
        saving = false;
        endEditing();
      } catch (err) {
        saving = false;
        updateControls();
        showError(err.message);
      }
    };
    confirm.onclick = async () => {
      if (confirm.disabled) return;
      if (currentAccount?.uid !== uid) { close(); return; }
      const pending = changes();
      saving = true;
      status.textContent = '';
      updateControls();
      try {
        const state = await interaction(resource, 'PUT', { changes: pending });
        if (currentAccount?.uid === uid) {
          applyFavorite(state);
        }
        close();
      } catch (err) {
        status.textContent = err.message;
      } finally {
        saving = false;
        updateControls();
      }
    };
    updateControls();
    const folders = await interaction(resource);
    if (!dialog.open || currentAccount?.uid !== uid) { close(); return; }
    folders.forEach(folder => addFolder(folder, false));
    loading = false;
    updateControls();
  });
}

function setupVideoInteractions(id, author, player, duration, onDanmaku, authorName) {
  const root = el('video-page');
  const resource = '/videos/' + id;
  const like = el('video-like'), coin = el('video-coin'), favorite = el('video-favorite'), subscribe = el('video-subscribe');
  let coinViewer, coinsGiven = 0;
  const applyCoins = total => {
    const uid = currentAccount?.uid;
    coinsGiven = coinViewer === uid ? Math.max(coinsGiven, total) : total;
    coinViewer = uid;
    pressInteraction(coin, coinsGiven > 0);
    return Math.max(0, Math.floor(2 - coinsGiven));
  };
  const showCoinLimit = () => accountNotice('对本稿件的投币枚数已用完', 'coin-limit', coin);
  if (root) setupAuthorInteractions(author, root, followers => { el('watch-followers').textContent = shortCount(followers); });
  const renderLikeCount = count => { el('like-count').textContent = shortCount(count); };
  bindLike(like, 'video', id, renderLikeCount, false, enabled => showVideoLikeCelebration(like, enabled));
  let favoriteRevision = 0;
  memberAction(favorite, () => videoFavoriteInteraction(resource + '/folders', currentAccount.uid, result => {
    favoriteRevision++;
    pressInteraction(favorite, result.enabled);
    el('favorite-count').textContent = shortCount(result.count);
  }));
  const applyCoinLike = result => {
    const wasLiked = like.getAttribute('aria-pressed') === 'true';
    pressInteraction(like, result.enabled);
    renderLikeCount(result.count);
    if (result.enabled && !wasLiked) showVideoLikeCelebration(like, true);
  };
  memberAction(coin, async () => {
    const uid = currentAccount.uid;
    if (coinViewer === uid && coinsGiven > 1) return showCoinLimit();
    const state = await interaction(resource + '/state');
    if (currentAccount?.uid !== uid) return;
    const remaining = applyCoins(state.coinsGiven);
    if (remaining === 0) return showCoinLimit();
    videoCoinInteraction(id, uid, remaining, applyCoins, applyCoinLike, showCoinLimit);
  });
  memberAction(el('video-share'), () => location.assign('/messages?' + new URLSearchParams({ forward: id })));
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      api(resource + '/engagement').then(stats => { el('share-count').textContent = shortCount(stats.share); }).catch(() => {});
    }
  });
  memberAction(el('video-report'), () => videoReportInteraction(id, author, authorName));
  const renderSubscription = (on) => {
    pressInteraction(subscribe, on);
    subscribe.textContent = on ? '已订阅' : '订阅合集';
  };
  memberAction(subscribe, async () => {
    const state = await interaction(resource + '/state');
    const result = await interaction(resource + '/subscription', 'PUT', { enabled: !state.subscribed });
    renderSubscription(result.enabled);
  });
  const guestPrompt = el('danmaku-guest'), guestSend = el('danmaku-guest-send');
  guestPrompt.onclick = () => openLogin(guestPrompt);
  const composer = el('danmaku-entry'), danmaku = el('danmaku-text'), send = el('danmaku-send');
  const color = setupDanmakuStyle();
  let pending = null;
  function finishSend() {
    if (pending) clearInterval(pending.timer);
    pending = null;
    send.disabled = false;
    send.textContent = '发送';
  }
  composer.onsubmit = (event) => {
    event.preventDefault();
    if (composer.inert) return;
    const uid = currentAccount?.uid;
    if (!uid) return openLogin(send);
    const value = danmaku.value.trim();
    if (pending || !value) return;
    const mode = composer.elements.namedItem('mode').value;
    const size = composer.elements.namedItem('size').value;
    const style = { mode, size, color: color.value };
    const deadline = performance.now() + 5000;
    const queued = { uid, timer: null };
    pending = queued;
    danmaku.value = '';
    send.disabled = true;
    send.textContent = '5 秒';
    queued.timer = setInterval(async () => {
      if (pending !== queued || currentAccount?.uid !== uid) return;
      const remaining = Math.ceil((deadline - performance.now()) / 1000);
      if (remaining > 0) {
        const label = remaining + ' 秒';
        if (send.textContent !== label) send.textContent = label;
        return;
      }
      clearInterval(queued.timer);
      send.textContent = '发送中';
      const position = Math.max(0, Math.min(duration, Math.floor(player.currentTime)));
      try {
        const { token } = await authApi('csrf');
        if (pending !== queued || currentAccount?.uid !== uid) return;
        const row = await interaction(resource + '/danmaku', 'POST', { value, position, ...style }, false, token);
        if (pending === queued) onDanmaku(row);
      } catch (error) {
        if (pending !== queued) return;
        if (!danmaku.value) danmaku.value = value;
        accountNotice(error.message);
      } finally {
        if (pending === queued) finishSend();
      }
    }, 100);
  };

  let viewer, progressToken, lastSaved, saving = false, progressReady = false, played = false;
  const currentPosition = () => Math.max(0, Math.min(duration, Math.floor(player.currentTime)));
  async function saveProgress(final = false) {
    if (!viewer || !progressReady || saving || !played || (final && !progressToken)) return;
    const value = currentPosition();
    if (value === lastSaved) return;
    saving = true;
    const uid = viewer;
    try {
      await interaction(resource + '/progress', 'PUT', { value }, final, progressToken);
      if (viewer === uid) lastSaved = value;
    } catch {} finally { saving = false; }
  }
  const record = () => { played = true; saveProgress(); };
  player.addEventListener('play', record);
  player.addEventListener('timeupdate', () => {
    if (lastSaved === undefined || Math.abs(currentPosition() - lastSaved) >= 10) saveProgress();
  });
  player.addEventListener('pause', () => saveProgress());
  window.addEventListener('pagehide', () => saveProgress(true));

  async function refresh() {
    const uid = currentAccount?.uid;
    if (coinViewer !== uid) applyCoins(0);
    if (pending && pending.uid !== uid) finishSend();
    guestPrompt.hidden = guestSend.hidden = Boolean(uid);
    composer.hidden = !uid;
    if (viewer !== uid) {
      viewer = uid;
      progressToken = undefined;
      lastSaved = undefined;
      progressReady = false;
      played = !player.paused;
    }
    const revision = favoriteRevision;
    const [state, csrf] = await Promise.all([interaction(resource + '/state'), uid ? authApi('csrf') : undefined]);
    if (currentAccount?.uid !== uid) return;
    applyCoins(state.coinsGiven);
    if (!like.disabled) pressInteraction(like, state.liked);
    if (revision === favoriteRevision) pressInteraction(favorite, state.favorited);
    renderSubscription(state.subscribed);
    if (!uid || progressReady) return;
    progressToken = csrf.token;
    progressReady = true;
    if (state.position > 0 && state.position < duration && player.currentTime < 1) {
      const resume = () => { if (viewer === uid && player.currentTime < 1) player.currentTime = state.position; };
      if (player.readyState >= 1) resume();
      else player.addEventListener('loadedmetadata', resume, { once: true });
      lastSaved = state.position;
    }
    saveProgress();
  }
  const refreshQuietly = () => refresh().catch(() => {});
  window.addEventListener('accountchange', refreshQuietly);
  refreshQuietly();
}

function videoRow(v, note) {
  const row = node('li', 'dd-video');
  const videoUrl = '/video/' + encodeURIComponent(v.id);
  const cover = link(videoUrl, null, 'dd-video-cover');
  const img = node('img');
  img.alt = '';
  img.loading = 'lazy';
  const dur = duration(v.duration);
  const coverLabel = v.position > 0 ? duration(v.position) + '/' + dur : dur;
  if (v.position > 0 && v.duration > 0) {
    const bar = node('i', 'dd-video-progress');
    bar.style.width = Math.min(100, Math.round(v.position / v.duration * 100)) + '%';
    cover.append(bar);
  }
  cover.append(img, node('span', 'dd-video-dur', coverLabel));
  attachCover(img, '/api/videos/' + encodeURIComponent(v.id) + '/cover', '暂无封面');
  const info = node('div', 'dd-video-info');
  info.append(link(videoUrl, v.title, 'dd-video-title'));
  const meta = node('div', 'dd-video-meta');
  if (note) meta.append(node('span', 'dd-video-time', note));
  if (v.author) {
    const up = link('/space/' + encodeURIComponent(v.authorId || ''), null, 'dd-video-up');
    up.append(node('span', 'up', 'UP'), node('span', '', v.author));
    meta.append(up);
  }
  info.append(meta);
  row.append(cover, info);
  return row;
}

const NAV_DROPDOWN_LIMIT = 8;
const historyVideoRow = v => videoRow(v, formatTime(v.viewedAt));

function openHistoryPanel() {
  interactionPanel('观看历史', async body => {
    appendInteractionList(body, await interaction('/history'), historyVideoRow, 'dd-video-list');
    body.append(node('h3', '', '搜索历史'));
    appendInteractionList(body, await interaction('/search-history'), keyword => {
      const item = node('li');
      item.append(link('/search?' + new URLSearchParams({ keyword }), keyword));
      return item;
    });
  });
}

function setupDanmakuStyle() {
  const control = el('dm-style-control'), toggle = el('dm-style-toggle'), panel = el('dm-style-panel');
  const color = el('dm-color'), palette = el('dm-color-palette');
  const swatches = ['#FF0000','#FF7300','#FFAA00','#FFD000','#FFFF00','#A0EE00','#00CD00',
    '#0099A0','#4061B6','#8BD6FA','#D00069','#222222','#999999','#FFFFFF'].map(value => {
    const option = node('button', 'dm-color-swatch');
    option.type = 'button';
    option.value = value;
    option.style.backgroundColor = value;
    option.setAttribute('aria-label', '弹幕颜色 ' + value);
    option.onclick = () => { color.value = value.toLowerCase(); updateColor(); };
    return option;
  });
  palette.append(...swatches);
  function updateColor() {
    const value = color.value.toUpperCase();
    el('dm-color-value').textContent = value;
    for (const option of swatches) option.setAttribute('aria-pressed', String(option.value === value));
  }
  color.oninput = updateColor;
  updateColor();
  function setOpen(open) {
    panel.inert = !open;
    control.dataset.open = String(open);
    toggle.setAttribute('aria-expanded', String(open));
  }
  let hovering = false;
  control.addEventListener('pointerenter', event => {
    if (event.pointerType === 'mouse') { hovering = true; setOpen(true); }
  });
  control.addEventListener('pointerleave', () => {
    hovering = false;
    if (!panel.contains(document.activeElement)) setOpen(false);
  });
  control.addEventListener('focusout', event => {
    if (!hovering && !control.contains(event.relatedTarget)) setOpen(false);
  });
  toggle.onclick = event => setOpen(event.detail > 0 && hovering || panel.inert);
  control.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || panel.inert) return;
    event.stopPropagation();
    toggle.focus();
    setOpen(false);
  });
  document.addEventListener('pointerdown', event => {
    if (!control.contains(event.target)) setOpen(false);
  });
  return color;
}

function appendInteractionList(body, rows, render, className = 'interaction-list') {
  if (!rows.length) {
    body.append(node('p', '', '暂无记录'));
    return;
  }
  const list = node('ul', className);
  list.append(...rows.map(render));
  body.append(list);
}

function setupNavSearchHistory() {
  const input = el('keyword');
  const form = input?.closest('form.search');
  if (!form) return;
  const panel = node('section', 'home-search-history');
  panel.id = 'home-search-history';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'home-search-history-title');
  input.setAttribute('aria-controls', panel.id);
  const header = node('div', 'home-search-history-header');
  const heading = node('h2', '', '搜索历史');
  heading.id = 'home-search-history-title';
  const clear = node('button', '', '清空');
  clear.type = 'button';
  clear.hidden = true;
  clear.setAttribute('aria-label', '清空搜索历史');
  clear.onclick = () => deleteHistory('/search-history/all', {}, clear, currentAccount?.uid, '清空失败，请重试');
  header.append(heading, clear);
  const status = node('p');
  status.setAttribute('role', 'status');
  const list = node('ul');
  panel.append(header, status, list);
  form.append(panel);

  let request = 0;
  function showStatus(message) {
    status.textContent = message;
    status.hidden = !message;
  }

  async function deleteHistory(path, data, button, uid, failure) {
    if (!uid || uid !== currentAccount?.uid) return;
    input.focus();
    button.disabled = true;
    try {
      await interaction(path, 'DELETE', data);
      if (!panel.hidden && uid === currentAccount?.uid) loadHistory();
    } catch {
      if (!panel.hidden && uid === currentAccount?.uid) showStatus(failure);
    } finally {
      button.disabled = false;
    }
  }

  function historyItem(value, uid) {
    const item = node('li');
    const repeat = link('/search?' + new URLSearchParams({ keyword: value }), value);
    repeat.title = value;
    const remove = node('button', '', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', '删除搜索记录：' + value);
    remove.onclick = () => deleteHistory('/search-history', { value }, remove, uid, '删除失败，请重试');
    item.append(repeat, remove);
    return item;
  }

  async function loadHistory() {
    const latest = ++request;
    const uid = currentAccount?.uid;
    list.replaceChildren();
    clear.hidden = true;
    showStatus(uid ? '正在加载…' : '登录后可查看搜索历史');
    if (!uid) return;
    try {
      const rows = await interaction('/search-history');
      if (latest !== request) return;
      list.replaceChildren(...rows.map(value => historyItem(value, uid)));
      clear.hidden = !rows.length;
      showStatus(rows.length ? '' : '暂无搜索记录');
    } catch {
      if (latest === request) showStatus('暂时无法加载搜索历史');
    }
  }

  function open() {
    if (!panel.hidden) return;
    panel.hidden = false;
    loadHistory();
  }

  function close() {
    panel.hidden = true;
    request++;
  }

  input.addEventListener('focus', open);
  input.addEventListener('click', open);
  form.addEventListener('focusout', event => {
    if (!form.contains(event.relatedTarget)) close();
  });
  form.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault();
      input.focus();
      close();
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!form.contains(event.target)) close();
  });
  window.addEventListener('accountchange', () => {
    if (!panel.hidden) loadHistory();
  });
}

function recordSearchHistory() {
  if (location.pathname !== '/search') return;
  const keyword = (new URLSearchParams(location.search).get('keyword') || '').trim();
  if (!keyword || [...keyword].length > 100) return;
  let recordedUid;
  const record = () => {
    const uid = currentAccount?.uid;
    if (!uid || uid === recordedUid) return;
    recordedUid = uid;
    interaction('/search-history', 'POST', { value: keyword }).catch(() => {
      if (recordedUid === uid) recordedUid = undefined;
    });
  };
  window.addEventListener('accountchange', record);
  record();
}

function panelFooter(...items) {
  const foot = node('div', 'dd-foot');
  for (const [label, action] of items) {
    const button = node('button', 'dd-foot-link' + (label === '播放全部' ? ' dd-foot-play' : ''));
    button.type = 'button';
    if (label === '播放全部') button.append(icon('play'), node('span', '', label));
    else button.textContent = label;
    button.onclick = action;
    foot.append(button);
  }
  return foot;
}

function navDropdown(button, className, build) {
  const wrap = node('div', 'nav-item-wrap');
  const panel = node('div', 'nav-dropdown ' + className);
  button.before(wrap);
  wrap.append(button, panel);
  let hideTimer, loaded = false, request = 0;
  const hide = () => { clearTimeout(hideTimer); hideTimer = setTimeout(() => wrap.classList.remove('open'), 160); };
  const show = async () => {
    if (!currentAccount) return;
    clearTimeout(hideTimer);
    document.querySelectorAll('.nav-item-wrap.open').forEach(other => { if (other !== wrap) other.classList.remove('open'); });
    wrap.classList.add('open');
    if (loaded) return;
    loaded = true;
    panel.replaceChildren(node('p', 'nav-dropdown-empty', '加载中…'));
    const ticket = ++request;
    try {
      const content = await build();
      if (ticket === request) panel.replaceChildren(...content);
    } catch {
      if (ticket !== request) return;
      loaded = false;
      panel.replaceChildren(node('p', 'nav-dropdown-empty', '加载失败，请重试'));
    }
  };
  button.addEventListener('mouseenter', show);
  button.addEventListener('mouseleave', hide);
  button.addEventListener('focus', show);
  button.addEventListener('blur', hide);
  panel.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  panel.addEventListener('mouseleave', hide);
  panel.addEventListener('focusin', () => clearTimeout(hideTimer));
  panel.addEventListener('focusout', hide);
  window.addEventListener('accountchange', () => {
    request++;
    loaded = false;
    wrap.classList.remove('open');
    panel.replaceChildren();
  });
}

function setupMessageDropdown(button) {
  navDropdown(button, 'dd-message', () => {
    const menu = node('div', 'dd-menu');
    [
      ['/messages?tab=replies', '回复我的'],
      ['/messages?tab=mentions', '@我的'],
      ['/messages?tab=likes', '收到的赞'],
      ['/messages?tab=system', '系统消息'],
      ['/messages?tab=chat', '我的消息']
    ].forEach(([href, label]) => menu.append(link(href, label, 'dd-menu-item')));
    return [menu];
  });
}

function setupFavoriteDropdown(button) {
  navDropdown(button, 'dd-fav', async () => {
    const [space, favorites] = await Promise.all([interaction('/me/space'), interaction('/favorites')]);
    const folders = space.folders || [];
    const side = node('aside', 'dd-fav-folders');
    const list = node('ul', 'dd-video-list');
    let active = folders[0]?.id;
    let playing = favorites.find(v => v.folderId === active) || favorites[0];
    const renderVideos = () => {
      const rows = active ? favorites.filter(v => v.folderId === active) : favorites;
      playing = rows[0];
      if (rows.length) list.replaceChildren(...rows.map(v => videoRow(v)));
      else list.replaceChildren(node('li', 'nav-dropdown-empty', '暂无收藏'));
      list.scrollTop = 0;
    };
    list.addEventListener('wheel', event => {
      const row = list.querySelector('.dd-video');
      if (!row || list.scrollHeight <= list.clientHeight) return;
      event.preventDefault();
      const height = row.getBoundingClientRect().height + (parseFloat(getComputedStyle(list).rowGap) || 0);
      const current = Math.round(list.scrollTop / height);
      const last = Math.max(0, list.querySelectorAll('.dd-video').length - 5);
      const next = Math.max(0, Math.min(last, current + Math.sign(event.deltaY)));
      list.scrollTo({ top: next * height, behavior: 'smooth' });
    }, { passive: false });
    const buttons = folders.map(folder => {
      const item = node('button', 'dd-fav-folder' + (folder.id === active ? ' active' : ''));
      item.type = 'button';
      item.append(node('span', '', folder.name), node('span', 'dd-fav-count', String(folder.count)));
      item.addEventListener('mouseenter', () => {
        active = folder.id;
        buttons.forEach(other => other.classList.toggle('active', other === item));
        renderVideos();
      });
      side.append(item);
      return item;
    });
    renderVideos();
    const main = node('div', 'dd-fav-main');
    main.append(list, panelFooter(
      ['查看全部', () => location.assign('/me?tab=favorites')],
      ['播放全部', () => { if (playing) location.assign('/video/' + encodeURIComponent(playing.id)); }]
    ));
    return folders.length ? [side, main] : [main];
  });
}

function historyDay(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(date);
}

function setupHistoryDropdown(button) {
  navDropdown(button, 'dd-history', async () => {
    const rows = await interaction('/history');
    const panel = node('div', 'dd-history-page');
    const all = node('button', 'dd-all-btn', '查看全部历史');
    all.type = 'button';
    all.onclick = openHistoryPanel;
    if (rows.length) {
      const today = historyDay(Date.now());
      const lists = [[], []];
      for (const row of rows.slice(0, NAV_DROPDOWN_LIMIT)) {
        lists[historyDay(row.viewedAt) === today ? 0 : 1].push(row);
      }
      for (const [index, items] of lists.entries()) {
        if (!items.length) continue;
        const group = node('div', 'dd-group');
        group.append(node('h4', 'dd-group-title', index ? '更早' : '今天'));
        const list = node('ul', 'dd-video-list');
        list.append(...items.map(historyVideoRow));
        group.append(list);
        panel.append(group);
      }
    } else {
      panel.append(node('p', 'nav-dropdown-empty dd-history-empty', '暂无观看记录'));
    }
    panel.append(all);
    return [panel];
  });
}

function setupNav() {
  const messages = document.querySelector('[data-interaction=messages]');
  const favorites = document.querySelector('[data-interaction=favorites]');
  const history = document.querySelector('[data-interaction=history]');
  if (messages) {
    memberAction(messages, () => location.assign('/messages'));
    setupMessageDropdown(messages);
  }
  if (favorites) {
    memberAction(favorites, () => location.assign('/me?tab=favorites'));
    setupFavoriteDropdown(favorites);
  }
  if (history) {
    memberAction(history, () => openHistoryPanel());
    setupHistoryDropdown(history);
  }
}

setupNav();
setupNavSearchHistory();
recordSearchHistory();
