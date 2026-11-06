// Disposable loopback UI fixture. --native enables only the real folder picker/open action.
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../server.js";
import { createConfigStore } from "../src/config.js";
import { createWindowsProvider } from "../src/platform/windows.js";
import { createExec } from "../src/platform/index.js";
import { folderApp } from "../src/folders.js";

const fixture = resolve("artifacts/folder-shortcuts-fixture/Project & notes مرحبا");
await mkdir(fixture, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), "windock-folder-ui-"));
const native = createWindowsProvider({ exec: createExec(), helperPath: resolve("artifacts/WinDock-win-x64/WinDockHelper.exe") });
let picks = 0;
const useNative = process.argv.includes("--native");
const provider = {
  id: "windows", displayName: "Windows test fixture",
  listInstalledApps: async () => [], listRunningApps: async () => [],
  nowPlaying: async () => null, systemStats: async () => ({}),
  pickFolder: useNative ? native.pickFolder : async () => ++picks === 2 ? null : folderApp(fixture),
  openFolder: useNative ? native.openFolder : async app => console.log("FIXTURE OPEN", app.id),
};
const app = await createApp({ provider, configStore: createConfigStore({ path: join(temporary, "config.json") }),
  hostName: "Folder test PC", updates: { state: () => ({}), check: async () => ({}) } });
await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
console.log(JSON.stringify({ url: "http://127.0.0.1:" + app.server.address().port, fixture, native: useNative }));
let closing = false;
async function close() {
  if (closing) return; closing = true;
  await app.hub.close(); await app.inputHub.close(); app.server.closeAllConnections();
  await new Promise(resolve => app.server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
process.on("SIGINT", () => close().then(() => process.exit()));
process.on("SIGTERM", () => close().then(() => process.exit()));
setTimeout(() => close().then(() => process.exit()), 20 * 60_000).unref();
