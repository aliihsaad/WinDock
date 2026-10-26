import { randomUUID } from 'node:crypto';
import { open, mkdir, writeFile, link, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

const VALID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function readIdentity(path) {
  const file = await open(path, 'r');
  try {
    const bytes = Buffer.alloc(64);
    const { bytesRead } = await file.read(bytes);
    const existing = bytes.subarray(0, bytesRead).toString('utf8').trim();
    return VALID_ID.test(existing) ? existing : null;
  } finally { await file.close(); }
}

/** Public discovery identity, separate from configuration and pairing credentials. */
export async function hostIdentity(configPath) {
  const fresh = randomUUID();
  if (typeof configPath !== 'string' || !configPath) return fresh;
  const path = `${configPath}.host-id`;
  try {
    try { return (await readIdentity(path)) || fresh; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${fresh}.tmp`;
    try {
      await writeFile(temporary, `${fresh}\n`, { flag: 'wx' });
      // Publish the complete file without replacing another process's identity.
      try { await link(temporary, path); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      return (await readIdentity(path)) || fresh;
    } finally { await unlink(temporary).catch(() => {}); }
  } catch { /* Read-only installations still work, with an identity for this run. */ }
  return fresh;
}
