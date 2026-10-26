const panel = document.querySelector('#community-feedback');
const host = document.querySelector('#community-comments');
const status = document.querySelector('#community-status');
const retry = document.querySelector('#community-retry');
const discussionLink = document.querySelector('#community-github');
const origin = 'https://giscus.app';
const theme = () => document.documentElement.dataset.theme === 'dark' ? 'transparent_dark' : 'noborder_light';
let script, timer, frameReady = false;

function frame() { return host.querySelector('iframe.giscus-frame'); }
function syncTheme() {
  if (frameReady) frame()?.contentWindow.postMessage({ giscus: { setConfig: { theme: theme() } } }, origin);
}
function ready() {
  clearTimeout(timer);
  panel.dataset.state = 'ready';
  status.hidden = true;
  retry.hidden = true;
  host.removeAttribute('aria-busy');
}
function unavailable() {
  clearTimeout(timer);
  panel.dataset.state = 'unavailable';
  status.hidden = false;
  status.textContent = 'Comments could not load here. You can still join the conversation on GitHub.';
  retry.hidden = false;
  host.removeAttribute('aria-busy');
}
function startLoading() {
  frameReady = false;
  panel.dataset.state = 'loading';
  status.hidden = false;
  status.textContent = 'Loading community feedback…';
  retry.hidden = true;
  host.setAttribute('aria-busy', 'true');
  clearTimeout(timer);
  timer = setTimeout(unavailable, 20000);
}
function load() {
  if (panel.dataset.state === 'loading' || panel.dataset.state === 'ready') return;
  startLoading();
  if (frame()) {
    // Keep one Giscus client and its message handlers; retry only the iframe.
    frame().src = frame().src;
    return;
  }
  if (script) script.remove();
  script = document.createElement('script');
  script.src = `${origin}/client.js`;
  script.async = true;
  script.crossOrigin = 'anonymous';
  Object.assign(script.dataset, {
    repo: 'aliihsaad/WinDock',
    repoId: 'R_kgDOUfO7Ig',
    category: 'Announcements',
    categoryId: 'DIC_kwDOUfO7Is4DJr27',
    // One existing discussion, independent of page URL or deployment hostname.
    mapping: 'number', term: '39',
    reactionsEnabled: '1', emitMetadata: '1', inputPosition: 'top',
    theme: theme(), lang: 'en', loading: 'eager',
  });
  script.addEventListener('error', unavailable, { once: true });
  script.addEventListener('load', () => {
    if (!frame()) return unavailable();
    frame().title = 'WinDock community feedback on GitHub';
  }, { once: true });
  document.head.append(script);
}

panel.addEventListener('toggle', () => { if (panel.open) load(); });
retry.addEventListener('click', load);
new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
window.addEventListener('message', event => {
  if (event.origin !== origin || event.source !== frame()?.contentWindow) return;
  const data = event.data?.giscus;
  if (!data || typeof data !== 'object') return;
  if (!frameReady) { frameReady = true; syncTheme(); }
  if (typeof data.error === 'string') {
    unavailable();
    return;
  }
  if (data.discussion) {
    if (/^https:\/\/github\.com\/aliihsaad\/WinDock\/discussions\/\d+$/.test(data.discussion.url)) {
      discussionLink.href = data.discussion.url;
      discussionLink.textContent = 'View discussion on GitHub ↗';
    }
    ready();
  }
  if (Number.isFinite(data.resizeHeight) && data.resizeHeight > 0 && panel.dataset.state !== 'unavailable') ready();
});

// Complete Giscus's own OAuth return flow even though ordinary visits start closed.
if (new URLSearchParams(location.search).has('giscus')) panel.open = true;
