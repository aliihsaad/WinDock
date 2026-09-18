// Explicit hardware check; never run by npm test. Captures stay on this PC.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createWindowsCapture } from "../src/platform/capture.js";

const helperPath = resolve(process.argv[2] || "artifacts/capture-fix/WinDockHelper.exe");
const capture = createWindowsCapture({ helperPath });
try {
  const screenshot = (await capture.screenshot()).lastCapture;
  const png = await readFile(screenshot.path);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.ok(png.readUInt32BE(16) > 100);
  console.log(`Screenshot saved: ${png.readUInt32BE(16)} × ${png.readUInt32BE(20)}, ${png.length} bytes`);
  const started = await capture.start();
  assert.equal(started.phase, "recording");
  assert.equal((await capture.start()).startedAt, started.startedAt, "start is idempotent");
  await delay(3200);
  const stopped = await capture.stop();
  assert.equal(stopped.phase, "idle");
  const mp4 = await readFile(stopped.lastCapture.path);
  const boxes = [];
  for (let i = 0; i + 8 <= mp4.length;) {
    const size = mp4.readUInt32BE(i);
    boxes.push(mp4.toString("ascii", i + 4, i + 8));
    assert.ok(size >= 8 && i + size <= mp4.length, "valid MP4 box");
    i += size;
  }
  assert.ok(boxes.includes("ftyp") && boxes.includes("moov") && boxes.includes("mdat"), "finalized MP4");
  assert.ok(mp4.includes(Buffer.from("vide")), "video track");
  assert.ok(!mp4.includes(Buffer.from("soun")), "no audio track");
  console.log(`Recording saved: ${mp4.length} bytes; finalized MP4, video only`);
  console.log(JSON.stringify({ screenshot: screenshot.path, recording: stopped.lastCapture.path }));
  console.log("CAPTURE OK");
} finally { await capture.dispose(); }
