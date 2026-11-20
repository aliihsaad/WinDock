/**
 * Live backgrounds: small canvas animations that react to touch. One canvas, one loop, 30 fps at most.
 * The loop stops completely when the page is hidden, when Performance mode or "reduce motion" is on,
 * and when the scene is not a live one; the still colours from style.css show instead.
 */
export const LIVE_SCENES = ["star-web", "ripples", "fireflies", "aurora-flow", "tara-pulse", "tilt"];
export const isLive = (scene) => LIVE_SCENES.includes(scene);

const TAU = Math.PI * 2, FRAME = 1000 / 30;
const rand = (a, b) => a + Math.random() * (b - a);

/** Each scene is { init(w, h), tick(ctx, w, h, t, dt, input), touch?(x, y) }. `input` has x, y, active, tiltX, tiltY. */
const SCENES = {
  "star-web": () => {
    let stars = [];
    return {
      init(w, h) { const n = Math.min(70, Math.round(w * h / 14000)); stars = Array.from({ length: n }, () => ({ x: rand(0, w), y: rand(0, h), vx: rand(-.12, .12), vy: rand(-.12, .12), r: rand(.8, 1.9) })); },
      tick(ctx, w, h, t, dt, input) {
        ctx.fillStyle = "#070d1f"; ctx.fillRect(0, 0, w, h);
        for (const s of stars) { s.x = (s.x + s.vx * dt * .06 + w) % w; s.y = (s.y + s.vy * dt * .06 + h) % h; }
        ctx.lineWidth = 1;
        for (let i = 0; i < stars.length; i++) {
          const a = stars[i];
          for (let j = i + 1; j < stars.length; j++) {
            const b = stars[j], d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < 110) { ctx.strokeStyle = `rgba(140,170,255,${(1 - d / 110) * .28})`; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
          }
          if (input.active) {
            const d = Math.hypot(a.x - input.x, a.y - input.y);
            if (d < 170) { ctx.strokeStyle = `rgba(190,160,255,${(1 - d / 170) * .7})`; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(input.x, input.y); ctx.stroke(); }
          }
          ctx.fillStyle = "#cfd9ff"; ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, TAU); ctx.fill();
        }
      },
    };
  },
  ripples: () => {
    const rings = [];
    return {
      init() { rings.length = 0; },
      touch(x, y) { rings.push({ x, y, age: 0 }); if (rings.length > 14) rings.shift(); },
      tick(ctx, w, h, t, dt) {
        const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#06203a"); g.addColorStop(1, "#041225");
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        for (let i = rings.length - 1; i >= 0; i--) {
          const r = rings[i]; r.age += dt / 1000;
          if (r.age > 2.6) { rings.splice(i, 1); continue; }
          for (let k = 0; k < 3; k++) {
            const radius = Math.max(0, (r.age - k * .18) * 150);
            if (radius <= 0) continue;
            ctx.strokeStyle = `rgba(120,200,255,${Math.max(0, 1 - r.age / 2.6) * (.55 - k * .15)})`; ctx.lineWidth = 2 - k * .5;
            ctx.beginPath(); ctx.arc(r.x, r.y, radius, 0, TAU); ctx.stroke();
          }
        }
      },
    };
  },
  fireflies: () => {
    let flies = [];
    return {
      init(w, h) { flies = Array.from({ length: Math.min(46, Math.round(w * h / 18000)) }, () => ({ x: rand(0, w), y: rand(0, h), a: rand(0, TAU), s: rand(.15, .5), p: rand(0, TAU) })); },
      tick(ctx, w, h, t, dt, input) {
        ctx.fillStyle = "#07120f"; ctx.fillRect(0, 0, w, h);
        for (const f of flies) {
          f.a += rand(-.12, .12);
          let vx = Math.cos(f.a) * f.s, vy = Math.sin(f.a) * f.s;
          if (input.active) { const dx = input.x - f.x, dy = input.y - f.y, d = Math.hypot(dx, dy) || 1; if (d < 240) { vx += dx / d * .9; vy += dy / d * .9; } }
          f.x = (f.x + vx * dt * .06 * 6 + w) % w; f.y = (f.y + vy * dt * .06 * 6 + h) % h;
          const glow = .45 + .55 * Math.sin(t / 700 + f.p), rad = 14;
          const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, rad);
          g.addColorStop(0, `rgba(210,255,150,${glow})`); g.addColorStop(1, "rgba(210,255,150,0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, rad, 0, TAU); ctx.fill();
        }
      },
    };
  },
  "aurora-flow": () => {
    let bend = 0;
    return {
      init() { bend = 0; },
      tick(ctx, w, h, t, dt, input) {
        ctx.fillStyle = "#04121a"; ctx.fillRect(0, 0, w, h);
        bend += ((input.active ? (input.x / w - .5) * 2 : 0) - bend) * .06;
        const bands = [["60,220,160", .34], ["80,160,255", .5], ["170,110,255", .66]];
        ctx.globalCompositeOperation = "lighter";
        bands.forEach(([rgb, base], i) => {
          const g = ctx.createLinearGradient(0, h * (base - .22), 0, h * (base + .22));
          g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(.5, `rgba(${rgb},.34)`); g.addColorStop(1, `rgba(${rgb},0)`);
          ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, h);
          for (let x = 0; x <= w; x += 24) {
            const y = h * base + Math.sin(x / 140 + t / 2600 + i * 1.7) * 38 + Math.sin(x / 70 - t / 1900) * 14 + bend * (x - w / 2) * .18;
            ctx.lineTo(x, y);
          }
          ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
        });
        ctx.globalCompositeOperation = "source-over";
      },
    };
  },
  "tara-pulse": () => ({
    init() {},
    tick(ctx, w, h, t, dt, input) {
      ctx.fillStyle = "#050a1c"; ctx.fillRect(0, 0, w, h);
      const cx = input.active ? input.x : w / 2, cy = input.active ? input.y : h / 2, breath = .5 + .5 * Math.sin(t / 1800), rad = Math.max(w, h) * (.42 + breath * .1);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, `rgba(110,130,255,${.42 + breath * .18})`); g.addColorStop(.45, "rgba(90,60,230,.22)"); g.addColorStop(1, "rgba(5,10,28,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    },
  }),
  tilt: () => {
    let dots = [];
    return {
      init(w, h) { dots = Array.from({ length: Math.min(60, Math.round(w * h / 12000)) }, () => ({ x: rand(0, w), y: rand(0, h), z: rand(.3, 1), r: rand(1, 3) })); },
      tick(ctx, w, h, t, dt, input) {
        ctx.fillStyle = "#0a0716"; ctx.fillRect(0, 0, w, h);
        const ox = input.tiltX * 40 + (input.active ? (input.x / w - .5) * -30 : 0), oy = input.tiltY * 40 + (input.active ? (input.y / h - .5) * -30 : 0);
        for (const d of dots) {
          const x = ((d.x + ox * d.z + Math.sin(t / 3000 + d.x) * 6) % w + w) % w, y = ((d.y + oy * d.z + Math.cos(t / 3400 + d.y) * 6) % h + h) % h;
          ctx.fillStyle = `rgba(${200 - d.z * 60},${150 + d.z * 60},255,${.25 + d.z * .6})`;
          ctx.beginPath(); ctx.arc(x, y, d.r * d.z + .4, 0, TAU); ctx.fill();
        }
      },
    };
  },
};

export function createLiveBackground({ host, win = window, doc = document }) {
  let canvas = null, ctx = null, scene = null, name = null, frame = 0, last = 0, w = 0, h = 0, size = null;
  const input = { x: 0, y: 0, active: false, tiltX: 0, tiltY: 0 };
  const still = () => doc.documentElement.classList.contains("perf") || win.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const allowed = () => name && !doc.hidden && !still();

  function resize() {
    if (!canvas) return;
    const scale = Math.min(win.devicePixelRatio || 1, 1.5);
    w = Math.max(1, Math.round(host.clientWidth)); h = Math.max(1, Math.round(host.clientHeight));
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    scene?.init(w, h);
  }
  function loop(now) {
    frame = 0;
    if (!allowed()) return;
    const dt = now - last;
    if (dt >= FRAME - 2) { last = now; scene.tick(ctx, w, h, now, Math.min(dt, 100), input); }
    frame = win.requestAnimationFrame(loop);
  }
  function wake() { if (!frame && allowed() && scene) { last = 0; frame = win.requestAnimationFrame(loop); } }
  function stop() { if (frame) win.cancelAnimationFrame(frame); frame = 0; }
  function place(event) { const r = host.getBoundingClientRect(); input.x = event.clientX - r.left; input.y = event.clientY - r.top; }

  doc.addEventListener("visibilitychange", () => { if (doc.hidden) stop(); else wake(); });
  win.addEventListener("resize", () => { resize(); });
  // The wallpaper itself ignores pointers, so listen on the page and let normal taps through.
  doc.addEventListener("pointerdown", (event) => { if (!scene) return; place(event); input.active = true; scene.touch?.(input.x, input.y); wake(); }, { passive: true });
  doc.addEventListener("pointermove", (event) => { if (scene && input.active) place(event); }, { passive: true });
  for (const type of ["pointerup", "pointercancel"]) doc.addEventListener(type, () => { input.active = false; }, { passive: true });
  win.addEventListener("deviceorientation", (event) => {
    if (name !== "tilt") return;
    input.tiltX = Math.max(-1, Math.min(1, (event.gamma || 0) / 45)); input.tiltY = Math.max(-1, Math.min(1, ((event.beta || 0) - 45) / 45));
  }, { passive: true });

  return {
    /** Shows a live scene, or clears it when `next` is not one. Returns whether a canvas is now running. */
    show(next) {
      if (!isLive(next)) { stop(); name = null; scene = null; if (canvas) canvas.hidden = true; return false; }
      if (!canvas) {
        canvas = doc.createElement("canvas"); canvas.className = "wallpaper__live"; canvas.setAttribute("aria-hidden", "true");
        ctx = canvas.getContext("2d", { alpha: false }); host.prepend(canvas);
      }
      name = next; scene = SCENES[next](); canvas.hidden = false; resize();
      if (still()) { scene.tick(ctx, w, h, 0, 0, input); return false; } // one calm frame instead of motion
      wake(); return true;
    },
    stop,
  };
}
