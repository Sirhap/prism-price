(() => {
  const dialog = document.querySelector('#sponsorDialog');
  const rail = document.querySelector('.sponsor-rail');
  const entries = [...document.querySelectorAll('[data-sponsor-open]')];
  const form = document.querySelector('#sponsorForm');
  const linkInput = form.elements.linkUrl;
  const result = document.querySelector('#sponsorResult');
  const adCard = document.querySelector('#sponsorAd');
  const pages = document.querySelector('#sponsorPages');
  const carousel = document.querySelector('#sponsorCarousel');
  const fixedLayout = document.querySelector('.sponsor-fixed-layout');
  const fixedSlots = [...document.querySelectorAll('[data-sponsor-placement]')];
  const wide = matchMedia('(min-width: 1200px)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const check = form.querySelector('[data-sponsor-check]');
  const publish = form.querySelector('[type=submit]');
  const preview = document.querySelector('#sponsorPreview');
  const previewImage = preview.querySelector('img');
  const previewMode = document.querySelector('#sponsorPreviewMode');
  const openCrop = document.querySelector('#sponsorOpenCrop');
  const restoreOriginal = document.querySelector('#sponsorRestoreOriginal');
  const placementControls = [...form.querySelectorAll('[name="placementType"]')];
  const maxImageSize = 5 * 1024 * 1024;
  let ads = [];
  let index = 0;
  let expiryTimer;
  let rotationTimer;
  let fixedTimer;
  let fixedOrder = [];
  let hovered = false;
  let fixedHovered = false;
  let requestVersion = 0;
  let enabled = false;
  let imageUrl;
  let imageReady;
  let croppedUrl;
  let croppedFile;
  let savedCrop;
  const english = () => document.documentElement.lang === 'en';
  const wording = (zh, en) => english() ? en : zh;
  const time = stamp => new Intl.DateTimeFormat(english() ? 'en-GB' : 'zh-CN', {
    timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short',
  }).format(stamp);

  const carouselAds = () => ads.filter(ad => ad.placement === 'carousel').slice(0, 4);
  const placementLabel = placement => {
    if (placement === 'carousel') return wording('顶部轮播', 'Featured carousel');
    if (!placement) return wording('可选择轮播或固定', 'Choose carousel or fixed');
    const slot = fixedSlots.find(item => item.dataset.sponsorPlacement === placement);
    return slot?.querySelector('h3').textContent || '';
  };

  function renderAd(card, ad) {
    card.hidden = !ad;
    const image = card.querySelector('img');
    const caption = card.querySelector('figcaption');
    let link = caption.querySelector('a');
    if (!ad) {
      image.removeAttribute('src');
      link?.removeAttribute('href');
      return;
    }
    const url = '/api/sponsors/image/' + encodeURIComponent(ad.id);
    if (image.getAttribute('src') !== url) image.setAttribute('src', url);
    if (!link) {
      link = document.createElement('a');
      link.target = '_blank';
      link.rel = 'sponsored noopener noreferrer';
      caption.append(link);
    }
    const href = safeUrl(ad.linkUrl);
    if (href) link.href = href;
    else link.removeAttribute('href');
    link.textContent = ad.title;
    caption.title = ad.title;
  }

  function scheduleRotation() {
    clearTimeout(rotationTimer);
    if (reducedMotion.matches || hovered || carousel.matches(':focus-within') || document.hidden || !wide.matches || carouselAds().length < 2) return;
    rotationTimer = setTimeout(() => {
      index = (index + 1) % carouselAds().length;
      render();
    }, 6000);
  }

  function scheduleFixedRotation() {
    if (fixedTimer || reducedMotion.matches || fixedHovered || fixedLayout.matches(':focus-within') || document.hidden || !wide.matches || fixedOrder.length < 2) return;
    fixedTimer = setTimeout(() => {
      fixedTimer = undefined;
      fixedOrder.push(fixedOrder.shift());
      render();
    }, 18_000 + Math.random() * 24_000);
  }

  function stopFixedRotation() {
    clearTimeout(fixedTimer);
    fixedTimer = undefined;
  }

  function render() {
    clearTimeout(expiryTimer);
    const now = Date.now();
    ads = ads.filter(ad => ad.expiresAt > now);
    const slides = carouselAds();
    index = Math.min(index, Math.max(0, slides.length - 1));
    carousel.hidden = slides.length === 0;
    renderAd(adCard, slides[index]);
    const fixedAds = ads.filter(ad => ad.placement !== 'carousel');
    const adsById = new Map(fixedAds.map(ad => [ad.id, ad]));
    const occupied = new Set(fixedAds.map(ad => ad.placement));
    const available = fixedSlots.filter(slot => occupied.has(slot.dataset.sponsorPlacement));
    fixedOrder = fixedOrder.filter(id => adsById.has(id));
    const queued = new Set(fixedOrder);
    for (const ad of fixedAds) if (!queued.has(ad.id)) fixedOrder.push(ad.id);
    for (const slot of fixedSlots) {
      const ad = adsById.get(fixedOrder[available.indexOf(slot)]);
      slot.hidden = !ad;
      renderAd(slot.querySelector('figure'), ad);
    }
    fixedLayout.hidden = available.length === 0;
    rail.hidden = !enabled || !wide.matches || (carousel.hidden && fixedLayout.hidden);
    if (carousel.hidden) hovered = false;
    if (fixedLayout.hidden) fixedHovered = false;
    if (fixedOrder.length < 2) stopFixedRotation();
    else scheduleFixedRotation();
    pages.hidden = slides.length < 2;
    pages.querySelector('span').textContent = `${index + 1} / ${slides.length}`;
    scheduleRotation();
    if (!ads.length) return;
    const nextExpiry = ads.reduce((earliest, ad) => Math.min(earliest, ad.expiresAt), Infinity);
    expiryTimer = setTimeout(render, Math.min(nextExpiry - now + 50, 2_147_483_647));
  }

  async function refresh() {
    const version = ++requestVersion;
    try {
      const response = await fetch('/api/sponsors', { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load ads');
      const data = await response.json();
      if (version !== requestVersion) return;
      enabled = data.enabled === true;
      for (const entry of entries) entry.hidden = !enabled;
      if (!enabled && dialog.open) dialog.close();
      const current = carouselAds()[index]?.id;
      ads = enabled && wide.matches ? data.ads : [];
      const slides = carouselAds();
      index = Math.max(0, slides.findIndex(item => item.id === current));
      render();
    } catch (error) {
      if (version !== requestVersion) return;
      console.warn('sponsor_list_unavailable', error);
      render();
    }
  }

  async function request(action, data) {
    const upload = data instanceof FormData;
    const response = await fetch('/api/sponsors/' + action, {
      method: 'POST', headers: upload ? undefined : { 'Content-Type': 'application/json' },
      body: upload ? data : JSON.stringify(data), cache: 'no-store',
    });
    if (response.status === 413) throw new Error(wording('图片过大，最大 5 MB', 'The image exceeds 5 MB'));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || wording('请求失败', 'Request failed'));
    return payload;
  }

  function show(message, error = false) {
    result.textContent = message;
    result.dataset.error = String(error);
    result.hidden = !message;
  }

  async function run(task) {
    check.disabled = publish.disabled = true;
    show(wording('正在处理…', 'Working…'));
    try { await task(); }
    catch (error) { show(error.message, true); }
    finally { check.disabled = publish.disabled = false; }
  }

  function resetPlacement() {
    for (const radio of placementControls) radio.disabled = false;
  }

  function clearPreview() {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = undefined;
    imageReady = undefined;
    preview.hidden = true;
    previewImage.removeAttribute('src');
    clearCrop();
  }

  function clearCrop() {
    if (croppedUrl) URL.revokeObjectURL(croppedUrl);
    croppedUrl = croppedFile = savedCrop = undefined;
    updatePreview();
  }

  function updatePreview() {
    const url = croppedUrl || imageUrl;
    if (url && previewImage.getAttribute('src') !== url) previewImage.src = url;
    previewMode.textContent = croppedFile
      ? savedCrop.ratio === 'card' ? wording('已裁剪 · 4:3', 'Cropped · 4:3') : wording('已裁剪 · 自由比例', 'Cropped · freeform')
      : wording('原图 · 居中铺满', 'Original · center fill');
    restoreOriginal.hidden = !croppedFile;
  }

  const cropEditor = window.createSponsorCropEditor({
    dialog, form,
    onApply(file, crop) {
      if (croppedUrl) URL.revokeObjectURL(croppedUrl);
      croppedUrl = URL.createObjectURL(file);
      croppedFile = file;
      savedCrop = crop;
      updatePreview();
    },
  });
  openCrop.addEventListener('click', () => { if (!publish.disabled && imageUrl) void cropEditor.open(imageUrl, savedCrop); });
  restoreOriginal.addEventListener('click', () => { if (!publish.disabled) clearCrop(); });

  for (const entry of entries) entry.addEventListener('click', () => { if (enabled) dialog.showModal(); });
  form.querySelector('[data-sponsor-close]').addEventListener('click', () => dialog.close());
  form.elements.code.addEventListener('input', () => { resetPlacement(); show(''); });
  form.elements.image.addEventListener('change', () => {
    clearPreview();
    show('');
    const file = form.elements.image.files[0];
    if (!file) return;
    if (file.size > maxImageSize || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      show(wording('请选择不超过 5 MB 的 JPG、PNG 或 WebP 图片', 'Choose a JPG, PNG or WebP image up to 5 MB'), true);
      form.elements.image.value = '';
      return;
    }
    const url = URL.createObjectURL(file);
    imageUrl = url;
    previewImage.src = url;
    imageReady = previewImage.decode().then(() => {
      if (imageUrl !== url) return false;
      if (previewImage.naturalWidth * previewImage.naturalHeight > 24_000_000) throw new Error('Image dimensions too large');
      updatePreview();
      preview.hidden = false;
      if (dialog.open && !publish.disabled) void cropEditor.open(url);
      return true;
    }).catch(() => {
      if (imageUrl === url) {
        clearPreview();
        form.elements.image.value = '';
        show(wording('图片无法预览或尺寸过大，请换一张（最多 2400 万像素）', 'Choose a readable image up to 24 megapixels'), true);
      }
      return false;
    });
  });
  pages.addEventListener('click', event => {
    const button = event.target.closest('[data-sponsor-step]');
    const count = carouselAds().length;
    if (!button || count < 2) return;
    index = (index + Number(button.dataset.sponsorStep) + count) % count;
    render();
  });
  carousel.addEventListener('mouseenter', () => { hovered = true; scheduleRotation(); });
  carousel.addEventListener('mouseleave', () => { hovered = false; scheduleRotation(); });
  carousel.addEventListener('focusin', scheduleRotation);
  carousel.addEventListener('focusout', () => setTimeout(scheduleRotation, 0));
  fixedLayout.addEventListener('mouseenter', () => { fixedHovered = true; stopFixedRotation(); });
  fixedLayout.addEventListener('mouseleave', () => { fixedHovered = false; scheduleFixedRotation(); });
  fixedLayout.addEventListener('focusin', stopFixedRotation);
  fixedLayout.addEventListener('focusout', () => setTimeout(scheduleFixedRotation, 0));
  reducedMotion.addEventListener('change', () => { stopFixedRotation(); render(); });
  window.addEventListener('prism:langchange', () => { render(); updatePreview(); });
  check.addEventListener('click', () => {
    if (!form.elements.code.reportValidity()) return;
    run(async () => {
      const requestedCode = form.elements.code.value;
      const data = await request('check', { code: requestedCode });
      if (form.elements.code.value !== requestedCode) return;
      resetPlacement();
      const placement = placementLabel(data.placement);
      if (data.status === 'unused') {
        if (!data.placementChoice) {
          const bound = data.placement === 'carousel' ? 'carousel' : 'fixed';
          for (const radio of placementControls) {
            radio.checked = radio.value === bound;
            radio.disabled = !radio.checked;
          }
        }
        const unit = data.unit === 'days' ? wording('天', ' days') : wording('个月', ' months');
        show(wording(`未使用 · ${placement} · 审批通过后有效 ${data.duration} ${unit}`, `Unused · ${placement} · valid for ${data.duration}${unit} after approval`));
        return;
      }
      const labels = {
        pending: wording('待审批', 'Pending review'),
        rejected: wording('已驳回', 'Rejected'),
        active: wording('已使用，投放中', 'Redeemed, active'),
        expired: wording('已到期', 'Expired'),
        revoked: wording('已作废', 'Revoked'),
      };
      show(`${labels[data.status]} · ${placement}` + (data.expiresAt ? wording(` · 到期：${time(data.expiresAt)}（北京时间）`, ` · Expiry: ${time(data.expiresAt)} (Beijing time)`) : ''));
    });
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (publish.disabled) return;
    run(async () => {
      const file = form.elements.image.files[0];
      if (!file || file.size > maxImageSize) throw new Error(wording('请选择不超过 5 MB 的图片', 'Choose an image up to 5 MB'));
      const payload = new FormData();
      for (const name of ['code', 'title', 'placementType']) payload.set(name, form.elements[name].value);
      if (linkInput) payload.set('linkUrl', linkInput.value.trim());
      if (!imageReady || !await imageReady || file !== form.elements.image.files[0]) {
        throw new Error(wording('请先选择可预览的图片', 'Choose a valid image first'));
      }
      payload.set('image', croppedFile || file);
      const data = await request('redeem', payload);
      form.elements.title.value = '';
      if (linkInput) linkInput.value = '';
      form.elements.image.value = '';
      clearPreview();
      show(wording(`提交成功 · ${placementLabel(data.placement)} · 待审批`,
        `Submitted · ${placementLabel(data.placement)} · Pending review`));
    });
  });
  const refreshIfVisible = () => {
    if (!document.hidden) void refresh();
    else { scheduleRotation(); stopFixedRotation(); }
  };
  wide.addEventListener('change', refreshIfVisible);
  document.addEventListener('visibilitychange', refreshIfVisible);
  setInterval(refreshIfVisible, 60_000);
  refreshIfVisible();
})();
