// Isolated real shared-UI fixtures. No OS actions, discovery listener or user config.
import { createApp } from '../server.js';
import { createConfigStore } from '../src/config.js';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const dir = resolve(import.meta.dirname, '../artifacts/pc-picker');
await mkdir(dir, { recursive: true });
const hosts = [];
for (const [port, platform, hostName, pin] of [
  [18625, 'windows', 'Desk Windows', '864213'],
  [18626, 'linux', 'Studio Linux', '975324'],
]) {
  const provider = {
    id: platform, listInstalledApps: async () => [], listRunningApps: async () => [],
    nowPlaying: async () => null, systemStats: async () => ({}),
    control: async () => { throw new Error('OS actions disabled in test fixture'); },
  };
  const configStore = createConfigStore({ path: resolve(dir, `host-${port}.json`) });
  const app = await createApp({ provider, configStore, pin, hostName, trustLoopback: false });
  await new Promise(resolve => app.server.listen(port, '127.0.0.1', resolve));
  hosts.push(app);
  console.log(`${hostName} ready on ${port}`);
}
process.on('SIGINT', () => { for (const app of hosts) app.server.close(); process.exit(0); });
