const frame = document.querySelector('#demo-frame');
const screen = document.querySelector('#demo-screen');
const experience = document.querySelector('#experience');
const send = data => frame.contentWindow.postMessage(data, location.origin);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const dialog = document.querySelector('#pc-demo-picker');
const list = document.querySelector('#pc-demo-list');
const confirmation = document.querySelector('#pc-demo-confirm');
const status = document.querySelector('#pc-demo-status');
const expand = document.querySelector('#demo-expand');
experience.append(dialog);
let ready = false, pendingAction = null, pcs = [], opener, forgottenId;

function fitPreview() {
  const width = screen.clientWidth;
  if (!width) return;
  frame.style.width = '900px';
  frame.style.height = Math.round(screen.clientHeight * 900 / width) + 'px';
  frame.style.transform = `scale(${width / 900})`;
}
new ResizeObserver(fitPreview).observe(screen);
fitPreview();

function openDemo(action) {
  if (!ready) { pendingAction = action; return; }
  if (action === 'touchpad' || action === 'signature') send({ type: 'windock-preview-input', mode: action });
  else send({ type: `windock-preview-${action}` });
  document.querySelectorAll('.demo-shortcuts [data-demo-action]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.demoAction === action)));
  if (action !== 'pc-picker') experience.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'instant' : 'smooth' });
}
document.querySelectorAll('[data-demo-action]').forEach(button => button.addEventListener('click', () => {
  opener = button;
  openDemo(button.dataset.demoAction);
}));
document.querySelectorAll('[data-density-choice]').forEach(button => button.addEventListener('click', () => send({ type: 'windock-preview-density', perPage: Number(button.dataset.densityChoice) })));
document.querySelector('#demo-clear-text').addEventListener('click', () => send({ type: 'windock-preview-clear-text' }));

function showList() { confirmation.hidden = true; list.hidden = false; forgottenId = null; }
function renderPcs() {
  list.replaceChildren();
  for (const [title, matches] of [['Available PCs', pcs.filter(pc => pc.online)], ['Saved PCs', pcs.filter(pc => !pc.online && pc.saved)]]) {
    if (!matches.length) continue;
    const heading = document.createElement('h3'); heading.textContent = title; list.append(heading);
    for (const pc of matches) {
      const row = document.createElement('div'); row.className = 'pc-demo-row'; row.dataset.current = String(pc.current); row.dataset.pc = pc.id;
      const choose = document.createElement('button'); choose.className = 'pc-demo-select'; choose.dataset.selectPc = pc.id;
      const name = document.createElement('strong'); name.textContent = pc.name;
      const detail = document.createElement('span'); detail.textContent = `${pc.platform} · ${pc.current ? 'Current PC' : pc.online ? 'Available' : 'Not found'}`;
      const address = document.createElement('small'); address.textContent = pc.address;
      choose.append(name, detail, address);
      choose.addEventListener('click', () => {
        status.textContent = pc.online ? `Opening ${pc.name}…` : `${pc.name} is offline in this demo. Choose an available PC.`;
        if (pc.online) send({ type: 'windock-preview-pc-action', action: 'select', id: pc.id });
      });
      row.append(choose);
      if (pc.saved) {
        const forget = document.createElement('button'); forget.className = 'pc-demo-forget'; forget.textContent = 'Forget'; forget.setAttribute('aria-label', `Forget ${pc.name}`);
        forget.addEventListener('click', () => {
          forgottenId = pc.id; list.hidden = true; confirmation.hidden = false;
          document.querySelector('#pc-demo-confirm-title').textContent = `Forget ${pc.name}?`;
          document.querySelector('#pc-demo-cancel').focus();
        });
        row.append(forget);
      }
      list.append(row);
    }
  }
}
document.querySelector('#pc-demo-cancel').addEventListener('click', () => {
  const id = forgottenId; showList(); list.querySelector(`[data-pc="${id}"] .pc-demo-forget`)?.focus();
});
document.querySelector('#pc-demo-forget').addEventListener('click', () => {
  send({ type: 'windock-preview-pc-action', action: 'forget', id: forgottenId });
  showList(); document.querySelector('#pc-demo-refresh').focus();
});
document.querySelector('#pc-demo-refresh').addEventListener('click', () => {
  showList(); send({ type: 'windock-preview-pc-action', action: 'refresh' });
});
document.querySelector('#pc-demo-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => {
  showList();
  (opener && opener !== frame ? opener : document.querySelector('#preview-pc-picker')).focus({ preventScroll: true });
});

window.addEventListener('message', event => {
  if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.type === 'windock-preview-ready') { ready = true; if (pendingAction) { openDemo(pendingAction); pendingAction = null; } }
  if (data?.type === 'windock-preview-layout') document.querySelectorAll('[data-density-choice]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.densityChoice) === data.perPage)));
  if (data?.type === 'windock-preview-typed' && typeof data.text === 'string') {
    document.querySelector('#demo-typing').hidden = false;
    document.querySelector('#demo-typed-text').textContent = data.text.slice(0, 500) || 'Your demo text will appear here.';
  }
  if (data?.type === 'windock-preview-pcs' && Array.isArray(data.pcs)) {
    pcs = data.pcs; renderPcs();
    status.textContent = data.action === 'refresh' ? 'Sample PCs refreshed. No devices were scanned.' : data.action === 'forget' ? 'Removed from saved PCs. Available PCs can still be selected.' : 'Your dock stays open while you choose.';
    if (data.open && !dialog.open) {
      opener = document.activeElement;
      showList(); dialog.showModal();
    }
    if (data.selected) {
      const current = pcs.find(pc => pc.current);
      const label = document.querySelector('#demo-current-pc'); label.replaceChildren();
      const dot = document.createElement('span'); dot.className = 'live-dot';
      const platform = document.createElement('span'); platform.className = 'demo-platform'; platform.textContent = current.platform;
      label.append(dot, document.createTextNode(current.name), platform);
      dialog.close();
      document.querySelector('#demo-note').textContent = `Now exploring ${current.name}’s sample dock. Your devices are never accessed.`;
    }
  }
});

frame.addEventListener('load', () => send({ type: 'windock-preview-ping' }));
send({ type: 'windock-preview-ping' });

// Keep the iframe mounted when expanding, preserving all sample state.
expand.hidden = !document.fullscreenEnabled;
expand.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await experience.requestFullscreen();
  } catch { document.querySelector('#demo-note').textContent = 'Your browser cannot expand the demo here. All controls are still available below.'; }
});
document.addEventListener('fullscreenchange', () => {
  const expanded = document.fullscreenElement === experience;
  expand.setAttribute('aria-pressed', String(expanded));
  expand.setAttribute('aria-label', expanded ? 'Collapse demo' : 'Expand demo');
  expand.title = expanded ? 'Collapse demo' : 'Expand demo';
  fitPreview();
});
