// Only the generated iframe imports this adapter. No real fetch, WebSocket,
// storage, or Windows APIs are used; CSP also blocks outgoing connections.
import verbs from './demo/verbs.js';

const apps = [
  ['chrome', 'Google Chrome'], ['vscode', 'Visual Studio Code'],
  ['spotify', 'Spotify'], ['obsidian', 'Obsidian'], ['claude', 'Claude'],
  ['chatgpt', 'ChatGPT'], ['edge', 'Microsoft Edge'], ['notepad', 'Notepad'],
].map(([id, name]) => ({ id, name, target: `preview:${id}`, args: '', icon: '' }));
let tiles = apps.map(app => ({ ...app, kind: 'app', label: app.name }));
const values = new Map([['windock-layout', JSON.stringify({ perPage: 6 })]]);
let recordingStartedAt = null, lastCapture = null;

function finishRecording() {
  if (recordingStartedAt === null) return;
  lastCapture = { kind: 'recording', name: 'Demo recording.mp4', path: 'Demo recording.mp4 · No file created', savedAt: Date.now() };
  recordingStartedAt = null;
}
function captureStatus() {
  if (recordingStartedAt !== null && Date.now() - recordingStartedAt >= 60 * 60 * 1000) finishRecording();
  return { available: true, phase: recordingStartedAt === null ? 'idle' : 'recording', startedAt: recordingStartedAt, elapsedMs: recordingStartedAt === null ? 0 : Date.now() - recordingStartedAt, lastCapture, error: null };
}

export const localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem(key, value) {
    values.set(key, value);
    if (key === 'windock-layout') {
      const layout = JSON.parse(value);
      parent.postMessage({ type: 'windock-preview-layout', perPage: layout.perPage }, location.origin);
    }
  },
};

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
export async function fetch(path, options = {}) {
  if (path === '/api/state') return response({ tiles, running: [], verbs, hostName: 'Preview PC', platformName: 'Windows', allowDestructive: false });
  if (path === '/api/apps/installed') return response({ apps });
  if (path === '/api/nowplaying') return response({ nowPlaying: null });
  if (path === '/api/capture' && (!options.method || options.method === 'GET')) return response(captureStatus());
  if (['/api/capture/screenshot', '/api/capture/start', '/api/capture/stop'].includes(path) && options.method === 'POST') {
    if (path.endsWith('/screenshot')) lastCapture = { kind: 'screenshot', name: 'Demo screenshot.png', path: 'Demo screenshot.png · No file created', savedAt: Date.now() };
    if (path.endsWith('/start') && recordingStartedAt === null) recordingStartedAt = Date.now();
    if (path.endsWith('/stop')) finishRecording();
    return response(captureStatus());
  }
  if (path === '/api/tiles' && options.method === 'PUT') {
    const body = JSON.parse(options.body);
    if (!Array.isArray(body.tiles) || body.tiles.length > 64) return response({ error: 'Invalid preview tiles' }, 400);
    tiles = body.tiles;
    return response({ tiles });
  }
  if (path === '/api/control' || path.startsWith('/api/apps/') || path.startsWith('/api/capture/')) {
    return response({ error: 'Preview only — no action is sent to your PC.' }, 409);
  }
  return response({ error: 'Unavailable in the preview' }, 404);
}

export class WebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  readyState = WebSocket.CONNECTING;
  constructor() {
    queueMicrotask(() => { if (this.readyState !== WebSocket.CLOSED) { this.readyState = WebSocket.OPEN; this.onopen?.(); } });
  }
  close() { this.readyState = WebSocket.CLOSED; this.onclose?.(); }
}
