import assert from 'node:assert/strict';
import { fetchDownloadCounts } from '../lib/github-downloads.js';
import { GET } from '../api/download-stats.js';

const asset = (name, download_count) => ({ name, download_count });
const release = (assets, draft = false) => ({ draft, prerelease: true, assets });
const json = (body, headers = {}) => Response.json(body, { headers });
const pages = [
  json([
    release([asset('WinDockSetup.exe', 305), asset('WinDock-android-debug.apk', 259), asset('WinDock-linux-x64.pkg.tar.zst', 7), asset('SHA256SUMS.txt', 400), asset('SHA256SUMS-linux.txt', 50)]),
    release([asset('WinDockSetup.exe', 999)], true),
  ], { link: '<https://api.github.com/repos/aliihsaad/WinDock/releases?per_page=100&page=2>; rel="next"' }),
  json([release([asset('WinDockSetup.exe', 284), asset('WinDock-android-debug.apk', 553), asset('WinDock-linux-amd64.deb', 3)])]),
];
const urls = [];
const counts = await fetchDownloadCounts(async url => { urls.push(url); return pages.shift(); });
// Both Linux packages count as Linux; checksum files count as nothing.
assert.deepEqual([counts.windows, counts.android, counts.linux, counts.total], [589, 812, 10, 1411]);
assert.deepEqual(urls, [1, 2].map(page => `https://api.github.com/repos/aliihsaad/WinDock/releases?per_page=100&page=${page}`));
assert.ok(Number.isFinite(Date.parse(counts.updatedAt)));
assert.equal((await fetchDownloadCounts(async () => json([]))).total, 0);
await assert.rejects(() => fetchDownloadCounts(async () => new Response('', { status: 403 })), /request failed/);
await assert.rejects(() => fetchDownloadCounts(async () => json({ message: 'rate limit' })), /Invalid/);
await assert.rejects(() => fetchDownloadCounts(async () => json([release([asset('WinDockSetup.exe', -1)])])), /Invalid/);
let calls = 0;
await assert.rejects(() => fetchDownloadCounts(async () => {
  if (calls++) return new Response('', { status: 502 });
  return json([release([asset('WinDockSetup.exe', 12)])], { link: '<unused>; rel="next"' });
}), /request failed/);
await assert.rejects(() => fetchDownloadCounts(async () => json([], { link: '<unused>; rel="next"' })), /pagination limit/);
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => json([release([asset('WinDockSetup.exe', 12)])]);
  const ok = await GET();
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('cache-control'), /s-maxage=3600/);
  assert.equal((await ok.json()).total, 12);
  globalThis.fetch = async () => { throw new Error('offline'); };
  const failed = await GET();
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get('cache-control'), 'no-store');
  assert.equal((await failed.json()).total, undefined);
} finally { globalThis.fetch = originalFetch; }
console.log('15 assertions\ndownload-stats verification passed');
