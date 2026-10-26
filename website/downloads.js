const downloadStatus = document.querySelector('#download-status');
document.querySelectorAll('.download-button').forEach(link => link.addEventListener('click', event => {
  if (link.getAttribute('aria-disabled') === 'true') event.preventDefault();
}));
function checkedUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Missing download URL');
  const url = new URL(value, location.href);
  if (url.origin !== location.origin && url.protocol !== 'https:') throw new Error('Invalid download URL');
  return url.href;
}
function fileSize(bytes) { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
/** Swap the Linux source preview for the prebuilt installers listed in the manifest. */
function showLinuxInstallers(linux) {
  const files = { arch: linux?.arch, deb: linux?.debian };
  for (const file of Object.values(files)) {
    if (!file || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || !/^[a-f0-9]{64}$/i.test(file.sha256)) throw new Error('Incomplete Linux downloads');
  }
  const hrefs = { arch: checkedUrl(files.arch.url), deb: checkedUrl(files.deb.url) };
  const checksums = checkedUrl(linux.checksums);
  for (const [kind, href] of Object.entries(hrefs)) {
    const link = document.querySelector(`#download-linux-${kind}`);
    link.href = href; link.removeAttribute('aria-disabled');
    if (new URL(href).origin === location.origin) link.setAttribute('download', '');
  }
  document.querySelector('#linux-meta').textContent = `Hyprland · x86-64 · Arch ${fileSize(files.arch.bytes)} · Debian ${fileSize(files.deb.bytes)}`;
  const checksumLink = document.querySelector('#linux-checksum-link');
  checksumLink.href = checksums; checksumLink.hidden = false;
  for (const id of ['linux-source-actions', 'linux-source-steps']) document.getElementById(id).hidden = true;
  for (const id of ['linux-installer-actions', 'linux-installer-steps']) document.getElementById(id).hidden = false;
}
async function loadDownloads() {
  try {
    const response = await fetch('./downloads.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Download manifest unavailable');
    const manifest = await response.json();
    document.querySelector('#release-version').textContent = manifest.version || 'Latest';
    if (!manifest.available) {
      downloadStatus.textContent = manifest.message || 'Downloads are being prepared. Please check back soon.';
      document.querySelector('#download-windows > span').textContent = 'Windows download coming soon';
      document.querySelector('#download-android > span').textContent = 'Android download coming soon';
      return;
    }
    const files = ['windows', 'android'].map(platform => {
      const file = manifest[platform];
      if (!file || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || !/^[a-f0-9]{64}$/i.test(file.sha256)) throw new Error('Incomplete download manifest');
      return { platform, ...file, href: checkedUrl(file.url) };
    });
    const checksums = checkedUrl(manifest.checksums);
    for (const file of files) {
      const link = document.querySelector(`#download-${file.platform}`);
      link.href = file.href; link.removeAttribute('aria-disabled');
      if (new URL(file.href).origin === location.origin) link.setAttribute('download', '');
      link.querySelector('span').textContent = file.platform === 'windows' ? 'Download for Windows' : 'Download for Android';
      document.querySelector(`#${file.platform}-meta`).textContent = file.platform === 'windows'
        ? `Windows 10 / 11 · x64 · Setup EXE · ${fileSize(file.bytes)}`
        : `Android 7.0+ · Debug APK · ${fileSize(file.bytes)}`;
    }
    const checksumLink = document.querySelector('#checksum-link');
    checksumLink.href = checksums; checksumLink.hidden = false;
    let linuxReady = false;
    if (manifest.linux) {
      // A bad Linux entry must not cost Windows and Android their downloads.
      try { showLinuxInstallers(manifest.linux); linuxReady = true; } catch { /* keep the source preview */ }
    }
    downloadStatus.textContent = linuxReady
      ? 'Windows, Android and Linux downloads are ready.'
      : 'Windows and Android downloads are ready. Linux is available as a source preview.';
  } catch {
    downloadStatus.textContent = 'Windows and Android downloads are temporarily unavailable. Linux source and its setup guide are still available.';
    document.querySelectorAll('#download-windows > span:first-child, #download-android > span:first-child').forEach(el => { el.textContent = 'Download unavailable'; });
  }
}
loadDownloads();

function animateDownloadCounts(section, counts) {
  const format = new Intl.NumberFormat('en-US');
  const values = Object.fromEntries(['total', 'windows', 'android', 'linux'].map(key => {
    section.querySelector(`[data-count-readable="${key}"]`).textContent = format.format(counts[key]);
    return [key, section.querySelector(`#count-${key}`)];
  }));
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0, observer, started = false;
  function render(progress) {
    const windows = Math.round(counts.windows * progress);
    const android = Math.round(counts.android * progress);
    const linux = Math.round(counts.linux * progress);
    for (const [key, value] of Object.entries({ windows, android, linux, total: windows + android + linux })) values[key].textContent = format.format(value);
  }
  function finish() {
    cancelAnimationFrame(frame);
    observer?.disconnect();
    render(1);
    section.dataset.countState = 'complete';
    motion.removeEventListener('change', onMotionChange);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }
  function onMotionChange() { if (motion.matches) finish(); }
  function onVisibilityChange() { if (document.hidden && started) finish(); }
  function start() {
    if (started) return;
    started = true;
    observer?.disconnect();
    if (motion.matches || document.hidden) return finish();
    section.dataset.countState = 'counting';
    const startTime = performance.now();
    render(0);
    function tick(now) {
      const progress = Math.min(1, (now - startTime) / 1400);
      render(1 - (1 - progress) ** 3);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else finish();
    }
    frame = requestAnimationFrame(tick);
  }
  if (motion.matches) return finish();
  section.dataset.countState = 'ready';
  motion.addEventListener('change', onMotionChange);
  document.addEventListener('visibilitychange', onVisibilityChange);
  if (!('IntersectionObserver' in window)) return finish();
  observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.25)) start();
  }, { threshold: 0.25 });
  observer.observe(section);
}

async function loadDownloadCounts() {
  const section = document.querySelector('#download-stats');
  const status = document.querySelector('#download-count-status');
  section.hidden = false;
  section.dataset.countState = 'loading';
  try {
    const response = await fetch('/api/download-stats', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Counts unavailable');
    const counts = await response.json();
    if (!['total', 'windows', 'android', 'linux'].every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0)
        || counts.total !== counts.windows + counts.android + counts.linux || !Number.isFinite(Date.parse(counts.updatedAt))) {
      throw new Error('Invalid counts');
    }
    status.textContent = 'Refreshed hourly';
    status.title = `Last checked: ${new Date(counts.updatedAt).toLocaleString()}`;
    animateDownloadCounts(section, counts);
  } catch {
    section.dataset.countState = 'unavailable';
    section.querySelectorAll('[data-count-readable]').forEach(label => { label.textContent = 'Unavailable'; });
    status.textContent = 'Download counts are temporarily unavailable.';
  }
}
loadDownloadCounts();
