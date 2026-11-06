/** Selected-file reception. No remote paths, downloads, execution, or automatic retries. */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import { mkdir, open, readFile, lstat, realpath, unlink, link, rename, statfs } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, join, dirname, isAbsolute, extname } from "node:path";
import { privateDirectory } from "./private-store.js";
import { userDir } from "./platform/xdg.js";

export const TRANSFER_LIMITS = Object.freeze({ files: 50, fileBytes: 8 * 1024 ** 3, batchBytes: 32 * 1024 ** 3 });
const ID = /^[a-f0-9]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
const terminal = new Set(["completed", "cancelled", "failed", "interrupted"]);
function publishedName(file, n = 0) {
  const extension = extname(file.name), base = file.name.slice(0, file.name.length - extension.length);
  return n ? `${base} (${n})${extension}` : file.name;
}
function validPublishedName(file) {
  if (!file.finalName || file.finalName === file.name) return true;
  if (typeof file.finalName !== "string") return false;
  const extension = extname(file.name);
  const stem = extension ? file.finalName.slice(0, -extension.length) : file.finalName;
  const suffix = / \(([1-9][0-9]{0,3})\)$/.exec(stem);
  return !!suffix && file.finalName === publishedName(file, Number(suffix[1]));
}
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k));
export function transferName(value) {
  if (typeof value !== "string" || !value || value.length > 1024 || !value.isWellFormed()) throw fail("Invalid filename.");
  let name = value.replace(/[<>:"/\\|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, "_").replace(/^[. ]+|[. ]+$/g, "");
  if (!name || /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:[. ]|$)/i.test(name)) name = "file_" + name;
  const suffix = Array.from(extname(name)).slice(0, 24).join("");
  let stem = name.slice(0, name.length - extname(name).length);
  while (Buffer.byteLength(stem + suffix, "utf8") > 180) stem = Array.from(stem).slice(0, -1).join("");
  name = (stem || "file") + suffix;
  return name;
}
export function transferBatch(value, limits = TRANSFER_LIMITS) {
  if (!exact(value, ["id", "files"]) || !ID.test(value.id) || !Array.isArray(value.files) || !value.files.length || value.files.length > limits.files)
    throw fail("Choose between 1 and 50 files.");
  const ids = new Set(); let total = 0;
  const files = value.files.map(file => {
    if (!exact(file, ["id", "name", "size", "mime"]) || !ID.test(file.id) || ids.has(file.id)) throw fail("Invalid file selection.");
    ids.add(file.id);
    if (file.size !== null && (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > limits.fileBytes)) throw fail("A file exceeds the transfer limit.", 413);
    total += file.size || 0;
    if (typeof file.mime !== "string" || file.mime.length > 127 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(file.mime)) throw fail("Invalid file type.");
    return { id: file.id, name: transferName(file.name), size: file.size, mime: file.mime };
  });
  if (total > limits.batchBytes) throw fail("This selection exceeds the transfer limit.", 413);
  return { id: value.id, files };
}
export function transferError(error) {
  if (error?.status) return error;
  if (["ENOSPC", "EDQUOT"].includes(error?.code)) return fail("The computer has insufficient storage. Free space and retry.", 507);
  if (["EACCES", "EPERM", "EROFS"].includes(error?.code)) return fail("The receive folder is not writable. Check it on the computer.", 503);
  return fail("Transfer interrupted. Check the connection and retry from WinDock.", 503);
}

export async function createTransfers({ stateFile = null, destination = null, limits = TRANSFER_LIMITS,
  diskSpace = async dir => { const s = await statfs(dir); return s.bavail * s.bsize; }, notify = () => {}, now = Date.now } = {}) {
  const defaultDirectory = destination || join(process.platform === "linux" ? await userDir("DOWNLOAD") : join(homedir(), "Downloads"), "WinDock");
  let settings = { enabled: true, destination: resolve(defaultDirectory) }, batches = [];
  let serial = Promise.resolve(), closed = false, privateReady = false;
  const active = new Map(), events = []; let sequence = 0;
  const locked = operation => { const result = serial.then(operation); serial = result.catch(() => {}); return result; };
  const emit = (batch, phase) => {
    const event = { sequence: ++sequence, id: batch.id, phase, count: batch.files.length };
    events.push(event); if (events.length > 100) events.shift();
    try { notify(event); } catch { /* Desktop notifications are best effort. */ }
  };
  async function save() {
    if (!stateFile) return;
    if (!privateReady) { await privateDirectory(dirname(stateFile)); privateReady = true; }
    const temp = stateFile + "." + randomUUID() + ".tmp";
    try {
      const fd = await open(temp, "wx", 0o600);
      try { await fd.writeFile(JSON.stringify({ version: 1, settings, batches })); await fd.sync(); } finally { await fd.close(); }
      await rename(temp, stateFile);
    } finally { await unlink(temp).catch(() => {}); }
  }
  async function directory(path, create = true) {
    if (create) await mkdir(path, { recursive: true });
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail("Choose a real, writable receive folder on the computer.", 409);
    return realpath(path);
  }
  async function staging(batch) {
    if (await directory(batch.directory, false) !== batch.directory) throw fail("The receive folder changed. Retry after checking it on the computer.", 409);
    const dir = join(batch.directory, ".windock-incoming");
    await mkdir(dir, { mode: 0o700 });
    await privateDirectory(dir);
    return directory(dir, false);
  }
  // Only our fixed-ID files are ever removed. Never recursively delete a receive folder.
  const partPath = (batch, file) => join(batch.directory, ".windock-incoming", `${batch.id}-${file.id}.part`);
  async function clean(batch, file) {
    try {
      const dir = join(batch.directory, ".windock-incoming");
      if (!(await lstat(dir)).isSymbolicLink() && await realpath(batch.directory) === batch.directory) await unlink(partPath(batch, file));
    } catch { /* Already absent, or destination no longer safe. */ }
  }
  async function digestFile(path, allowed = () => true) {
    const hash = createHash("sha256"); let bytes = 0;
    const stream = createReadStream(path, { flags: constants.O_RDONLY | (constants.O_NOFOLLOW || 0), highWaterMark: 65536 });
    for await (const chunk of stream) { if(!allowed()) throw fail("Transfer cancelled or authorization removed.",403); bytes += chunk.length; hash.update(chunk); }
    return { bytes, sha256: hash.digest("hex") };
  }
  if (stateFile) {
    try {
      const stat = await lstat(stateFile);
      if (stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw Error("Invalid transfer state");
      const value = JSON.parse(await readFile(stateFile, "utf8"));
      if (value.version !== 1 || typeof value.settings?.enabled !== "boolean" || !isAbsolute(value.settings?.destination || "") || !Array.isArray(value.batches) || value.batches.length > 64) throw Error("Invalid transfer state");
      settings = value.settings;
      for (const batch of value.batches) {
        if (!ID.test(batch.id) || !HASH.test(batch.owner) || !isAbsolute(batch.directory || "") || !Array.isArray(batch.files) || batch.files.length > limits.files) throw Error("Invalid transfer state");
        for (const file of batch.files) {
          if (!ID.test(file.id) || transferName(file.name) !== file.name || !validPublishedName(file)) throw Error("Invalid transfer state");
          if (file.status === "committing" && file.finalName && HASH.test(file.sha256)) {
            try {
              const content = await digestFile(join(batch.directory, file.finalName));
              file.status = content.bytes === file.bytes && content.sha256 === file.sha256 ? "completed" : "interrupted";
            } catch { file.status = "interrupted"; }
          } else if (!terminal.has(file.status)) file.status = "interrupted";
          await clean(batch, file);
        }
        if (now() - batch.created < 86400000) batches.push(batch);
      }
      // Persist recovery and expiry immediately, including when no receipts remain.
      await save();
    } catch (error) { if (error.code !== "ENOENT") throw fail("Saved file-transfer state is unreadable. Check the computer's transfer settings.", 503); }
  }
  function state(batch) {
    const files = batch.files.map(({ id, name, size, bytes = 0, status, error, finalName, sha256 }) =>
      ({ id, name, size, bytes, status, ...(error ? { error } : {}), ...(status === "completed" ? { savedName: finalName, sha256 } : {}) }));
    return { id: batch.id, files, completed: files.every(f => f.status === "completed") };
  }
  function owned(owner, id) {
    const batch = batches.find(b => b.id === id && b.owner === owner);
    if (!batch) throw fail("Transfer not found. Check the computer before selecting files again.", 404);
    return batch;
  }
  function findFile(batch, id) { const file = batch.files.find(f => f.id === id); if (!file) throw fail("File not found.", 404); return file; }
  function finished(batch) {
    if (batch.files.every(f => f.status === "completed")) emit(batch,"completed");
    else if (!batch.failedNotified && batch.files.some(f => ["failed","interrupted"].includes(f.status))) { batch.failedNotified=true; emit(batch,"failed"); }
  }
  const expiry = setInterval(() => locked(async () => {
    let changed=false;
    for (const batch of batches) {
      if (now()-(batch.touched || batch.created)<600000 || batch.files.some(f=>active.has(f.id))) continue;
      for (const file of batch.files) if (!terminal.has(file.status)) {
        file.status="interrupted"; file.error="Transfer expired while inactive. Retry from the phone.";
        await clean(batch,file); changed=true;
      }
    }
    const retained=batches.filter(b=>now()-b.created<86400000 || b.files.some(f=>active.has(f.id)));
    if(retained.length!==batches.length){batches=retained;changed=true;}
    if(changed)await save();
  }).catch(()=>{}),60000);
  expiry.unref?.();
  const info = () => ({ available: true, enabled: settings.enabled, destination: "WinDock receive folder", limits });
  return {
    info,
    local() { return { ...info(), destination: settings.destination, batches: batches.slice(-10).map(state), events: events.slice() }; },
    status(owner, id) { return state(owned(owner, id)); },
    async configure(value) {
      if (!exact(value, ["enabled", "destination"]) || (value.enabled !== undefined && typeof value.enabled !== "boolean") || (value.destination !== undefined && (typeof value.destination !== "string" || value.destination.length > 2048 || !isAbsolute(value.destination) || /[\x00-\x1f]/.test(value.destination)))) throw fail("Invalid receive settings.");
      if (value.destination !== undefined && (active.size || batches.some(b => b.files.some(f => !terminal.has(f.status))))) throw fail("Finish or cancel pending transfers before changing the folder.", 409);
      // Stop reads and disk verification immediately, even while a commit owns the metadata lock.
      if (value.enabled === false) {
        settings.enabled = false;
        for (const batch of batches) for (const file of batch.files) if (!terminal.has(file.status) && file.status !== "committing") {
          file.status = "cancelled"; active.get(file.id)?.destroy();
        }
      }
      return locked(async () => {
      const next = { ...settings };
      if (value.destination !== undefined) next.destination = await directory(resolve(value.destination));
      if (value.enabled !== undefined) next.enabled = value.enabled;
      if (!next.enabled) for (const batch of batches) for (const file of batch.files) {
        if (file.status === "completed" || file.status === "committing") continue;
        file.status = "cancelled";
        const stream = active.get(file.id); if (stream) stream.destroy(); else await clean(batch,file);
      }
      settings = next; await save(); return this.local();
    }); },
    begin(owner, metadata) { return locked(async () => {
      if (closed || !settings.enabled) throw fail("Receiving is disabled on this computer.", 403);
      if (!HASH.test(owner)) throw fail("Pair this phone securely first.", 401);
      const validated = transferBatch(metadata, limits);
      const signature = createHash("sha256").update(JSON.stringify(validated)).digest("hex");
      const existing = batches.find(b => b.id === validated.id);
      if (existing) { if (existing.owner !== owner || existing.signature !== signature) throw fail("Transfer identifier is already used.", 409); return state(existing); }
      batches = batches.filter(b => now() - b.created < 86400000 || b.files.some(f => !terminal.has(f.status)));
      if (batches.length >= 64 || batches.reduce((n,b) => n+b.files.length,0) + validated.files.length > 500) throw fail("The transfer receipt limit is reached. Try again later.", 429);
      if (batches.filter(b => b.files.some(f => !terminal.has(f.status))).length >= 4) throw fail("Other transfers are waiting. Finish or cancel them first.", 429);
      const dir = await directory(settings.destination);
      const total = validated.files.reduce((n,f) => n + (f.size || 0),0);
      if (await diskSpace(dir) < total + 16 * 1024 ** 2) throw fail("The computer has insufficient storage. Free space and retry.", 507);
      const batch = { ...validated, owner, signature, directory: dir, created: now(), files: validated.files.map(f => ({ ...f, status: "ready", bytes: 0 })) };
      batches.push(batch); await save(); emit(batch, "incoming"); return state(batch);
    }); },
    async upload(owner, batchId, fileId, stream, authorized = () => true) {
      stream.setTimeout?.(30000,()=>stream.destroy());
      let batch, file, handle, writing = false, timer, totalTimer;
      try {
        await locked(async () => {
          batch = owned(owner, batchId); file = findFile(batch, fileId);
          if (closed || !settings.enabled || !authorized()) throw fail("Transfer is no longer authorized.", 403);
          if (active.size >= 2 || active.has(fileId)) throw fail("The computer is busy receiving another file.", 429);
          if (!["ready", "failed", "interrupted", "cancelled"].includes(file.status)) throw fail("This file has already been received. Check transfer status.", 409);
          const length = stream.headers?.["content-length"];
          if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > limits.fileBytes || (file.size !== null && Number(length) !== file.size))) throw fail("File size does not match the selection.", 413);
          if (stream.headers?.["content-encoding"] && stream.headers["content-encoding"] !== "identity") throw fail("Encoded uploads are not supported.");
          // mkdir is idempotent, but only after verifying its parent and type.
          try { await staging(batch); } catch (e) { if (e.code !== "EEXIST") throw e; await directory(join(batch.directory, ".windock-incoming"), false); }
          await clean(batch, file);
          handle = await open(partPath(batch,file), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0), 0o600);
          file.status = "sending"; file.bytes = 0; delete file.error; delete file.finalName; delete file.sha256;
          batch.touched = now();
          batch.failedNotified=false;
          active.set(fileId, stream); writing = true; await save();
        });
        const hash = createHash("sha256"); let checked = 0;
        const reset = () => { clearTimeout(timer); timer = setTimeout(() => stream.destroy(fail("Transfer timed out. Retry when the connection is stable.", 408)), 30000); timer.unref?.(); };
        reset(); totalTimer = setTimeout(() => stream.destroy(fail("Transfer exceeded one hour. Try a smaller file.", 408)), 3600000); totalTimer.unref?.();
        for await (const chunk of stream) {
          reset();
          batch.touched = now();
          if (!authorized() || !settings.enabled || closed || file.status !== "sending") throw fail("Transfer cancelled or authorization removed.", 403);
          file.bytes += chunk.length;
          if (file.bytes > limits.fileBytes || (file.size !== null && file.bytes > file.size) || batch.files.reduce((n,f) => n + f.bytes,0) > limits.batchBytes) throw fail("The file exceeds the transfer limit.", 413);
          if (file.bytes - checked >= 8 * 1024 ** 2) { checked = file.bytes; if (await diskSpace(batch.directory) < 16 * 1024 ** 2) throw fail("The computer has insufficient storage. Free space and retry.", 507); }
          hash.update(chunk);
          let offset = 0;
          while (offset < chunk.length) { const result = await handle.write(chunk, offset, chunk.length-offset); if (!result.bytesWritten) throw Error("Write failed"); offset += result.bytesWritten; }
        }
        if (file.size !== null && file.bytes !== file.size) throw fail("The selected file changed size. Select it again.", 409);
        if (!authorized() || file.status !== "sending" || closed) throw fail("Transfer cancelled or authorization removed.", 403);
        await handle.sync(); await handle.close(); handle = null;
        file.sha256 = hash.digest("hex"); file.status = "uploaded";
        await locked(save);
        return { bytes: file.bytes, sha256: file.sha256, status: "uploaded" };
      } catch (error) {
        if (writing) {
          file.status = file.status === "cancelled" ? "cancelled" : "failed"; file.error = transferError(error).message;
          await handle?.close().catch(() => {}); handle = null; await clean(batch,file); await locked(save).catch(() => {}); finished(batch);
        }
        throw transferError(error);
      } finally { clearTimeout(timer); clearTimeout(totalTimer); if (writing) active.delete(fileId); }
    },
    complete(owner, batchId, fileId, value, authorized = () => true) { return locked(async () => {
      const batch = owned(owner,batchId), file = findFile(batch,fileId);
      if (!exact(value,["bytes","sha256"]) || !HASH.test(value.sha256) || !Number.isSafeInteger(value.bytes)) throw fail("Invalid file verification.");
      if (file.status === "completed") {
        if (file.sha256 !== value.sha256 || file.bytes !== value.bytes) throw fail("File verification does not match.",409);
        return state(batch);
      }
      if (!authorized() || closed || !settings.enabled) throw fail("Transfer is no longer authorized.",403);
      if (file.status === "committing" && file.finalName) {
        const published = await digestFile(join(batch.directory,file.finalName)).catch(() => null);
        if (published && published.sha256 === value.sha256 && published.bytes === value.bytes && file.sha256 === value.sha256 && file.bytes === value.bytes) {
          file.status="completed"; await save(); await clean(batch,file); finished(batch); return state(batch);
        }
        throw fail("Completion is uncertain. Check the receive folder on the computer before selecting this file again.",409);
      }
      if (file.status !== "uploaded" || active.has(fileId)) throw fail("Upload the complete file before verification.",409);
      if (file.sha256 !== value.sha256 || file.bytes !== value.bytes) { file.status="failed"; file.error="File verification failed. Select the file again."; await clean(batch,file); await save(); throw fail(file.error,422); }
      if (await directory(batch.directory,false) !== batch.directory) throw fail("The receive folder changed.",409);
      await directory(join(batch.directory,".windock-incoming"),false);
      // The digest also verifies bytes on disk, not just the network stream.
      const allowed=()=>authorized() && !closed && settings.enabled && file.status === "uploaded";
      const actual = await digestFile(partPath(batch,file),allowed);
      if(!allowed()) throw fail("Transfer cancelled or authorization removed.",403);
      if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) throw fail("The received file failed verification.",422);
      for (let n=0;n<10000;n++) {
        const name = publishedName(file,n);
        if (!authorized()) throw fail("Pairing was removed.",403);
        file.status="committing"; file.finalName=name; await save();
        if (!authorized() || closed || !settings.enabled) {
          file.status="cancelled"; delete file.finalName; await clean(batch,file); await save();
          throw fail("Transfer cancelled or authorization removed.",403);
        }
        try {
          // Hard-link publication is atomic and never replaces an existing name.
          await link(partPath(batch,file),join(batch.directory,name));
        } catch (e) { if (e.code === "EEXIST") continue; file.status="uploaded"; delete file.finalName; await save(); throw transferError(e); }
        // Keep a recoverable committing receipt if saving completion fails after publication.
        try { file.status="completed"; await save(); }
        catch (error) { file.status="committing"; throw transferError(error); }
        await clean(batch,file); finished(batch); return state(batch);
      }
      file.status="uploaded"; delete file.finalName; await save(); throw fail("Too many files have this name. Rename the selection.",409);
    }); },
    cancel(owner, id) {
      const batch=owned(owner,id);
      // Cancel a streaming read/hash immediately, without waiting for disk verification's lock.
      for(const file of batch.files) if(!terminal.has(file.status) && file.status!=="committing") {
        file.status="cancelled"; active.get(file.id)?.destroy();
      }
      return locked(async () => {
      for (const file of batch.files) {
        if (file.status === "completed" || file.status === "committing") continue;
        file.status="cancelled"; delete file.error;
        const stream=active.get(file.id); if (stream) stream.destroy(); else await clean(batch,file);
      }
      await save(); emit(batch,"cancelled"); return state(batch);
    }); },
    cancelLocal(id) { const batch=batches.find(b=>b.id===id); if (!batch) throw fail("Transfer not found.",404); return this.cancel(batch.owner,id); },
    async openDirectory() { return directory(settings.destination); },
    async close() { closed=true; clearInterval(expiry); for (const stream of active.values()) stream.destroy(); await serial; },
  };
}
