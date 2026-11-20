(() => {
  const aspect = 4 / 3;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  /** 管理裁剪草稿；只有「应用」才把结果交给投稿表单。 */
  function createCropEditor({ dialog, form, onApply }) {
    const editor = dialog.querySelector('#sponsorCropEditor');
    const stage = editor.querySelector('#sponsorCropStage');
    const image = stage.querySelector('img');
    const guide = stage.querySelector('.sponsor-crop-guide');
    const zoom = editor.querySelector('#sponsorCropZoom');
    const output = editor.querySelector('output[for="sponsorCropZoom"]');
    const size = editor.querySelector('#sponsorCropSize');
    const ratios = [...editor.querySelectorAll('[name="sponsorCropRatio"]')];
    const apply = editor.querySelector('#sponsorCropApply');
    const error = editor.querySelector('#sponsorCropError');
    const trigger = form.querySelector('#sponsorOpenCrop');
    let crop;
    let geometry;
    let ratio = 'card';
    let drag;
    let revision = 0;

    function dimensions() {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      const locked = ratio === 'card';
      const limitWidth = locked ? Math.min(width, height * aspect) : width;
      const limitHeight = locked ? limitWidth / aspect : height;
      return { width, height, limitWidth, limitHeight };
    }

    /** 裁剪框使用原图像素，改变窗口尺寸不改变选中的内容。 */
    function place(x, y, width, height) {
      crop = {
        x: clamp(x, 0, Math.max(0, image.naturalWidth - width)),
        y: clamp(y, 0, Math.max(0, image.naturalHeight - height)),
        width, height,
      };
    }

    function reset() {
      const { width, height, limitWidth, limitHeight } = dimensions();
      const widthBox = limitWidth * .85;
      const heightBox = limitHeight * .85;
      place((width - widthBox) / 2, (height - heightBox) / 2, widthBox, heightBox);
    }

    function render() {
      if (editor.hidden || !crop || !image.naturalWidth || !stage.clientWidth) return;
      const { width, height, limitWidth, limitHeight } = dimensions();
      const scale = Math.min((stage.clientWidth - 30) / width, (stage.clientHeight - 30) / height);
      if (scale <= 0) return;
      const left = (stage.clientWidth - width * scale) / 2;
      const top = (stage.clientHeight - height * scale) / 2;
      geometry = { scale };
      Object.assign(guide.style, { left: left + crop.x * scale + 'px', top: top + crop.y * scale + 'px',
        width: crop.width * scale + 'px', height: crop.height * scale + 'px' });
      Object.assign(image.style, { width: width * scale + 'px', height: height * scale + 'px', left: left + 'px', top: top + 'px' });
      const proportion = Math.max(crop.width / limitWidth, crop.height / limitHeight);
      const minimum = Math.min(1, Math.max(42 / scale / crop.width, 42 / scale / crop.height));
      const percent = Math.max(1, Math.round(proportion * 100));
      zoom.min = String(Math.min(percent, Math.max(1, Math.ceil(proportion * minimum * 100))));
      zoom.value = String(percent);
      output.textContent = percent + '%';
      size.textContent = ratio === 'card' ? '4:3' : Math.max(1, Math.round(crop.width)) + ' × ' + Math.max(1, Math.round(crop.height));
    }

    function move(start, deltaX, deltaY) {
      place(start.x + deltaX, start.y + deltaY, start.width, start.height);
      render();
    }

    function resize(start, corner, deltaX, deltaY) {
      const { width, height } = dimensions();
      const west = corner.endsWith('w');
      const north = corner.startsWith('n');
      const anchorX = start.x + (west ? start.width : 0);
      const anchorY = start.y + (north ? start.height : 0);
      const maxWidth = west ? anchorX : width - anchorX;
      const maxHeight = north ? anchorY : height - anchorY;
      const minWidth = Math.min(maxWidth, start.width, 42 / geometry.scale);
      const minHeight = Math.min(maxHeight, start.height, 42 / geometry.scale);
      let nextWidth = start.width + (west ? -deltaX : deltaX);
      let nextHeight = start.height + (north ? -deltaY : deltaY);
      if (ratio === 'card') {
        const maximum = Math.min(maxWidth, maxHeight * aspect);
        const minimum = Math.min(maximum, Math.max(minWidth, minHeight * aspect));
        nextWidth = clamp((nextWidth * aspect + nextHeight) / (aspect + 1 / aspect), minimum, maximum);
        nextHeight = nextWidth / aspect;
      } else {
        nextWidth = clamp(nextWidth, minWidth, maxWidth);
        nextHeight = clamp(nextHeight, minHeight, maxHeight);
      }
      place(anchorX - (west ? nextWidth : 0), anchorY - (north ? nextHeight : 0), nextWidth, nextHeight);
      render();
    }

    function setSize(value) {
      if (!geometry) return;
      const { limitWidth, limitHeight } = dimensions();
      const minimum = Math.min(1, Math.max(42 / geometry.scale / crop.width, 42 / geometry.scale / crop.height));
      const maximum = Math.min(limitWidth / crop.width, limitHeight / crop.height);
      const percent = Math.max(crop.width / limitWidth, crop.height / limitHeight) * 100;
      const factor = clamp(value / percent, minimum, maximum);
      const width = crop.width * factor;
      const height = crop.height * factor;
      place(crop.x + (crop.width - width) / 2, crop.y + (crop.height - height) / 2, width, height);
      render();
    }

    function close(restoreFocus = true) {
      ++revision;
      drag = undefined;
      geometry = undefined;
      editor.hidden = true;
      form.hidden = false;
      dialog.classList.remove('is-cropping');
      image.removeAttribute('src');
      if (restoreFocus) trigger.focus();
    }

    async function open(url, savedCrop) {
      const version = ++revision;
      error.hidden = true;
      apply.disabled = true;
      ratio = savedCrop?.ratio || 'card';
      for (const radio of ratios) radio.checked = radio.value === ratio;
      form.hidden = true;
      editor.hidden = false;
      dialog.classList.add('is-cropping');
      dialog.scrollTop = 0;
      image.src = url;
      try {
        await image.decode();
        if (version !== revision) return;
        if (savedCrop) crop = { ...savedCrop.box };
        else reset();
        render();
        apply.disabled = false;
        stage.focus({ preventScroll: true });
      } catch {
        if (version === revision) {
          error.textContent = document.documentElement.lang === 'en' ? 'Image could not be opened.' : '无法打开图片。';
          error.hidden = false;
        }
      }
    }

    function endDrag(event) {
      if (drag?.id === event.pointerId) drag = undefined;
    }

    stage.addEventListener('pointerdown', event => {
      if (!geometry || drag || !event.isPrimary || event.button !== 0 || !guide.contains(event.target)) return;
      event.preventDefault();
      stage.focus({ preventScroll: true });
      stage.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, box: { ...crop },
        scale: geometry.scale, corner: event.target.closest('[data-crop-handle]')?.dataset.cropHandle };
    });
    stage.addEventListener('pointermove', event => {
      if (drag?.id !== event.pointerId) return;
      const deltaX = (event.clientX - drag.x) / drag.scale;
      const deltaY = (event.clientY - drag.y) / drag.scale;
      if (drag.corner) resize(drag.box, drag.corner, deltaX, deltaY);
      else move(drag.box, deltaX, deltaY);
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) stage.addEventListener(event, endDrag);
    stage.addEventListener('keydown', event => {
      const distance = event.shiftKey ? 32 : 8;
      const offsets = { ArrowLeft: [-distance, 0], ArrowRight: [distance, 0], ArrowUp: [0, -distance], ArrowDown: [0, distance] };
      if (!geometry || !Object.hasOwn(offsets, event.key)) return;
      event.preventDefault();
      const [deltaX, deltaY] = offsets[event.key].map(offset => offset / geometry.scale);
      const corner = event.target.dataset.cropHandle;
      if (corner) resize(crop, corner, deltaX, deltaY);
      else move(crop, deltaX, deltaY);
    });
    for (const radio of ratios) radio.addEventListener('change', () => {
      if (!geometry || !radio.checked) return;
      ratio = radio.value;
      if (ratio === 'card') {
        const width = Math.min(crop.width, crop.height * aspect);
        const height = width / aspect;
        place(crop.x + (crop.width - width) / 2, crop.y + (crop.height - height) / 2, width, height);
      }
      render();
    });
    zoom.addEventListener('input', () => setSize(Number(zoom.value)));
    editor.querySelectorAll('[data-sponsor-zoom]').forEach(button =>
      button.addEventListener('click', () => setSize(Number(zoom.value) + Number(button.dataset.sponsorZoom))));
    editor.querySelector('#sponsorCropReset').addEventListener('click', () => {
      if (!geometry) return;
      reset();
      render();
    });
    editor.querySelector('#sponsorCropCancel').addEventListener('click', () => close());
    dialog.addEventListener('close', () => { if (!editor.hidden) close(false); });
    dialog.addEventListener('cancel', event => {
      if (editor.hidden) return;
      event.preventDefault();
      close();
    });
    new ResizeObserver(render).observe(stage);
    apply.addEventListener('click', async () => {
      if (apply.disabled) return;
      const version = revision;
      apply.disabled = true;
      error.hidden = true;
      try {
        const box = { ...crop };
        const savedCrop = { box, ratio };
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 1280 / Math.max(box.width, box.height));
        if (ratio === 'card') {
          const units = Math.max(1, Math.round(box.width * scale / 4));
          canvas.width = units * 4;
          canvas.height = units * 3;
        } else {
          canvas.width = Math.max(1, Math.round(box.width * scale));
          canvas.height = Math.max(1, Math.round(box.height * scale));
        }
        canvas.getContext('2d').drawImage(image, box.x, box.y, box.width, box.height, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .92));
        if (version !== revision) return;
        if (!blob || blob.size > 5 * 1024 * 1024) throw new Error();
        onApply(new File([blob], blob.type === 'image/webp' ? 'sponsor.webp' : 'sponsor.png', { type: blob.type }), savedCrop);
        close();
      } catch {
        if (version !== revision) return;
        error.textContent = document.documentElement.lang === 'en' ? 'Could not save the crop.' : '无法保存裁剪，请重试。';
        error.hidden = false;
        apply.disabled = false;
      }
    });
    return { open };
  }

  window.createSponsorCropEditor = createCropEditor;
})();
