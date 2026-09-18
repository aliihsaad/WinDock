// Small, consistent UI symbols. Application artwork comes from Windows.
const paths = {
  camera: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="m8 6 1-3h6l1 3"/><circle cx="12" cy="13" r="4"/>',
  record: '<rect x="2" y="5" width="14" height="14" rx="3"/><path d="m16 10 6-4v12l-6-4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="3"/><path d="M8 21h8m-4-4v4"/>',
  sliders: '<path d="M5 3v7m0 4v7M12 3v12m0 4v2M19 3v2m0 4v12M2 10h6m1 5h6m1-10h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L20 8a3.5 3.5 0 0 0-5-5L4 14z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  left: '<path d="m14 6-6 6 6 6"/>',
  right: '<path d="m10 6 6 6-6 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  volume: '<path d="m11 4-6 5H2v6h3l6 5zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  quieter: '<path d="m11 4-6 5H2v6h3l6 5zM16 12h6"/>',
  mute: '<path d="m11 4-6 5H2v6h3l6 5zM17 9l5 6m0-6-5 6"/>',
  play: '<path d="m7 4 14 8-14 8z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  next: '<path d="m4 5 11 7-11 7zM19 5v14"/>',
  previous: '<path d="m20 5-11 7 11 7zM5 5v14"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  moon: '<path d="M20.5 14A9 9 0 0 1 10 3a9 9 0 1 0 10.5 11z"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  power: '<path d="M12 2v9m-6-6a9 9 0 1 0 12 0"/>',
  music: '<path d="M9 18V5l12-2v13M9 9l12-2"/><ellipse cx="5.5" cy="18" rx="3.5" ry="3"/><ellipse cx="17.5" cy="16" rx="3.5" ry="3"/>',
  wifi: '<path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0m-11 4a6 6 0 0 1 8 0M12 20h.01"/>',
};

export function icon(name, className = "") {
  return `<svg class="icon ${className}" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.grid}</svg>`;
}

export function controlIcon(verb) {
  return icon({ "volume-up": "volume", "volume-down": "quieter", "volume-set": "volume", "mute-toggle": "mute", "media-play-pause": "play", "media-next": "next", "media-previous": "previous", "media-stop": "stop", "brightness-set": "sun", lock: "lock", sleep: "moon", shutdown: "power", restart: "refresh" }[verb]);
}
