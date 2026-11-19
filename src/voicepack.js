/**
 * Optional PC "voice pack": Whisper (speech to text) and Piper (natural voice).
 * Downloaded on demand from the fork's release, checked by SHA-256, and only ever run
 * for one request at a time, at low priority, with a hard timeout. Nothing here stays
 * running between requests, so an idle PC pays nothing for it.
 */
import { createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import os from "node:os";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { fetchAsset } from "./updates.js";

export const PACK_MANIFEST_URL = "https://github.com/yeshwanthkumardomala/WinDock/releases/download/voicepack-v1/voicepack.json";
export const MAX_AUDIO_BYTES = 16000 * 2 * 8;   // 8 seconds of 16 kHz mono PCM16
export const MAX_SPEECH_CHARS = 300;
const MAX_PACK_BYTES = 400 * 1024 * 1024;
const MAX_QUEUE = 2;
const CACHE_SIZE = 20;
const execFileP = promisify(execFile);

const fail = (message, status = 400) => Object.assign(new Error(message), { status, exposed: true });

/** 16 kHz mono PCM16 wrapped as a WAV file, which is what whisper-cli reads. */
export function pcmToWav(pcm, rate = 16000) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Entry names that could write outside the target folder. */
export function unsafeEntry(name) {
  const n = String(name).replace(/\\/g, "/");
  return n.startsWith("/") || /^[A-Za-z]:/.test(n) || n.split("/").includes("..") || n.includes("\0");
}

export function parsePackManifest(manifest) {
  const pack = manifest?.pack;
  if (!pack || typeof pack.url !== "string" || !/^[0-9a-f]{64}$/i.test(pack.sha256 || "")
    || !Number.isInteger(pack.size) || pack.size <= 0 || pack.size > MAX_PACK_BYTES) throw fail("The voice pack manifest is not valid.", 502);
  return { version: String(manifest.version || "1"), url: pack.url, sha256: pack.sha256.toLowerCase(), size: pack.size };
}

async function defaultList(archive) {
  const { stdout } = await execFileP("tar", ["-tf", archive], { maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  return stdout.split(/\r?\n/).filter(Boolean);
}
async function defaultExtract(archive, target) {
  await execFileP("tar", ["-xf", archive, "-C", target], { windowsHide: true, timeout: 5 * 60 * 1000 });
}

export function createVoicePack({
  dir, fetchImpl = fetch, manifestUrl = PACK_MANIFEST_URL, spawnImpl = spawn,
  listArchive = defaultList, extractArchive = defaultExtract, platform = process.platform,
  sttTimeoutMs = 20000, ttsTimeoutMs = 20000, threads = 3,
} = {}) {
  if (!dir) throw new Error("A voice pack folder is required.");
  const root = resolve(dir);
  const exe = (name) => name + (platform === "win32" ? ".exe" : "");
  const paths = {
    whisper: join(root, "whisper", exe("whisper-cli")),
    whisperModel: join(root, "whisper", "model.bin"),
    piper: join(root, "piper", exe("piper")),
    piperModel: join(root, "piper", "voice.onnx"),
  };
  const state = { installing: false, progress: 0, error: "" };
  let busy = false, waiting = 0;
  const queue = [];
  const cache = new Map();

  const hasStt = () => existsSync(paths.whisper) && existsSync(paths.whisperModel);
  const hasTts = () => existsSync(paths.piper) && existsSync(paths.piperModel);
  const status = () => ({ installed: hasStt() && hasTts(), stt: hasStt(), tts: hasTts(), installing: state.installing, progress: state.progress, error: state.error });

  // One heavy job at a time. A second caller waits briefly; a third is told to try again.
  async function exclusive(task) {
    if (waiting >= MAX_QUEUE) throw fail("The PC is still busy with the last request.", 429);
    waiting++;
    await new Promise((go) => { if (!busy) go(); else queue.push(go); });
    waiting--; busy = true;
    try { return await task(); }
    finally { busy = false; const next = queue.shift(); if (next) next(); }
  }

  function run(command, args, { input, timeoutMs, cwd }) {
    return new Promise((resolveRun, reject) => {
      let out = "", errText = "", done = false;
      const child = spawnImpl(command, args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      const finish = (fn, value) => { if (done) return; done = true; clearTimeout(timer); fn(value); };
      const timer = setTimeout(() => { try { child.kill(); } catch {} finish(reject, fail("The voice engine took too long.", 504)); }, timeoutMs);
      // Keep the PC responsive: run below normal priority. Not fatal if the OS refuses.
      try { if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
      child.stdout?.on("data", (d) => { if (out.length < 200000) out += d; });
      child.stderr?.on("data", (d) => { if (errText.length < 20000) errText += d; });
      child.once("error", () => finish(reject, fail("The voice engine could not start.", 500)));
      child.once("close", (code) => code === 0 ? finish(resolveRun, out) : finish(reject, fail("The voice engine failed.", 500)));
      if (input !== undefined) child.stdin?.end(input); else child.stdin?.end();
    });
  }

  async function transcribe(pcm) {
    if (!hasStt()) throw fail("Install the voice pack first.", 409);
    if (!Buffer.isBuffer(pcm) || pcm.length < 3200 || pcm.length > MAX_AUDIO_BYTES || pcm.length % 2) throw fail("That audio clip is not usable.", 400);
    return exclusive(async () => {
      await mkdir(join(root, "tmp"), { recursive: true });
      const wav = join(root, "tmp", `in-${process.pid}-${Date.now()}.wav`);
      await writeFile(wav, pcmToWav(pcm));
      try {
        const out = await run(paths.whisper, ["-m", paths.whisperModel, "-f", wav, "-t", String(threads), "-nt", "-np", "-l", "en"], { timeoutMs: sttTimeoutMs });
        return out.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
      } finally { await rm(wav, { force: true }); }
    });
  }

  async function speak(text) {
    if (!hasTts()) throw fail("Install the voice pack first.", 409);
    const clean = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_SPEECH_CHARS);
    if (!clean) throw fail("Nothing to say.", 400);
    if (cache.has(clean)) { const hit = cache.get(clean); cache.delete(clean); cache.set(clean, hit); return hit; }
    const wav = await exclusive(async () => {
      await mkdir(join(root, "tmp"), { recursive: true });
      const file = join(root, "tmp", `out-${process.pid}-${Date.now()}.wav`);
      try {
        await run(paths.piper, ["--model", paths.piperModel, "--output_file", file], { input: clean + "\n", timeoutMs: ttsTimeoutMs, cwd: join(root, "piper") });
        return await readFile(file);
      } finally { await rm(file, { force: true }); }
    });
    cache.set(clean, wav);
    while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
    return wav;
  }

  async function install() {
    if (state.installing) return status();
    state.installing = true; state.progress = 0; state.error = "";
    const work = join(root, "download");
    try {
      await rm(work, { recursive: true, force: true });
      await mkdir(work, { recursive: true });
      const manifestRes = await fetchAsset(manifestUrl, { fetchImpl, headers: { "user-agent": "WinDock" } });
      if (!manifestRes.ok) throw fail("The voice pack is not published yet.", 502);
      const info = parsePackManifest(await manifestRes.json());
      state.progress = 2;
      const res = await fetchAsset(info.url, { fetchImpl, headers: { "user-agent": "WinDock" } });
      if (!res.ok || !res.body) throw fail("Could not download the voice pack.", 502);
      const archive = join(work, "pack.zip");
      const hash = createHash("sha256");
      let size = 0;
      const meter = async function* (stream) {
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > info.size) throw fail("The voice pack is larger than expected.", 502);
          hash.update(chunk); state.progress = Math.min(90, 2 + Math.floor((size / info.size) * 88));
          yield chunk;
        }
      };
      await pipeline(Readable.fromWeb(res.body), meter, createWriteStream(archive));
      if (size !== info.size || hash.digest("hex") !== info.sha256) throw fail("The voice pack failed its integrity check.", 502);
      const entries = await listArchive(archive);
      if (!entries.length || entries.some(unsafeEntry)) throw fail("The voice pack contains unsafe files.", 502);
      const staging = join(work, "files");
      await mkdir(staging, { recursive: true });
      await extractArchive(archive, staging);
      state.progress = 95;
      const probe = (...p) => existsSync(join(staging, ...p));
      if (!probe("whisper", exe("whisper-cli")) || !probe("whisper", "model.bin") || !probe("piper", exe("piper")) || !probe("piper", "voice.onnx")) throw fail("The voice pack is incomplete.", 502);
      for (const part of ["whisper", "piper"]) {
        await rm(join(root, part), { recursive: true, force: true });
        await rename(join(staging, part), join(root, part));
      }
      await writeFile(join(root, "version.txt"), info.version);
      state.progress = 100;
    } catch (error) {
      state.error = error.exposed ? error.message : "The voice pack could not be installed.";
    } finally {
      state.installing = false;
      await rm(work, { recursive: true, force: true }).catch(() => {});
    }
    return status();
  }

  async function remove() {
    if (state.installing) throw fail("Wait for the install to finish.", 409);
    for (const part of ["whisper", "piper", "tmp"]) await rm(join(root, part), { recursive: true, force: true });
    await rm(join(root, "version.txt"), { force: true });
    cache.clear(); state.error = ""; state.progress = 0;
    return status();
  }

  return { status, install, remove, transcribe, speak, paths };
}
