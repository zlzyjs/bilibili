async function uploadVideo() {
  if (account.level !== 'Lv2') {
    return [panel(node('h2', '', '视频投稿需要 Lv2'),
      node('p', 'studio-muted', '当前账号等级为 ' + account.level + '。'),
      link('/studio/videos', '查看稿件管理', 'studio-btn'))];
  }
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
  const choose = action('选择视频', () => fileInput.click(), true);
  const title = node('input', 'studio-input');
  title.required = true;
  title.maxLength = 80;
  const description = node('textarea', 'studio-input');
  description.maxLength = 5000;
  const category = select('投稿分区', [['', '请选择分区'], ...categories.map(item => [item.id, item.name])], '');
  category.required = true;
  const statement = select('投稿类型', [['1', '自制'], ['2', '转载']], '1');
  const visibility = select('可见范围', [['public', '审核通过后公开'], ['private', '仅自己可见']], 'public');
  const submit = node('button', 'studio-btn studio-primary', '提交审核');
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
  const previewArea = group('upload-preview', preview, fileName, fileMeta);
  const fields = group('upload-fields', uploadField('标题', title), uploadField('简介', description),
    group('upload-field-row', uploadField('分区', category), uploadField('类型', statement), uploadField('可见范围', visibility)),
    uploadField('封面图片（可选，默认取视频画面）', coverInput),
    group('studio-tools', submit, action('更换视频', () => fileInput.click())));
  const form = node('form', 'upload-form');
  form.append(previewArea, fields);
  form.hidden = true;

  const mark = svg('svg', { viewBox: '0 0 72 64', fill: 'none', 'aria-hidden': 'true' });
  mark.append(svg('rect', { x: 6, y: 5, width: 60, height: 49, rx: 13 }),
    svg('path', { d: 'M36 43V19m-9 9 9-9 9 9M22 45h28' }));
  const drop = group('upload-drop', mark, node('p', '', '把视频拖到这里，或选择本地文件'), choose);
  const guidance = group('upload-guidance',
    group('', node('strong', '', '文件大小'), node('p', '', '单个视频最多 256 MB')),
    group('', node('strong', '', '视频格式'), node('p', '', 'MP4，推荐 H.264 编码')),
    group('', node('strong', '', '视频时长'), node('p', '', '最多 10 小时')));
  const result = panel(guidance, drop, fileInput, form, status, progress);

  let selected;
  let source;
  let token;
  let busy = false;
  let suppliedCover;
  let autoCover;

  function selectVideo(file) {
    if (!file || busy) return;
    if (!/\.mp4$/i.test(file.name) || file.size === 0 || file.size > 256 * 1024 * 1024) {
      status.textContent = '请选择不超过 256 MB 的 MP4 视频。';
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
    source = URL.createObjectURL(file);
    fileName.textContent = file.name;
    fileMeta.textContent = (file.size / 1024 / 1024).toFixed(1) + ' MB';
    status.textContent = '正在读取视频…';
    submit.disabled = true;
    form.hidden = false;
    drop.hidden = true;
    const currentSource = source;
    preview.onloadeddata = () => {
      if (source !== currentSource || !preview.videoWidth || !Number.isFinite(preview.duration)) return;
      if (preview.duration <= 0 || preview.duration > 36000) {
        status.textContent = '视频时长应大于 0 秒且不超过 10 小时。';
        return;
      }
      const canvas = node('canvas');
      const scale = Math.min(1, 1200 / Math.max(preview.videoWidth, preview.videoHeight));
      canvas.width = Math.max(1, Math.round(preview.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(preview.videoHeight * scale));
      const finishCover = blob => {
        if (source !== currentSource) return;
        autoCover = blob;
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
    };
    preview.src = currentSource;
  }

  fileInput.onchange = () => {
    selectVideo(fileInput.files[0]);
    fileInput.value = '';
  };
  coverInput.onchange = () => {
    suppliedCover = coverInput.files[0] || null;
    if (suppliedCover && (!/\.(jpe?g|png)$/i.test(suppliedCover.name) || suppliedCover.size > 5 * 1024 * 1024)) {
      suppliedCover = null;
      coverInput.value = '';
      status.textContent = '请选择不超过 5 MB 的 JPG 或 PNG 封面。';
    } else if (!submit.disabled) status.textContent = '';
  };
  drop.ondragover = event => { event.preventDefault(); drop.classList.add('dragging'); };
  drop.ondragleave = () => drop.classList.remove('dragging');
  drop.ondrop = event => {
    event.preventDefault();
    drop.classList.remove('dragging');
    selectVideo(event.dataTransfer.files[0]);
  };
  window.addEventListener('pagehide', () => { if (source) URL.revokeObjectURL(source); }, { once: true });

  form.onsubmit = async event => {
    event.preventDefault();
    if (!selected || busy) return;
    const cover = suppliedCover || autoCover;
    if (!cover) {
      status.textContent = '请先选择封面图片。';
      return;
    }
    busy = true;
    submit.disabled = true;
    progress.value = 0;
    progress.hidden = false;
    status.textContent = '正在准备上传…';
    const payload = new FormData();
    for (const [key, input] of Object.entries({ title, description, category, statement, visibility })) {
      payload.set(key, input.value);
    }
    payload.set('video', selected, selected.name);
    payload.set('cover', cover, suppliedCover?.name || 'cover.jpg');
    payload.set('submission', token);
    try {
      const { token: csrf } = await api('/api/auth/csrf');
      await sendVideo(payload, csrf, progress, status);
      window.location.assign('/studio/videos?state=pending');
    } catch (error) {
      status.textContent = error.message;
      progress.hidden = true;
      busy = false;
      submit.disabled = false;
    }
  };
  return [result];
}

function uploadField(label, input) {
  const field = node('label', 'upload-field', label);
  field.append(input);
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
        413: '文件过大。视频最多 256 MB，封面最多 5 MB。',
      };
      reject(new Error(upload.response?.message || messages[upload.status] || '提交失败，请稍后重试。'));
    };
    upload.onerror = () => reject(new Error('连接中断。请先在稿件管理确认结果，再重试。'));
    upload.send(payload);
  });
}

