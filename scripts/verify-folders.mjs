/** Folder shortcuts: backwards-compatible tiles, authenticated selection and directory-only launch. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import { folderApp, folderFromTile } from "../src/folders.js";
import { createConfigStore, normalizeTiles } from "../src/config.js";
import { addAppTile, toWireTiles, removeTile, tileKey } from "../public/tiles.js";
import { renderTile } from "../public/dock.js";
import { createWindowsProvider } from "../src/platform/windows.js";
import { createApp } from "../server.js";

const t = createChecker("folders");
const folder = folderApp("C:\\Projects & notes\\مرحبا 🙂");
t.ok(folder && folder.source === "folder", "Unicode and shell metacharacters are valid folder names");
t.equal(folderApp("C:/Projects & notes/مرحبا 🙂/").id, folder.id, "separator and trailing-slash changes preserve identity");
t.equal(folderApp("c:/PROJECTS & NOTES/مرحبا 🙂").id, folder.id, "Windows case changes preserve identity");
t.equal(folderApp("C:\\").target, "C:\\", "drive root remains absolute");
for (const path of [null, "", "relative", "C:relative", "\\\\server\\share", "\\\\?\\C:\\X", "shell:AppsFolder", "https://example.com", "C:\\bad\nname", 'C:\\bad"name', "C:\\x:stream", "C:\\bad?name", "C:\\bad.", "C:\\bad ", "C:\\" + "a".repeat(400)])
  t.equal(folderApp(path), null, "reject ambiguous/non-local path: " + JSON.stringify(path));
const tiles = normalizeTiles(addAppTile([], folder));
t.equal(tiles[0].kind, "app", "folder uses existing app tile kind");
t.deepEqual(normalizeTiles(toWireTiles(tiles)), tiles, "old client serialization retains folder identity and path");
t.equal(folderFromTile(tiles[0]).target, folder.target, "trusted directory launch record can be recovered");
t.equal(folderFromTile({ ...tiles[0], args: "--command" }), null, "arguments cannot be attached to a folder");
t.equal(folderFromTile({ ...tiles[0], target: "C:\\Different" }), null, "mismatched id/path cannot alias another folder");
t.equal(addAppTile(tiles, folder).length, 1, "duplicate selection is not duplicated");
t.equal(removeTile(tiles, tileKey(tiles[0])).length, 0, "normal remove action removes folder tile");
t.ok(renderTile(tiles[0]).includes("Open folder"), "folder has an accurate action hint");
t.ok(renderTile(tiles[0]).includes('src="/folder.svg"'), "optimistic new tile renders without requiring a persisted icon lookup");

let selected = folder.target, picks = 0, finishPick = null, failOpen = false;
const nativeCalls = [];
const provider = createWindowsProvider({ helperPath: "test-helper", exec: async (file, args, options) => {
  if (file !== "test-helper") return { stdout: "[]" };
  nativeCalls.push({ args, options });
  if (args[0] === "pick-folder") {
    picks++;
    if (finishPick) await new Promise(resolve => { finishPick = resolve; });
    return { stdout: JSON.stringify({ path: selected }) };
  }
  if (args[0] === "open-folder" && failOpen) throw new Error("private native path diagnostics");
  return { stdout: "" };
} });
const picked = await provider.pickFolder();
t.equal(picked.id, folder.id, "native selection produces stable folder app");
t.deepEqual(nativeCalls[0], { args: ["pick-folder"], options: { interactive: true, timeoutMs: 120000 } }, "picker is visible, bounded and receives no caller path");
finishPick = true;
const waiting = provider.pickFolder();
await t.rejects(() => provider.pickFolder(), "overlapping picker is refused");
finishPick(); finishPick = null; await waiting;
await provider.openFolder(folder);
t.deepEqual(nativeCalls.at(-1).args, ["open-folder", folder.target], "exact directory remains one native argv entry");
await t.rejects(() => provider.openFolder({ ...folder, args: "cmd" }), "folder arguments rejected before native launch");

const dir = await mkdtemp(join(tmpdir(), "windock-folders-"));
const store = createConfigStore({ path: join(dir, "config.json") });
const app = await createApp({ provider, configStore: store, pin: "572864", trustLoopback: false });
await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + app.server.address().port;
let cookie = "";
async function call(path, { method = "GET", body, origin = base, auth = true } = {}) {
  const response = await fetch(base + path, { method, headers: { origin, ...(auth ? { cookie } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch { }
  return { status: response.status, json, text };
}
try {
  const before = picks;
  t.equal((await call("/api/folders/pick", { method: "POST", body: {} })).status, 401, "unpaired client cannot open desktop dialogs");
  t.equal(picks, before, "unauthorized request does not invoke native picker");
  await call("/api/auth", { method: "POST", body: { pin: "572864" } });
  t.equal((await call("/api/state")).json.canPickFolders, true, "Windows advertises optional folder picker capability");
  t.equal((await call("/api/folders/pick", { method: "POST", body: {}, origin: "https://evil.test" })).status, 403, "cross-origin selection is rejected");
  t.equal((await call("/api/folders/pick", { method: "POST", body: { path: "C:\\Anything" } })).status, 400, "selection rejects client paths/options");
  selected = null;
  t.equal((await call("/api/folders/pick", { method: "POST", body: {} })).json.app, null, "Windows cancel is a successful no-op");
  t.equal((await store.load()).tiles.length, 0, "cancel leaves dock unchanged");
  selected = folder.target;
  const result = await call("/api/folders/pick", { method: "POST", body: {} });
  t.equal(result.json.app.target, folder.target, "selection preserves exact path");
  t.equal((await call("/api/apps/launch", { method: "POST", body: { id: folder.id } })).status, 404, "unpinned folder cannot be launched by forged id");
  await call("/api/tiles", { method: "PUT", body: { tiles } });
  store.invalidate();
  t.equal((await store.load()).tiles[0].target, folder.target, "folder survives config reload");
  t.equal((await call("/api/apps/installed")).json.apps[0].id, folder.id, "old clients resolve pinned folder through existing inventory API");
  t.equal((await call("/api/apps/launch", { method: "POST", body: { id: folder.id, target: "C:\\Windows\\cmd.exe", args: "/c calc" } })).status, 200, "legacy id-only launch ignores substituted client command");
  t.deepEqual(nativeCalls.at(-1).args, ["open-folder", folder.target], "only saved folder reaches directory-only helper");
  t.ok((await call("/api/apps/icon?id=" + encodeURIComponent(folder.id))).text.includes("<svg"), "old icon API supplies a folder icon");
  failOpen = true;
  const unavailable = await call("/api/apps/launch", { method: "POST", body: { id: folder.id } });
  t.equal(unavailable.status, 422, "deleted/unavailable directory has an actionable error");
  t.ok(!unavailable.text.includes("private native"), "native diagnostics are not disclosed");
  await call("/api/tiles", { method: "PUT", body: { tiles: [] } });
  t.equal((await call("/api/apps/launch", { method: "POST", body: { id: folder.id } })).status, 404, "removing folder revokes its launch entry");
  t.equal((await call("/api/apps/installed")).json.apps.length, 0, "removed folder has no retained secondary registry");
  provider.pickFolder = undefined;
  t.equal((await call("/api/state")).json.canPickFolders, false, "hosts without the optional picker do not advertise it");
  t.equal((await call("/api/folders/pick", { method: "POST", body: {} })).status, 404, "unsupported hosts reject folder selection without affecting app routes");
} finally {
  app.hub.close(); app.inputHub.close(); app.server.closeAllConnections();
  await new Promise(resolve => app.server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
t.done("folders verification passed");
