// Isolated emulator fixture. No Windows provider and no user configuration.
import { createApp } from '../server.js';
import { createConfigStore } from '../src/config.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const dir = resolve(import.meta.dirname, '../artifacts/android-smoke');
await mkdir(dir, { recursive: true });
const apps = ['Browser', 'Editor', 'Music', 'Terminal', 'Notes'].map((name, i) => ({
  id: `smoke-${i + 1}`, name, target: `C:\\Smoke\\app${i + 1}.exe`, args: '', icon: '',
}));
const events = [];
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
};
const configStore = createConfigStore({ path: resolve(dir, 'config.json') });
await configStore.save({ tiles: apps.map(app => ({ ...app, kind: 'app', label: app.name })) });
await writeFile(resolve(dir, 'events.json'), '[]');
const app = await createApp({ provider, configStore, pin: '8642', trustLoopback: false, allowDestructive: false });
app.server.listen(18622, '127.0.0.1', () => console.log('Android emulator fixture ready on 18622'));
