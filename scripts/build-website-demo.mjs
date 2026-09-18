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
  html = replaceOnce(html, '<title>WinDock</title>', '<title>WinDock interactive preview</title>');
  html = replaceOnce(html, 'Main monitor · Saved on your PC', 'Demo · Nothing is captured or saved');
  html = replaceOnce(html, 'Recordings stop after 60 minutes. You can also stop from the Windows tray.', 'In the app, captures are saved to your PC.');
  html = replaceOnce(html, '<head>', `<head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'">`);
  await writeFile(resolve(destination, 'index.html'), html);
  for (const file of ['style.css', 'icons.js', 'tiles.js', 'launcher.js']) {
    await copyFile(resolve(root, 'public', file), resolve(destination, file));
  }
  let dock = await readFile(resolve(root, 'public/dock.js'), 'utf8');
  dock = replaceOnce(dock,
    'src="/api/apps/icon?v=2&amp;id=${escapeHtml(encodeURIComponent(app.id))}"',
    'src="../assets/${escapeHtml(encodeURIComponent(app.id))}.png"');
  await writeFile(resolve(destination, 'dock.js'), dock);
  let app = await readFile(resolve(root, 'public/app.js'), 'utf8');
  app = `import { fetch, WebSocket, localStorage } from '../preview-transport.js';\n${app}`;
  // The preview must never install a worker that could outlive the frame.
  app = replaceOnce(app, 'if ("serviceWorker" in navigator) {', 'if (false) { // Service workers are disabled in the website preview.');
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
window.addEventListener('message', (event) => {
  if (event.source !== parent || event.origin !== location.origin) return;
  if (event.data?.type === 'windock-preview-density' && [4, 6, 8].includes(event.data.perPage)) saveLayout({ perPage: event.data.perPage });
  if (event.data?.type === 'windock-preview-drawer' && paired) {
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
