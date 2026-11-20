/** Pointer-independent gestures; cancellation never generates a click. */
const SWIPE_DISTANCE = 40, TAP_DRAG_WINDOW = 350, TAP_DRAG_RADIUS = 40;
export class TouchpadGestures {
  constructor({ move, scroll, zoom, click, swipe = () => {}, multiTap = () => {}, dragStart = () => {}, dragEnd = () => {}, dragging = () => false, now = () => performance.now() }) {
    Object.assign(this, { move, scroll, zoom, click, swipe, multiTap, dragStart, dragEnd, dragging, now }); this.lastTap = null; this.reset();
  }
  reset() { this.endTapDrag(); this.points = new Map(); this.sequence = null; this.pair = null; }
  endTapDrag() { const s = this.sequence; if (s?.held) { s.held = false; this.dragEnd(); } if (s) s.tapDrag = false; }
  geometry() {
    const [a, b] = this.points.values();
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, span: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)) };
  }
  centroid() {
    let x = 0, y = 0;
    for (const p of this.points.values()) { x += p.x; y += p.y; }
    return { x: x / this.points.size, y: y / this.points.size };
  }
  down(id, x, y) {
    if (!this.points.size) {
      this.sequence = { start: this.now(), maximum: 0, distance: 0, frozen: false, cancelled: false, tapDrag: false, held: false, swiped: false, origin: null };
      // Tap, then touch again and move: hold the button down so the pointer drags.
      const last = this.lastTap;
      if (last && this.now() - last.time < TAP_DRAG_WINDOW && Math.hypot(x - last.x, y - last.y) < TAP_DRAG_RADIUS && !this.dragging()) {
        this.sequence.tapDrag = true;
      }
      this.lastTap = null;
    }
    this.points.set(id, { x, y, startX: x, startY: y });
    this.sequence.maximum = Math.max(this.sequence.maximum, this.points.size);
    if (this.points.size === 2) {
      this.endTapDrag();
      const origin = this.geometry();
      this.pair = { origin, previous: origin, anchor: origin.span, mode: null, changed: new Set(), waiting: null };
    }
    if (this.points.size > 2) { this.sequence.frozen = true; this.sequence.origin = this.centroid(); }
  }
  update(id, x, y) {
    const point = this.points.get(id), sequence = this.sequence;
    if (!point || !sequence) return;
    const dx = x - point.x, dy = y - point.y;
    sequence.distance = Math.max(sequence.distance, Math.hypot(x - point.startX, y - point.startY));
    point.x = x; point.y = y;
    if (sequence.frozen) { this.trackSwipe(); return; }
    // The button goes down only once the finger really moves, so a quick second tap stays a plain click.
    if (sequence.tapDrag && !sequence.held && sequence.distance > 4) { sequence.held = true; this.dragStart(); }
    if (this.points.size === 1) this.move(dx, dy);
    else if (this.points.size === 2 && (dx || dy)) this.pair.changed.add(id);
  }
  // Three or four fingers moving together make one swipe per touch, in the dominant direction.
  trackSwipe() {
    const s = this.sequence;
    if (!s.origin || s.swiped || this.points.size < 3) return;
    const c = this.centroid(), dx = c.x - s.origin.x, dy = c.y - s.origin.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_DISTANCE) return;
    s.swiped = true;
    const direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
    this.swipe(direction, this.points.size);
  }
  // Sample both fingers together once per animation frame. Pointer events arrive
  // separately; classifying each event can mistake a parallel slide for a pinch.
  flush() {
    if (this.points.size !== 2 || this.sequence.frozen || this.dragging()) return false;
    const pair = this.pair, current = this.geometry();
    if (!pair.mode) {
      const travel = Math.hypot(current.x - pair.origin.x, current.y - pair.origin.y);
      const stretch = Math.abs(current.span - pair.origin.span);
      if (travel < 6 && stretch < 10) return false;
      pair.waiting ??= this.now();
      // A stationary finger is a valid pinch, but allow staggered events to catch up.
      if (pair.changed.size < 2 && this.now() - pair.waiting < 48) return true;
      if (stretch >= 10 && stretch > travel * 1.3) pair.mode = "zoom";
      else if (travel >= 6 && travel > stretch * .7) pair.mode = "scroll";
      else return false;
    }
    if (pair.mode === "scroll") {
      const dx = current.x - pair.previous.x, dy = current.y - pair.previous.y;
      if (dx || dy) this.scroll(dx, dy);
    } else {
      const steps = Math.max(-8, Math.min(8, Math.trunc(Math.log(current.span / pair.anchor) / Math.log(1.1))));
      if (steps) { this.zoom(steps); pair.anchor = current.span; }
    }
    pair.previous = current;
    return false;
  }
  up(id, cancelled = false) {
    if (!cancelled) this.flush();
    const lifted = this.points.get(id);
    if (!this.points.delete(id)) return;
    this.sequence.cancelled ||= cancelled;
    if (this.points.size) { this.sequence.frozen = true; return; }
    const s = this.sequence, quick = this.now() - s.start < 300 && s.distance < 8;
    this.endTapDrag();
    if (!s.cancelled && !this.pair?.mode && s.maximum <= 2 && quick && !this.dragging()) {
      const button = s.maximum === 2 ? "right" : "left";
      this.click(button);
      if (button === "left") this.lastTap = { time: this.now(), x: lifted.x, y: lifted.y };
    } else if (!s.cancelled && !s.swiped && s.maximum >= 3 && quick && !this.dragging()) {
      this.multiTap(Math.min(4, s.maximum));
    }
    this.reset();
  }
}
