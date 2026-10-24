const releasesUrl = 'https://api.github.com/repos/aliihsaad/WinDock/releases';
const platforms = new Map([
  ['WinDockSetup.exe', 'windows'],
  ['WinDock-android-debug.apk', 'android'],
  ['WinDock-linux-x64.pkg.tar.zst', 'linux'],
  ['WinDock-linux-amd64.deb', 'linux'],
]);

export async function fetchDownloadCounts(fetcher = fetch) {
  const counts = { windows: 0, android: 0, linux: 0 };
  const signal = AbortSignal.timeout(8000);
  // Never publish a partial total if pagination or GitHub fails.
  for (let page = 1; page <= 10; page++) {
    const response = await fetcher(`${releasesUrl}?per_page=100&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'WinDock-website', 'X-GitHub-Api-Version': '2022-11-28' },
      signal,
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`GitHub release request failed (${response.status})`);
    const releases = await response.json();
    if (!Array.isArray(releases)) throw new Error('Invalid GitHub release response');
    for (const release of releases) {
      if (release.draft) continue;
      if (!Array.isArray(release.assets)) throw new Error('Missing release assets');
      for (const asset of release.assets) {
        const platform = platforms.get(asset.name);
        if (!platform) continue;
        if (!Number.isSafeInteger(asset.download_count) || asset.download_count < 0) throw new Error('Invalid download count');
        counts[platform] += asset.download_count;
      }
    }
    if (!response.headers.get('link')?.includes('rel="next"')) {
      const total = counts.windows + counts.android + counts.linux;
      if (!Number.isSafeInteger(total)) throw new Error('Download total out of range');
      return { ...counts, total, updatedAt: new Date().toISOString() };
    }
  }
  throw new Error('Release pagination limit exceeded');
}
