// Isolated emulator fixture. No Windows provider and no user configuration.
import { createApp } from '../server.js';
import { createUpdateService } from '../src/updates.js';
import { createConfigStore } from '../src/config.js';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const dir = resolve(import.meta.dirname, '../artifacts/android-smoke');
await mkdir(dir, { recursive: true });
const apps = ['Browser', 'Editor', 'Music', 'Terminal', 'Notes'].map((name, i) => ({
  id: `smoke-${i + 1}`, name, target: `C:\\Smoke\\app${i + 1}.exe`, args: '', icon: '',
}));
const events = [];
const inputEvents = [];
let inputWrites = Promise.resolve();
let running = [];
async function record(action, app) {
  events.push({ action, id: app.id, pid: app.pid });
  await writeFile(resolve(dir, 'events.json'), JSON.stringify(events, null, 2));
}
const provider = {
  id: 'android-smoke', displayName: 'Android smoke fixture',
  listInstalledApps: async () => apps,
  listRunningApps: async () => running,
  launchApp: async app => { running = [{ ...app, pid: 4242 }]; await record('launch', app); },
  focusApp: async app => record('focus', app),
  closeApp: async app => { running = []; await record('close', app); },
  control: async () => { throw new Error('Control actions disabled in the emulator fixture'); },
  nowPlaying: async () => null,
  systemStats: async () => ({}),
  input: {
    open() {
      return { ready: Promise.resolve(), send: event => {
        inputEvents.push(event);
        inputWrites = inputWrites.then(() => writeFile(resolve(dir, 'input-events.json'), JSON.stringify(inputEvents, null, 2)));
        return inputWrites;
      }, close() {} };
    },
    dispose() {},
  },
};
const configStore = createConfigStore({ path: resolve(dir, 'config.json') });
await configStore.save({ tiles: apps.map(app => ({ ...app, kind: 'app', label: app.name })) });
await writeFile(resolve(dir, 'events.json'), '[]');
await writeFile(resolve(dir, 'input-events.json'), '[]');
const certPath = process.env.WINDOCK_SMOKE_TLS_CERT;
const keyPath = process.env.WINDOCK_SMOKE_TLS_KEY;
if (Boolean(certPath) !== Boolean(keyPath)) throw new Error('Supply both smoke TLS certificate and key.');
const tls = certPath ? { cert: await readFile(certPath), key: await readFile(keyPath) } : null;
const app = await createApp({ provider, configStore, updates: createUpdateService({ platform: 'windows' }), pin: '864213', securePin: '975310', tls, trustLoopback: false, allowDestructive: false });
const port = Number(process.env.WINDOCK_SMOKE_PORT || 18622);
if (![18622, 18623].includes(port)) throw new Error('Use an isolated emulator fixture port');
app.server.listen(port, '127.0.0.1', () => console.log(`Android emulator fixture ready on ${port}`));
if (tls && port === 18623) throw new Error('TLS fixture reserves 18623; use 18622 for HTTP.');
app.secureServer?.listen(18623, '127.0.0.1', () => console.log('Android HTTPS emulator fixture ready on 18623'));
