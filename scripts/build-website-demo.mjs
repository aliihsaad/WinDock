// Reuse the shipping UI, with an in-memory transport and no host connection.
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CONTROL_VERBS } from '../src/platform/contract.js';

const root = resolve(import.meta.dirname, '..');
const destination = resolve(root, 'website/demo');
function replaceOnce(source, from, to) {
  if (!source.includes(from)) throw new Error(`Preview source changed; review adapter: ${from}`);
  return source.replace(from, to);
}
export async function buildWebsiteDemo() {
  await mkdir(destination, { recursive: true });
  let html = await readFile(resolve(root, 'public/index.html'), 'utf8');
  html = replaceOnce(html, '<link rel="manifest" href="/manifest.webmanifest">', '');
  html = replaceOnce(html, 'href="/style.css"', 'href="./style.css"');
  html = replaceOnce(html, 'src="/app.js"', 'src="./app.js"');
  html = replaceOnce(html, 'src="/performance.js"', 'src="./performance.js" data-memory-only');
  html = replaceOnce(html, 'src="/appearance.js"', 'src="./appearance.js" data-memory-only');
  html = replaceOnce(html, '<title>WinDock</title>', '<title>WinDock interactive preview</title>');
  html = replaceOnce(html, 'Main monitor · Saved on your PC', 'Demo · Nothing is captured or saved');
  html = replaceOnce(html, 'Recordings stop after 60 minutes.<span', 'In the app, captures are saved to your PC.<span');
  html = replaceOnce(html, '>Paste to PC</button>', '>Try paste</button>');
  html = replaceOnce(html, '<head>', `<head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'">`);
  await writeFile(resolve(destination, 'index.html'), html);
  for (const file of ['style.css', 'appearance.js', 'performance.js', 'icons.js', 'tiles.js', 'launcher.js', 'input-pad.js', 'touchpad-gestures.js', 'remote-keyboard.js', 'pc-clipboard.js', 'now-playing.js', 'pairing.js', 'updates.js']) {
    await copyFile(resolve(root, 'public', file), resolve(destination, file));
  }
  let clipboard = await readFile(resolve(destination, 'pc-clipboard.js'), 'utf8');
  for (const [from, to] of [
    ['"Paste to PC"', '"Try paste"'],
    ['"Recent clipboard"', '"Sample clipboard"'],
    ['"Loading PC clipboard…"', '"Loading sample text…"'],
    ['"Choose a text item. Images and files are not shown."', '"Sample text only. Your real clipboard is never read."'],
    ['"Paste sent to the PC."', '"Added to the demo text below. Nothing was pasted on your PC."'],
  ]) clipboard = replaceOnce(clipboard, from, to);
  await writeFile(resolve(destination, 'pc-clipboard.js'), clipboard);
  let updates = await readFile(resolve(destination, 'updates.js'), 'utf8');
  updates = replaceOnce(updates, '"You’re up to date."', '"Demo check complete. Use the installed app to check your real version."');
  updates = replaceOnce(updates, '"Check for the latest release when you’re ready."', '"Try a simulated update check. No release service is contacted."');
  updates = replaceOnce(updates, '"Installed on your PC: "', '"Preview: "');
  await writeFile(resolve(destination, 'updates.js'), updates);
  let dock = await readFile(resolve(root, 'public/dock.js'), 'utf8');
  dock = replaceOnce(dock,
    'src="/api/apps/icon?v=3&amp;id=${escapeHtml(encodeURIComponent(app.id))}"',
    'src="../assets/${escapeHtml(encodeURIComponent(app.id))}.png"');
  await writeFile(resolve(destination, 'dock.js'), dock);
  let app = await readFile(resolve(root, 'public/app.js'), 'utf8');
  app = `import { fetch, WebSocket, localStorage, getPreviewPcs, selectPreviewPc, forgetPreviewPc } from '../preview-transport.js';
// The Android picker is native. Its browser equivalent lives outside the dock
// frame too, so it stays readable on phones instead of scaling with the dock.
function showPreviewPcPicker() {
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  parent.postMessage({ type: 'windock-preview-pcs', pcs: getPreviewPcs(), open: true }, location.origin);
}
window.WinDockAndroid = { showPcPicker: showPreviewPcPicker };
${app}`;
  // The preview must never install a worker that could outlive the frame.
  app = replaceOnce(app, 'if ("serviceWorker" in navigator) {', 'if (false) { // Service workers are disabled in the website preview.');
  app = replaceOnce(app, 'try { await refresh(); showApp(); connect(); }', "try { await refresh(); showApp(); connect(); parent.postMessage({ type: 'windock-preview-ready' }, location.origin); }");
  for (const [from, to] of [
    ['Recording started · Tap Stop to save', 'Demo recording started · Tap Stop to finish'],
    ['Screenshot saved in Pictures / WinDock', 'Screenshot preview · No file created'],
    ['Recording saved in Videos / WinDock', 'Recording preview finished · No file created'],
    ['Recording your main monitor. Stop to save the video.', 'Demo timer running. Nothing is being recorded.'],
    ['Screenshots → Pictures / WinDock. Recordings → Videos / WinDock.', 'Try a screenshot or a recording. No files are created in this demo.'],
    ['Last saved: ', 'Preview result: '],
  ]) app = replaceOnce(app, from, to);
  app += `
// Small parent bridge; every setting still uses the real app's saveLayout.
let clipboardObserver;
window.addEventListener('message', async (event) => {
  if (event.source !== parent || event.origin !== location.origin) return;
  if (event.data?.type === 'windock-preview-ping' && paired) parent.postMessage({ type: 'windock-preview-ready' }, location.origin);
  if (event.data?.type === 'windock-preview-pc-picker' && paired) showPreviewPcPicker();
  if (event.data?.type === 'windock-preview-pc-action' && paired) {
    const { action, id } = event.data;
    if (!['select', 'forget', 'refresh'].includes(action)) return;
    let selected = false;
    if (action === 'select' && !saving && !gesture?.dragging) {
      selected = selectPreviewPc(id);
      if (selected) { editing = false; currentPage = 0; appsLoaded = false; await refresh(); }
    }
    if (action === 'forget') forgetPreviewPc(id);
    parent.postMessage({ type: 'windock-preview-pcs', pcs: getPreviewPcs(), selected, action }, location.origin);
  }
  if (event.data?.type === 'windock-preview-clipboard' && paired) {
    clipboardObserver?.disconnect();
    const dialog = document.getElementById('input-pad'), toggle = document.getElementById('pc-clipboard-toggle');
    for (const other of document.querySelectorAll('dialog[open]')) if (other !== dialog) other.close();
    inputPad.open('touchpad');
    const showClipboard = () => {
      if (!dialog.open) { clipboardObserver.disconnect(); return; }
      if (dialog.dataset.ready === 'true' && !toggle.disabled) {
        clipboardObserver.disconnect();
        if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
      }
    };
    clipboardObserver = new MutationObserver(showClipboard);
    clipboardObserver.observe(dialog, { attributes: true, attributeFilter: ['data-ready', 'open'] });
    showClipboard();
    parent.postMessage({ type: 'windock-preview-opened' }, location.origin);
  }
  if (event.data?.type === 'windock-preview-input' && paired && ['touchpad', 'signature'].includes(event.data.mode)) {
    // Keep this dialog open while switching modes: its queued close event
    // would otherwise disconnect the newly opened demo touchpad.
    for (const dialog of document.querySelectorAll('dialog[open]')) if (dialog.id !== 'input-pad') dialog.close();
    inputPad.open(event.data.mode);
    parent.postMessage({ type: 'windock-preview-opened' }, location.origin);
  }
  if (event.data?.type === 'windock-preview-density' && [4, 6, 8].includes(event.data.perPage)) saveLayout({ perPage: event.data.perPage });
  if (event.data?.type === 'windock-preview-drawer' && paired) {
    for (const dialog of document.querySelectorAll('dialog[open]')) if (dialog.id !== 'drawer') dialog.close();
    openDrawer();
    parent.postMessage({ type: 'windock-preview-opened' }, location.origin);
  }
  if (event.data?.type === 'windock-preview-capture' && paired) {
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    openCapture();
    parent.postMessage({ type: 'windock-preview-opened' }, location.origin);
  }
});
parent.postMessage({ type: 'windock-preview-layout', perPage: layout.perPage }, location.origin);
`;
  await writeFile(resolve(destination, 'app.js'), app);
  await writeFile(resolve(destination, 'verbs.js'), `export default ${JSON.stringify(CONTROL_VERBS)};\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  await buildWebsiteDemo();
  console.log('Website preview generated from the current WinDock UI.');
}
