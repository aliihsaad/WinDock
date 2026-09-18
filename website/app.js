const paths = {
  github: '<path fill="currentColor" stroke="none" d="M12 .75a11.25 11.25 0 0 0-3.558 21.922c.563.104.768-.244.768-.542 0-.267-.01-.974-.015-1.912-3.13.68-3.79-1.508-3.79-1.508-.512-1.3-1.25-1.646-1.25-1.646-1.021-.697.077-.683.077-.683 1.13.08 1.724 1.16 1.724 1.16 1.003 1.718 2.632 1.221 3.273.934.102-.727.393-1.222.715-1.503-2.5-.284-5.13-1.25-5.13-5.564 0-1.23.44-2.234 1.16-3.022-.116-.285-.503-1.43.11-2.981 0 0 .945-.303 3.095 1.155a10.79 10.79 0 0 1 5.636 0c2.149-1.458 3.092-1.155 3.092-1.155.614 1.55.228 2.696.112 2.98.722.79 1.158 1.794 1.158 3.023 0 4.325-2.634 5.277-5.144 5.556.404.349.765 1.037.765 2.09 0 1.508-.014 2.726-.014 3.096 0 .3.203.65.774.54A11.25 11.25 0 0 0 12 .75Z"/>',
  camera: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="m8 6 1-3h6l1 3"/><circle cx="12" cy="13" r="4"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  touch: '<path d="M8 12V5a2 2 0 0 1 4 0v7-3a2 2 0 0 1 4 0v3-1a2 2 0 0 1 4 0v5c0 4-3 6-6 6-2 0-4-1-5-3l-5-6a2 2 0 0 1 3-3l1 2"/>',
  swipe: '<path d="M3 12h18M7 8l-4 4 4 4m10-8 4 4-4 4"/>',
  up: '<path d="M12 21V3m-7 7 7-7 7 7"/>',
  volume: '<path d="m11 4-6 5H2v6h3l6 5zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4m-3 14h2"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  play: '<path d="m7 4 14 8-14 8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  windows: '<path fill="currentColor" stroke="none" d="M2 4.5 10.5 3.3V11H2zm10-1.5L22 1.6V11h-9.5zM2 13h8.5v7.7L2 19.5zm10.5 0H22v9.4L12.5 21z"/>',
  android: '<path d="m7 5-2-3m12 3 2-3M3 12a9 9 0 0 1 18 0H3zm1 3v5m16-5v5M8 15v7m8-7v7"/><path d="M8 9h.01M16 9h.01" stroke-width="3"/>',
};
function symbol(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.grid}</svg>`; }
document.querySelectorAll('[data-symbol]').forEach(el => { el.innerHTML = symbol(el.dataset.symbol); });

// A small physical response, confined to the decorative brand mark.
const hero = document.querySelector('.hero');
const emblem = document.querySelector('.hero-emblem');
const stillEmblem = matchMedia('(prefers-reduced-motion: reduce), (hover: none), (pointer: coarse)');
let emblemFrame = 0;
let emblemPointer;
function resetEmblem() {
  cancelAnimationFrame(emblemFrame);
  emblemFrame = 0;
  for (const name of ['--move-x', '--move-y']) emblem.style.removeProperty(name);
}
hero.addEventListener('pointermove', event => {
  if (stillEmblem.matches || event.pointerType === 'touch') return;
  emblemPointer = { x: event.clientX, y: event.clientY };
  if (emblemFrame) return;
  emblemFrame = requestAnimationFrame(() => {
    emblemFrame = 0;
    const box = emblem.getBoundingClientRect();
    if (box.bottom < 0) return resetEmblem();
    const clamp = value => Math.max(-1, Math.min(1, value));
    const x = clamp((emblemPointer.x - box.left - box.width / 2) / (hero.clientWidth / 2));
    const y = clamp((emblemPointer.y - box.top - box.height / 2) / (innerHeight / 2));
    emblem.style.setProperty('--move-x', `${x * 5}px`);
    emblem.style.setProperty('--move-y', `${y * 5}px`);
  });
});
hero.addEventListener('pointerleave', resetEmblem);
window.addEventListener('blur', resetEmblem);
stillEmblem.addEventListener('change', resetEmblem);

const frame = document.querySelector('#demo-frame');
const previewScreen = document.querySelector('#demo-screen');
function fitPreview() {
  const width = previewScreen.clientWidth;
  if (!width) return;
  frame.style.width = '900px';
  frame.style.height = Math.round(previewScreen.clientHeight * 900 / width) + 'px';
  frame.style.transform = 'scale(' + width / 900 + ')';
}
new ResizeObserver(fitPreview).observe(previewScreen);
fitPreview();
window.addEventListener('message', event => {
  if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
  if (event.data?.type === 'windock-preview-opened') {
    previewScreen.scrollIntoView({ block: 'center', behavior: stillEmblem.matches ? 'instant' : 'smooth' });
    return;
  }
  if (event.data?.type !== 'windock-preview-layout') return;
  document.querySelectorAll('[data-density-choice]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.densityChoice) === event.data.perPage)));
});
document.querySelectorAll('[data-density-choice]').forEach(button => button.addEventListener('click', () => {
  frame.contentWindow.postMessage({ type: 'windock-preview-density', perPage: Number(button.dataset.densityChoice) }, location.origin);
}));
document.querySelector('#preview-drawer').addEventListener('click', () => {
  frame.contentWindow.postMessage({ type: 'windock-preview-drawer' }, location.origin);
});
document.querySelector('#preview-capture').addEventListener('click', () => {
  frame.contentWindow.postMessage({ type: 'windock-preview-capture' }, location.origin);
});

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
async function loadDownloads() {
  try {
    const response = await fetch('./downloads.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Download manifest unavailable');
    const manifest = await response.json();
    document.querySelector('#release-version').textContent = manifest.version || 'Preview';
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
    downloadStatus.textContent = 'Both downloads are ready. Start with the Windows companion.';
  } catch {
    downloadStatus.textContent = 'Downloads are temporarily unavailable. Please reload to try again.';
    document.querySelectorAll('.download-button > span:first-child').forEach(el => { el.textContent = 'Download unavailable'; });
  }
}
loadDownloads();
