async function uploadVideo() {
  if (account.level !== 'Lv2') {
    return [panel(node('h2', '', '视频投稿需要 Lv2'),
      node('p', 'studio-muted', '当前账号等级为 ' + account.level + '。'),
      link('/studio/videos', '查看稿件管理', 'studio-btn'))];
  }
  const editId = new URLSearchParams(location.search).get('edit');
  const original = editId ? await api('/videos/' + encodeURIComponent(editId) + '/edit') : null;
  const categories = await api('/api/categories');
  const status = node('p', 'upload-status');
  status.setAttribute('role', 'status');
  const fileInput = node('input');
  fileInput.type = 'file';
  fileInput.accept = '.mp4,video/mp4';
  fileInput.hidden = true;
  const coverInput = node('input', 'studio-input');
  coverInput.type = 'file';
  coverInput.accept = '.jpg,.jpeg,.png,image/jpeg,image/png';
  const choose = action('上传视频', () => fileInput.click(), true);
  const title = node('input', 'studio-input');
  title.required = true;
  title.maxLength = 80;
  title.placeholder = '请输入视频标题';
  const description = node('textarea', 'studio-input');
  description.maxLength = 5000;
  description.placeholder = '填写更全面的相关信息，让更多的人找到你的视频吧';
  const category = select('投稿分区', [['', '请选择分区'], ...categories.map(item => [item.id, item.name])], '');
  category.required = true;
  const statements = [['1', '内容无需标注'], ['2', '含AI生成内容'], ['3', '含虚构演绎内容'],
    ['4', '内容含营销信息'], ['5', '个人观点，仅供参考'], ['6', '内容为转载']];
  const statement = select('创作声明', statements, '1');
  statement.hidden = true;
  const statementMenu = group('upload-statement-menu');
  statementMenu.hidden = true;
  statementMenu.id = 'upload-statement-menu';
  statementMenu.setAttribute('role', 'listbox');
  const statementButton = action(statements[0][1], () => {
    statementMenu.hidden = !statementMenu.hidden;
    statementButton.setAttribute('aria-expanded', String(!statementMenu.hidden));
  });
  statementButton.setAttribute('aria-haspopup', 'listbox');
  statementButton.setAttribute('aria-expanded', 'false');
  statementButton.setAttribute('aria-controls', statementMenu.id);
  const statementPicker = group('upload-statement-picker', statement, statementButton, statementMenu);
  function closeStatementMenu() {
    statementMenu.hidden = true;
    statementButton.setAttribute('aria-expanded', 'false');
  }
  for (const [value, text] of statements) {
    const option = action(text, () => {
      statement.value = value;
      statementButton.textContent = text;
      statementMenu.querySelectorAll('button').forEach(item => item.setAttribute('aria-selected', String(item === option)));
      closeStatementMenu();
      statementButton.focus();
    });
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(value === '1'));
    statementMenu.append(option);
  }
  statementPicker.addEventListener('keydown', event => {
    const options = [...statementMenu.querySelectorAll('button')];
    if (event.key === 'Escape') { closeStatementMenu(); statementButton.focus(); }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      statementMenu.hidden = false;
      statementButton.setAttribute('aria-expanded', 'true');
      const index = options.indexOf(document.activeElement);
      options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length].focus();
    }
  });
  const outsideStatement = event => { if (!statementPicker.contains(event.target)) closeStatementMenu(); };
  document.addEventListener('click', outsideStatement);
  statementPicker.addEventListener('focusout', event => { if (!statementPicker.contains(event.relatedTarget)) closeStatementMenu(); });
  const tags = [...(original?.tags || [])];
  const tagInput = node('input', 'upload-tag-input');
  tagInput.placeholder = '按回车键Enter创建标签';
  tagInput.setAttribute('aria-label', '视频标签');
  const tagChips = group('upload-tag-chips');
  const tagCount = node('span', 'upload-tag-count');
  const tagError = node('p', 'upload-tag-error');
  tagError.id = 'upload-tag-error';
  tagError.setAttribute('role', 'status');
  tagInput.setAttribute('aria-describedby', tagError.id);
  const tagBox = group('upload-tags-box', tagChips, tagInput, tagCount);
  function renderTags() {
    tagChips.replaceChildren(...tags.map((tag, index) => {
      const remove = action('×', () => { tags.splice(index, 1); tagError.textContent = ''; renderTags(); tagInput.focus(); });
      remove.setAttribute('aria-label', '删除标签 ' + tag);
      return group('upload-tag-chip', node('span', '', tag), remove);
    }));
    tagCount.textContent = '还可以添加' + (10 - tags.length) + '个标签';
  }
  function addTag() {
    const value = tagInput.value.trim().normalize('NFC');
    if (!value) return true;
    if ([...value].length > 50) { tagError.textContent = '每个标签最多 50 字'; return false; }
    if (tags.some(tag => tag.toLocaleLowerCase() === value.toLocaleLowerCase())) { tagInput.value = ''; return true; }
    if (tags.length >= 10) { tagError.textContent = '最多添加 10 个标签'; return false; }
    tags.push(value);
    tagInput.value = '';
    tagError.textContent = '';
    renderTags();
    return true;
  }
  tagInput.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Enter') { event.preventDefault(); addTag(); }
    if (event.key === 'Backspace' && !tagInput.value && tags.length) { tags.pop(); renderTags(); }
  });
  tagInput.addEventListener('blur', addTag);
  renderTags();
  const visibility = select('可见范围', [['public', '审核通过后公开'], ['private', '仅自己可见']], 'public');
  const submit = node('button', 'studio-btn studio-primary', '立即投稿');
  const progress = node('progress', 'upload-progress');
  progress.max = 1;
  progress.value = 0;
  progress.setAttribute('aria-label', '视频上传进度');
  progress.hidden = true;

  const preview = node('video');
  preview.controls = true;
  preview.muted = true;
  preview.preload = 'auto';
  preview.playsInline = true;
  const fileName = node('strong');
  const fileMeta = node('p', 'studio-muted');
  const coverPreview = node('img', 'upload-cover-image');
  coverPreview.alt = '视频封面预览';
  coverPreview.hidden = true;
  const titleCount = node('span', 'upload-count', '0 / 80');
  title.addEventListener('input', () => { titleCount.textContent = title.value.length + ' / 80'; });
  coverInput.hidden = true;
  const frameList = group('upload-frame-list');
  const frameStatus = node('p', 'studio-muted', '正在读取视频帧…');
  const frameSlider = node('input');
  frameSlider.type = 'range';
  frameSlider.min = 0;
  frameSlider.max = 0;
  frameSlider.step = 0.1;
  frameSlider.value = 0;
  frameSlider.setAttribute('aria-label', '选择视频帧时间');
  const frameTime = node('span', 'studio-muted', '00:00');
  const capture = action('使用当前画面', () => captureCurrentFrame());
  capture.disabled = true;
  const coverDialog = node('dialog', 'upload-cover-dialog');
  coverDialog.setAttribute('aria-label', '封面制作');
  const dialogImage = node('img', 'upload-dialog-image');
  dialogImage.alt = '所选封面预览';
  dialogImage.hidden = true;
  const dialogFrames = group('upload-dialog-frames');
  const dialogVideoSlot = group('upload-dialog-video');
  const dialogHeader = group('upload-dialog-header', node('h2', '', '封面制作'), action('关闭', () => closeCoverDialog(false)));
  const dialogBody = group('upload-dialog-body',
    group('upload-dialog-sidebar', node('h3', '', '视频帧'), dialogFrames, action('上传封面', () => coverInput.click()), node('p', 'studio-muted', '支持 JPG、PNG，大小不超过 5 MB')),
    group('upload-dialog-workspace', node('h3', '', '封面预览'), dialogImage, dialogVideoSlot,
      group('upload-frame-controls', frameSlider, frameTime, capture)));
  coverDialog.append(dialogHeader, dialogBody, group('upload-dialog-footer', action('取消', () => closeCoverDialog(false)), action('完成', () => closeCoverDialog(true), true)));
  const coverBox = group('upload-cover-picker',
    group('upload-cover-top', coverPreview, action('添加封面', () => openCoverDialog()), coverInput),
    group('upload-frame-recommendations', node('p', '', '以下为视频推荐封面，点击画面选择'), frameList, frameStatus));
  const fields = group('upload-fields', node('h2', '', '基本设置'),
    uploadField('封面', coverBox),
    uploadField('标题', group('upload-title-input', title, titleCount)),
    uploadField('创作声明', statementPicker), uploadField('分区', category),
    uploadField('标签', group('upload-tags-control', tagBox, tagError)),
    uploadField('简介', description), uploadField('可见范围', visibility),
    group('studio-tools', submit, action('更换视频', () => fileInput.click())));
  const fileState = node('small', '', '正在读取视频…');
  const fileCardTitle = node('span');
  const fileCard = group('upload-file-card', fileCardTitle, fileState);
  const videoDetails = node('details', 'upload-video-details');
  videoDetails.append(node('summary', '', '预览视频 / 选择画面'), preview);
  const fileIcon = svg('svg', { viewBox: '0 0 28 38', 'aria-hidden': 'true', class: 'upload-file-icon' });
  fileIcon.append(svg('path', { d: 'M3 0H19L28 9V35Q28 38 25 38H3Q0 38 0 35V3Q0 0 3 0Z', fill: 'currentColor' }),
    svg('path', { d: 'M19 1V9H27M10 15L19 21L10 27Z', fill: '#fff' }));
  const transfer = group('upload-transfer', group('upload-file-cards', fileCard),
    group('upload-file-summary', fileIcon, group('upload-file-copy', fileName, fileMeta),
      action('更换视频', () => fileInput.click())),
    group('upload-file-rule'), progress, videoDetails);
  const form = node('form', 'upload-form');
  form.append(transfer, fields);
  form.hidden = true;

  const mark = svg('svg', { viewBox: '0 0 180 140', 'aria-hidden': 'true' });
  mark.append(svg('path', { d: 'M42 125C-3 125-8 76 25 63C24 37 42 20 66 20C94-17 153 0 153 51C192 62 190 125 147 125H105V96H115Q122 96 117 89L96 64Q90 57 84 64L63 89Q58 96 65 96H75V125Z' }));
  const drop = group('upload-drop', mark, node('p', '', '点击上传或将视频拖拽到此区域'), choose);
  drop.tabIndex = 0;
  drop.setAttribute('role', 'button');
  drop.setAttribute('aria-label', '选择或拖拽上传视频');
  drop.onclick = event => { if (!event.target.closest('button')) fileInput.click(); };
  drop.onkeydown = event => { if (event.target === drop && ['Enter', ' '].includes(event.key)) { event.preventDefault(); fileInput.click(); } };
  const guidance = group('upload-guidance',
    group('upload-spec upload-spec-size', node('strong', '', '视频大小'), node('p', '', '视频大小5 GB以内，时长10小时以内')),
    group('upload-spec upload-spec-format', node('strong', '', '视频格式'), node('p', '', '推荐上传 MP4 格式，使用 H.264 编码')),
    group('upload-spec upload-spec-resolution', node('strong', '', '视频分辨率'), node('p', '', '推荐分辨率：1080P、4K，高分辨率更清晰流畅～')));
  const tab = group('upload-tabs', node('span', 'upload-active-tab', '视频投稿'));
  const footer = node('p', 'upload-agreement', '上传视频，即表示您已同意使用协议与社区公约，请勿上传色情、反动等违规视频。');
  const result = panel(tab, guidance, drop, fileInput, form, status, footer, coverDialog);
  result.classList.add('studio-upload-page');

  let selected;
  let source;
  let token;
  let busy = false;
  let suppliedCover;
  let autoCover;
  let frameGeneration = 0;
  const frameUrls = [];
  let coverBeforeDialog;
  function openCoverDialog() {
    if (busy || (!selected && !original)) return;
    coverBeforeDialog = { suppliedCover, autoCover, selectedFrame: frameList.querySelector('[aria-pressed="true"]') };
    dialogVideoSlot.append(preview);
    coverDialog.showModal();
  }
  function closeCoverDialog(save) {
    preview.pause();
    videoDetails.append(preview);
    videoDetails.open = false;
    if (!save && coverBeforeDialog) {
      suppliedCover = coverBeforeDialog.suppliedCover;
      autoCover = coverBeforeDialog.autoCover;
      if (suppliedCover || autoCover) showCover(suppliedCover || autoCover);
      else if (original && !selected) {
        coverPreview.src = '/api/studio/videos/' + encodeURIComponent(original.id) + '/cover';
        dialogImage.src = coverPreview.src;
        coverPreview.hidden = false; dialogImage.hidden = false;
      } else { coverPreview.hidden = true; dialogImage.hidden = true; }
      frameList.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === coverBeforeDialog.selectedFrame)));
    }
    coverDialog.close();
  }
  coverDialog.addEventListener('cancel', event => { event.preventDefault(); closeCoverDialog(false); });

  function selectVideo(file) {
    if (!file || busy) return;
    if (!/\.mp4$/i.test(file.name) || file.size === 0 || file.size > 5 * 1024 * 1024 * 1024) {
      status.textContent = '请选择不超过 5 GB 的 MP4 视频。';
      return;
    }
    if (source) URL.revokeObjectURL(source);
    if (!title.value || title.value === selected?.name.replace(/\.mp4$/i, '').slice(0, 80)) {
      title.value = file.name.replace(/\.mp4$/i, '').slice(0, 80);
    }
    selected = file;
    token = Array.from(crypto.getRandomValues(new Uint8Array(16)),
      byte => byte.toString(16).padStart(2, '0')).join('');
    autoCover = null;
    suppliedCover = null;
    coverInput.value = '';
    coverPreview.hidden = true;
    capture.disabled = true;
    frameSlider.max = 0;
    frameSlider.value = 0;
    frameList.replaceChildren();
    dialogFrames.replaceChildren();
    frameUrls.splice(0).forEach(url => URL.revokeObjectURL(url));
    frameGeneration++;
    frameStatus.textContent = '正在读取视频帧…';
    source = URL.createObjectURL(file);
    fileName.textContent = file.name;
    fileCardTitle.textContent = file.name.replace(/\.mp4$/i, '');
    fileState.textContent = '正在读取视频…';
    fileMeta.textContent = (file.size / 1024 / 1024).toFixed(1) + ' MB';
    status.textContent = '正在读取视频…';
    submit.disabled = true;
    form.hidden = false;
    guidance.hidden = true;
    result.classList.add('is-editing');
    tab.firstChild.textContent = '发布视频';
    titleCount.textContent = title.value.length + ' / 80';
    drop.hidden = true;
    const currentSource = source;
    preview.onloadeddata = () => {
      if (source !== currentSource || !preview.videoWidth || !Number.isFinite(preview.duration)) return;
      if (preview.duration <= 0 || preview.duration > 36000) {
        status.textContent = '视频时长应大于 0 秒且不超过 10 小时。';
        return;
      }
      preview.onloadeddata = null;
      frameSlider.max = Math.max(0, preview.duration - 0.1);
      capture.disabled = false;
      fileState.textContent = '视频已就绪，填写信息后提交';
      fileMeta.textContent = (file.size / 1024 / 1024).toFixed(1) + ' MB · ' + preview.videoWidth + ' × ' + preview.videoHeight + ' · ' + Math.ceil(preview.duration) + ' 秒';
      generateFrames(currentSource, frameGeneration);
      const canvas = node('canvas');
      const scale = Math.min(1, 1200 / Math.max(preview.videoWidth, preview.videoHeight));
      canvas.width = Math.max(1, Math.round(preview.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(preview.videoHeight * scale));
      const finishCover = blob => {
        if (source !== currentSource) return;
        autoCover = blob;
        if (blob && !suppliedCover) showCover(blob);
        status.textContent = blob ? '' : '自动封面生成失败，可手动选择 JPG 或 PNG。';
        submit.disabled = false;
      };
      try {
        canvas.getContext('2d').drawImage(preview, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(finishCover, 'image/jpeg', 0.85);
      } catch {
        finishCover(null);
      }
    };
    preview.onerror = () => {
      status.textContent = '浏览器无法预览这个文件，请尝试 H.264 编码的 MP4。';
      fileState.textContent = '视频读取失败，请更换视频';
    };
    preview.src = currentSource;
  }

  fileInput.onchange = () => {
    selectVideo(fileInput.files[0]);
    fileInput.value = '';
  };
  let coverUrl;
  function showCover(blob) {
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    coverUrl = URL.createObjectURL(blob);
    coverPreview.src = coverUrl;
    coverPreview.hidden = false;
    dialogImage.src = coverUrl;
    dialogImage.hidden = false;
  }
  function useFrame(blob, button) {
    if (busy) return;
    suppliedCover = null;
    coverInput.value = '';
    autoCover = blob;
    showCover(blob);
    frameList.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    status.textContent = '已选择视频帧作为封面';
  }
  function frameBlob(video) {
    return new Promise(resolve => {
      const canvas = node('canvas');
      const scale = Math.min(1, 1200 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      try {
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(resolve, 'image/jpeg', 0.85);
      } catch { resolve(null); }
    });
  }
  async function captureCurrentFrame() {
    if (busy || preview.seeking || preview.readyState < 2) return;
    const currentSource = source;
    const blob = await frameBlob(preview);
    if (currentSource !== source) return;
    if (blob) useFrame(blob);
    else status.textContent = '无法截取此画面，请选择其他时间或上传封面';
  }
  frameSlider.oninput = () => {
    if (busy) return;
    const time = Number(frameSlider.value);
    preview.pause();
    videoDetails.open = true;
    preview.currentTime = time;
    frameTime.textContent = Math.floor(time / 60).toString().padStart(2, '0') + ':' + Math.floor(time % 60).toString().padStart(2, '0');
  };
  preview.addEventListener('timeupdate', () => {
    frameSlider.value = preview.currentTime;
    const time = preview.currentTime;
    frameTime.textContent = Math.floor(time / 60).toString().padStart(2, '0') + ':' + Math.floor(time % 60).toString().padStart(2, '0');
  });
  preview.addEventListener('seeking', () => { capture.disabled = true; });
  preview.addEventListener('seeked', () => { capture.disabled = busy; });
  async function generateFrames(url, generation) {
    const reader = node('video');
    reader.muted = true;
    reader.preload = 'auto';
    const waitFor = event => new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(false), 12000);
      const finish = ok => {
        clearTimeout(timer);
        reader.removeEventListener(event, success);
        reader.removeEventListener('error', failure);
        ok ? resolve() : reject(new Error('frame'));
      };
      const success = () => finish(true);
      const failure = () => finish(false);
      reader.addEventListener(event, success, { once: true });
      reader.addEventListener('error', failure, { once: true });
    });
    try {
      const loaded = waitFor('loadeddata');
      reader.src = url;
      await loaded;
      for (let i = 0; i < 5; i++) {
        if (generation !== frameGeneration) return;
        const time = Math.min(reader.duration - 0.01, reader.duration * (i + 0.5) / 5);
        if (Math.abs(reader.currentTime - time) > 0.001) {
          const seeked = waitFor('seeked');
          reader.currentTime = time;
          await seeked;
        }
        const blob = await frameBlob(reader);
        if (generation !== frameGeneration) return;
        if (!blob) continue;
        const image = node('img');
        const frameUrl = URL.createObjectURL(blob);
        frameUrls.push(frameUrl);
        image.src = frameUrl;
        image.alt = '第 ' + time.toFixed(1) + ' 秒画面';
        const button = action('', () => useFrame(blob, button));
        button.setAttribute('aria-label', '使用第 ' + time.toFixed(1) + ' 秒画面作为封面');
        button.setAttribute('aria-pressed', 'false');
        button.append(image, node('span', '', time.toFixed(1) + ' 秒'));
        frameList.append(button);
        const dialogButton = action('', () => useFrame(blob, button));
        dialogButton.append(image.cloneNode(), node('span', '', time.toFixed(1) + ' 秒'));
        dialogButton.setAttribute('aria-label', button.getAttribute('aria-label'));
        dialogFrames.append(dialogButton);
      }
      if (generation === frameGeneration) frameStatus.textContent = frameList.childElementCount ? '' : '可在封面制作中截取画面';
    } catch {
      if (generation === frameGeneration) frameStatus.textContent = '推荐帧读取失败，可在视频预览中截取或上传封面';
    } finally { reader.removeAttribute('src'); reader.load(); }
  }
  coverInput.onchange = () => {
    suppliedCover = coverInput.files[0] || null;
    if (suppliedCover && (!/\.(jpe?g|png)$/i.test(suppliedCover.name) || suppliedCover.size > 5 * 1024 * 1024)) {
      suppliedCover = null;
      coverInput.value = '';
      status.textContent = '请选择不超过 5 MB 的 JPG 或 PNG 封面。';
    } else {
      if (suppliedCover || autoCover) showCover(suppliedCover || autoCover);
      frameList.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', 'false'));
      if (!submit.disabled) status.textContent = '';
    }
  };
  drop.ondragover = event => { event.preventDefault(); drop.classList.add('dragging'); };
  drop.ondragleave = () => drop.classList.remove('dragging');
  drop.ondrop = event => {
    event.preventDefault();
    drop.classList.remove('dragging');
    selectVideo(event.dataTransfer.files[0]);
  };
  result.addEventListener('studio:leave', () => {
    document.removeEventListener('click', outsideStatement);
    if (coverDialog.open) closeCoverDialog(true);
    frameGeneration++;
    frameUrls.splice(0).forEach(url => URL.revokeObjectURL(url));
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    if (!source) return;
    URL.revokeObjectURL(source);
    source = undefined;
    preview.removeAttribute('src');
  });

  form.onsubmit = async event => {
    event.preventDefault();
    if ((!selected && !original) || busy) return;
    if (!addTag() || !tags.length) {
      tagError.textContent ||= '请至少添加一个标签';
      tagInput.focus();
      return;
    }
    const cover = suppliedCover || autoCover;
    if (!cover && !original) {
      status.textContent = '请先选择封面图片。';
      return;
    }
    busy = true;
    for (const control of form.elements) control.disabled = true;
    submit.disabled = true;
    progress.value = 0;
    progress.hidden = false;
    status.textContent = '正在准备上传…';
    const payload = new FormData();
    for (const [key, input] of Object.entries({ title, description, category, statement, visibility })) {
      payload.set(key, input.value);
    }
    if (selected) payload.set('video', selected, selected.name);
    if (original) payload.set('editId', original.id);
    if (cover) payload.set('cover', cover, suppliedCover?.name || 'cover.jpg');
    payload.set('submission', token);
    payload.set('tags', JSON.stringify(tags));
    try {
      const { token: csrf } = await api('/api/auth/csrf');
      await sendVideo(payload, csrf, progress, status);
      if (result.isConnected) navigateStudio('/studio/videos?state=pending');
    } catch (error) {
      status.textContent = error.message;
      progress.hidden = true;
      busy = false;
      for (const control of form.elements) control.disabled = false;
      submit.disabled = false;
      if (original) { statement.disabled = true; statementButton.disabled = true; }
    }
  };
  if (original) {
    title.value = original.title;
    description.value = original.description || '';
    category.value = original.category;
    visibility.value = original.visibility;
    statement.value = String(original.statement);
    statementButton.textContent = statements.find(item => item[0] === statement.value)?.[1] || '内容无需标注';
    statement.disabled = true;
    statementButton.disabled = true;
    statementPicker.addEventListener('keydown', event => event.stopImmediatePropagation(), true);
    titleCount.textContent = title.value.length + ' / 80';
    form.hidden = false; guidance.hidden = true; drop.hidden = true;
    result.classList.add('is-editing');
    tab.firstChild.textContent = '编辑视频';
    fileName.textContent = original.title;
    fileCardTitle.textContent = original.title;
    fileState.textContent = '已上传';
    fileMeta.textContent = original.duration + ' 秒';
    coverPreview.src = '/api/studio/videos/' + encodeURIComponent(original.id) + '/cover';
    coverPreview.hidden = false;
    dialogImage.src = coverPreview.src; dialogImage.hidden = false;
    frameStatus.textContent = '正在读取已上传视频…';
    source = '/api/studio/videos/' + encodeURIComponent(original.id) + '/stream';
    const currentSource = source;
    preview.onloadeddata = () => {
      if (source !== currentSource || !preview.videoWidth || !Number.isFinite(preview.duration)) return;
      preview.onloadeddata = null;
      frameSlider.max = Math.max(0, preview.duration - 0.1);
      capture.disabled = busy;
      generateFrames(currentSource, frameGeneration);
    };
    preview.onerror = () => {
      capture.disabled = true;
      frameStatus.textContent = '已上传视频读取失败，请重试或上传封面';
    };
    preview.src = currentSource;
    token = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return [result];
}

function uploadField(label, input) {
  const field = node('div', 'upload-field');
  const caption = node('label', 'upload-field-label', label);
  const control = label === '创作声明' ? input.querySelector('button')
    : input.matches('input,textarea,select') ? input : input.querySelector('input:not([type="file"]),textarea,select');
  if (control) {
    control.id = 'upload-field-' + label;
    caption.htmlFor = control.id;
  }
  if (control?.required || ['封面', '创作声明', '标签'].includes(label)) caption.classList.add('is-required');
  field.append(caption, input);
  return field;
}

function sendVideo(payload, csrf, progress, status) {
  return new Promise((resolve, reject) => {
    const upload = new XMLHttpRequest();
    upload.open('POST', '/api/studio/upload');
    upload.setRequestHeader('X-CSRF-Token', csrf);
    upload.upload.onprogress = event => {
      if (!event.lengthComputable) return;
      progress.value = event.loaded / event.total;
      status.textContent = progress.value < 1 ? '正在上传 ' + Math.round(progress.value * 100) + '%' : '已上传，正在校验并提交审核…';
    };
    upload.responseType = 'json';
    upload.onload = () => {
      if (upload.status >= 200 && upload.status < 300 && upload.response?.id) {
        resolve(upload.response.id);
        return;
      }
      const messages = {
        400: '文件或稿件信息有误，请检查视频、封面和分区。',
        401: '登录已过期，请重新登录后再提交。',
        403: '投稿需要 Lv2 账号和有效登录会话。',
        409: '投稿正在处理或未通过校验。请先查看稿件管理，再决定是否重试。',
        413: '文件过大。视频最多 5 GB，封面最多 5 MB。',
      };
      reject(new Error(upload.response?.message || messages[upload.status] || '提交失败，请稍后重试。'));
    };
    upload.onerror = () => reject(new Error('连接中断。请先在稿件管理确认结果，再重试。'));
    upload.send(payload);
  });
}

