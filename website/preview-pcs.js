// Fictional PCs only. This model has no network or persistent storage access.
export const SAMPLE_PCS = Object.freeze([
  Object.freeze({ id: 'studio', name: 'Studio PC', platform: 'Windows', platformId: 'windows', address: '192.0.2.10:8620', online: true }),
  Object.freeze({ id: 'omarchy', name: 'Omarchy', platform: 'Linux · Hyprland', platformId: 'linux', address: '192.0.2.20:8620', online: true }),
  Object.freeze({ id: 'travel', name: 'Travel laptop', platform: 'Windows', platformId: 'windows', address: '192.0.2.30:8620', online: false }),
]);

export function createPreviewPcs() {
  let currentId = 'studio';
  const saved = new Set(['studio', 'travel']);
  return {
    current: () => SAMPLE_PCS.find(pc => pc.id === currentId),
    list: () => SAMPLE_PCS.filter(pc => pc.online || saved.has(pc.id)).map(pc => ({ ...pc, current: pc.id === currentId, saved: saved.has(pc.id) })),
    select(id) {
      const pc = SAMPLE_PCS.find(pc => pc.id === id);
      if (!pc?.online) return false;
      currentId = pc.id;
      saved.add(id);
      return true;
    },
    forget(id) {
      // Forget removes the remembered choice, not a running PC's availability.
      // Like the app, it does not terminate an already open connection.
      return saved.delete(id);
    },
  };
}
