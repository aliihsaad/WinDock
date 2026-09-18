// Cache extraction results and share concurrent requests. The queue prevents a
// large library from starting one native process per visible image at once.
export function createIconCache(provider) {
  const cache = new Map();
  const waiting = [];
  let active = 0;
  const pump = () => {
    while (active < 3 && waiting.length) {
      active++;
      const { app, resolve } = waiting.shift();
      Promise.resolve().then(() => provider.appIcon?.(app)).catch(() => null)
        .then(resolve).finally(() => { active--; pump(); });
    }
  };
  return (app) => {
    const key = JSON.stringify([app.target, app.icon]);
    if (!cache.has(key)) {
      if (cache.size >= 512) cache.delete(cache.keys().next().value);
      const result = new Promise((resolve) => waiting.push({ app, resolve }));
      cache.set(key, result);
      pump();
    }
    return cache.get(key);
  };
}

export const FALLBACK_ICON = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect x="12" y="12" width="72" height="72" rx="19" fill="#273544"/><g fill="none" stroke="#b6c8d6" stroke-width="4"><rect x="28" y="28" width="14" height="14" rx="3"/><rect x="54" y="28" width="14" height="14" rx="3"/><rect x="28" y="54" width="14" height="14" rx="3"/><rect x="54" y="54" width="14" height="14" rx="3"/></g></svg>');
