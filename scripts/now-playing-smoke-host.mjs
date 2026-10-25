// Isolated real HTTP/WebSocket host for the now-playing browser regression.
// Run with node scripts/now-playing-smoke-host.mjs; no native PC actions.
import { createServer } from "node:http";
import { createApp } from "../server.js";

let media = { title: "First track", artist: "First artist", playing: true };
let delayMs = 0, fail = false, requests = 0, active = 0, maxActive = 0;
const provider = {
  id: "media-smoke", displayName: "Media regression fixture",
  listInstalledApps: async () => [], listRunningApps: async () => [],
  async nowPlaying() {
    requests++; active++; maxActive = Math.max(maxActive, active);
    const result = media && { ...media };
    try {
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      if (fail) throw new Error("Simulated media provider failure");
      return result;
    } finally { active--; }
  },
  async control(verb) {
    if (verb === "media-play-pause" && media) media = { ...media, playing: !media.playing };
    else if (verb === "media-next") media = { title: "Next track", artist: "Next artist", playing: true };
    else if (verb === "media-stop") media = null;
    else throw new Error("Unsupported fixture control");
  },
};
const app = await createApp({
  provider, pin: "864213", trustLoopback: false, allowDestructive: false,
  configStore: { load: async () => ({ tiles: [] }) },
});
const fixture = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/state") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const change = JSON.parse(body);
    if (Object.hasOwn(change, "media")) media = change.media;
    if (Object.hasOwn(change, "delayMs")) delayMs = change.delayMs;
    if (Object.hasOwn(change, "fail")) fail = change.fail;
    if (change.resetCounts) { requests = 0; maxActive = active; }
  } else if (req.method !== "GET" || req.url !== "/state") {
    res.writeHead(404).end(); return;
  }
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ media, requests, active, maxActive }));
});
app.server.listen(18623, "127.0.0.1", () => console.log("Media fixture app: http://127.0.0.1:18623 (PIN 864213)"));
fixture.listen(18624, "127.0.0.1", () => console.log("Media fixture control: http://127.0.0.1:18624/state"));
