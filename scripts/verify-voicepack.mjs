import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import { createVoicePack, pcmToWav, unsafeEntry, parsePackManifest, MAX_AUDIO_BYTES } from "../src/voicepack.js";
const t = createChecker("voicepack");

// Fake pack: shell scripts standing in for whisper-cli and piper (POSIX only; CI for Windows is not needed here).
const src = mkdtempSync(join(tmpdir(), "vp-src-"));
mkdirSync(join(src, "whisper")); mkdirSync(join(src, "piper"));
writeFileSync(join(src, "whisper", "whisper-cli"), "#!/bin/sh\nif [ -n \"$SLOW\" ]; then sleep 5; fi\necho ' [00:00] hello dock  (music)'\n");
writeFileSync(join(src, "whisper", "model.bin"), "m");
writeFileSync(join(src, "piper", "piper"), "#!/bin/sh\nwhile [ $# -gt 0 ]; do [ \"$1\" = --output_file ] && out=$2; shift; done\ncat > /dev/null\nprintf RIFFfakewav > \"$out\"\n");
writeFileSync(join(src, "piper", "voice.onnx"), "v");
for (const f of ["whisper/whisper-cli", "piper/piper"]) chmodSync(join(src, f), 0o755);
const zipPath = join(mkdtempSync(join(tmpdir(), "vp-zip-")), "pack.zip");
execFileSync("zip", ["-qr", zipPath, "whisper", "piper"], { cwd: src });
const zip = readFileSync(zipPath);
const sha = createHash("sha256").update(zip).digest("hex");

const MANI = "https://github.com/yeshwanthkumardomala/WinDock/releases/download/voicepack-v1/voicepack.json";
const PACK = "https://github.com/yeshwanthkumardomala/WinDock/releases/download/voicepack-v1/pack.zip";
const mk = (over = {}) => async (url) => {
  if (url === MANI) return new Response(JSON.stringify({ version: "1", pack: { url: PACK, sha256: over.sha ?? sha, size: over.size ?? zip.length } }));
  if (url === PACK) return new Response(over.body ?? zip);
  return new Response("no", { status: 404 });
};
const unzipList = async (a) => execFileSync("unzip", ["-Z1", a]).toString().split("\n").filter(Boolean);
const unzipExtract = async (a, d) => { execFileSync("unzip", ["-qo", a, "-d", d]); };
const make = (over = {}, extra = {}) => createVoicePack({ dir: mkdtempSync(join(tmpdir(), "vp-")), fetchImpl: mk(over), listArchive: unzipList, extractArchive: unzipExtract, platform: "linux", ...extra });

// pure helpers
t.ok(unsafeEntry("../x") && unsafeEntry("/etc/x") && unsafeEntry("C:\\x") && unsafeEntry("a/../../b") && !unsafeEntry("whisper/model.bin"), "unsafe archive entries are spotted");
t.equal(pcmToWav(Buffer.alloc(10)).length, 54, "wav header is 44 bytes");
t.throws(() => parsePackManifest({ pack: { url: PACK, sha256: "zz", size: 1 } }), "bad manifest hash rejected");

// install, status, transcribe, speak
const vp = make();
t.deepEqual([vp.status().installed, vp.status().stt], [false, false], "starts empty");
t.equal((await vp.transcribe(Buffer.alloc(8000)).catch((e) => e)).status, 409, "no pack, no transcription");
const done = await vp.install();
t.ok(done.installed && !done.error && done.progress === 100, "pack installs: " + JSON.stringify(done));
t.equal(await vp.transcribe(Buffer.alloc(16000)), "hello dock", "whisper text is cleaned of noises");
t.equal((await vp.transcribe(Buffer.alloc(10)).catch((e) => e)).status, 400, "tiny clip refused");
t.equal((await vp.transcribe(Buffer.alloc(MAX_AUDIO_BYTES + 2)).catch((e) => e)).status, 400, "long clip refused");
const w1 = await vp.speak("Hello there"); const w2 = await vp.speak("Hello there");
t.ok(w1.toString().startsWith("RIFF") && w1 === w2, "speech is produced once and cached");
t.equal((await vp.speak("  ").catch((e) => e)).status, 400, "empty speech refused");

// failures never install
for (const [name, over] of [["wrong hash", { sha: "0".repeat(64) }], ["wrong size", { size: zip.length + 5 }], ["corrupt body", { body: Buffer.from("junk") }]]) {
  const bad = make(over); const s = await bad.install();
  t.ok(!s.installed && s.error, "refused: " + name);
}
const evil = make({}, { listArchive: async () => ["whisper/../../evil"] }); const es = await evil.install();
t.ok(!es.installed && es.error.includes("unsafe"), "zip-slip entries refused");
const offline = createVoicePack({ dir: mkdtempSync(join(tmpdir(), "vp-")), fetchImpl: async () => new Response("", { status: 404 }) });
t.ok((await offline.install()).error.includes("not published"), "missing release says so plainly");

// busy queue and timeout
process.env.SLOW = "1";
const slow = make({}, { sttTimeoutMs: 300 }); await slow.install();
t.equal((await slow.transcribe(Buffer.alloc(16000)).catch((e) => e)).status, 504, "slow engine is stopped");
const calls = [1, 2, 3, 4].map(() => slow.transcribe(Buffer.alloc(16000)).catch((e) => e.status));
const results = await Promise.all(calls);
t.ok(results.includes(429), "excess requests are turned away: " + results);
delete process.env.SLOW;

// remove
const removed = await vp.remove();
t.ok(!removed.installed && !existsSync(vp.paths.whisper), "pack can be removed");
t.done("voicepack verification passed");
