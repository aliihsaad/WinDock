// Cache extraction results and share concurrent requests. The queue prevents a
// large library from starting one native process per visible image at once.
export function createIconCache(provider, { now = Date.now, retryAfterMs = 5000 } = {}) {
  const cache = new Map();
  const waiting = [];
  let active = 0;
  const pump = () => {
    while (active < 3 && waiting.length) {
      active++;
      const { app, resolve, entry } = waiting.shift();
      Promise.resolve().then(() => provider.appIcon?.(app)).catch(() => null)
        .then((png) => {
          // A helper restart or temporary extraction failure must not replace
          // an app's real icon for the rest of the host session. Briefly back
          // off missing resources, then allow the next request to try again.
          if (!png) entry.retryAt = now() + retryAfterMs;
          resolve(png || null);
        }).finally(() => { active--; pump(); });
    }
  };
  return (app) => {
    const key = JSON.stringify([app.target, app.icon]);
    if (cache.has(key) && now() >= cache.get(key).retryAt) cache.delete(key);
    if (!cache.has(key)) {
      if (cache.size >= 512) cache.delete(cache.keys().next().value);
      const entry = { retryAt: Infinity };
      entry.promise = new Promise((resolve) => waiting.push({ app, resolve, entry }));
      cache.set(key, entry);
      pump();
    }
    return cache.get(key).promise;
  };
}

const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Providers return PNG (Windows, most Linux themes) or SVG (scalable Linux themes). */
export function iconType(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) return null;
  if (bytes.subarray(0, 8).equals(PNG_MAGIC)) return "image/png";
  return /<svg[\s>]/i.test(bytes.subarray(0, 4096).toString("utf8")) ? "image/svg+xml" : null;
}

export const FALLBACK_ICON =Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect x="12" y="12" width="72" height="72" rx="19" fill="#273544"/><g fill="none" stroke="#b6c8d6" stroke-width="4"><rect x="28" y="28" width="14" height="14" rx="3"/><rect x="54" y="28" width="14" height="14" rx="3"/><rect x="28" y="54" width="14" height="14" rx="3"/><rect x="54" y="54" width="14" height="14" rx="3"/></g></svg>');
